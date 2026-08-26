import { FitText } from './FitText';

export function KPICard({ label, value, sub, accent = false, color }) {
  const valueColor = color ?? (accent ? 'text-accent' : 'text-white');
  return (
    <div className="bg-card border border-white/[0.08] rounded-lg p-4 lg:p-5 flex flex-col gap-1 min-w-0">
      <p className="text-[11px] lg:text-xs text-muted uppercase tracking-wider font-sans">{label}</p>
      <p className={`text-2xl lg:text-3xl font-num font-medium leading-tight ${valueColor}`}>
        <FitText>{value ?? '—'}</FitText>
      </p>
      {sub && <p className="text-[11px] lg:text-xs text-muted font-sans">{sub}</p>}
    </div>
  );
}
