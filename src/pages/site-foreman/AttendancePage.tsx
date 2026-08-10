import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useMySiteForemanProjects } from '@/hooks/useMyStaff'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { useToast } from '@/contexts/ToastContext'
import { CheckCircle2, Circle, ChevronLeft, ChevronRight, Users } from 'lucide-react'

// Weekly attendance grid for a foreman's project.
// Rows = Tier 2 casual workers allocated to the picked project (via
// labor_allocations status in {planned, active}). Columns = 7 days of the
// picked week. Clicking a cell toggles a timesheet_attendance row for
// (staff_id, project_id, work_date) — insert to mark present, delete to
// unmark. The rollup RPC (migration 197) folds these ticks into the labor
// expense with days_worked=1 × day_rate.
export default function AttendancePage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { projects } = useMySiteForemanProjects()
  const projectOptions = useMemo(() => projects.map(p => ({ id: p.id, label: p.project_name })), [projects])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [weekAnchor, setWeekAnchor] = useState(() => todayIso())

  const days = useMemo(() => weekOf(weekAnchor), [weekAnchor])
  const weekStart = days[0]
  const weekEnd   = days[days.length - 1]

  // Workers to display: Tier 2 casuals allocated to this project during the
  // picked week (any allocation overlapping the window). We also load the
  // requisition_id from the allocation's notes indirectly — see below.
  const { data: allocations = [], isLoading: allocLoading } = useQuery({
    queryKey: ['t2-attendance-allocations', projectId, weekStart, weekEnd],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase.from('labor_allocations')
        .select('id, staff_id, start_date, end_date, day_rate_snapshot, notes, staff:staff_id(id, employee_name, employment_type, trade_tag, codename_english, codename_amharic)')
        .eq('project_id', projectId!)
        .in('status', ['planned', 'active'])
        .lte('start_date', weekEnd)
        .or(`end_date.is.null,end_date.gte.${weekStart}`)
        .order('start_date')
      if (error) throw error
      return (data ?? []) as any[]
    },
  })

  // Extract the requisition_id from the allocation's notes (auto-created
  // allocations from migration 189 embed "Auto-created from approved roster
  // request <uuid>" — a bit fragile but the only link we have without
  // adding a column). For manually-created allocations we send null.
  function extractReqId(notes: string | null): string | null {
    if (!notes) return null
    const m = notes.match(/roster request ([0-9a-f-]{36})/i)
    return m ? m[1] : null
  }

  // Filter to Tier 2 workers only.
  const workers = useMemo(() =>
    allocations
      .filter(a => a.staff && a.staff.employment_type === 'tier_2_casual')
      .map(a => ({
        allocation_id: a.id,
        staff_id: a.staff_id as string,
        staff_name: a.staff.employee_name as string,
        codename: (a.staff.codename_english as string) || (a.staff.trade_tag as string) || '',
        codename_amharic: (a.staff.codename_amharic as string) || '',
        requisition_id: extractReqId(a.notes),
        start_date: a.start_date as string,
        end_date: (a.end_date as string | null) ?? null,
      })),
    [allocations])

  const staffIds = useMemo(() => workers.map(w => w.staff_id), [workers])

  // Existing ticks for this project × week × these workers.
  const { data: ticks = [], refetch: refetchTicks } = useQuery({
    queryKey: ['t2-attendance-ticks', projectId, weekStart, weekEnd, staffIds.join(',')],
    enabled: !!projectId && staffIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('timesheet_attendance')
        .select('id, staff_id, work_date, labor_requisition_id')
        .eq('project_id', projectId!)
        .gte('work_date', weekStart)
        .lte('work_date', weekEnd)
        .in('staff_id', staffIds)
      if (error) throw error
      return (data ?? []) as any[]
    },
  })

  const tickIndex = useMemo(() => {
    const m = new Map<string, string>() // key = staff_id + '|' + date → tick_id
    for (const t of ticks) m.set(`${t.staff_id}|${t.work_date}`, t.id)
    return m
  }, [ticks])

  async function toggle(staff_id: string, work_date: string, requisition_id: string | null) {
    const key = `${staff_id}|${work_date}`
    const existingId = tickIndex.get(key)
    if (existingId) {
      const { error } = await supabase.from('timesheet_attendance').delete().eq('id', existingId)
      if (error) return toast(error.message, 'error')
    } else {
      const { error } = await supabase.from('timesheet_attendance').insert([{
        staff_id, project_id: projectId, work_date, labor_requisition_id: requisition_id,
      }])
      if (error) return toast(error.message, 'error')
    }
    refetchTicks()
    qc.invalidateQueries({ queryKey: ['sdr-headcount'] })
  }

  function shiftWeek(deltaDays: number) {
    const d = new Date(weekAnchor); d.setDate(d.getDate() + deltaDays)
    setWeekAnchor(d.toISOString().slice(0, 10))
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <Users className="h-5 w-5 text-brand" /> Tier 2 Attendance
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Tick each casual worker on the days they showed up. The daily site report headcount + labor rollup both read from these ticks.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Project</label>
          <SearchableSelect value={projectId} onChange={setProjectId} options={projectOptions} placeholder="Pick site…" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Week</label>
          <div className="flex items-center gap-1">
            <button onClick={() => shiftWeek(-7)} className="rounded-md border p-2 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700" title="Previous week">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs text-slate-600 dark:text-slate-300 tabular-nums px-2">{weekStart} → {weekEnd}</span>
            <button onClick={() => shiftWeek(7)} className="rounded-md border p-2 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700" title="Next week">
              <ChevronRight className="h-4 w-4" />
            </button>
            <button onClick={() => setWeekAnchor(todayIso())} className="rounded-md border px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700 ml-1">
              This week
            </button>
          </div>
        </div>
      </div>

      {!projectId ? (
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 py-16 text-center text-sm text-slate-400">
          Pick a project to see your Tier 2 workers.
        </div>
      ) : allocLoading ? (
        <div className="py-16 text-center text-sm text-slate-400">Loading roster…</div>
      ) : workers.length === 0 ? (
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 py-16 text-center">
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">No Tier 2 casual workers allocated to this project for this week.</p>
          <p className="text-xs text-slate-400 mt-1">Allocations come from approved labor requisitions.</p>
        </div>
      ) : (
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50 dark:bg-slate-900/50 dark:border-slate-700">
                <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400">Worker</th>
                {days.map(d => (
                  <th key={d} className="px-2 py-2 text-center text-[10px] font-semibold text-slate-500 dark:text-slate-400 tabular-nums" title={d}>
                    {dayHeader(d)}
                  </th>
                ))}
                <th className="px-2 py-2 text-center text-[10px] font-semibold text-slate-500 dark:text-slate-400">Total</th>
              </tr>
            </thead>
            <tbody>
              {workers.map(w => {
                const rowTicks = days.filter(d => tickIndex.has(`${w.staff_id}|${d}`)).length
                return (
                  <tr key={w.staff_id + w.allocation_id} className="border-t dark:border-slate-700">
                    <td className="px-3 py-2 min-w-[180px]">
                      <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{w.staff_name}</div>
                      <div className="text-[10px] text-slate-400">{w.codename_amharic} · {w.codename}</div>
                    </td>
                    {days.map(d => {
                      const present = tickIndex.has(`${w.staff_id}|${d}`)
                      const outOfRange = d < w.start_date || (w.end_date != null && d > w.end_date)
                      return (
                        <td key={d} className="px-1 py-1 text-center">
                          <button
                            disabled={outOfRange}
                            onClick={() => toggle(w.staff_id, d, w.requisition_id)}
                            title={outOfRange ? 'Outside allocation window' : present ? 'Present — click to unmark' : 'Absent — click to mark present'}
                            className={`inline-flex items-center justify-center h-8 w-8 rounded-md transition-colors ${
                              outOfRange ? 'text-slate-200 cursor-not-allowed dark:text-slate-700' :
                              present ? 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:hover:bg-emerald-900/50' :
                              'text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                            }`}
                          >
                            {present ? <CheckCircle2 className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
                          </button>
                        </td>
                      )
                    })}
                    <td className="px-2 py-2 text-center text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                      {rowTicks}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function todayIso() { return new Date().toISOString().slice(0, 10) }

// Mon-Sun week containing the given ISO date.
function weekOf(iso: string): string[] {
  const d = new Date(iso)
  const day = d.getDay() // 0 = Sun, 1 = Mon, ...
  const monOffset = day === 0 ? -6 : 1 - day
  const monday = new Date(d); monday.setDate(d.getDate() + monOffset)
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(monday); x.setDate(monday.getDate() + i)
    return x.toISOString().slice(0, 10)
  })
}

function dayHeader(iso: string) {
  const d = new Date(iso)
  const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]
  const day = String(d.getDate()).padStart(2, '0')
  return `${dow} ${day}`
}
