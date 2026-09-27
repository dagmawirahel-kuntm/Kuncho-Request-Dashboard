import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { formatDate, formatCurrency } from '@/lib/utils'
import { fieldCls } from '@/lib/formStyles'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { ActionDialog } from '@/components/shared/ActionDialog'
import { FactList, Panel, Pill, RecordHeader, RecordLayout, type RecordAction, type Tone } from '@/components/record/Record'
import type { LaborRequisition, Candidate, LaborRequisitionMoney } from '@/types/database'
import {
  Pencil, Clock, CheckCircle2, XCircle, HardHat, AlertTriangle, Check, X, CalendarPlus, Ban, Users, Coins, FileText, UserCheck, Briefcase,
} from 'lucide-react'

type ReqRow = LaborRequisition & {
  projects: { project_name: string; project_manager_id: string | null } | null
  work_orders: { scope_of_work: string } | null
  vendors: { vendor_name: string } | null
}
type AllocationRow = {
  id: string; staff_id: string; start_date: string; end_date: string | null; status: string; day_rate_snapshot: number | null
  staff: { employee_name: string; trade_tag: string | null } | null
}
type Dialog = null | 'approve' | 'reject' | 'extend' | 'close'

const today = () => new Date().toISOString().slice(0, 10)

export default function LaborRequisitionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { role } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  // Matches the database: only HR and admin approve (enforce_labor_req_approval_authority).
  const canApprove = role === 'admin' || role === 'hr_officer'
  const canManage = canApprove || role === 'executive' || role === 'operations_manager' || role === 'project_manager'
  const seesMoney = role === 'admin' || role === 'executive' || role === 'finance' || role === 'hr_officer' || role === 'operations_manager' || role === 'project_manager'

  const { data: req, isLoading } = useQuery({
    queryKey: ['labor-requisition-detail', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('labor_requisitions')
        .select('*, projects(project_name, project_manager_id), work_orders(scope_of_work), vendors:gang_leader_vendor_id(vendor_name)')
        .eq('id', id!).single()
      if (error) throw error
      return data as unknown as ReqRow
    },
  })
  const { data: money } = useQuery({
    queryKey: ['labor-requisition-money', id],
    enabled: !!id && seesMoney,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_labor_requisition_money').select('*').eq('labor_requisition_id', id!).maybeSingle()
      if (error) throw error
      return data as LaborRequisitionMoney | null
    },
  })
  const { data: candidates = [] } = useQuery({
    queryKey: ['labor-requisition-candidates', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('candidates').select('*').eq('labor_requisition_id', id!).order('created_at', { ascending: false })
      if (error) throw error
      return data as Candidate[]
    },
  })
  // Roster workers requested (migration 261): there from the moment it is raised.
  const { data: roster = [] } = useQuery({
    queryKey: ['labor-requisition-workers', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('labor_requisition_workers')
        .select('staff_id, allocation_id, staff(employee_name, trade_tag, day_rate)').eq('requisition_id', id!)
      if (error) throw error
      return data as unknown as { staff_id: string; allocation_id: string | null; staff: { employee_name: string; trade_tag: string | null; day_rate: number | null } | null }[]
    },
  })
  const { data: allocations = [] } = useQuery({
    queryKey: ['labor-requisition-allocations', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('labor_allocations')
        .select('id, staff_id, start_date, end_date, status, day_rate_snapshot, staff(employee_name, trade_tag)')
        .eq('labor_requisition_id', id!).order('start_date', { ascending: false })
      if (error) throw error
      return data as unknown as AllocationRow[]
    },
  })

  const [dialog, setDialog] = useState<Dialog>(null)
  const [note, setNote] = useState('')
  const [newEnd, setNewEnd] = useState('')
  const [endWorkers, setEndWorkers] = useState(true)
  const [busy, setBusy] = useState(false)

  function open(d: Dialog) {
    setNote(''); setEndWorkers(true)
    const base = req?.end_date && req.end_date > today() ? req.end_date : today()
    const plus = new Date(base); plus.setDate(plus.getDate() + 14)
    setNewEnd(plus.toISOString().slice(0, 10))
    setDialog(d)
  }
  function refresh() {
    for (const k of ['labor-requisition-detail', 'labor-requisition-money', 'labor-requisition-allocations']) qc.invalidateQueries({ queryKey: [k, id] })
    qc.invalidateQueries({ queryKey: ['labor-requisitions'] })
    qc.invalidateQueries({ queryKey: ['ops-health-items'] })
  }

  async function decide(status: 'approved' | 'rejected') {
    setBusy(true)
    const { error } = await supabase.from('labor_requisitions')
      .update({ status, decision_note: note.trim() || null }).eq('id', id!)
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast(status === 'approved' ? 'Approved — the cost is committed to the project' : 'Rejected', 'success')
    setDialog(null); refresh()
  }
  async function extend() {
    setBusy(true)
    const { data, error } = await supabase.rpc('extend_labor_requisition', { p_id: id!, p_new_end: newEnd, p_note: note.trim() || null })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`Extended to ${formatDate(newEnd)}${data ? ` · ${data} worker${data === 1 ? '' : 's'} carried on` : ''}`, 'success')
    setDialog(null); refresh()
  }
  async function close() {
    setBusy(true)
    const { data, error } = await supabase.rpc('close_labor_requisition', { p_id: id!, p_reason: note.trim(), p_end_workers: endWorkers })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`Closed${data ? ` · ${data} worker${data === 1 ? '' : 's'} released` : ''}`, 'success')
    setDialog(null); refresh()
  }
  async function endExpired() {
    const { data, error } = await supabase.rpc('complete_expired_labor_allocations', { p_req: id! })
    if (error) { toast(error.message, 'error'); return }
    toast(data ? `${data} worker${data === 1 ? '' : 's'} with no work after the end date released` : 'Everyone past the end date has recorded work since — extend the requisition or release them one by one.', data ? 'success' : 'info')
    refresh()
  }

  if (isLoading || !req) return <div className="py-12 text-center text-sm text-slate-400">Loading…</div>

  const closed = !!req.closed_at
  const ended = !!req.end_date && req.end_date < today()
  const active = allocations.filter(a => a.status === 'active' || a.status === 'planned')
  const overstay = ended ? active.filter(a => !a.end_date || a.end_date > req.end_date!) : []
  const statusPill: { label: string; tone: Tone } = req.status === 'pending' ? { label: 'Waiting for a decision', tone: 'amber' }
    : req.status === 'rejected' ? { label: 'Rejected', tone: 'red' }
    : closed ? { label: 'Closed', tone: 'slate' }
    : ended ? { label: 'Ended', tone: 'slate' }
    : { label: 'Approved', tone: 'green' }
  const perVolume = req.payment_basis === 'per_volume'
  const rate = perVolume ? `${formatCurrency(req.unit_rate)} per ${req.volume_unit ?? 'unit'}` : req.estimated_day_rate != null ? `${formatCurrency(req.estimated_day_rate)} a day` : "Each worker's own rate"

  const actions: RecordAction[] = [
    { label: 'Approve', icon: Check, primary: true, onClick: () => open('approve'), hidden: !(canApprove && req.status === 'pending') },
    { label: 'Reject', icon: X, danger: true, onClick: () => open('reject'), hidden: !(canApprove && req.status === 'pending') },
    { label: ended || closed ? 'Extend / reopen' : 'Extend', icon: CalendarPlus, primary: ended && !closed && overstay.length > 0, onClick: () => open('extend'), hidden: !(canManage && req.status === 'approved') },
    { label: 'Close', icon: Ban, onClick: () => open('close'), hidden: !(canManage && req.status === 'approved' && !closed) },
    { label: 'Edit', icon: Pencil, to: `/labor-requisitions/${id}/edit`, hidden: req.status !== 'pending' && !canApprove },
  ]

  const est = Number(money?.estimated ?? req.estimated_total_cost ?? 0)
  const spent = Number(money?.paid ?? 0) + Number(money?.approved_unpaid ?? 0) + Number(money?.drafted ?? 0)
  const bar = (v: number) => est > 0 ? `${Math.min(100, (v / est) * 100)}%` : '0%'

  return (
    <div className="space-y-4">
      <RecordHeader
        back={{ to: '/labor-requisitions', label: 'Labour requisitions' }}
        title={<>{req.role_needed} <span className="font-normal text-slate-400">×{req.headcount}</span></>}
        subtitle={<>{req.projects?.project_name ?? '—'}{req.work_orders?.scope_of_work ? ` · ${req.work_orders.scope_of_work}` : ''}</>}
        pills={<>
          <Pill tone={statusPill.tone}>{statusPill.label}</Pill>
          {req.status === 'approved' && <Pill tone={req.slots_filled >= req.headcount ? 'green' : req.slots_filled > 0 ? 'amber' : 'red'} icon={Users}>{req.slots_filled} of {req.headcount} placed</Pill>}
          {overstay.length > 0 && <Pill tone="red" icon={AlertTriangle}>{overstay.length} past the end date</Pill>}
          <Pill>{perVolume ? 'Paid by volume' : 'Paid by the day'}</Pill>
          <Pill>{req.pay_cycle === 'engagement_end' ? 'Paid at the end' : 'Paid weekly'}</Pill>
        </>}
        meta={[
          { icon: Clock, value: `${formatDate(req.start_date)} → ${req.end_date ? formatDate(req.end_date) : 'open'}`, tone: overstay.length ? 'red' : undefined },
          { icon: Coins, value: rate },
          ...(req.payment_model === 'gang_leader' ? [{ icon: Briefcase, value: `Gang: ${req.vendors?.vendor_name ?? '—'}` }] : []),
        ]}
        actions={actions}
      />

      {overstay.length > 0 && canManage && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/50 dark:bg-red-900/20">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
          <p className="min-w-0 flex-1 text-sm text-red-700 dark:text-red-300">
            This requisition ended {formatDate(req.end_date)} but {overstay.length} worker{overstay.length === 1 ? ' is' : 's are'} still on it.
            Extend it if the work carries on, or release them.
          </p>
          <button onClick={() => open('extend')} className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700">Extend</button>
          <button onClick={endExpired} className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 dark:border-red-800 dark:text-red-300">Release those with no work since</button>
        </div>
      )}

      <RecordLayout
        main={<>
          <Panel title="Workers" icon={HardHat} count={allocations.length} padded={false}>
            {allocations.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-400">
                {req.status === 'approved' ? 'Nobody has been placed on this yet.' : 'Workers are placed once it is approved.'}
              </p>
            ) : (
              <ul className="divide-y dark:divide-slate-700/60">
                {allocations.map(a => {
                  const past = overstay.some(o => o.id === a.id)
                  return (
                    <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <Link to={`/staff/${a.staff_id}`} className="text-sm font-medium text-slate-800 hover:text-brand dark:text-slate-100">{a.staff?.employee_name ?? '—'}</Link>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {formatDate(a.start_date)} → {a.end_date ? formatDate(a.end_date) : 'open'}
                          {a.staff?.trade_tag ? ` · ${a.staff.trade_tag}` : ''}
                          {a.day_rate_snapshot != null ? ` · ${formatCurrency(a.day_rate_snapshot)}${perVolume ? '' : '/day'}` : ''}
                        </p>
                      </div>
                      {past && <Pill tone="red" icon={AlertTriangle}>Past end date</Pill>}
                      <Pill tone={a.status === 'active' ? 'green' : a.status === 'completed' ? 'slate' : a.status === 'cancelled' ? 'red' : 'blue'}>
                        {a.status === 'completed' ? 'Finished' : a.status === 'active' ? 'On site' : a.status === 'planned' ? 'Planned' : 'Cancelled'}
                      </Pill>
                    </li>
                  )
                })}
              </ul>
            )}
          </Panel>

          {roster.length > 0 && (
            <Panel title="Roster workers requested" icon={UserCheck} count={roster.length} padded={false}>
              <ul className="divide-y dark:divide-slate-700/60">
                {roster.map(w => (
                  <li key={w.staff_id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <div>
                      <Link to={`/staff/${w.staff_id}`} className="font-medium text-slate-800 hover:text-brand dark:text-slate-100">{w.staff?.employee_name ?? '—'}</Link>
                      <span className="ml-2 text-xs text-slate-400">
                        {w.staff?.trade_tag ?? '—'}
                        {req.estimated_day_rate == null && w.staff?.day_rate != null && ` · own rate ${formatCurrency(w.staff.day_rate)}`}
                      </span>
                    </div>
                    {w.allocation_id ? <Pill tone="green" icon={CheckCircle2}>Placed</Pill> : <Pill tone="amber" icon={Clock}>On approval</Pill>}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {candidates.length > 0 && (
            <Panel title="Candidates" icon={Users} count={candidates.length}>
              <div className="grid gap-4 sm:grid-cols-3">
                {([['pending', 'Waiting for HR', Clock], ['hired', 'Hired', CheckCircle2], ['rejected', 'Not taken', XCircle]] as const).map(([k, label, Icon]) => {
                  const list = candidates.filter(c => c.outcome === k)
                  return (
                    <div key={k}>
                      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><Icon className="h-3.5 w-3.5" /> {label} ({list.length})</p>
                      {list.length === 0 ? <p className="text-xs text-slate-400">None.</p> : (
                        <ul className="space-y-1">
                          {list.map(c => <li key={c.id} className="flex justify-between rounded-md border px-2.5 py-1.5 text-sm dark:border-slate-700"><span className="text-slate-700 dark:text-slate-200">{c.full_name}</span><span className="text-xs text-slate-400">{c.trade_tag ?? ''}</span></li>)}
                        </ul>
                      )}
                    </div>
                  )
                })}
              </div>
            </Panel>
          )}

          {(req.scope_of_work || req.notes || req.decision_note || req.close_reason || req.site_location) && (
            <Panel title="Notes" icon={FileText}>
              <div className="space-y-3 text-sm text-slate-700 dark:text-slate-200">
                {req.scope_of_work && <div><p className="text-xs text-slate-400">Scope of work</p><p className="whitespace-pre-line">{req.scope_of_work}</p></div>}
                {req.site_location && <div><p className="text-xs text-slate-400">Site</p><p>{req.site_location}</p></div>}
                {req.decision_note && <div><p className="text-xs text-slate-400">{req.status === 'rejected' ? 'Why it was rejected' : 'Decision note'}</p><p className="whitespace-pre-line">{req.decision_note}</p></div>}
                {req.close_reason && <div><p className="text-xs text-slate-400">Closed {formatDate(req.closed_at)}</p><p className="whitespace-pre-line">{req.close_reason}</p></div>}
                {req.notes && <div><p className="text-xs text-slate-400">Notes</p><p className="whitespace-pre-line">{req.notes}</p></div>}
              </div>
            </Panel>
          )}
        </>}
        rail={<>
          {seesMoney && (
            <Panel title="Money" icon={Coins}>
              {est > 0 && (
                <div className="mb-3">
                  <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700" title="Paid · approved · drafted, against the estimate">
                    <span className="bg-emerald-500" style={{ width: bar(Number(money?.paid ?? 0)) }} />
                    <span className="bg-sky-500" style={{ width: bar(Number(money?.approved_unpaid ?? 0)) }} />
                    <span className="bg-amber-400" style={{ width: bar(Number(money?.drafted ?? 0)) }} />
                  </div>
                  <p className={`mt-1 text-xs ${spent > est ? 'font-semibold text-red-600 dark:text-red-400' : 'text-slate-500'}`}>
                    {spent > est ? `${formatCurrency(spent - est)} over the estimate` : `${formatCurrency(est - spent)} of the estimate left`}
                  </p>
                </div>
              )}
              <FactList facts={[
                { label: 'Estimate', value: est > 0 ? formatCurrency(est) : 'None given', tone: est > 0 ? undefined : 'amber' },
                { label: 'Paid', value: formatCurrency(money?.paid ?? 0), tone: 'green' },
                { label: 'Approved, not paid', value: formatCurrency(money?.approved_unpaid ?? 0) },
                { label: 'Drafted, to approve', value: formatCurrency(money?.drafted ?? 0) },
                { label: 'Recorded, not drafted', value: money?.undrafted_entries ? `${money.undrafted_entries} entr${money.undrafted_entries === 1 ? 'y' : 'ies'}` : 'Nothing',
                  tone: money?.undrafted_entries ? 'amber' : undefined,
                  hint: money?.undrafted_entries && (role === 'admin' || role === 'finance' || role === 'hr_officer' || role === 'executive')
                    ? <Link to="/finance/labor-expense-drafts" className="text-brand hover:underline">Draft it in Labour pay →</Link> : undefined },
                { label: 'Last work recorded', value: money?.last_work_date ? formatDate(money.last_work_date) : '—' },
              ]} />
            </Panel>
          )}
          <Panel title="Details">
            <FactList facts={[
              { label: 'Headcount', value: req.headcount },
              { label: 'Rate', value: rate },
              ...(perVolume
                ? [{ label: 'Volume', value: `${req.estimated_total_volume ?? '—'} ${req.volume_unit ?? ''}` }]
                : [{ label: 'Days', value: req.estimated_days ?? '—' }]),
              { label: 'Kind', value: req.is_casual_or_new ? 'Casual / new' : 'Specialist' },
              { label: 'Work order', value: req.work_order_id ? <Link to={`/work-orders/${req.work_order_id}`} className="text-brand hover:underline">Open</Link> : 'Not linked', tone: req.work_order_id ? undefined : 'amber' },
              { label: 'Raised', value: formatDate(req.created_at) },
              ...(req.approved_at ? [{ label: req.status === 'rejected' ? 'Decided' : 'Approved', value: formatDate(req.approved_at) }] : []),
            ]} />
          </Panel>
        </>}
      />

      {dialog === 'approve' && (
        <ActionDialog title="Approve this requisition" confirmLabel="Approve" busy={busy} onClose={() => setDialog(null)} onConfirm={() => decide('approved')}
          description={`${req.role_needed} ×${req.headcount} on ${req.projects?.project_name ?? 'the project'}${est > 0 ? ` · ${formatCurrency(est)} is committed to the project's labour budget` : ''}.`}>
          <textarea className={fieldCls} rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" />
        </ActionDialog>
      )}
      {dialog === 'reject' && (
        <ActionDialog title="Reject this requisition" confirmLabel="Reject" danger busy={busy} canConfirm={note.trim().length > 2}
          onClose={() => setDialog(null)} onConfirm={() => decide('rejected')} description="Say why, so whoever raised it knows what to change.">
          <textarea className={fieldCls} rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="Why it is rejected" autoFocus />
        </ActionDialog>
      )}
      {dialog === 'extend' && (
        <ActionDialog title={closed ? 'Reopen and extend' : 'Extend the end date'} confirmLabel="Extend" busy={busy} canConfirm={!!newEnd && newEnd >= req.start_date}
          onClose={() => setDialog(null)} onConfirm={extend}
          description={`Currently ${req.end_date ? `ends ${formatDate(req.end_date)}` : 'open-ended'}. Workers still on it carry on to the new date.`}>
          <label className="block text-xs font-medium text-slate-500">New end date
            <input type="date" className={`${fieldCls} mt-1`} value={newEnd} min={req.start_date} onChange={e => setNewEnd(e.target.value)} />
          </label>
          <textarea className={fieldCls} rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Why (optional) — kept in the notes" />
        </ActionDialog>
      )}
      {dialog === 'close' && (
        <ActionDialog title="Close this requisition" confirmLabel="Close it" danger busy={busy} canConfirm={note.trim().length > 2}
          onClose={() => setDialog(null)} onConfirm={close}
          description="Stops filling it and releases what was never spent. Work already recorded can still be drafted and paid.">
          <textarea className={fieldCls} rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="Why it is closing (e.g. scope done, workers found elsewhere)" autoFocus />
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={endWorkers} onChange={e => setEndWorkers(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand" />
            Release the {active.length} worker{active.length === 1 ? '' : 's'} still on it today
          </label>
        </ActionDialog>
      )}
    </div>
  )
}
