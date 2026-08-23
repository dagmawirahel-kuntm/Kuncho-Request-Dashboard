import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { useMySiteForemanProjects, useMyStaffId } from '@/hooks/useMyStaff'
import { useStaffDirectory } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { formatCurrency } from '@/lib/utils'
import type { WoAttendanceLog } from '@/types/database'
import { YesterdayNudge } from './YesterdayNudge'
import { ClipboardCheck, Plus, Trash2, HardHat, Ruler, Users, Clock3 } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'

type CrewMember = { staff_id: string; role_on_wo: string | null; employee_name: string; employment_type: string | null }
type WoWithCrew = { id: string; scope_of_work: string; work_type: string; crew: CrewMember[] }
type VolumeInfo = { unitRate: number; unit: string; paymentModel: string; requisitionId: string; roleNeeded: string | null; workOrderId: string | null }
const isGangLeaderRole = (role: string | null) => !!role && /gang.?leader/i.test(role)

// 1.5x hourly rate x OT hours, purely as a starting point for the
// amount field below — real overtime deals vary, so what actually gets
// paid is whatever amount the person enters, not this formula.
function suggestedOvertimeAmount(hours: number, dayRate: number | null): string {
  if (!dayRate || !hours) return ''
  return (hours * 1.5 * (dayRate / 8)).toFixed(2)
}

function CrewLogRow({ workOrderId, staffId, employeeName, employmentType, existing, date, myStaffId, volumeInfo, dayRate, onChanged }: {
  workOrderId: string
  staffId: string
  employeeName: string
  employmentType: string | null
  existing: WoAttendanceLog | undefined
  date: string
  myStaffId: string
  volumeInfo: VolumeInfo | null
  dayRate: number | null
  onChanged: () => void
}) {
  const { toast } = useToast()
  const isVolume = !!volumeInfo
  const [value, setValue] = useState(String(isVolume ? (existing?.volume_completed ?? '') : (existing?.hours_logged ?? 8)))
  const [showOT, setShowOT] = useState(!!(existing?.overtime_hours || existing?.overtime_amount))
  const [otHours, setOtHours] = useState(String(existing?.overtime_hours ?? ''))
  const [otAmount, setOtAmount] = useState(String(existing?.overtime_amount ?? ''))
  const [saving, setSaving] = useState(false)

  async function save(overrides?: { otHoursVal?: string; otAmountVal?: string }) {
    const val = parseFloat(value)
    if (!val || val <= 0) return
    const otH = overrides?.otHoursVal ?? otHours
    const otA = overrides?.otAmountVal ?? otAmount
    setSaving(true)
    const payload = isVolume
      ? { volume_completed: val, hours_logged: null, gang_size: null, gang_member_staff_ids: null, overtime_hours: null, overtime_amount: null, notes: null }
      : {
          hours_logged: val, volume_completed: null, gang_size: null, gang_member_staff_ids: null,
          overtime_hours: otH ? parseFloat(otH) : null, overtime_amount: otA ? parseFloat(otA) : null,
        }
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

  function handleOtHoursChange(v: string) {
    setOtHours(v)
    const suggested = suggestedOvertimeAmount(parseFloat(v) || 0, dayRate)
    setOtAmount(suggested)
  }

  const parsedVal = parseFloat(value)
  const preview = isVolume && parsedVal > 0 ? parsedVal * volumeInfo!.unitRate : null

  return (
    <div className="px-4 py-2">
      <div className="flex items-center justify-between gap-3">
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
                {`Piece-work · ${formatCurrency(volumeInfo!.unitRate)}/${volumeInfo!.unit}`}
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
            onBlur={() => save()}
          />
          <span className="text-xs text-slate-400">{isVolume ? volumeInfo!.unit : 'hrs'}</span>
          {!isVolume && !showOT && (
            <button type="button" onClick={() => setShowOT(true)} className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-brand" title="Add overtime">
              <Clock3 className="h-3 w-3" /> OT
            </button>
          )}
          {existing && (
            <button onClick={remove} disabled={saving} className="text-slate-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
          )}
        </div>
      </div>
      {!isVolume && showOT && (
        <div className="mt-1.5 flex items-center gap-2 rounded-md bg-amber-50 dark:bg-amber-900/10 px-2.5 py-1.5">
          <Clock3 className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
          <span className="text-[11px] text-amber-700 dark:text-amber-400 shrink-0">Overtime</span>
          <input
            type="number" step="0.5" min="0" placeholder="hrs"
            className="w-16 rounded-md border px-2 py-1 text-xs text-center outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
            value={otHours}
            disabled={saving}
            onChange={e => handleOtHoursChange(e.target.value)}
            onBlur={() => save()}
          />
          <span className="text-[11px] text-slate-400">hrs ·</span>
          <input
            type="number" step="0.01" min="0" placeholder="agreed amount"
            className="w-28 rounded-md border px-2 py-1 text-xs text-right outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
            value={otAmount}
            disabled={saving}
            onChange={e => setOtAmount(e.target.value)}
            onBlur={() => save()}
          />
          <span className="text-[11px] text-slate-400">ETB</span>
          <button
            type="button"
            onClick={() => { setShowOT(false); setOtHours(''); setOtAmount(''); if (existing?.overtime_hours || existing?.overtime_amount) save({ otHoursVal: '', otAmountVal: '' }) }}
            className="ml-auto text-slate-400 hover:text-red-500"
            title="Remove overtime"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  )
}

// A gang_leader-model volume day: one shared total, paid to the
// requisition's vendor regardless of which staff row anchors it — but
// WHO was actually part of the gang that day has to be picked
// explicitly, not assumed to be the whole active roster. Real case that
// exposed the gap: volume logged only against Besufekad on a 5-person
// Ceramic Workers gang, with zero record of who else was there.
function GangTotalRow({ workOrderId, members, anchor, existing, date, myStaffId, volumeInfo, onChanged }: {
  workOrderId: string
  members: CrewMember[]
  anchor: CrewMember
  existing: WoAttendanceLog | undefined
  date: string
  myStaffId: string
  volumeInfo: VolumeInfo
  onChanged: () => void
}) {
  const { toast } = useToast()
  const [value, setValue] = useState(String(existing?.volume_completed ?? ''))
  const [selected, setSelected] = useState<Set<string>>(() => {
    if (existing?.gang_member_staff_ids?.length) return new Set(existing.gang_member_staff_ids)
    return new Set(members.map(m => m.staff_id))
  })
  const [saving, setSaving] = useState(false)

  async function saveWith(rawVal: string, ids: string[]) {
    const val = parseFloat(rawVal)
    if (!val || val <= 0) return
    if (ids.length === 0) { toast('Select at least one worker for the gang', 'error'); return }
    setSaving(true)
    const names = members.filter(m => ids.includes(m.staff_id)).map(m => m.employee_name)
    const payload = {
      volume_completed: val, hours_logged: null,
      gang_size: ids.length, gang_member_staff_ids: ids,
      notes: `Gang: ${names.join(', ')}`,
    }
    const op = existing
      ? supabase.from('wo_attendance_log').update(payload).eq('id', existing.id)
      : supabase.from('wo_attendance_log').insert([{
          work_order_id: workOrderId, staff_id: anchor.staff_id, log_date: date,
          is_unallocated: false, ...payload, logged_by_staff_id: myStaffId,
        }])
    const { error } = await op
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    onChanged()
  }

  function toggleMember(staffId: string) {
    setSelected(s => {
      const o = new Set(s)
      if (o.has(staffId)) o.delete(staffId); else o.add(staffId)
      if (value && parseFloat(value) > 0) saveWith(value, Array.from(o))
      return o
    })
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
  const preview = parsedVal > 0 ? parsedVal * volumeInfo.unitRate : null

  return (
    <div className="px-4 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-slate-700 dark:text-slate-200">Gang total <span className="text-xs text-slate-400">· via {anchor.employee_name}</span></p>
          <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
            <Ruler className="h-3 w-3" />
            {selected.size} of {members.length} working today · paid by volume, via vendor
            {preview != null && <span className="font-medium">· ≈ {formatCurrency(preview)}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number" step="0.01" min="0"
            className="w-20 rounded-md border px-2 py-1.5 text-sm text-center outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
            value={value}
            disabled={saving}
            placeholder="0.00"
            onChange={e => setValue(e.target.value)}
            onBlur={() => saveWith(value, Array.from(selected))}
          />
          <span className="text-xs text-slate-400">{volumeInfo.unit}</span>
          {existing && (
            <button onClick={remove} disabled={saving} className="text-slate-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
          )}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="self-center text-[10px] text-slate-400 mr-0.5">Who was working:</span>
        {members.map(m => (
          <button
            key={m.staff_id}
            type="button"
            onClick={() => toggleMember(m.staff_id)}
            disabled={saving}
            className={`rounded-full border px-2 py-0.5 text-[11px] ${
              selected.has(m.staff_id)
                ? 'border-brand bg-brand text-white'
                : 'border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-800'
            }`}
          >
            {m.employee_name}
          </button>
        ))}
      </div>
    </div>
  )
}

// A worker with more than one active per_volume allocation on the same
// work order (e.g. Solomon: Filler / Zecolo / Ceramic Wall, each its own
// rate under one "Ceramic Work" WO). There's no way to infer which task
// a given day's volume belongs to, so the foreman picks it explicitly —
// the choice is stored as labor_requisition_id on the attendance row,
// which the sync trigger uses ahead of its usual inference.
function MultiTaskVolumeRow({ workOrderId, staffId, employeeName, tasks, existing, date, myStaffId, onChanged }: {
  workOrderId: string
  staffId: string
  employeeName: string
  tasks: VolumeInfo[]
  existing: WoAttendanceLog | undefined
  date: string
  myStaffId: string
  onChanged: () => void
}) {
  const { toast } = useToast()
  const [taskId, setTaskId] = useState<string | null>(existing?.labor_requisition_id ?? null)
  const [value, setValue] = useState(String(existing?.volume_completed ?? ''))
  const [saving, setSaving] = useState(false)
  const selectedTask = tasks.find(t => t.requisitionId === taskId) ?? null

  async function save() {
    if (!taskId) { toast('Pick which task this is for', 'error'); return }
    const val = parseFloat(value)
    if (!val || val <= 0) return
    setSaving(true)
    const payload = {
      volume_completed: val, hours_logged: null, gang_size: null, gang_member_staff_ids: null,
      overtime_hours: null, overtime_amount: null, labor_requisition_id: taskId, notes: null,
    }
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
  const preview = selectedTask && parsedVal > 0 ? parsedVal * selectedTask.unitRate : null

  return (
    <div className="px-4 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-slate-700 dark:text-slate-200">{employeeName}</p>
          <p className="flex items-center gap-1 text-xs text-slate-400">
            {staffId === myStaffId && <span>You</span>}
            {selectedTask && (
              <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                <Ruler className="h-3 w-3" />
                {formatCurrency(selectedTask.unitRate)}/{selectedTask.unit}
                {preview != null && <span className="font-medium">· ≈ {formatCurrency(preview)}</span>}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={taskId ?? ''}
            onChange={e => setTaskId(e.target.value || null)}
            disabled={saving}
            className="rounded-md border px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
          >
            <option value="">Which task?</option>
            {tasks.map(t => <option key={t.requisitionId} value={t.requisitionId}>{t.roleNeeded ?? 'Task'}</option>)}
          </select>
          <input
            type="number" step="0.01" min="0"
            className="w-20 rounded-md border px-2 py-1.5 text-sm text-center outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
            value={value}
            disabled={saving || !taskId}
            placeholder="0.00"
            onChange={e => setValue(e.target.value)}
            onBlur={save}
          />
          <span className="text-xs text-slate-400">{selectedTask?.unit ?? 'unit'}</span>
          {existing && (
            <button onClick={remove} disabled={saving} className="text-slate-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
          )}
        </div>
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
        .select('staff_id, day_rate_snapshot, labor_requisition_id, labor_requisitions:labor_requisition_id(payment_basis, unit_rate, volume_unit, payment_model, role_needed, estimated_day_rate, work_order_id)')
        .eq('project_id', projectId!)
        .eq('status', 'active')
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return data as any[]
    },
    enabled: !!projectId,
  })

  // A staff member can have more than one active per_volume allocation
  // on the same work order (e.g. Solomon: Filler / Zecolo / Ceramic Wall,
  // each its own rate under one "Ceramic Work" WO) — keyed to an array so
  // the render below can tell "one rate, use it directly" apart from
  // "several rates, the foreman has to pick which task today was."
  const volumeInfoByStaff = useMemo(() => {
    const map = new Map<string, VolumeInfo[]>()
    for (const row of rawAllocations) {
      const req = row.labor_requisitions
      if (req?.payment_basis === 'per_volume' && req.unit_rate != null && row.labor_requisition_id) {
        const arr = map.get(row.staff_id) ?? []
        arr.push({
          unitRate: req.unit_rate, unit: req.volume_unit ?? 'unit', paymentModel: req.payment_model,
          requisitionId: row.labor_requisition_id, roleNeeded: req.role_needed ?? null,
          workOrderId: req.work_order_id ?? null,
        })
        map.set(row.staff_id, arr)
      }
    }
    return map
  }, [rawAllocations])

  // Day rate for the overtime suggestion — same fallback chain the sync
  // trigger uses (allocation snapshot, then the requisition's estimated
  // day rate); staff.day_rate isn't readable here for most roles, so it's
  // not part of this client-side fallback.
  const dayRateByStaff = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of rawAllocations) {
      const req = row.labor_requisitions
      const rate = row.day_rate_snapshot ?? req?.estimated_day_rate ?? null
      if (rate != null) map.set(row.staff_id, rate)
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
                    {(() => {
                      const infosForWo = (staffId: string) =>
                        (volumeInfoByStaff.get(staffId) ?? []).filter(v => v.workOrderId === wo.id || v.workOrderId === null)
                      const volumeGroups = new Map<string, CrewMember[]>()
                      const soloRows: CrewMember[] = []
                      const multiTaskRows: CrewMember[] = []
                      for (const c of wo.crew) {
                        const infos = infosForWo(c.staff_id)
                        if (infos.length === 0) { soloRows.push(c); continue }
                        if (infos.length > 1) { multiTaskRows.push(c); continue }
                        const vi = infos[0]
                        const arr = volumeGroups.get(vi.requisitionId) ?? []
                        arr.push(c)
                        volumeGroups.set(vi.requisitionId, arr)
                      }
                      const rendered: ReactNode[] = soloRows.map(c => (
                        <CrewLogRow
                          key={`${wo.id}:${c.staff_id}`}
                          workOrderId={wo.id}
                          staffId={c.staff_id}
                          employeeName={c.employee_name}
                          employmentType={c.employment_type}
                          existing={allocatedRows.find(r => r.work_order_id === wo.id && r.staff_id === c.staff_id)}
                          date={date}
                          myStaffId={myStaffId ?? ''}
                          volumeInfo={null}
                          dayRate={dayRateByStaff.get(c.staff_id) ?? null}
                          onChanged={refreshAll}
                        />
                      ))
                      for (const c of multiTaskRows) {
                        rendered.push(
                          <MultiTaskVolumeRow
                            key={`${wo.id}:${c.staff_id}`}
                            workOrderId={wo.id}
                            staffId={c.staff_id}
                            employeeName={c.employee_name}
                            tasks={infosForWo(c.staff_id)}
                            existing={allocatedRows.find(r => r.work_order_id === wo.id && r.staff_id === c.staff_id)}
                            date={date}
                            myStaffId={myStaffId ?? ''}
                            onChanged={refreshAll}
                          />,
                        )
                      }
                      for (const [reqId, members] of volumeGroups) {
                        const vi = infosForWo(members[0].staff_id)[0]
                        if (members.length === 1) {
                          const c = members[0]
                          rendered.push(
                            <CrewLogRow
                              key={`${wo.id}:${c.staff_id}`}
                              workOrderId={wo.id}
                              staffId={c.staff_id}
                              employeeName={c.employee_name}
                              employmentType={c.employment_type}
                              existing={allocatedRows.find(r => r.work_order_id === wo.id && r.staff_id === c.staff_id)}
                              date={date}
                              myStaffId={myStaffId ?? ''}
                              volumeInfo={vi}
                              dayRate={dayRateByStaff.get(c.staff_id) ?? null}
                              onChanged={refreshAll}
                            />,
                          )
                          continue
                        }
                        const groupKey = `${wo.id}:${reqId}`
                        if (vi.paymentModel !== 'gang_leader') {
                          // Individual model: each person is paid their own
                          // volume, so there's no "gang" to select — every
                          // member always gets their own row.
                          rendered.push(
                            <div key={`${groupKey}:hdr`} className="flex items-center gap-1 bg-slate-50 px-4 py-1.5 text-[11px] text-slate-400 dark:bg-slate-900/40">
                              <Users className="h-3 w-3" /> {vi.roleNeeded ?? 'Piece-work'} · {members.length} workers, paid individually
                            </div>,
                          )
                          for (const c of members) {
                            rendered.push(
                              <CrewLogRow
                                key={`${wo.id}:${c.staff_id}`}
                                workOrderId={wo.id}
                                staffId={c.staff_id}
                                employeeName={c.employee_name}
                                employmentType={c.employment_type}
                                existing={allocatedRows.find(r => r.work_order_id === wo.id && r.staff_id === c.staff_id)}
                                date={date}
                                myStaffId={myStaffId ?? ''}
                                volumeInfo={infosForWo(c.staff_id)[0] ?? null}
                                dayRate={dayRateByStaff.get(c.staff_id) ?? null}
                                onChanged={refreshAll}
                              />,
                            )
                          }
                          continue
                        }
                        // gang_leader model: one shared total, paid to the
                        // requisition's vendor no matter who anchors it — but
                        // who was actually part of the gang today is picked
                        // explicitly inside GangTotalRow, not assumed.
                        const anchor = members.find(m => isGangLeaderRole(m.role_on_wo)) ?? members[0]
                        rendered.push(
                          <div key={`${groupKey}:hdr`} className="flex items-center gap-1 bg-slate-50 px-4 py-1.5 text-[11px] text-slate-400 dark:bg-slate-900/40">
                            <Users className="h-3 w-3" /> {vi.roleNeeded ?? 'Gang'} · {members.length} on the roster
                          </div>,
                        )
                        rendered.push(
                          <GangTotalRow
                            key={groupKey}
                            workOrderId={wo.id}
                            members={members}
                            anchor={anchor}
                            existing={allocatedRows.find(r => r.work_order_id === wo.id && r.staff_id === anchor.staff_id)}
                            date={date}
                            myStaffId={myStaffId ?? ''}
                            volumeInfo={vi}
                            onChanged={refreshAll}
                          />,
                        )
                      }
                      return rendered
                    })()}
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
