import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { StatusBadge } from '../components/StatusBadge';
import { QueryError } from '../components/QueryError';
import { TableSkeleton, KPISkeleton } from '../components/Skeleton';
import { KPICard } from '../components/KPICard';
import { formatCurrency, isValidSku } from '../utils/coverage';

// Statuses that count as "on order" (not yet fully received)
const ACTIVE_STATUSES = new Set([
  'Open', 'Pending', 'Partial',
  'Partially Received', 'Pending Bill',
  'Pending Billing/Partially Received',
]);

async function fetchOnOrderData() {
  const [skusRes, snapshotRes, poRes] = await Promise.all([
    supabase.from('skus').select('sku, description, supplier, unit_cost, lead_time_days'),
    supabase.from('inventory_snapshot')
      .select('sku, on_hand_total, on_hand_portland, on_hand_hk, on_order, updated_at')
      .order('updated_at', { ascending: false }),
    supabase.from('po_history').select('*').order('created_at', { ascending: false }),
  ]);
  for (const r of [skusRes, snapshotRes, poRes]) {
    if (r.error) throw new Error(r.error.message);
  }
  return { skus: skusRes.data, snapshot: snapshotRes.data, pos: poRes.data };
}

export function OnOrder() {
  const { data, loading, error, refetch } = useQuery(fetchOnOrderData, []);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');

  const { rows, kpis, allStatuses } = useMemo(() => {
    if (!data) return { rows: [], kpis: {}, allStatuses: [] };

    const skuMap = Object.fromEntries(data.skus.map(s => [s.sku, s]));

    // Latest snapshot per SKU
    const latestSnap = {};
    for (const s of data.snapshot) {
      if (!latestSnap[s.sku]) latestSnap[s.sku] = s;
    }

    const validPos = data.pos.filter(p => isValidSku(p.sku));

    // All unique statuses present in the data
    const allStatuses = [...new Set(validPos.map(p => p.status))].sort();

    // Build rows from po_history, joining sku + snapshot info
    const rows = validPos
      .filter(po => {
        const matchStatus =
          statusFilter === 'all' ||
          (statusFilter === 'active' && ACTIVE_STATUSES.has(po.status)) ||
          statusFilter === po.status;
        const matchSearch = !search ||
          po.sku.toLowerCase().includes(search.toLowerCase()) ||
          po.po_number?.toLowerCase().includes(search.toLowerCase()) ||
          po.vendor?.toLowerCase().includes(search.toLowerCase()) ||
          (skuMap[po.sku]?.description ?? '').toLowerCase().includes(search.toLowerCase());
        return matchStatus && matchSearch;
      })
      .map(po => {
        const info = skuMap[po.sku] ?? {};
        const snap = latestSnap[po.sku] ?? {};
        const unitCost = po.unit_cost ?? info.unit_cost ?? 0;
        const totalValue = (po.qty_ordered ?? 0) * unitCost;
        return {
          ...po,
          description: info.description,
          supplier: po.vendor ?? info.supplier,
          unitCost,
          totalValue,
          leadTime: info.lead_time_days,
          onHand: snap.on_hand_total ?? 0,
          onHandPortland: snap.on_hand_portland ?? 0,
          onHandHk: snap.on_hand_hk ?? 0,
          isActive: ACTIVE_STATUSES.has(po.status),
        };
      });

    // KPIs over active POs only (regardless of current filter)
    const activePOs = validPos.filter(p => ACTIVE_STATUSES.has(p.status));
    const activeSkus = new Set(activePOs.map(p => p.sku));
    const totalUnits = activePOs.reduce((s, p) => s + (p.qty_ordered ?? 0), 0);
    const totalValue = activePOs.reduce((s, p) => {
      const cost = p.unit_cost ?? skuMap[p.sku]?.unit_cost ?? 0;
      return s + (p.qty_ordered ?? 0) * cost;
    }, 0);

    return {
      rows,
      kpis: {
        activePOs: activePOs.length,
        activeSkus: activeSkus.size,
        totalUnits,
        totalValue,
      },
      allStatuses,
    };
  }, [data, search, statusFilter]);

  function handleDraftEmail(row) {
    const subject = `Purchase Order Follow-up – ${row.po_number ?? row.sku}`;
    const body = [
      `Hi ${row.supplier ?? 'Team'},`,
      '',
      `Could you please provide a status update on the following purchase order?`,
      '',
      `  PO Number:   ${row.po_number ?? 'N/A'}`,
      `  SKU:         ${row.sku}`,
      `  Description: ${row.description ?? ''}`,
      `  Qty Ordered: ${(row.qty_ordered ?? 0).toLocaleString()} units`,
      `  Status:      ${row.status}`,
      '',
      `Please confirm the expected ship/delivery date.`,
      '',
      'Thank you,',
      'RealWear Inventory Team',
    ].join('\n');
    window.open(
      `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
      '_blank'
    );
  }

  if (error) return <QueryError message={error} onRetry={refetch} />;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-sans font-semibold text-white">Items On Order</h1>
        <p className="text-xs text-muted font-mono mt-0.5">Outstanding purchase orders</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <KPISkeleton key={i} />)
        ) : (
          <>
            <KPICard label="Active POs" value={kpis.activePOs} accent />
            <KPICard label="SKUs on Order" value={kpis.activeSkus} color="text-white" />
            <KPICard label="Total Units Ordered" value={kpis.totalUnits?.toLocaleString()} color="text-white" />
            <KPICard label="Order Value" value={formatCurrency(kpis.totalValue)} color="text-success" />
          </>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="search"
          placeholder="Search SKU, PO#, vendor…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-card border border-white/[0.12] rounded px-3 py-2 text-sm font-mono text-white placeholder:text-muted focus:outline-none focus:border-accent/50 w-64"
        />

        <div className="flex border border-white/[0.12] rounded overflow-hidden text-xs font-mono">
          {[['active', 'Active'], ['all', 'All']].map(([val, label]) => (
            <button
              key={val}
              onClick={() => setStatusFilter(val)}
              className={`px-3 py-2 transition-colors ${statusFilter === val ? 'bg-accent text-white' : 'text-muted hover:text-white hover:bg-white/5'}`}
            >
              {label}
            </button>
          ))}
          {allStatuses.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-2 transition-colors whitespace-nowrap ${statusFilter === s ? 'bg-accent text-white' : 'text-muted hover:text-white hover:bg-white/5'}`}
            >
              {s}
            </button>
          ))}
        </div>

        {!loading && (
          <span className="ml-auto text-xs font-mono text-muted">
            {rows.length} POs · {formatCurrency(rows.reduce((s, r) => s + r.totalValue, 0))}
          </span>
        )}
      </div>

      {/* Table */}
      {loading ? <TableSkeleton rows={10} cols={9} /> : (
        <div className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {['SKU', 'Description', 'PO #', 'Vendor', 'Status', 'Qty Ordered', 'On Hand', 'Unit Cost', 'Total Value', 'Lead Time', ''].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px] whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-10 text-center text-muted font-mono">
                      No purchase orders found
                    </td>
                  </tr>
                ) : rows.map(row => (
                  <tr
                    key={row.id}
                    className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors"
                    style={row.isActive ? {} : { opacity: 0.55 }}
                  >
                    <td className="px-4 py-2.5">
                      <Link to={`/item/${row.sku}`} className="font-mono text-accent hover:text-accent/80 transition-colors">
                        {row.sku}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-slate-300 font-sans max-w-[160px] truncate" title={row.description}>
                      {row.description}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-300">{row.po_number}</td>
                    <td className="px-4 py-2.5 text-muted font-sans max-w-[140px] truncate" title={row.supplier}>
                      {row.supplier}
                    </td>
                    <td className="px-4 py-2.5"><StatusBadge status={row.status} /></td>
                    <td className="px-4 py-2.5 font-mono text-white font-medium">
                      {(row.qty_ordered ?? 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-muted">
                      {row.onHand.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-white">{formatCurrency(row.unitCost)}</td>
                    <td className="px-4 py-2.5 font-mono text-white">{formatCurrency(row.totalValue)}</td>
                    <td className="px-4 py-2.5 font-mono text-muted">
                      {row.leadTime ? `${row.leadTime}d` : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      {row.isActive && (
                        <button
                          onClick={() => handleDraftEmail(row)}
                          className="text-[10px] font-mono px-2 py-1 border border-accent/30 text-accent hover:bg-accent/10 rounded transition-colors whitespace-nowrap"
                        >
                          Follow up
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 border-t border-white/[0.06] flex items-center justify-between">
            <p className="text-[10px] text-muted font-mono">{rows.length} records</p>
            <p className="text-[10px] text-muted font-mono">
              Total: {formatCurrency(rows.reduce((s, r) => s + r.totalValue, 0))}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
