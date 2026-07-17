import { CalendarRange } from 'lucide-react'

interface FiscalYearFilterProps {
  periods: { id: string; label: string; is_current: boolean }[]
  value: string
  onChange: (value: string) => void
}

/** Presentational dropdown — state lives in FiscalYearContext (see the
 * header toggle in AppShell), not owned by this component. */
export function FiscalYearFilter({ periods, value, onChange }: FiscalYearFilterProps) {
  return (
    <div className="flex items-center gap-1.5">
      <CalendarRange className="h-4 w-4 text-slate-400 shrink-0" />
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
      >
        {periods.map(p => (
          <option key={p.id} value={p.id}>{p.label}{p.is_current ? ' (current)' : ''}</option>
        ))}
        <option value="all">All time</option>
      </select>
    </div>
  )
}
