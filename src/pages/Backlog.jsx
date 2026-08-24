import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, excludeSkus } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { QueryError } from '../components/QueryError';
import { TableSkeleton, KPISkeleton } from '../components/Skeleton';
import { KPICard } from '../components/KPICard';
import { StatusBadge } from '../components/StatusBadge';
import { formatCurrency, isValidSku } from '../utils/coverage';

// Backlog = líneas de sales orders abiertas: lo comprometido a clientes y
// todavía no despachado. Fuente: tabla sales_backlog, que el pipeline
// refresca de NetSuite en cada corrida (SalesBacklog.xls).
async function fetchBacklog() {
  const [backlogRes, skusRes] = await Promise.all([
    supabase.from('sales_backlog').select('*').order('so_date', { ascending: true }),
    excludeSkus(supabase.from('skus').select('sku, description')),
  ]);
  if (backlogRes.error) throw new Error(backlogRes.error.message);
  return { rows: backlogRes.data ?? [], skus: skusRes.data ?? [] };
}

export function Backlog() {
  const { data, loading, error, refetch } = useQuery(fetchBacklog, []);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const { rows, statuses, kpis } = useMemo(() => {
    if (!data) return { rows: [], statuses: [], kpis: null };
    const descBySku = Object.fromEntries(data.skus.map(s => [s.sku, s.description]));
    const all = data.rows
      // qty_open 0 = línea ya despachada dentro de una SO aún abierta: no es backlog
      .filter(r => (r.qty_open ?? 0) > 0)
      .map(r => ({ ...r, description: descBySku[r.sku] ?? '' }));

    const statuses = [...new Set(all.map(r => r.status).filter(Boolean))].sort();

    const filtered = all.filter(r => {
      const matchStatus = statusFilter === 'all' || r.status === statusFilter;
      const q = search.toLowerCase();
      const matchSearch = !q
        || r.customer?.toLowerCase().includes(q)
        || r.so_number?.toLowerCase().includes(q)
        || r.sku?.toLowerCase().includes(q);
      return matchStatus && matchSearch;
    });

    const kpis = {
      units: filtered.reduce((s, r) => s + (r.qty_open ?? 0), 0),
      value: filtered.reduce((s, r) => s + (r.amount_open ?? 0), 0),
      orders: new Set(filtered.map(r => r.so_number)).size,
      customers: new Set(filtered.map(r => r.customer)).size,
    };
    return { rows: filtered, statuses, kpis };
  }, [data, search, statusFilter]);

  if (error) return <QueryError message={error} onRetry={refetch} />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-sans font-semibold text-white">Sales Backlog</h1>
        <p className="text-xs text-muted font-mono mt-0.5">Open sales order lines — committed to customers, not yet shipped</p>
      </div>

      {loading ? <KPISkeleton count={4} /> : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KPICard label="Open Units" value={kpis.units.toLocaleString()} />
          <KPICard label="Open Value" value={formatCurrency(kpis.value)} />
          <KPICard label="Open Orders" value={kpis.orders} />
          <KPICard label="Customers" value={kpis.customers} />
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="search"
          placeholder="Customer, SO # or SKU…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-card border border-white/[0.12] rounded px-3 py-2 text-sm font-mono text-white placeholder:text-muted focus:outline-none focus:border-accent/50 w-56"
        />
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="bg-card border border-white/[0.12] rounded px-3 py-2 text-xs font-mono text-white focus:outline-none"
        >
          <option value="all">All statuses</option>
          {statuses.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {!loading && (
          <span className="ml-auto text-xs font-mono text-muted">{rows.length} lines</span>
        )}
      </div>

      {loading ? <TableSkeleton rows={10} cols={8} /> : (
        <div className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {['SO Number', 'Date', 'Customer', 'SKU', 'Description', 'Status', 'Qty Open', 'Value Open'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-muted font-mono">No open backlog</td></tr>
                ) : rows.map(r => (
                  <tr key={r.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-2.5 font-mono text-slate-300">{r.so_number}</td>
                    <td className="px-4 py-2.5 font-mono text-muted whitespace-nowrap">{r.so_date}</td>
                    <td className="px-4 py-2.5 font-sans text-slate-300 max-w-[220px] truncate" title={r.customer}>{r.customer}</td>
                    <td className="px-4 py-2.5">
                      {isValidSku(r.sku)
                        ? <Link to={`/item/${r.sku}`} className="font-mono text-accent hover:text-accent/80">{r.sku}</Link>
                        : <span className="font-mono text-muted">{r.sku}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-muted font-sans max-w-[180px] truncate" title={r.description}>{r.description}</td>
                    <td className="px-4 py-2.5"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-2.5 font-mono text-white">{r.qty_open?.toLocaleString()}</td>
                    <td className="px-4 py-2.5 font-mono text-white">{formatCurrency(r.amount_open)}</td>
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
