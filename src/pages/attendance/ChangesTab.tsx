import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Segmented } from '@/components/shared/Segmented'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { useUserNames, type AttendanceLogRow, type AttendancePerson } from '@/lib/attendance'
import { LogLine } from './MonthSheet'
import { formatDateGC } from '@/lib/utils'

type Kind = 'all' | 'changes' | 'late'

// Everything that was recorded or changed, newest first: what, about
// whom, which day, who did it, when, and why.
export function ChangesTab({ people }: { people: AttendancePerson[] }) {
  const [kind, setKind] = useState<Kind>('changes')
  const [who, setWho] = useState<string | null>(null)
  const { data: names } = useUserNames()
  const nameById = useMemo(() => new Map(people.map(p => [p.staff_id, p.employee_name])), [people])

  const { data: log = [], isLoading } = useQuery({
    queryKey: ['attendance-log', 'recent', kind, who],
    queryFn: async () => {
      let q = supabase.from('staff_attendance_log').select('*').order('changed_at', { ascending: false }).limit(200)
      if (kind === 'changes') q = q.in('action', ['update', 'delete', 'lock', 'unlock'])
      if (who) q = q.eq('staff_id', who)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as AttendanceLogRow[]
    },
  })
  // "Recorded late": inserts for a day before the day they were made.
  const shown = kind === 'late'
    ? log.filter(h => h.action === 'insert' && h.work_date && new Date(new Date(h.changed_at).getTime() + 3 * 3600000).toISOString().slice(0, 10) > h.work_date)
    : log

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <Segmented value={kind} onChange={setKind} size="sm" ariaLabel="Show" options={[
          { value: 'changes', label: 'Changes & deletions' },
          { value: 'late', label: 'Recorded after the day' },
          { value: 'all', label: 'Everything' },
        ]} />
        <div className="sm:ml-auto sm:w-64">
          <SearchableSelect value={who} onChange={setWho} placeholder="Everyone"
            options={people.map(p => ({ id: p.staff_id, label: p.employee_name }))} />
        </div>
      </div>
      <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm divide-y dark:divide-slate-700">
        {isLoading ? <p className="py-10 text-center text-sm text-slate-400">Loading…</p>
          : shown.length === 0 ? <p className="py-10 text-center text-sm text-slate-400">Nothing here yet</p>
          : shown.map(h => (
            <ul key={h.id} className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4">
              <li className="sm:w-48 shrink-0 text-xs">
                <p className="font-medium text-slate-700 dark:text-slate-200">{h.staff_id ? nameById.get(h.staff_id) ?? 'Staff member' : 'Whole period'}</p>
                {h.work_date && <p className="text-[11px] text-slate-400">{formatDateGC(h.work_date)}</p>}
              </li>
              <LogLine h={h} names={names} />
            </ul>
          ))}
      </div>
      <p className="text-[11px] text-slate-400">The log can't be edited or deleted from the app. Showing the latest 200 entries.</p>
    </div>
  )
}
