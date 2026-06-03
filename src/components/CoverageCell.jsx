import { coverageBg, coverageLabel } from '../utils/coverage';

export function CoverageCell({ months }) {
  if (months === 0) {
    return <span className="inline-block text-xs font-mono px-2 py-0.5 rounded text-muted">—</span>;
  }
  const cls = coverageBg(months);
  return (
    <span className={`inline-block text-xs font-mono px-2 py-0.5 rounded ${cls}`}>
      {coverageLabel(months)} mo
    </span>
  );
}
