import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { supabase } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { formatCurrency, coverageColor } from '../utils/coverage';
import { QueryError } from '../components/QueryError';
import { Skeleton, ChartSkeleton } from '../components/Skeleton';

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const HISTORY_MONTHS = 8;
const FORECAST_MONTHS = 12;
const GROWTH_DEFAULT = 2.5;

function fmtMo(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${MONTHS_SHORT[d.getMonth()]}-${String(d.getFullYear()).slice(2)}`;
}

function addMonths(d, n) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function coverageClass(inv, monthlyDemand) {
  if (!monthlyDemand) return 'text-slate-300';
  const mo = inv / monthlyDemand;
  if (mo < 1) return 'text-danger';
  if (mo < 3) return 'text-warning';
  return 'text-success';
}

async function fetchAllSkus() {
  const { data, error } = await supabase.from('skus').select('sku, description').order('sku');
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function fetchItem(sku) {
  const [skuRes, snapRes, salesRes, valRes] = await Promise.all([
    supabase.from('skus').select('*').eq('sku', sku).maybeSingle(),
    supabase.from('inventory_snapshot').select('*').eq('sku', sku)
      .order('updated_at', { ascending: false }).limit(1),
    supabase.from('monthly_sales').select('month, qty_sold').eq('sku', sku)
      .order('month', { ascending: true }),
    supabase.from('inventory_valuation').select('on_hand, inv_value').eq('sku', sku)
      .order('updated_at', { ascending: false }).limit(1),
  ]);
  for (const r of [skuRes, snapRes, salesRes, valRes]) {
    if (r.error) throw new Error(r.error.message);
  }
  return {
    info: skuRes.data ?? {},
    snap: snapRes.data?.[0] ?? {},
    sales: salesRes.data ?? [],
    val: valRes.data?.[0] ?? {},
  };
}

const TT = {
  backgroundColor: '#162030',
  border: '1px solid rgba(148,163,184,0.12)',
  borderRadius: 6,
  fontSize: 11,
  fontFamily: 'DM Mono, monospace',
  color: '#e2e8f0',
};

export function ItemForecast() {
  const { sku } = useParams();
  const navigate = useNavigate();
  const [qtyReceived, setQtyReceived] = useState({});
  const [growthRate, setGrowthRate] = useState(GROWTH_DEFAULT);

  const { data: allSkus } = useQuery(fetchAllSkus, []);
  const { data, loading, error, refetch } = useQuery(
    () => (sku ? fetchItem(sku) : Promise.resolve(null)),
    [sku]
  );

  // Auto-navigate to first SKU when landing on /item with no param
  useEffect(() => {
    if (!sku && allSkus?.length) {
      navigate(`/item/${allSkus[0].sku}`, { replace: true });
    }
  }, [sku, allSkus, navigate]);

  // Reset received inputs on SKU change
  useEffect(() => { setQtyReceived({}); }, [sku]);

  const computed = useMemo(() => {
    if (!data) return null;
    const salesQty = data.sales.map(s => s.qty_sold);
    const a3 = avg(salesQty.slice(-3));
    const a6 = avg(salesQty.slice(-6));
    const peak = salesQty.length ? Math.max(...salesQty) : 0;

    // Last 8 months for history, most-recent first
    const histCols = data.sales.slice(-HISTORY_MONTHS).reverse().map(s => ({
      label: fmtMo(s.month),
      qty: s.qty_sold,
    }));
    // Same data oldest-first for chart
    const histChart = data.sales.slice(-HISTORY_MONTHS).map(s => ({
      month: fmtMo(s.month),
      qty: s.qty_sold,
    }));

    const onHand = data.snap.on_hand_total ?? 0;
    const invValue = data.val.inv_value ?? onHand * (data.info.unit_cost ?? 0);

    // Projection
    const lastDate = data.sales.length
      ? new Date(data.sales[data.sales.length - 1].month + 'T00:00:00')
      : new Date();
    let inv3 = onHand;
    let inv6 = onHand;
    const g = growthRate / 100;
    const projRows = [];
    for (let i = 1; i <= FORECAST_MONTHS; i++) {
      const md = addMonths(lastDate, i);
      const label = `${MONTHS_SHORT[md.getMonth()]}-${String(md.getFullYear()).slice(2)}`;
      const sold3 = a3 * Math.pow(1 + g, i);
      const sold6 = a6 * Math.pow(1 + g, i);
      const recv = qtyReceived[i] ?? 0;
      inv3 = Math.max(0, inv3 + recv - sold3);
      inv6 = Math.max(0, inv6 + recv - sold6);
      projRows.push({ i, label, inv3: Math.round(inv3), inv6: Math.round(inv6), sold3: Math.round(sold3), sold6: Math.round(sold6), recv });
    }

    return { a3, a6, peak, histCols, histChart, onHand, invValue, projRows };
  }, [data, qtyReceived, growthRate]);

  if (error) return <QueryError message={error} onRetry={refetch} />;

  const info = data?.info ?? {};
  const snap = data?.snap ?? {};
  const onHand = snap.on_hand_total ?? 0;
  const onOrder = snap.on_order ?? 0;

  return (
    <div className="space-y-4">

      {/* ── Top row: SKU picker + info ── */}
      <div className="bg-card rounded-lg border border-white/[0.08] p-4">
        <div className="flex flex-wrap gap-6 items-end">

          {/* Part Number dropdown */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] text-muted font-mono uppercase tracking-wider">Part Number</label>
            <select
              value={sku ?? ''}
              onChange={e => { if (e.target.value) navigate(`/item/${e.target.value}`); }}
              className="bg-bg border border-white/[0.15] rounded px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-accent/60 min-w-[140px] cursor-pointer"
            >
              {!sku && <option value="">Select…</option>}
              {allSkus?.map(s => (
                <option key={s.sku} value={s.sku}>{s.sku}</option>
              ))}
            </select>
          </div>

          {/* Display Name */}
          <div className="flex flex-col gap-1.5 flex-1 min-w-[200px]">
            <label className="text-[10px] text-muted font-mono uppercase tracking-wider">Display Name</label>
            {loading
              ? <Skeleton className="h-8 w-64 rounded" />
              : <p className="text-white font-sans text-sm py-1.5">{info.description || '—'}</p>}
          </div>

          {/* On Hand */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] text-muted font-mono uppercase tracking-wider">Currently On Hand</label>
            {loading
              ? <Skeleton className="h-8 w-24 rounded" />
              : <p className="text-accent font-num text-2xl">{sku ? onHand.toLocaleString() : '—'}</p>}
          </div>

          {/* On Order */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] text-muted font-mono uppercase tracking-wider">Currently On Order</label>
            {loading
              ? <Skeleton className="h-8 w-24 rounded" />
              : <p className="text-slate-300 font-num text-2xl">{sku ? onOrder.toLocaleString() : '—'}</p>}
          </div>
        </div>
      </div>

      {/* ── Stats header row ── */}
      {sku && (
        <div className="bg-card rounded-lg border border-white/[0.08] overflow-x-auto">
          <div className="min-w-max">
            {/* Section label */}
            <div className="px-3 pt-2 pb-0">
              <span className="text-[10px] font-mono text-muted uppercase tracking-wider">Unit Sales per Month</span>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {(loading
                    ? Array.from({ length: HISTORY_MONTHS }).map((_, i) => `M${i}`)
                    : computed?.histCols.map(c => c.label) ?? []
                  ).map(label => (
                    <th key={label} className="px-3 py-2 text-muted font-mono font-normal text-center">{label}</th>
                  ))}
                  <th className="px-3 py-2 text-muted font-mono font-normal text-center border-l border-white/[0.08]">Avg 3m</th>
                  <th className="px-3 py-2 text-muted font-mono font-normal text-center">Avg 6m</th>
                  <th className="px-3 py-2 text-muted font-mono font-normal text-center">Largest Single Sale</th>
                  <th className="px-3 py-2 text-muted font-mono font-normal text-center">Attach Rate</th>
                  <th className="px-3 py-2 text-muted font-mono font-normal text-center">Unit Cost</th>
                  <th className="px-3 py-2 text-muted font-mono font-normal text-center">On Hand Value</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  {loading ? (
                    <td colSpan={HISTORY_MONTHS + 6} className="px-4 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ) : (
                    <>
                      {computed?.histCols.map(c => (
                        <td key={c.label} className="px-3 py-2.5 text-white font-mono text-center">{c.qty}</td>
                      ))}
                      <td className="px-3 py-2.5 text-accent font-mono text-center font-medium border-l border-white/[0.08]">
                        {computed?.a3.toFixed(1)}
                      </td>
                      <td className="px-3 py-2.5 text-accent font-mono text-center font-medium">
                        {computed?.a6.toFixed(1)}
                      </td>
                      <td className="px-3 py-2.5 text-white font-mono text-center">
                        {computed?.peak}
                      </td>
                      <td className="px-3 py-2.5 text-white font-mono text-center">
                        {info.attach_rate != null ? `${(Number(info.attach_rate) * 100).toFixed(0)}%` : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-white font-mono text-center">
                        {formatCurrency(info.unit_cost)}
                      </td>
                      <td className="px-3 py-2.5 text-success font-mono text-center font-medium">
                        {formatCurrency(computed?.invValue)}
                      </td>
                    </>
                  )}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Charts (left) + Projection panel (right) ── */}
      {sku && (
        <div className="flex gap-4 items-start flex-col xl:flex-row">

          {/* Left: charts */}
          <div className="flex-1 min-w-0 space-y-4">

            {/* Historic + Forecast 3m side by side */}
            <div className="grid md:grid-cols-2 gap-4">

              {/* Historic Sales */}
              {loading ? <ChartSkeleton height={200} /> : (
                <div className="bg-card rounded-lg border border-white/[0.08] p-4">
                  <h3 className="text-xs font-sans font-semibold text-white mb-3">Historic Sales Per Month</h3>
                  {!computed?.histChart.length ? (
                    <p className="text-muted font-mono text-xs text-center py-12">No sales data</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={computed.histChart} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
                        <CartesianGrid vertical={false} stroke="rgba(148,163,184,0.06)" />
                        <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'DM Mono' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'DM Mono' }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={TT} cursor={{ fill: 'rgba(255,255,255,0.04)' }} formatter={v => [v, 'Qty Sold']} />
                        <Bar dataKey="qty" fill="#0ea5e9" radius={[2, 2, 0, 0]} maxBarSize={40} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              )}

              {/* Forecast On Hand 3m */}
              {loading ? <ChartSkeleton height={200} /> : (
                <div className="bg-card rounded-lg border border-white/[0.08] p-4">
                  <h3 className="text-xs font-sans font-semibold text-white mb-3">Forecast On Hand (3m) EOM</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={computed?.projRows ?? []} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="rgba(148,163,184,0.06)" />
                      <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'DM Mono' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'DM Mono' }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={TT} cursor={{ fill: 'rgba(255,255,255,0.04)' }} formatter={v => [v, 'On Hand EOM']} />
                      <Bar dataKey="inv3" radius={[2, 2, 0, 0]} maxBarSize={40}>
                        {computed?.projRows.map((p, i) => (
                          <Cell key={i} fill={p.sold3 > 0 ? coverageColor(p.inv3 / p.sold3) : '#22c55e'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Forecast On Hand 6m — full width */}
            {loading ? <ChartSkeleton height={200} /> : (
              <div className="bg-card rounded-lg border border-white/[0.08] p-4">
                <h3 className="text-xs font-sans font-semibold text-white mb-3">Forecast On Hand (6m) EOM</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={computed?.projRows ?? []} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="rgba(148,163,184,0.06)" />
                    <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'DM Mono' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'DM Mono' }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={TT} cursor={{ fill: 'rgba(255,255,255,0.04)' }} formatter={v => [v, 'On Hand EOM']} />
                    <Bar dataKey="inv6" radius={[2, 2, 0, 0]} maxBarSize={40}>
                      {computed?.projRows.map((p, i) => (
                        <Cell key={i} fill={p.sold6 > 0 ? coverageColor(p.inv6 / p.sold6) : '#22c55e'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Right: Projection panel */}
          <div className="xl:w-[440px] shrink-0">
            <div className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">

              {/* Growth rate control */}
              <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-3">
                <span className="text-[10px] font-mono text-muted uppercase tracking-wider">Forecast Growth %</span>
                <div className="flex items-center gap-2 ml-auto">
                  <input
                    type="number"
                    min={-20} max={50} step={0.5}
                    value={growthRate}
                    onChange={e => setGrowthRate(Number(e.target.value))}
                    className="w-16 bg-bg border border-white/[0.12] rounded px-2 py-1 text-xs font-mono text-white text-right focus:outline-none focus:border-accent/50"
                  />
                  <span className="text-xs font-mono text-muted">% / mo</span>
                </div>
              </div>

              {/* Projection table */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      <th className="px-3 py-2.5 text-left text-muted font-mono font-normal">Month</th>
                      <th className="px-3 py-2.5 text-right text-muted font-mono font-normal">On Hand (3m)</th>
                      <th className="px-3 py-2.5 text-right text-muted font-mono font-normal">On Hand (6m)</th>
                      <th className="px-3 py-2.5 text-right text-muted font-mono font-normal">Qty Sold (3m)</th>
                      <th className="px-3 py-2.5 text-right text-muted font-mono font-normal">Qty Sold (6m)</th>
                      <th className="px-3 py-2.5 text-right text-muted font-mono font-normal">Qty Received</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading
                      ? Array.from({ length: 12 }).map((_, i) => (
                          <tr key={i} className="border-b border-white/[0.04]">
                            {Array.from({ length: 6 }).map((_, j) => (
                              <td key={j} className="px-3 py-2"><Skeleton className="h-3 w-full" /></td>
                            ))}
                          </tr>
                        ))
                      : computed?.projRows.map(row => (
                          <tr key={row.i} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                            <td className="px-3 py-2 font-mono text-slate-400">{row.label}</td>
                            <td className={`px-3 py-2 font-mono text-right font-medium ${coverageClass(row.inv3, row.sold3)}`}>
                              {row.inv3.toLocaleString()}
                            </td>
                            <td className={`px-3 py-2 font-mono text-right font-medium ${coverageClass(row.inv6, row.sold6)}`}>
                              {row.inv6.toLocaleString()}
                            </td>
                            <td className="px-3 py-2 font-mono text-right text-muted">{row.sold3.toLocaleString()}</td>
                            <td className="px-3 py-2 font-mono text-right text-muted">{row.sold6.toLocaleString()}</td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                min={0}
                                value={qtyReceived[row.i] ?? ''}
                                placeholder="0"
                                onChange={e => {
                                  const v = parseInt(e.target.value, 10);
                                  setQtyReceived(prev => ({
                                    ...prev,
                                    [row.i]: isNaN(v) ? 0 : Math.max(0, v),
                                  }));
                                }}
                                className="w-20 bg-bg border border-white/[0.12] rounded px-2 py-1 text-xs font-mono text-white text-right focus:outline-none focus:border-accent/50"
                              />
                            </td>
                          </tr>
                        ))
                    }
                  </tbody>
                </table>
              </div>

              {/* Legend */}
              <div className="px-4 py-2.5 border-t border-white/[0.06] flex items-center gap-4 text-[10px] font-mono">
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-danger inline-block" /> &lt;1mo</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-warning inline-block" /> 1–3mo</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-success inline-block" /> 3mo+</span>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* Empty state while loading SKU list with no sku param */}
      {!sku && !allSkus?.length && (
        <div className="flex items-center justify-center py-24">
          <p className="text-muted font-mono text-sm">Loading SKUs…</p>
        </div>
      )}

    </div>
  );
}
