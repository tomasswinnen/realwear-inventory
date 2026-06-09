import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, excludeSkus } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { CoverageCell } from '../components/CoverageCell';
import { SkuNoteBadge } from '../components/SkuNoteBadge';
import { QueryError } from '../components/QueryError';
import { TableSkeleton, KPISkeleton } from '../components/Skeleton';
import { KPICard } from '../components/KPICard';
import { calcMonthsCoverage, coverageBg, isValidSku } from '../utils/coverage';

async function fetchLocationsData() {
  const [skusRes, snapshotRes, salesRes, notesRes] = await Promise.all([
    excludeSkus(supabase.from('skus').select('sku, description, supplier')),
    excludeSkus(supabase.from('inventory_snapshot')
      .select('sku, on_hand_total, on_hand_portland, on_hand_hk, on_order, updated_at')
      .order('updated_at', { ascending: false })),
    excludeSkus(supabase.from('monthly_sales').select('sku, qty_sold, month').order('month', { ascending: false })),
    supabase.from('sku_notes').select('sku, note, status'),
  ]);
  for (const r of [skusRes, snapshotRes, salesRes]) {
    if (r.error) throw new Error(r.error.message);
  }
  return { skus: skusRes.data, snapshot: snapshotRes.data, sales: salesRes.data, notes: notesRes.data ?? [] };
}

function buildRows(skus, snapshot, sales) {
  const latestSnap = {};
  for (const s of snapshot) {
    if (!latestSnap[s.sku]) latestSnap[s.sku] = s;
  }
  const salesBySku = {};
  for (const s of sales) {
    if (!salesBySku[s.sku]) salesBySku[s.sku] = [];
    if (salesBySku[s.sku].length < 6) salesBySku[s.sku].push(s.qty_sold);
  }

  return skus.map(sku => {
    const snap = latestSnap[sku.sku] ?? {};
    const skuSales = salesBySku[sku.sku] ?? [];
    const avg6 = skuSales.length ? skuSales.reduce((a, b) => a + b, 0) / skuSales.length : 0;
    const portland = snap.on_hand_portland ?? 0;
    const hk = snap.on_hand_hk ?? 0;
    const total = snap.on_hand_total ?? 0;
    const onOrder = snap.on_order ?? 0;
    const monthsPortland = calcMonthsCoverage(portland, avg6);
    const monthsHk = calcMonthsCoverage(hk, avg6);
    const monthsTotal = calcMonthsCoverage(total + onOrder, avg6);
    return {
      sku: sku.sku, description: sku.description, supplier: sku.supplier,
      portland, hk, total, onOrder, avg6,
      monthsPortland, monthsHk, monthsTotal,
    };
  });
}

function LocationBar({ portland, hk, total }) {
  if (!total) return <span className="text-muted font-mono text-xs">0</span>;
  const pct = total > 0 ? (portland / total) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-2 bg-white/[0.06] rounded-full overflow-hidden">
        <div
          className="h-full bg-accent rounded-full"
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span className="text-[10px] font-mono text-muted">{Math.round(pct)}% PDX</span>
    </div>
  );
}

export function Locations() {
  const { data, loading, error, refetch } = useQuery(fetchLocationsData, []);
  const [search, setSearch] = useState('');
  const [locationFilter, setLocationFilter] = useState('all');
  const [criticalOnly, setCriticalOnly] = useState(false);

  const { rows, totals, notesBySku } = useMemo(() => {
    if (!data) return { rows: [], totals: {}, notesBySku: {} };
    const notesBySku = Object.fromEntries((data.notes ?? []).map(n => [n.sku, n]));
    const all = buildRows(data.skus.filter(s => isValidSku(s.sku)), data.snapshot, data.sales);
    const filtered = all.filter(r => {
      const matchSearch = !search || r.sku.toLowerCase().includes(search.toLowerCase()) || r.description?.toLowerCase().includes(search.toLowerCase());
      const matchLoc = locationFilter === 'all' || (locationFilter === 'portland' && r.portland > 0) || (locationFilter === 'hk' && r.hk > 0);
      const matchCritical = !criticalOnly || (isFinite(r.monthsPortland) && r.monthsPortland < 3) || (isFinite(r.monthsHk) && r.monthsHk < 3);
      return matchSearch && matchLoc && matchCritical;
    });
    const totals = {
      portland: all.reduce((s, r) => s + r.portland, 0),
      hk: all.reduce((s, r) => s + r.hk, 0),
      total: all.reduce((s, r) => s + r.total, 0),
    };
    return { rows: filtered, totals, notesBySku };
  }, [data, search, locationFilter, criticalOnly]);

  if (error) return <QueryError message={error} onRetry={refetch} />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-sans font-semibold text-white">Inventory by Location</h1>
        <p className="text-xs text-muted font-mono mt-0.5">Portland (PDX) vs Hong Kong (HK) on-hand stock</p>
      </div>

      {loading ? (
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => <KPISkeleton key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <KPICard label="Portland On Hand" value={totals.portland?.toLocaleString()} accent />
          <KPICard label="Hong Kong On Hand" value={totals.hk?.toLocaleString()} accent />
          <KPICard label="Total On Hand" value={totals.total?.toLocaleString()} color="text-white" />
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="search"
          placeholder="Search SKU…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-card border border-white/[0.12] rounded px-3 py-2 text-sm font-mono text-white placeholder:text-muted focus:outline-none focus:border-accent/50 w-56"
        />
        <div className="flex border border-white/[0.12] rounded overflow-hidden text-xs font-mono">
          {[['all', 'All'], ['portland', 'Portland'], ['hk', 'HK']].map(([val, label]) => (
            <button
              key={val}
              onClick={() => setLocationFilter(val)}
              className={`px-3 py-2 transition-colors ${locationFilter === val ? 'bg-accent text-white' : 'text-muted hover:text-white hover:bg-white/5'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setCriticalOnly(v => !v)}
          className={`px-3 py-2 rounded border text-xs font-mono transition-colors ${
            criticalOnly
              ? 'bg-danger/10 border-danger/40 text-danger'
              : 'border-white/[0.12] text-muted hover:text-white hover:bg-white/5'
          }`}
        >
          Critical only (&lt;3 mo)
        </button>
        {!loading && criticalOnly && (
          <span className="text-xs font-mono text-danger">{rows.length} critical SKUs</span>
        )}
      </div>

      {loading ? <TableSkeleton rows={8} cols={7} /> : (
        <div className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {['SKU', 'Description', 'Portland', 'PDX Mo.', 'Hong Kong', 'HK Mo.', 'Total', 'Coverage', 'Split'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-muted font-mono">No data</td></tr>
                ) : rows.map(row => (
                  <tr key={row.sku} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-2.5">
                      <Link to={`/item/${row.sku}`} className="font-mono text-accent hover:text-accent/80">{row.sku}</Link>
                      {notesBySku?.[row.sku] && (
                        <div className="mt-0.5">
                          <SkuNoteBadge noteData={notesBySku[row.sku]} />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-300 font-sans max-w-[150px] truncate" title={row.description}>{row.description}</td>
                    <td className="px-4 py-2.5 font-mono text-white">{row.portland.toLocaleString()}</td>
                    <td className="px-4 py-2.5">
                      <CoverageCell months={row.monthsPortland} />
                    </td>
                    <td className="px-4 py-2.5 font-mono text-white">{row.hk.toLocaleString()}</td>
                    <td className="px-4 py-2.5">
                      <CoverageCell months={row.monthsHk} />
                    </td>
                    <td className="px-4 py-2.5 font-mono text-white">{row.total.toLocaleString()}</td>
                    <td className="px-4 py-2.5"><CoverageCell months={row.monthsTotal} /></td>
                    <td className="px-4 py-2.5"><LocationBar portland={row.portland} hk={row.hk} total={row.total} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 border-t border-white/[0.06]">
            <p className="text-[10px] text-muted font-mono">{rows.length} SKUs</p>
          </div>
        </div>
      )}
    </div>
  );
}
