import { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { QueryError } from '../components/QueryError';
import { TableSkeleton, KPISkeleton } from '../components/Skeleton';
import { KPICard } from '../components/KPICard';
import { StatusBadge } from '../components/StatusBadge';
import { formatCurrency } from '../utils/coverage';

const NO_DISTRIBUTOR = '— No distributor listed —';
const STAGES = ['Contract & Negotiation', 'PO & $$$', 'Closed won'];

async function fetchSalesPipeline() {
  const res = await supabase
    .from('sales_pipeline')
    .select('*')
    .order('amount', { ascending: false, nullsFirst: false });
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

function formatDate(v) {
  if (!v) return '—';
  return new Date(`${v}T00:00:00`).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function groupByDistributor(deals) {
  const groups = new Map();
  for (const deal of deals) {
    const key = deal.distributor || NO_DISTRIBUTOR;
    if (!groups.has(key)) groups.set(key, { distributor: key, deals: [], total: 0, wonTotal: 0, openTotal: 0 });
    const g = groups.get(key);
    g.deals.push(deal);
    const amt = deal.amount ?? 0;
    g.total += amt;
    if (deal.deal_stage === 'Closed won') g.wonTotal += amt;
    else g.openTotal += amt;
  }
  return [...groups.values()].sort((a, b) => b.total - a.total);
}

function DealCard({ deal }) {
  return (
    <div className="border-b border-white/[0.04] px-4 py-3 hover:bg-white/[0.02] transition-colors last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-sans text-slate-200 leading-snug">{deal.deal_name}</p>
          <p className="text-[11px] font-mono text-muted mt-1 flex flex-wrap gap-x-2">
            {deal.company && <span>{deal.company}</span>}
            {deal.reseller && <span>· via {deal.reseller}</span>}
            {deal.deal_owner && <span>· {deal.deal_owner}</span>}
            {deal.state_region ? <span>· {deal.state_region}, {deal.country}</span> : deal.country && <span>· {deal.country}</span>}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="font-num text-white font-medium">{formatCurrency(deal.amount)}</p>
          <p className="text-[10px] font-mono text-muted mt-0.5">{formatDate(deal.close_date)}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <StatusBadge status={deal.deal_stage} />
        {(deal.line_items ?? []).map((item, i) => (
          <span
            key={item.id ?? i}
            title={item.id ? `Line item ID ${item.id}` : undefined}
            className="text-[10px] font-sans px-2 py-0.5 rounded bg-white/[0.05] text-slate-400 border border-white/[0.06]"
          >
            {item.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function DistributorGroup({ group, expanded, onToggle }) {
  const dealCount = group.deals.length;
  const wonCount = group.deals.filter(d => d.deal_stage === 'Closed won').length;
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
          <span className={`text-sm font-sans truncate ${group.distributor === NO_DISTRIBUTOR ? 'text-muted italic' : 'text-white font-medium'}`}>
            {group.distributor}
          </span>
          <span className="text-[10px] font-mono text-muted shrink-0">{dealCount} deal{dealCount === 1 ? '' : 's'} · {wonCount} won</span>
        </div>
        <span className="font-num text-white font-medium shrink-0">{formatCurrency(group.total)}</span>
      </button>
      {expanded && <div>{group.deals.map(d => <DealCard key={d.record_id} deal={d} />)}</div>}
    </div>
  );
}

export function SalesPipeline() {
  const { data, loading, error, refetch } = useQuery(fetchSalesPipeline, []);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('all');
  const [expanded, setExpanded] = useState(() => new Set());

  const { groups, totals } = useMemo(() => {
    if (!data) return { groups: [], totals: {} };
    const q = search.toLowerCase();
    const filtered = data.filter(d => {
      const matchStage = stageFilter === 'all' || d.deal_stage === stageFilter;
      const matchSearch = !search ||
        d.deal_name?.toLowerCase().includes(q) ||
        d.company?.toLowerCase().includes(q) ||
        d.distributor?.toLowerCase().includes(q) ||
        d.reseller?.toLowerCase().includes(q);
      return matchStage && matchSearch;
    });
    const totals = {
      total: data.reduce((s, d) => s + (d.amount ?? 0), 0),
      open: data.filter(d => d.deal_stage !== 'Closed won').reduce((s, d) => s + (d.amount ?? 0), 0),
      distributors: new Set(data.map(d => d.distributor).filter(Boolean)).size,
      deals: data.length,
    };
    return { groups: groupByDistributor(filtered), totals };
  }, [data, search, stageFilter]);

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
          <h1 className="text-xl font-sans font-semibold text-white">Sales Pipeline</h1>
          <p className="text-xs text-muted font-mono mt-0.5">Deals by distributor, imported from HubSpot</p>
        </div>
        <input
          type="search"
          placeholder="Search deal, company, distributor…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-card border border-white/[0.12] rounded px-3 py-2 text-sm font-mono text-white placeholder:text-muted focus:outline-none focus:border-accent/50 w-72"
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <KPISkeleton key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KPICard label="Total Pipeline" value={formatCurrency(totals.total)} accent />
          <KPICard label="Open Pipeline" value={formatCurrency(totals.open)} color="text-white" />
          <KPICard label="Deals" value={totals.deals?.toLocaleString()} color="text-white" />
          <KPICard label="Distributors" value={totals.distributors?.toLocaleString()} color="text-white" />
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex border border-white/[0.12] rounded overflow-hidden text-xs font-mono">
          <button
            onClick={() => setStageFilter('all')}
            className={`px-3 py-2 transition-colors ${stageFilter === 'all' ? 'bg-accent text-white' : 'text-muted hover:text-white hover:bg-white/5'}`}
          >
            All
          </button>
          {STAGES.map(s => (
            <button
              key={s}
              onClick={() => setStageFilter(s)}
              className={`px-3 py-2 transition-colors whitespace-nowrap ${stageFilter === s ? 'bg-accent text-white' : 'text-muted hover:text-white hover:bg-white/5'}`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={expandAll} className="text-[11px] font-mono text-muted hover:text-white transition-colors">Expand all</button>
          <span className="text-muted/40">·</span>
          <button onClick={collapseAll} className="text-[11px] font-mono text-muted hover:text-white transition-colors">Collapse all</button>
        </div>
      </div>

      {loading ? (
        <TableSkeleton rows={8} cols={4} />
      ) : groups.length === 0 ? (
        <div className="bg-card rounded-lg border border-white/[0.08] px-4 py-12 text-center">
          <p className="text-muted font-mono text-sm">No deals match your filters</p>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map(g => (
            <DistributorGroup
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
