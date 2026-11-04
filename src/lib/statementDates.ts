// Statement lines grouped by day, the way a bank statement lists them: one
// heading per value date, the lines of that day under it.

export interface DayGroup<T> {
  date: string
  lines: T[]
  out: number
  in: number
}

export function groupByDay<T>(lines: T[], dateOf: (l: T) => string, amountOf: (l: T) => { out: number; in: number }): DayGroup<T>[] {
  const groups: DayGroup<T>[] = []
  for (const l of lines) {
    const d = dateOf(l)
    let g = groups[groups.length - 1]
    if (!g || g.date !== d) { g = { date: d, lines: [], out: 0, in: 0 }; groups.push(g) }
    g.lines.push(l)
    const a = amountOf(l)
    g.out += a.out; g.in += a.in
  }
  return groups
}

/** A yyyy-mm-dd date as a local date (not UTC midnight, which can land on the day before). */
export function localDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}
