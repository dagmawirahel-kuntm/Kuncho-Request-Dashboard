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
import type { BatchPayment } from '@/types/database'

type BatchExpense = {
  id: string
  expense_code: string | null
  item_service_description: string | null
  amount_etb: number | null
  payment_state: string
  rollup_period_start: string | null
  rollup_period_end: string | null
  projects: { project_name: string } | null
  vendor_id: string | null
  vendors: { vendor_name: string; bank_account: string | null } | null
  paid_to_staff_id: string | null
  finance_approved_by: string | null
  finance_approved_at: string | null
  labor_requisitions: { role_needed: string; payment_basis: string; volume_unit: string | null } | null
}

type WorkerLine = {
  id: string
  expense_id: string
  staff_id: string
  employee_name: string
  bank_account: string | null
  units: number | null
  rate: number | null
  subtotal: number | null
  unit_label: string
  gang_size: number | null
  gang_member_names: string | null
  overtime_hours: number | null
  overtime_amount: number | null
  vendor_name: string | null
  vendor_bank_account: string | null
}

// One combined Payment Request across several already-approved labor
// rollup drafts — e.g. every trade on one work order, batched into a
// single document instead of finance printing N separate ones.
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

  // Only admin/finance may hold disbursed_by, and the lifecycle trigger
  // rejects the approver paying their own approval — so the picker offers
  // exactly the eligible people, minus the current user.
  const { data: userProfiles = [] } = useUserProfiles()
  const payerOptions = useMemo(
    () => (userProfiles as { id: string; full_name: string; role: string }[])
      .filter(u => (u.role === 'admin' || u.role === 'finance') && u.id !== user?.id)
      .map(u => ({ id: u.id, label: u.full_name })),
    [userProfiles, user?.id]
  )
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
        .select('id, expense_code, item_service_description, amount_etb, payment_state, rollup_period_start, rollup_period_end, projects(project_name), vendor_id, vendors(vendor_name, bank_account), paid_to_staff_id, finance_approved_by, finance_approved_at, labor_requisitions:rolled_up_from_requisition_id(role_needed, payment_basis, volume_unit)')
        .in('id', ids)
      if (error) throw error
      return (data ?? []) as unknown as BatchExpense[]
    },
    enabled: !!id,
  })

  const expenseIds = useMemo(() => batchExpenses.map(e => e.id), [batchExpenses])

  const { data: workerLines = [], isLoading: workersLoading } = useQuery({
    queryKey: ['batch-payment-workers', id, expenseIds],
    queryFn: async () => {
      if (expenseIds.length === 0) return []
      const { data, error } = await supabase
        .from('labor_expense_workers')
        .select('id, expense_id, staff_id, days_worked, day_rate, subtotal, gang_size, gang_member_names, overtime_hours, overtime_amount, staff(employee_name, bank_account)')
        .in('expense_id', expenseIds)
      if (error) throw error
      const byExpense = new Map(batchExpenses.map(e => [e.id, e]))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []).map((w: any) => {
        const exp = byExpense.get(w.expense_id)
        const isVolume = exp?.labor_requisitions?.payment_basis === 'per_volume'
        return {
          id: w.id, expense_id: w.expense_id, staff_id: w.staff_id,
          employee_name: w.staff?.employee_name ?? 'Unknown staff',
          bank_account: w.staff?.bank_account ?? null,
          units: w.days_worked, rate: w.day_rate, subtotal: w.subtotal,
          unit_label: isVolume ? (exp?.labor_requisitions?.volume_unit ?? 'units') : 'days',
          gang_size: w.gang_size, gang_member_names: w.gang_member_names,
          overtime_hours: w.overtime_hours, overtime_amount: w.overtime_amount,
          vendor_name: exp?.vendors?.vendor_name ?? null,
          vendor_bank_account: exp?.vendors?.bank_account ?? null,
        } as WorkerLine
      })
    },
    enabled: expenseIds.length > 0,
  })

  const grandTotal = batchExpenses.reduce((sum, e) => sum + (e.amount_etb ?? 0), 0)
  const totalHeadcount = workerLines.reduce((sum, w) => sum + Math.max(w.gang_size ?? 1, 1), 0)
  const scopeLabel = useMemo(() => {
    const roles = Array.from(new Set(batchExpenses.map(e => e.labor_requisitions?.role_needed).filter(Boolean)))
    const projects = Array.from(new Set(batchExpenses.map(e => e.projects?.project_name).filter(Boolean)))
    return { roles, projects }
  }, [batchExpenses])
  const anySent = batchExpenses.some(e => e.payment_state === 'sent')
  // A batch assembled before approval (migration 265) sits here with its
  // expenses still unpaid — approving releases the whole thing at once.
  const awaitingApproval = batchExpenses.some(e => e.payment_state === 'unpaid')

  async function handleConfirm() {
    if (!id) return
    setConfirming(true)
    const { error } = await supabase.rpc('confirm_batch_payment', { p_batch_payment_id: id })
    setConfirming(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Batch payment confirmed as paid', 'success')
    qc.invalidateQueries({ queryKey: ['batch-payment-expenses-detail', id] })
  }

  async function handleApproveBatch() {
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
    // The lifecycle trigger enforces that the approver and payer differ —
    // surface its own message rather than second-guessing it here.
    if (error) { toast(error.message, 'error'); return }
    toast(String(data), 'success')
    qc.invalidateQueries({ queryKey: ['batch-payment-expenses-detail', id] })
    qc.invalidateQueries({ queryKey: ['labor-expense-drafts'] })
  }

  // Everything the Payment Request document needs. Built here rather than
  // inside the component so the batch and single-expense call sites feed
  // the same shape into the same template.
  const profileNameById = useMemo(
    () => new Map((userProfiles as { id: string; full_name: string }[]).map(u => [u.id, u.full_name])),
    [userProfiles],
  )
  const financeApproval = useMemo(
    () => batchExpenses.find(e => e.finance_approved_by || e.finance_approved_at) ?? null,
    [batchExpenses],
  )

  const prDocument = useMemo(() => ({
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
    })),
    workers: workerLines.map(w => ({
      id: w.id,
      expenseId: w.expense_id,
      staffId: w.staff_id,
      name: w.employee_name,
      bankAccount: w.bank_account,
      units: w.units,
      unitLabel: w.unit_label,
      rate: w.rate,
      subtotal: w.subtotal,
      overtimeHours: w.overtime_hours,
      overtimeAmount: w.overtime_amount,
      gangSize: w.gang_size,
      gangMemberNames: w.gang_member_names,
      vendorName: w.vendor_name,
      vendorBankAccount: w.vendor_bank_account,
    })),
    approvals: [
      { label: 'Prepared By', name: user?.id ? (profileNameById.get(user.id) ?? null) : null, date: null },
      {
        label: 'Finance Approved',
        name: financeApproval?.finance_approved_by ? (profileNameById.get(financeApproval.finance_approved_by) ?? null) : null,
        date: financeApproval?.finance_approved_at ?? null,
      },
      {
        label: 'Disbursed By',
        name: batch?.assignee_id ? (profileNameById.get(batch.assignee_id) ?? null) : null,
        date: null,
      },
    ],
    total: grandTotal,
    notes: batch?.notes ?? null,
  }), [batch, batchExpenses, workerLines, grandTotal, user, profileNameById, financeApproval])

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

  // The document itself no longer lives in this page as a `print:block`
  // twin of the screen view — PaymentRequestActions renders and prints it
  // from the shared template, which is also what gets archived on issue.
  return (
      <div className="space-y-5">
        {canConfirm && awaitingApproval && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-900/20 px-4 py-3 space-y-2">
            <div>
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Awaiting approval</p>
              <p className="text-xs text-amber-700 dark:text-amber-400">
                These drafts were grouped before approval. Approving here approves every one of them and releases the
                whole batch for payment. The payer must be someone other than you.
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
                onClick={handleApproveBatch}
                disabled={approving || !payerId || (approveMethod !== 'cash' && !approveAccountId)}
                className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-60"
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> {approving ? 'Approving…' : 'Approve & Release Batch'}
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
                <p className="text-white/60 text-xs uppercase tracking-widest">Batch Payment</p>
                <h1 className="text-white font-bold text-lg leading-tight font-mono">{batch.payment_code ?? batch.id.slice(0, 8)}</h1>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {scopeLabel.projects.map(p => (
                <span key={p} className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)' }}>{p}</span>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 text-center divide-x divide-white/10" style={{ background: 'rgba(0,0,0,0.22)' }}>
            <div className="py-3 px-2">
              <p className="text-white/50 text-xs uppercase tracking-wide">Total</p>
              <p className="text-white font-black text-xl tabular-nums">{formatCurrency(grandTotal)}</p>
            </div>
            <div className="py-3 px-2">
              <p className="text-white/50 text-xs uppercase tracking-wide">Workers</p>
              <p className="text-white font-bold text-sm">{totalHeadcount}</p>
            </div>
            <div className="py-3 px-2">
              <p className="text-white/50 text-xs uppercase tracking-wide">Drafts</p>
              <p className="text-white font-bold text-sm">{batchExpenses.length}</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b dark:border-slate-700">
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Worker Breakdown</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-xs text-slate-500">Worker</th>
                  <th className="text-left px-4 py-2 font-medium text-xs text-slate-500">Bank Account</th>
                  <th className="text-right px-4 py-2 font-medium text-xs text-slate-500">Duration/Vol.</th>
                  <th className="text-right px-4 py-2 font-medium text-xs text-slate-500">Rate</th>
                  <th className="text-right px-4 py-2 font-medium text-xs text-slate-500">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-700">
                {workerLines.map(w => (
                  <tr key={w.id}>
                    <td className="px-4 py-2 text-slate-700 dark:text-slate-200">
                      {(w.gang_size ?? 1) > 1 ? (
                        <>
                          <span className="font-medium">Gang of {w.gang_size}</span>
                          <span className="text-xs text-slate-400"> via {w.employee_name}</span>
                          {w.gang_member_names && <p className="text-[11px] text-slate-400">{w.gang_member_names}</p>}
                        </>
                      ) : w.employee_name}
                      {(w.overtime_amount ?? 0) > 0 && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400">+ OT {w.overtime_hours ? `${w.overtime_hours}h · ` : ''}{formatCurrency(w.overtime_amount!)}</p>
                      )}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-500">
                      {(w.gang_size ?? 1) > 1 ? (w.vendor_bank_account ?? `Vendor: ${w.vendor_name ?? '—'}`) : (w.bank_account ?? '—')}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{w.units ?? '—'} {w.unit_label}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{w.rate != null ? formatCurrency(w.rate) : '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold">{w.subtotal != null ? formatCurrency(w.subtotal) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/40">
                  <td colSpan={4} className="px-4 py-2.5 text-right text-xs font-bold uppercase text-slate-500">Total</td>
                  <td className="px-4 py-2.5 text-right font-black text-slate-800 dark:text-slate-100 tabular-nums">{formatCurrency(grandTotal)}</td>
                </tr>
              </tfoot>
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
