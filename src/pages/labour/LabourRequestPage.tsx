import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { Pill } from '@/components/record/Record'
import { buildPaySheetHtml, type PayLine } from '@/lib/documents/labourPay'
import { printHtml } from '@/lib/documents/issue'
import { shareHtmlFile } from '@/lib/documents/shareFile'
import {
  APPROVER_ROLES, BASIS_LABEL, STAGE, addDays, financeStatus, financeTone, dayLabel, estimateOf, fmtMoney, isoDay, rateSummary, stageOf, type LabourRequest,
} from '@/lib/labour'
import {
  ArrowLeft, Check, ClipboardCheck, Clock, FileText, MessageSquare, Printer, Send, Smartphone, UserMinus, UserPlus, Wallet, X,
  CalendarPlus, Ban, Undo2, Users,
} from 'lucide-react'

type Person = { staff_id: string | null; candidate_id: string | null; name: string; phone: string | null; day_rate: number | null; state: 'on_site' | 'left' | 'named' | 'new'; since: string | null }
type Event = { id: string; kind: string; body: string | null; actor_name: string | null; created_at: string }
type Sheet = {
  id: string; code: string; period_start: string; period_end: string; total: number; lines: PayLine[]; note: string | null
  confirmed_by_name: string | null; confirmed_at: string
  expenses: { approval_status: string; payment_state: string } | null
}

const input = 'w-full rounded-lg border px-3 py-2.5 text-base sm:text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const card = 'rounded-2xl border bg-white dark:border-slate-700 dark:bg-slate-800'

const EVENT: Record<string, { label: string; icon: typeof Check; tone: string }> = {
  requested: { label: 'Asked for labour', icon: Send, tone: 'text-slate-500' },
  approved: { label: 'Approved', icon: Check, tone: 'text-emerald-600' },
  rejected: { label: 'Declined', icon: X, tone: 'text-red-600' },
  closed: { label: 'Closed', icon: Ban, tone: 'text-slate-500' },
  extended: { label: 'Extended', icon: CalendarPlus, tone: 'text-blue-600' },
  worker_added: { label: 'Worker added', icon: UserPlus, tone: 'text-slate-500' },
  worker_removed: { label: 'Worker removed', icon: UserMinus, tone: 'text-slate-500' },
  pay_confirmed: { label: 'Pay confirmed by the site', icon: ClipboardCheck, tone: 'text-brand' },
  pay_reopened: { label: 'Pay confirmation taken back', icon: Undo2, tone: 'text-amber-600' },
  pay_approved: { label: 'Finance approved the pay', icon: Wallet, tone: 'text-emerald-600' },
  pay_rejected: { label: 'Finance sent the pay back', icon: X, tone: 'text-red-600' },
  paid: { label: 'Paid', icon: Wallet, tone: 'text-emerald-600' },
  comment: { label: '', icon: MessageSquare, tone: 'text-slate-400' },
}
const PERSON_STATE: Record<Person['state'], { label: string; tone: 'green' | 'slate' | 'amber' | 'blue' }> = {
  on_site: { label: 'On site', tone: 'green' },
  named: { label: 'Starts on approval', tone: 'blue' },
  new: { label: 'New · hired on approval', tone: 'amber' },
  left: { label: 'Left', tone: 'slate' },
}
const when = (ts: string) => new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function LabourRequestPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const { toast } = useToast()
  const { role, user } = useAuth()

  const { data: req, isLoading } = useQuery({
    queryKey: ['labour-request', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('labor_requisitions')
        .select('*, projects(project_name), vendors:gang_leader_vendor_id(vendor_name), work_orders(id, title, scope_of_work, status)').eq('id', id!).single()
      if (error) throw error
      return data as LabourRequest
    },
  })
  const { data: canRun = false } = useQuery({
    queryKey: ['labour-can-run', req?.project_id],
    enabled: !!req,
    queryFn: async () => {
      const { data } = await supabase.rpc('can_run_labour_site', { p_project: req!.project_id })
      return !!data
    },
  })
  const { data: people = [] } = useQuery({
    queryKey: ['labour-request-people', id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('labour_request_people', { p_req: id })
      if (error) throw error
      return (data ?? []) as Person[]
    },
  })
  const { data: events = [] } = useQuery({
    queryKey: ['labour-request-events', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('labour_request_events').select('id, kind, body, actor_name, created_at')
        .eq('labor_requisition_id', id!).order('created_at')
      if (error) throw error
      return (data ?? []) as Event[]
    },
  })
  const { data: sheets = [] } = useQuery({
    queryKey: ['labour-request-sheets', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('labour_pay_sheets')
        .select('id, code, period_start, period_end, total, lines, note, confirmed_by_name, confirmed_at, expenses(approval_status, payment_state)')
        .eq('labor_requisition_id', id!).order('period_end', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as Sheet[]
    },
  })
  const { data: unpaid } = useQuery({
    queryKey: ['labour-unpaid', 'request', id],
    queryFn: async () => {
      const { data } = await supabase.from('v_labour_unpaid').select('days_recorded, first_day, last_day, ready').eq('labor_requisition_id', id!).maybeSingle()
      return data as { days_recorded: number; first_day: string; last_day: string; ready: boolean } | null
    },
  })

  const [dialog, setDialog] = useState<null | 'approve' | 'reject' | 'withdraw' | 'close' | 'extend' | 'add'>(null)
  const [note, setNote] = useState('')
  const [newEnd, setNewEnd] = useState('')
  const [busy, setBusy] = useState(false)
  const [comment, setComment] = useState('')
  const [addMode, setAddMode] = useState<'roster' | 'new'>('roster')
  const [pick, setPick] = useState<string | null>(null)
  const [person, setPerson] = useState({ name: '', phone: '' })

  const { data: roster = [] } = useQuery({
    queryKey: ['labour-roster-workers'],
    enabled: dialog === 'add',
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_staff_directory')
        .select('id, employee_name, phone_number, role, employment_type, status')
        .eq('status', 'active').eq('employment_type', 'tier_2_casual').order('employee_name')
      if (error) throw error
      return (data ?? []) as { id: string; employee_name: string; phone_number: string | null; role: string | null }[]
    },
  })

  function refresh() {
    for (const k of ['labour-request', 'labour-request-people', 'labour-request-events', 'labour-request-sheets']) qc.invalidateQueries({ queryKey: [k, id] })
    qc.invalidateQueries({ queryKey: ['labour-requests'] })
    qc.invalidateQueries({ queryKey: ['labour-unpaid'] })
  }
  function open(d: NonNullable<typeof dialog>) {
    setNote('')
    if (d === 'extend' && req) setNewEnd(addDays(req.end_date && req.end_date > isoDay(new Date()) ? req.end_date : isoDay(new Date()), 14))
    setDialog(d)
  }
  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>, done: string) {
    setBusy(true)
    const { error } = await fn()
    setBusy(false)
    if (error) { toast(error.message, 'error'); return false }
    toast(done, 'success')
    setDialog(null); refresh()
    return true
  }

  if (isLoading || !req) return <div className="py-12 text-center text-sm text-slate-400">Loading…</div>

  const stage = stageOf(req)
  const approver = APPROVER_ROLES.includes(role ?? '')
  const isAsker = req.requested_by === user?.id
  const canManage = approver || canRun
  const open_ = req.status !== 'rejected' && !req.closed_at
  const onSite = people.filter(p => p.state === 'on_site')
  const waitingPeople = people.filter(p => p.state === 'named' || p.state === 'new')
  const estimate = estimateOf(req)
  const unnamed = Math.max((req.headcount || 0) - onSite.length - waitingPeople.length, 0)

  // Whose turn is it?
  const turn = stage === 'waiting'
    ? { who: 'Operations manager or HR', what: 'to approve or decline', tone: 'amber' as const }
    : stage === 'declined' ? null
    : unpaid?.ready ? { who: 'Project manager', what: `to confirm pay for ${unpaid.days_recorded} recorded day${unpaid.days_recorded === 1 ? '' : 's'}`, tone: 'blue' as const }
    : sheets.some(s => !s.expenses || (s.expenses.payment_state !== 'paid' && s.expenses.approval_status !== 'rejected')) ? { who: 'Finance', what: 'to approve and pay the confirmed pay sheet', tone: 'blue' as const }
    : stage === 'active' ? { who: 'Site team', what: onSite.length ? 'to record work each day' : 'to add the workers who came', tone: 'green' as const }
    : null

  async function sendSheet(s: Sheet, asFile: boolean) {
    const html = buildPaySheetHtml({
      code: s.code, project_name: req!.projects?.project_name ?? null, role_needed: req!.role_needed,
      payment_basis: req!.payment_basis, volume_unit: req!.volume_unit, crew_leader: req!.vendors?.vendor_name ?? null,
      period_start: s.period_start, period_end: s.period_end, total: s.total, lines: s.lines, note: s.note,
      confirmed_by_name: s.confirmed_by_name, confirmed_at: s.confirmed_at, finance_status: financeStatus(s.expenses),
    })
    const name = `${s.code} ${req!.role_needed} ${req!.projects?.project_name ?? ''}`
    if (!asFile) { printHtml(html, name); return }
    const r = await shareHtmlFile(html, name, `Labour pay sheet ${s.code} · ${fmtMoney(s.total)}`)
    if (r === 'downloaded') toast('Pay sheet saved as a file', 'success')
  }
  async function reopen(s: Sheet) {
    if (!confirm(`Take back ${s.code}? Its days go back to unconfirmed and finance no longer sees it.`)) return
    const { error } = await supabase.rpc('reopen_labour_pay', { p_sheet: s.id })
    if (error) { toast(error.message, 'error'); return }
    toast(`${s.code} taken back`, 'success'); refresh()
  }
  async function sendComment() {
    if (!comment.trim()) return
    const { error } = await supabase.rpc('add_labour_comment', { p_req: id, p_body: comment.trim() })
    if (error) { toast(error.message, 'error'); return }
    setComment('')
    qc.invalidateQueries({ queryKey: ['labour-request-events', id] })
  }
  async function addPerson() {
    if (addMode === 'roster') {
      if (!pick) return
      if (await run(() => supabase.rpc('labour_add_worker', { p_req: id, p_staff_id: pick }), 'Worker added')) setPick(null)
    } else {
      if (!person.name.trim()) { toast('Give the name', 'error'); return }
      if (await run(() => supabase.rpc('labour_add_new_worker', { p_req: id, p_name: person.name.trim(), p_phone: person.phone.trim() || null, p_day_rate: null }),
        req!.status === 'approved' ? `${person.name.trim()} is on the request` : `${person.name.trim()} will be hired when the request is approved`)) setPerson({ name: '', phone: '' })
    }
  }
  async function remove(p: Person) {
    if (!p.staff_id || !confirm(`Take ${p.name} off this request?`)) return
    await run(() => supabase.rpc('labour_remove_worker', { p_req: id, p_staff_id: p.staff_id }), `${p.name} taken off`)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-10">
      <Link to="/labour" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand"><ArrowLeft className="h-4 w-4" /> Labour</Link>

      {/* What and where */}
      <section className={`${card} p-4`}>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={STAGE[stage].tone}>{STAGE[stage].label}</Pill>
          <Pill>{BASIS_LABEL[req.payment_basis]}</Pill>
          {req.payment_model === 'gang_leader' && <Pill tone="violet">Crew leader{req.vendors?.vendor_name ? `: ${req.vendors.vendor_name}` : ''}</Pill>}
        </div>
        <h1 className="mt-2 text-xl font-bold text-slate-800 dark:text-slate-100">{req.role_needed}{req.headcount > 1 ? ` × ${req.headcount}` : ''}</h1>
        <p className="text-sm text-slate-500">{req.projects?.project_name ?? '—'}{req.site_location ? ` · ${req.site_location}` : ''}</p>
        <JobLink req={req} canManage={canManage} />
        {req.scope_of_work && <p className="mt-2 whitespace-pre-line text-sm text-slate-700 dark:text-slate-300">{req.scope_of_work}</p>}
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-xs text-slate-400">Dates</dt><dd>{req.start_date ? dayLabel(req.start_date) : '—'} → {req.end_date ? dayLabel(req.end_date) : 'open'}</dd></div>
          <div><dt className="text-xs text-slate-400">Rate</dt><dd>{rateSummary(req)}</dd></div>
          <div><dt className="text-xs text-slate-400">Paid</dt><dd>{req.pay_cycle === 'weekly' ? 'Every week' : 'At the end'}</dd></div>
          <div><dt className="text-xs text-slate-400">Estimate</dt><dd>{fmtMoney(estimate)}</dd></div>
        </dl>
        {req.decision_note && <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">“{req.decision_note}”</p>}
        {req.closed_at && <p className="mt-2 text-xs text-slate-500">Closed {dayLabel(req.closed_at.slice(0, 10))}{req.close_reason ? ` — ${req.close_reason}` : ''}</p>}
      </section>

      {/* Whose turn */}
      {turn && (
        <section className={`${card} flex items-start gap-3 border-l-4 p-4 ${turn.tone === 'amber' ? 'border-l-amber-400' : turn.tone === 'green' ? 'border-l-emerald-500' : 'border-l-blue-500'}`}>
          <Clock className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-slate-500">Next</p>
            <p className="font-semibold text-slate-800 dark:text-slate-100">{turn.who} <span className="font-normal text-slate-600 dark:text-slate-300">{turn.what}</span></p>
            <div className="mt-3 flex flex-wrap gap-2">
              {stage === 'waiting' && approver && <>
                <button onClick={() => open('approve')} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"><Check className="h-4 w-4" /> Approve</button>
                <button onClick={() => open('reject')} className="inline-flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-semibold text-red-600 dark:border-slate-600"><X className="h-4 w-4" /> Decline</button>
              </>}
              {stage === 'waiting' && !approver && (isAsker || canRun) && (
                <button onClick={() => open('withdraw')} className="rounded-lg border px-4 py-2 text-sm dark:border-slate-600">Withdraw</button>
              )}
              {stage === 'active' && canRun && req.status === 'approved' && (
                <Link to={`/labour/record?site=${req.project_id}`} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white"><ClipboardCheck className="h-4 w-4" /> Record work</Link>
              )}
              {unpaid && (canRun || approver) && (
                <Link to={`/labour/pay?req=${req.id}`} className="inline-flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-semibold dark:border-slate-600"><Wallet className="h-4 w-4" /> Confirm pay</Link>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Workers */}
      <section className={card}>
        <div className="flex items-center justify-between border-b px-4 py-3 dark:border-slate-700">
          <h2 className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-100"><Users className="h-4 w-4 text-slate-400" /> Workers <span className="text-sm font-normal text-slate-400">{onSite.length + waitingPeople.length}{req.headcount ? ` of ${req.headcount}` : ''}</span></h2>
          {open_ && canManage && <button onClick={() => open('add')} className="inline-flex items-center gap-1 rounded-lg bg-brand/10 px-3 py-1.5 text-sm font-semibold text-brand"><UserPlus className="h-4 w-4" /> Add</button>}
        </div>
        {people.length === 0 && unnamed === 0 ? <p className="px-4 py-6 text-center text-sm text-slate-400">No one named yet.</p> : (
          <ul className="divide-y dark:divide-slate-700">
            {[...onSite, ...waitingPeople, ...people.filter(p => p.state === 'left')].map(p => (
              <li key={p.staff_id ?? p.candidate_id} className={`flex items-center gap-3 px-4 py-2.5 ${p.state === 'left' ? 'opacity-50' : ''}`}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{p.name}</p>
                  <p className="text-xs text-slate-500">
                    {p.phone ? <a href={`tel:${p.phone}`} className="hover:text-brand">{p.phone}</a> : 'no phone'}
                    {p.day_rate && req.payment_basis === 'per_day' ? ` · ${fmtMoney(p.day_rate)}/day` : ''}
                  </p>
                </div>
                <Pill tone={PERSON_STATE[p.state].tone}>{PERSON_STATE[p.state].label}</Pill>
                {open_ && canManage && p.staff_id && p.state !== 'left' && (
                  <button onClick={() => remove(p)} className="rounded p-1.5 text-slate-400 hover:text-red-600" aria-label={`Remove ${p.name}`}><UserMinus className="h-4 w-4" /></button>
                )}
              </li>
            ))}
            {unnamed > 0 && <li className="px-4 py-2.5 text-sm text-slate-500">+ {unnamed} more, not named yet</li>}
          </ul>
        )}
      </section>

      {/* Pay */}
      {(sheets.length > 0 || unpaid) && (
        <section className={card}>
          <h2 className="flex items-center gap-2 border-b px-4 py-3 font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100"><Wallet className="h-4 w-4 text-slate-400" /> Pay</h2>
          {unpaid && (
            <div className="flex items-center justify-between gap-2 border-b px-4 py-3 text-sm dark:border-slate-700">
              <span className="text-slate-600 dark:text-slate-300">{unpaid.days_recorded} day{unpaid.days_recorded === 1 ? '' : 's'} recorded, not confirmed yet · {dayLabel(unpaid.first_day)} – {dayLabel(unpaid.last_day)}</span>
              {(canRun || approver) && <Link to={`/labour/pay?req=${req.id}`} className="shrink-0 font-semibold text-brand">Confirm →</Link>}
            </div>
          )}
          <ul className="divide-y dark:divide-slate-700">
            {sheets.map(s => {
              const fs = financeStatus(s.expenses)
              return (
                <li key={s.id} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100"><FileText className="mr-1 inline h-4 w-4 text-slate-400" />{s.code}</p>
                    <p className="text-sm font-semibold">{fmtMoney(s.total)}</p>
                  </div>
                  <p className="text-xs text-slate-500">{dayLabel(s.period_start)} – {dayLabel(s.period_end)} · confirmed by {s.confirmed_by_name ?? '—'}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Pill tone={financeTone(fs)}>{fs}</Pill>
                    <button onClick={() => sendSheet(s, true)} className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium dark:border-slate-600"><Smartphone className="h-3.5 w-3.5" /> Send file</button>
                    <button onClick={() => sendSheet(s, false)} className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium dark:border-slate-600"><Printer className="h-3.5 w-3.5" /> Print</button>
                    {(fs === 'Waiting for finance' || fs.startsWith('Sent back')) && (canRun || approver) && (
                      <button onClick={() => reopen(s)} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs text-amber-700"><Undo2 className="h-3.5 w-3.5" /> Take back</button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* Timeline + comments */}
      <section className={card}>
        <h2 className="flex items-center gap-2 border-b px-4 py-3 font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100"><MessageSquare className="h-4 w-4 text-slate-400" /> What happened</h2>
        <ol className="space-y-3 px-4 py-3">
          {events.map(e => {
            const ev = EVENT[e.kind] ?? { label: e.kind, icon: Clock, tone: 'text-slate-400' }
            const Icon = ev.icon
            return e.kind === 'comment' ? (
              <li key={e.id} className="flex gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-bold text-brand">{(e.actor_name ?? '?').slice(0, 1)}</div>
                <div className="min-w-0 flex-1 rounded-xl rounded-tl-sm bg-slate-100 px-3 py-2 dark:bg-slate-900/50">
                  <p className="text-xs text-slate-500"><b className="text-slate-700 dark:text-slate-200">{e.actor_name ?? 'Someone'}</b> · {when(e.created_at)}</p>
                  <p className="whitespace-pre-line text-sm text-slate-800 dark:text-slate-100">{e.body}</p>
                </div>
              </li>
            ) : (
              <li key={e.id} className="flex gap-2 text-sm">
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${ev.tone}`} />
                <div className="min-w-0">
                  <span className="font-medium text-slate-700 dark:text-slate-200">{ev.label}</span>
                  {e.body && <span className="text-slate-500"> — {e.body}</span>}
                  <p className="text-xs text-slate-400">{e.actor_name ? `${e.actor_name} · ` : ''}{when(e.created_at)}</p>
                </div>
              </li>
            )
          })}
        </ol>
        <div className="flex gap-2 border-t p-3 dark:border-slate-700">
          <textarea value={comment} onChange={e => setComment(e.target.value)} rows={1} placeholder="Write a message — everyone on this request sees it"
            className={`${input} min-h-[44px] resize-none`} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendComment() }} />
          <button onClick={sendComment} disabled={!comment.trim()} className="shrink-0 rounded-lg bg-brand px-3 text-white disabled:opacity-40" aria-label="Send"><Send className="h-4 w-4" /></button>
        </div>
      </section>

      {/* Close / extend */}
      {req.status === 'approved' && canManage && (
        <div className="flex flex-wrap justify-center gap-2 text-sm">
          <button onClick={() => open('extend')} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 dark:border-slate-600"><CalendarPlus className="h-4 w-4" /> {req.closed_at ? 'Reopen with a new end date' : 'Extend'}</button>
          {!req.closed_at && <button onClick={() => open('close')} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-slate-600 dark:border-slate-600"><Ban className="h-4 w-4" /> Close — work is done</button>}
        </div>
      )}

      {/* Dialogs: a bottom sheet on a phone */}
      {dialog && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center" onClick={() => !busy && setDialog(null)}>
          <div className="w-full max-w-md rounded-t-2xl bg-white p-4 shadow-xl dark:bg-slate-800 sm:rounded-2xl" onClick={e => e.stopPropagation()}>
            {dialog === 'add' ? (
              <>
                <h3 className="mb-3 font-semibold">Add a worker</h3>
                <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 text-sm dark:bg-slate-900">
                  {(['roster', 'new'] as const).map(m => (
                    <button key={m} onClick={() => setAddMode(m)} className={`rounded-md py-1.5 font-medium ${addMode === m ? 'bg-white shadow dark:bg-slate-700' : 'text-slate-500'}`}>{m === 'roster' ? 'Worked with us before' : 'Someone new'}</button>
                  ))}
                </div>
                {addMode === 'roster' ? (
                  <SearchableSelect value={pick} onChange={setPick} placeholder="Search by name or phone…"
                    options={roster.filter(w => !people.some(p => p.staff_id === w.id && p.state !== 'left')).map(w => ({ id: w.id, label: w.employee_name, sub: [w.role, w.phone_number].filter(Boolean).join(' · ') }))} />
                ) : (
                  <div className="space-y-2">
                    <input className={input} value={person.name} onChange={e => setPerson(p => ({ ...p, name: e.target.value }))} placeholder="Full name" autoFocus />
                    <input className={input} value={person.phone} onChange={e => setPerson(p => ({ ...p, phone: e.target.value }))} placeholder="Phone (so they can be found again)" inputMode="tel" />
                  </div>
                )}
                <p className="mt-2 text-xs text-slate-500">{req.status === 'approved' ? 'They are on the request from today and can be recorded straight away.' : 'They start once the request is approved.'}</p>
                <div className="mt-4 flex gap-2">
                  <button onClick={() => setDialog(null)} className="flex-1 rounded-lg border py-2.5 text-sm dark:border-slate-600">Done</button>
                  <button onClick={addPerson} disabled={busy} className="flex-1 rounded-lg bg-brand py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Adding…' : 'Add'}</button>
                </div>
              </>
            ) : (
              <>
                <h3 className="mb-1 font-semibold">
                  {{ approve: 'Approve this request', reject: 'Decline this request', withdraw: 'Withdraw this request', close: 'Close this request', extend: 'New end date' }[dialog]}
                </h3>
                {dialog === 'approve' && <p className="mb-3 text-sm text-slate-500">About {fmtMoney(estimate)} is committed to {req.projects?.project_name}. New people named on it are hired.</p>}
                {dialog === 'close' && <p className="mb-3 text-sm text-slate-500">Everyone still on it is released. Recorded work can still be confirmed and paid.</p>}
                {dialog === 'extend' && <input type="date" className={`${input} mb-3`} value={newEnd} min={req.start_date ?? undefined} onChange={e => setNewEnd(e.target.value)} />}
                <textarea className={input} rows={3} value={note} onChange={e => setNote(e.target.value)}
                  placeholder={dialog === 'reject' || dialog === 'close' ? 'Why? (needed)' : 'Note (optional)'} />
                <div className="mt-4 flex gap-2">
                  <button onClick={() => setDialog(null)} className="flex-1 rounded-lg border py-2.5 text-sm dark:border-slate-600">Cancel</button>
                  <button disabled={busy || ((dialog === 'reject' || dialog === 'close') && !note.trim())}
                    className={`flex-1 rounded-lg py-2.5 text-sm font-semibold text-white disabled:opacity-50 ${dialog === 'approve' ? 'bg-emerald-600' : dialog === 'reject' ? 'bg-red-600' : 'bg-brand'}`}
                    onClick={() => {
                      const n = note.trim() || null
                      if (dialog === 'approve' || dialog === 'reject') {
                        const status = dialog === 'approve' ? 'approved' : 'rejected'
                        run(() => supabase.from('labor_requisitions').update({ status, decision_note: n }).eq('id', id!).select('id').single(),
                          status === 'approved' ? 'Approved' : 'Declined')
                      } else if (dialog === 'withdraw') run(() => supabase.rpc('withdraw_labour_request', { p_req: id, p_reason: n }), 'Withdrawn')
                      else if (dialog === 'close') run(() => supabase.rpc('close_labor_requisition', { p_id: id, p_reason: n, p_end_workers: true }), 'Closed')
                      else run(() => supabase.rpc('extend_labor_requisition', { p_id: id, p_new_end: newEnd, p_note: n }), `Now ends ${dayLabel(newEnd)}`)
                    }}>
                    {busy ? 'Working…' : 'Confirm'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// The work order this labour is for. Linking one counts the labour on that
// job and brings the workers onto its crew (migration 408).
function JobLink({ req, canManage }: { req: LabourRequest; canManage: boolean }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [picking, setPicking] = useState(false)
  const { data: orders = [] } = useQuery({
    queryKey: ['labour-site-work-orders', req.project_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('work_orders').select('id, title, scope_of_work, status')
        .eq('project_id', req.project_id).in('status', ['requested', 'in_progress']).order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as { id: string; title: string | null; scope_of_work: string | null; status: string }[]
    },
    enabled: picking,
  })
  async function link(woId: string | null) {
    if (!woId) return
    const { error } = await supabase.from('labor_requisitions').update({ work_order_id: woId }).eq('id', req.id)
    if (error) { toast(error.message, 'error'); return }
    toast('Linked to the job — its workers are on the crew now', 'success')
    setPicking(false)
    qc.invalidateQueries({ queryKey: ['labour-request', req.id] })
  }
  const wo = req.work_orders
  if (wo) {
    return (
      <Link to={`/work-orders/${wo.id}`} className="mt-1 inline-flex items-center gap-1 text-sm text-brand hover:underline">
        Job: {wo.title || (wo.scope_of_work ?? 'Work order').slice(0, 60)}
      </Link>
    )
  }
  if (!canManage) return <p className="mt-1 text-xs text-slate-400">Not linked to a work order</p>
  return picking ? (
    <div className="mt-2 max-w-sm">
      <SearchableSelect value={null} onChange={link}
        options={orders.map(o => ({ id: o.id, label: o.title || (o.scope_of_work ?? 'Work order').slice(0, 60), sub: o.status === 'in_progress' ? 'in progress' : 'not started' }))}
        placeholder={orders.length ? 'Choose the job…' : 'No open work orders on this site'} />
    </div>
  ) : (
    <button onClick={() => setPicking(true)} className="mt-1 text-xs font-medium text-amber-700 hover:underline dark:text-amber-400">
      Not linked to a work order — link it
    </button>
  )
}
