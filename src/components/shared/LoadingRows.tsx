/**
 * A shimmering stand-in for a list that is still loading — the shape of
 * what's coming, rather than the word "Loading…".
 */
export function LoadingRows({ rows = 4, className = '' }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl border bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
          <div className="shimmer h-9 w-9 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-2">
            <div className="shimmer h-3 rounded" style={{ width: `${70 - (i % 3) * 12}%` }} />
            <div className="shimmer h-2.5 rounded" style={{ width: `${45 - (i % 2) * 10}%` }} />
          </div>
          <div className="shimmer h-4 w-16 shrink-0 rounded" />
        </div>
      ))}
    </div>
  )
}
