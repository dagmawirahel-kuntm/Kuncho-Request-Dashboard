import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { Pill } from '@/components/record/Record'
import { APPROVER_ROLES, BASIS_LABEL, STAGE, dayLabel, estimateOf, fmtMoney, stageOf, useLabourSites, type LabourRequest, type RequestStage } from '@/lib/labour'
import { ChevronRight, ClipboardCheck, HardHat, Plus, Search, Wallet, Inbox } from 'lucide-react'

const card = 'rounded-2xl border bg-white dark:border-slate-700 dark:bg-slate-800'
const TABS: RequestStage[] = ['waiting', 'active', 'ended', 'declined']

// Labour in one place: ask, record, confirm pay — and what's waiting on you.
export default function LabourHomePage() {
  const { role } = useAuth()
  const { sites, managedIds, everywhere } = useLabourSites()
  const approver = APPROVER_ROLES.includes(role ?? '')
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
  const { data: financeWaiting = 0 } = useQuery({
    queryKey: ['labour-finance-waiting'],
    enabled: finance || role === 'admin',
    queryFn: async () => {
      const { count } = await supabase.from('labour_pay_sheets').select('id, expenses!inner(approval_status)', { count: 'exact', head: true })
        .eq('expenses.approval_status', 'pending')
      return count ?? 0
    },
  })

  // Labour still open on jobs that are already finished (migration 408).
  const { toast } = useToast()
  const canBulkClose = ['admin', 'executive', 'operations_manager', 'hr_officer'].includes(role ?? '')
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

  // Everyone who isn't an approver or finance sees their own sites' requests.
  const mine = everywhere || finance ? requests : requests.filter(r => siteIds.has(r.project_id))
  const toApprove = approver ? requests.filter(r => r.status === 'pending') : []
  const toConfirm = unpaid.filter(u => u.ready && (['admin', 'operations_manager'].includes(role ?? '') || managedIds.has(u.project_id)))
  const noWorkers = mine.filter(r => stageOf(r) === 'active' && !r.slots_filled && (siteIds.has(r.project_id)))

  const needle = q.trim().toLowerCase()
  const shown = mine.filter(r => stageOf(r) === tab)
    .filter(r => !needle || `${r.role_needed} ${r.projects?.project_name ?? ''} ${r.scope_of_work ?? ''}`.toLowerCase().includes(needle))
  const count = (s: RequestStage) => mine.filter(r => stageOf(r) === s).length

  const todo: { to: string; label: string; n: number; tone: string }[] = [
    ...(toApprove.length ? [{ to: '#waiting', label: 'Requests to approve', n: toApprove.length, tone: 'bg-amber-500' }] : []),
    ...(toConfirm.length ? [{ to: '/labour/pay', label: 'Weeks to confirm for pay', n: toConfirm.length, tone: 'bg-blue-600' }] : []),
    ...(noWorkers.length ? [{ to: '#active', label: 'Approved, no workers added yet', n: noWorkers.length, tone: 'bg-slate-500' }] : []),
    ...(financeWaiting ? [{ to: '/finance/labor-expense-drafts', label: 'Confirmed pay waiting for finance', n: financeWaiting, tone: 'bg-emerald-600' }] : []),
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
