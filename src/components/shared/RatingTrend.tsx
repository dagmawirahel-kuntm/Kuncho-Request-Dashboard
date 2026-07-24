import { formatDate } from '@/lib/utils'

interface RatingTrendPoint {
  score: number
  ratedAt: string
}

interface RatingTrendProps {
  history: RatingTrendPoint[]
}

// Compact bar-sparkline of past scores, oldest to newest — same
// plain-div, no-library approach as BreakdownBarList, just oriented
// as a short vertical sequence so a rising trajectory is visible at a
// glance beside a star row, without reading numbers.
export function RatingTrend({ history }: RatingTrendProps) {
  if (history.length === 0) return null
  return (
    <div className="flex items-end gap-0.5 h-5" title="Rating history">
      {history.map((p, i) => (
        <div
          key={i}
          className="w-1.5 rounded-sm bg-brand/60 dark:bg-brand/50"
          style={{ height: `${Math.max((p.score / 5) * 100, 8)}%` }}
          title={`${p.score}/5 — ${formatDate(p.ratedAt)}`}
        />
      ))}
    </div>
  )
}
