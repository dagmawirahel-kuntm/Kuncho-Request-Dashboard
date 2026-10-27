import { ChevronLeft, ChevronRight } from 'lucide-react'
import { addDays } from '@/lib/labour'
import { thisMonday, weekLabel } from '@/lib/weekSummary'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** People on site each day of the week: one series, so no legend — the
 *  caption names it. The busiest day is labelled; every bar has a tooltip. */
export function DayBars({ days, height = 56, compact }: { days: { date: string; people: number }[]; height?: number; compact?: boolean }) {
  const max = Math.max(1, ...days.map(d => d.people))
  const peak = days.reduce((m, d, i) => (d.people > days[m].people ? i : m), 0)
  return (
    <div role="img" aria-label={`People on site: ${days.map((d, i) => `${DAYS[i]} ${d.people}`).join(', ')}`}>
      <div className="flex items-end gap-0.5" style={{ height }}>
        {days.map((d, i) => (
          <div key={d.date} className="group relative flex h-full flex-1 flex-col justify-end" title={`${DAYS[i]} ${d.date.slice(8)}: ${d.people} ${d.people === 1 ? 'person' : 'people'}`}>
            {!compact && i === peak && d.people > 0 && (
              <span className="mb-0.5 text-center text-[10px] font-semibold text-slate-600 dark:text-slate-300">{d.people}</span>
            )}
            <div className={`w-full rounded-t ${d.people ? 'bg-brand/70 group-hover:bg-brand' : 'bg-slate-200 dark:bg-slate-700'}`}
              style={{ height: d.people ? `${Math.max(8, (d.people / max) * (compact ? 100 : 80))}%` : 2 }} />
          </div>
        ))}
      </div>
      {!compact && (
        <div className="mt-1 flex gap-0.5">
          {days.map((d, i) => <span key={d.date} className="flex-1 text-center text-[10px] text-slate-400">{DAYS[i][0]}</span>)}
        </div>
      )}
    </div>
  )
}

export function WeekNav({ from, onChange }: { from: string; onChange: (from: string) => void }) {
  const current = thisMonday()
  return (
    <div className="flex items-center gap-1">
      <button onClick={() => onChange(addDays(from, -7))} aria-label="Week before" className="rounded-lg border p-1.5 text-slate-500 hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700"><ChevronLeft className="h-4 w-4" /></button>
      <span className="min-w-0 flex-1 px-1 text-center text-sm font-medium text-slate-700 dark:text-slate-200">{from === current ? 'This week' : from === addDays(current, -7) ? 'Last week' : weekLabel(from)}</span>
      <button onClick={() => onChange(addDays(from, 7))} disabled={from >= current} aria-label="Week after" className="rounded-lg border p-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-30 dark:border-slate-600 dark:hover:bg-slate-700"><ChevronRight className="h-4 w-4" /></button>
    </div>
  )
}
