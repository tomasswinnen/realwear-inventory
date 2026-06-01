import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
  BarChart, Cell,
} from 'recharts';
import { supabase } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { KPICard } from '../components/KPICard';
import { StatusBadge } from '../components/StatusBadge';
import { QueryError } from '../components/QueryError';
import { KPISkeleton, ChartSkeleton, TableSkeleton } from '../components/Skeleton';
import { calcMonthsCoverage, formatCurrency, avgLast } from '../utils/coverage';

async function fetchItemData(sku) {
  const [skuRes, snapRes, salesRes, poRes] = await Promise.all([
    supabase.from('skus').select('*').eq('sku', sku).single(),
    supabase.from('inventory_snapshot').select('*').eq('sku', sku).order('updated_at', { ascending: false }).limit(1).single(),
    supabase.from('monthly_sales').select('*').eq('sku', sku).order('month', { ascending: true }),
    supabase.from('po_history').select('*').eq('sku', sku).order('created_at', { ascending: false }),
  ]);
  if (skuRes.error) throw new Error(`SKU not found: ${sku}`);
  return {
    sku: skuRes.data,
    snapshot: snapRes.data ?? {},
    sales: salesRes.data ?? [],
    pos: poRes.data ?? [],
  };
}

const TOOLTIP_STYLE = {
  backgroundColor: '#162030',
  border: '1px solid rgba(148,163,184,0.12)',
  borderRadius: 6,
  fontSize: 11,
  fontFamily: 'DM Mono, monospace',
  color: '#e2e8f0',
};

function buildProjection(sales, snapshot, qtyOverrides, growthRate) {
  if (!sales.length) return [];

  const last3Avg = avgLast(sales.map(s => s.qty_sold), 3);
  const last6Avg = avgLast(sales.map(s => s.qty_sold), 6);

  const lastSale = sales[sales.length - 1];
  const lastDate = lastSale ? new Date(lastSale.month) : new Date();

  const onHand = snapshot.on_hand_total ?? 0;
  const onOrder = snapshot.on_order ?? 0;
  let inv3 = onHand + onOrder;
  let inv6 = onHand + onOrder;

  const months = [];
  for (let i = 1; i <= 12; i++) {
    const d = new Date(lastDate);
    d.setMonth(d.getMonth() + i);
    const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    const growth = 1 + (growthRate / 100);
    const demand3 = last3Avg * Math.pow(growth, i / 12);
    const demand6 = last6Avg * Math.pow(growth, i / 12);
    const received = qtyOverrides[i] ?? 0;
    inv3 = Math.max(0, inv3 + received - demand3);
    inv6 = Math.max(0, inv6 + received - demand6);
    months.push({ label, demand3: Math.round(demand3), demand6: Math.round(demand6), inv3: Math.round(inv3), inv6: Math.round(inv6), received });
  }
  return months;
}

export function ItemForecast() {
  const { sku } = useParams();
  const { data, loading, error, refetch } = useQuery(() => fetchItemData(sku), [sku]);
  const [qtyOverrides, setQtyOverrides] = useState({});
  const [growthRate, setGrowthRate] = useState(0);

  const projection = useMemo(() => {
    if (!data) return [];
    return buildProjection(data.sales, data.snapshot, qtyOverrides, growthRate);
  }, [data, qtyOverrides, growthRate]);

  const kpis = useMemo(() => {
    if (!data) return null;
    const sales = data.sales.map(s => s.qty_sold);
    const snap = data.snapshot;
    const avg3 = avgLast(sales, 3);
    const avg6 = avgLast(sales, 6);
    const onHand = snap.on_hand_total ?? 0;
    const onOrder = snap.on_order ?? 0;
    const months = calcMonthsCoverage(onHand + onOrder, avg6);
    const totalSold = sales.reduce((a, b) => a + b, 0);
    return { avg3, avg6, onHand, onOrder, months, totalSold };
  }, [data]);

  function handleOverrideChange(monthIdx, value) {
    const num = parseInt(value, 10);
    setQtyOverrides(prev => ({ ...prev, [monthIdx]: isNaN(num) ? 0 : Math.max(0, num) }));
  }

  if (error) return <QueryError message={error} onRetry={refetch} />;

  const skuInfo = data?.sku ?? {};
  const sales = data?.sales ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link to="/forecast" className="text-muted text-xs font-mono hover:text-accent transition-colors">← Forecast</Link>
          </div>
          <h1 className="text-xl font-sans font-semibold text-white">{sku}</h1>
          {!loading && <p className="text-sm text-muted font-sans mt-0.5">{skuInfo.description}</p>}
        </div>
        {!loading && (
          <div className="text-xs font-mono text-muted">
            <span className="text-slate-400">{skuInfo.supplier}</span>
            {skuInfo.lead_time_days && <span className="ml-3">Lead: {skuInfo.lead_time_days}d</span>}
            {skuInfo.moq && <span className="ml-3">MOQ: {skuInfo.moq}</span>}
          </div>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {loading ? Array.from({ length: 6 }).map((_, i) => <KPISkeleton key={i} />) : (
          <>
            <KPICard label="On Hand" value={kpis.onHand?.toLocaleString()} accent />
            <KPICard label="On Order" value={kpis.onOrder?.toLocaleString()} color="text-slate-300" />
            <KPICard label="3M Avg Sales" value={kpis.avg3?.toFixed(0)} color="text-slate-300" />
            <KPICard label="6M Avg Sales" value={kpis.avg6?.toFixed(0)} color="text-slate-300" />
            <KPICard label="Months Coverage" value={isFinite(kpis.months) ? kpis.months?.toFixed(1) : '∞'}
              color={!isFinite(kpis.months) ? 'text-success' : kpis.months < 1 ? 'text-danger' : kpis.months < 3 ? 'text-warning' : 'text-success'}
            />
            <KPICard label="Unit Cost" value={formatCurrency(skuInfo.unit_cost)} color="text-slate-300" />
          </>
        )}
      </div>

      {/* Historical sales bar chart */}
      {loading ? <ChartSkeleton height={200} /> : (
        <div className="bg-card rounded-lg border border-white/[0.08] p-5">
          <h2 className="text-sm font-sans font-semibold text-white mb-4">Historical Sales</h2>
          {sales.length === 0 ? (
            <p className="text-muted font-mono text-sm text-center py-8">No sales data</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={sales.map(s => ({ ...s, month: new Date(s.month).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) }))}
                margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="rgba(148,163,184,0.06)" />
                <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'DM Mono' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'DM Mono' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Bar dataKey="qty_sold" name="Units Sold" fill="#0ea5e9" radius={[2, 2, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="bg-card rounded-lg border border-white/[0.08] p-5">
        <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
          <h2 className="text-sm font-sans font-semibold text-white">12-Month Projection</h2>
          <div className="flex items-center gap-3">
            <label className="text-xs font-mono text-muted whitespace-nowrap">Growth rate</label>
            <input
              type="range" min={-30} max={50} value={growthRate}
              onChange={e => setGrowthRate(Number(e.target.value))}
              className="w-32 accent-accent"
            />
            <span className={`text-xs font-mono w-12 text-right ${growthRate > 0 ? 'text-success' : growthRate < 0 ? 'text-danger' : 'text-muted'}`}>
              {growthRate > 0 ? '+' : ''}{growthRate}%
            </span>
          </div>
        </div>

        {loading ? <ChartSkeleton height={220} /> : (
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={projection} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="rgba(148,163,184,0.06)" />
              <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'DM Mono' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'DM Mono' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <Legend
                wrapperStyle={{ fontSize: 11, fontFamily: 'DM Mono', color: '#64748b', paddingTop: 8 }}
              />
              <Bar dataKey="received" name="Received" fill="rgba(34,197,94,0.4)" radius={[2, 2, 0, 0]} maxBarSize={16} />
              <Line type="monotone" dataKey="inv3" name="Inv (3M avg)" stroke="#0ea5e9" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="inv6" name="Inv (6M avg)" stroke="#f59e0b" strokeWidth={2} dot={false} strokeDasharray="4 2" />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Editable qty received per month */}
      {!loading && (
        <div className="bg-card rounded-lg border border-white/[0.08] p-5">
          <h2 className="text-sm font-sans font-semibold text-white mb-1">Qty Received per Month</h2>
          <p className="text-xs text-muted font-mono mb-4">Edit to simulate incoming stock · updates projection in real time</p>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-12 gap-2">
            {projection.map((m, i) => (
              <div key={i} className="flex flex-col gap-1">
                <label className="text-[10px] font-mono text-muted">{m.label}</label>
                <input
                  type="number"
                  min={0}
                  value={qtyOverrides[i + 1] ?? ''}
                  placeholder="0"
                  onChange={e => handleOverrideChange(i + 1, e.target.value)}
                  className="bg-bg border border-white/[0.12] rounded px-2 py-1.5 text-xs font-mono text-white text-right focus:outline-none focus:border-accent/50 w-full"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PO History for this SKU */}
      {loading ? <TableSkeleton rows={3} cols={6} /> : (
        <div className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.08]">
            <h2 className="text-sm font-sans font-semibold text-white">PO History</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {['PO #', 'Vendor', 'Status', 'Qty', 'Unit Cost', 'Date'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data?.pos?.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-muted font-mono">No POs</td></tr>
                ) : data?.pos?.map(po => (
                  <tr key={po.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-2.5 font-mono text-slate-300">{po.po_number}</td>
                    <td className="px-4 py-2.5 text-muted font-sans">{po.vendor}</td>
                    <td className="px-4 py-2.5"><StatusBadge status={po.status} /></td>
                    <td className="px-4 py-2.5 font-mono text-white">{po.qty_ordered?.toLocaleString()}</td>
                    <td className="px-4 py-2.5 font-mono text-white">{formatCurrency(po.unit_cost)}</td>
                    <td className="px-4 py-2.5 font-mono text-muted">{po.created_at ? new Date(po.created_at).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
