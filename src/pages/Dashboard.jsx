import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { supabase, excludeSkus } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { KPICard } from '../components/KPICard';
import { StatusBadge } from '../components/StatusBadge';
import { CoverageCell } from '../components/CoverageCell';
import { SkuNoteBadge } from '../components/SkuNoteBadge';
import { QueryError } from '../components/QueryError';
import { KPISkeleton, TableSkeleton, ChartSkeleton } from '../components/Skeleton';
import { calcMonthsCoverage, coverageColor, formatCurrency, isValidSku } from '../utils/coverage';

// Mirrors OnOrder.jsx — POs that are not yet fully received
const ACTIVE_STATUSES = new Set([
  'Open', 'Pending', 'Partial',
  'Partially Received', 'Pending Bill',
  'Pending Billing/Partially Received',
]);

async function fetchDashboardData() {
  const [skusRes, valRes, snapshotRes, forecastRes, poRes, notesRes, salesRes] = await Promise.all([
    excludeSkus(supabase.from('skus').select('sku, description, supplier, lead_time_days')),
    excludeSkus(supabase.from('inventory_valuation').select('sku, inv_value, on_hand').order('updated_at', { ascending: false })),
    excludeSkus(supabase.from('inventory_snapshot').select('sku, on_hand_total, on_hand_portland, on_hand_hk, on_order').order('updated_at', { ascending: false })),
    excludeSkus(supabase.from('demand_forecast').select('sku, avg_3m, avg_6m, total_12m')),
    excludeSkus(supabase.from('po_history').select('*').order('created_at', { ascending: false })),
    supabase.from('sku_notes').select('sku, note, status'),
    excludeSkus(supabase.from('monthly_sales').select('sku, month').gt('qty_sold', 0).order('month', { ascending: false })),
  ]);

  for (const r of [skusRes, valRes, snapshotRes, forecastRes, poRes]) {
    if (r.error) throw new Error(r.error.message);
  }

  return {
    skus: skusRes.data,
    valuation: valRes.data,
    snapshot: snapshotRes.data,
    forecast: forecastRes.data,
    openPOs: poRes.data,
    notes: notesRes.data ?? [],
    sales: salesRes.data ?? [],
  };
}

function formatSaleMonth(isoDate) {
  if (!isoDate) return 'Never';
  const [y, m] = isoDate.split('-');
  return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m - 1]} ${y}`;
}

function buildCoverageMap(skus, snapshot, forecast) {
  const latestSnapshot = {};
  for (const s of snapshot) {
    if (!latestSnapshot[s.sku]) latestSnapshot[s.sku] = s;
  }
  const demandMap = Object.fromEntries(forecast.map(f => [f.sku, f]));

  return skus.map(sku => {
    const snap = latestSnapshot[sku.sku];
    const fc = demandMap[sku.sku];
    const avg3 = fc?.avg_3m ?? 0;
    const avgSales = fc?.avg_6m ?? 0;
    const total12 = fc?.total_12m ?? 0;
    const consumed6 = avgSales * 6;
    const onHand = snap?.on_hand_total ?? 0;
    const portland = snap?.on_hand_portland ?? 0;
    const hk = snap?.on_hand_hk ?? 0;
    const onOrder = snap?.on_order ?? 0;
    const months = calcMonthsCoverage(onHand, avgSales);
    const monthsPortland = calcMonthsCoverage(portland, avgSales);
    const monthsHk = calcMonthsCoverage(hk, avgSales);
    const monthsWithOrder = calcMonthsCoverage(onHand + onOrder, avgSales);
    const monthsPortlandWithOrder = calcMonthsCoverage(portland + onOrder, avgSales);
    const monthsHkWithOrder = calcMonthsCoverage(hk + onOrder, avgSales);
    return {
      ...sku,
      onHand, onOrder, avgSales, avg3, consumed6, total12,
      months, monthsPortland, monthsHk,
      monthsWithOrder, monthsPortlandWithOrder, monthsHkWithOrder,
    };
  });
}

const CHART_TOOLTIP_STYLE = {
  backgroundColor: '#162030',
  border: '1px solid rgba(148,163,184,0.12)',
  borderRadius: 6,
  fontSize: 12,
  fontFamily: 'DM Mono, monospace',
  color: '#e2e8f0',
};

function CoverageTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={CHART_TOOLTIP_STYLE} className="px-3 py-2">
      <p className="font-sans text-white text-xs mb-1">{d.sku}</p>
      <p className="font-mono text-xs">
        {isFinite(d.months) ? `${d.months.toFixed(1)} mo` : '∞'} coverage
      </p>
      <p className="font-mono text-xs text-muted">{d.onHand} on hand</p>
    </div>
  );
}

function ProjectedCoverageCell({ months, monthsWithOrder, onOrder }) {
  if (onOrder <= 0) return <CoverageCell months={months} />;
  const delta = isFinite(monthsWithOrder) ? monthsWithOrder - (isFinite(months) ? months : 0) : null;
  return (
    <div className="space-y-0.5">
      <CoverageCell months={months} />
      {delta !== null && (
        <div className="text-[10px] font-mono text-success leading-none">
          +{delta.toFixed(1)} mo w/ order
        </div>
      )}
    </div>
  );
}

export function Dashboard() {
  const { data, loading, error, refetch } = useQuery(fetchDashboardData, []);

  const { kpis, urgentItems, chartData, totalValue, notesBySku, openPOs, dormantItems } = useMemo(() => {
    if (!data) return {};

    const coverage = buildCoverageMap(data.skus.filter(s => isValidSku(s.sku)), data.snapshot, data.forecast);

    const urgent = coverage.filter(s => isFinite(s.months) && s.months < 1 && s.total12 > 0);
    const watchList = coverage.filter(s => isFinite(s.months) && s.months >= 1 && s.months < 3 && s.total12 > 0);
    const needsReorder = coverage.filter(s => isFinite(s.months) && s.months < 3 && s.total12 > 0);
    const reorderSkus = new Set(needsReorder.map(s => s.sku));

    const latestValBySku = {};
    for (const v of data.valuation) {
      if (!latestValBySku[v.sku]) latestValBySku[v.sku] = v;
    }
    const totalValue = Object.values(latestValBySku).reduce((s, v) => s + (v.inv_value ?? 0), 0);

    const chartData = coverage
      .filter(s => isFinite(s.months))
      .sort((a, b) => a.months - b.months)
      .slice(0, 30);

    const notesBySku = Object.fromEntries((data.notes ?? []).map(n => [n.sku, n]));

    const skuMap = Object.fromEntries(data.skus.map(s => [s.sku, s]));

    const openPOs = (data.openPOs ?? [])
      .filter(po => ACTIVE_STATUSES.has(po.status) || po.status?.includes('Pending'))
      .map(po => ({ ...po, description: skuMap[po.sku]?.description ?? null }));

    // Last sale month per SKU (sales already ordered desc, qty_sold > 0)
    const lastSaleBySkuMap = {};
    for (const s of data.sales) {
      if (!lastSaleBySkuMap[s.sku]) lastSaleBySkuMap[s.sku] = s.month;
    }

    const dormantItems = coverage
      .filter(s =>
        s.onHand > 0 &&
        (s.avg3 === 0 || s.avgSales * 6 < 2) &&
        !reorderSkus.has(s.sku)
      )
      .map(s => ({
        ...s,
        invValue: latestValBySku[s.sku]?.inv_value ?? 0,
        lastSaleMonth: lastSaleBySkuMap[s.sku] ?? null,
        noteData: notesBySku[s.sku] ?? null,
      }))
      .sort((a, b) => b.invValue - a.invValue);

    return {
      kpis: { urgent: urgent.length, watchList: watchList.length, total: data.skus.length },
      urgentItems: needsReorder.sort((a, b) => a.months - b.months),
      chartData,
      totalValue,
      notesBySku,
      openPOs,
      dormantItems,
    };
  }, [data]);

  if (error) return <QueryError message={error} onRetry={refetch} />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-sans font-semibold text-white">Dashboard</h1>
        <p className="text-xs text-muted font-mono mt-0.5">Inventory overview</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <KPISkeleton key={i} />)
        ) : (
          <>
            <KPICard
              label="Urgent Reorder"
              value={kpis.urgent}
              sub="< 1 month coverage"
              color="text-danger"
            />
            <KPICard
              label="Watch List"
              value={kpis.watchList}
              sub="1–3 months coverage"
              color="text-warning"
            />
            <KPICard
              label="Total SKUs"
              value={kpis.total}
              sub="active"
              accent
            />
            <KPICard
              label="Inventory Value"
              value={formatCurrency(totalValue)}
              sub="on hand"
              color="text-success"
            />
          </>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Urgent items table */}
        {loading ? (
          <TableSkeleton rows={5} cols={5} />
        ) : (
          <div className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
            <div className="px-4 py-3 border-b border-white/[0.08] flex items-center justify-between">
              <h2 className="text-sm font-sans font-semibold text-white">Needs Reorder</h2>
              <span className="text-xs font-mono text-danger">{urgentItems?.length ?? 0} SKUs &lt; 3 mo</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    {['SKU', 'Description', 'On Hand', 'On Order', 'Consumed (6m)', 'Total Mo', 'PDX Mo', 'HK Mo', 'Supplier'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {urgentItems?.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-6 text-center text-muted font-mono">No items need reordering</td>
                    </tr>
                  ) : urgentItems?.map(item => (
                    <tr
                      key={item.sku}
                      className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors"
                      style={item.onOrder > 0 ? { backgroundColor: 'rgba(34,197,94,0.05)' } : undefined}
                    >
                      <td className="px-4 py-3">
                        <Link to={`/item/${item.sku}`} className="font-mono text-accent hover:text-accent/80 transition-colors">
                          {item.sku}
                        </Link>
                        {item.onOrder > 0 && (
                          <div className="mt-0.5">
                            <span className="inline-block text-[10px] font-mono px-1.5 py-0.5 rounded bg-success/15 text-success leading-none">
                              +{item.onOrder.toLocaleString()} on order
                            </span>
                          </div>
                        )}
                        {notesBySku?.[item.sku] && (
                          <div className="mt-0.5">
                            <SkuNoteBadge noteData={notesBySku[item.sku]} />
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-300 font-sans max-w-[200px] truncate" title={item.description}>{item.description}</td>
                      <td className="px-4 py-3 font-mono text-white">{item.onHand.toLocaleString()}</td>
                      <td className="px-4 py-3 font-mono">
                        {item.onOrder > 0
                          ? <span className="text-success">{item.onOrder.toLocaleString()}</span>
                          : <span className="text-muted">—</span>
                        }
                      </td>
                      <td className="px-4 py-3 font-mono">
                        <span className="text-white">{item.consumed6.toLocaleString()}</span>
                        <div className="text-xs text-muted">{item.avgSales.toFixed(0)}/mo</div>
                      </td>
                      <td className="px-4 py-3">
                        <ProjectedCoverageCell months={item.months} monthsWithOrder={item.monthsWithOrder} onOrder={item.onOrder} />
                      </td>
                      <td className="px-4 py-3">
                        <ProjectedCoverageCell months={item.monthsPortland} monthsWithOrder={item.monthsPortlandWithOrder} onOrder={item.onOrder} />
                      </td>
                      <td className="px-4 py-3">
                        <ProjectedCoverageCell months={item.monthsHk} monthsWithOrder={item.monthsHkWithOrder} onOrder={item.onOrder} />
                      </td>
                      <td className="px-4 py-3 text-muted font-sans max-w-[130px] truncate" title={item.supplier}>{item.supplier}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Open POs table */}
        {loading ? (
          <TableSkeleton rows={5} cols={5} />
        ) : (
          <div className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
            <div className="px-4 py-3 border-b border-white/[0.08] flex items-center justify-between">
              <h2 className="text-sm font-sans font-semibold text-white">Open Purchase Orders</h2>
              <span className="text-xs font-mono text-accent">{openPOs?.length ?? 0} open</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    {['PO #', 'SKU', 'Description', 'Vendor', 'Qty', 'Value', 'Status'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {openPOs?.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-muted font-mono">No open POs</td>
                    </tr>
                  ) : openPOs?.map(po => (
                    <tr key={po.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-2.5 font-mono text-slate-300">{po.po_number}</td>
                      <td className="px-4 py-2.5">
                        <Link to={`/item/${po.sku}`} className="font-mono text-accent hover:text-accent/80">
                          {po.sku}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-slate-300 font-sans max-w-[180px] truncate" title={po.description ?? undefined}>
                        {po.description ?? <span className="text-muted">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-muted font-sans">{po.vendor}</td>
                      <td className="px-4 py-2.5 font-mono text-white">{(po.qty_ordered ?? 0).toLocaleString()}</td>
                      <td className="px-4 py-2.5 font-mono text-white">{formatCurrency((po.qty_ordered ?? 0) * (po.unit_cost ?? 0))}</td>
                      <td className="px-4 py-2.5"><StatusBadge status={po.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Dormant Stock */}
      {loading ? <TableSkeleton rows={4} cols={6} /> : dormantItems?.length > 0 && (
        <div className="bg-card rounded-lg border border-amber-500/20 overflow-hidden">
          <div className="px-4 py-3 border-b border-amber-500/15 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-sans font-semibold text-amber-400">Dormant Stock</h2>
              <p className="text-[10px] font-mono text-muted mt-0.5">Low activity · not ordered recently</p>
            </div>
            <span className="text-xs font-mono text-amber-400/70">{dormantItems.length} SKUs</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {['SKU', 'Description', 'On Hand', 'On Hand Value', 'Last Sale', 'Note'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dormantItems.map(item => (
                  <tr key={item.sku} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-2.5">
                      <Link to={`/item/${item.sku}`} className="font-mono text-accent hover:text-accent/80">{item.sku}</Link>
                    </td>
                    <td className="px-4 py-2.5 text-slate-300 font-sans max-w-[200px] truncate" title={item.description}>{item.description}</td>
                    <td className="px-4 py-2.5 font-mono text-white">{item.onHand.toLocaleString()}</td>
                    <td className="px-4 py-2.5 font-mono text-amber-400/80">{formatCurrency(item.invValue)}</td>
                    <td className="px-4 py-2.5 font-mono text-muted">{formatSaleMonth(item.lastSaleMonth)}</td>
                    <td className="px-4 py-2.5">
                      {item.noteData
                        ? <SkuNoteBadge noteData={item.noteData} />
                        : <span className="text-muted font-mono">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 border-t border-white/[0.06]">
            <p className="text-[10px] text-muted font-mono">{dormantItems.length} SKUs with stock but ≤1 unit/mo avg</p>
          </div>
        </div>
      )}

      {/* Stock coverage bar chart */}
      {loading ? (
        <ChartSkeleton height={220} />
      ) : (
        <div className="bg-card rounded-lg border border-white/[0.08] p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-sans font-semibold text-white">Stock Coverage by SKU</h2>
            <div className="flex items-center gap-4 text-[10px] font-mono">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-danger inline-block" /> &lt; 1 mo</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-warning inline-block" /> 1–3 mo</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-success inline-block" /> 3+ mo</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="rgba(148,163,184,0.06)" />
              <XAxis
                dataKey="sku"
                tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'DM Mono' }}
                axisLine={false}
                tickLine={false}
                interval={0}
                angle={-45}
                textAnchor="end"
                height={45}
              />
              <YAxis
                tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'DM Mono' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={v => `${v}mo`}
              />
              <Tooltip content={<CoverageTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <Bar dataKey="months" radius={[2, 2, 0, 0]} maxBarSize={32}>
                {chartData?.map((entry, i) => (
                  <Cell key={i} fill={coverageColor(entry.months)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
