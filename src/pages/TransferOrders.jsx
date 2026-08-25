import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, excludeSkus } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { QueryError } from '../components/QueryError';
import { TableSkeleton } from '../components/Skeleton';
import { formatCurrency } from '../utils/coverage';

function formatLocationDisplay(location) {
  if (!location) return '—';
  const normalized = location.toLowerCase();
  if (normalized.includes('portland')) return 'Portland';
  if (normalized.includes('hong kong')) return 'Hong Kong';
  return location.replace(/^\d+\s*-\s*/, '').trim();
}

async function fetchOpenTransferOrders() {
  const [ordersRes, skusRes] = await Promise.all([
    excludeSkus(
      supabase.from('open_transfer_orders')
        .select('transfer_order_number, transfer_date, vendor, sku, status, origin_location, destination_location, qty_ordered, qty_open, unit_price, amount_remaining')
        .order('transfer_date', { ascending: false })
    ),
    excludeSkus(supabase.from('skus').select('sku, description')),
  ]);
  if (ordersRes.error) throw new Error(ordersRes.error.message);
  const descBySku = Object.fromEntries((skusRes.data ?? []).map(s => [s.sku, s.description]));

  // Tracking de los despachos de estos TOs (mismo lugar que el de las SO)
  const toNumbers = [...new Set((ordersRes.data ?? []).map(o => o.transfer_order_number).filter(Boolean))];
  const tracking = [];
  for (let i = 0; i < toNumbers.length; i += 100) {
    const res = await supabase.from('so_tracking').select('*')
      .in('so_number', toNumbers.slice(i, i + 100));
    if (res.error) break; // tabla/datos ausentes: la página funciona igual
    tracking.push(...(res.data ?? []));
  }

  return {
    orders: (ordersRes.data ?? []).map(o => ({
      ...o,
      description: descBySku[o.sku] ?? '',
      tracking: tracking.filter(t => t.so_number === o.transfer_order_number),
    })),
  };
}

export function TransferOrders() {
  const { data, loading, error, refetch } = useQuery(fetchOpenTransferOrders, []);
  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    if (!data?.orders) return [];
    const q = search.toLowerCase();
    return data.orders
      .filter(order =>
        !search ||
        order.sku?.toLowerCase().includes(q) ||
        order.description?.toLowerCase().includes(q) ||
        order.vendor?.toLowerCase().includes(q) ||
        order.transfer_order_number?.toLowerCase().includes(q) ||
        order.status?.toLowerCase().includes(q)
      )
      .sort((a, b) => {
        if (!a.transfer_date) return 1;
        if (!b.transfer_date) return -1;
        return new Date(b.transfer_date) - new Date(a.transfer_date);
      });
  }, [data, search]);

  if (error) return <QueryError message={error} onRetry={refetch} />;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-sans font-semibold text-white">Open Transfer Orders</h1>
          <p className="text-xs text-muted font-mono mt-0.5">Actual transfer orders exported from NetSuite.</p>
        </div>
        <input
          type="search"
          placeholder="Search SKU, vendor, order number…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-card border border-white/[0.12] rounded px-3 py-2 text-sm font-mono text-white placeholder:text-muted focus:outline-none focus:border-accent/50 w-64"
        />
      </div>

      {!loading && (
        <div className="flex items-center gap-4 text-xs font-mono">
          <span className="text-muted">{rows.length} orders</span>
        </div>
      )}

      <section className="space-y-2">
        {loading ? <TableSkeleton rows={6} cols={9} /> : (
          <div className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    {['Order', 'Date', 'SKU', 'Vendor', 'From', 'To', 'Status', 'Qty Ordered', 'Qty Open', 'Unit Price', 'Remaining'].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={9} className="px-4 py-10 text-center text-muted font-mono">No open transfer orders found</td></tr>
                  ) : rows.map(order => (
                    <tr key={order.transfer_order_number} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                      <td className="px-3 py-2.5 font-mono text-accent whitespace-nowrap align-top">
                        {order.transfer_order_number}
                        {order.tracking?.length > 0 && (
                          <div className="mt-0.5 space-y-0.5">
                            {order.tracking.map((t, i) => (
                              <p key={i} className="text-[10px] text-success font-mono" title={`Despachado ${t.ship_date}`}>
                                {t.tracking}
                              </p>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-muted">{order.transfer_date ?? '—'}</td>
                      <td className="px-3 py-2.5 align-top max-w-[260px]">
                        <Link to={`/item/${order.sku}`} className="font-mono text-accent hover:text-accent/80">{order.sku}</Link>
                        {order.description && (
                          <p className="text-[10px] text-muted font-sans truncate" title={order.description}>{order.description}</p>
                        )}
                        {(order.origin_location || order.destination_location) && (
                          <div className="mt-1 text-[11px] text-slate-400 font-sans leading-tight">
                            <span>{formatLocationDisplay(order.origin_location)}</span>
                            <span className="mx-1">→</span>
                            <span>{formatLocationDisplay(order.destination_location)}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-slate-300 font-sans truncate" title={order.vendor}>{order.vendor ?? '—'}</td>
                      <td className="px-3 py-2.5 text-slate-300 font-sans truncate" title={order.origin_location}>{formatLocationDisplay(order.origin_location)}</td>
                      <td className="px-3 py-2.5 text-slate-300 font-sans truncate" title={order.destination_location}>{formatLocationDisplay(order.destination_location)}</td>
                      <td className="px-3 py-2.5 font-mono text-white">{order.status ?? '—'}</td>
                      <td className="px-3 py-2.5 font-mono text-white">{(order.qty_ordered ?? 0).toLocaleString()}</td>
                      <td className="px-3 py-2.5 font-mono text-white">{(order.qty_open ?? 0).toLocaleString()}</td>
                      <td className="px-3 py-2.5 font-mono text-white">{order.unit_price ? formatCurrency(order.unit_price) : '—'}</td>
                      <td className="px-3 py-2.5 font-mono text-white">{order.amount_remaining ? formatCurrency(order.amount_remaining) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2.5 border-t border-white/[0.06]">
              <p className="text-[10px] text-muted font-mono">{rows.length} open transfer orders</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
