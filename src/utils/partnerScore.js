import PARTNERS from '../data/partners.json';

// Puntaje de socios (página /partner-score). Funciones puras: reciben las
// tablas ya bajadas y devuelven un puntaje 0–100 por cuenta, con el detalle
// de cada parámetro. Todo sale de datos que el sitio ya tiene; si un dato no
// existe para una cuenta, el parámetro queda "n/a" y NO cuenta (el puntaje es
// lo ganado sobre lo aplicable), en vez de inventar un cero.
//
// Ventana: últimos 12 meses. Las tasas sobre equipos enviados usan los que
// salieron hace 30–365 días (lo de este mes todavía no tuvo tiempo de
// reportarse ni registrarse).

export const DIA = 86400000;
export const sumarDias = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DIA).toISOString().slice(0, 10);
const dias = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DIA);

export const clave = s => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
// "30683 Westbase B.V." → "Westbase B.V."; "Barcotec GmbH Barcotec GmbH" → una vez
export const nombreNS = c => (c ?? '').replace(/^[\d:]+\s+/, '').trim().replace(/^(.+?)\s+\1$/, '$1');
export const normSerial = s => (s ?? '').trim().toUpperCase();

// Resellers: el mismo reseller llega escrito de varias formas ("Lunaar" /
// "LUNAAR", "Nippon Sokki Co.,Ltd."). Se agrupa sin mayúsculas, signos ni
// sufijos societarios.
const SUFIJOS = /\b(inc|llc|l l c|ltd|limited|gmbh|b v|bv|n v|nv|s a|sa|ag|as|a s|spa|s p a|sl|s l|srl|sas|co|corp|corporation|company|pty|pvt|private|kk|oy|ab|aps|plc|lp|sp z o o|de cv|sa de cv)\b/g;
export function claveReseller(s) {
  const x = (s ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ')
    .replace(SUFIJOS, ' ').replace(/\s+/g, '');
  return x || clave(s);
}

// Mismo cliente si, sin signos, un nombre contiene al otro (igual que Overview)
export const mismo = (a, b) => {
  const x = clave(a), y = clave(b);
  return !!x && !!y && (x.includes(y) || y.includes(x));
};

const STAGE_WEIGHT = { 'Contract & Negotiation': 0.4, 'PO & $$$': 0.75 };
const PAGA = r => r.plan_code !== 'SSP-STANDARD'; // SSP-STANDARD = garantía estándar incluida

// ── Parámetros ──────────────────────────────────────────────────────────────
// tipo 'rank' = se compara contra las otras cuentas del grupo (percentil);
// tipo 'rate' = puntos completos al llegar a la meta fija (target);
// tipo 'peer' = puntos completos al nivel del cuartil superior del grupo
//   (con un piso). Para attach, registro y renovaciones: hoy son bajos en todo
//   el canal, y una meta fija dejaría a todos en cero sin distinguir a nadie.
export const PARAMS_CUENTA = [
  { k: 'volume', label: 'Billed sales', max: 20, tipo: 'rank', grupo: 'perf',
    como: 'Billed sales orders in NetSuite, last 12 months. Ranked against the other accounts of the same type.' },
  { k: 'growth', label: 'Growth', max: 5, tipo: 'growth', grupo: 'perf',
    como: 'Billed last 12 months vs the 12 months before. −50% or worse = 0, flat = 2.5, +50% or better = 5.' },
  { k: 'accessories', label: 'Accessories', max: 10, tipo: 'peer', piso: 25, unidad: '$', grupo: 'perf',
    como: 'Accessory sales (billed SO lines of catalog SKUs that are not devices) per device shipped, last 12 months. Needs 5+ devices shipped.' },
  { k: 'coverage', label: 'Sell-out coverage', max: 10, tipo: 'rate', target: 0.8, grupo: 'data', soloDist: true,
    como: 'Devices we shipped them 30–365 days ago that appear in a sell-out report. Devices still in their stock lower it.' },
  { k: 'endcust', label: 'End customer reported', max: 5, tipo: 'rate', target: 0.8, grupo: 'data', soloDist: true,
    como: 'Sell-out lines that name the end customer.' },
  { k: 'accuracy', label: 'Serials match NetSuite', max: 5, tipo: 'rate', target: 0.95, grupo: 'data', soloDist: true,
    como: 'Sell-out serials that match a device NetSuite shipped (no typos, no unknown serials).' },
  { k: 'attach', label: 'Paid plan attached', max: 15, tipo: 'peer', piso: 0.1, grupo: 'perf',
    como: 'Devices shipped 30–365 days ago that have a paid warranty or subscription (NetSuite or Launchpad).' },
  { k: 'registration', label: 'Registered in Launchpad', max: 5, tipo: 'peer', piso: 0.1, grupo: 'perf',
    como: 'Devices shipped 30–365 days ago that the customer registered in Launchpad.' },
  { k: 'renewals', label: 'Renewals', max: 15, tipo: 'peer', piso: 0.2, grupo: 'perf', min: 5,
    como: 'Paid coverage that ended in the last 12 months and was renewed (a later plan on the same serial ending 60+ days after, or marked Renewed in follow-up). Needs 5+ ended contracts.' },
  { k: 'stock', label: 'Stock report', max: 5, tipo: 'stock', grupo: 'data', soloDist: true,
    como: 'Latest stock report: within 45 days = 5, within 100 days = 2.5, older or none = 0.' },
  { k: 'pipeline', label: 'HubSpot pipeline', max: 5, tipo: 'rank', grupo: 'perf',
    como: 'Won + weighted open deals in HubSpot. Ranked. Only scored when the HubSpot export is less than 90 days old.' },
];

export const PARAMS_RESELLER = [
  { k: 'units', label: 'Devices sold', max: 25, tipo: 'rank', grupo: 'perf',
    como: 'Devices the distributors report this reseller sold in the last 12 months. Ranked against the other resellers.' },
  { k: 'endcust', label: 'End customer reported', max: 20, tipo: 'rate', target: 0.8, grupo: 'data',
    como: 'Sell-out lines for this reseller that name the end customer.' },
  { k: 'attach', label: 'Paid plan attached', max: 20, tipo: 'peer', piso: 0.1, grupo: 'perf',
    como: 'Their devices with a paid warranty or subscription (NetSuite or Launchpad).' },
  { k: 'renewals', label: 'Renewals', max: 20, tipo: 'peer', piso: 0.2, grupo: 'perf', min: 5,
    como: 'Paid coverage on their devices that ended in the last 12 months and was renewed. Needs 5+ ended contracts.' },
  { k: 'registration', label: 'Registered in Launchpad', max: 10, tipo: 'peer', piso: 0.1, grupo: 'data',
    como: 'Their devices registered in Launchpad.' },
  { k: 'consistency', label: 'Customer data agrees', max: 5, tipo: 'rate', target: 0.95, grupo: 'data', min: 3,
    como: 'When both Launchpad and the sell-out name the end customer, how often they agree. Needs 3+ devices with both.' },
];

export const GRADOS = [
  { g: 'A', min: 80, cls: 'bg-success/20 text-success', bar: '#22c55e' },
  { g: 'B', min: 60, cls: 'bg-accent/20 text-accent', bar: '#38bdf8' },
  { g: 'C', min: 40, cls: 'bg-warning/20 text-warning', bar: '#f59e0b' },
  { g: 'D', min: 0, cls: 'bg-danger/20 text-danger', bar: '#ef4444' },
];
export const gradoDe = s => GRADOS.find(x => s >= x.min) ?? GRADOS[GRADOS.length - 1];

// ── Nombres → distribuidor ─────────────────────────────────────────────────
function patron(p) {
  const comodin = p.endsWith('*');
  const k = clave(comodin ? p.slice(0, -1) : p);
  return v => (comodin ? clave(v).startsWith(k) : clave(v) === k);
}
const DISTS = PARTNERS.distributors.map((d, i) => ({
  ...d, id: `d${i}`,
  mNS: (d.netsuite ?? []).map(patron), mSO: (d.sellout ?? []).map(patron), mST: (d.stock ?? []).map(patron),
  claves: [d.name, ...(d.netsuite ?? []), ...(d.sellout ?? []).map(s => s.replace(/\*$/, ''))]
    .map(clave).filter(k => k.length >= 4),
}));
function resolver(campo) {
  const cache = new Map();
  return nombre => {
    if (!nombre) return null;
    if (cache.has(nombre)) return cache.get(nombre);
    const d = DISTS.find(x => x[campo].some(m => m(nombre))) ?? null;
    cache.set(nombre, d);
    return d;
  };
}

const pct = (n, d) => (d ? Math.round((100 * n) / d) : 0);
const fmtN = n => (n ?? 0).toLocaleString('en-US');

// Percentil dentro del grupo: el más alto = 1, el más bajo con algo = 1/n,
// sin nada = 0. Los empates reparten el puesto.
function percentil(valores, v) {
  if (!v) return 0;
  const n = valores.length;
  if (n <= 1) return 1;
  const menores = valores.filter(x => x < v).length;
  const iguales = valores.filter(x => x === v).length;
  return Math.min(1, (menores + 1 + 0.5 * (iguales - 1)) / n);
}

// Puntos de un parámetro 'rate'
function tasa(p, n, d, texto) {
  if (!d || (p.min && d < p.min)) {
    return { na: true, valor: d ? `${texto(n, d)} — too few to score` : 'no data' };
  }
  const r = n / d;
  return { r, pts: p.target ? p.max * Math.min(1, r / p.target) : null, valor: texto(n, d) };
}

// Parámetros 'peer': la meta es el percentil 75 de las tasas del grupo.
function aplicarPeer(grupo, params) {
  for (const p of params.filter(x => x.tipo === 'peer')) {
    const rs = grupo.map(c => c.p[p.k]).filter(x => x && !x.na && x.r != null).map(x => x.r).sort((a, b) => a - b);
    const q = rs.length >= 4 ? rs[Math.floor(0.75 * (rs.length - 1))] : rs[rs.length - 1] ?? 0;
    const meta = Math.max(p.piso, q);
    for (const c of grupo) {
      const x = c.p[p.k];
      if (!x || x.na) continue;
      x.meta = meta;
      x.pts = p.max * Math.min(1, x.r / meta);
    }
  }
}

function cerrar(cuenta, params) {
  let gan = 0, pos = 0;
  const sub = { perf: [0, 0], data: [0, 0] };
  for (const p of params) {
    const x = cuenta.p[p.k];
    if (!x || x.na) continue;
    x.pts = Math.max(0, Math.min(p.max, x.pts));
    gan += x.pts; pos += p.max;
    sub[p.grupo][0] += x.pts; sub[p.grupo][1] += p.max;
  }
  // Con menos de la mitad de los puntos medibles no se pone nota: sería
  // juzgar a la cuenta por uno o dos números.
  cuenta.aplicable = pos;
  cuenta.score = pos >= 50 ? Math.round((100 * gan) / pos) : null;
  cuenta.perf = sub.perf[1] ? Math.round((100 * sub.perf[0]) / sub.perf[1]) : null;
  cuenta.data = sub.data[1] ? Math.round((100 * sub.data[0]) / sub.data[1]) : null;
  cuenta.grado = cuenta.score == null ? null : gradoDe(cuenta.score).g;
  cuenta.flojos = params
    .filter(p => cuenta.p[p.k] && !cuenta.p[p.k].na && cuenta.p[p.k].pts / p.max < 0.6)
    .sort((a, b) => cuenta.p[a.k].pts / a.max - cuenta.p[b.k].pts / b.max)
    .slice(0, 2).map(p => p.k);
}

// ── Cálculo principal ──────────────────────────────────────────────────────
// data: { so, ship, ws, lp, sell, stock, pipe, fu, duenos }
//   duenos: serial → cliente NetSuite (para subs de Launchpad sin distribuidor)
export function calcularPuntajes(data, hoy) {
  const d365 = sumarDias(hoy, -365), d730 = sumarDias(hoy, -730), d30 = sumarDias(hoy, -30);
  const dNS = resolver('mNS'), dSO = resolver('mSO'), dST = resolver('mST');

  // Cuenta de un cliente de NetSuite: distribuidor de la lista o cuenta directa
  const cuentas = new Map();
  const cuenta = (id, base) => {
    if (!cuentas.has(id)) {
      cuentas.set(id, {
        id, ...base, nsNombres: new Set(), billed: 0, prev: 0, ordenes: 0, acc: 0,
        enviados: new Set(), enviados12: 0, sellRows: [], stockAt: null, pipe: 0, pipeDeals: 0,
        vencidos: 0, renovados: 0,
      });
    }
    return cuentas.get(id);
  };
  for (const d of DISTS) cuenta(d.id, { nombre: d.name, region: d.region, tipo: 'dist' });
  const deNS = customer => {
    const n = nombreNS(customer);
    if (!n) return null;
    const d = dNS(n);
    const c = d ? cuentas.get(d.id) : cuenta(`n:${clave(n)}`, { nombre: n, region: '', tipo: 'direct' });
    c.nsNombres.add(n);
    return c;
  };

  // 1. Ventas facturadas (SO Billed/Closed)
  const soCuenta = new Map(); // SO de los últimos 12 meses → cuenta
  for (const r of data.so ?? []) {
    if (r.status !== 'Billed' && r.status !== 'Closed') continue;
    const f = r.so_date ?? '';
    if (f < d730 || f > hoy) continue;
    const c = deNS(r.customer);
    if (!c) continue;
    if (f >= d365) { c.billed += Number(r.amount) || 0; c.ordenes += 1; soCuenta.set(r.so_number, c); } else c.prev += Number(r.amount) || 0;
  }

  // 1b. Accesorios: líneas de esas SO con SKU del catálogo que no sea equipo.
  // Equipo = SKU que aparece en serial_shipments (+ los 4 conocidos). Las
  // líneas de grupo ("End of Group", "520 Direct"…) no están en el catálogo.
  const equipos = new Set(['127031*', '127033*', '127128*', '127165*']);
  for (const e of data.ship ?? []) if (e.sku) equipos.add(e.sku);
  const catalogo = new Set(data.catalogo ?? []);
  for (const l of data.lines ?? []) {
    const c = soCuenta.get(l.so_number);
    if (!c || !catalogo.has(l.sku) || equipos.has(l.sku)) continue;
    c.acc += Number(l.amount) || 0;
  }

  // 2. Equipos enviados (un evento por serial: el más viejo dentro de la ventana)
  const envio = new Map();
  for (const e of data.ship ?? []) {
    const s = normSerial(e.serial);
    if (!s || !e.cliente || !e.fecha || e.fecha < d365 || e.fecha > hoy) continue;
    const prev = envio.get(s);
    if (!prev || e.fecha < prev.fecha || (e.fecha === prev.fecha && e.doc_type === 'ItemShip')) envio.set(s, e);
  }
  for (const [s, e] of envio) {
    const c = deNS(e.cliente);
    if (!c) continue;
    c.enviados12 += 1;
    if (e.fecha <= d30) c.enviados.add(s);
  }

  // 3. Coberturas pagas por serial (NetSuite + Launchpad) y registro en Launchpad
  const pagas = new Map(); // serial → [end_date]
  const agregar = (s, f) => { if (!pagas.has(s)) pagas.set(s, []); pagas.get(s).push(f ?? ''); };
  for (const w of data.ws ?? []) agregar(normSerial(w.serial), w.end_date);
  const enLP = new Set(), lpCliente = new Map();
  for (const r of data.lp ?? []) {
    const s = normSerial(r.serial);
    if (!s) continue;
    enLP.add(s);
    if (r.customer?.trim()) lpCliente.set(s, r.customer.trim());
    if (PAGA(r)) agregar(s, r.end_date);
  }
  const fuRenov = new Set((data.fu ?? []).filter(f => f.status === 'renewed')
    .map(f => `${normSerial(f.serial)}|${f.end_date}`));
  // Renovado = otra cobertura paga que termina 60+ días después. Con "cualquier
  // fecha posterior" el mismo contrato cargado en NetSuite y en Launchpad con
  // fechas apenas distintas contaba como renovación (7 de 15 casos al 16/10).
  const renovado = (s, fin) => fuRenov.has(`${s}|${fin}`)
    || (pagas.get(s) ?? []).some(x => x > sumarDias(fin, 60));

  // Contratos pagos vencidos en los últimos 12 meses → cuenta que los vendió
  const vistos = new Set();
  const vencido = (c, s, fin) => {
    const k = `${c.id}|${s}|${fin}`;
    if (vistos.has(k)) return;
    vistos.add(k);
    c.vencidos += 1;
    if (renovado(s, fin)) c.renovados += 1;
  };
  const enVentana = fin => fin && fin >= d365 && fin < hoy;
  for (const w of data.ws ?? []) {
    if (!enVentana(w.end_date)) continue;
    const c = deNS(w.customer);
    if (c) vencido(c, normSerial(w.serial), w.end_date);
  }
  for (const r of data.lp ?? []) {
    if (!PAGA(r) || !enVentana(r.end_date)) continue;
    const s = normSerial(r.serial);
    const d = r.distributor ? (dNS(r.distributor) ?? dSO(r.distributor)) : null;
    const c = d ? cuentas.get(d.id) : (data.duenos?.[s] ? deNS(data.duenos[s]) : null);
    if (c) vencido(c, s, r.end_date);
  }

  // 4. Sell-out
  const enSellout = new Set();
  const sinMatch = { sellout: new Map(), stock: new Map() };
  for (const r of data.sell ?? []) {
    const s = normSerial(r.serial);
    if (s) enSellout.add(s);
    if (r.ns_serial) enSellout.add(normSerial(r.ns_serial));
    const d = dSO(r.distributor);
    if (d) cuentas.get(d.id).sellRows.push(r);
    else if (r.distributor) sinMatch.sellout.set(r.distributor, (sinMatch.sellout.get(r.distributor) ?? 0) + 1);
  }

  // 5. Stock reportado
  for (const r of data.stock ?? []) {
    const d = dST(r.distributor);
    if (!d) { if (r.distributor) sinMatch.stock.set(r.distributor, (sinMatch.stock.get(r.distributor) ?? 0) + 1); continue; }
    const c = cuentas.get(d.id);
    if (r.updated_at && (!c.stockAt || r.updated_at > c.stockAt)) c.stockAt = String(r.updated_at).slice(0, 10);
  }

  // 6. HubSpot (solo si el export es reciente)
  const pipeAt = (data.pipe ?? []).reduce((m, r) => (r.updated_at && r.updated_at > m ? r.updated_at : m), '');
  const pipeFresco = !!pipeAt && dias(String(pipeAt).slice(0, 10), hoy) <= 90;
  const pipeline = { at: pipeAt ? String(pipeAt).slice(0, 10) : null, fresco: pipeFresco, filas: (data.pipe ?? []).length };
  if (pipeFresco) {
    const lista = [...cuentas.values()];
    for (const r of data.pipe) {
      const k = clave(r.distributor);
      if (k.length < 4) continue;
      const d = DISTS.find(x => x.claves.some(c => c.includes(k) || k.includes(c)));
      const c = d ? cuentas.get(d.id) : lista.find(x => x.tipo === 'direct' && clave(x.nombre).length >= 4
        && (clave(x.nombre).includes(k) || k.includes(clave(x.nombre))));
      if (!c) continue;
      const amt = Number(r.amount) || 0;
      c.pipeDeals += 1;
      c.pipe += r.deal_stage === 'Closed won' ? amt : amt * (STAGE_WEIGHT[r.deal_stage] ?? 0);
    }
  }

  // 7. Universo y parámetros
  const todas = [...cuentas.values()];
  const conDatos = c => (c.tipo === 'dist'
    ? c.billed >= 10000 || c.enviados12 >= 10 || c.sellRows.length >= 20
    : c.billed >= 50000);
  const puntuadas = todas.filter(conDatos);
  const sinDatos = todas.filter(c => !conDatos(c) && c.tipo === 'dist');
  const P = Object.fromEntries(PARAMS_CUENTA.map(p => [p.k, p]));

  for (const tipo of ['dist', 'direct']) {
    const grupo = puntuadas.filter(c => c.tipo === tipo);
    const vols = grupo.map(c => c.billed);
    const pipes = grupo.map(c => c.pipe);
    for (const c of grupo) {
      c.p = {};
      c.p.volume = { pts: P.volume.max * percentil(vols, c.billed), valor: `$${fmtN(Math.round(c.billed))} · ${c.ordenes} orders` };
      if (!c.prev && !c.billed) c.p.growth = { na: true, valor: 'no sales' };
      else if (!c.prev) c.p.growth = { pts: 5, valor: 'new account (nothing billed the year before)' };
      else {
        const g = (c.billed - c.prev) / c.prev;
        c.p.growth = { pts: 5 * Math.min(1, Math.max(0, (g + 0.5) / 1)), valor: `${g >= 0 ? '+' : ''}${Math.round(g * 100)}% (prior year $${fmtN(Math.round(c.prev))})` };
      }
      const env = [...c.enviados];
      const minEnv = 5;
      const tEnv = (p, n) => {
        if (env.length < minEnv) return { na: true, valor: env.length ? `${env.length} devices shipped — too few to score` : 'no devices shipped 30–365 days ago' };
        return tasa(p, n, env.length, (a, b) => `${fmtN(a)} of ${fmtN(b)} devices (${pct(a, b)}%)`);
      };
      c.p.attach = tEnv(P.attach, env.filter(s => pagas.has(s)).length);
      c.p.registration = tEnv(P.registration, env.filter(s => enLP.has(s)).length);
      c.p.accessories = !data.lines
        ? { na: true, valor: 'sales order lines not available' }
        : c.enviados12 < minEnv
          ? { na: true, valor: `$${fmtN(Math.round(c.acc))} in accessories — too few devices shipped to compare` }
          : { r: c.acc / c.enviados12, pts: null, valor: `$${fmtN(Math.round(c.acc))} in accessories · $${fmtN(Math.round(c.acc / c.enviados12))} per device shipped (${fmtN(c.enviados12)} devices)` };
      c.p.renewals = tasa(P.renewals, c.renovados, c.vencidos, (a, b) => `${fmtN(a)} of ${fmtN(b)} ended contracts renewed (${pct(a, b)}%)`);
      if (!c.vencidos) c.p.renewals = { na: true, valor: 'no paid coverage ended in the last 12 months' };
      c.p.pipeline = pipeFresco
        ? { pts: P.pipeline.max * percentil(pipes, c.pipe), valor: c.pipeDeals ? `$${fmtN(Math.round(c.pipe))} won + weighted · ${c.pipeDeals} deals` : 'no deals in HubSpot' }
        : { na: true, valor: pipeAt ? `HubSpot export is from ${pipeline.at} — not scored` : 'no HubSpot data' };

      if (tipo === 'dist') {
        const filas = c.sellRows;
        if (!filas.length) {
          const no = { pts: 0, valor: 'does not send sell-out reports' };
          c.p.coverage = env.length >= minEnv ? { ...no, valor: `0 of ${fmtN(env.length)} devices reported — no sell-out report` } : { na: true, valor: 'no sell-out report, too few devices shipped to score' };
          c.p.endcust = { ...no };
          c.p.accuracy = { ...no };
        } else {
          c.p.coverage = tEnv(P.coverage, env.filter(s => enSellout.has(s)).length);
          if (!c.p.coverage.na) c.p.coverage.valor = c.p.coverage.valor.replace('devices', 'devices reported');
          c.p.endcust = tasa(P.endcust, filas.filter(r => r.end_customer?.trim()).length, filas.length,
            (a, b) => `${fmtN(a)} of ${fmtN(b)} sell-out lines (${pct(a, b)}%)`);
          const conCheck = filas.filter(r => r.ns_match);
          c.p.accuracy = conCheck.length
            ? tasa(P.accuracy, conCheck.filter(r => r.ns_match === 'shipped').length, conCheck.length,
              (a, b) => `${fmtN(a)} of ${fmtN(b)} serials match (${pct(a, b)}%)`)
            : { na: true, valor: 'NetSuite check not run yet' };
        }
        if (!c.stockAt) c.p.stock = { pts: 0, valor: 'no stock report' };
        else {
          const dd = dias(c.stockAt, hoy);
          c.p.stock = { pts: dd <= 45 ? 5 : dd <= 100 ? 2.5 : 0, valor: `last report ${c.stockAt} (${dd} days ago)` };
        }
      }
    }
    aplicarPeer(grupo, PARAMS_CUENTA);
    for (const c of grupo) {
      cerrar(c, PARAMS_CUENTA);
      c.nsNombres = [...c.nsNombres];
    }
  }

  // 8. Resellers (lo que reportan los distribuidores)
  const rs = new Map();
  for (const r of data.sell ?? []) {
    if (!r.reseller?.trim()) continue;
    const k = claveReseller(r.reseller);
    const kd = claveReseller(dSO(r.distributor)?.name ?? r.distributor);
    const kd2 = claveReseller(r.distributor);
    // El distribuidor vendiendo directo no es un reseller
    if (!k || [kd, kd2].some(x => x && (x.startsWith(k) || k.startsWith(x)))) continue;
    if (!rs.has(k)) rs.set(k, { id: `r:${k}`, grafias: new Map(), filas: [], dists: new Set() });
    const x = rs.get(k);
    x.grafias.set(r.reseller.trim(), (x.grafias.get(r.reseller.trim()) ?? 0) + 1);
    x.filas.push(r);
    x.dists.add(dSO(r.distributor)?.name ?? r.distributor ?? '?');
  }
  const PR = Object.fromEntries(PARAMS_RESELLER.map(p => [p.k, p]));
  const resellers = [];
  const resSinDatos = [];
  for (const x of rs.values()) {
    x.nombre = [...x.grafias.entries()].sort((a, b) => b[1] - a[1])[0][0];
    x.dists = [...x.dists];
    const seriales = [...new Set(x.filas.map(r => normSerial(r.ns_serial || r.serial)).filter(Boolean))];
    x.devices = seriales.length;
    x.units12 = x.filas.filter(r => r.date_sold && r.date_sold >= d365 && r.date_sold <= hoy).length;
    if (x.devices < 5) { resSinDatos.push(x); continue; }
    resellers.push(x);
    x.seriales = seriales;
  }
  const unidades = resellers.map(x => x.units12);
  for (const x of resellers) {
    const ss = x.seriales;
    x.p = {};
    x.p.units = { pts: PR.units.max * percentil(unidades, x.units12), valor: `${fmtN(x.units12)} in the last 12 months · ${fmtN(x.devices)} reported in total` };
    x.p.endcust = tasa(PR.endcust, x.filas.filter(r => r.end_customer?.trim()).length, x.filas.length,
      (a, b) => `${fmtN(a)} of ${fmtN(b)} sell-out lines (${pct(a, b)}%)`);
    x.p.attach = tasa(PR.attach, ss.filter(s => pagas.has(s)).length, ss.length, (a, b) => `${fmtN(a)} of ${fmtN(b)} devices (${pct(a, b)}%)`);
    let ven = 0, ren = 0;
    for (const s of ss) {
      for (const fin of new Set(pagas.get(s) ?? [])) {
        if (!enVentana(fin)) continue;
        ven += 1; if (renovado(s, fin)) ren += 1;
      }
    }
    x.p.renewals = ven
      ? tasa(PR.renewals, ren, ven, (a, b) => `${fmtN(a)} of ${fmtN(b)} ended contracts renewed (${pct(a, b)}%)`)
      : { na: true, valor: 'no paid coverage ended in the last 12 months' };
    x.p.registration = tasa(PR.registration, ss.filter(s => enLP.has(s)).length, ss.length, (a, b) => `${fmtN(a)} of ${fmtN(b)} devices (${pct(a, b)}%)`);
    const ambos = x.filas.filter(r => r.end_customer?.trim() && lpCliente.has(normSerial(r.ns_serial || r.serial)));
    x.p.consistency = ambos.length
      ? tasa(PR.consistency, ambos.filter(r => mismo(r.end_customer, lpCliente.get(normSerial(r.ns_serial || r.serial)))).length, ambos.length,
        (a, b) => `${fmtN(a)} of ${fmtN(b)} devices agree (${pct(a, b)}%)`)
      : { na: true, valor: 'no device named in both Launchpad and sell-out' };
  }
  aplicarPeer(resellers, PARAMS_RESELLER);
  for (const x of resellers) {
    cerrar(x, PARAMS_RESELLER);
    delete x.seriales; delete x.grafias;
    x.filas = x.filas.length;
  }

  const orden = (a, b) => (b.score ?? -1) - (a.score ?? -1) || (b.billed ?? b.units12 ?? 0) - (a.billed ?? a.units12 ?? 0);
  return {
    cuentas: puntuadas.sort(orden),
    sinDatos: sinDatos.map(c => ({ nombre: c.nombre, billed: c.billed, enviados12: c.enviados12 })),
    resellers: resellers.sort(orden),
    resSinDatos: resSinDatos.length,
    sinMatch: {
      sellout: [...sinMatch.sellout.entries()].sort((a, b) => b[1] - a[1]),
      stock: [...sinMatch.stock.entries()].sort((a, b) => b[1] - a[1]),
    },
    pipeline,
    ventana: { desde: d365, hasta: hoy, enviosHasta: d30 },
  };
}
