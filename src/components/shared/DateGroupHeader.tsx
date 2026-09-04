import { formatCurrency, formatDate } from '@/lib/utils'

/**
 * Splits a list into one bucket per calendar day, keeping the order the rows
 * arrived in. Both call sites query ordered by the same date they group on, so
 * the buckets come out newest-first without re-sorting — but a Map keyed by
 * day (rather than merging adjacent runs) means a list that isn't perfectly
 * ordered still yields one bucket per day instead of repeating a date.
 *
 * Rows with no date land in a single trailing "—" bucket rather than being
 * dropped: an undated row is still a row someone has to deal with.
 */
export function groupByDay<T>(
  rows: T[],
  getDate: (row: T) => string | null | undefined,
): { key: string; rows: T[] }[] {
  const buckets = new Map<string, T[]>()
  for (const row of rows) {
    const raw = getDate(row)
    const key = raw ? String(raw).slice(0, 10) : '—'
    const bucket = buckets.get(key)
    if (bucket) bucket.push(row)
    else buckets.set(key, [row])
  }
  return Array.from(buckets, ([key, rows]) => ({ key, rows }))
}

/**
 * The band that separates one day's rows from the next. Carries the day's own
 * count and (where the list is about money) its total, so scanning the
 * headers alone answers "how much did we commit that day".
 */
export function DateGroupHeader({ dateKey, count, total, noun = 'record' }: {
  dateKey: string
  count: number
  total?: number | null
  noun?: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 px-4 py-2">
      <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
        {dateKey === '—' ? 'No date' : formatDate(dateKey)}
      </span>
      <span className="text-[11px] text-slate-400 tabular-nums">
        {count} {noun}{count === 1 ? '' : 's'}
        {total != null && total > 0 ? ` · ${formatCurrency(total)}` : ''}
      </span>
    </div>
  )
}
