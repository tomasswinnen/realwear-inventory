import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, excludeSkus } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { QueryError } from '../components/QueryError';
import { TableSkeleton } from '../components/Skeleton';
import { KPICard } from '../components/KPICard';

async function fetchDistributorStock() {
  const stockRes = await excludeSkus(
    supabase.from('distributor_stock')
      .select('distributor, sku, qty_on_hand, updated_at')
      .order('distributor', { ascending: true })
  );
  if (stockRes.error) throw new Error(stockRes.error.message);
  return { stock: stockRes.data };
}

export function DistributorStock() {
  const { data, loading, error, refetch } = useQuery(fetchDistributorStock, []);
  const [search, setSearch] = useState('');

  const { rows, totals } = useMemo(() => {
    if (!data?.stock) return { rows: [], totals: { distributors: 0, units: 0 } };
    const q = search.toLowerCase();
    const filtered = data.stock.filter(r =>
      !search ||
      r.sku?.toLowerCase().includes(q) ||
      r.distributor?.toLowerCase().includes(q)
    );
    const totals = {
      distributors: new Set(data.stock.map(r => r.distributor)).size,
      units: data.stock.reduce((s, r) => s + (r.qty_on_hand ?? 0), 0),
    };
    return { rows: filtered, totals };
  }, [data, search]);

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
          placeholder="Search SKU, distributor…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-card border border-white/[0.12] rounded px-3 py-2 text-sm font-mono text-white placeholder:text-muted focus:outline-none focus:border-accent/50 w-64"
        />
      </div>

      {!loading && (
        <div className="grid grid-cols-2 gap-3">
          <KPICard label="Distributors Reporting" value={totals.distributors.toLocaleString()} accent />
          <KPICard label="Total Units On Hand" value={totals.units.toLocaleString()} color="text-white" />
        </div>
      )}

      <section className="space-y-2">
        {loading ? <TableSkeleton rows={6} cols={4} /> : (
          <div className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    {['Distributor', 'SKU', 'Qty On Hand', 'Updated'].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-12 text-center">
                        <p className="text-muted font-mono text-sm">No distributor stock data yet</p>
                        <p className="text-muted/70 font-mono text-[11px] mt-1">Will be loaded from the distributor report shortly</p>
                      </td>
                    </tr>
                  ) : rows.map(row => (
                    <tr key={`${row.distributor}-${row.sku}`} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                      <td className="px-3 py-2.5 text-slate-300 font-sans">{row.distributor}</td>
                      <td className="px-3 py-2.5">
                        <Link to={`/item/${row.sku}`} className="font-mono text-accent hover:text-accent/80">{row.sku}</Link>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-white">{(row.qty_on_hand ?? 0).toLocaleString()}</td>
                      <td className="px-3 py-2.5 font-mono text-muted">{row.updated_at ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2.5 border-t border-white/[0.06]">
              <p className="text-[10px] text-muted font-mono">{rows.length} rows</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
