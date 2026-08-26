import { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { QueryError } from '../components/QueryError';
import { TableSkeleton, KPISkeleton } from '../components/Skeleton';
import { KPICard } from '../components/KPICard';
import { formatCurrency } from '../utils/coverage';
import { STAGE_WEIGHT } from '../utils/pipeline';

async function fetchScorecardData() {
  const [pipelineRes, stockRes] = await Promise.all([
    supabase.from('sales_pipeline').select('distributor, amount, deal_stage'),
    supabase.from('distributor_stock').select('distributor, sku, qty_on_hand, updated_at'),
  ]);
  if (pipelineRes.error) throw new Error(pipelineRes.error.message);
  if (stockRes.error) throw new Error(stockRes.error.message);
  return { pipeline: pipelineRes.data, stock: stockRes.data };
}

// Distributor names come from two different sources (HubSpot deal field vs a
// distributor's own stock report) and are never spelled identically —
// "ScanSource" vs "ScanSource, Inc.". Normalize to bare alphanumerics and
// match by containment so small punctuation/suffix differences don't matter.
function normalizeName(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
function namesMatch(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function buildScorecard(pipelineDeals, stockRows) {
  const stockByDist = new Map();
  for (const r of stockRows) {
    if (!stockByDist.has(r.distributor)) {
      stockByDist.set(r.distributor, { distributor: r.distributor, units: 0, skus: new Set(), lastUpdated: null });
    }
    const s = stockByDist.get(r.distributor);
    s.units += r.qty_on_hand ?? 0;
    s.skus.add(r.sku);
    if (!s.lastUpdated || (r.updated_at && r.updated_at > s.lastUpdated)) s.lastUpdated = r.updated_at;
  }

  const pipeByDist = new Map();
  for (const d of pipelineDeals) {
    if (!d.distributor) continue;
    if (!pipeByDist.has(d.distributor)) {
      pipeByDist.set(d.distributor, { distributor: d.distributor, deals: 0, open: 0, weighted: 0, won: 0 });
    }
    const p = pipeByDist.get(d.distributor);
    p.deals += 1;
    const amt = d.amount ?? 0;
    if (d.deal_stage === 'Closed won') p.won += amt;
    else { p.open += amt; p.weighted += amt * (STAGE_WEIGHT[d.deal_stage] ?? 0.5); }
  }

  const stockEntries = [...stockByDist.values()];
  const usedStock = new Set();
  const rows = [];

  for (const p of pipeByDist.values()) {
    const match = stockEntries.find(s => !usedStock.has(s.distributor) && namesMatch(s.distributor, p.distributor));
    if (match) usedStock.add(match.distributor);
    rows.push({
      distributor: p.distributor,
      units: match?.units ?? 0,
      skuCount: match ? match.skus.size : 0,
      stockUpdated: match?.lastUpdated ?? null,
      hasStock: !!match,
      matchedStockName: match?.distributor ?? null,
      deals: p.deals, open: p.open, weighted: p.weighted, won: p.won,
    });
  }
  for (const s of stockEntries) {
    if (usedStock.has(s.distributor)) continue;
    rows.push({
      distributor: s.distributor,
      units: s.units, skuCount: s.skus.size, stockUpdated: s.lastUpdated, hasStock: true, matchedStockName: s.distributor,
      deals: 0, open: 0, weighted: 0, won: 0,
    });
  }
  return rows;
}

export function DistributorScorecard() {
  const { data, loading, error, refetch } = useQuery(fetchScorecardData, []);
  const [search, setSearch] = useState('');
  const [onlyWithStock, setOnlyWithStock] = useState(true);

  const { rows, kpis } = useMemo(() => {
    if (!data) return { rows: [], kpis: {} };
    const all = buildScorecard(data.pipeline, data.stock);
    const q = search.toLowerCase();
    const filtered = all
      .filter(r => !onlyWithStock || r.hasStock)
      .filter(r => !search || r.distributor.toLowerCase().includes(q));
    const sorted = onlyWithStock
      ? filtered.sort((a, b) => b.units - a.units)
      : filtered.sort((a, b) => (b.weighted + b.won) - (a.weighted + a.won));

    const stockDistributors = new Set(data.stock.map(s => s.distributor)).size;
    const matched = all.filter(r => r.hasStock && r.deals > 0).length;

    return {
      rows: sorted,
      kpis: {
        stockDistributors,
        matched,
        unmatched: stockDistributors - matched,
      },
    };
  }, [data, search, onlyWithStock]);

  if (error) return <QueryError message={error} onRetry={refetch} />;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-sans font-semibold text-white">Distributor Scorecard</h1>
          <p className="text-xs text-muted font-mono mt-0.5">Stock on hand vs. sales pipeline, side by side</p>
        </div>
        <input
          type="search"
          placeholder="Search distributor…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-card border border-white/[0.12] rounded px-3 py-2 text-sm font-mono text-white placeholder:text-muted focus:outline-none focus:border-accent/50 w-full sm:w-64"
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => <KPISkeleton key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <KPICard label="Distributors Reporting Stock" value={kpis.stockDistributors} accent />
          <KPICard label="Matched to Pipeline" value={kpis.matched} sub="have deals in Sales Pipeline" color="text-success" />
          <KPICard label="Unmatched" value={kpis.unmatched} sub="stock reported, no matching deals" color={kpis.unmatched > 0 ? 'text-warning' : 'text-muted'} />
        </div>
      )}

      {!loading && kpis.unmatched > 0 && (
        <p className="text-[11px] font-mono text-muted">
          Matching is by name similarity between the stock report and HubSpot's Distributor field — some real matches can still be missed if the names are too different. Check "Unmatched" rows below.
        </p>
      )}

      <label className="flex items-center gap-2 text-xs font-mono text-muted cursor-pointer w-fit">
        <input
          type="checkbox"
          checked={onlyWithStock}
          onChange={e => setOnlyWithStock(e.target.checked)}
          className="accent-accent"
        />
        Only distributors with stock reported
      </label>

      {loading ? <TableSkeleton rows={6} cols={8} /> : (
        <div className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {['Distributor', 'Units On Hand', 'SKUs', 'Stock Updated', 'Weighted Forecast', 'Open Pipeline', 'Closed Won', 'Deals'].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left text-muted font-sans font-medium uppercase tracking-wider text-[10px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-muted font-mono">No distributors match your filters</td></tr>
                ) : rows.map(r => (
                  <tr key={r.distributor} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                    <td className="px-3 py-2.5 text-slate-200 font-sans">{r.distributor}</td>
                    <td className="px-3 py-2.5 font-mono text-white">{r.hasStock ? r.units.toLocaleString() : <span className="text-muted">—</span>}</td>
                    <td className="px-3 py-2.5 font-mono text-muted">{r.hasStock ? r.skuCount : '—'}</td>
                    <td className="px-3 py-2.5 font-mono text-muted">{r.stockUpdated ?? '—'}</td>
                    <td className="px-3 py-2.5 font-mono text-accent">{r.weighted > 0 ? formatCurrency(r.weighted) : <span className="text-muted">—</span>}</td>
                    <td className="px-3 py-2.5 font-mono text-white">{r.open > 0 ? formatCurrency(r.open) : <span className="text-muted">—</span>}</td>
                    <td className="px-3 py-2.5 font-mono text-success">{r.won > 0 ? formatCurrency(r.won) : <span className="text-muted">—</span>}</td>
                    <td className="px-3 py-2.5 font-mono text-muted">{r.deals || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 border-t border-white/[0.06]">
            <p className="text-[10px] text-muted font-mono">{rows.length} distributors</p>
          </div>
        </div>
      )}
    </div>
  );
}
