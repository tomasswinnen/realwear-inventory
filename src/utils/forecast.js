// Pipeline → demanda por SKU → ¿hay que pedir? (página Pipeline & Forecast)
//
// Funciones puras sobre las tablas que el sitio ya tiene:
//   sales_pipeline (HubSpot, con line items), skus, inventory_snapshot,
//   open_pos, demand_forecast.
// La idea: cada deal abierto trae line items con SKU y cantidad; se pasan a
// unidades por mes (según la fecha de cierre) ponderadas por la probabilidad
// de la etapa, y se cruzan con el stock disponible, las POs abiertas y la
// venta histórica para ver en qué mes se acaba el stock y cuándo habría que
// pedir, considerando el lead time del proveedor.

export const CERRADAS = new Set(['Closed won', 'Closed Lost', 'Return to Nurture']);
export const ETAPAS_ABIERTAS = ['Demo', 'Engage with Partner', 'Quote & Scope', 'Contract & Negotiation', 'PO & $$$', 'Subscription Renewed'];
const PROB_FALLBACK = { Demo: 0.1, 'Engage with Partner': 0.2, 'Quote & Scope': 0.5, 'Contract & Negotiation': 0.7, 'PO & $$$': 0.8, 'Subscription Renewed': 0.2 };

// SKUs de equipo: en el catálogo van con asterisco (alias de NetSuite)
const EQUIPOS = new Set(['127128', '127033', '127165', '127031']);
// 127160* (Navigator Z1 viejo) está excluido en todo el sitio; los deals de
// HubSpot que todavía lo usan se cuentan como el Z1 actual (127165*).
const ALIAS = { 127160: '127165' };
export const SKUS_EQUIPO = [...EQUIPOS].map(s => `${s}*`);

export const HORIZONTE = 12; // meses hacia adelante

export const mesDe = iso => (iso ?? '').slice(0, 7);
export function sumarMes(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
export function mesCorto(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

// Line item de HubSpot → SKU del catálogo (y multiplicador para kits).
// hs_sku viene escrito de varias formas: "127128", "127128*", "127033S*",
// "127033a", "127109*", "127128 ROI10" (kit de 10), "ROI520" (kit con 1 equipo).
// Devuelve null para servicios / cosas que no son stock (SSP, ASR, HWS…).
export function mapearSku(li, catalogo) {
  const raw = (li.sku ?? '').trim().toUpperCase();
  const nombre = (li.name ?? '').toLowerCase();
  if (!raw) {
    // Sin SKU: se intenta por el nombre (solo los equipos, que son los que importan)
    if (/navigator.*z1/.test(nombre)) return { sku: '127165*', por: 1, aprox: true };
    if (/navigator.*520/.test(nombre)) return { sku: '127128*', por: 1, aprox: true };
    if (/arc.?3/.test(nombre)) return { sku: '127033*', por: 1, aprox: true };
    return null;
  }
  let m = /^(\d{6})\s*ROI(\d+)$/.exec(raw);
  if (m) return { sku: `${m[1]}*`, por: Number(m[2]), kit: true };
  if (raw === 'ROI520') return { sku: '127128*', por: 1, kit: true };
  m = /^(\d{6})(?:-[A-Z0-9]+)?[SA]?\*?$/.exec(raw);
  if (!m) return null; // SSP-POP2Y, ASR-ADD1Y, HWS0002, "PepsiCo: …"
  const base0 = raw.replace(/[SA]?\*$/, '').replace(/[SA]$/, '');
  const base = ALIAS[base0] ?? base0;
  if (EQUIPOS.has(base)) return { sku: `${base}*`, por: 1 };
  const limpio = raw.replace(/\*$/, '');
  if (catalogo.has(limpio)) return { sku: limpio, por: 1 };
  if (catalogo.has(`${limpio}*`)) return { sku: `${limpio}*`, por: 1 };
  return null;
}

export function probDe(deal) {
  const p = Number(deal.probability);
  if (Number.isFinite(p) && p > 0) return Math.min(1, p);
  return PROB_FALLBACK[deal.deal_stage] ?? 0.5;
}

// data: { deals, skus, snapshot, openPos, forecast }
// opts: { hoy: 'YYYY-MM-DD', etapas: Set de etapas incluidas, excluir: Set de record_id }
export function calcularForecast(data, opts = {}) {
  const hoy = opts.hoy ?? new Date().toISOString().slice(0, 10);
  const mesHoy = hoy.slice(0, 7);
  const meses = Array.from({ length: HORIZONTE }, (_, i) => sumarMes(mesHoy, i));
  const etapas = opts.etapas ?? new Set(ETAPAS_ABIERTAS);
  const excluir = opts.excluir ?? new Set();
  const catalogo = new Map((data.skus ?? []).map(s => [s.sku, s]));
  const catSet = new Set(catalogo.keys());

  // Stock: último snapshot por SKU
  const snap = new Map();
  for (const s of data.snapshot ?? []) if (!snap.has(s.sku)) snap.set(s.sku, s);
  const incoming = new Map();
  for (const p of data.openPos ?? []) {
    if (!incoming.has(p.sku)) incoming.set(p.sku, { qty: 0, pos: [] });
    incoming.get(p.sku).qty += p.qty_open ?? 0;
    incoming.get(p.sku).pos.push(p);
  }
  const runRate = new Map((data.forecast ?? []).map(f => [f.sku, f]));

  // Deals abiertos, con su bucket de tiempo y probabilidad
  const abiertos = [];
  const calidad = { sinLineItems: [], sinCierre: [], vencidos: [], sinMapear: new Map(), mega: [] };
  for (const d of data.deals ?? []) {
    if (CERRADAS.has(d.deal_stage)) continue;
    const prob = probDe(d);
    const amt = Number(d.amount_home ?? d.amount) || 0;
    let bucket, timing;
    if (!d.close_date) { bucket = 'undated'; timing = 'undated'; }
    else if (d.close_date < hoy) { bucket = mesHoy; timing = 'overdue'; } // vencido: se asume que cierra ya
    else if (mesDe(d.close_date) > meses[meses.length - 1]) { bucket = 'later'; timing = 'later'; }
    else { bucket = mesDe(d.close_date); timing = 'dated'; }
    const incluido = etapas.has(d.deal_stage) && !excluir.has(d.record_id);
    const lineas = [];
    for (const li of d.line_items ?? []) {
      const mp = mapearSku(li, catSet);
      const qty = Number(li.qty) || 0;
      if (!mp) {
        if (qty > 0 && !/^(SSP|ASR|SP-ADV|WAR-|SUPP-|RMA-|DEV-PRO|ARIOS)/i.test(li.sku ?? '')) {
          const k = `${li.sku ?? '—'} | ${li.name ?? ''}`;
          calidad.sinMapear.set(k, (calidad.sinMapear.get(k) ?? 0) + qty);
        }
        continue;
      }
      lineas.push({ ...li, skuCat: mp.sku, unidades: qty * mp.por, kit: !!mp.kit, aprox: !!mp.aprox });
    }
    const deal = { ...d, prob, amt, weighted: amt * prob, bucket, timing, incluido, lineas };
    abiertos.push(deal);
    if (!d.line_items?.length) calidad.sinLineItems.push(deal);
    if (timing === 'undated') calidad.sinCierre.push(deal);
    if (timing === 'overdue') calidad.vencidos.push(deal);
  }
  calidad.mega = [...abiertos].filter(d => d.incluido).sort((a, b) => b.weighted - a.weighted).slice(0, 5);

  // Plata por mes
  const porMes = new Map(meses.map(m => [m, { m, raw: 0, weighted: 0, deals: 0 }]));
  const fuera = { undated: { raw: 0, weighted: 0, deals: 0 }, later: { raw: 0, weighted: 0, deals: 0 }, overdue: { raw: 0, weighted: 0, deals: 0 } };
  for (const d of abiertos) {
    if (!d.incluido) continue;
    const dest = porMes.get(d.bucket) ?? fuera[d.bucket];
    if (dest) { dest.raw += d.amt; dest.weighted += d.weighted; dest.deals += 1; }
    if (d.timing === 'overdue') { fuera.overdue.raw += d.amt; fuera.overdue.weighted += d.weighted; fuera.overdue.deals += 1; }
  }

  // Unidades por SKU
  const porSku = new Map();
  const skuRow = sku => {
    if (!porSku.has(sku)) {
      porSku.set(sku, { sku, desc: catalogo.get(sku)?.description ?? '', info: catalogo.get(sku) ?? {}, meses: new Map(meses.map(m => [m, { raw: 0, weighted: 0 }])), undated: { raw: 0, weighted: 0 }, later: { raw: 0, weighted: 0 }, deals: [] });
    }
    return porSku.get(sku);
  };
  for (const d of abiertos) {
    if (!d.incluido) continue;
    for (const l of d.lineas) {
      const r = skuRow(l.skuCat);
      const dest = r.meses.get(d.bucket) ?? r[d.bucket];
      if (dest) { dest.raw += l.unidades; dest.weighted += l.unidades * d.prob; }
      r.deals.push({ record_id: d.record_id, deal_name: d.deal_name, deal_stage: d.deal_stage, prob: d.prob, close_date: d.close_date, timing: d.timing, bucket: d.bucket, distributor: d.distributor, company: d.company, unidades: l.unidades, weighted: l.unidades * d.prob, kit: l.kit, aprox: l.aprox });
    }
  }
  // SKUs con venta histórica pero sin pipeline también entran (la base sigue corriendo)
  for (const [sku, f] of runRate) if (catSet.has(sku) && (f.avg_6m ?? 0) > 0) skuRow(sku);

  // Simulación mes a mes por SKU
  const filas = [];
  for (const r of porSku.values()) {
    const s = snap.get(r.sku) ?? {};
    const onHand = s.on_hand_total ?? 0;
    const committed = s.committed_total ?? 0;
    const disponible = Math.max(0, onHand - committed);
    const inc = incoming.get(r.sku)?.qty ?? 0;
    const base = runRate.get(r.sku)?.avg_6m ?? 0;
    const leadDias = r.info.lead_time_days ?? 60;
    const leadMeses = Math.max(1, Math.round(leadDias / 30));
    const moq = r.info.moq ?? 0;
    const pipe6w = meses.slice(0, 6).reduce((t, m) => t + r.meses.get(m).weighted, 0);
    const pipe6r = meses.slice(0, 6).reduce((t, m) => t + r.meses.get(m).raw, 0);
    const pipe12w = meses.reduce((t, m) => t + r.meses.get(m).weighted, 0);
    // Escenarios: solo la base histórica / base + pipeline ponderado
    const simular = conPipe => {
      let stock = disponible + inc, agotaEn = null, demandaTotal = 0;
      const curva = [];
      for (const m of meses) {
        const dem = base + (conPipe ? r.meses.get(m).weighted : 0);
        demandaTotal += dem;
        stock -= dem;
        curva.push({ m, dem, stock });
        if (stock < 0 && agotaEn === null) agotaEn = m;
      }
      return { agotaEn, curva, demandaTotal };
    };
    const soloBase = simular(false);
    const conPipe = simular(true);
    const demandaMensual = conPipe.demandaTotal / HORIZONTE;
    const cobertura = demandaMensual > 0 ? (disponible + inc) / demandaMensual : Infinity;
    const coberturaBase = base > 0 ? (disponible + inc) / base : Infinity;
    // ¿Cuándo pedir? = mes de quiebre − lead time
    let pedirEn = null, señal = 'ok';
    if (conPipe.agotaEn) {
      pedirEn = sumarMes(conPipe.agotaEn, -leadMeses);
      const d = (Number(pedirEn.slice(0, 4)) * 12 + Number(pedirEn.slice(5))) - (Number(mesHoy.slice(0, 4)) * 12 + Number(mesHoy.slice(5)));
      señal = d <= 0 ? 'now' : d <= 2 ? 'soon' : 'later';
    }
    // Cantidad sugerida: cubrir lead time + 3 meses de demanda (base + pipeline), neto de lo que hay
    const mesesCubrir = Math.min(HORIZONTE, leadMeses + 3);
    const demCubrir = conPipe.curva.slice(0, mesesCubrir).reduce((t, c) => t + c.dem, 0);
    let sugerido = Math.max(0, Math.ceil(demCubrir - (disponible + inc)));
    if (sugerido > 0 && moq > 0) sugerido = Math.ceil(sugerido / moq) * moq;
    filas.push({
      ...r, onHand, committed, disponible, incoming: inc, pos: incoming.get(r.sku)?.pos ?? [], base, leadDias, leadMeses, moq,
      pipe6w, pipe6r, pipe12w, undatedRaw: r.undated.raw, undatedW: r.undated.weighted, laterW: r.later.weighted,
      agotaEn: conPipe.agotaEn, agotaEnBase: soloBase.agotaEn, curva: conPipe.curva, cobertura, coberturaBase, pedirEn, señal, sugerido,
      esEquipo: EQUIPOS.has(r.sku.replace('*', '')),
      sinStock: !snap.has(r.sku),
    });
  }
  const ordenSeñal = { now: 0, soon: 1, later: 2, ok: 3 };
  filas.sort((a, b) => ordenSeñal[a.señal] - ordenSeñal[b.señal] || (a.agotaEn ?? 'z').localeCompare(b.agotaEn ?? 'z') || b.pipe12w - a.pipe12w);

  const incluidos = abiertos.filter(d => d.incluido);
  const d90 = new Date(`${hoy}T00:00:00Z`); d90.setUTCDate(d90.getUTCDate() + 90);
  const fin90 = d90.toISOString().slice(0, 10);
  const kpis = {
    deals: incluidos.length,
    raw: incluidos.reduce((t, d) => t + d.amt, 0),
    weighted: incluidos.reduce((t, d) => t + d.weighted, 0),
    weighted90: incluidos.filter(d => d.timing === 'overdue' || (d.close_date && d.close_date <= fin90)).reduce((t, d) => t + d.weighted, 0),
    pedirAhora: filas.filter(f => f.señal === 'now').length,
    pedirPronto: filas.filter(f => f.señal === 'soon').length,
  };
  return { hoy, mesHoy, meses, abiertos, porMes: [...porMes.values()], fuera, filas, calidad, kpis, snapshotAt: [...snap.values()][0]?.updated_at ?? null };
}
