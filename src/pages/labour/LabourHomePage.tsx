import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { Pill } from '@/components/record/Record'
import { usePayableDrafts } from '@/lib/labourPayRequests'
import { useMyWorkers } from '@/lib/workerDetails'
import { APPROVER_ROLES, BASIS_LABEL, STAGE, dayLabel, estimateOf, fmtMoney, overtimeSummary, stageOf, useLabourSites, useOvertimeSettings, type LabourRequest, type RequestStage } from '@/lib/labour'
import { CalendarDays, ChevronRight, IdCard, ClipboardCheck, Clock, FileCheck2, HardHat, Plus, Search, Wallet, Inbox } from 'lucide-react'

const card = 'rounded-2xl border bg-white dark:border-slate-700 dark:bg-slate-800'
const TABS: RequestStage[] = ['waiting', 'active', 'ended', 'declined']

// Labour in one place: ask, record, confirm pay — and what's waiting on you.
export default function LabourHomePage() {
  const { role, hasRole } = useAuth()
  const { sites, managedIds, everywhere } = useLabourSites()
  const approver = hasRole(...APPROVER_ROLES)
  const { data: otSettings } = useOvertimeSettings()
  const finance = role === 'finance'
  const siteIds = new Set(sites.map(s => s.id))
  const [tab, setTab] = useState<RequestStage>('active')
  const [q, setQ] = useState('')

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['labour-requests'],
    queryFn: async () => {
      const { data, error } = await supabase.from('labor_requisitions')
        .select('*, projects(project_name), vendors:gang_leader_vendor_id(vendor_name)')
        .order('created_at', { ascending: false }).limit(400)
      if (error) throw error
      return (data ?? []) as LabourRequest[]
    },
  })
  const { data: unpaid = [] } = useQuery({
    queryKey: ['labour-unpaid'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_labour_unpaid').select('*').order('first_day')
      if (error) throw error
      return (data ?? []) as { labor_requisition_id: string; project_id: string; ready: boolean }[]
    },
  })
  // Finance works payment requests from PMs (479), not loose pay sheets.
  const { data: financeWaiting = 0 } = useQuery({
    queryKey: ['labour-finance-waiting'],
    enabled: finance || role === 'admin',
    queryFn: async () => {
      const { count } = await supabase.from('labour_pay_requests').select('id', { count: 'exact', head: true })
        .in('status', ['submitted', 'approved'])
      return count ?? 0
    },
  })
  // The PM's side: confirmed pay not yet put in a request.
  const { data: toRequest = [] } = usePayableDrafts(!finance)
  // Workers whose details the site team still has to fill in, or fix (482).
  const { data: myWorkers = [] } = useMyWorkers(!finance)
  const detailsReturned = myWorkers.filter(w => w.returned_reason).length
  const detailsMissing = myWorkers.filter(w => !w.returned_reason && !w.verified && (w.gaps?.length ?? 0) > 0).length

  // Labour still open on jobs that are already finished (migration 408).
  const { toast } = useToast()
  const canBulkClose = hasRole('admin', 'executive', 'operations_manager', 'hr_officer')
  const { data: onFinished = 0, refetch: refetchFinished } = useQuery({
    queryKey: ['labour-open-on-finished-orders'],
    enabled: canBulkClose,
    queryFn: async () => {
      const { count, error } = await supabase.from('labor_requisitions').select('id, work_orders!inner(status)', { count: 'exact', head: true })
        .eq('status', 'approved').is('closed_at', null).in('work_orders.status', ['completed', 'cancelled'])
      if (error) throw error
      return count ?? 0
    },
  })
  const [closing, setClosing] = useState(false)
  async function closeFinished() {
    if (!confirm(`End the ${onFinished} labour request${onFinished === 1 ? '' : 's'} on finished jobs? Workers are released; days already recorded can still be paid.`)) return
    setClosing(true)
    const { data, error } = await supabase.rpc('close_labour_of_finished_orders')
    setClosing(false)
    if (error) { toast(error.message, 'error'); return }
    refetchFinished()
    toast(`${Number(data ?? 0)} labour request${Number(data) === 1 ? '' : 's'} ended`, 'success')
  }

  // Requests with no work recorded for three weeks (migration 476): end
  // them, or record the work, so "on this job" keeps meaning something.
  type Quiet = { id: string; role_needed: string; project_name: string | null; work_order: string | null; workers: number; last_day: string | null; created_at: string }
  const { data: quiet = [], refetch: refetchQuiet } = useQuery({
    queryKey: ['labour-quiet-requests'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('labour_quiet_requests')
      if (error) throw error
      return (data ?? []) as Quiet[]
    },
  })
  const [showQuiet, setShowQuiet] = useState(false)
  const [ending, setEnding] = useState<string | null>(null)
  async function endQuiet(ids: string[]) {
    if (ids.length > 1 && !confirm(`End all ${ids.length} quiet labour requests? Their workers are released from the jobs; days already recorded can still be paid.`)) return
    setEnding(ids.length > 1 ? 'all' : ids[0])
    let done = 0
    for (const id of ids) {
      const { error } = await supabase.rpc('close_labor_requisition', { p_id: id, p_reason: 'No work recorded for three weeks', p_end_workers: true })
      if (error) { toast(error.message, 'error'); break }
      done++
    }
    setEnding(null)
    refetchQuiet()
    if (done) toast(`${done} labour request${done === 1 ? '' : 's'} ended`, 'success')
  }

  // Everyone who isn't an approver or finance sees their own sites' requests.
  const mine = everywhere || finance ? requests : requests.filter(r => siteIds.has(r.project_id))
  const toApprove = approver ? requests.filter(r => r.status === 'pending') : []
  const toConfirm = unpaid.filter(u => u.ready && (hasRole('admin', 'operations_manager') || managedIds.has(u.project_id)))
  const noWorkers = mine.filter(r => stageOf(r) === 'active' && !r.slots_filled && (siteIds.has(r.project_id)))

  const needle = q.trim().toLowerCase()
  const shown = mine.filter(r => stageOf(r) === tab)
    .filter(r => !needle || `${r.role_needed} ${r.projects?.project_name ?? ''} ${r.scope_of_work ?? ''}`.toLowerCase().includes(needle))
  const count = (s: RequestStage) => mine.filter(r => stageOf(r) === s).length

  const todo: { to: string; label: string; n: number; tone: string }[] = [
    ...(toApprove.length ? [{ to: '#waiting', label: 'Requests to approve', n: toApprove.length, tone: 'bg-amber-500' }] : []),
    ...(toConfirm.length ? [{ to: '/labour/pay', label: 'Weeks to confirm for pay', n: toConfirm.length, tone: 'bg-blue-600' }] : []),
    ...(noWorkers.length ? [{ to: '#active', label: 'Approved, no workers added yet', n: noWorkers.length, tone: 'bg-slate-500' }] : []),
    ...(detailsReturned ? [{ to: '/labour/workers', label: 'Worker details sent back by HR', n: detailsReturned, tone: 'bg-red-600' }] : []),
    ...(detailsMissing ? [{ to: '/labour/workers', label: 'Workers with details missing (their pay waits)', n: detailsMissing, tone: 'bg-amber-500' }] : []),
    ...(toRequest.length ? [{ to: '/labour/requests?view=mine', label: 'Confirmed pay to send in a payment request', n: toRequest.length, tone: 'bg-blue-600' }] : []),
    ...(financeWaiting ? [{ to: '/labour/requests', label: 'Payment requests to approve or pay', n: financeWaiting, tone: 'bg-emerald-600' }] : []),
  ]

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-10">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-bold text-slate-800 dark:text-slate-100"><HardHat className="h-5 w-5 text-brand" /> Labour</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Ask for workers, record their work, confirm their pay.</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Link to="/labour/new" className={`${card} flex flex-col items-center gap-1.5 p-3 text-center text-sm font-semibold text-slate-700 hover:border-brand dark:text-slate-200`}>
          <span className="rounded-full bg-brand/10 p-2 text-brand"><Plus className="h-5 w-5" /></span>Ask
        </Link>
        <Link to="/labour/record" className={`${card} flex flex-col items-center gap-1.5 p-3 text-center text-sm font-semibold text-slate-700 hover:border-brand dark:text-slate-200`}>
          <span className="rounded-full bg-brand/10 p-2 text-brand"><ClipboardCheck className="h-5 w-5" /></span>Record today
        </Link>
        <Link to="/labour/pay" className={`${card} relative flex flex-col items-center gap-1.5 p-3 text-center text-sm font-semibold text-slate-700 hover:border-brand dark:text-slate-200`}>
          <span className="rounded-full bg-brand/10 p-2 text-brand"><Wallet className="h-5 w-5" /></span>Confirm pay
          {toConfirm.length > 0 && <span className="absolute right-2 top-2 rounded-full bg-blue-600 px-1.5 text-[11px] font-bold text-white">{toConfirm.length}</span>}
        </Link>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <Link to="/labour/record/week" className="flex shrink-0 items-center gap-1.5 hover:text-brand"><CalendarDays className="h-3.5 w-3.5" /> Record a week</Link>
        <Link to="/labour/workers" className="flex shrink-0 items-center gap-1.5 hover:text-brand"><IdCard className="h-3.5 w-3.5" /> Worker details</Link>
        <Link to="/labour/requests" className="flex shrink-0 items-center gap-1.5 hover:text-brand"><FileCheck2 className="h-3.5 w-3.5" /> Payment requests</Link>
        <Link to="/labour/overtime" className="flex min-w-0 items-center gap-1.5 hover:text-brand">
          <Clock className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">Overtime · {overtimeSummary({ overtime_rule: 'company', overtime_multiplier: null, overtime_hour_rate: null }, otSettings)}</span>
        </Link>
      </div>

      {canBulkClose && onFinished > 0 && (
        <div className={`${card} flex flex-wrap items-center gap-3 border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800/40 dark:bg-amber-900/10`}>
          <p className="flex-1 text-sm text-amber-900 dark:text-amber-200">
            {onFinished} labour request{onFinished === 1 ? ' is' : 's are'} still open on work orders that are already finished.
          </p>
          <button onClick={closeFinished} disabled={closing} className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
            {closing ? 'Ending…' : 'End them'}
          </button>
        </div>
      )}

      {quiet.length > 0 && (
        <section className={card}>
          <button onClick={() => setShowQuiet(v => !v)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
            <span className="min-w-[1.75rem] rounded-full bg-slate-500 px-2 py-0.5 text-center text-xs font-bold text-white">{quiet.length}</span>
            <span className="flex-1">
              <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">Gone quiet</span>
              <span className="block text-xs text-slate-500">Approved labour with no work recorded for three weeks — end it, or record the work.</span>
            </span>
            <span className="text-xs text-brand">{showQuiet ? 'Hide' : 'Show'}</span>
          </button>
          {showQuiet && (
            <>
              <ul className="divide-y border-t dark:divide-slate-700 dark:border-slate-700">
                {quiet.map(r => (
                  <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                    <Link to={`/labour/${r.id}`} className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{r.role_needed} <span className="font-normal text-slate-500">· {r.project_name}</span></p>
                      <p className="truncate text-xs text-slate-500">
                        {r.work_order ?? 'No work order'} · {r.workers} worker{r.workers === 1 ? '' : 's'} · {r.last_day ? `last worked ${dayLabel(r.last_day)}` : 'never worked'}
                      </p>
                    </Link>
                    <button onClick={() => endQuiet([r.id])} disabled={!!ending}
                      className="shrink-0 rounded-lg border px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300">
                      {ending === r.id ? 'Ending…' : 'End'}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex justify-end border-t px-4 py-2.5 dark:border-slate-700">
                <button onClick={() => endQuiet(quiet.map(r => r.id))} disabled={!!ending}
                  className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                  {ending === 'all' ? 'Ending…' : `End all ${quiet.length}`}
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {todo.length > 0 && (
        <section className={card}>
          <h2 className="flex items-center gap-2 border-b px-4 py-3 font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100"><Inbox className="h-4 w-4 text-slate-400" /> Waiting on you</h2>
          <ul className="divide-y dark:divide-slate-700">
            {todo.map(t => {
              const inner = <>
                <span className={`min-w-[1.75rem] rounded-full px-2 py-0.5 text-center text-xs font-bold text-white ${t.tone}`}>{t.n}</span>
                <span className="flex-1 text-sm text-slate-700 dark:text-slate-200">{t.label}</span>
                <ChevronRight className="h-4 w-4 text-slate-300" />
              </>
              const cls = 'flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700/40'
              return <li key={t.label}>{t.to.startsWith('#')
                ? <button className={cls} onClick={() => setTab(t.to.slice(1) as RequestStage)}>{inner}</button>
                : <Link to={t.to} className={cls}>{inner}</Link>}</li>
            })}
          </ul>
        </section>
      )}

      <section className={card}>
        <div className="flex gap-1 overflow-x-auto border-b px-2 pt-2 dark:border-slate-700">
          {TABS.map(s => (
            <button key={s} onClick={() => setTab(s)}
              className={`shrink-0 border-b-2 px-3 pb-2 text-sm font-medium ${tab === s ? 'border-brand text-brand' : 'border-transparent text-slate-500'}`}>
              {s === 'waiting' ? 'Waiting' : STAGE[s].label} <span className="text-xs text-slate-400">{count(s)}</span>
            </button>
          ))}
        </div>
        <div className="relative border-b px-3 py-2 dark:border-slate-700">
          <Search className="absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search work or site…"
            className="w-full rounded-lg bg-slate-50 py-2 pl-8 pr-3 text-base outline-none sm:text-sm dark:bg-slate-900/40 dark:text-slate-100" />
        </div>
        {isLoading ? <p className="p-6 text-center text-sm text-slate-400">Loading…</p> : shown.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-400">Nothing here.</p>
        ) : (
          <ul className="divide-y dark:divide-slate-700">
            {shown.map(r => {
              const est = estimateOf(r)
              return (
                <li key={r.id}>
                  <Link to={`/labour/${r.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{r.role_needed}{r.headcount > 1 ? ` × ${r.headcount}` : ''}</p>
                      <p className="truncate text-xs text-slate-500">
                        {r.projects?.project_name ?? '—'} · {r.start_date ? dayLabel(r.start_date) : '—'}{r.end_date ? ` → ${dayLabel(r.end_date)}` : ''} · {BASIS_LABEL[r.payment_basis]}
                      </p>
                    </div>
                    {tab === 'waiting' && est != null && <span className="text-xs text-slate-500">{fmtMoney(est)}</span>}
                    <ChevronRight className="h-4 w-4 text-slate-300" />
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {sites.length === 0 && !everywhere && !finance && (
        <p className="text-center text-xs text-slate-400">You'll see requests here once you manage or run a site. <Pill>Tip</Pill> anyone can open a request link they're sent.</p>
      )}
    </div>
  )
}
