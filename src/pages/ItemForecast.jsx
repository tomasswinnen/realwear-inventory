import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { SearchableSelect } from '../components/SearchableSelect';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, Cell, ReferenceLine, ReferenceArea,
} from 'recharts';
import { supabase, excludeSkus } from '../lib/supabase';
import { SkuNoteBadge } from '../components/SkuNoteBadge';
import { useQuery } from '../hooks/useQuery';
import { formatCurrency } from '../utils/coverage';
import { QueryError } from '../components/QueryError';
import { Skeleton } from '../components/Skeleton';

// ─── constants ────────────────────────────────────────────────────────────────
const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const HISTORY_MONTHS = 8;
const FORECAST_MONTHS = 12;
const GROWTH_DEFAULT = 2.5;

// ─── utilities ────────────────────────────────────────────────────────────────
function fmtMo(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${MO[d.getMonth()]}-${String(d.getFullYear()).slice(2)}`;
}
function addMonths(d, n) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function mean(arr) {
  const valid = arr.filter(v => v != null && !isNaN(v));
  if (!valid.length) return 0;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}
function itemCoverageClass(months) {
  if (!isFinite(months) || months > 6) return 'text-success';
  if (months >= 3) return 'text-warning';
  return 'text-danger';
}
function fmtNum(v) {
  if (v == null || isNaN(v) || !isFinite(v)) return '—';
  if (v < 0) return `(${Math.abs(v).toLocaleString()})`;
  return v.toLocaleString();
}

// ─── local components ─────────────────────────────────────────────────────────
function MetricCard({ label, value, valueClass = 'text-white', sub, loading }) {
  return (
    <div className="rounded-xl p-5 space-y-2" style={{ background: '#0d1a27', border: '1px solid rgba(148,163,184,0.1)' }}>
      <p className="text-[11px] font-sans font-medium text-slate-500 uppercase tracking-widest leading-none">
        {label}
      </p>
      {loading
        ? <Skeleton className="h-7 w-24 rounded" />
        : <p className={`text-[1.625rem] font-num leading-none ${valueClass}`}>{value ?? '—'}</p>
      }
      {sub && !loading && (
        <p className="text-[10px] font-mono text-slate-600">{sub}</p>
      )}
    </div>
  );
}

function ChartCard({ title, subtitle, height = 220, children, loading }) {
  return (
    <div className="rounded-xl p-5" style={{ background: '#162030', border: '1px solid rgba(148,163,184,0.08)' }}>
      <div className="mb-4">
        <h3 className="text-sm font-sans font-semibold text-white">{title}</h3>
        {subtitle && <p className="text-[11px] font-mono text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {loading
        ? <Skeleton className="w-full rounded-lg" style={{ height }} />
        : children
      }
    </div>
  );
}

// ─── custom tooltips ──────────────────────────────────────────────────────────
const TT_STYLE = {
  backgroundColor: '#0d1a27',
  border: '1px solid rgba(148,163,184,0.14)',
  borderRadius: 8,
  fontSize: 11,
  fontFamily: 'DM Mono, monospace',
  padding: '8px 12px',
  color: '#e2e8f0',
};

function HistoricTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={TT_STYLE}>
      <p className="text-slate-400 text-[10px] mb-1">{label}</p>
      <p className="text-white font-medium">{fmtNum(payload[0]?.value)} units</p>
    </div>
  );
}

function ForecastTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={TT_STYLE}>
      <p className="text-slate-400 text-[10px] mb-2">{label}</p>
      {payload.map(p => (
        <div key={p.dataKey} className="flex items-center justify-between gap-6">
          <span style={{ color: p.color }} className="text-[10px]">{p.name}</span>
          <span className={p.value < 0 ? 'text-danger font-medium' : 'text-white'}>
            {fmtNum(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── supabase queries ─────────────────────────────────────────────────────────
async function fetchAllSkus() {
  const { data, error } = await excludeSkus(supabase.from('skus').select('sku, description').order('sku'));
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function fetchItem(sku) {
  const [skuRes, snapRes, salesRes, valRes, noteRes] = await Promise.all([
    supabase.from('skus').select('*').eq('sku', sku).maybeSingle(),
    supabase.from('inventory_snapshot').select('*').eq('sku', sku)
      .order('updated_at', { ascending: false }).limit(1),
    supabase.from('monthly_sales').select('month, qty_sold').eq('sku', sku)
      .order('month', { ascending: true }),
    supabase.from('inventory_valuation').select('on_hand, inv_value').eq('sku', sku)
      .order('updated_at', { ascending: false }).limit(1),
    supabase.from('sku_notes').select('note, status').eq('sku', sku).maybeSingle(),
  ]);
  for (const r of [skuRes, snapRes, salesRes, valRes]) {
    if (r.error) throw new Error(r.error.message);
  }
  return {
    info: skuRes.data ?? {},
    snap: snapRes.data?.[0] ?? {},
    sales: salesRes.data ?? [],
    val: valRes.data?.[0] ?? {},
    note: noteRes.data ?? null,
  };
}

// ─── main component ───────────────────────────────────────────────────────────
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

  useEffect(() => {
    if (!sku && allSkus?.length) navigate(`/item/${allSkus[0].sku}`, { replace: true });
  }, [sku, allSkus, navigate]);

  useEffect(() => { setQtyReceived({}); }, [sku]);

  const computed = useMemo(() => {
    if (!data) return null;
    const salesQty = data.sales.map(s => s.qty_sold);
    const a3 = mean(salesQty.slice(-3));
    const a6 = mean(salesQty.slice(-6));
    const peak = salesQty.length ? Math.max(...salesQty) : 0;

    const onHand = data.snap.on_hand_total ?? 0;
    const portland = data.snap.on_hand_portland ?? 0;
    const hk = data.snap.on_hand_hk ?? 0;
    const coverage = a6 > 0 ? onHand / a6 : Infinity;
    const coveragePortland = a6 > 0 ? portland / a6 : Infinity;
    const coverageHk = a6 > 0 ? hk / a6 : Infinity;
    const invValue = data.val.inv_value ?? onHand * (data.info.unit_cost ?? 0);

    // Historic chart — last 8 months oldest→newest
    const histSlice = data.sales.slice(-HISTORY_MONTHS);
    const histMax = histSlice.length ? Math.max(...histSlice.map(s => s.qty_sold)) : 0;
    const histChart = histSlice.map(s => ({
      month: fmtMo(s.month),
      qty: s.qty_sold,
      isMax: s.qty_sold === histMax,
    }));

    // Projection — unclamped so negatives show in chart & table
    const lastDate = data.sales.length
      ? new Date(data.sales[data.sales.length - 1].month + 'T00:00:00')
      : new Date();
    const g = growthRate / 100;
    let inv3 = onHand;
    let inv6 = onHand;
    const projRows = [];
    for (let i = 1; i <= FORECAST_MONTHS; i++) {
      const md = addMonths(lastDate, i);
      const label = `${MO[md.getMonth()]}-${String(md.getFullYear()).slice(2)}`;
      const sold3 = a3 * Math.pow(1 + g, i);
      const sold6 = a6 * Math.pow(1 + g, i);
      const recv = qtyReceived[i] ?? 0;
      inv3 = inv3 + recv - sold3; // unclamped
      inv6 = inv6 + recv - sold6;
      projRows.push({ i, label, inv3: Math.round(inv3), inv6: Math.round(inv6), sold3: Math.round(sold3), sold6: Math.round(sold6), recv });
    }

    const projMin = Math.min(0, ...projRows.flatMap(r => [r.inv3, r.inv6]));

    return { a3, a6, peak, coverage, coveragePortland, coverageHk, portland, hk, invValue, histChart, histMax, projRows, projMin };
  }, [data, qtyReceived, growthRate]);

  if (error) return <QueryError message={error} onRetry={refetch} />;

  const info = data?.info ?? {};
  const snap = data?.snap ?? {};
  const onHand = snap.on_hand_total ?? 0;
  const onOrder = snap.on_order ?? 0;

  // KPI card definitions
  const kpis = [
    {
      label: 'On Hand',
      value: sku && !loading ? onHand.toLocaleString() : null,
      valueClass: 'text-accent',
    },
    {
      label: 'Portland (PDX)',
      value: computed ? computed.portland.toLocaleString() : null,
      valueClass: computed ? itemCoverageClass(computed.coveragePortland) : 'text-white',
      sub: computed
        ? (isFinite(computed.coveragePortland) ? `${computed.coveragePortland.toFixed(1)} months` : '∞ months')
        : null,
    },
    {
      label: 'Hong Kong (HK)',
      value: computed ? computed.hk.toLocaleString() : null,
      valueClass: computed ? itemCoverageClass(computed.coverageHk) : 'text-white',
      sub: computed
        ? (isFinite(computed.coverageHk) ? `${computed.coverageHk.toFixed(1)} months` : '∞ months')
        : null,
    },
    {
      label: 'On Order',
      value: sku && !loading ? onOrder.toLocaleString() : null,
      valueClass: 'text-slate-300',
    },
    {
      label: 'Avg / mo (3m)',
      value: computed ? computed.a3.toFixed(1) : null,
      valueClass: 'text-white',
    },
    {
      label: 'Avg / mo (6m)',
      value: computed ? computed.a6.toFixed(1) : null,
      valueClass: 'text-white',
    },
    {
      label: 'Coverage',
      value: computed
        ? (!isFinite(computed.coverage) ? '∞' : computed.coverage.toFixed(1) + ' mo')
        : null,
      valueClass: computed ? itemCoverageClass(computed.coverage) : 'text-white',
      sub: 'based on 6m avg',
    },
    {
      label: 'Largest Monthly Sale',
      value: computed ? computed.peak.toLocaleString() : null,
      valueClass: 'text-white',
      sub: 'units in a month',
    },
    {
      label: 'Unit Cost',
      value: computed ? formatCurrency(info.unit_cost) : null,
      valueClass: 'text-white',
    },
    {
      label: 'On Hand Value',
      value: computed ? formatCurrency(computed.invValue) : null,
      valueClass: 'text-success',
    },
  ];

  return (
    <div className="space-y-5">

      {/* ── Header bar ── */}
      <div className="flex items-end gap-4 flex-wrap">
        {/* SKU picker */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-sans font-medium text-slate-500 uppercase tracking-widest">
            SKU
          </label>
          <SearchableSelect
            value={sku ?? ''}
            onChange={v => { if (v) navigate(`/item/${v}`); }}
            options={(allSkus ?? []).map(s => ({ value: s.sku, label: s.sku, description: s.description ?? undefined }))}
            placeholder="Select SKU…"
            className="min-w-[160px]"
          />
        </div>

        {/* Display name */}
        <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
          <label className="text-[10px] font-sans font-medium text-slate-500 uppercase tracking-widest">
            Display Name
          </label>
          {loading
            ? <Skeleton className="h-9 w-72 rounded-lg" />
            : <>
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-white font-sans text-sm py-2 leading-tight">{info.description || '—'}</p>
                  <SkuNoteBadge noteData={data?.note} />
                </div>
                {data?.note?.note && (
                  <p className="text-xs text-muted font-sans italic">{data.note.note}</p>
                )}
              </>
          }
        </div>

        {/* Growth rate — pushed right */}
        {sku && (
          <div
            className="flex items-center gap-3 rounded-xl px-4 py-3 ml-auto"
            style={{ background: '#0d1a27', border: '1px solid rgba(148,163,184,0.1)' }}
          >
            <span className="text-[10px] font-sans font-medium text-slate-500 uppercase tracking-widest whitespace-nowrap">
              Forecast Growth
            </span>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={-20} max={50} step={0.5}
                value={growthRate}
                onChange={e => setGrowthRate(Number(e.target.value))}
                className="w-14 rounded-md px-2 py-1 text-sm font-mono text-white text-right focus:outline-none focus:ring-1 focus:ring-accent/40"
                style={{ background: '#162030', border: '1px solid rgba(148,163,184,0.12)' }}
              />
              <span className="text-sm font-mono text-slate-400">%&thinsp;/&thinsp;mo</span>
            </div>
          </div>
        )}
      </div>

      {/* ── KPI grid: 4 × 2 ── */}
      {sku && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {kpis.map(k => (
            <MetricCard key={k.label} loading={loading || !computed} {...k} />
          ))}
        </div>
      )}

      {/* ── Monthly sales history strip ── */}
      {sku && (
        <div className="rounded-xl overflow-hidden" style={{ background: '#162030', border: '1px solid rgba(148,163,184,0.08)' }}>
          <div className="px-5 py-3 border-b" style={{ borderColor: 'rgba(148,163,184,0.08)' }}>
            <h3 className="text-xs font-sans font-semibold text-slate-400 uppercase tracking-widest">
              Units Sold — Last {HISTORY_MONTHS} Months
            </h3>
          </div>
          <div className="overflow-x-auto">
            {loading || !computed ? (
              <div className="flex gap-px">
                {Array.from({ length: HISTORY_MONTHS }).map((_, i) => (
                  <div key={i} className="flex-1 min-w-[72px] px-3 py-3 space-y-2">
                    <Skeleton className="h-3 rounded w-10 mx-auto" />
                    <Skeleton className="h-6 rounded w-8 mx-auto" />
                  </div>
                ))}
              </div>
            ) : (computed.histChart.length === 0 ? (
              <p className="text-slate-600 font-mono text-xs text-center py-4">No sales data</p>
            ) : (
              <div className="flex">
                {/* newest-first order */}
                {[...computed.histChart].reverse().map((d, i) => (
                  <div
                    key={d.month}
                    className="flex-1 min-w-[72px] flex flex-col items-center py-3 px-2"
                    style={{
                      borderRight: i < computed.histChart.length - 1 ? '1px solid rgba(148,163,184,0.06)' : 'none',
                      background: d.isMax ? 'rgba(14,165,233,0.07)' : 'transparent',
                    }}
                  >
                    <span className="text-[10px] font-mono text-slate-500 whitespace-nowrap mb-1.5">
                      {d.month}
                    </span>
                    <span className={`text-base font-num font-semibold leading-none ${d.isMax ? 'text-accent' : 'text-white'}`}>
                      {(d.qty ?? 0).toLocaleString()}
                    </span>
                    {d.isMax && (
                      <span className="text-[9px] font-mono text-accent/60 mt-1">peak</span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Main: charts + projection ── */}
      {sku && (
        <div className="flex gap-4 items-start flex-col xl:flex-row">

          {/* Charts column */}
          <div className="flex-1 min-w-0 space-y-4">

            {/* Historic Sales */}
            <ChartCard
              title="Historic Sales Per Month"
              subtitle={`Last ${HISTORY_MONTHS} months · highest bar highlighted`}
              height={220}
              loading={loading || !computed}
            >
              {(computed?.histChart?.length ?? 0) === 0 ? (
                <p className="text-slate-600 font-mono text-xs text-center py-16">No sales data</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={computed?.histChart ?? []}
                    margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
                    barCategoryGap="28%"
                  >
                    <CartesianGrid vertical={false} stroke="rgba(148,163,184,0.05)" />
                    <XAxis
                      dataKey="month"
                      tick={{ fill: '#64748b', fontSize: 11, fontFamily: 'DM Mono' }}
                      axisLine={false} tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: '#64748b', fontSize: 11, fontFamily: 'DM Mono' }}
                      axisLine={false} tickLine={false}
                    />
                    <Tooltip content={<HistoricTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                    <Bar dataKey="qty" radius={[3, 3, 0, 0]}>
                      {(computed?.histChart ?? []).map((d, i) => (
                        <Cell
                          key={i}
                          fill="#0ea5e9"
                          fillOpacity={d.isMax ? 1 : 0.28}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            {/* Combined 3m + 6m forecast */}
            <ChartCard
              title="12-Month On-Hand Forecast — EOM"
              subtitle="3m avg model (blue)  ·  6m avg model (amber)  ·  red zone = stockout"
              height={240}
              loading={loading || !computed}
            >
              <ResponsiveContainer width="100%" height={240}>
                <LineChart
                  data={computed?.projRows ?? []}
                  margin={{ top: 8, right: 24, left: -16, bottom: 0 }}
                >
                  <CartesianGrid vertical={false} stroke="rgba(148,163,184,0.05)" />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: '#64748b', fontSize: 11, fontFamily: 'DM Mono' }}
                    axisLine={false} tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: '#64748b', fontSize: 11, fontFamily: 'DM Mono' }}
                    axisLine={false} tickLine={false}
                  />
                  <Tooltip content={<ForecastTooltip />} cursor={{ stroke: 'rgba(148,163,184,0.15)', strokeWidth: 1 }} />
                  <Legend
                    wrapperStyle={{ fontSize: 11, fontFamily: 'DM Mono', color: '#64748b', paddingTop: 12 }}
                  />
                  {/* Red zone below stockout */}
                  {computed?.projMin < 0 && (
                    <ReferenceArea
                      y1={Math.floor(computed.projMin * 1.25)}
                      y2={0}
                      fill="rgba(239,68,68,0.07)"
                      fillOpacity={1}
                    />
                  )}
                  {/* Stockout line */}
                  <ReferenceLine
                    y={0}
                    stroke="#ef4444"
                    strokeDasharray="5 3"
                    strokeWidth={1.5}
                    label={{
                      value: 'Stockout',
                      position: 'insideTopRight',
                      fill: '#ef4444',
                      fontSize: 10,
                      fontFamily: 'DM Mono',
                      dx: -4,
                      dy: 4,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="inv3"
                    name="On Hand (3m)"
                    stroke="#0ea5e9"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: '#0ea5e9', stroke: '#0d1a27', strokeWidth: 2 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="inv6"
                    name="On Hand (6m)"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: '#f59e0b', stroke: '#0d1a27', strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* ── Projection panel ── */}
          <div className="xl:w-[500px] shrink-0">
            <div
              className="rounded-xl overflow-hidden"
              style={{ background: '#162030', border: '1px solid rgba(148,163,184,0.08)' }}
            >
              {/* Panel header */}
              <div
                className="px-5 py-4 border-b"
                style={{ borderColor: 'rgba(148,163,184,0.08)' }}
              >
                <h3 className="text-sm font-sans font-semibold text-white">Monthly Projection</h3>
                <p className="text-[11px] font-mono text-slate-500 mt-0.5">
                  Edit Qty Received to simulate incoming stock — recalculates live
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(148,163,184,0.08)' }}>
                      {['Month', 'On Hand (3m)', 'On Hand (6m)', 'Sold (3m)', 'Sold (6m)', 'Qty Received'].map(h => (
                        <th
                          key={h}
                          className="px-4 py-3 text-left text-[10px] font-sans font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loading
                      ? Array.from({ length: 12 }).map((_, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid rgba(148,163,184,0.05)' }}>
                            {Array.from({ length: 6 }).map((_, j) => (
                              <td key={j} className="px-4 py-3">
                                <Skeleton className="h-3 rounded" style={{ width: j === 5 ? 64 : '80%' }} />
                              </td>
                            ))}
                          </tr>
                        ))
                      : computed?.projRows.map(row => {
                          const isNeg = row.inv3 < 0 || row.inv6 < 0;
                          return (
                            <tr
                              key={row.i}
                              style={{
                                borderBottom: '1px solid rgba(148,163,184,0.05)',
                                backgroundColor: isNeg ? 'rgba(239,68,68,0.07)' : 'transparent',
                              }}
                              className="transition-colors hover:brightness-110"
                            >
                              <td className="px-4 py-3 font-mono text-slate-400 whitespace-nowrap">
                                {row.label}
                              </td>
                              <td className={`px-4 py-3 font-mono text-right font-medium ${row.inv3 < 0 ? 'text-danger' : row.inv3 === 0 ? 'text-warning' : 'text-success'}`}>
                                {fmtNum(row.inv3)}
                              </td>
                              <td className={`px-4 py-3 font-mono text-right font-medium ${row.inv6 < 0 ? 'text-danger' : row.inv6 === 0 ? 'text-warning' : 'text-success'}`}>
                                {fmtNum(row.inv6)}
                              </td>
                              <td className="px-4 py-3 font-mono text-right text-slate-500">
                                {fmtNum(row.sold3)}
                              </td>
                              <td className="px-4 py-3 font-mono text-right text-slate-500">
                                {fmtNum(row.sold6)}
                              </td>
                              <td className="px-4 py-3">
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
                                  className="w-full rounded-md px-3 py-1.5 text-xs font-mono text-white text-right placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-accent/40 transition-colors"
                                  style={{
                                    background: '#0f1923',
                                    border: '1px solid rgba(148,163,184,0.15)',
                                  }}
                                />
                              </td>
                            </tr>
                          );
                        })
                    }
                  </tbody>
                </table>
              </div>

              {/* Legend */}
              <div
                className="px-5 py-3 flex items-center gap-5 border-t"
                style={{ borderColor: 'rgba(148,163,184,0.08)' }}
              >
                <span className="flex items-center gap-1.5 text-[10px] font-mono text-slate-500">
                  <span className="w-2 h-2 rounded-full bg-success inline-block shrink-0" />
                  Healthy
                </span>
                <span className="flex items-center gap-1.5 text-[10px] font-mono text-slate-500">
                  <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ background: '#f59e0b' }} />
                  Zero stock
                </span>
                <span className="flex items-center gap-1.5 text-[10px] font-mono text-slate-500">
                  <span className="w-2 h-2 rounded-full bg-danger inline-block shrink-0" />
                  Stockout
                </span>
                <span className="text-[10px] font-mono text-slate-600 ml-auto">
                  Negative shown as (n)
                </span>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* Empty state */}
      {!sku && !allSkus?.length && (
        <div className="flex items-center justify-center py-32">
          <p className="text-slate-600 font-mono text-sm">Loading SKUs…</p>
        </div>
      )}

    </div>
  );
}
