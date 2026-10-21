import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { supabase, paginar, excludeSkus } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { QueryError } from '../components/QueryError';
import { TableSkeleton, KPISkeleton, ChartSkeleton } from '../components/Skeleton';
import { KPICard } from '../components/KPICard';
import { descargarCSV } from '../components/FollowUp';
import { formatCurrency } from '../utils/coverage';
import { calcularForecast, ETAPAS_ABIERTAS, SKUS_EQUIPO, mesCorto, HORIZONTE } from '../utils/forecast';

// Pipeline & Forecast: los deals de HubSpot (sales_pipeline, cargada por el
// pipeline cada 2 h) convertidos en UNIDADES POR SKU POR MES, ponderadas por
// la probabilidad de la etapa, y cruzadas con stock disponible, POs abiertas
// y venta histórica. La pregunta que responde: ¿qué tengo que pedir y cuándo?
// La lógica vive en utils/forecast.js (funciones puras, testeadas aparte).

const HUBSPOT = id => `https://app.hubspot.com/contacts/4426286/record/0-3/${id}`;
const STAGE_CLS = {
  Demo: 'bg-white/[0.06] text-slate-300', 'Engage with Partner': 'bg-white/[0.06] text-slate-300',
  'Quote & Scope': 'bg-accent/10 text-accent', 'Contract & Negotiation': 'bg-accent/20 text-accent',
  'PO & $$$': 'bg-success/15 text-success', 'Subscription Renewed': 'bg-white/[0.06] text-slate-300',
};
const SEÑAL = {
  now: { label: 'Order now', cls: 'bg-danger/15 text-danger' },
  soon: { label: 'Order soon', cls: 'bg-warning/15 text-warning' },
  later: { label: 'Later', cls: 'bg-white/[0.06] text-slate-300' },
  ok: { label: 'OK', cls: 'bg-success/10 text-success' },
};

async function fetchPipeline() {
  const [deals, skus, snapshot, openPos, forecast] = await Promise.all([
    paginar(() => supabase.from('sales_pipeline')
      .select('record_id, deal_name, deal_owner, amount, amount_home, company, distributor, reseller, close_date, deal_stage, line_items, probability, forecast_category, geography, country, last_modified_date, updated_at')
      .order('record_id', { ascending: true })),
    excludeSkus(supabase.from('skus').select('sku, description, supplier, lead_time_days, moq, unit_cost')).then(r => { if (r.error) throw new Error(r.error.message); return r.data; }),
    excludeSkus(supabase.from('inventory_snapshot').select('sku, on_hand_total, committed_total, on_hand_portland, on_hand_hk, updated_at').order('updated_at', { ascending: false })).then(r => r.data ?? []),
    excludeSkus(supabase.from('open_pos').select('sku, po_number, qty_open, status, vendor')).then(r => r.data ?? []),
    excludeSkus(supabase.from('demand_forecast').select('sku, avg_3m, avg_6m, total_12m')).then(r => r.data ?? []),
  ]);
  const syncAt = deals.reduce((m, d) => (d.updated_at && d.updated_at > m ? d.updated_at : m), '');
  return { deals, skus, snapshot, openPos, forecast, syncAt };
}

const fmt = n => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));
const kmoney = n => (n == null ? '—' : Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : Math.abs(n) >= 1e3 ? `$${Math.round(n / 1e3).toLocaleString('en-US')}k` : `$${Math.round(n)}`);
const pct = p => `${Math.round(p * 100)}%`;
const fecha = v => (v ? new Date(`${v}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

function Pill({ stage }) {
  return <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded whitespace-nowrap ${STAGE_CLS[stage] ?? 'bg-white/[0.06] text-slate-300'}`}>{stage}</span>;
}

function TooltipPlata({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="px-3 py-2 rounded text-xs" style={{ backgroundColor: '#162030', border: '1px solid rgba(148,163,184,0.12)' }}>
      <p className="text-white mb-1">{label}</p>
      {payload.map(p => <p key={p.dataKey} className="font-mono" style={{ color: p.fill }}>{p.name}: {formatCurrency(p.value)}</p>)}
    </div>
  );
}

// Fila de SKU desplegada: curva mes a mes + deals que empujan la demanda
function DetalleSku({ f, meses }) {
  const deals = [...f.deals].sort((a, b) => b.weighted - a.weighted);
  return (
    <div className="px-4 pb-4 pt-1 space-y-3">
      <div className="overflow-x-auto">
        <table className="text-[11px] font-mono">
          <thead>
            <tr className="text-muted">
              <th className="text-left pr-3 py-1 font-normal"></th>
              {meses.map(m => <th key={m} className="px-2 py-1 font-normal text-right whitespace-nowrap">{mesCorto(m)}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr><td className="pr-3 text-muted whitespace-nowrap">Pipeline (weighted)</td>{meses.map(m => <td key={m} className="px-2 text-right text-slate-300">{f.meses.get(m).weighted ? fmt(f.meses.get(m).weighted) : <span className="text-muted">·</span>}</td>)}</tr>
            <tr><td className="pr-3 text-muted whitespace-nowrap">Pipeline (if all close)</td>{meses.map(m => <td key={m} className="px-2 text-right text-muted">{f.meses.get(m).raw ? fmt(f.meses.get(m).raw) : '·'}</td>)}</tr>
            <tr><td className="pr-3 text-muted whitespace-nowrap">Run-rate</td>{meses.map(m => <td key={m} className="px-2 text-right text-muted">{f.base ? fmt(f.base) : '·'}</td>)}</tr>
            <tr className="border-t border-white/[0.08]"><td className="pr-3 text-white whitespace-nowrap">Stock after month</td>{f.curva.map(c => <td key={c.m} className={`px-2 text-right ${c.stock < 0 ? 'text-danger' : c.stock < f.base ? 'text-warning' : 'text-white'}`}>{fmt(c.stock)}</td>)}</tr>
          </tbody>
        </table>
      </div>
      <p className="text-[10px] font-mono text-muted">
        Starting stock = available {fmt(f.disponible)} (on hand {fmt(f.onHand)} − committed {fmt(f.committed)}) + incoming {fmt(f.incoming)}{f.pos.length ? ` (${f.pos.map(p => `${p.po_number}: ${fmt(p.qty_open)}`).join(', ')})` : ''}.
        {f.undatedRaw ? ` Not in the curve: ${fmt(f.undatedRaw)} units in deals with no close date.` : ''}
        {f.laterW ? ` ${fmt(f.laterW)} weighted units close after the ${HORIZONTE}-month window.` : ''}
        {' '}Run-rate = average monthly sales, last 6 months. Lead time {f.leadDias} days{f.moq ? ` · MOQ ${fmt(f.moq)}` : ''}.
      </p>
      {deals.length > 0 && (
        <div className="bg-white/[0.02] rounded-md border border-white/[0.06]">
          <p className="px-3 pt-2 text-[10px] font-mono uppercase tracking-wider text-muted">Deals driving this ({deals.length})</p>
          <table className="w-full text-[11px]">
            <tbody>
              {deals.slice(0, 25).map(d => (
                <tr key={`${d.record_id}-${d.unidades}`} className="border-t border-white/[0.04]">
                  <td className="px-3 py-1.5 text-slate-200"><a href={HUBSPOT(d.record_id)} target="_blank" rel="noreferrer" className="hover:text-accent">{d.deal_name}</a>{d.kit ? <span className="text-muted"> · kit</span> : ''}{d.aprox ? <span className="text-warning" title="No SKU on the line item — matched by product name"> · ~</span> : ''}</td>
                  <td className="px-2 py-1.5 text-muted font-mono whitespace-nowrap">{d.distributor ?? d.company ?? ''}</td>
                  <td className="px-2 py-1.5"><Pill stage={d.deal_stage} /></td>
                  <td className="px-2 py-1.5 font-mono text-right text-slate-300 whitespace-nowrap">{fmt(d.unidades)} × {pct(d.prob)} = <span className="text-white">{fmt(d.weighted)}</span></td>
                  <td className={`px-3 py-1.5 font-mono text-right whitespace-nowrap ${d.timing === 'overdue' ? 'text-danger' : d.timing === 'undated' ? 'text-warning' : 'text-muted'}`}>{d.timing === 'undated' ? 'no close date' : d.timing === 'overdue' ? `overdue · ${fecha(d.close_date)}` : fecha(d.close_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {deals.length > 25 && <p className="px-3 py-1.5 text-[10px] font-mono text-muted">showing 25 of {deals.length}</p>}
        </div>
      )}
    </div>
  );
}

export function SalesPipeline() {
  const { data, loading, error, refetch } = useQuery(fetchPipeline, []);
  const [etapas, setEtapas] = useState(() => new Set(ETAPAS_ABIERTAS));
  // Deals destildados: se recuerdan en el navegador para no tener que
  // volver a sacar Walmart/Pepsi cada vez que se entra.
  const [excluir, setExcluir] = useState(() => { try { return new Set(JSON.parse(localStorage.getItem('forecast_excluir') ?? '[]')); } catch { return new Set(); } });
  const [soloAccion, setSoloAccion] = useState(false);
  const [soloEquipos, setSoloEquipos] = useState(false);
  const [abierto, setAbierto] = useState(null);
  const [q, setQ] = useState('');
  const [etapaLista, setEtapaLista] = useState('all');
  const [dist, setDist] = useState('all');
  const [verMas, setVerMas] = useState(50);

  const R = useMemo(() => (data ? calcularForecast(data, { etapas, excluir }) : null), [data, etapas, excluir]);

  const filas = useMemo(() => {
    if (!R) return [];
    return R.filas.filter(f => (!soloAccion || f.señal === 'now' || f.señal === 'soon') && (!soloEquipos || f.esEquipo));
  }, [R, soloAccion, soloEquipos]);

  const deals = useMemo(() => {
    if (!R) return [];
    const t = q.trim().toLowerCase();
    return R.abiertos
      .filter(d => d.incluido && (etapaLista === 'all' || d.deal_stage === etapaLista) && (dist === 'all' || (d.distributor ?? '—') === dist)
        && (!t || [d.deal_name, d.company, d.distributor, d.reseller, d.deal_owner].some(x => (x ?? '').toLowerCase().includes(t))))
      .sort((a, b) => b.weighted - a.weighted);
  }, [R, q, etapaLista, dist]);

  const distribuidores = useMemo(() => {
    if (!R) return [];
    const por = new Map();
    for (const d of R.abiertos) {
      if (!d.incluido) continue;
      const k = d.distributor ?? '—';
      if (!por.has(k)) por.set(k, { k, deals: 0, raw: 0, weighted: 0, w90: 0 });
      const g = por.get(k); g.deals += 1; g.raw += d.amt; g.weighted += d.weighted;
    }
    return [...por.values()].sort((a, b) => b.weighted - a.weighted);
  }, [R]);

  const toggleEtapa = e => setEtapas(prev => { const n = new Set(prev); n.has(e) ? n.delete(e) : n.add(e); return n; });
  const toggleExcluir = id => setExcluir(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id);
    try { localStorage.setItem('forecast_excluir', JSON.stringify([...n])); } catch { /* sin storage */ }
    return n;
  });

  const exportar = () => descargarCSV(R.filas.map(f => ({
    SKU: f.sku, Description: f.desc, Signal: SEÑAL[f.señal].label, 'Order by': f.pedirEn ?? '', 'Stock-out month (with pipeline)': f.agotaEn ?? '',
    'Stock-out month (run-rate only)': f.agotaEnBase ?? '', 'Suggested qty': f.sugerido || '', Available: f.disponible, 'On hand': f.onHand, Committed: f.committed,
    Incoming: f.incoming, 'Run-rate / month': Math.round(f.base * 10) / 10, 'Pipeline units next 6 mo (weighted)': Math.round(f.pipe6w), 'Pipeline units next 6 mo (if all close)': f.pipe6r,
    'Units in deals without close date': f.undatedRaw, 'Lead time days': f.leadDias, MOQ: f.moq || '',
    ...Object.fromEntries(R.meses.map(m => [`${m} weighted`, Math.round(f.meses.get(m).weighted * 10) / 10])),
  })), `pipeline_forecast_${R.hoy}.csv`);

  if (error) return <QueryError message={error} onRetry={refetch} />;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold text-white">Pipeline & Forecast</h1>
          <p className="text-sm text-muted mt-1 max-w-3xl">
            Open HubSpot deals turned into units per SKU per month, weighted by stage probability, against your stock, open POs and run-rate — so you know what to order and when.
            {data?.syncAt && <span className="font-mono text-[11px]"> · HubSpot synced {data.syncAt.slice(0, 16).replace('T', ' ')}</span>}
          </p>
        </div>
        {R && <button onClick={exportar} className="px-3 py-1.5 rounded bg-accent text-white text-xs hover:bg-accent/80">Export CSV</button>}
      </div>

      {loading || !R ? <><KPISkeleton /><ChartSkeleton /><TableSkeleton rows={8} /></> : (
        <>
          {/* Qué etapas entran en el forecast */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-mono text-muted uppercase tracking-wider mr-1">Stages in the forecast</span>
            {ETAPAS_ABIERTAS.map(e => {
              const n = R.abiertos.filter(d => d.deal_stage === e).length;
              if (!n) return null;
              const on = etapas.has(e);
              return (
                <button key={e} onClick={() => toggleEtapa(e)}
                  className={`px-2 py-1 rounded text-[10px] font-mono transition-colors ${on ? (STAGE_CLS[e] ?? 'bg-accent/15 text-accent') + ' ring-1 ring-white/10' : 'text-muted line-through hover:text-white'}`}>
                  {e} · {n}
                </button>
              );
            })}
            {excluir.size > 0 && <span className="text-[10px] font-mono text-warning ml-2">{excluir.size} deal{excluir.size > 1 ? 's' : ''} excluded</span>}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KPICard label="Open pipeline" value={kmoney(R.kpis.raw)} sub={`${R.kpis.deals} deals · if everything closes`} />
            <KPICard label="Weighted pipeline" value={kmoney(R.kpis.weighted)} sub="× stage probability" accent />
            <KPICard label="Weighted · next 90 days" value={kmoney(R.kpis.weighted90)} sub="by close date (incl. overdue)" />
            <KPICard label="SKUs to order now" value={R.kpis.pedirAhora} sub={`${R.kpis.pedirPronto} more within 2 months`} color={R.kpis.pedirAhora ? 'text-danger' : 'text-success'} />
            <KPICard label="Deals with no close date" value={R.calidad.sinCierre.length} sub={`${kmoney(R.fuera.undated.raw)} · not in the monthly curve`} color={R.calidad.sinCierre.length ? 'text-warning' : 'text-success'} />
          </div>

          {/* La tabla que importa: ¿hay que pedir? */}
          <section className="space-y-2">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <h2 className="text-sm font-sans font-semibold text-white">Do I need to order? <span className="text-muted font-normal">· {filas.length} SKUs</span></h2>
              <div className="flex gap-1.5">
                <button onClick={() => setSoloAccion(v => !v)} className={`px-2 py-1 rounded text-[10px] font-mono ${soloAccion ? 'bg-danger/15 text-danger' : 'text-muted hover:text-white'}`}>Needs action only</button>
                <button onClick={() => setSoloEquipos(v => !v)} className={`px-2 py-1 rounded text-[10px] font-mono ${soloEquipos ? 'bg-accent/15 text-accent' : 'text-muted hover:text-white'}`}>Devices only</button>
              </div>
            </div>
            <div className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] font-mono uppercase tracking-wider text-muted text-left border-b border-white/[0.08]">
                      <th className="px-4 py-2.5">SKU</th>
                      <th className="px-2 py-2.5 text-right">Available</th>
                      <th className="px-2 py-2.5 text-right">Incoming</th>
                      <th className="px-2 py-2.5 text-right" title="Average monthly sales, last 6 months">Run-rate /mo</th>
                      <th className="px-2 py-2.5 text-right" title="Weighted units from open deals closing in the next 6 months · raw units if every deal closes">Pipeline 6 mo</th>
                      <th className="px-2 py-2.5 text-right" title="Month the stock goes negative with run-rate + weighted pipeline · (run-rate only)">Stock-out</th>
                      <th className="px-2 py-2.5 text-right">Lead time</th>
                      <th className="px-2 py-2.5 text-right">Order by</th>
                      <th className="px-2 py-2.5 text-right" title="Covers lead time + 3 months of demand, net of stock and incoming, rounded to MOQ">Suggested</th>
                      <th className="px-4 py-2.5">Signal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map(f => {
                      const open = abierto === f.sku;
                      return [
                        <tr key={f.sku} onClick={() => setAbierto(open ? null : f.sku)} className={`border-t border-white/[0.05] cursor-pointer hover:bg-white/[0.03] ${open ? 'bg-white/[0.03]' : ''}`}>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2"><span className={`text-muted text-[10px] transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
                              <Link to={`/item/${encodeURIComponent(f.sku)}`} onClick={e => e.stopPropagation()} className="font-mono text-accent hover:underline">{f.sku}</Link>
                              {f.esEquipo && <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-accent/10 text-accent">device</span>}</div>
                            <p className="text-slate-300 truncate max-w-[260px] pl-5" title={f.desc}>{f.desc}</p>
                            {f.sinStock && <p className="text-[10px] font-mono text-warning pl-5">not in the stock snapshot</p>}
                          </td>
                          <td className="px-2 py-2.5 text-right font-num text-white">{fmt(f.disponible)}{f.committed ? <span className="text-[10px] text-muted block">{fmt(f.onHand)} − {fmt(f.committed)} committed</span> : null}</td>
                          <td className="px-2 py-2.5 text-right font-num text-success">{f.incoming ? fmt(f.incoming) : <span className="text-muted">—</span>}</td>
                          <td className="px-2 py-2.5 text-right font-num text-slate-300">{f.base ? fmt(f.base) : <span className="text-muted">—</span>}</td>
                          <td className="px-2 py-2.5 text-right font-num"><span className="text-white">{fmt(f.pipe6w)}</span><span className="text-muted text-[10px]"> / {fmt(f.pipe6r)}</span>{f.undatedRaw ? <span className="block text-[10px] text-warning">+{fmt(f.undatedRaw)} undated</span> : null}</td>
                          <td className="px-2 py-2.5 text-right font-num whitespace-nowrap">{f.agotaEn ? <span className={f.señal === 'now' ? 'text-danger' : f.señal === 'soon' ? 'text-warning' : 'text-white'}>{mesCorto(f.agotaEn)}</span> : <span className="text-success">beyond {HORIZONTE} mo</span>}<span className="block text-[10px] text-muted">{f.agotaEnBase ? `run-rate only: ${mesCorto(f.agotaEnBase)}` : 'run-rate only: ok'}</span></td>
                          <td className="px-2 py-2.5 text-right font-num text-muted">{f.leadDias} d</td>
                          <td className="px-2 py-2.5 text-right font-num whitespace-nowrap">{f.pedirEn ? <span className={f.señal === 'now' ? 'text-danger' : f.señal === 'soon' ? 'text-warning' : 'text-slate-300'}>{mesCorto(f.pedirEn)}</span> : <span className="text-muted">—</span>}</td>
                          <td className="px-2 py-2.5 text-right font-num text-white">{f.sugerido ? fmt(f.sugerido) : <span className="text-muted">—</span>}</td>
                          <td className="px-4 py-2.5"><span className={`text-[10px] font-mono px-1.5 py-0.5 rounded whitespace-nowrap ${SEÑAL[f.señal].cls}`}>{SEÑAL[f.señal].label}</span></td>
                        </tr>,
                        open && <tr key={`${f.sku}-d`} className="bg-white/[0.02]"><td colSpan={10}><DetalleSku f={f} meses={R.meses} /></td></tr>,
                      ];
                    })}
                    {!filas.length && <tr><td colSpan={10} className="px-4 py-8 text-center text-muted">Nothing to show.</td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="px-4 py-2 text-[10px] text-muted font-mono border-t border-white/[0.06]">
                Demand per month = run-rate (avg of last 6 months) + weighted pipeline units closing that month. Overdue deals count as closing this month. Deals with no close date and deals with no line items are NOT in the units (see Data quality). Suggested qty covers lead time + 3 months net of stock and incoming, rounded up to MOQ. Lead time defaults to 60 days when the SKU has none.
              </p>
            </div>
          </section>

          {/* Plata por mes */}
          <section className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2 bg-card rounded-lg border border-white/[0.08] p-4">
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted mb-2">Pipeline by expected close month · weighted vs if all close</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={R.porMes.map(m => ({ m: mesCorto(m.m), Weighted: Math.round(m.weighted), 'If all close': Math.round(m.raw) }))} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
                  <XAxis dataKey="m" tick={{ fill: '#8b9bb0', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#8b9bb0', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => kmoney(v)} width={52} />
                  <Tooltip content={<TooltipPlata />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                  <Bar dataKey="If all close" fill="#1f3a52" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Weighted" fill="#38bdf8" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <p className="text-[10px] font-mono text-muted mt-1">
                Not on the chart: {R.fuera.undated.deals} deals with no close date ({kmoney(R.fuera.undated.raw)}) · {R.fuera.later.deals} closing after {HORIZONTE} months ({kmoney(R.fuera.later.raw)}) · {R.fuera.overdue.deals} overdue ({kmoney(R.fuera.overdue.raw)}, counted in the current month).
              </p>
            </div>
            <div className="bg-card rounded-lg border border-white/[0.08] p-4 overflow-x-auto">
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted mb-2">Devices · weighted units by month</p>
              <table className="text-[11px] font-mono w-full">
                <thead><tr className="text-muted"><th className="text-left font-normal py-1">Month</th>{SKUS_EQUIPO.filter(s => R.filas.some(f => f.sku === s)).map(s => <th key={s} className="text-right font-normal py-1 px-1">{s.replace('*', '')}</th>)}</tr></thead>
                <tbody>
                  {R.meses.map(m => (
                    <tr key={m} className="border-t border-white/[0.05]">
                      <td className="py-1 text-slate-300">{mesCorto(m)}</td>
                      {SKUS_EQUIPO.filter(s => R.filas.some(f => f.sku === s)).map(s => { const f = R.filas.find(x => x.sku === s); const v = f.meses.get(m).weighted; return <td key={s} className={`py-1 px-1 text-right ${v ? 'text-white' : 'text-muted'}`}>{v ? fmt(v) : '·'}</td>; })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Calidad de datos: lo que el forecast NO ve */}
          <section className="grid gap-3 md:grid-cols-2">
            <div className="bg-card rounded-lg border border-warning/25 p-4 space-y-1.5">
              <p className="text-[10px] font-mono uppercase tracking-wider text-warning">Data quality · what the forecast can't see</p>
              <p className="text-xs text-slate-300"><span className="text-white font-num">{R.calidad.sinLineItems.length}</span> open deals have no line items — their {kmoney(R.calidad.sinLineItems.reduce((t, d) => t + d.amt, 0))} is in the money but not in the units.</p>
              <p className="text-xs text-slate-300"><span className="text-white font-num">{R.calidad.sinCierre.length}</span> open deals have no close date ({kmoney(R.fuera.undated.raw)}) — not placed in any month.</p>
              <p className="text-xs text-slate-300"><span className="text-white font-num">{R.calidad.vencidos.length}</span> deals have a close date in the past — counted as closing this month.</p>
              {R.calidad.sinMapear.size > 0 && (
                <p className="text-xs text-slate-300">Line items not matched to a stock SKU (ignored): {[...R.calidad.sinMapear.entries()].map(([k, n]) => `${k.split(' | ')[1] || k} (${n})`).join(' · ')}</p>
              )}
            </div>
            <div className="bg-card rounded-lg border border-white/[0.08] p-4">
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted mb-1.5">Biggest deals in the forecast · untick to exclude</p>
              {R.calidad.mega.map(d => (
                <label key={d.record_id} className="flex items-start gap-2 py-1 text-xs cursor-pointer">
                  <input type="checkbox" checked={!excluir.has(d.record_id)} onChange={() => toggleExcluir(d.record_id)} className="mt-0.5 accent-[#38bdf8]" />
                  <span className="min-w-0">
                    <a href={HUBSPOT(d.record_id)} target="_blank" rel="noreferrer" className="text-slate-200 hover:text-accent">{d.deal_name}</a>
                    <span className="block font-mono text-[10px] text-muted">{kmoney(d.amt)} × {pct(d.prob)} = {kmoney(d.weighted)} · <Pill stage={d.deal_stage} /> · {fecha(d.close_date)}{d.lineas.length ? ` · ${fmt(d.lineas.reduce((t, l) => t + l.unidades, 0))} units` : ' · no line items'}</span>
                  </span>
                </label>
              ))}
              {[...excluir].filter(id => !R.calidad.mega.some(d => d.record_id === id)).map(id => {
                const d = R.abiertos.find(x => x.record_id === id);
                return d ? <label key={id} className="flex items-start gap-2 py-1 text-xs cursor-pointer"><input type="checkbox" checked={false} onChange={() => toggleExcluir(id)} className="mt-0.5 accent-[#38bdf8]" /><span className="text-muted line-through">{d.deal_name}</span></label> : null;
              })}
            </div>
          </section>

          {/* Por distribuidor */}
          <section className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
            <p className="px-4 pt-3 text-[10px] font-mono uppercase tracking-wider text-muted">By distributor</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-[10px] font-mono uppercase tracking-wider text-muted text-left"><th className="px-4 py-2">Distributor</th><th className="px-2 py-2 text-right">Deals</th><th className="px-2 py-2 text-right">If all close</th><th className="px-4 py-2 text-right">Weighted</th></tr></thead>
                <tbody>
                  {distribuidores.slice(0, 15).map(g => (
                    <tr key={g.k} className="border-t border-white/[0.05] hover:bg-white/[0.02] cursor-pointer" onClick={() => setDist(dist === g.k ? 'all' : g.k)}>
                      <td className={`px-4 py-2 ${dist === g.k ? 'text-accent' : 'text-slate-200'}`}>{g.k}</td>
                      <td className="px-2 py-2 text-right font-num text-muted">{g.deals}</td>
                      <td className="px-2 py-2 text-right font-num text-slate-300">{kmoney(g.raw)}</td>
                      <td className="px-4 py-2 text-right font-num text-white">{kmoney(g.weighted)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Deals */}
          <section className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-sans font-semibold text-white">Open deals <span className="text-muted font-normal">· {deals.length}</span></h2>
              <select value={etapaLista} onChange={e => setEtapaLista(e.target.value)} className="bg-white/[0.03] border border-white/[0.1] rounded px-2 py-1 text-[11px] font-mono text-white">
                <option value="all">All stages</option>
                {ETAPAS_ABIERTAS.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
              {dist !== 'all' && <button onClick={() => setDist('all')} className="px-2 py-1 rounded bg-accent/15 text-accent text-[10px] font-mono">{dist} ×</button>}
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search deal, company, owner…"
                className="ml-auto w-60 bg-white/[0.03] border border-white/[0.1] rounded px-2.5 py-1 text-xs text-white placeholder:text-muted focus:outline-none focus:border-accent/50" />
            </div>
            <div className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] font-mono uppercase tracking-wider text-muted text-left border-b border-white/[0.08]">
                      <th className="px-4 py-2.5">Deal</th><th className="px-2 py-2.5">Stage</th><th className="px-2 py-2.5 text-right">Amount</th><th className="px-2 py-2.5 text-right">Weighted</th><th className="px-2 py-2.5 text-right">Units</th><th className="px-2 py-2.5 text-right">Close</th><th className="px-4 py-2.5">Owner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deals.slice(0, verMas).map(d => (
                      <tr key={d.record_id} className="border-t border-white/[0.05] hover:bg-white/[0.02] align-top">
                        <td className="px-4 py-2 max-w-[420px]">
                          <a href={HUBSPOT(d.record_id)} target="_blank" rel="noreferrer" className="text-slate-200 hover:text-accent">{d.deal_name}</a>
                          <p className="text-[10px] font-mono text-muted truncate">{[d.distributor, d.company, d.reseller ? `via ${d.reseller}` : null].filter(Boolean).join(' · ')}</p>
                        </td>
                        <td className="px-2 py-2"><Pill stage={d.deal_stage} /><span className="block text-[10px] font-mono text-muted mt-0.5">{pct(d.prob)}{d.forecast_category && d.forecast_category !== 'OMIT' ? ` · ${d.forecast_category}` : ''}</span></td>
                        <td className="px-2 py-2 text-right font-num text-slate-300 whitespace-nowrap">{formatCurrency(d.amt)}</td>
                        <td className="px-2 py-2 text-right font-num text-white whitespace-nowrap">{formatCurrency(d.weighted)}</td>
                        <td className="px-2 py-2 text-right font-num text-slate-300 whitespace-nowrap">{d.lineas.length ? fmt(d.lineas.reduce((t, l) => t + l.unidades, 0)) : <span className="text-warning" title="No line items">—</span>}</td>
                        <td className={`px-2 py-2 text-right font-mono whitespace-nowrap ${d.timing === 'overdue' ? 'text-danger' : d.timing === 'undated' ? 'text-warning' : 'text-muted'}`}>{d.timing === 'undated' ? 'none' : fecha(d.close_date)}{d.timing === 'overdue' ? <span className="block text-[10px]">overdue</span> : null}</td>
                        <td className="px-4 py-2 text-muted whitespace-nowrap">{d.deal_owner ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {deals.length > verMas && <button onClick={() => setVerMas(v => v + 100)} className="w-full py-2 text-[11px] font-mono text-accent hover:bg-white/[0.02] border-t border-white/[0.06]">Show 100 more ({deals.length - verMas} left)</button>}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
