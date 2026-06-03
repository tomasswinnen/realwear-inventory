import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { CoverageCell } from '../components/CoverageCell';
import { QueryError } from '../components/QueryError';
import { TableSkeleton } from '../components/Skeleton';
import { calcMonthsCoverage, formatCurrency } from '../utils/coverage';

async function fetchReorderData() {
  const [skusRes, snapshotRes, salesRes] = await Promise.all([
    supabase.from('skus').select('*'),
    supabase.from('inventory_snapshot').select('sku, on_hand_total, on_order').order('updated_at', { ascending: false }),
    supabase.from('monthly_sales').select('sku, qty_sold').order('month', { ascending: false }),
  ]);
  for (const r of [skusRes, snapshotRes, salesRes]) {
    if (r.error) throw new Error(r.error.message);
  }
  return { skus: skusRes.data, snapshot: snapshotRes.data, sales: salesRes.data };
}

function calcSuggestedQty(skuInfo, avg6) {
  // Cover 6 months of demand at lead-time safety + MOQ floor
  const leadMonths = (skuInfo.lead_time_days ?? 30) / 30;
  const target = avg6 * (leadMonths + 3); // 3-month buffer beyond lead time
  return Math.max(skuInfo.moq ?? 0, Math.ceil(target / (skuInfo.moq || 1)) * (skuInfo.moq || 1));
}

function buildEmailDraft(sku, suggested, avg6) {
  const subject = `Purchase Order Request – ${sku.sku}`;
  const body = [
    `Hi ${sku.supplier ?? 'Team'},`,
    '',
    `We would like to place a purchase order for the following item:`,
    '',
    `  SKU:         ${sku.sku}`,
    `  Description: ${sku.description ?? ''}`,
    `  Qty:         ${suggested} units`,
    `  Unit Cost:   ${formatCurrency(sku.unit_cost)}`,
    `  MOQ:         ${sku.moq ?? 'N/A'}`,
    `  Lead Time:   ${sku.lead_time_days ?? 'N/A'} days`,
    '',
    `Current avg monthly demand is ${avg6.toFixed(0)} units.`,
    `Please confirm availability and expected ship date.`,
    '',
    'Thank you,',
    'RealWear Inventory Team',
  ].join('\n');
  return { subject, body, to: sku.supplier_email ?? '' };
}

export function ReorderAlerts() {
  const { data, loading, error, refetch } = useQuery(fetchReorderData, []);
  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    if (!data) return [];
    const latestSnap = {};
    for (const s of data.snapshot) {
      if (!latestSnap[s.sku]) latestSnap[s.sku] = s;
    }
    const salesBySku = {};
    for (const s of data.sales) {
      if (!salesBySku[s.sku]) salesBySku[s.sku] = [];
      if (salesBySku[s.sku].length < 6) salesBySku[s.sku].push(s.qty_sold);
    }

    const skuMap = Object.fromEntries(data.skus.map(s => [s.sku, s]));

    const EXCLUDED_SKUS = new Set(['171040', '171041', '171042']);

    return data.skus
      .filter(sku => {
        if (EXCLUDED_SKUS.has(sku.sku)) return false;
        if (sku.description?.toLowerCase().includes('flash')) return false;
        return true;
      })
      .map(sku => {
        const snap = latestSnap[sku.sku] ?? {};
        const skuSales = salesBySku[sku.sku] ?? [];
        const avg6 = skuSales.length ? skuSales.reduce((a, b) => a + b, 0) / skuSales.length : 0;
        const last3 = skuSales.slice(0, 3).reduce((a, b) => a + b, 0);
        const onHand = snap.on_hand_total ?? 0;
        const onOrder = snap.on_order ?? 0;
        const months = calcMonthsCoverage(onHand + onOrder, avg6);
        if (!isFinite(months) || months >= 3) return null;
        const suggested = calcSuggestedQty(sku, avg6);
        return { ...sku, onHand, onOrder, avg6, last3, months, suggested };
      })
      .filter(Boolean)
      .sort((a, b) => a.months - b.months)
      .filter(r => !search || r.sku.toLowerCase().includes(search.toLowerCase()) || r.description?.toLowerCase().includes(search.toLowerCase()));
  }, [data, search]);

  function handleDraftEmail(row) {
    const { subject, body, to } = buildEmailDraft(row, row.suggested, row.avg6);
    const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(mailto, '_blank');
  }

  if (error) return <QueryError message={error} onRetry={refetch} />;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-sans font-semibold text-white">Reorder Alerts</h1>
          <p className="text-xs text-muted font-mono mt-0.5">SKUs with &lt; 3 months coverage</p>
        </div>
        <input
          type="search"
          placeholder="Search SKU…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-card border border-white/[0.12] rounded px-3 py-2 text-sm font-mono text-white placeholder:text-muted focus:outline-none focus:border-accent/50 w-56"
        />
      </div>

      {!loading && (
        <div className="flex items-center gap-4 text-xs font-mono">
          <span className="text-danger">{rows.filter(r => r.months < 1).length} urgent (&lt;1mo)</span>
          <span className="text-warning">{rows.filter(r => r.months >= 1 && r.months < 3).length} watch (1–3mo)</span>
          <span className="text-muted">{rows.length} total alerts</span>
        </div>
      )}

      {loading ? <TableSkeleton rows={8} cols={8} /> : (
        <div className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {['SKU', 'Description', 'On Hand', 'On Order', 'Avg/Mo', 'Last 3 Mo', 'Coverage', 'Supplier', 'Lead Time', 'Suggested Qty', 'Action'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-10 text-center text-muted font-mono">
                      No SKUs need reordering right now
                    </td>
                  </tr>
                ) : rows.map(row => (
                  <tr key={row.sku} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-2.5">
                      <Link to={`/item/${row.sku}`} className="font-mono text-accent hover:text-accent/80">{row.sku}</Link>
                    </td>
                    <td className="px-4 py-2.5 text-slate-300 font-sans max-w-[140px] truncate" title={row.description}>{row.description}</td>
                    <td className="px-4 py-2.5 font-mono text-white">{row.onHand.toLocaleString()}</td>
                    <td className="px-4 py-2.5 font-mono text-muted">{row.onOrder.toLocaleString()}</td>
                    <td className="px-4 py-2.5 font-mono text-white">{row.avg6.toFixed(0)}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-300">{row.last3.toLocaleString()}</td>
                    <td className="px-4 py-2.5"><CoverageCell months={row.months} /></td>
                    <td className="px-4 py-2.5 text-muted font-sans">{row.supplier}</td>
                    <td className="px-4 py-2.5 font-mono text-muted">{row.lead_time_days ? `${row.lead_time_days}d` : '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-white font-medium">{row.suggested.toLocaleString()}</span>
                      {row.unit_cost > 0 && (
                        <span className="ml-1 text-muted">({formatCurrency(row.suggested * row.unit_cost)})</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => handleDraftEmail(row)}
                        className="text-[10px] font-mono px-2 py-1 border border-accent/30 text-accent hover:bg-accent/10 rounded transition-colors whitespace-nowrap"
                      >
                        Draft email
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 border-t border-white/[0.06]">
            <p className="text-[10px] text-muted font-mono">{rows.length} alerts</p>
          </div>
        </div>
      )}
    </div>
  );
}
