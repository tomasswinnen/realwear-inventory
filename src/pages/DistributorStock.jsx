import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { supabase, excludeSkus } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { QueryError } from '../components/QueryError';
import { TableSkeleton, KPISkeleton, ChartSkeleton } from '../components/Skeleton';
import { KPICard } from '../components/KPICard';

async function fetchDistributorStock() {
  const [stockRes, skusRes] = await Promise.all([
    excludeSkus(
      supabase.from('distributor_stock')
        .select('distributor, sku, qty_on_hand, updated_at')
        .order('distributor', { ascending: true })
    ),
    excludeSkus(supabase.from('skus').select('sku, description')),
  ]);
  if (stockRes.error) throw new Error(stockRes.error.message);
  if (skusRes.error) throw new Error(skusRes.error.message);
  return { stock: stockRes.data, skus: skusRes.data };
}

const CHART_TOOLTIP_STYLE = {
  backgroundColor: '#162030',
  border: '1px solid rgba(148,163,184,0.12)',
  borderRadius: 6,
  fontSize: 12,
  fontFamily: 'DM Mono, monospace',
  color: '#e2e8f0',
};

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={CHART_TOOLTIP_STYLE} className="px-3 py-2">
      <p className="font-sans text-white text-xs mb-1">{d.distributor}</p>
      <p className="font-mono text-xs text-accent">{d.qty.toLocaleString()} units</p>
      <p className="font-mono text-xs text-muted">{d.skuCount} SKUs</p>
    </div>
  );
}

function groupByDistributor(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.distributor)) {
      groups.set(row.distributor, { distributor: row.distributor, rows: [], totalQty: 0, lastUpdated: null });
    }
    const g = groups.get(row.distributor);
    g.rows.push(row);
    g.totalQty += row.qty_on_hand ?? 0;
    if (!g.lastUpdated || (row.updated_at && row.updated_at > g.lastUpdated)) g.lastUpdated = row.updated_at;
  }
  for (const g of groups.values()) {
    g.rows.sort((a, b) => (b.qty_on_hand ?? 0) - (a.qty_on_hand ?? 0));
  }
  return [...groups.values()].sort((a, b) => b.totalQty - a.totalQty);
}

function DistributorSection({ group, expanded, onToggle }) {
  return (
    <div className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-4 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <svg
            className={`w-3.5 h-3.5 text-muted shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-sm font-sans text-white font-medium truncate">{group.distributor}</span>
          <span className="text-[10px] font-mono text-muted shrink-0">{group.rows.length} SKUs · updated {group.lastUpdated ?? '—'}</span>
        </div>
        <span className="font-num text-white font-medium shrink-0">{group.totalQty.toLocaleString()} units</span>
      </button>
      {expanded && (
        <div className="overflow-x-auto border-t border-white/[0.06]">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/[0.06]">
                {['SKU', 'Product', 'Qty On Hand', 'Updated'].map(h => (
                  <th key={h} className="px-4 py-2 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {group.rows.map(row => (
                <tr key={row.sku} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors last:border-b-0">
                  <td className="px-4 py-2">
                    <Link to={`/item/${row.sku}`} className="font-mono text-accent hover:text-accent/80">{row.sku}</Link>
                  </td>
                  <td className="px-4 py-2 text-slate-300 font-sans max-w-[280px] truncate" title={row.description ?? undefined}>
                    {row.description ?? <span className="text-muted">—</span>}
                  </td>
                  <td className="px-4 py-2 font-mono text-white">{(row.qty_on_hand ?? 0).toLocaleString()}</td>
                  <td className="px-4 py-2 font-mono text-muted">{row.updated_at ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function DistributorStock() {
  const { data, loading, error, refetch } = useQuery(fetchDistributorStock, []);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(() => new Set());

  const { groups, totals, chartData } = useMemo(() => {
    if (!data?.stock) return { groups: [], totals: { distributors: 0, units: 0, skus: 0 }, chartData: [] };
    const descBySku = Object.fromEntries(data.skus.map(s => [s.sku, s.description]));
    const enriched = data.stock.map(r => ({ ...r, description: descBySku[r.sku] ?? null }));

    const q = search.toLowerCase();
    const filtered = enriched.filter(r =>
      !search ||
      r.sku?.toLowerCase().includes(q) ||
      r.distributor?.toLowerCase().includes(q) ||
      r.description?.toLowerCase().includes(q)
    );

    const totals = {
      distributors: new Set(enriched.map(r => r.distributor)).size,
      units: enriched.reduce((s, r) => s + (r.qty_on_hand ?? 0), 0),
      skus: new Set(enriched.map(r => r.sku)).size,
    };

    const groups = groupByDistributor(filtered);
    const chartData = groupByDistributor(enriched).map(g => ({ distributor: g.distributor, qty: g.totalQty, skuCount: g.rows.length }));

    return { groups, totals, chartData };
  }, [data, search]);

  function toggleGroup(key) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function expandAll() {
    setExpanded(new Set(groups.map(g => g.distributor)));
  }

  function collapseAll() {
    setExpanded(new Set());
  }

  if (error) return <QueryError message={error} onRetry={refetch} />;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-sans font-semibold text-white">Distributor Stock</h1>
          <p className="text-xs text-muted font-mono mt-0.5">Inventory reported by external distributors</p>
        </div>
        <input
          type="search"
          placeholder="Search SKU, distributor, product…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-card border border-white/[0.12] rounded px-3 py-2 text-sm font-mono text-white placeholder:text-muted focus:outline-none focus:border-accent/50 w-full sm:w-72"
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => <KPISkeleton key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <KPICard label="Distributors Reporting" value={totals.distributors.toLocaleString()} accent />
          <KPICard label="Total Units On Hand" value={totals.units.toLocaleString()} color="text-white" />
          <KPICard label="SKUs Covered" value={totals.skus.toLocaleString()} color="text-white" />
        </div>
      )}

      {loading ? <ChartSkeleton height={220} /> : chartData.length > 0 && (
        <div className="bg-card rounded-lg border border-white/[0.08] p-5">
          <h2 className="text-sm font-sans font-semibold text-white mb-4">Units On Hand by Distributor</h2>
          <ResponsiveContainer width="100%" height={Math.max(180, chartData.length * 28)}>
            <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
              <CartesianGrid horizontal={false} stroke="rgba(148,163,184,0.06)" />
              <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'DM Mono' }} axisLine={false} tickLine={false} />
              <YAxis
                type="category"
                dataKey="distributor"
                tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'DM Mono' }}
                axisLine={false}
                tickLine={false}
                width={150}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <Bar dataKey="qty" radius={[0, 3, 3, 0]} fill="#0ea5e9" maxBarSize={16} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-sans font-semibold text-white">By Distributor</h2>
        {!loading && groups.length > 0 && (
          <div className="flex items-center gap-2">
            <button onClick={expandAll} className="text-[11px] font-mono text-muted hover:text-white transition-colors">Expand all</button>
            <span className="text-muted/40">·</span>
            <button onClick={collapseAll} className="text-[11px] font-mono text-muted hover:text-white transition-colors">Collapse all</button>
          </div>
        )}
      </div>

      {loading ? (
        <TableSkeleton rows={6} cols={4} />
      ) : groups.length === 0 ? (
        <div className="bg-card rounded-lg border border-white/[0.08] px-4 py-12 text-center">
          <p className="text-muted font-mono text-sm">No distributor stock data yet</p>
          <p className="text-muted/70 font-mono text-[11px] mt-1">Will be loaded from the distributor report shortly</p>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map(g => (
            <DistributorSection
              key={g.distributor}
              group={g}
              expanded={expanded.has(g.distributor)}
              onToggle={() => toggleGroup(g.distributor)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
