import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { canApproveAsManager, canApproveAsFinance } from '@/lib/expenseAccess'
import { useToast } from '@/contexts/ToastContext'
import {
  ArrowLeft, Pencil, Printer, CheckCircle2, Clock, XCircle,
  DollarSign, FileText, Building2, FolderKanban, Tag,
} from 'lucide-react'
import { StatusBadge } from '@/components/shared/StatusBadge'
import type { Expense, ExpenseType } from '@/types/database'

// ── Theme by expense type ─────────────────────────────────────────────────────

const TYPE_THEME: Record<ExpenseType, { bg: string; label: string; abbr: string }> = {
  general:        { bg: '#1B3A5C', label: 'General Expense',  abbr: 'GE'  },
  purchase_order: { bg: '#0C4A6E', label: 'Purchase Order',   abbr: 'PO'  },
  vrf:            { bg: '#312E81', label: 'Vendor Receipt',    abbr: 'VRF' },
  cpo_bond:       { bg: '#4C1D95', label: 'CPO Bond',          abbr: 'CPO' },
  fuel:           { bg: '#92400E', label: 'Fuel',               abbr: 'FUEL' },
}

type ExpenseWithJoins = Expense & {
  vendors: { vendor_name: string; bank_account: string | null; location: string | null } | null
  projects: { project_name: string } | null
  accounts: { account_name: string } | null
  categories: { category_name: string } | null
  sub_categories: { item_name: string } | null
  manager_profile: { full_name: string } | null
  finance_profile: { full_name: string } | null
}

// ── Print invoice component ───────────────────────────────────────────────────

function PrintInvoice({ expense }: { expense: ExpenseWithJoins }) {
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
  const vendorName = expense.vendors?.vendor_name ?? expense.vendors_name
  const vendorBank = expense.vendors?.bank_account ?? expense.vendors_bank_account
  const vendorLocation = expense.vendors?.location ?? expense.vendors_location
  const projectName = expense.projects?.project_name ?? expense.project_name
  const categoryName = expense.categories?.category_name
  const managerName = (expense as any).manager_profile?.full_name ?? null
  const financeName = (expense as any).finance_profile?.full_name ?? null

  return (
    <div style={{ fontFamily: 'Arial, Helvetica, sans-serif', color: '#1a1a1a', maxWidth: '750px', margin: '0 auto', padding: '24px' }}>

      {/* Company header */}
      <div style={{ borderBottom: '3px solid #1B3A5C', paddingBottom: '16px', marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <div style={{ width: '36px', height: '36px', background: '#1B3A5C', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: '#fff', fontWeight: 900, fontSize: '12px', letterSpacing: '-0.5px' }}>K</span>
            </div>
            <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 900, color: '#1B3A5C', letterSpacing: '-0.3px' }}>
              KUNCHO TRADING PLC
            </h1>
          </div>
          <p style={{ margin: 0, fontSize: '10px', color: '#888', lineHeight: 1.6 }}>
            Addis Ababa, Ethiopia &nbsp;·&nbsp; P.O. Box XXXX<br />
            Tel: +251 XXX XXX XXX &nbsp;·&nbsp; TIN: XXXXXXXXX
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ margin: 0, fontSize: '9px', color: '#aaa', textTransform: 'uppercase', letterSpacing: '1.2px' }}>Document</p>
          <p style={{ margin: '3px 0 0', fontSize: '20px', fontWeight: 800, color: '#1B3A5C' }}>PAYMENT REQUEST</p>
          <p style={{ margin: '4px 0 0', fontFamily: 'monospace', fontSize: '11px', color: '#555', fontWeight: 700 }}>
            {expense.expense_code ?? '—'}
          </p>
        </div>
      </div>

      {/* Meta strip */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '20px' }}>
        {[
          { label: 'Invoice Number', value: expense.expense_code ?? '—', mono: true },
          { label: 'Date', value: expense.date ? formatDate(expense.date) : today },
          { label: 'Type', value: TYPE_THEME[expense.expense_type ?? 'general']?.label },
        ].map(f => (
          <div key={f.label} style={{ background: '#f4f6f8', borderRadius: '5px', padding: '10px 12px' }}>
            <p style={{ margin: 0, fontSize: '9px', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.8px' }}>{f.label}</p>
            <p style={{ margin: '3px 0 0', fontWeight: 700, fontSize: '12px', ...(f.mono ? { fontFamily: 'monospace', color: '#1B3A5C' } : {}) }}>{f.value}</p>
          </div>
        ))}
      </div>

      {/* Payee */}
      {vendorName && (
        <div style={{ marginBottom: '18px', border: '1px solid #dde2ea', borderRadius: '5px', overflow: 'hidden' }}>
          <div style={{ background: '#1B3A5C', color: '#fff', padding: '7px 12px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
            Payee / Vendor
          </div>
          <div style={{ padding: '10px 12px', fontSize: '12px', lineHeight: 1.7 }}>
            <p style={{ margin: 0 }}><strong>Name:</strong> {vendorName}</p>
            {vendorBank && <p style={{ margin: 0 }}><strong>Bank Account:</strong> {vendorBank}</p>}
            {vendorLocation && <p style={{ margin: 0 }}><strong>Location:</strong> {vendorLocation}</p>}
          </div>
        </div>
      )}

      {/* Items table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px', fontSize: '12px' }}>
        <thead>
          <tr style={{ background: '#1B3A5C', color: '#fff' }}>
            <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Description</th>
            <th style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 600, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.6px', width: '50px' }}>Qty</th>
            <th style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 600, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.6px', width: '55px' }}>UOM</th>
            <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.6px', width: '130px' }}>Amount (ETB)</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ borderBottom: '1px solid #e4e8ee' }}>
            <td style={{ padding: '10px 12px' }}>{expense.item_service_description ?? '—'}</td>
            <td style={{ padding: '10px 10px', textAlign: 'center' }}>{expense.quantity ?? 1}</td>
            <td style={{ padding: '10px 10px', textAlign: 'center' }}>{expense.uom ?? 'pcs'}</td>
            <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>
              {expense.amount_etb != null ? formatCurrency(expense.amount_etb) : '—'}
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr style={{ background: '#f4f6f8', borderTop: '2px solid #dde2ea' }}>
            <td colSpan={3} style={{ padding: '10px 12px', fontWeight: 700, textAlign: 'right', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#555' }}>
              Total
            </td>
            <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 900, fontSize: '15px', color: '#1B3A5C' }}>
              {expense.amount_etb != null ? formatCurrency(expense.amount_etb) : '—'}
            </td>
          </tr>
        </tfoot>
      </table>

      {/* Supporting info */}
      {(projectName || categoryName || expense.notes) && (
        <div style={{ marginBottom: '18px', background: '#f8f9fb', borderRadius: '5px', padding: '10px 14px', fontSize: '11px', lineHeight: 1.8 }}>
          {projectName && <p style={{ margin: 0 }}><strong>Project:</strong> {projectName}</p>}
          {categoryName && <p style={{ margin: 0 }}><strong>Category:</strong> {categoryName}</p>}
          {expense.notes && <p style={{ margin: 0 }}><strong>Notes:</strong> {expense.notes}</p>}
        </div>
      )}

      {/* WHT notice */}
      {expense.verify_wht && (
        <div style={{ marginBottom: '18px', border: '1px solid #fbbf24', background: '#fffbeb', borderRadius: '5px', padding: '8px 12px', fontSize: '10px', color: '#92400e' }}>
          <strong>Withholding Tax (WHT) Required</strong>
          {expense.wht_handling_method && ` — ${expense.wht_handling_method}`}
        </div>
      )}

      {/* Approval signatures */}
      <div style={{ marginTop: '36px', borderTop: '2px solid #dde2ea', paddingTop: '20px' }}>
        <p style={{ margin: '0 0 16px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', color: '#aaa', letterSpacing: '1px' }}>
          Authorization & Approval Signatures
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
          {[
            { label: 'Requested By', name: null },
            { label: 'Manager Approved', name: managerName },
            { label: 'Finance Approved', name: financeName },
          ].map(block => (
            <div key={block.label}>
              <p style={{ margin: '0 0 2px', fontSize: '9px', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.8px' }}>{block.label}</p>
              <div style={{ borderBottom: '1.5px solid #999', minHeight: '32px', marginBottom: '4px', display: 'flex', alignItems: 'flex-end', paddingBottom: '2px' }}>
                {block.name && (
                  <span style={{ fontSize: '11px', fontStyle: 'italic', color: '#1B3A5C', fontWeight: 600 }}>{block.name}</span>
                )}
              </div>
              <p style={{ margin: 0, fontSize: '9px', color: '#ccc' }}>Name &nbsp;/&nbsp; Signature &nbsp;/&nbsp; Date</p>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div style={{ marginTop: '44px', borderTop: '1px solid #e4e8ee', paddingTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ margin: 0, fontSize: '9px', color: '#bbb' }}>
          KUNCHO TRADING PLC &nbsp;·&nbsp; This is an official payment request document
        </p>
        <p style={{ margin: 0, fontSize: '9px', color: '#bbb' }}>
          Generated {today} &nbsp;·&nbsp; Ref: {expense.expense_code ?? expense.id}
        </p>
      </div>
    </div>
  )
}

// ── Detail page ───────────────────────────────────────────────────────────────

export default function ExpenseDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { role } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [rejecting, setRejecting] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')

  const { data: expense, isLoading } = useQuery({
    queryKey: ['expense-detail', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select(`
          *,
          vendors:vendor_id ( vendor_name, bank_account, location ),
          projects:project_id ( project_name ),
          accounts:account_id ( account_name ),
          categories:category_id ( category_name ),
          sub_categories:sub_category_id ( item_name ),
          manager_profile:user_profiles!manager_approved_by ( full_name ),
          finance_profile:user_profiles!finance_approved_by ( full_name )
        `)
        .eq('id', id!)
        .single()
      if (error) throw error
      return data as ExpenseWithJoins
    },
    enabled: !!id,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-slate-400 text-sm">Loading…</p>
      </div>
    )
  }

  if (!expense) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-slate-500">Expense not found.</p>
        <Link to="/expenses" className="text-sm text-blue-600 hover:underline">← Back to Approvals</Link>
      </div>
    )
  }

  const theme = TYPE_THEME[expense.expense_type ?? 'general'] ?? TYPE_THEME.general
  const canEdit = role === 'admin' || role === 'manager' || role === 'finance'

  const approvalStatus = expense.approval_status ?? 'pending'
  const showManagerActions = approvalStatus === 'pending' && canApproveAsManager(role)
  const showFinanceActions = approvalStatus === 'manager_approved' && expense.requires_finance_approval && canApproveAsFinance(role)
  const canResubmit = approvalStatus === 'rejected' && (role === 'admin' || role === 'manager')

  async function handleApprovalTransition(nextStatus: string, extra: Record<string, unknown> = {}) {
    if (!id) return
    const { error } = await supabase.from('expenses').update({ approval_status: nextStatus, ...extra }).eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['expense-detail', id] })
    qc.invalidateQueries({ queryKey: ['expenses'] })
    toast('Approval updated', 'success')
    setRejecting(false)
    setRejectionReason('')
  }

  const projectName = expense.projects?.project_name ?? expense.project_name
  const vendorName  = expense.vendors?.vendor_name ?? expense.vendors_name
  const vendorBank  = expense.vendors?.bank_account ?? expense.vendors_bank_account

  const approvalSteps: { label: string; done: boolean; date: string | null; by: string | null }[] = [
    {
      label: 'Submitted',
      done: true,
      date: expense.created_at,
      by: null,
    },
    {
      label: 'Manager Approved',
      done: !!expense.manager_approved_at,
      date: expense.manager_approved_at,
      by: (expense as any).manager_profile?.full_name ?? null,
    },
    {
      label: 'Finance Approved',
      done: !!expense.finance_approved_at,
      date: expense.finance_approved_at,
      by: (expense as any).finance_profile?.full_name ?? null,
    },
  ]

  return (
    <>
      {/* Print-only invoice */}
      <div className="hidden print:block">
        <PrintInvoice expense={expense} />
      </div>

      {/* Screen view */}
      <div className="space-y-5 print:hidden">

        {/* Back + actions */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <ArrowLeft className="h-4 w-4" /> Approvals
          </button>
          <div className="flex items-center gap-2 flex-wrap">
            {(showManagerActions || showFinanceActions) && !rejecting && (
              <>
                <button
                  onClick={() => handleApprovalTransition(showFinanceActions ? 'finance_approved' : 'manager_approved')}
                  className="flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {showFinanceActions ? 'Final Approve' : 'Approve'}
                </button>
                <button
                  onClick={() => setRejecting(true)}
                  className="flex items-center gap-1.5 rounded-md border border-red-200 dark:border-red-800 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  <XCircle className="h-3.5 w-3.5" /> Reject
                </button>
              </>
            )}
            {canResubmit && !rejecting && (
              <button
                onClick={() => handleApprovalTransition('pending', { rejection_reason: null })}
                className="rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50"
              >
                Resubmit
              </button>
            )}
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              <Printer className="h-3.5 w-3.5" /> Print Payment Request
            </button>
            {canEdit && (
              <Link
                to={`/expenses/${id}/edit`}
                className="flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Link>
            )}
          </div>
        </div>

        {/* Rejection panel */}
        {rejecting && (
          <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 space-y-3">
            <p className="text-sm font-semibold text-red-700 dark:text-red-400">Provide a reason for rejection</p>
            <textarea
              rows={2}
              className="w-full rounded-md border border-red-200 dark:border-red-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-400"
              placeholder="Rejection reason…"
              value={rejectionReason}
              onChange={e => setRejectionReason(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                disabled={!rejectionReason.trim()}
                onClick={() => handleApprovalTransition('rejected', { rejection_reason: rejectionReason.trim() })}
                className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                Confirm Reject
              </button>
              <button
                onClick={() => { setRejecting(false); setRejectionReason('') }}
                className="rounded-md border px-3 py-1.5 text-xs hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Hero card */}
        <div className="rounded-2xl overflow-hidden" style={{ background: theme.bg }}>
          <div className="relative px-6 py-7 overflow-hidden">
            {/* Watermark */}
            <span
              className="pointer-events-none select-none absolute -right-4 -bottom-6 font-black leading-none opacity-[0.06]"
              style={{ fontSize: '8rem', color: '#fff' }}
              aria-hidden
            >
              {theme.abbr}
            </span>

            <div className="relative z-10">
              <div className="flex items-center gap-3 mb-5">
                <div
                  className="h-12 w-12 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0 border border-white/20"
                  style={{ background: 'rgba(255,255,255,0.18)', color: '#fff' }}
                >
                  {theme.abbr}
                </div>
                <div>
                  <p className="text-white/60 text-xs uppercase tracking-widest">{theme.label}</p>
                  <h1 className="text-white font-bold text-lg leading-tight font-mono">{expense.expense_code ?? '—'}</h1>
                </div>
              </div>

              <p className="text-white/80 text-base font-medium mb-4 max-w-xl leading-snug">
                {expense.item_service_description ?? '—'}
              </p>

              <div className="flex flex-wrap gap-2">
                <StatusBadge status={expense.approval_status} />
                {expense.payment_status && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(255,255,255,0.18)', color: '#fff' }}>
                    Paid
                  </span>
                )}
                {expense.date && (
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.8)' }}>
                    {formatDate(expense.date)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Stat strip */}
          <div className="grid grid-cols-3 text-center divide-x divide-white/10" style={{ background: 'rgba(0,0,0,0.22)' }}>
            <div className="py-3 px-2">
              <p className="text-white/50 text-xs uppercase tracking-wide">Amount</p>
              <p className="text-white font-black text-xl tabular-nums">
                {expense.amount_etb != null ? formatCurrency(expense.amount_etb) : '—'}
              </p>
            </div>
            <div className="py-3 px-2">
              <p className="text-white/50 text-xs uppercase tracking-wide">Project</p>
              <p className="text-white font-bold text-sm truncate">{projectName ?? '—'}</p>
            </div>
            <div className="py-3 px-2">
              <p className="text-white/50 text-xs uppercase tracking-wide">Vendor</p>
              <p className="text-white font-bold text-sm truncate">{vendorName ?? '—'}</p>
            </div>
          </div>
        </div>

        {/* Approval timeline */}
        <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b dark:border-slate-700">
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Approval Status</h2>
          </div>
          <div className="p-5">
            {expense.approval_status === 'rejected' && expense.rejection_reason && (
              <div className="mb-5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 flex gap-2.5">
                <XCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-700 dark:text-red-400">Rejected</p>
                  <p className="text-xs text-red-600 dark:text-red-300 mt-0.5">{expense.rejection_reason}</p>
                </div>
              </div>
            )}
            <div className="flex items-start gap-1 flex-wrap">
              {approvalSteps.map((step, i) => {
                const stepCls = step.done
                  ? i === 0
                    ? 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                    : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500'

                return (
                  <div key={step.label} className="flex items-start gap-1">
                    {i > 0 && <div className="mt-4 h-px w-5 bg-slate-200 dark:bg-slate-600 flex-shrink-0" />}
                    <div className="flex flex-col items-center gap-1.5 min-w-[96px] max-w-[120px]">
                      <div className={`h-9 w-9 rounded-full flex items-center justify-center flex-shrink-0 ${stepCls}`}>
                        {step.done
                          ? <CheckCircle2 className="h-4 w-4" />
                          : <Clock className="h-4 w-4" />
                        }
                      </div>
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 text-center leading-tight">{step.label}</p>
                      {step.date && (
                        <p className="text-[10px] text-slate-400 text-center">{formatDate(step.date)}</p>
                      )}
                      {step.by && (
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 text-center font-medium">{step.by}</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Details grid */}
        <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b dark:border-slate-700">
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Details</h2>
          </div>
          <div className="divide-y dark:divide-slate-700">
            {([
              { label: 'Description',        value: expense.item_service_description,                                          icon: <FileText className="h-3.5 w-3.5" /> },
              { label: 'Amount (ETB)',        value: expense.amount_etb != null ? formatCurrency(expense.amount_etb) : null,   icon: <DollarSign className="h-3.5 w-3.5" /> },
              { label: 'Date',               value: expense.date ? formatDate(expense.date) : null,                           icon: null },
              { label: 'Vendor',             value: vendorName,                                                                icon: <Building2 className="h-3.5 w-3.5" /> },
              { label: 'Vendor Bank Account',value: vendorBank,                                                                icon: null },
              { label: 'Project',            value: projectName,                                                               icon: <FolderKanban className="h-3.5 w-3.5" /> },
              { label: 'Account',            value: expense.accounts?.account_name ?? null,                                   icon: null },
              { label: 'Category',           value: expense.categories?.category_name ?? null,                                icon: <Tag className="h-3.5 w-3.5" /> },
              { label: 'Sub-category',       value: expense.sub_categories?.item_name ?? null,                                icon: null },
              { label: 'Quantity / UOM',     value: expense.quantity != null ? `${expense.quantity}${expense.uom ? ' ' + expense.uom : ''}` : null, icon: null },
              { label: 'Purchase Type',      value: expense.purchase_type,                                                    icon: null },
              { label: 'Notes',              value: expense.notes,                                                            icon: null },
              { label: 'Bank Reference',     value: expense.bank_ref,                                                         icon: null },
              { label: 'WHT',                value: expense.verify_wht ? `Required${expense.wht_handling_method ? ' — ' + expense.wht_handling_method : ''}` : null, icon: null },
            ] as { label: string; value: string | null | undefined; icon: React.ReactNode }[])
              .filter(r => r.value)
              .map(row => (
                <div key={row.label} className="flex items-start gap-3 px-5 py-3">
                  <div className="w-40 shrink-0 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 pt-0.5">
                    {row.icon}
                    {row.label}
                  </div>
                  <p className="text-sm text-slate-800 dark:text-slate-100 flex-1 break-words">{row.value}</p>
                </div>
              ))
            }
          </div>
        </div>

      </div>
    </>
  )
}
