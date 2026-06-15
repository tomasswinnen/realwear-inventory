import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, excludeSkus } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { CoverageCell } from '../components/CoverageCell';
import { QueryError } from '../components/QueryError';
import { TableSkeleton } from '../components/Skeleton';
import { calcMonthsCoverage, formatCurrency, isValidSku } from '../utils/coverage';

async function fetchReorderData() {
  const [skusRes, snapshotRes, forecastRes] = await Promise.all([
    excludeSkus(supabase.from('skus').select('*')),
    excludeSkus(supabase.from('inventory_snapshot').select('sku, on_hand_total, on_hand_portland, on_hand_hk, on_order').order('updated_at', { ascending: false })),
    excludeSkus(supabase.from('demand_forecast').select('sku, avg_3m, avg_6m')),
  ]);
  for (const r of [skusRes, snapshotRes, forecastRes]) {
    if (r.error) throw new Error(r.error.message);
  }
  return { skus: skusRes.data, snapshot: snapshotRes.data, forecast: forecastRes.data };
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

  const { reorderRows, transferRows } = useMemo(() => {
    if (!data) return { reorderRows: [], transferRows: [] };
    const latestSnap = {};
    for (const s of data.snapshot) {
      if (!latestSnap[s.sku]) latestSnap[s.sku] = s;
    }
    const demandMap = Object.fromEntries(data.forecast.map(f => [f.sku, f]));

    const reorderRows = [];
    const transferRows = [];

    data.skus
      .filter(sku => isValidSku(sku.sku))
      .forEach(sku => {
        const snap = latestSnap[sku.sku] ?? {};
        const fc   = demandMap[sku.sku];
        const avg6 = fc?.avg_6m ?? 0;
        const last3 = (fc?.avg_3m ?? 0) * 3;
        const onHand = snap.on_hand_total ?? 0;
        const onOrder = snap.on_order ?? 0;
        const portland = snap.on_hand_portland ?? 0;
        const hk = snap.on_hand_hk ?? 0;
        const months = calcMonthsCoverage(onHand + onOrder, avg6);
        const monthsPdx = calcMonthsCoverage(portland, avg6);
        const monthsHk = calcMonthsCoverage(hk, avg6);

        if (isFinite(months) && months < 3) {
          const suggested = calcSuggestedQty(sku, avg6);
          reorderRows.push({ ...sku, onHand, onOrder, portland, hk, avg6, last3, months, monthsPdx, monthsHk, suggested });
        } else if (avg6 > 0) {
          // Total stock is OK — check if one warehouse is critically low while the other has plenty
          const pdxLow = isFinite(monthsPdx) && monthsPdx < 2;
          const hkLow  = isFinite(monthsHk)  && monthsHk  < 2;
          const pdxOk  = !isFinite(monthsPdx) || monthsPdx >= 3;
          const hkOk   = !isFinite(monthsHk)  || monthsHk  >= 3;
          if (avg6 >= 1 && ((pdxLow && hkOk) || (hkLow && pdxOk))) {
            const from = pdxLow ? 'HK → PDX' : 'PDX → HK';
            const lowWh = pdxLow ? 'Portland' : 'Hong Kong';
            const qty = Math.ceil(avg6 * 3) - (pdxLow ? portland : hk);
            transferRows.push({ ...sku, onHand, portland, hk, avg6, months, monthsPdx, monthsHk, from, lowWh, transferQty: Math.max(0, qty) });
          }
        }
      });

    const q = search.toLowerCase();
    const filt = r => !search || r.sku.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q);
    return {
      reorderRows: reorderRows.sort((a, b) => a.months - b.months).filter(filt),
      transferRows: transferRows.sort((a, b) => a.monthsPdx - a.monthsHk > 0 ? 1 : -1).filter(filt),
    };
  }, [data, search]);

  function handleDraftEmail(row) {
    const { subject, body, to } = buildEmailDraft(row, row.suggested, row.avg6);
    const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(mailto, '_blank');
  }

  if (error) return <QueryError message={error} onRetry={refetch} />;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-sans font-semibold text-white">Reorder Alerts</h1>
          <p className="text-xs text-muted font-mono mt-0.5">SKUs with &lt; 3 months total coverage, or imbalanced between warehouses</p>
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
          <span className="text-danger">{reorderRows.filter(r => r.months < 1).length} urgent (&lt;1mo)</span>
          <span className="text-warning">{reorderRows.filter(r => r.months >= 1 && r.months < 3).length} watch (1–3mo)</span>
          <span className="text-muted">{reorderRows.length} reorders · {transferRows.length} transfers</span>
        </div>
      )}

      {/* ── Reorder Alerts ── */}
      <section className="space-y-2">
        <h2 className="text-sm font-sans font-semibold text-white">Purchase Orders needed</h2>
        {loading ? <TableSkeleton rows={6} cols={11} /> : (
          <div className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    {['SKU', 'Description', 'On Hand', 'On Order', 'Avg/Mo', 'Last 3 Mo', 'Coverage', 'PDX', 'HK', 'Supplier', 'Lead', 'Suggested Qty', 'Action'].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reorderRows.length === 0 ? (
                    <tr><td colSpan={13} className="px-4 py-10 text-center text-muted font-mono">No SKUs need reordering right now</td></tr>
                  ) : reorderRows.map(row => (
                    <tr key={row.sku} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                      <td className="px-3 py-2.5"><Link to={`/item/${row.sku}`} className="font-mono text-accent hover:text-accent/80">{row.sku}</Link></td>
                      <td className="px-3 py-2.5 text-slate-300 font-sans max-w-[120px] truncate" title={row.description}>{row.description}</td>
                      <td className="px-3 py-2.5 font-mono text-white">{row.onHand.toLocaleString()}</td>
                      <td className="px-3 py-2.5 font-mono text-muted">{row.onOrder.toLocaleString()}</td>
                      <td className="px-3 py-2.5 font-mono text-white">{row.avg6.toFixed(0)}</td>
                      <td className="px-3 py-2.5 font-mono text-slate-300">{row.last3.toLocaleString()}</td>
                      <td className="px-3 py-2.5"><CoverageCell months={row.months} /></td>
                      <td className="px-3 py-2.5"><CoverageCell months={row.monthsPdx} /></td>
                      <td className="px-3 py-2.5"><CoverageCell months={row.monthsHk} /></td>
                      <td className="px-3 py-2.5 text-muted font-sans">{row.supplier}</td>
                      <td className="px-3 py-2.5 font-mono text-muted">{row.lead_time_days ? `${row.lead_time_days}d` : '—'}</td>
                      <td className="px-3 py-2.5">
                        <span className="font-mono text-white font-medium">{row.suggested.toLocaleString()}</span>
                        {row.unit_cost > 0 && <span className="ml-1 text-muted">({formatCurrency(row.suggested * row.unit_cost)})</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <button onClick={() => handleDraftEmail(row)} className="text-[10px] font-mono px-2 py-1 border border-accent/30 text-accent hover:bg-accent/10 rounded transition-colors whitespace-nowrap">
                          Draft email
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2.5 border-t border-white/[0.06]">
              <p className="text-[10px] text-muted font-mono">{reorderRows.length} alerts</p>
            </div>
          </div>
        )}
      </section>

      {/* ── Transfer Alerts ── */}
      <section className="space-y-2">
        <div>
          <h2 className="text-sm font-sans font-semibold text-white">Transfer Orders needed</h2>
          <p className="text-[11px] text-muted font-mono mt-0.5">Total stock is OK but one warehouse has &lt; 2 months coverage — consider a transfer instead of a new PO</p>
        </div>
        {loading ? <TableSkeleton rows={4} cols={8} /> : (
          <div className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    {['SKU', 'Description', 'Avg/Mo', 'Total', 'Portland', 'PDX Coverage', 'Hong Kong', 'HK Coverage', 'Direction', 'Suggested Transfer'].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {transferRows.length === 0 ? (
                    <tr><td colSpan={10} className="px-4 py-10 text-center text-muted font-mono">No warehouse imbalances detected</td></tr>
                  ) : transferRows.map(row => (
                    <tr key={row.sku} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                      <td className="px-3 py-2.5"><Link to={`/item/${row.sku}`} className="font-mono text-accent hover:text-accent/80">{row.sku}</Link></td>
                      <td className="px-3 py-2.5 text-slate-300 font-sans max-w-[130px] truncate" title={row.description}>{row.description}</td>
                      <td className="px-3 py-2.5 font-mono text-white">{row.avg6.toFixed(0)}</td>
                      <td className="px-3 py-2.5 font-mono text-white">{row.onHand.toLocaleString()}</td>
                      <td className={`px-3 py-2.5 font-mono ${row.lowWh === 'Portland' ? 'text-warning' : 'text-white'}`}>{row.portland.toLocaleString()}</td>
                      <td className="px-3 py-2.5"><CoverageCell months={row.monthsPdx} /></td>
                      <td className={`px-3 py-2.5 font-mono ${row.lowWh === 'Hong Kong' ? 'text-warning' : 'text-white'}`}>{row.hk.toLocaleString()}</td>
                      <td className="px-3 py-2.5"><CoverageCell months={row.monthsHk} /></td>
                      <td className="px-3 py-2.5">
                        <span className="font-mono text-xs px-2 py-0.5 rounded bg-warning/10 text-warning border border-warning/20">{row.from}</span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-white font-medium">{row.transferQty.toLocaleString()} units</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2.5 border-t border-white/[0.06]">
              <p className="text-[10px] text-muted font-mono">{transferRows.length} potential transfers</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
