import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useToast } from '@/contexts/ToastContext'
import { useMyStaffId } from '@/hooks/useMyStaff'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { RosterRequestPickerModal } from '@/components/shared/RosterRequestPickerModal'
import { Pill } from '@/components/record/Record'
import { useWorkOrderPeople, type WorkOrderLabourRow, type WorkOrderPerson } from '@/lib/workOrders'
import { ClipboardCheck, HardHat, Plus, Send, UserMinus, X } from 'lucide-react'

const card = 'rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800'
const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`
const hrs = (n: number) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 })

/** The people on a work order and the work each has done — the crew and the
 *  recorded days in one list (migration 476). Also used on the project's
 *  Work tab when a work order is opened up. */
export function PeopleList({ people, costsVisible, onRemove, compact }: {
  people: WorkOrderPerson[]; costsVisible: boolean; onRemove?: (p: WorkOrderPerson) => void; compact?: boolean
}) {
  if (people.length === 0) return <p className="px-4 py-5 text-center text-sm text-slate-400">Nobody on this job yet.</p>
  return (
    <ul className="divide-y dark:divide-slate-700">
      {people.map(p => (
        <li key={p.staff_id ?? 'crew'} className={`flex items-start gap-3 px-4 ${compact ? 'py-2' : 'py-2.5'} ${!p.on_crew && p.days > 0 ? 'opacity-70' : ''}`}>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {p.staff_id && p.casual
                ? <Link to={`/staff/${p.staff_id}`} className="truncate text-sm font-medium text-slate-800 hover:text-brand dark:text-slate-100">{p.name}</Link>
                : <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{p.name}</span>}
              {p.is_lead && <Pill tone="violet">Lead</Pill>}
              {p.today ? <Pill tone="green">Today {hrs(p.today)} h</Pill> : null}
              {!p.on_crew && p.days > 0 && <span className="text-[11px] text-slate-400">left the crew</span>}
            </div>
            <p className="truncate text-xs text-slate-500">
              {[p.role, p.on_crew && p.since ? `on the crew since ${formatDate(p.since)}` : null,
                p.last_day ? `last worked ${formatDate(p.last_day)}` : p.on_crew ? 'no work recorded yet' : null].filter(Boolean).join(' · ')}
            </p>
            {!compact && p.requests.length > 0 && (
              <p className="truncate text-[11px] text-slate-400">
                Paid through {p.requests.map((r, i) => (
                  <span key={r.id}>{i > 0 && ', '}<Link to={`/labour/${r.id}`} className="hover:text-brand hover:underline">{r.role}{r.open ? '' : ' (ended)'}</Link></span>
                ))}
              </p>
            )}
          </div>
          <div className="shrink-0 text-right">
            <p className="text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{p.days ? plural(p.days, 'day') : '—'}</p>
            <p className="text-[11px] tabular-nums text-slate-400">
              {p.hours ? `${hrs(p.hours)} h` : p.quantity ? `${hrs(p.quantity)} done` : ''}
              {p.overtime_hours ? ` + ${hrs(p.overtime_hours)} h OT` : ''}
            </p>
          </div>
          {costsVisible && (
            <div className="w-24 shrink-0 text-right">
              <p className="text-sm tabular-nums text-slate-700 dark:text-slate-200">{p.cost ? formatCurrency(p.cost) : '—'}</p>
              {p.unconfirmed ? <p className="text-[10px] text-amber-600">{formatCurrency(p.unconfirmed)} to confirm</p> : null}
            </div>
          )}
          {onRemove && (
            <button onClick={() => onRemove(p)} disabled={!p.on_crew || !p.staff_id} title="Take off the crew"
              className="mt-0.5 shrink-0 text-slate-300 hover:text-red-500 disabled:invisible"><UserMinus className="h-4 w-4" /></button>
          )}
        </li>
      ))}
    </ul>
  )
}

export function WorkOrderPeopleCard({ workOrderId, projectId, canManage, canAskForLabour }: {
  workOrderId: string; projectId: string; canManage: boolean; canAskForLabour: boolean
}) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { data: mySelf } = useMyStaffId()
  const { data, isLoading } = useWorkOrderPeople(workOrderId)
  const people = data?.people ?? []
  const costsVisible = !!data?.costsVisible
  const [adding, setAdding] = useState(false)
  const [roster, setRoster] = useState(false)
  const [pick, setPick] = useState<string | null>(null)
  const [role, setRole] = useState('')
  const [saving, setSaving] = useState(false)
  const [showRequests, setShowRequests] = useState(false)

  // The labour requests that pay these people — how they're paid, not who's on the job.
  const { data: requests = [] } = useQuery({
    queryKey: ['work-order-labour', workOrderId],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_work_order_labour').select('*').eq('work_order_id', workOrderId)
      if (error) throw error
      return (data ?? []) as WorkOrderLabourRow[]
    },
  })
  const { data: candidates = [] } = useQuery({
    queryKey: ['wo-crew-candidates', projectId],
    enabled: adding,
    queryFn: async () => {
      const [assignments, allocations] = await Promise.all([
        supabase.from('staff_assignments').select('staff_id, staff:staff_id(employee_name)').eq('project_id', projectId).eq('active', true),
        supabase.from('labor_allocations').select('staff_id, staff:staff_id(employee_name)').eq('project_id', projectId).eq('status', 'active'),
      ])
      if (assignments.error) throw assignments.error
      if (allocations.error) throw allocations.error
      const m = new Map<string, string>()
      for (const r of [...(assignments.data ?? []), ...(allocations.data ?? [])] as unknown as { staff_id: string; staff: { employee_name: string } | null }[]) {
        if (r.staff_id) m.set(r.staff_id, r.staff?.employee_name ?? '—')
      }
      return [...m.entries()].map(([id, label]) => ({ id, label }))
    },
  })

  const onCrew = people.filter(p => p.on_crew)
  const onCrewIds = new Set(onCrew.map(p => p.staff_id).filter(Boolean) as string[])
  const totalDays = people.reduce((s, p) => s + p.days, 0)
  const totalCost = people.reduce((s, p) => s + Number(p.cost ?? 0), 0)
  const unconfirmed = people.reduce((s, p) => s + Number(p.unconfirmed ?? 0), 0)
  const workingToday = people.filter(p => p.today).length

  function refresh() {
    qc.invalidateQueries({ queryKey: ['work-order-people', workOrderId] })
    qc.invalidateQueries({ queryKey: ['work-order-crew', workOrderId] })
  }
  async function add() {
    if (!pick) return
    setSaving(true)
    const { error } = await supabase.from('work_order_crew').insert([{ work_order_id: workOrderId, staff_id: pick, role_on_wo: role.trim() || null, assigned_by_staff_id: mySelf?.id ?? null }])
    setSaving(false)
    if (error) { toast(error.code === '23505' ? 'Already on the crew' : error.message, 'error'); refresh(); return }
    setPick(null); setRole(''); setAdding(false); refresh()
    toast('Added to the crew', 'success')
  }
  async function remove(p: WorkOrderPerson) {
    if (!p.staff_id || !confirm(`Take ${p.name} off this job's crew? Days already recorded stay.`)) return
    const { error } = await supabase.from('work_order_crew')
      .update({ removed_at: new Date().toISOString(), removed_by_staff_id: mySelf?.id ?? null })
      .eq('work_order_id', workOrderId).eq('staff_id', p.staff_id).is('removed_at', null)
    if (error) { toast(error.message, 'error'); return }
    refresh(); toast(`${p.name} taken off the crew`, 'success')
  }

  return (
    <section className={card}>
      {roster && <RosterRequestPickerModal projectId={projectId} workOrderId={workOrderId} excludeStaffIds={onCrewIds} onClose={() => { setRoster(false); refresh() }} />}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 dark:border-slate-700">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200"><HardHat className="h-4 w-4" /> People &amp; work</h2>
          <p className="text-xs text-slate-500">
            {onCrew.length} {onCrew.length === 1 ? 'person' : 'people'} on the crew{workingToday ? ` · ${workingToday} working today` : ''} · {plural(totalDays, 'person-day')} recorded
            {costsVisible && totalCost > 0 ? ` · ${formatCurrency(totalCost)}` : ''}
            {costsVisible && unconfirmed > 0 ? ` (${formatCurrency(unconfirmed)} not confirmed for pay)` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/labour/record?site=${projectId}`} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium dark:border-slate-600"><ClipboardCheck className="h-3.5 w-3.5" /> Record today</Link>
          {canAskForLabour && <Link to={`/labour/new?project=${projectId}&work_order=${workOrderId}`} className="inline-flex items-center gap-1 rounded-md bg-brand/10 px-2.5 py-1 text-xs font-semibold text-brand"><Plus className="h-3.5 w-3.5" /> Ask for labour</Link>}
          {canManage && <>
            <button onClick={() => setRoster(true)} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium dark:border-slate-600"><Send className="h-3.5 w-3.5" /> From the roster</button>
            <button onClick={() => setAdding(a => !a)} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium dark:border-slate-600">
              {adding ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} {adding ? 'Cancel' : 'Add staff'}
            </button>
          </>}
        </div>
      </div>
      {adding && (
        <div className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row dark:border-slate-700">
          <div className="flex-1"><SearchableSelect value={pick} onChange={setPick} options={candidates.filter(c => !onCrewIds.has(c.id))} placeholder="Someone already on this project…" /></div>
          <input value={role} onChange={e => setRole(e.target.value)} placeholder="Role on this job (optional)" className="rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 sm:w-48" />
          <button onClick={add} disabled={saving || !pick} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">{saving ? 'Adding…' : 'Add'}</button>
        </div>
      )}
      {isLoading ? <p className="p-5 text-center text-sm text-slate-400">Loading…</p>
        : <PeopleList people={people} costsVisible={costsVisible} onRemove={canManage ? remove : undefined} />}
      {requests.length > 0 && (
        <div className="border-t dark:border-slate-700">
          <button onClick={() => setShowRequests(v => !v)} className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700/40">
            <span>Paid through {plural(requests.length, 'labour request')} · {requests.filter(r => r.status === 'approved' && !r.closed_at).length} open</span>
            <span className="text-brand">{showRequests ? 'Hide' : 'Show'}</span>
          </button>
          {showRequests && (
            <ul className="divide-y border-t text-sm dark:divide-slate-700 dark:border-slate-700">
              {requests.map(r => (
                <li key={r.labor_requisition_id}>
                  <Link to={`/labour/${r.labor_requisition_id}`} className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <span className="min-w-0 flex-1 truncate">{r.role_needed}{r.headcount > 1 ? ` × ${r.headcount}` : ''} <span className="text-xs text-slate-400">· {plural(r.days_recorded, 'day')} recorded</span></span>
                    <Pill tone={r.status === 'pending' ? 'amber' : r.status === 'rejected' ? 'red' : r.closed_at ? 'slate' : 'green'}>
                      {r.status === 'pending' ? 'Waiting' : r.status === 'rejected' ? 'Declined' : r.closed_at ? 'Ended' : 'Active'}
                    </Pill>
                    {costsVisible && <span className="w-24 text-right text-xs tabular-nums">{formatCurrency(Number(r.confirmed_cost) + Number(r.recorded_cost))}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
