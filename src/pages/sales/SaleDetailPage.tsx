import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { canApproveAsManager, canApproveAsFinance } from '@/lib/expenseAccess'
import { useToast } from '@/contexts/ToastContext'
import {
  ArrowLeft, Pencil, CheckCircle2, Clock, XCircle,
  DollarSign, FileText, Users, FolderKanban, CreditCard,
} from 'lucide-react'
import { StatusBadge } from '@/components/shared/StatusBadge'
import type { Sale } from '@/types/database'

const THEME = { bg: '#064E3B', abbr: 'SAL', label: 'Sales Record' }

type SaleWithJoins = Sale & {
  clients: { client_name: string } | null
  projects: { project_name: string } | null
  accounts: { account_name: string } | null
  tax_summary: { month: string } | null
  manager_profile: { full_name: string } | null
  finance_profile: { full_name: string } | null
}

export default function SaleDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { role } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [rejecting, setRejecting] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')

  const { data: sale, isLoading } = useQuery({
    queryKey: ['sale-detail', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales')
        .select(`
          *,
          clients:client_id ( client_name ),
          projects:project_id ( project_name ),
          accounts:account_id ( account_name ),
          tax_summary:tax_summary_id ( month ),
          manager_profile:user_profiles!manager_approved_by ( full_name ),
          finance_profile:user_profiles!finance_approved_by ( full_name )
        `)
        .eq('id', id!)
        .single()
      if (error) throw error
      return data as SaleWithJoins
    },
    enabled: !!id,
  })

  async function handleApprovalTransition(nextStatus: string, extra: Record<string, unknown> = {}) {
    if (!id) return
    const { error } = await supabase.from('sales').update({ approval_status: nextStatus, ...extra }).eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['sale-detail', id] })
    qc.invalidateQueries({ queryKey: ['sales'] })
    toast('Approval updated', 'success')
    setRejecting(false)
    setRejectionReason('')
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-slate-400 text-sm">Loading…</p>
      </div>
    )
  }

  if (!sale) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-slate-500">Sale not found.</p>
        <Link to="/sales" className="text-sm text-brand hover:underline">← Back to Sales</Link>
      </div>
    )
  }

  const approvalStatus = sale.approval_status ?? 'pending'
  const showManagerActions = approvalStatus === 'pending' && canApproveAsManager(role)
  const showFinanceActions = approvalStatus === 'manager_approved' && canApproveAsFinance(role)
  const canResubmit = approvalStatus === 'rejected' && (role === 'admin' || role === 'manager' || role === 'finance')
  const canEdit = role === 'admin' || role === 'manager' || role === 'finance'

  const clientName  = (sale as any).clients?.client_name ?? null
  const projectName = (sale as any).projects?.project_name ?? null
  const accountName = (sale as any).accounts?.account_name ?? null
  const taxMonth    = (sale as any).tax_summary?.month ?? null
  const managerName = (sale as any).manager_profile?.full_name ?? null
  const financeName = (sale as any).finance_profile?.full_name ?? null

  const approvalSteps = [
    { label: 'Submitted',        done: true,                        date: sale.created_at,            by: null },
    { label: 'Manager Approved', done: !!sale.manager_approved_at,  date: sale.manager_approved_at,   by: managerName },
    { label: 'Finance Approved', done: !!sale.finance_approved_at,  date: sale.finance_approved_at,   by: financeName },
  ]

  return (
    <div className="space-y-5">

      {/* Top bar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
        >
          <ArrowLeft className="h-4 w-4" /> Sales
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
          {canEdit && (
            <Link
              to={`/sales/${id}/edit`}
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
      <div className="rounded-2xl overflow-hidden" style={{ background: THEME.bg }}>
        <div className="relative px-6 py-7 overflow-hidden">
          <span
            className="pointer-events-none select-none absolute -right-4 -bottom-6 font-black leading-none opacity-[0.06]"
            style={{ fontSize: '8rem', color: '#fff' }}
            aria-hidden
          >
            {THEME.abbr}
          </span>
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-5">
              <div
                className="h-12 w-12 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0 border border-white/20"
                style={{ background: 'rgba(255,255,255,0.18)', color: '#fff' }}
              >
                {THEME.abbr}
              </div>
              <div>
                <p className="text-white/60 text-xs uppercase tracking-widest">{THEME.label}</p>
                <h1 className="text-white font-bold text-lg leading-tight">{clientName ?? sale.product_or_service ?? 'Sale'}</h1>
              </div>
            </div>

            <p className="text-white/80 text-base font-medium mb-4 max-w-xl leading-snug">
              {sale.sales_description ?? '—'}
            </p>

            <div className="flex flex-wrap gap-2">
              <StatusBadge status={approvalStatus} />
              {sale.sales_status && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(255,255,255,0.18)', color: '#fff' }}>
                  {sale.sales_status}
                </span>
              )}
              {sale.date && (
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.8)' }}>
                  {formatDate(sale.date)}
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
              {sale.amount != null ? formatCurrency(sale.amount) : '—'}
            </p>
          </div>
          <div className="py-3 px-2">
            <p className="text-white/50 text-xs uppercase tracking-wide">Client</p>
            <p className="text-white font-bold text-sm truncate">{clientName ?? '—'}</p>
          </div>
          <div className="py-3 px-2">
            <p className="text-white/50 text-xs uppercase tracking-wide">Project</p>
            <p className="text-white font-bold text-sm truncate">{projectName ?? '—'}</p>
          </div>
        </div>
      </div>

      {/* Approval timeline */}
      <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b dark:border-slate-700">
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Approval Status</h2>
        </div>
        <div className="p-5">
          {approvalStatus === 'rejected' && sale.rejection_reason && (
            <div className="mb-5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 flex gap-2.5">
              <XCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-700 dark:text-red-400">Rejected</p>
                <p className="text-xs text-red-600 dark:text-red-300 mt-0.5">{sale.rejection_reason}</p>
              </div>
            </div>
          )}
          <div className="flex items-start gap-1 flex-wrap">
            {approvalSteps.map((step, i) => {
              const stepCls = step.done
                ? i === 0
                  ? 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                  : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                : 'bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500'
              return (
                <div key={step.label} className="flex items-start gap-1">
                  {i > 0 && <div className="mt-4 h-px w-5 bg-slate-200 dark:bg-slate-600 flex-shrink-0" />}
                  <div className="flex flex-col items-center gap-1.5 min-w-[96px] max-w-[120px]">
                    <div className={`h-9 w-9 rounded-full flex items-center justify-center flex-shrink-0 ${stepCls}`}>
                      {step.done ? <CheckCircle2 className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                    </div>
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 text-center leading-tight">{step.label}</p>
                    {step.date && <p className="text-[10px] text-slate-400 text-center">{formatDate(step.date)}</p>}
                    {step.by && <p className="text-[10px] text-slate-500 dark:text-slate-400 text-center font-medium">{step.by}</p>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Details */}
      <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b dark:border-slate-700">
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Details</h2>
        </div>
        <div className="divide-y dark:divide-slate-700">
          {([
            { label: 'Description',      value: sale.sales_description,            icon: <FileText className="h-3.5 w-3.5" /> },
            { label: 'Amount (ETB)',      value: sale.amount != null ? formatCurrency(sale.amount) : null, icon: <DollarSign className="h-3.5 w-3.5" /> },
            { label: 'Date',             value: sale.date ? formatDate(sale.date) : null,                 icon: null },
            { label: 'Status',           value: sale.sales_status,                 icon: null },
            { label: 'Product/Service',  value: sale.product_or_service,           icon: null },
            { label: 'Payment Method',   value: sale.payment_method,               icon: <CreditCard className="h-3.5 w-3.5" /> },
            { label: 'Client',           value: clientName,                        icon: <Users className="h-3.5 w-3.5" /> },
            { label: 'Project',          value: projectName,                       icon: <FolderKanban className="h-3.5 w-3.5" /> },
            { label: 'Account',          value: accountName,                       icon: null },
            { label: 'Tax Month',        value: taxMonth,                          icon: null },
            { label: 'Notes',            value: sale.notes,                        icon: null },
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
            ))}
        </div>
      </div>

    </div>
  )
}
