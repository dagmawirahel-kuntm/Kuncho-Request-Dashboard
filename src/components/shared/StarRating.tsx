import { Star } from 'lucide-react'

interface StarRatingProps {
  score: number | null
  size?: 'sm' | 'md'
}

// A 0-5 score rendered as five stars, filled proportionally — this is
// what people scan quickly on the Workshop floor, not a bare number.
export function StarRating({ score, size = 'sm' }: StarRatingProps) {
  const cls = size === 'sm' ? 'h-3.5 w-3.5' : 'h-5 w-5'
  const value = score ?? 0
  return (
    <div className="flex items-center gap-0.5" title={score != null ? `${score} / 5` : 'Not yet rated'}>
      {[1, 2, 3, 4, 5].map(i => (
        <Star
          key={i}
          className={`${cls} ${i <= value ? 'fill-amber-400 text-amber-400' : 'text-slate-300 dark:text-slate-600'}`}
        />
      ))}
    </div>
  )
}
