export function KPICard({ label, value, sub, accent = false, color }) {
  const valueColor = color ?? (accent ? 'text-accent' : 'text-white');
  return (
    <div className="bg-card border border-white/[0.08] rounded-lg p-5 flex flex-col gap-1">
      <p className="text-xs text-muted uppercase tracking-wider font-sans">{label}</p>
      <p className={`text-3xl font-num font-medium ${valueColor}`}>{value ?? '—'}</p>
      {sub && <p className="text-xs text-muted font-sans">{sub}</p>}
    </div>
  );
}
