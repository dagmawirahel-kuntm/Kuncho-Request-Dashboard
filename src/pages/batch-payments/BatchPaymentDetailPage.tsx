import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { ArrowLeft, Layers, CheckCircle2 } from 'lucide-react'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { PaymentRequestActions } from '@/components/shared/PaymentRequestActions'
import { useAccounts, useUserProfiles } from '@/hooks/useLookups'
import { EXPENSE_TYPE_THEME } from '@/lib/expenseTypeTheme'
import { buildPayeeLines, totalHeadcount } from '@/lib/laborPaymentRequestDocument'
import {
  buildBatchLines, isLaborBatch, BATCH_EXPENSE_SELECT, BATCH_WORKER_SELECT,
  type BatchExpense, type BatchWorkerRow,
} from '@/lib/batchPaymentLines'
import type { BatchPayment, ExpenseType } from '@/types/database'

const DISPATCHABLE = ['unpaid', 'approved_to_pay']

// One combined Payment Request across several expenses — every trade on one
// work order, four subcontract certificates to the same subcontractor, a
// week of lump-sum works — batched into a single document instead of
// finance printing N separate ones. The lines come from buildBatchLines(),
// which is what makes a non-crew batch name its payees at all.
export default function BatchPaymentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { role, user } = useAuth()
  const qc = useQueryClient()
  const canConfirm = role === 'admin' || role === 'finance'
  const [confirming, setConfirming] = useState(false)
  const [approving, setApproving] = useState(false)
  const [payerId, setPayerId] = useState<string | null>(null)
  const [approveAccountId, setApproveAccountId] = useState<string | null>(null)
  const [approveMethod, setApproveMethod] = useState<'batch_wire' | 'cash'>('batch_wire')

  const { data: userProfiles = [] } = useUserProfiles()
  const { data: accounts = [] } = useAccounts()
  const accountOptions = useMemo(
    () => (accounts as { id: string; account_name: string; account_number: string | null }[])
      .map(a => ({ id: a.id, label: a.account_name, sub: a.account_number ?? undefined })),
    [accounts]
  )

  const { data: batch, isLoading: batchLoading } = useQuery({
    queryKey: ['batch-payment-detail', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('batch_payments').select('*').eq('id', id!).single()
      if (error) throw error
      return data as BatchPayment
    },
    enabled: !!id,
  })

  const { data: batchExpenses = [], isLoading: expensesLoading } = useQuery({
    queryKey: ['batch-payment-expenses-detail', id],
    queryFn: async () => {
      const { data: links, error: linkErr } = await supabase.from('batch_payment_expenses').select('expense_id').eq('batch_payment_id', id!)
      if (linkErr) throw linkErr
      const ids = links.map(l => l.expense_id)
      if (ids.length === 0) return []
      const { data, error } = await supabase
        .from('expenses')
        .select(BATCH_EXPENSE_SELECT)
        .in('id', ids)
        .order('expense_code')
      if (error) throw error
      return (data ?? []) as unknown as BatchExpense[]
    },
    enabled: !!id,
  })

  const expenseIds = useMemo(() => batchExpenses.map(e => e.id), [batchExpenses])

  const { data: rawWorkers = [], isLoading: workersLoading } = useQuery({
    queryKey: ['batch-payment-workers', id, expenseIds],
    queryFn: async () => {
      if (expenseIds.length === 0) return []
      const { data, error } = await supabase
        .from('labor_expense_workers')
        .select(BATCH_WORKER_SELECT)
        .in('expense_id', expenseIds)
      if (error) throw error
      return (data ?? []) as unknown as BatchWorkerRow[]
    },
    enabled: expenseIds.length > 0,
  })

  // Every line the document and the screen show, one list for both.
  const lines = useMemo(() => buildBatchLines(batchExpenses, rawWorkers), [batchExpenses, rawWorkers])
  const isLabor = useMemo(() => isLaborBatch(batchExpenses, rawWorkers), [batchExpenses, rawWorkers])
  const payees = useMemo(() => buildPayeeLines(lines, { isLabor }), [lines, isLabor])

  const grandTotal = batchExpenses.reduce((s, e) => s + Number(e.amount_etb ?? 0), 0)
  const whtTotal = batchExpenses.reduce((s, e) => s + Number(e.wht_amount ?? 0), 0)
  const creditTotal = batchExpenses.reduce((s, e) => s + Number(e.credit_applied_etb ?? 0), 0)
  const netTotal = grandTotal - whtTotal - creditTotal
  const isReduced = whtTotal > 0.005 || creditTotal > 0.005

  const types = useMemo(
    () => Array.from(new Set(batchExpenses.map(e => e.expense_type).filter(Boolean))) as ExpenseType[],
    [batchExpenses],
  )
  const typeLabel = types.length === 1 ? EXPENSE_TYPE_THEME[types[0]]?.label ?? null : types.length > 1 ? 'Mixed' : null
  const projects = useMemo(
    () => Array.from(new Set(batchExpenses.map(e => e.projects?.project_name).filter(Boolean))) as string[],
    [batchExpenses],
  )

  // Values the whole batch shares, or null when its expenses disagree.
  const shared = <T,>(pick: (e: BatchExpense) => T | null | undefined): T | null => {
    const vals = Array.from(new Set(batchExpenses.map(pick).filter(v => v != null))) as T[]
    return vals.length === 1 ? vals[0] : null
  }

  const dispatched = batchExpenses.some(e => !DISPATCHABLE.includes(e.payment_state))
  const anySent = batchExpenses.some(e => e.payment_state === 'sent')
  const anyUnpaid = batchExpenses.some(e => e.payment_state === 'unpaid')
  // approve_batch_payment() takes a batch whose expenses are all still
  // undispatched — awaiting approval, or approved and waiting to be paid.
  // This used to appear only while something was unapproved, so a batch
  // assembled from already-approved expenses had no way to be released from
  // its own page.
  const canRelease = canConfirm && batchExpenses.length > 0 && !dispatched

  // The lifecycle trigger refuses to let one person approve and pay the same
  // expense. So the payer can't be anyone who approved an expense in this
  // batch — nor you, if releasing it will make you the approver of the ones
  // still pending.
  const approverIds = useMemo(
    () => new Set(batchExpenses.map(e => e.finance_approved_by).filter(Boolean) as string[]),
    [batchExpenses],
  )
  const payerOptions = useMemo(
    () => (userProfiles as { id: string; full_name: string; role: string }[])
      .filter(u => (u.role === 'admin' || u.role === 'finance')
        && !approverIds.has(u.id)
        && !(anyUnpaid && u.id === user?.id))
      .map(u => ({ id: u.id, label: u.full_name })),
    [userProfiles, approverIds, anyUnpaid, user?.id]
  )

  async function handleConfirm() {
    if (!id) return
    setConfirming(true)
    const { error } = await supabase.rpc('confirm_batch_payment', { p_batch_payment_id: id })
    setConfirming(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Batch payment confirmed as paid', 'success')
    qc.invalidateQueries({ queryKey: ['batch-payment-expenses-detail', id] })
  }

  async function handleRelease() {
    if (!id || !payerId) { toast('Pick who is paying this batch', 'error'); return }
    if (approveMethod !== 'cash' && !approveAccountId) { toast('Select the funding account', 'error'); return }
    setApproving(true)
    const { data, error } = await supabase.rpc('approve_batch_payment', {
      p_batch_payment_id: id,
      p_assignee_id: payerId,
      p_account_id: approveMethod === 'cash' ? null : approveAccountId,
      p_payment_method: approveMethod,
    })
    setApproving(false)
    if (error) { toast(error.message, 'error'); return }
    toast(String(data), 'success')
    qc.invalidateQueries({ queryKey: ['batch-payment-expenses-detail', id] })
    qc.invalidateQueries({ queryKey: ['batch-payment-detail', id] })
    qc.invalidateQueries({ queryKey: ['labor-expense-drafts'] })
    qc.invalidateQueries({ queryKey: ['v-to-pay-queue'] })
  }

  const profileNameById = useMemo(
    () => new Map((userProfiles as { id: string; full_name: string }[]).map(u => [u.id, u.full_name])),
    [userProfiles],
  )

  // Everything the Payment Request document needs, fed through the same
  // template as a single expense so both print the same way.
  const prDocument = useMemo(() => {
    const approverNames = Array.from(approverIds).map(a => profileNameById.get(a)).filter(Boolean) as string[]
    const approvedDates = batchExpenses.map(e => e.finance_approved_at).filter(Boolean).sort() as string[]
    const singleType = types.length === 1 ? types[0] : null
    const verifyWht = batchExpenses.some(e => e.verify_wht)
    return {
      kind: 'batch' as const,
      sourceCode: batch?.payment_code ?? null,
      issuedOn: new Date().toISOString().slice(0, 10),
      issuedByName: user?.id ? (profileNameById.get(user.id) ?? null) : null,
      drafts: batchExpenses.map(e => ({
        id: e.id,
        code: e.expense_code,
        description: e.item_service_description,
        amount: e.amount_etb,
        projectName: e.projects?.project_name ?? null,
        role: e.labor_requisitions?.role_needed ?? null,
        periodStart: e.rollup_period_start,
        periodEnd: e.rollup_period_end,
        scopeOfWork: e.labor_requisitions?.scope_of_work ?? null,
        siteLocation: e.labor_requisitions?.site_location ?? null,
      })),
      workers: lines,
      approvals: [
        { label: 'Prepared By', name: user?.id ? (profileNameById.get(user.id) ?? null) : null, date: null },
        {
          label: 'Finance Approved',
          name: approverNames.length ? approverNames.join(', ') : null,
          date: approvedDates.length ? approvedDates[approvedDates.length - 1] : null,
        },
        {
          label: 'Disbursed By',
          name: batch?.assignee_id ? (profileNameById.get(batch.assignee_id) ?? null) : null,
          date: null,
        },
      ],
      total: grandTotal,
      notes: batch?.notes ?? null,
      whtRequired: verifyWht,
      whtMethod: shared(e => e.wht_handling_method),
      whtAmount: whtTotal > 0.005 ? whtTotal : null,
      creditApplied: creditTotal > 0.005 ? creditTotal : null,
      fundingAccount: shared(e => e.accounts?.account_name),
      paymentMethod: shared(e => e.payment_method),
      breakdownKind: isLabor ? ('labor' as const) : ('line_items' as const),
      typeLabel,
      // Labor batches keep the labor letterhead they have always had; a
      // subcontract or vendor batch takes its type's colour, like the
      // single-expense document for the same payment.
      accentColor: singleType && singleType !== 'labor_payment' ? EXPENSE_TYPE_THEME[singleType]?.bg ?? null : null,
    }
    // shared() reads batchExpenses, which is already a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch, batchExpenses, lines, grandTotal, whtTotal, creditTotal, user, profileNameById, approverIds, types, typeLabel, isLabor])

  const isLoading = batchLoading || expensesLoading || workersLoading

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><p className="text-slate-400 text-sm">Loading…</p></div>
  }
  if (!batch) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-slate-500">Batch payment not found.</p>
        <Link to="/batch-payments" className="text-sm text-blue-600 hover:underline">← Back to Batch Payments</Link>
      </div>
    )
  }

  const payeeNoun = isLabor ? 'Workers' : 'Payees'
  const payeeCount = isLabor ? totalHeadcount(lines) : payees.length

  return (
      <div className="space-y-5">
        {canRelease && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-900/20 px-4 py-3 space-y-2">
            <div>
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                {anyUnpaid ? 'Awaiting approval' : 'Approved — ready to pay'}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {anyUnpaid
                  ? 'Some of these were grouped before approval. Releasing approves every one of them and sends the whole batch for payment. The payer can’t be you, or anyone who approved these.'
                  : 'Every payment here is approved. Releasing records who is paying and from which account, and moves the whole batch to Sent. The payer can’t be anyone who approved these.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-52">
                <SearchableSelect value={payerId} onChange={setPayerId} options={payerOptions} placeholder="Who is paying?" />
              </div>
              <select
                value={approveMethod}
                onChange={e => setApproveMethod(e.target.value as 'batch_wire' | 'cash')}
                className="rounded-md border px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="batch_wire">Bank / Wire</option>
                <option value="cash">Cash</option>
              </select>
              {approveMethod !== 'cash' && (
                <div className="w-52">
                  <SearchableSelect value={approveAccountId} onChange={setApproveAccountId} options={accountOptions} placeholder="Funding account…" />
                </div>
              )}
              <button
                onClick={handleRelease}
                disabled={approving || !payerId || (approveMethod !== 'cash' && !approveAccountId)}
                className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-60"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {approving ? 'Releasing…' : anyUnpaid ? 'Approve & Release Batch' : 'Release Batch for Payment'}
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between flex-wrap gap-2">
          <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-200">
            <ArrowLeft className="h-4 w-4" /> Batch Payments
          </button>
          <div className="flex items-center gap-2">
            {canConfirm && anySent && (
              <button
                onClick={handleConfirm}
                disabled={confirming}
                className="flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60"
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> {confirming ? 'Confirming…' : 'Confirm Payment Sent'}
              </button>
            )}
            {id && <PaymentRequestActions sourceType="batch_payment" sourceId={id} document={prDocument} />}
          </div>
        </div>

        <div className="rounded-2xl overflow-hidden" style={{ background: '#1B3A5C' }}>
          <div className="px-6 py-7">
            <div className="flex items-center gap-3 mb-3">
              <div className="h-12 w-12 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0 border border-white/20" style={{ background: 'rgba(255,255,255,0.18)' }}>
                <Layers className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-white/60 text-xs uppercase tracking-widest">Batch Payment{typeLabel ? ` · ${typeLabel}` : ''}</p>
                <h1 className="text-white font-bold text-lg leading-tight font-mono">{batch.payment_code ?? batch.id.slice(0, 8)}</h1>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {projects.map(p => (
                <span key={p} className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)' }}>{p}</span>
              ))}
            </div>
          </div>
          <div className={`grid ${isReduced ? 'grid-cols-4' : 'grid-cols-3'} text-center divide-x divide-white/10`} style={{ background: 'rgba(0,0,0,0.22)' }}>
            <div className="py-3 px-2">
              <p className="text-white/50 text-xs uppercase tracking-wide">{isReduced ? 'Gross' : 'Total'}</p>
              <p className="text-white font-black text-xl tabular-nums">{formatCurrency(grandTotal)}</p>
            </div>
            {isReduced && (
              <div className="py-3 px-2">
                <p className="text-white/50 text-xs uppercase tracking-wide">Net to Send</p>
                <p className="text-white font-black text-xl tabular-nums">{formatCurrency(netTotal)}</p>
              </div>
            )}
            <div className="py-3 px-2">
              <p className="text-white/50 text-xs uppercase tracking-wide">{payeeNoun}</p>
              <p className="text-white font-bold text-sm">{payeeCount}</p>
            </div>
            <div className="py-3 px-2">
              <p className="text-white/50 text-xs uppercase tracking-wide">Drafts</p>
              <p className="text-white font-bold text-sm">{batchExpenses.length}</p>
            </div>
          </div>
        </div>

        {/* Who the bank is told to pay. The part finance acts on, so it
            comes first — and it is exactly the schedule the document prints. */}
        <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b dark:border-slate-700">
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Disbursement</h2>
            <p className="text-xs text-slate-400">{payees.length} transfer{payees.length === 1 ? '' : 's'} — one per payee, however many expenses they cover</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-xs text-slate-500">Pay To</th>
                  <th className="text-left px-4 py-2 font-medium text-xs text-slate-500">Bank</th>
                  <th className="text-left px-4 py-2 font-medium text-xs text-slate-500">Account</th>
                  {isReduced && <th className="text-right px-4 py-2 font-medium text-xs text-slate-500">Gross</th>}
                  {isReduced && <th className="text-right px-4 py-2 font-medium text-xs text-slate-500">Deducted</th>}
                  <th className="text-right px-4 py-2 font-medium text-xs text-slate-500">{isReduced ? 'Net to Pay' : 'Amount'}</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-700">
                {payees.length === 0 ? (
                  <tr><td colSpan={isReduced ? 6 : 4} className="px-4 py-6 text-center text-xs text-slate-400">No payees — this batch has no expenses.</td></tr>
                ) : payees.map(p => (
                  <tr key={p.key}>
                    <td className="px-4 py-2 text-slate-700 dark:text-slate-200">
                      <span className="font-medium">{p.payee}</span>
                      {p.kind === 'vendor' && <span className="ml-1.5 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">vendor</span>}
                      {p.workerCount > 1 && <p className="text-[11px] text-slate-400">{p.workerCount} workers</p>}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">{p.bankName ?? '—'}</td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {p.bankAccount ?? <span className="font-sans text-red-600 dark:text-red-400">no account on file</span>}
                    </td>
                    {isReduced && <td className="px-4 py-2 text-right tabular-nums text-slate-500">{formatCurrency(p.amount)}</td>}
                    {isReduced && (
                      <td className="px-4 py-2 text-right tabular-nums text-slate-500">
                        {p.wht + p.credit > 0.005 ? `(${formatCurrency(p.wht + p.credit)})` : '—'}
                      </td>
                    )}
                    <td className="px-4 py-2 text-right tabular-nums font-semibold">{formatCurrency(p.amount - p.wht - p.credit)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/40">
                  <td colSpan={3} className="px-4 py-2.5 text-right text-xs font-bold uppercase text-slate-500">Total</td>
                  {isReduced && <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{formatCurrency(grandTotal)}</td>}
                  {isReduced && <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">({formatCurrency(whtTotal + creditTotal)})</td>}
                  <td className="px-4 py-2.5 text-right font-black text-slate-800 dark:text-slate-100 tabular-nums">{formatCurrency(netTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* What is being paid for. */}
        <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b dark:border-slate-700">
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">{isLabor ? 'Worker Breakdown' : 'Payment Detail'}</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-xs text-slate-500">Draft</th>
                  <th className="text-left px-4 py-2 font-medium text-xs text-slate-500">{isLabor ? 'Worker' : 'Description'}</th>
                  <th className="text-right px-4 py-2 font-medium text-xs text-slate-500">Qty</th>
                  <th className="text-right px-4 py-2 font-medium text-xs text-slate-500">Rate</th>
                  <th className="text-right px-4 py-2 font-medium text-xs text-slate-500">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-700">
                {lines.map(w => (
                  <tr key={w.id}>
                    <td className="px-4 py-2 font-mono text-xs text-slate-400 whitespace-nowrap">{w.expenseCode ?? '—'}</td>
                    <td className="px-4 py-2 text-slate-700 dark:text-slate-200">
                      {(w.gangSize ?? 1) > 1 ? (
                        <>
                          <span className="font-medium">Gang of {w.gangSize}</span>
                          <span className="text-xs text-slate-400"> via {w.name}</span>
                          {w.gangMemberNames && <p className="text-[11px] text-slate-400">{w.gangMemberNames}</p>}
                        </>
                      ) : isLabor ? w.name : (
                        <>
                          <span>{w.description || w.name}</span>
                          {w.description && <p className="text-[11px] text-slate-400">{w.name}</p>}
                        </>
                      )}
                      {(w.overtimeAmount ?? 0) > 0 && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400">incl. OT {w.overtimeHours ? `${w.overtimeHours}h · ` : ''}{formatCurrency(w.overtimeAmount!)}</p>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">{w.units == null ? '—' : `${w.units} ${w.unitLabel}`}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{w.rate != null ? formatCurrency(w.rate) : '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold">{formatCurrency(Number(w.subtotal ?? 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b dark:border-slate-700">
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Underlying Drafts</h2>
          </div>
          <div className="divide-y dark:divide-slate-700">
            {batchExpenses.map(e => (
              <div key={e.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <Link to={`/expenses/${e.id}`} className="text-sm text-brand hover:underline truncate block">{e.expense_code ?? e.id.slice(0, 8)}</Link>
                  <p className="text-xs text-slate-400 truncate">{e.item_service_description}</p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <StatusBadge status={e.payment_state} />
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 tabular-nums">{formatCurrency(e.amount_etb ?? 0)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
  )
}
