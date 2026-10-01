import { Link } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { RoleViewSwitcher } from '@/components/shared/RoleViewSwitcher'
import { formatCurrency, formatCurrencyCompact } from '@/lib/utils'
import { useTabParam } from '@/lib/useTabParam'
import { toSend, useAdvanceGrns, useIsVrfManager, usePaymentsData } from '@/lib/payments'
import ToPayTab from './ToPayTab'
import ToConfirmTab from './ToConfirmTab'
import AdvancesTab from './AdvancesTab'
import PaperworkTab from './PaperworkTab'
import PaidTab from './PaidTab'
import { ArrowRight, ChevronRight, FileText, HandCoins, Landmark } from 'lucide-react'

// Payments (redesign). The page used to stack ten blocks — four KPI cards,
// a cash board, the advances, the to-pay table, VRF, withholding, the VRF
// tunnel, a 189-row approval table, bank confirmations, this week — so
// nothing could be judged at a glance.
//
// Now it reads as the pipeline money moves through:
//   To approve → To pay → Sent, to confirm → Paid
// One strip shows each stage's count, amount and what's overdue; one
// workspace is open at a time. Approving lives in the Approval Queue.

type Tab = 'pay' | 'confirm' | 'advances' | 'paperwork' | 'paid'
const TABS: Tab[] = ['pay', 'confirm', 'advances', 'paperwork', 'paid']
const daysSince = (ts: string | null) => ts ? (Date.now() - new Date(ts).getTime()) / 86_400_000 : 0

export default function PaymentsPage() {
  const { role } = useAuth()
  const canAct = role === 'admin' || role === 'finance'
  const isVrfManager = useIsVrfManager()
  const [tab, setTab] = useTabParam<Tab>(TABS, 'pay')
  const { toPay, toApprove, cash, awaitingBank, statements, recent, advances, wht } = usePaymentsData()
  const { data: grns = {} } = useAdvanceGrns(advances.data ?? [])

  // ── Stage figures ───────────────────────────────────────────────
  const approve = toApprove.data ?? []
  const approveBlocked = approve.filter(r => r.issues?.some(i => i === 'no_project' || i === 'no_ledger')).length
  const approveOld = approve.filter(r => r.age_days >= 15).length

  const pay = toPay.data ?? []
  const payOld = pay.filter(r => (r.days_since_approval ?? 0) >= 14).length
  const payOldest = Math.max(0, ...pay.map(r => r.days_since_approval ?? 0))

  const sentRecent = (recent.data ?? []).filter(r => r.payment_state === 'sent' && (r.payment_method === 'cash' || r.payment_method === 'vrf'))
  const confirmCount = (awaitingBank.data?.length ?? 0) + sentRecent.length
  const confirmAmount = (awaitingBank.data ?? []).reduce((s, r) => s + Number(r.net_payable ?? r.amount_etb ?? 0), 0)
    + sentRecent.reduce((s, r) => s + Number(r.net_payable ?? r.amount_etb ?? 0), 0)
  const confirmOldest = Math.max(0, ...(awaitingBank.data ?? []).map(r => r.days_waiting ?? 0), ...sentRecent.map(r => daysSince(r.payment_state_changed_at)))

  const paid = (recent.data ?? []).filter(r => r.payment_state === 'paid')

  const adv = advances.data ?? []
  const advReady = adv.filter(a => a.sourcing_bundle_id && grns[a.sourcing_bundle_id]).length
  const whtCount = wht.data?.length ?? 0

  // ── Cash, in one line ───────────────────────────────────────────
  const active = (cash.data ?? []).filter(p => p.total_credits !== 0 || p.total_debits !== 0)
  const unmatched = (statements.data ?? []).reduce((s, x) => s + Number(x.unmatched_lines ?? 0), 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Payments</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Approved money out, from approval to the bank statement.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Link to="/batch-payments" className="rounded-md border px-3 py-1.5 font-medium text-slate-600 dark:border-slate-600 dark:text-slate-300">Batches</Link>
          <Link to="/finance/payment-requests" className="rounded-md border px-3 py-1.5 font-medium text-slate-600 dark:border-slate-600 dark:text-slate-300">Payment requests</Link>
          <Link to="/finance/vendor-credits" className="rounded-md border px-3 py-1.5 font-medium text-slate-600 dark:border-slate-600 dark:text-slate-300">Vendor credits</Link>
        </div>
      </div>

      <RoleViewSwitcher mode="assigned-pm" role={role} />

      {/* ── The pipeline ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stage
          step="1" label="To approve" count={approve.length} amount={approve.reduce((s, r) => s + Number(r.amount_etb ?? 0), 0)}
          note={approveBlocked ? `${approveBlocked} need a project or ledger first` : approveOld ? `${approveOld} waiting over 2 weeks` : 'In the Approval Queue'}
          tone={approveOld ? 'amber' : undefined} to="/expenses/approvals" />
        <Stage
          step="2" label="To pay" count={pay.length} amount={pay.reduce((s, r) => s + toSend(r), 0)}
          note={payOld ? `${payOld} approved 2+ weeks ago` : pay.length ? `oldest ${Math.floor(payOldest)}d` : 'Nothing waiting'}
          tone={payOld ? 'red' : undefined} active={tab === 'pay'} onClick={() => setTab('pay')} />
        <Stage
          step="3" label="Sent, to confirm" count={confirmCount} amount={confirmAmount}
          note={confirmCount ? `oldest ${Math.floor(confirmOldest)}d — match to the statement` : 'All confirmed'}
          tone={confirmOldest >= 14 ? 'red' : confirmOldest >= 7 ? 'amber' : undefined} active={tab === 'confirm'} onClick={() => setTab('confirm')} />
        <Stage
          step="4" label="Paid this week" count={paid.length} amount={paid.reduce((s, r) => s + Number(r.net_payable ?? r.amount_etb ?? 0), 0)}
          note="Confirmed against the bank" tone="green" active={tab === 'paid'} onClick={() => setTab('paid')} />
      </div>

      {/* ── Open alongside the pipeline ─────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        <Chip active={tab === 'advances'} onClick={() => setTab('advances')} icon={HandCoins}
          text={<>Advances out <b>{formatCurrency(adv.reduce((s, a) => s + Number(a.amount_etb ?? 0), 0))}</b> · {adv.length}{advReady ? <span className="text-emerald-600"> · {advReady} ready to close</span> : null}</>} />
        <Chip active={tab === 'paperwork'} onClick={() => setTab('paperwork')} icon={FileText}
          text={<>Paperwork · <b>{whtCount}</b> withholding receipt{whtCount === 1 ? '' : 's'} to issue</>} />
        <Link to="/bank-statement-import" className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-left text-xs text-slate-600 hover:border-brand dark:border-slate-600 dark:text-slate-300"
          title="Net of the imported statement lines only — the opening balance isn't loaded">
          <Landmark className="h-3.5 w-3.5 shrink-0" />
          <span>
            {active.length
              ? active.map(a => <span key={a.account_id}>{a.account_name} <b className={a.cash_position < 0 ? 'text-red-600' : ''}>{formatCurrency(a.cash_position)}</b> </span>)
              : 'No statements imported'}
            <span className="hidden text-slate-400 sm:inline">(statement lines only)</span>
            {unmatched > 0 && <span className="text-sky-600"> · {unmatched} lines to reconcile</span>}
          </span>
          <ChevronRight className="h-3 w-3 shrink-0" />
        </Link>
      </div>

      {/* ── One workspace at a time ─────────────────────────────── */}
      <div>
        {tab === 'pay' && <ToPayTab rows={pay} loading={toPay.isLoading} canAct={canAct} />}
        {tab === 'confirm' && <ToConfirmTab awaitingBank={awaitingBank.data ?? []} recent={recent.data ?? []} canAct={canAct} isVrfManager={isVrfManager} />}
        {tab === 'advances' && <AdvancesTab advances={adv} canAct={canAct} />}
        {tab === 'paperwork' && <PaperworkTab wht={wht.data ?? []} canAct={canAct} />}
        {tab === 'paid' && <PaidTab recent={recent.data ?? []} />}
      </div>
    </div>
  )
}

function Stage({ step, label, count, amount, note, tone, active, onClick, to }: {
  step: string; label: string; count: number; amount: number; note: string
  tone?: 'red' | 'amber' | 'green'; active?: boolean; onClick?: () => void; to?: string
}) {
  const noteCls = tone === 'red' ? 'text-red-600 dark:text-red-400' : tone === 'amber' ? 'text-amber-600 dark:text-amber-400' : tone === 'green' ? 'text-emerald-600' : 'text-slate-500'
  const inner = (
    <>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] ${active ? 'bg-brand text-white' : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>{step}</span>
        {label}
        {to && <ArrowRight className="ml-auto h-3.5 w-3.5" />}
      </div>
      <p className="mt-1 text-lg font-bold tabular-nums text-slate-800 sm:text-xl dark:text-slate-100" title={formatCurrency(amount)}>
        <span className="sm:hidden">{formatCurrencyCompact(amount)}</span><span className="hidden sm:inline">{formatCurrency(amount)}</span>
      </p>
      <p className="text-xs text-slate-500"><b className="text-slate-700 dark:text-slate-200">{count}</b> {count === 1 ? 'payment' : 'payments'}</p>
      <p className={`mt-1 truncate text-[11px] font-medium ${noteCls}`}>{note}</p>
    </>
  )
  const cls = `block rounded-xl border bg-white p-3 text-left transition-colors dark:bg-slate-800 ${active ? 'border-brand ring-1 ring-brand' : 'hover:border-slate-300 dark:border-slate-700'}`
  return to ? <Link to={to} className={cls}>{inner}</Link> : <button onClick={onClick} className={cls}>{inner}</button>
}

function Chip({ active, onClick, icon: Icon, text }: { active: boolean; onClick: () => void; icon: React.ElementType; text: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-left text-xs ${active ? 'border-brand bg-brand/10 text-brand' : 'text-slate-600 hover:border-brand dark:border-slate-600 dark:text-slate-300'}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" /><span>{text}</span>
    </button>
  )
}
