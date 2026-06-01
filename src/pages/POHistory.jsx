import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { StatusBadge } from '../components/StatusBadge';
import { QueryError } from '../components/QueryError';
import { TableSkeleton } from '../components/Skeleton';
import { formatCurrency } from '../utils/coverage';

async function fetchPOData() {
  const [skusRes, poRes] = await Promise.all([
    supabase.from('skus').select('sku, description'),
    supabase.from('po_history').select('*').order('created_at', { ascending: false }),
  ]);
  for (const r of [skusRes, poRes]) {
    if (r.error) throw new Error(r.error.message);
  }
  return { skus: skusRes.data, pos: poRes.data };
}

const STATUS_ORDER = ['Open', 'Partial', 'Received', 'Cancelled', 'Pending'];

export function POHistory() {
  const { data, loading, error, refetch } = useQuery(fetchPOData, []);
  const [skuFilter, setSkuFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');

  const { rows, skuOptions } = useMemo(() => {
    if (!data) return { rows: [], skuOptions: [] };
    const descBySku = Object.fromEntries(data.skus.map(s => [s.sku, s.description]));
    const rows = data.pos.map(po => ({ ...po, description: descBySku[po.sku] ?? '' }));

    const filtered = rows.filter(r => {
      const matchSku = !skuFilter || r.sku === skuFilter;
      const matchStatus = statusFilter === 'all' || r.status === statusFilter;
      const matchSearch = !search || r.po_number?.toLowerCase().includes(search.toLowerCase()) || r.vendor?.toLowerCase().includes(search.toLowerCase());
      return matchSku && matchStatus && matchSearch;
    });

    const skuOptions = [...new Set(rows.map(r => r.sku))].sort();
    return { rows: filtered, skuOptions };
  }, [data, skuFilter, statusFilter, search]);

  const totalValue = useMemo(() =>
    rows.reduce((s, r) => s + (r.qty_ordered ?? 0) * (r.unit_cost ?? 0), 0),
    [rows]);

  if (error) return <QueryError message={error} onRetry={refetch} />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-sans font-semibold text-white">PO History</h1>
        <p className="text-xs text-muted font-mono mt-0.5">All purchase orders</p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={skuFilter}
          onChange={e => setSkuFilter(e.target.value)}
          className="bg-card border border-white/[0.12] rounded px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-accent/50"
        >
          <option value="">All SKUs</option>
          {skuOptions.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <div className="flex border border-white/[0.12] rounded overflow-hidden text-xs font-mono">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-2 transition-colors ${statusFilter === 'all' ? 'bg-accent text-white' : 'text-muted hover:text-white hover:bg-white/5'}`}
          >
            All
          </button>
          {STATUS_ORDER.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-2 transition-colors ${statusFilter === s ? 'bg-accent text-white' : 'text-muted hover:text-white hover:bg-white/5'}`}
            >
              {s}
            </button>
          ))}
        </div>

        <input
          type="search"
          placeholder="PO # or vendor…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-card border border-white/[0.12] rounded px-3 py-2 text-sm font-mono text-white placeholder:text-muted focus:outline-none focus:border-accent/50 w-48"
        />

        {!loading && (
          <span className="ml-auto text-xs font-mono text-muted">
            {rows.length} POs · {formatCurrency(totalValue)}
          </span>
        )}
      </div>

      {loading ? <TableSkeleton rows={10} cols={7} /> : (
        <div className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {['PO Number', 'SKU', 'Description', 'Vendor', 'Status', 'Qty', 'Unit Cost', 'Total', 'Date'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-muted font-mono">No purchase orders found</td></tr>
                ) : rows.map(po => (
                  <tr key={po.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-2.5 font-mono text-slate-300">{po.po_number}</td>
                    <td className="px-4 py-2.5">
                      <Link to={`/item/${po.sku}`} className="font-mono text-accent hover:text-accent/80">{po.sku}</Link>
                    </td>
                    <td className="px-4 py-2.5 text-muted font-sans max-w-[150px] truncate" title={po.description}>{po.description}</td>
                    <td className="px-4 py-2.5 text-muted font-sans">{po.vendor}</td>
                    <td className="px-4 py-2.5"><StatusBadge status={po.status} /></td>
                    <td className="px-4 py-2.5 font-mono text-white">{po.qty_ordered?.toLocaleString()}</td>
                    <td className="px-4 py-2.5 font-mono text-white">{formatCurrency(po.unit_cost)}</td>
                    <td className="px-4 py-2.5 font-mono text-white">{formatCurrency((po.qty_ordered ?? 0) * (po.unit_cost ?? 0))}</td>
                    <td className="px-4 py-2.5 font-mono text-muted">{po.created_at ? new Date(po.created_at).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 border-t border-white/[0.06] flex items-center justify-between">
            <p className="text-[10px] text-muted font-mono">{rows.length} records</p>
            <p className="text-[10px] text-muted font-mono">Total: {formatCurrency(totalValue)}</p>
          </div>
        </div>
      )}
    </div>
  );
}
