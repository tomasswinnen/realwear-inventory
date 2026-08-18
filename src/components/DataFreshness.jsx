function daysAgo(dateStr) {
  if (!dateStr) return null;
  const ms = Date.now() - new Date(`${dateStr}T00:00:00`).getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

function freshnessDotClass(days) {
  if (days == null) return 'bg-muted';
  if (days <= 3) return 'bg-success';
  if (days <= 14) return 'bg-warning';
  return 'bg-danger';
}

function freshnessTextClass(days) {
  if (days == null) return 'text-muted';
  if (days <= 3) return 'text-slate-300';
  if (days <= 14) return 'text-warning';
  return 'text-danger';
}

function freshnessLabel(days) {
  if (days == null) return 'no data';
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

/**
 * sources: [{ label: string, date: 'YYYY-MM-DD' | null }]
 */
export function DataFreshness({ sources }) {
  return (
    <div className="flex items-center gap-4 flex-wrap text-[11px] font-mono">
      {sources.map(s => {
        const days = daysAgo(s.date);
        return (
          <span key={s.label} className="flex items-center gap-1.5" title={s.date ?? undefined}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${freshnessDotClass(days)}`} />
            <span className="text-muted">{s.label}:</span>
            <span className={freshnessTextClass(days)}>{freshnessLabel(days)}</span>
          </span>
        );
      })}
    </div>
  );
}
