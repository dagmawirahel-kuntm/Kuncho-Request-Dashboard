import { useEffect, useState } from 'react'
import { useFiscalPeriods } from '@/hooks/useLookups'
import { CalendarRange } from 'lucide-react'

/**
 * "Fresh platform" default: every list/dashboard using this defaults to
 * the current fiscal year (Hamle 1 -> Sene 30, see migration 087) the
 * moment fiscal_periods loads, with an "All time" escape hatch. This is
 * a display default only -- never wire it into the project workspace or
 * budget-vs-actual views, which must always aggregate a project's full
 * history regardless of fiscal period.
 */
export function useFiscalYearFilter() {
  const { data: periods = [] } = useFiscalPeriods()
  const current = periods.find(p => p.is_current)
  const [selected, setSelected] = useState<string | 'all' | null>(null)

  // Initialize to the current FY the first time it loads; leave alone afterward.
  useEffect(() => {
    if (selected === null && current) setSelected(current.id)
  }, [selected, current])

  const fiscalPeriodId = selected === 'all' ? null : (selected ?? current?.id ?? null)

  return { periods, current, value: selected ?? current?.id ?? 'all', setValue: setSelected, fiscalPeriodId }
}

interface FiscalYearFilterProps {
  periods: { id: string; label: string; is_current: boolean }[]
  value: string
  onChange: (value: string) => void
}

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
