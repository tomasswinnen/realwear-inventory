import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, paginar } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { QueryError } from '../components/QueryError';
import { TableSkeleton, KPISkeleton } from '../components/Skeleton';
import { HOY, nombreCuenta, planLabel } from '../utils/warranty';

// Renewals & Revenue: cuánto facturan garantías y suscripciones por año y
// cuánto se pierde cuando vencen y no se renuevan. Todo en vivo:
//   · so_lines + so_history  → importe por línea de plan/software y estado de la SO
//   · warranties             → fechas reales de cada plan (inicio/fin, end customer)
//   · warranty_serials       → seriales cubiertos (para ver si se renovaron)
//   · launchpad_subs         → suscripciones pagas de device y su renovación
//
// Reglas (las mismas del Excel del 15/10/2026):
//   · Revenue = SOs Billed o Closed. Las SO abiertas van aparte ("booked, not
//     billed yet") y las Cancelled no cuentan para nada.
//   · Valor anual de un plan = importe de la línea / años del plan.
//   · Renovado = algún serial del plan tiene una cobertura posterior (plan de
//     NetSuite o Launchpad), o el mismo end customer compró un plan nuevo entre
//     180 días antes y 120 días después del fin. Si la línea no tiene seriales
//     ni end customer no se puede rastrear: cuenta como no renovada ("no trace").
//   · Planes que están en so_lines pero no en warranties (SSP12 hasta que corra
//     el pipeline con el fix) se toman con fin = fecha de SO + plazo.
//   · Suscripciones de device facturadas en facturas sueltas: el importe todavía
//     no está en Supabase (reporte_revenue.bat), así que se muestra "pending".

const ANIO_INICIO = 2024;
const PLAZO = {
  'SP-ADV1': 1, 'SP-ADV2': 2, 'SP-ADV3': 3,
  'SSP-POP1Y': 1, 'SSP-POP2Y': 2, 'SSP-ADD1Y': 1, 'SSP-ADD2Y': 2,
  'SSP-12': 1, 'SSP12': 1, 'SSP-24': 2, 'SSP-36': 3,
  'WAR-STD1Y': 1, 'SUPP-STD1Y': 1, 'RMA-POOL1YR': 1,
};
const RE_WAR = /^(SSP|SP-ADV|WAR-STD|SUPP-STD|RMA-POOL)/i;
const RE_SW = /DEV-PRO|ARIOS|Cloud|Analytics|License|^RWPS/i;
const FACTURADO = new Set(['Billed', 'Closed']);

export async function fetchRevenue() {
  const lineas = await paginar(() => supabase.from('so_lines').select('so_number, sku, qty, amount')
    .or('sku.ilike.SSP*,sku.ilike.SP-ADV*,sku.ilike.WAR-STD*,sku.ilike.SUPP-STD*,sku.ilike.RMA-POOL*,sku.ilike.DEV-PRO*,sku.ilike.ARIOS*,sku.ilike.*Cloud*,sku.ilike.*Analytics*,sku.ilike.*License*,sku.ilike.RWPS*'));
  const sos = [...new Set(lineas.map(l => l.so_number))];
  const lotes = [];
  for (let i = 0; i < sos.length; i += 150) lotes.push(sos.slice(i, i + 150));
  const cabeceras = (await Promise.all(lotes.map(lote => paginar(() => supabase.from('so_history')
    .select('so_number, so_date, customer, status').in('so_number', lote))))).flat();
  const [planes, seriales, lp] = await Promise.all([
    paginar(() => supabase.from('warranties').select('so_number, so_date, customer, sku, qty, plan_years, start_date, end_date, start_source, end_customer')),
    paginar(() => supabase.from('warranty_serials').select('serial, sku, so_number, end_date')),
    paginar(() => supabase.from('launchpad_subs').select('serial, plan_code, end_date, customer, distributor')),
  ]);
  return { lineas, cabeceras, planes, seriales, lp };
}

const norm = s => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const money = n => (n == null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`);
const kmoney = n => {
  if (n == null) return '—';
  const a = Math.abs(n);
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${Math.round(n / 1e3).toLocaleString('en-US')}k`;
  return `$${Math.round(n)}`;
};
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '—');
const masDias = (iso, d) => {
  const t = new Date(`${iso}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
};
const masAnios = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${y + n}-${String(m).padStart(2, '0')}-${String(m === 2 && d === 29 ? 28 : d).padStart(2, '0')}`;
};

export function calcular(data) {
  const hoy = HOY();
  const anioHoy = Number(hoy.slice(0, 4));
  const anios = [];
  for (let y = ANIO_INICIO; y <= anioHoy; y += 1) anios.push(String(y));
  const cab = new Map(data.cabeceras.map(c => [c.so_number, c]));

  // 1) Revenue por año (fecha de la SO) y estado
  const rev = {}; // `${cat}|${y}` -> importe
  const abiertas = [];
  const canceladas = [];
  const importePorLinea = new Map(); // `${so}|${sku}` -> importe
  for (const l of data.lineas) {
    const cat = RE_WAR.test(l.sku) ? 'warranty' : RE_SW.test(l.sku) ? 'software' : null;
    if (!cat) continue;
    const c = cab.get(l.so_number);
    const k = `${l.so_number}|${l.sku}`;
    importePorLinea.set(k, (importePorLinea.get(k) ?? 0) + (l.amount ?? 0));
    const y = (c?.so_date ?? '').slice(0, 4);
    if (!anios.includes(y) || !l.amount) continue;
    const fila = { ...l, cat, so_date: c?.so_date, customer: nombreCuenta(c?.customer), status: c?.status ?? '?' };
    if (FACTURADO.has(fila.status)) rev[`${cat}|${y}`] = (rev[`${cat}|${y}`] ?? 0) + l.amount;
    else if (fila.status === 'Cancelled') canceladas.push(fila);
    else abiertas.push(fila);
  }

  // 2) Líneas de plan (warranties) + las que faltan (SSP12) desde so_lines
  const enPlanes = new Set(data.planes.map(p => `${p.so_number}|${p.sku}`));
  const planes = data.planes
    .filter(p => p.start_source !== 'invoice')
    .map(p => ({ ...p, sintetico: false }));
  const sinteticos = new Map(); // una SO puede tener varias líneas del mismo plan: se suman
  for (const l of data.lineas) {
    const anios_ = PLAZO[l.sku];
    const c = cab.get(l.so_number);
    const k = `${l.so_number}|${l.sku}`;
    if (!anios_ || !c?.so_date || enPlanes.has(k)) continue;
    if (!sinteticos.has(k)) {
      sinteticos.set(k, {
        so_number: l.so_number, so_date: c.so_date, customer: c.customer, sku: l.sku,
        qty: 0, plan_years: anios_, start_date: c.so_date,
        end_date: masAnios(c.so_date, anios_), end_customer: '', sintetico: true,
      });
    }
    sinteticos.get(k).qty += l.qty ?? 0;
  }
  planes.push(...sinteticos.values());

  // Cobertura por serial (para ver si se renovó) y planes por end customer
  const cobSerial = new Map();
  const agregar = (s, fin) => {
    const k = (s ?? '').trim().toUpperCase();
    if (!k || !fin) return;
    if (!cobSerial.has(k)) cobSerial.set(k, []);
    cobSerial.get(k).push(fin);
  };
  const serPorLinea = new Map();
  for (const s of data.seriales) {
    agregar(s.serial, s.end_date);
    const k = `${s.so_number}|${s.sku}`;
    if (!serPorLinea.has(k)) serPorLinea.set(k, []);
    serPorLinea.get(k).push({ serial: s.serial.trim().toUpperCase(), fin: s.end_date });
  }
  for (const r of data.lp) agregar(r.serial, r.end_date);
  const porEC = new Map();
  for (const p of planes) {
    if (!(p.end_customer ?? '').trim()) continue;
    const k = norm(p.end_customer);
    if (!porEC.has(k)) porEC.set(k, []);
    porEC.get(k).push(p);
  }

  // 3) Vencidos por año y si se renovaron
  const vencidos = [];
  for (const p of planes) {
    const status = cab.get(p.so_number)?.status;
    if (status === 'Cancelled' || !p.end_date || p.end_date > hoy) continue;
    const y = p.end_date.slice(0, 4);
    if (!anios.includes(y)) continue;
    const importe = importePorLinea.get(`${p.so_number}|${p.sku}`) ?? 0;
    const anual = importe / Math.max(p.plan_years || 1, 1);
    const sers = serPorLinea.get(`${p.so_number}|${p.sku}`) ?? [];
    let frac; let como;
    if (sers.length) {
      const ren = sers.filter(s => (cobSerial.get(s.serial) ?? []).some(f => f > s.fin)).length;
      frac = ren / sers.length; como = `by serial (${sers.length})`;
    } else if ((p.end_customer ?? '').trim()) {
      const desde = masDias(p.end_date, -180); const hasta = masDias(p.end_date, 120);
      const ok = (porEC.get(norm(p.end_customer)) ?? []).some(m => m !== p && m.so_date >= desde && m.so_date <= hasta);
      frac = ok ? 1 : 0; como = 'by end customer';
    } else {
      frac = 0; como = 'no trace';
    }
    vencidos.push({ ...p, y, importe, anual, frac, como, perdido: anual * (1 - frac), renovado: anual * frac });
  }

  // 4) Suscripciones pagas de device (Launchpad)
  const subsFin = []; const subsFuturo = {};
  for (const r of data.lp) {
    if (r.plan_code === 'SSP-STANDARD' || !r.end_date) continue;
    if (r.end_date > hoy) { const y = r.end_date.slice(0, 4); subsFuturo[y] = (subsFuturo[y] ?? 0) + 1; continue; }
    const y = r.end_date.slice(0, 4);
    if (!anios.includes(y)) continue;
    const ren = (cobSerial.get((r.serial ?? '').trim().toUpperCase()) ?? []).some(f => f > r.end_date);
    subsFin.push({ ...r, y, ren });
  }

  // Resumen por año
  const porAnio = anios.map(y => {
    const v = vencidos.filter(x => x.y === y);
    const s = subsFin.filter(x => x.y === y);
    const suma = (arr, f) => arr.reduce((t, x) => t + f(x), 0);
    return {
      y,
      revWar: rev[`warranty|${y}`] ?? 0,
      revSw: rev[`software|${y}`] ?? 0,
      abierto: suma(abiertas.filter(a => a.so_date?.startsWith(y)), a => a.amount),
      lineas: v.length,
      unidades: suma(v, x => x.qty ?? 0),
      anual: suma(v, x => x.anual),
      renovado: suma(v, x => x.renovado),
      perdido: suma(v, x => x.perdido),
      subsFin: s.length, subsRen: s.filter(x => x.ren).length,
    };
  });
  const tot = k => porAnio.reduce((t, r) => t + r[k], 0);
  const totales = Object.fromEntries(['revWar', 'revSw', 'abierto', 'lineas', 'unidades', 'anual', 'renovado', 'perdido', 'subsFin', 'subsRen'].map(k => [k, tot(k)]));
  return {
    anios, porAnio, totales, vencidos, abiertas, canceladas, subsFin, subsFuturo,
    ssp12Faltante: planes.some(p => p.sintetico && p.sku === 'SSP12'),
  };
}

async function exportarExcel(v) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const res = v.porAnio.map(r => ({
    Year: r.y, 'Warranties billed': Math.round(r.revWar), 'Software subs billed': Math.round(r.revSw),
    'Booked, not billed yet': Math.round(r.abierto), 'Plan lines that ended': r.lineas, 'Units that ended': r.unidades,
    'Annual value that ended': Math.round(r.anual), 'Renewal found': Math.round(r.renovado),
    'Not renewed (lost)': Math.round(r.perdido), 'Device subs ended': r.subsFin, 'Device subs renewed': r.subsRen,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(res), 'Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(v.vencidos
    .sort((a, b) => b.perdido - a.perdido)
    .map(x => ({
      'End year': x.y, 'End date': x.end_date, SO: x.so_number, 'SO date': x.so_date,
      'Billed to': nombreCuenta(x.customer), 'End customer': x.end_customer ?? '', Plan: x.sku,
      Units: x.qty, Years: x.plan_years, 'Contract value': Math.round(x.importe), 'Annual value': Math.round(x.anual),
      'How checked': x.como, 'Renewed share': Number(x.frac.toFixed(3)), 'Not renewed (annual)': Math.round(x.perdido),
      'End date estimated': x.sintetico ? 'yes (SO date + term)' : '',
    }))), 'Warranty expirations');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(v.abiertas.map(a => ({
    SO: a.so_number, 'SO date': a.so_date, Customer: a.customer, SKU: a.sku, Status: a.status, Amount: Math.round(a.amount),
  }))), 'Booked not billed');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(v.subsFin.map(s => ({
    'End year': s.y, 'End date': s.end_date, Serial: s.serial, Plan: s.plan_code, Customer: s.customer ?? '',
    Distributor: s.distributor ?? '', Renewed: s.ren ? 'yes' : 'no',
  }))), 'Device subs ended');
  XLSX.writeFile(wb, `renewals_revenue_${HOY()}.xlsx`);
}

export function Revenue() {
  const { data, loading, error, refetch } = useQuery(fetchRevenue, []);
  const v = useMemo(() => (data ? calcular(data) : null), [data]);
  const [anioPerd, setAnioPerd] = useState('all');
  const [todos, setTodos] = useState(false);

  if (error) return <QueryError message={error} onRetry={refetch} />;

  const ultimoAnio = v?.anios[v.anios.length - 1];
  const etiqueta = y => (y === ultimoAnio ? `${y} (to date)` : y);
  const perdidas = v ? v.vencidos
    .filter(x => x.perdido > 0 && (anioPerd === 'all' || x.y === anioPerd))
    .sort((a, b) => b.perdido - a.perdido) : [];

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-sans font-semibold text-white">Renewals &amp; Revenue</h1>
          <p className="text-xs text-muted font-mono mt-0.5">
            What warranties and subscriptions bring in, and what we lose when they end and nobody renews them — {ANIO_INICIO} to today, live from NetSuite.
          </p>
        </div>
        <button onClick={() => v && exportarExcel(v)} disabled={!v}
          className="sm:ml-auto px-3 py-1.5 rounded border border-white/[0.12] text-[11px] font-mono text-slate-300 hover:text-white hover:border-accent/50 disabled:opacity-60 transition-colors whitespace-nowrap">
          Export Excel
        </button>
      </div>

      {loading || !v ? <KPISkeleton /> : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Hero titulo="Billed since 2024" valor={kmoney(v.totales.revWar + v.totales.revSw)}
            sub={`${kmoney(v.totales.revWar)} warranties · ${kmoney(v.totales.revSw)} software · device subscriptions pending`} color="text-accent" />
          <Hero titulo="Booked, not billed yet" valor={kmoney(v.totales.abierto)}
            sub={`${v.abiertas.length} lines on open sales orders`} />
          <Hero titulo="Warranty value that ended" valor={kmoney(v.totales.anual)}
            sub={`${v.totales.unidades.toLocaleString('en-US')} units · ${v.totales.lineas.toLocaleString('en-US')} plan lines, per year of coverage`} />
          <Hero titulo="Not renewed — lost per year" valor={kmoney(v.totales.perdido)} color="text-danger"
            sub={`renewal found on ${pct(v.totales.renovado, v.totales.anual)} of the value that ended`} />
        </div>
      )}

      {/* Año por año */}
      {loading || !v ? <TableSkeleton rows={8} cols={5} /> : (
        <section className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="px-4 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px]">Year</th>
                  {v.porAnio.map(r => (
                    <th key={r.y} className="px-4 py-2.5 text-right text-muted font-sans font-medium uppercase tracking-wider text-[10px] whitespace-nowrap">{etiqueta(r.y)}</th>
                  ))}
                  <th className="px-4 py-2.5 text-right text-muted font-sans font-medium uppercase tracking-wider text-[10px]">Total</th>
                </tr>
              </thead>
              <tbody>
                <Seccion t="Revenue billed" />
                <Fila t="Warranties / service plans" k="revWar" v={v} f={money} />
                <Fila t="Software subscriptions (Device Pro, ARIOS, Cloud)" k="revSw" v={v} f={money} />
                <tr className="border-b border-white/[0.04]">
                  <td className="px-4 py-2 font-sans text-slate-300">Device subscriptions (billed on invoices)</td>
                  {v.porAnio.map(r => <td key={r.y} className="px-4 py-2 text-right font-mono text-muted">pending</td>)}
                  <td className="px-4 py-2 text-right font-mono text-muted">pending</td>
                </tr>
                <Fila t="Booked on open SOs, not billed yet" k="abierto" v={v} f={money} tono="text-muted" />
                <Seccion t="Warranties that ended" />
                <Fila t="Units that ended" k="unidades" v={v} f={n => Math.round(n).toLocaleString('en-US')} />
                <Fila t="Annual value that ended" k="anual" v={v} f={money} />
                <Fila t="… renewal found" k="renovado" v={v} f={money} tono="text-success" />
                <Fila t="… not renewed (lost)" k="perdido" v={v} f={money} tono="text-danger" negrita />
                <tr className="border-b border-white/[0.04]">
                  <td className="px-4 py-2 font-sans text-slate-300">Renewal rate (by value)</td>
                  {v.porAnio.map(r => <td key={r.y} className="px-4 py-2 text-right font-mono text-slate-300">{pct(r.renovado, r.anual)}</td>)}
                  <td className="px-4 py-2 text-right font-mono text-slate-300">{pct(v.totales.renovado, v.totales.anual)}</td>
                </tr>
                <Seccion t="Paid device subscriptions that ended (Launchpad)" />
                <Fila t="Ended" k="subsFin" v={v} f={n => n.toLocaleString('en-US')} />
                <Fila t="… renewed" k="subsRen" v={v} f={n => n.toLocaleString('en-US')} tono="text-success" />
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Lo que viene */}
      {v && (
        <section className="bg-card rounded-lg border border-white/[0.08] p-4">
          <p className="text-[10px] font-mono text-muted uppercase tracking-widest mb-2">Paid device subscriptions still running — when they come up for renewal</p>
          <div className="flex gap-6 flex-wrap">
            {Object.entries(v.subsFuturo).sort().map(([y, n]) => (
              <div key={y}>
                <p className="text-2xl font-num text-white">{n.toLocaleString('en-US')}</p>
                <p className="text-[11px] font-mono text-muted">{y === ultimoAnio ? `rest of ${y}` : y}</p>
              </div>
            ))}
            <Link to="/subscriptions" className="self-end text-[11px] font-mono text-accent hover:text-accent/80">track them in Subscriptions →</Link>
          </div>
        </section>
      )}

      {/* Mayores pérdidas */}
      {v && (
        <section className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
          <header className="flex items-center gap-2 flex-wrap px-4 py-2.5 border-b border-white/[0.06] bg-white/[0.02]">
            <span className="font-sans font-semibold text-sm text-white">Biggest warranties not renewed</span>
            <span className="text-[11px] font-mono text-muted">annual value · ended {anioPerd === 'all' ? `${ANIO_INICIO}–today` : anioPerd}</span>
            <span className="sm:ml-auto flex gap-1">
              {['all', ...v.anios].map(y => (
                <button key={y} onClick={() => setAnioPerd(y)}
                  className={`px-2 py-1 rounded text-[10px] font-mono ${anioPerd === y ? 'bg-accent/15 text-accent' : 'text-muted hover:text-white'}`}>
                  {y === 'all' ? 'All years' : y}
                </button>
              ))}
            </span>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {['Ended', 'Customer', 'Plan', 'Units', 'SO', 'Not renewed / year', 'How checked'].map(h => (
                    <th key={h} className="px-4 py-2 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(todos ? perdidas : perdidas.slice(0, 15)).map(x => (
                  <tr key={`${x.so_number}|${x.sku}|${x.end_date}`} className="border-b border-white/[0.04] hover:bg-white/[0.03]">
                    <td className="px-4 py-2 font-mono text-slate-300 whitespace-nowrap">{x.end_date}{x.sintetico && <span className="text-muted" title="End date estimated: SO date + plan term">~</span>}</td>
                    <td className="px-4 py-2 font-sans text-white max-w-[300px] truncate" title={`${x.end_customer || '—'} · billed to ${nombreCuenta(x.customer)}`}>
                      {x.end_customer || nombreCuenta(x.customer)}
                      {!x.end_customer && <span className="ml-1.5 text-[9px] font-mono text-warning">distributor</span>}
                    </td>
                    <td className="px-4 py-2 font-mono text-muted whitespace-nowrap" title={planLabel(x.sku)}>{x.sku}</td>
                    <td className="px-4 py-2 font-num text-slate-300">{(x.qty ?? 0).toLocaleString('en-US')}</td>
                    <td className="px-4 py-2 font-mono text-muted">{x.so_number}</td>
                    <td className="px-4 py-2 font-num text-danger whitespace-nowrap">{money(x.perdido)}</td>
                    <td className="px-4 py-2 font-mono text-[10px] text-muted whitespace-nowrap">{x.como}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {perdidas.length > 15 && (
            <button onClick={() => setTodos(t => !t)} className="w-full px-4 py-2 text-[11px] font-mono text-accent hover:bg-white/[0.03] border-t border-white/[0.06]">
              {todos ? 'Show top 15' : `Show all ${perdidas.length}`}
            </button>
          )}
        </section>
      )}

      {v && (
        <div className="text-[10px] text-muted font-mono leading-relaxed space-y-1.5">
          <p className="text-slate-300">How these numbers are built</p>
          <p>· Revenue billed = NetSuite sales-order lines for plan and software SKUs on SOs with status Billed or Closed, by SO date (base-currency line amounts). Open SOs are shown as “booked, not billed yet”; cancelled SOs are left out everywhere ({v.canceladas.length} lines).</p>
          <p>· Device subscriptions (Arc 3 / Navigator annual plans) are billed on standalone invoices and their sales-order line is $0, so they aren’t in these numbers yet — that row fills in once invoice amounts are loaded.</p>
          <p>· Annual value = line amount ÷ plan years. A renewal is found when a covered serial gets a later coverage (NetSuite plan or Launchpad), or the same end customer buys a new plan from 180 days before to 120 days after the end. Lines with no serials and no end customer can’t be traced (“no trace”), so “not renewed” is an upper bound.</p>
          {v.ssp12Faltante && <p>· SSP12 (12-month plans sold Oct-2023 → Oct-2024) has no line dates on the site yet; its end date is estimated as SO date + 12 months (marked ~).</p>}
        </div>
      )}
    </div>
  );
}

function Hero({ titulo, valor, sub, color = 'text-white' }) {
  return (
    <div className="bg-card border border-white/[0.08] rounded-lg p-4 lg:p-5 min-w-0">
      <p className="text-[11px] lg:text-xs text-muted uppercase tracking-wider font-sans">{titulo}</p>
      <p className={`mt-1 text-2xl lg:text-4xl font-num font-medium leading-tight ${color}`}>{valor}</p>
      <p className="mt-1 text-[11px] lg:text-xs text-muted font-sans">{sub}</p>
    </div>
  );
}

function Seccion({ t }) {
  return (
    <tr className="bg-white/[0.02] border-b border-white/[0.06]">
      <td colSpan={99} className="px-4 py-1.5 text-[10px] font-mono text-muted uppercase tracking-widest">{t}</td>
    </tr>
  );
}

function Fila({ t, k, v, f, tono = 'text-white', negrita = false }) {
  return (
    <tr className="border-b border-white/[0.04]">
      <td className={`px-4 py-2 font-sans ${negrita ? 'text-white font-medium' : 'text-slate-300'}`}>{t}</td>
      {v.porAnio.map(r => (
        <td key={r.y} className={`px-4 py-2 text-right font-num whitespace-nowrap ${tono} ${negrita ? 'font-medium' : ''}`}>{f(r[k])}</td>
      ))}
      <td className={`px-4 py-2 text-right font-num whitespace-nowrap ${tono} font-medium`}>{f(v.totales[k])}</td>
    </tr>
  );
}
