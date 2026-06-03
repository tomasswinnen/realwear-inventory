import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { supabase } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { KPICard } from '../components/KPICard';
import { StatusBadge } from '../components/StatusBadge';
import { CoverageCell } from '../components/CoverageCell';
import { QueryError } from '../components/QueryError';
import { KPISkeleton, TableSkeleton, ChartSkeleton } from '../components/Skeleton';
import { calcMonthsCoverage, coverageColor, formatCurrency, isValidSku } from '../utils/coverage';

async function fetchDashboardData() {
  const [skusRes, valRes, snapshotRes, salesRes, poRes] = await Promise.all([
    supabase.from('skus').select('sku, description, supplier, lead_time_days'),
    supabase.from('inventory_valuation').select('sku, inv_value, on_hand').order('updated_at', { ascending: false }),
    supabase.from('inventory_snapshot').select('sku, on_hand_total, on_hand_portland, on_hand_hk, on_order').order('updated_at', { ascending: false }),
    supabase.from('monthly_sales').select('sku, qty_sold, month').order('month', { ascending: false }),
    supabase.from('po_history').select('*').eq('status', 'Open').order('created_at', { ascending: false }),
  ]);

  for (const r of [skusRes, valRes, snapshotRes, salesRes, poRes]) {
    if (r.error) throw new Error(r.error.message);
  }

  return {
    skus: skusRes.data,
    valuation: valRes.data,
    snapshot: snapshotRes.data,
    sales: salesRes.data,
    openPOs: poRes.data,
  };
}

function buildCoverageMap(skus, snapshot, sales) {
  const latestSnapshot = {};
  for (const s of snapshot) {
    if (!latestSnapshot[s.sku]) latestSnapshot[s.sku] = s;
  }

  const salesBySku = {};
  for (const s of sales) {
    if (!salesBySku[s.sku]) salesBySku[s.sku] = [];
    salesBySku[s.sku].push(s.qty_sold);
  }

  return skus.map(sku => {
    const snap = latestSnapshot[sku.sku];
    const skuSales = salesBySku[sku.sku] ?? [];
    const last3 = skuSales.slice(0, 3);
    const last6 = skuSales.slice(0, 6);
    const avg3 = last3.length ? last3.reduce((a, b) => a + b, 0) / last3.length : 0;
    const avgSales = last6.length ? last6.reduce((a, b) => a + b, 0) / last6.length : 0;
    const onHand = snap?.on_hand_total ?? 0;
    const portland = snap?.on_hand_portland ?? 0;
    const hk = snap?.on_hand_hk ?? 0;
    const months = calcMonthsCoverage(onHand, avg3);
    const monthsPortland = calcMonthsCoverage(portland, avg3);
    const monthsHk = calcMonthsCoverage(hk, avg3);
    return { ...sku, onHand, avgSales, avg3, months, monthsPortland, monthsHk };
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

export function Dashboard() {
  const { data, loading, error, refetch } = useQuery(fetchDashboardData, []);

  const { kpis, urgentItems, chartData, totalValue } = useMemo(() => {
    if (!data) return {};

    const coverage = buildCoverageMap(data.skus.filter(s => isValidSku(s.sku)), data.snapshot, data.sales);

    const urgent = coverage.filter(s => isFinite(s.months) && s.months < 1);
    const watchList = coverage.filter(s => isFinite(s.months) && s.months >= 1 && s.months < 3);
    const needsReorder = coverage.filter(s => isFinite(s.months) && s.months < 3);

    const latestValBySku = {};
    for (const v of data.valuation) {
      if (!latestValBySku[v.sku]) latestValBySku[v.sku] = v;
    }
    const totalValue = Object.values(latestValBySku).reduce((s, v) => s + (v.inv_value ?? 0), 0);

    const chartData = coverage
      .filter(s => isFinite(s.months))
      .sort((a, b) => a.months - b.months)
      .slice(0, 30);

    return {
      kpis: { urgent: urgent.length, watchList: watchList.length, total: data.skus.length },
      urgentItems: needsReorder.sort((a, b) => a.months - b.months),
      chartData,
      totalValue,
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
                    {['SKU', 'Description', 'On Hand', 'Total Mo', 'PDX Mo', 'HK Mo', 'Supplier'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {urgentItems?.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-muted font-mono">No items need reordering</td>
                    </tr>
                  ) : urgentItems?.map(item => (
                    <tr key={item.sku} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-2.5">
                        <Link to={`/item/${item.sku}`} className="font-mono text-accent hover:text-accent/80 transition-colors">
                          {item.sku}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-slate-300 font-sans max-w-[130px] truncate">{item.description}</td>
                      <td className="px-4 py-2.5 font-mono text-white">{item.onHand.toLocaleString()}</td>
                      <td className="px-4 py-2.5"><CoverageCell months={item.months} /></td>
                      <td className="px-4 py-2.5"><CoverageCell months={item.monthsPortland} /></td>
                      <td className="px-4 py-2.5"><CoverageCell months={item.monthsHk} /></td>
                      <td className="px-4 py-2.5 text-muted font-sans">{item.supplier}</td>
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
              <span className="text-xs font-mono text-accent">{data?.openPOs?.length ?? 0} open</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    {['PO #', 'SKU', 'Vendor', 'Qty', 'Value', 'Status'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data?.openPOs?.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-muted font-mono">No open POs</td>
                    </tr>
                  ) : data?.openPOs?.map(po => (
                    <tr key={po.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-2.5 font-mono text-slate-300">{po.po_number}</td>
                      <td className="px-4 py-2.5">
                        <Link to={`/item/${po.sku}`} className="font-mono text-accent hover:text-accent/80">
                          {po.sku}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-muted font-sans">{po.vendor}</td>
                      <td className="px-4 py-2.5 font-mono text-white">{po.qty_ordered?.toLocaleString()}</td>
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
