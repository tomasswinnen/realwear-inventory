import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, Bar, Cell, ResponsiveContainer } from 'recharts';
import { supabase } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { CoverageCell } from '../components/CoverageCell';
import { QueryError } from '../components/QueryError';
import { TableSkeleton } from '../components/Skeleton';
import { calcMonthsCoverage, coverageColor, formatCurrency, isValidSku } from '../utils/coverage';

async function fetchForecastData() {
  const [skusRes, snapshotRes, salesRes] = await Promise.all([
    supabase.from('skus').select('sku, description, supplier, unit_cost'),
    supabase.from('inventory_snapshot').select('sku, on_hand_total, on_order').order('updated_at', { ascending: false }),
    supabase.from('monthly_sales').select('sku, qty_sold, month').order('month', { ascending: false }),
  ]);
  for (const r of [skusRes, snapshotRes, salesRes]) {
    if (r.error) throw new Error(r.error.message);
  }
  return { skus: skusRes.data, snapshot: snapshotRes.data, sales: salesRes.data };
}

function buildRows(skus, snapshot, sales) {
  const latestSnapshot = {};
  for (const s of snapshot) {
    if (!latestSnapshot[s.sku]) latestSnapshot[s.sku] = s;
  }
  const salesBySku = {};
  for (const s of sales) {
    if (!salesBySku[s.sku]) salesBySku[s.sku] = [];
    if (salesBySku[s.sku].length < 6) salesBySku[s.sku].push(s.qty_sold);
  }

  return skus.map(sku => {
    const snap = latestSnapshot[sku.sku] ?? {};
    const skuSales = salesBySku[sku.sku] ?? [];
    const avg3 = skuSales.slice(0, 3).reduce((a, b) => a + b, 0) / Math.max(skuSales.slice(0, 3).length, 1);
    const avg6 = skuSales.reduce((a, b) => a + b, 0) / Math.max(skuSales.length, 1);
    const onHand = snap.on_hand_total ?? 0;
    const onOrder = snap.on_order ?? 0;
    const months = calcMonthsCoverage(onHand + onOrder, avg6);
    const chartData = skuSales.slice().reverse().map((v, i) => ({ i, v }));
    return {
      sku: sku.sku, description: sku.description, supplier: sku.supplier,
      unitCost: sku.unit_cost, onHand, onOrder, avg3, avg6, months, chartData,
    };
  });
}

export function Forecast() {
  const { data, loading, error, refetch } = useQuery(fetchForecastData, []);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('months');
  const [sortDir, setSortDir] = useState('asc');

  const rows = useMemo(() => {
    if (!data) return [];
    const all = buildRows(data.skus.filter(s => isValidSku(s.sku)), data.snapshot, data.sales);
    const filtered = search
      ? all.filter(r => r.sku.toLowerCase().includes(search.toLowerCase()) || r.description?.toLowerCase().includes(search.toLowerCase()))
      : all;
    return [...filtered].sort((a, b) => {
      let av = a[sortField] ?? 0, bv = b[sortField] ?? 0;
      if (!isFinite(av)) av = 9999; if (!isFinite(bv)) bv = 9999;
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [data, search, sortField, sortDir]);

  function toggleSort(field) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  }

  function SortTh({ field, label }) {
    const active = sortField === field;
    return (
      <th
        className="px-4 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px] cursor-pointer select-none hover:text-slate-300 transition-colors"
        onClick={() => toggleSort(field)}
      >
        {label} {active ? (sortDir === 'asc' ? '↑' : '↓') : ''}
      </th>
    );
  }

  if (error) return <QueryError message={error} onRetry={refetch} />;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-sans font-semibold text-white">Demand Forecast</h1>
          <p className="text-xs text-muted font-mono mt-0.5">All SKUs · coverage by avg monthly sales</p>
        </div>
        <input
          type="search"
          placeholder="Search SKU or description…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-card border border-white/[0.12] rounded px-3 py-2 text-sm font-mono text-white placeholder:text-muted focus:outline-none focus:border-accent/50 w-64"
        />
      </div>

      {loading ? <TableSkeleton rows={10} cols={7} /> : (
        <div className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <SortTh field="sku" label="SKU" />
                  <th className="px-4 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px]">Description</th>
                  <SortTh field="onHand" label="On Hand" />
                  <SortTh field="onOrder" label="On Order" />
                  <SortTh field="avg3" label="3M Avg" />
                  <SortTh field="avg6" label="6M Avg" />
                  <SortTh field="months" label="Coverage" />
                  <th className="px-4 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px]">Trend</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-muted font-mono">No data</td></tr>
                ) : rows.map(row => (
                  <tr key={row.sku} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-2.5">
                      <Link to={`/item/${row.sku}`} className="font-mono text-accent hover:text-accent/80 transition-colors">
                        {row.sku}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-slate-300 font-sans max-w-[180px] truncate" title={row.description}>
                      {row.description}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-white">{row.onHand.toLocaleString()}</td>
                    <td className="px-4 py-2.5 font-mono text-muted">{row.onOrder.toLocaleString()}</td>
                    <td className="px-4 py-2.5 font-mono text-white">{row.avg3.toFixed(0)}</td>
                    <td className="px-4 py-2.5 font-mono text-white">{row.avg6.toFixed(0)}</td>
                    <td className="px-4 py-2.5"><CoverageCell months={row.months} /></td>
                    <td className="px-4 py-2.5 w-20">
                      {row.chartData.length > 0 ? (
                        <ResponsiveContainer width={72} height={28}>
                          <BarChart data={row.chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                            <Bar dataKey="v" radius={[1, 1, 0, 0]} maxBarSize={8}>
                              {row.chartData.map((_, i) => (
                                <Cell key={i} fill={coverageColor(row.months)} fillOpacity={0.6 + 0.4 * (i / row.chartData.length)} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      ) : <span className="text-muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 border-t border-white/[0.06]">
            <p className="text-[10px] text-muted font-mono">{rows.length} SKUs shown</p>
          </div>
        </div>
      )}
    </div>
  );
}
