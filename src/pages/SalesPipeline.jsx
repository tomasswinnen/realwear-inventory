import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import { supabase } from '../lib/supabase';
import { useQuery } from '../hooks/useQuery';
import { QueryError } from '../components/QueryError';
import { TableSkeleton, KPISkeleton, ChartSkeleton } from '../components/Skeleton';
import { KPICard } from '../components/KPICard';
import { StatusBadge } from '../components/StatusBadge';
import { formatCurrency } from '../utils/coverage';
import { OPEN_STAGES, STAGE_WEIGHT } from '../utils/pipeline';

const NO_DISTRIBUTOR = '— No distributor listed —';
const STAGES = ['Contract & Negotiation', 'PO & $$$', 'Closed won'];
const STAGE_COLOR = { 'Contract & Negotiation': '#0ea5e9', 'PO & $$$': '#60a5fa' };

const todayStr = new Date().toISOString().slice(0, 10);
const in90Str = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);

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

function monthBucket(closeDate) {
  if (!closeDate) return 'No Close Date';
  return closeDate < todayStr ? 'Overdue' : closeDate.slice(0, 7);
}

function monthLabel(bucket) {
  if (bucket === 'Overdue' || bucket === 'No Close Date') return bucket;
  const [y, m] = bucket.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function bucketSortKey(bucket) {
  if (bucket === 'Overdue') return '0';
  if (bucket === 'No Close Date') return '9';
  return `1${bucket}`;
}

function groupByDistributor(deals) {
  const groups = new Map();
  for (const deal of deals) {
    const key = deal.distributor || NO_DISTRIBUTOR;
    if (!groups.has(key)) groups.set(key, { distributor: key, deals: [], total: 0, wonTotal: 0, weightedOpen: 0 });
    const g = groups.get(key);
    g.deals.push(deal);
    const amt = deal.amount ?? 0;
    g.total += amt;
    if (deal.deal_stage === 'Closed won') g.wonTotal += amt;
    else g.weightedOpen += amt * (STAGE_WEIGHT[deal.deal_stage] ?? 0.5);
  }
  return [...groups.values()].sort((a, b) => b.total - a.total);
}

function groupByMonth(openDeals) {
  const groups = new Map();
  for (const deal of openDeals) {
    const bucket = monthBucket(deal.close_date);
    if (!groups.has(bucket)) groups.set(bucket, { bucket, label: monthLabel(bucket), deals: [], total: 0, weighted: 0 });
    const g = groups.get(bucket);
    g.deals.push(deal);
    const amt = deal.amount ?? 0;
    g.total += amt;
    g.weighted += amt * (STAGE_WEIGHT[deal.deal_stage] ?? 0.5);
  }
  for (const g of groups.values()) {
    g.deals.sort((a, b) => (a.close_date ?? '9999').localeCompare(b.close_date ?? '9999'));
  }
  return [...groups.values()].sort((a, b) => bucketSortKey(a.bucket).localeCompare(bucketSortKey(b.bucket)));
}

function ForecastTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div className="px-3 py-2 rounded" style={{ backgroundColor: '#162030', border: '1px solid rgba(148,163,184,0.12)' }}>
      <p className="font-sans text-white text-xs mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} className="font-mono text-xs" style={{ color: p.fill }}>
          {p.dataKey}: {formatCurrency(p.value)}
        </p>
      ))}
      <p className="font-mono text-xs text-muted mt-1 pt-1 border-t border-white/[0.08]">Total: {formatCurrency(total)}</p>
    </div>
  );
}

function AccordionHeader({ expanded, onToggle, title, titleClass, subtitle, right, rightSub }) {
  return (
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
        <span className={`text-sm font-sans truncate ${titleClass ?? 'text-white font-medium'}`}>{title}</span>
        <span className="text-[10px] font-mono text-muted shrink-0">{subtitle}</span>
      </div>
      <div className="text-right shrink-0">
        <div className="font-num text-white font-medium">{right}</div>
        {rightSub && <div className="text-[10px] font-mono text-muted mt-0.5">{rightSub}</div>}
      </div>
    </button>
  );
}

function DealCard({ deal }) {
  return (
    <div className="border-b border-white/[0.04] px-4 py-3 hover:bg-white/[0.02] transition-colors last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-sans text-slate-200 leading-snug">{deal.deal_name}</p>
          <p className="text-[11px] font-mono text-muted mt-1 flex flex-wrap gap-x-2">
            {deal.distributor && <span>{deal.distributor}</span>}
            {deal.company && <span>· {deal.company}</span>}
            {deal.reseller && <span>· via {deal.reseller}</span>}
            {deal.deal_owner && <span>· {deal.deal_owner}</span>}
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

function MonthGroup({ group, expanded, onToggle }) {
  return (
    <div className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
      <AccordionHeader
        expanded={expanded}
        onToggle={onToggle}
        title={group.label}
        titleClass={group.bucket === 'Overdue' ? 'text-danger font-medium' : 'text-white font-medium'}
        subtitle={`${group.deals.length} deal${group.deals.length === 1 ? '' : 's'}`}
        right={formatCurrency(group.total)}
        rightSub={`~${formatCurrency(group.weighted)} weighted`}
      />
      {expanded && <div>{group.deals.map(d => <DealCard key={d.record_id} deal={d} />)}</div>}
    </div>
  );
}

function DistributorGroup({ group, expanded, onToggle }) {
  const dealCount = group.deals.length;
  const wonCount = group.deals.filter(d => d.deal_stage === 'Closed won').length;
  return (
    <div className="bg-card rounded-lg border border-white/[0.08] overflow-hidden">
      <AccordionHeader
        expanded={expanded}
        onToggle={onToggle}
        title={group.distributor}
        titleClass={group.distributor === NO_DISTRIBUTOR ? 'text-muted italic' : 'text-white font-medium'}
        subtitle={`${dealCount} deal${dealCount === 1 ? '' : 's'} · ${wonCount} won`}
        right={formatCurrency(group.total)}
        rightSub={group.weightedOpen > 0 ? `~${formatCurrency(group.weightedOpen)} forecast` : undefined}
      />
      {expanded && <div>{group.deals.map(d => <DealCard key={d.record_id} deal={d} />)}</div>}
    </div>
  );
}

export function SalesPipeline() {
  const { data, loading, error, refetch } = useQuery(fetchSalesPipeline, []);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('all');
  const [expandedDist, setExpandedDist] = useState(() => new Set());
  const [expandedMonth, setExpandedMonth] = useState(() => new Set());

  const { distGroups, monthGroups, chartData, kpis } = useMemo(() => {
    if (!data) return { distGroups: [], monthGroups: [], chartData: [], kpis: {} };
    const q = search.toLowerCase();
    const matchesSearch = d => !search ||
      d.deal_name?.toLowerCase().includes(q) ||
      d.company?.toLowerCase().includes(q) ||
      d.distributor?.toLowerCase().includes(q) ||
      d.reseller?.toLowerCase().includes(q);

    const filtered = data.filter(d => (stageFilter === 'all' || d.deal_stage === stageFilter) && matchesSearch(d));
    const openSearched = data.filter(d => OPEN_STAGES.includes(d.deal_stage) && matchesSearch(d));

    const monthGroups = groupByMonth(openSearched);
    const chartData = monthGroups
      .filter(g => g.bucket !== 'No Close Date')
      .map(g => ({
        label: g.label,
        'Contract & Negotiation': g.deals.filter(d => d.deal_stage === 'Contract & Negotiation').reduce((s, d) => s + (d.amount ?? 0), 0),
        'PO & $$$': g.deals.filter(d => d.deal_stage === 'PO & $$$').reduce((s, d) => s + (d.amount ?? 0), 0),
      }));

    const overdue = openSearched.filter(d => monthBucket(d.close_date) === 'Overdue');
    const next90 = openSearched.filter(d => d.close_date && d.close_date >= todayStr && d.close_date <= in90Str);

    const kpis = {
      weighted: openSearched.reduce((s, d) => s + (d.amount ?? 0) * (STAGE_WEIGHT[d.deal_stage] ?? 0.5), 0),
      open: openSearched.reduce((s, d) => s + (d.amount ?? 0), 0),
      next90: next90.reduce((s, d) => s + (d.amount ?? 0), 0),
      overdueTotal: overdue.reduce((s, d) => s + (d.amount ?? 0), 0),
      overdueCount: overdue.length,
      won: data.filter(d => d.deal_stage === 'Closed won' && matchesSearch(d)).reduce((s, d) => s + (d.amount ?? 0), 0),
    };

    return { distGroups: groupByDistributor(filtered), monthGroups, chartData, kpis };
  }, [data, search, stageFilter]);

  function toggle(setFn, key) {
    setFn(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (error) return <QueryError message={error} onRetry={refetch} />;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-sans font-semibold text-white">Sales Pipeline</h1>
          <p className="text-xs text-muted font-mono mt-0.5">Forecast of incoming business, imported from HubSpot</p>
        </div>
        <input
          type="search"
          placeholder="Search deal, company, distributor…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-card border border-white/[0.12] rounded px-3 py-2 text-sm font-mono text-white placeholder:text-muted focus:outline-none focus:border-accent/50 w-full sm:w-72"
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => <KPISkeleton key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <KPICard label="Weighted Forecast" value={formatCurrency(kpis.weighted)} sub="open deals, probability-adjusted" accent />
          <KPICard label="Open Pipeline" value={formatCurrency(kpis.open)} sub="unweighted" color="text-white" />
          <KPICard label="Next 90 Days" value={formatCurrency(kpis.next90)} sub="expected to close" color="text-white" />
          <KPICard label="Overdue" value={formatCurrency(kpis.overdueTotal)} sub={`${kpis.overdueCount} deal${kpis.overdueCount === 1 ? '' : 's'} past close date`} color={kpis.overdueCount > 0 ? 'text-danger' : 'text-muted'} />
          <KPICard label="Closed Won" value={formatCurrency(kpis.won)} sub="already booked" color="text-success" />
        </div>
      )}

      {/* ── Forecast chart ── */}
      <section className="space-y-2">
        <div>
          <h2 className="text-sm font-sans font-semibold text-white">Expected Pipeline by Close Month</h2>
          <p className="text-[11px] font-mono text-muted mt-0.5">Open deals only · weighted using estimated close probability (Contract & Negotiation 40%, PO & $$$ 75%)</p>
        </div>
        {loading ? <ChartSkeleton height={240} /> : chartData.length === 0 ? (
          <div className="bg-card rounded-lg border border-white/[0.08] px-4 py-10 text-center">
            <p className="text-muted font-mono text-sm">No open deals match your filters</p>
          </div>
        ) : (
          <div className="bg-card rounded-lg border border-white/[0.08] p-5">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="rgba(148,163,184,0.06)" />
                <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 11, fontFamily: 'DM Mono' }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'DM Mono' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip content={<ForecastTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'DM Mono', color: '#94a3b8' }} />
                <Bar dataKey="Contract & Negotiation" stackId="a" fill={STAGE_COLOR['Contract & Negotiation']} radius={[0, 0, 0, 0]} maxBarSize={56} />
                <Bar dataKey="PO & $$$" stackId="a" fill={STAGE_COLOR['PO & $$$']} radius={[4, 4, 0, 0]} maxBarSize={56} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* ── Upcoming deals by month ── */}
      {!loading && monthGroups.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-sans font-semibold text-white">Upcoming Deals</h2>
            <div className="flex items-center gap-2">
              <button onClick={() => setExpandedMonth(new Set(monthGroups.map(g => g.bucket)))} className="text-[11px] font-mono text-muted hover:text-white transition-colors">Expand all</button>
              <span className="text-muted/40">·</span>
              <button onClick={() => setExpandedMonth(new Set())} className="text-[11px] font-mono text-muted hover:text-white transition-colors">Collapse all</button>
            </div>
          </div>
          <div className="space-y-2">
            {monthGroups.map(g => (
              <MonthGroup key={g.bucket} group={g} expanded={expandedMonth.has(g.bucket)} onToggle={() => toggle(setExpandedMonth, g.bucket)} />
            ))}
          </div>
        </section>
      )}

      {/* ── By distributor ── */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h2 className="text-sm font-sans font-semibold text-white">All Deals by Distributor</h2>
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
            <div className="flex items-center gap-2">
              <button onClick={() => setExpandedDist(new Set(distGroups.map(g => g.distributor)))} className="text-[11px] font-mono text-muted hover:text-white transition-colors">Expand all</button>
              <span className="text-muted/40">·</span>
              <button onClick={() => setExpandedDist(new Set())} className="text-[11px] font-mono text-muted hover:text-white transition-colors">Collapse all</button>
            </div>
          </div>
        </div>

        {loading ? (
          <TableSkeleton rows={8} cols={4} />
        ) : distGroups.length === 0 ? (
          <div className="bg-card rounded-lg border border-white/[0.08] px-4 py-12 text-center">
            <p className="text-muted font-mono text-sm">No deals match your filters</p>
          </div>
        ) : (
          <div className="space-y-2">
            {distGroups.map(g => (
              <DistributorGroup
                key={g.distributor}
                group={g}
                expanded={expandedDist.has(g.distributor)}
                onToggle={() => toggle(setExpandedDist, g.distributor)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
