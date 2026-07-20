import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useUserProfiles, useTransfers } from '@/hooks/useLookups'
import { formatCurrency, formatDate } from '@/lib/utils'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { KpiCard } from '@/components/shared/KpiCard'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type {
  ToPayQueueRow, FinancePendingApprovalRow, AccountCashPositionRow, RecentPaymentRow,
  ExpensePaymentMethod,
} from '@/types/database'
import {
  Wallet, Clock, CheckCircle2, Send, Landmark, Layers, X, AlertTriangle,
} from 'lucide-react'

const PAYMENT_METHODS: { value: ExpensePaymentMethod; label: string }[] = [
  { value: 'transfer', label: 'Bank Transfer' },
  { value: 'cpo', label: 'CPO / Cheque Deposit' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
]

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 overflow-hidden">
      <div className="px-4 py-3 border-b dark:border-slate-700">
        <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">{title}</h2>
        {sub && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{sub}</p>}
      </div>
      {children}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-8 text-center text-sm text-slate-400 dark:text-slate-500">{children}</div>
}

export default function PaymentsDashboardPage() {
  const { role } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const canAct = role === 'admin' || role === 'finance'

  const { data: toPayQueue = [], isLoading: loadingQueue } = useQuery({
    queryKey: ['v-to-pay-queue'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_to_pay_queue').select('*').order('finance_approved_at')
      if (error) throw error
      return data as ToPayQueueRow[]
    },
  })

  const { data: pendingApproval = [], isLoading: loadingPending } = useQuery({
    queryKey: ['v-finance-pending-approval'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_finance_pending_approval').select('*').order('created_at')
      if (error) throw error
      return data as FinancePendingApprovalRow[]
    },
  })

  const { data: cashPositions = [], isLoading: loadingCash } = useQuery({
    queryKey: ['v-account-cash-position'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_account_cash_position').select('*').order('account_name')
      if (error) throw error
      return data as AccountCashPositionRow[]
    },
  })

  const { data: recentPayments = [], isLoading: loadingRecent } = useQuery({
    queryKey: ['v-recent-payments'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_recent_payments').select('*').order('payment_state_changed_at', { ascending: false })
      if (error) throw error
      return data as RecentPaymentRow[]
    },
  })

  const { data: userProfiles = [] } = useUserProfiles()
  const payerOptions = useMemo(
    () => (userProfiles as { id: string; full_name: string; role: string }[])
      .filter(u => u.role === 'admin' || u.role === 'finance')
      .map(u => ({ id: u.id, label: u.full_name })),
    [userProfiles]
  )

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ['v-to-pay-queue'] })
    qc.invalidateQueries({ queryKey: ['v-finance-pending-approval'] })
    qc.invalidateQueries({ queryKey: ['v-account-cash-position'] })
    qc.invalidateQueries({ queryKey: ['v-recent-payments'] })
    qc.invalidateQueries({ queryKey: ['expenses'] })
  }

  // ── To-Pay Queue: selection + actions ──────────────────────────────
  const [selectedQueue, setSelectedQueue] = useState<Set<string>>(new Set())
  const [payerId, setPayerId] = useState<string | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<ExpensePaymentMethod>('transfer')
  const [sendingBulk, setSendingBulk] = useState(false)
  const [batchModalOpen, setBatchModalOpen] = useState(false)

  function toggleQueueRow(id: string) {
    setSelectedQueue(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function toggleQueueAll() {
    setSelectedQueue(prev => (prev.size === toPayQueue.length ? new Set() : new Set(toPayQueue.map(r => r.id))))
  }

  const selfApprovedConflict = useMemo(() => {
    if (!payerId) return []
    return toPayQueue.filter(r => selectedQueue.has(r.id) && r.finance_approved_by === payerId)
  }, [toPayQueue, selectedQueue, payerId])

  async function handleMarkSent() {
    if (selectedQueue.size === 0) return
    if (!payerId) { toast('Select who is sending this payment', 'error'); return }
    if (selfApprovedConflict.length > 0) {
      toast(`Payer approved ${selfApprovedConflict.length} of these — pick someone else, or have a different approver re-check`, 'error')
      return
    }
    setSendingBulk(true)
    const { error } = await supabase
      .from('expenses')
      .update({ payment_state: 'sent', disbursed_by: payerId, payment_method: paymentMethod })
      .in('id', Array.from(selectedQueue))
    setSendingBulk(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`Marked ${selectedQueue.size} expense(s) as sent`, 'success')
    setSelectedQueue(new Set())
    invalidateAll()
  }

  // ── Pending Approval: approve action ───────────────────────────────
  async function handleApprove(id: string) {
    const { error } = await supabase.from('expenses').update({ approval_status: 'finance_approved' }).eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    toast('Approved — moved to the to-pay queue', 'success')
    invalidateAll()
  }

  // ── Recent Payments: match to bank line ────────────────────────────
  const [matching, setMatching] = useState<RecentPaymentRow | null>(null)

  const kpis = {
    toPayTotal: toPayQueue.reduce((s, r) => s + (r.amount_etb ?? 0), 0),
    pendingCount: pendingApproval.length,
    cashTotal: cashPositions.reduce((s, r) => s + r.cash_position, 0),
    paidThisWeek: recentPayments.filter(r => r.payment_state === 'paid').reduce((s, r) => s + (r.amount_etb ?? 0), 0),
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Payments</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Approval → to-pay → sent → paid, in one queue</p>
      </div>

      {/* KPI summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="To-Pay Queue" value={formatCurrency(kpis.toPayTotal)} sub={`${toPayQueue.length} approved, awaiting payment`} icon={Send} color="bg-amber-50 text-amber-500" />
        <KpiCard label="Pending Approval" value={kpis.pendingCount} sub="awaiting finance sign-off" icon={Clock} color="bg-slate-100 text-slate-500" />
        <KpiCard label="Cash Position" value={formatCurrency(kpis.cashTotal)} sub="across all accounts" icon={Wallet} color="bg-blue-50 text-blue-500" />
        <KpiCard label="Paid This Week" value={formatCurrency(kpis.paidThisWeek)} sub="confirmed against bank statement" icon={CheckCircle2} color="bg-emerald-50 text-emerald-500" />
      </div>

      {/* ── 1. To-Pay Queue (headline) ───────────────────────────────── */}
      <Section title="To-Pay Queue" sub="Finance-approved, awaiting payment — the headline queue">
        {canAct && selectedQueue.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-b bg-brand/5 dark:bg-brand/10 dark:border-slate-700 px-4 py-3">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{selectedQueue.size} selected</span>
            <div className="w-56">
              <SearchableSelect value={payerId} onChange={setPayerId} options={payerOptions} placeholder="Who is paying?" />
            </div>
            <select
              className="rounded-md border px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              value={paymentMethod}
              onChange={e => setPaymentMethod(e.target.value as ExpensePaymentMethod)}
            >
              {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <button
              onClick={handleMarkSent}
              disabled={sendingBulk}
              className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" /> Mark as Sent
            </button>
            <button
              onClick={() => setBatchModalOpen(true)}
              disabled={!payerId}
              className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
              title={!payerId ? 'Select a payer first' : undefined}
            >
              <Layers className="h-3.5 w-3.5" /> Create Batch Payment
            </button>
            {selfApprovedConflict.length > 0 && (
              <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                <AlertTriangle className="h-3.5 w-3.5" /> Payer approved {selfApprovedConflict.length} of these
              </span>
            )}
            <button onClick={() => setSelectedQueue(new Set())} className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
              Clear selection
            </button>
          </div>
        )}
        {loadingQueue ? (
          <Empty>Loading…</Empty>
        ) : toPayQueue.length === 0 ? (
          <Empty>Nothing waiting to be paid.</Empty>
        ) : (
          <>
            {/* Desktop/tablet: real table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/60 text-left text-xs text-slate-500 dark:text-slate-400">
                  <tr>
                    {canAct && (
                      <th className="px-4 py-2 w-8">
                        <input type="checkbox" checked={toPayQueue.length > 0 && selectedQueue.size === toPayQueue.length} onChange={toggleQueueAll} className="rounded border-slate-300 text-brand focus:ring-brand" />
                      </th>
                    )}
                    <th className="px-4 py-2">Vendor</th>
                    <th className="px-4 py-2">Project / Cost Group</th>
                    <th className="px-4 py-2 text-right">Amount</th>
                    <th className="px-4 py-2 text-center">WHT</th>
                    <th className="px-4 py-2 text-right">Age</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-slate-700">
                  {toPayQueue.map(r => (
                    <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      {canAct && (
                        <td className="px-4 py-2.5">
                          <input type="checkbox" checked={selectedQueue.has(r.id)} onChange={() => toggleQueueRow(r.id)} className="rounded border-slate-300 text-brand focus:ring-brand" />
                        </td>
                      )}
                      <td className="px-4 py-2.5">
                        <Link to={`/expenses/${r.id}`} className="font-medium text-slate-800 dark:text-slate-100 hover:text-brand hover:underline">
                          {r.vendor_name ?? r.item_service_description ?? r.expense_code}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">
                        {r.project_name ?? '—'}{r.cost_group_name ? ` · ${r.cost_group_name}` : ''}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(r.amount_etb ?? 0)}</td>
                      <td className="px-4 py-2.5 text-center">
                        {r.verify_wht && <span className="inline-block rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">WHT</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                        {r.days_since_approval != null ? `${Math.floor(r.days_since_approval)}d` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile: stacked cards — vendor + amount as the header, everything
                else as a compact secondary line. The checkbox is its own
                44px tappable area, never a hover-revealed affordance. */}
            <div className="sm:hidden divide-y dark:divide-slate-700">
              {canAct && (
                <label className="flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/60">
                  <span className="flex h-11 w-11 -my-3 flex-shrink-0 items-center justify-center">
                    <input type="checkbox" checked={toPayQueue.length > 0 && selectedQueue.size === toPayQueue.length} onChange={toggleQueueAll} className="h-5 w-5 rounded border-slate-300 text-brand focus:ring-brand" />
                  </span>
                  Select all
                </label>
              )}
              {toPayQueue.map(r => (
                <div key={r.id} className="flex items-start gap-1 px-2 py-2">
                  {canAct && (
                    <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center">
                      <input type="checkbox" checked={selectedQueue.has(r.id)} onChange={() => toggleQueueRow(r.id)} className="h-5 w-5 rounded border-slate-300 text-brand focus:ring-brand" />
                    </span>
                  )}
                  <Link to={`/expenses/${r.id}`} className="min-w-0 flex-1 py-2 pr-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-slate-800 dark:text-slate-100 truncate">{r.vendor_name ?? r.item_service_description ?? r.expense_code}</span>
                      <span className="flex-shrink-0 font-semibold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(r.amount_etb ?? 0)}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="truncate">{r.project_name ?? '—'}{r.cost_group_name ? ` · ${r.cost_group_name}` : ''}</span>
                      {r.verify_wht && <span className="flex-shrink-0 rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">WHT</span>}
                      <span className="ml-auto flex-shrink-0 tabular-nums">{r.days_since_approval != null ? `${Math.floor(r.days_since_approval)}d` : '—'}</span>
                    </div>
                  </Link>
                </div>
              ))}
            </div>
          </>
        )}
      </Section>

      {/* ── 2. Pending Approval ─────────────────────────────────────── */}
      <Section title="Pending Approval" sub="Awaiting a finance sign-off before it can join the to-pay queue">
        {loadingPending ? (
          <Empty>Loading…</Empty>
        ) : pendingApproval.length === 0 ? (
          <Empty>Nothing waiting on finance.</Empty>
        ) : (
          <>
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/60 text-left text-xs text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-2">Vendor</th>
                    <th className="px-4 py-2">Project</th>
                    <th className="px-4 py-2 text-right">Amount</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2 w-32"></th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-slate-700">
                  {pendingApproval.map(r => (
                    <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-4 py-2.5">
                        <Link to={`/expenses/${r.id}`} className="font-medium text-slate-800 dark:text-slate-100 hover:text-brand hover:underline">
                          {r.vendor_name ?? r.item_service_description ?? r.expense_code}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{r.project_name ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(r.amount_etb ?? 0)}</td>
                      <td className="px-4 py-2.5"><StatusBadge status={r.approval_status} /></td>
                      <td className="px-4 py-2.5 text-right">
                        {r.approval_status === 'manager_approved' && canAct ? (
                          <button
                            onClick={() => handleApprove(r.id)}
                            className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 ml-auto"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                          </button>
                        ) : r.approval_status === 'pending' ? (
                          <span className="text-xs text-slate-400 dark:text-slate-500">Awaiting manager</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="sm:hidden divide-y dark:divide-slate-700">
              {pendingApproval.map(r => (
                <div key={r.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <Link to={`/expenses/${r.id}`} className="min-w-0 font-medium text-slate-800 dark:text-slate-100 truncate">
                      {r.vendor_name ?? r.item_service_description ?? r.expense_code}
                    </Link>
                    <span className="flex-shrink-0 font-semibold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(r.amount_etb ?? 0)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 min-w-0">
                      <span className="truncate">{r.project_name ?? '—'}</span>
                      <StatusBadge status={r.approval_status} />
                    </div>
                    {r.approval_status === 'manager_approved' && canAct ? (
                      <button
                        onClick={() => handleApprove(r.id)}
                        className="flex-shrink-0 flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-xs font-medium text-white hover:opacity-90"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                      </button>
                    ) : r.approval_status === 'pending' ? (
                      <span className="flex-shrink-0 text-xs text-slate-400 dark:text-slate-500">Awaiting manager</span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ── 3. Cash Position ─────────────────────────────────────── */}
        <Section title="Cash Position" sub="Bank statement balance per account — credits minus debits, read-only">
          {loadingCash ? (
            <Empty>Loading…</Empty>
          ) : cashPositions.length === 0 ? (
            <Empty>No accounts with statement activity yet.</Empty>
          ) : (
            <div className="divide-y dark:divide-slate-700">
              {cashPositions.map(a => (
                <div key={a.account_id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Landmark className="h-4 w-4 text-slate-400 flex-shrink-0" />
                    <span className="font-medium text-slate-700 dark:text-slate-200 truncate">{a.account_name}</span>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`font-bold tabular-nums ${a.cash_position < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-slate-100'}`}>
                      {formatCurrency(a.cash_position)}
                    </p>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 tabular-nums">
                      +{formatCurrency(a.total_credits)} / −{formatCurrency(a.total_debits)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* ── 4. Recent Payments ───────────────────────────────────── */}
        <Section title="This Week's Payments" sub="Sent or paid in the last 7 days">
          {loadingRecent ? (
            <Empty>Loading…</Empty>
          ) : recentPayments.length === 0 ? (
            <Empty>Nothing sent or paid this week yet.</Empty>
          ) : (
            <div className="divide-y dark:divide-slate-700">
              {recentPayments.map(r => (
                <div key={r.id} className="flex items-center justify-between gap-2 px-4 py-3">
                  <div className="min-w-0">
                    <Link to={`/expenses/${r.id}`} className="font-medium text-slate-800 dark:text-slate-100 hover:text-brand hover:underline block truncate">
                      {r.vendor_name ?? r.item_service_description ?? r.expense_code}
                    </Link>
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      {formatDate(r.payment_state_changed_at)} · {r.payment_method ?? '—'}
                      {r.transfer_id_code && ` · ${r.transfer_id_code}`}
                      {r.batch_payment_id && !r.transfer_id_code && ' · in a batch'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="font-medium tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(r.amount_etb ?? 0)}</span>
                    <StatusBadge status={r.payment_state} />
                    {canAct && r.payment_state === 'sent' && !r.transfer_id && (
                      <button
                        onClick={() => setMatching(r)}
                        className="rounded-md border px-2 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700"
                      >
                        Match to Bank Line
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      {batchModalOpen && payerId && (
        <CreateBatchModal
          expenseIds={Array.from(selectedQueue)}
          payerId={payerId}
          onClose={() => setBatchModalOpen(false)}
          onCreated={() => {
            setBatchModalOpen(false)
            setSelectedQueue(new Set())
            toast('Batch payment created', 'success')
            invalidateAll()
          }}
          onError={msg => toast(msg, 'error')}
        />
      )}

      {matching && (
        <MatchTransferModal
          row={matching}
          onClose={() => setMatching(null)}
          onMatched={() => {
            setMatching(null)
            toast('Matched to bank line', 'success')
            invalidateAll()
          }}
          onError={msg => toast(msg, 'error')}
        />
      )}
    </div>
  )
}

function CreateBatchModal({
  expenseIds, payerId, onClose, onCreated, onError,
}: {
  expenseIds: string[]
  payerId: string
  onClose: () => void
  onCreated: () => void
  onError: (msg: string) => void
}) {
  const [code, setCode] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleCreate() {
    setSaving(true)
    const { error } = await supabase.rpc('create_batch_payment', {
      p_expense_ids: expenseIds,
      p_assignee_id: payerId,
      p_payment_code: code.trim() || null,
      p_notes: notes.trim() || null,
    })
    setSaving(false)
    if (error) { onError(error.message); return }
    onCreated()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl max-w-md w-full overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b dark:border-slate-700 flex items-center justify-between">
          <h2 className="font-bold text-slate-800 dark:text-slate-100">Create Batch Payment</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">{expenseIds.length} expense(s) will be linked to one wire and moved to Sent.</p>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Payment Code (optional)</label>
            <input className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" value={code} onChange={e => setCode(e.target.value)} placeholder="e.g. BATCH-2026-014" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Notes (optional)</label>
            <textarea rows={2} className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>
        <div className="px-5 py-4 border-t dark:border-slate-700 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={handleCreate} disabled={saving} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
            {saving ? 'Creating…' : 'Create Batch'}
          </button>
        </div>
      </div>
    </div>
  )
}

function MatchTransferModal({
  row, onClose, onMatched, onError,
}: {
  row: RecentPaymentRow
  onClose: () => void
  onMatched: () => void
  onError: (msg: string) => void
}) {
  const { data: transfers = [] } = useTransfers()
  const [transferId, setTransferId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const transferOptions = (transfers as { id: string; transfer_id_code: string | null; amount: number | null }[]).map(t => ({
    id: t.id,
    label: `${t.transfer_id_code ?? t.id.slice(0, 8)} — ${formatCurrency(t.amount ?? 0)}`,
  }))

  async function handleMatch() {
    if (!transferId) { onError('Select a bank line'); return }
    setSaving(true)
    const { error } = row.batch_payment_id
      ? await supabase.rpc('match_batch_to_transfer', { p_batch_payment_id: row.batch_payment_id, p_transfer_id: transferId })
      : await supabase.rpc('match_expense_to_transfer', { p_expense_id: row.id, p_transfer_id: transferId })
    setSaving(false)
    if (error) { onError(error.message); return }
    onMatched()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl max-w-md w-full overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b dark:border-slate-700 flex items-center justify-between">
          <h2 className="font-bold text-slate-800 dark:text-slate-100">Match to Bank Line</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {row.batch_payment_id
              ? 'This expense is part of a batch — matching applies to every expense in that batch.'
              : `Matching ${formatCurrency(row.amount_etb ?? 0)} to a CBE statement line.`}
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Bank Line</label>
            <SearchableSelect value={transferId} onChange={setTransferId} options={transferOptions} placeholder="Select a statement line…" />
          </div>
        </div>
        <div className="px-5 py-4 border-t dark:border-slate-700 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={handleMatch} disabled={saving} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
            {saving ? 'Matching…' : 'Match'}
          </button>
        </div>
      </div>
    </div>
  )
}
