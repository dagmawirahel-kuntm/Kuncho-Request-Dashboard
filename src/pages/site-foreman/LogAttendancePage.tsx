import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useMySiteForemanProjects, useMyStaffId } from '@/hooks/useMyStaff'
import { useStaffDirectory } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { formatCurrency } from '@/lib/utils'
import type { WoAttendanceLog } from '@/types/database'
import { YesterdayNudge } from './YesterdayNudge'
import { ClipboardCheck, Plus, Trash2, HardHat, Ruler } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'

type CrewMember = { staff_id: string; role_on_wo: string | null; employee_name: string; employment_type: string | null }
type WoWithCrew = { id: string; scope_of_work: string; work_type: string; crew: CrewMember[] }
type VolumeInfo = { unitRate: number; unit: string; paymentModel: string }

function CrewLogRow({ workOrderId, staffId, employeeName, employmentType, existing, date, myStaffId, volumeInfo, onChanged }: {
  workOrderId: string
  staffId: string
  employeeName: string
  employmentType: string | null
  existing: WoAttendanceLog | undefined
  date: string
  myStaffId: string
  volumeInfo: VolumeInfo | null
  onChanged: () => void
}) {
  const { toast } = useToast()
  const isVolume = !!volumeInfo
  const [value, setValue] = useState(String(isVolume ? (existing?.volume_completed ?? '') : (existing?.hours_logged ?? 8)))
  const [saving, setSaving] = useState(false)

  async function save() {
    const val = parseFloat(value)
    if (!val || val <= 0) return
    const prev = isVolume ? existing?.volume_completed : existing?.hours_logged
    if (existing && val === prev) return
    setSaving(true)
    const payload = isVolume ? { volume_completed: val, hours_logged: null } : { hours_logged: val, volume_completed: null }
    const op = existing
      ? supabase.from('wo_attendance_log').update(payload).eq('id', existing.id)
      : supabase.from('wo_attendance_log').insert([{
          work_order_id: workOrderId, staff_id: staffId, log_date: date,
          is_unallocated: false, ...payload, logged_by_staff_id: myStaffId,
        }])
    const { error } = await op
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    onChanged()
  }

  async function remove() {
    if (!existing) return
    setSaving(true)
    const { error } = await supabase.from('wo_attendance_log').delete().eq('id', existing.id)
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    onChanged()
  }

  const parsedVal = parseFloat(value)
  const preview = isVolume && parsedVal > 0 ? parsedVal * volumeInfo!.unitRate : null

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm text-slate-700 dark:text-slate-200">
          {employmentType === 'tier_2_casual' && <span className="mr-1.5 text-[10px] font-bold text-brand">T2</span>}
          {employeeName}
        </p>
        <p className="flex items-center gap-1 text-xs text-slate-400">
          {staffId === myStaffId && <span>You</span>}
          {isVolume && (
            <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
              <Ruler className="h-3 w-3" />
              {volumeInfo!.paymentModel === 'gang_leader' ? 'Gang leader · paid by volume, via vendor' : `Piece-work · ${formatCurrency(volumeInfo!.unitRate)}/${volumeInfo!.unit}`}
              {preview != null && <span className="font-medium">· ≈ {formatCurrency(preview)}</span>}
            </span>
          )}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number" step={isVolume ? '0.01' : '0.5'} min="0" max={isVolume ? undefined : '16'}
          className="w-20 rounded-md border px-2 py-1.5 text-sm text-center outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
          value={value}
          disabled={saving}
          placeholder={isVolume ? '0.00' : undefined}
          onChange={e => setValue(e.target.value)}
          onBlur={save}
        />
        <span className="text-xs text-slate-400">{isVolume ? volumeInfo!.unit : 'hrs'}</span>
        {existing && (
          <button onClick={remove} disabled={saving} className="text-slate-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
        )}
      </div>
    </div>
  )
}

export default function LogAttendancePage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: me } = useMyStaffId()
  const myStaffId = me?.id ?? null
  const { projects } = useMySiteForemanProjects()
  const projectOptions = useMemo(() => projects.map(p => ({ id: p.id, label: p.project_name })), [projects])
  const today = new Date().toISOString().slice(0, 10)

  const [projectId, setProjectId] = useState<string | null>(null)
  const [date, setDate] = useState(today)

  // v_staff_directory, not a raw `staff` embed — site foremen and
  // project managers have no RLS read access to `staff` at all, so the
  // embedded staff!work_order_crew_staff_id_fkey(...) join below comes
  // back null for them even though the FK hint resolves the relationship
  // correctly. Fall back to the directory for the name/employment_type.
  const { data: staffDirectory = [] } = useStaffDirectory()
  const staffDirectoryById = useMemo(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => new Map(staffDirectory.map((s: any) => [s.id, s])),
    [staffDirectory],
  )

  const { data: rawActiveWOs = [] } = useQuery({
    queryKey: ['attendance-active-wos', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_orders')
        .select('id, scope_of_work, work_type, work_order_crew(staff_id, role_on_wo, removed_at, staff!work_order_crew_staff_id_fkey(employee_name, employment_type))')
        .eq('project_id', projectId!)
        .eq('status', 'in_progress')
        .order('created_at')
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return data as any[]
    },
    enabled: !!projectId,
  })

  const activeWOs = useMemo(() => rawActiveWOs.map(wo => ({
    id: wo.id, scope_of_work: wo.scope_of_work, work_type: wo.work_type,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    crew: (wo.work_order_crew ?? []).filter((c: any) => !c.removed_at).map((c: any) => {
      const fallback = staffDirectoryById.get(c.staff_id)
      return {
        staff_id: c.staff_id, role_on_wo: c.role_on_wo,
        employee_name: c.staff?.employee_name ?? fallback?.employee_name ?? '—',
        employment_type: c.staff?.employment_type ?? fallback?.employment_type ?? null,
      }
    }),
  })) as WoWithCrew[], [rawActiveWOs, staffDirectoryById])

  // Tier 2 workers hired under a `per_volume` requisition (piece-work,
  // often paid to a gang leader vendor rather than split per person) log
  // volume produced instead of hours — surfaced by joining each crew
  // member's active allocation to its requisition's pay terms.
  const { data: rawAllocations = [] } = useQuery({
    queryKey: ['attendance-volume-info', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('labor_allocations')
        .select('staff_id, labor_requisitions:labor_requisition_id(payment_basis, unit_rate, volume_unit, payment_model)')
        .eq('project_id', projectId!)
        .eq('status', 'active')
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return data as any[]
    },
    enabled: !!projectId,
  })

  const volumeInfoByStaff = useMemo(() => {
    const map = new Map<string, VolumeInfo>()
    for (const row of rawAllocations) {
      const req = row.labor_requisitions
      if (req?.payment_basis === 'per_volume' && req.unit_rate != null) {
        map.set(row.staff_id, { unitRate: req.unit_rate, unit: req.volume_unit ?? 'unit', paymentModel: req.payment_model })
      }
    }
    return map
  }, [rawAllocations])

  const { data: dayRows = [], refetch } = useQuery({
    queryKey: ['wo-attendance-day', projectId, date],
    queryFn: async () => {
      const { data, error } = await supabase.from('wo_attendance_log').select('*').eq('project_id', projectId!).eq('log_date', date)
      if (error) throw error
      return data as WoAttendanceLog[]
    },
    enabled: !!projectId,
  })

  function refreshAll() {
    refetch()
    qc.invalidateQueries({ queryKey: ['sdr-headcount'] })
  }

  const allocatedRows = dayRows.filter(r => !r.is_unallocated)
  const unallocatedRows = dayRows.filter(r => r.is_unallocated)

  const allCrewStaff = useMemo(() => {
    const seen = new Map<string, string>()
    for (const wo of activeWOs) for (const c of wo.crew) seen.set(c.staff_id, c.employee_name)
    return Array.from(seen.entries()).map(([id, label]) => ({ id, label }))
  }, [activeWOs])

  const [unallocStaffId, setUnallocStaffId] = useState<string | null>(null)
  const [unallocHours, setUnallocHours] = useState('8')
  const [unallocNote, setUnallocNote] = useState('')

  async function addUnallocated() {
    if (!unallocStaffId || !myStaffId || !projectId) { toast('Pick a staff member', 'error'); return }
    const val = parseFloat(unallocHours)
    if (!val || val <= 0) { toast('Enter valid hours', 'error'); return }
    const { error } = await supabase.from('wo_attendance_log').insert([{
      project_id: projectId, staff_id: unallocStaffId, log_date: date,
      hours_logged: val, is_unallocated: true, notes: unallocNote || null,
      logged_by_staff_id: myStaffId,
    }])
    if (error) { toast(error.message, 'error'); return }
    setUnallocStaffId(null); setUnallocHours('8'); setUnallocNote('')
    refreshAll()
    toast('Unallocated time logged', 'success')
  }

  async function removeUnallocated(id: string) {
    const { error } = await supabase.from('wo_attendance_log').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    refreshAll()
  }

  return (
    <div className="space-y-4">
      <YesterdayNudge />
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800 dark:text-slate-100">
          <ClipboardCheck className="h-5 w-5 text-brand" /> Log Attendance
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Hours are logged against the work order — changes save automatically.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-xl border bg-white p-4 dark:border-slate-700 dark:bg-slate-800 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Project</label>
          <SearchableSelect value={projectId} onChange={setProjectId} options={projectOptions} placeholder="Pick site…" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Date</label>
          <input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} />
        </div>
      </div>

      {projectId && (
        <>
          {activeWOs.length === 0 ? (
            <p className="rounded-xl border border-dashed py-8 text-center text-sm text-slate-400 dark:border-slate-700">No active work orders on this site yet.</p>
          ) : (
            activeWOs.map(wo => (
              <div key={wo.id} className="overflow-hidden rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
                <div className="flex items-center gap-2 border-b px-4 py-2 dark:border-slate-700">
                  <HardHat className="h-3.5 w-3.5 text-slate-400" />
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{wo.scope_of_work}</span>
                </div>
                {wo.crew.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-slate-400">No crew assigned to this work order yet.</p>
                ) : (
                  <div className="divide-y dark:divide-slate-700">
                    {wo.crew.map(c => (
                      <CrewLogRow
                        key={`${wo.id}:${c.staff_id}`}
                        workOrderId={wo.id}
                        staffId={c.staff_id}
                        employeeName={c.employee_name}
                        employmentType={c.employment_type}
                        existing={allocatedRows.find(r => r.work_order_id === wo.id && r.staff_id === c.staff_id)}
                        date={date}
                        myStaffId={myStaffId ?? ''}
                        volumeInfo={volumeInfoByStaff.get(c.staff_id) ?? null}
                        onChanged={refreshAll}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))
          )}

          <div className="rounded-xl border bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Add unallocated time</h2>
            <p className="mb-3 text-[11px] text-slate-400">For time that doesn't belong to a specific work order — site cleanup, waiting on materials, general presence.</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_6rem_1fr_auto] items-end">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Staff</label>
                <SearchableSelect value={unallocStaffId} onChange={setUnallocStaffId} options={allCrewStaff} placeholder="Select…" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Hours</label>
                <input type="number" step="0.5" min="0" max="16" className={inputCls} value={unallocHours} onChange={e => setUnallocHours(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Note</label>
                <input className={inputCls} value={unallocNote} onChange={e => setUnallocNote(e.target.value)} placeholder="e.g. site cleanup" />
              </div>
              <button onClick={addUnallocated} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
                <Plus className="h-4 w-4 inline" /> Add
              </button>
            </div>
            {unallocatedRows.length > 0 && (
              <div className="mt-3 divide-y border-t dark:divide-slate-700 dark:border-slate-700">
                {unallocatedRows.map(r => (
                  <div key={r.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-slate-700 dark:text-slate-200">{allCrewStaff.find(s => s.id === r.staff_id)?.label ?? r.staff_id}</p>
                      <p className="text-xs text-slate-400">{r.hours_logged} hrs{r.notes ? ` · ${r.notes}` : ''}</p>
                    </div>
                    <button onClick={() => removeUnallocated(r.id)} className="text-slate-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
      {me == null && <p className="text-xs text-slate-400">Loading your staff record…</p>}
    </div>
  )
}
