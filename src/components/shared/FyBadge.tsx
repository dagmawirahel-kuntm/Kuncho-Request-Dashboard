import { CalendarX2 } from 'lucide-react'
import type { FyFlag } from '@/lib/fiscalFlag'

/** A small "FY2025/26" mark on a date outside the year being worked in. */
export function FyBadge({ date, flag }: { date: string | null | undefined; flag: FyFlag }) {
  if (!date || !flag.outside(date)) return null
  const other = flag.fyOf(date)
  return (
    <span title={`Dated in ${other}, outside ${flag.fy?.label}, the year you're working in. It belongs to ${other}'s books.`}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
      <CalendarX2 className="h-2.5 w-2.5" /> {other}
    </span>
  )
}
