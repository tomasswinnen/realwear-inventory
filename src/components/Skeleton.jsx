export function Skeleton({ className = '' }) {
  return (
    <div
      className={`animate-pulse rounded bg-white/5 ${className}`}
    />
  );
}

export function KPISkeleton() {
  return (
    <div className="bg-card border border-white/[0.08] rounded-lg p-5">
      <Skeleton className="h-3 w-24 mb-3" />
      <Skeleton className="h-8 w-32 mb-2" />
      <Skeleton className="h-3 w-16" />
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 5 }) {
  return (
    <div className="overflow-hidden rounded-lg border border-white/[0.08]">
      <div className="bg-card/50 px-4 py-3 border-b border-white/[0.08]">
        <Skeleton className="h-3 w-40" />
      </div>
      <div className="bg-card">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex gap-4 px-4 py-3 border-b border-white/[0.06] last:border-0">
            {Array.from({ length: cols }).map((_, j) => (
              <Skeleton key={j} className="h-3 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChartSkeleton({ height = 200 }) {
  return (
    <div className="bg-card border border-white/[0.08] rounded-lg p-5">
      <Skeleton className="h-4 w-48 mb-4" />
      <Skeleton className={`w-full`} style={{ height }} />
    </div>
  );
}
