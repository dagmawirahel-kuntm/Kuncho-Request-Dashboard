import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { SourcingBundleStatus } from '@/types/database'
import {
  ChevronLeft, Pencil, FileText, Clock, CheckCircle2,
  Package, TruckIcon, XCircle, Send, Check, AlertCircle, Printer, Receipt, Link2Off
} from 'lucide-react'

type BundleDetail = {
  id: string
  bundle_code: string
  vendor_id: string | null
  vendor_name: string | null
  status: SourcingBundleStatus
  procurement_officer_id: string | null
  submitted_at: string | null
  approved_by: string | null
  approved_at: string | null
  ordered_at: string | null
  fulfilled_at: string | null
  expected_delivery_date: string | null
  notes: string | null
  finance_notes: string | null
  expense_id: string | null
  created_at: string
  vendors: { vendor_name: string } | null
  procurement_officer: { full_name: string } | null
  approver: { full_name: string } | null
  expenses: { expense_code: string | null; item_service_description: string | null; amount_etb: number | null } | null
  sourcing_bundle_items: {
    id: string
    order_item_id: string
    quantity_actual: number | null
    unit_price_actual: number | null
    notes: string | null
    sort_order: number
    order_items: {
      id: string
      item_name: string
      specifications: string | null
      unit: string | null
      quantity: number
      unit_price_est: number | null
      order_id: string
      orders: {
        request_code: string
        order_name: string
        projects: { project_name: string } | null
      } | null
    } | null
  }[]
}

const STATUS_STEPS: { status: SourcingBundleStatus; label: string; icon: React.ReactNode }[] = [
  { status: 'drafting',  label: 'Drafting',         icon: <FileText className="h-3.5 w-3.5" /> },
  { status: 'submitted', label: 'Awaiting Finance',  icon: <Clock className="h-3.5 w-3.5" /> },
  { status: 'approved',  label: 'Finance Approved',  icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  { status: 'ordered',   label: 'Ordered',           icon: <TruckIcon className="h-3.5 w-3.5" /> },
  { status: 'fulfilled', label: 'Fulfilled',         icon: <Package className="h-3.5 w-3.5" /> },
]

const STATUS_ORDER: SourcingBundleStatus[] = ['drafting', 'submitted', 'approved', 'ordered', 'fulfilled', 'cancelled']

const STATUS_CLS: Record<SourcingBundleStatus, string> = {
  drafting:  'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  submitted: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  approved:  'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  ordered:   'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  fulfilled: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  cancelled: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
}

export default function PurchaseOrderPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { toast } = useToast()
  const { role, profile } = useAuth()

  const [financeNotes, setFinanceNotes] = useState<string>('')
  const [showRejectPanel, setShowRejectPanel] = useState(false)
  const [transitioning, setTransitioning] = useState(false)

  const { data: bundle, isLoading, error: bundleError } = useQuery({
    queryKey: ['sourcing-bundle-detail', id],
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sourcing_bundles')
        .select(`
          *,
          vendors(vendor_name),
          procurement_officer:user_profiles!sourcing_bundles_procurement_officer_id_fkey(full_name),
          approver:user_profiles!sourcing_bundles_approved_by_fkey(full_name),
          expenses!sourcing_bundles_expense_id_fkey(expense_code, item_service_description, amount_etb),
          sourcing_bundle_items(
            *,
            order_items(
              id, item_name, specifications, unit, quantity, unit_price_est, order_id,
              orders(request_code, order_name, projects(project_name))
            )
          )
        `)
        .eq('id', id!)
        .single()
      if (error) throw error
      return data as BundleDetail
    },
  })

  const { data: expenseOptions = [] } = useQuery({
    queryKey: ['expenses-lookup-for-bundle'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('id, expense_code, item_service_description, amount_etb')
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return (data ?? []).map(e => ({
        id: e.id,
        label: e.expense_code ?? '(no code)',
        sub: [e.item_service_description, e.amount_etb != null ? formatCurrency(e.amount_etb) : null].filter(Boolean).join(' · '),
      }))
    },
  })

  if (isLoading) return <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
  if (bundleError) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm font-medium text-red-500">Couldn't load this bundle</p>
        <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">{(bundleError as { message?: string }).message ?? String(bundleError)}</p>
      </div>
    )
  }
  if (!bundle) return <div className="py-16 text-center text-sm text-slate-400">Bundle not found.</div>

  const status = bundle.status
  const statusIdx = STATUS_ORDER.indexOf(status)
  const vendorDisplay = bundle.vendors?.vendor_name ?? bundle.vendor_name ?? '—'

  const isAdmin = role === 'admin'
  const isManager = role === 'manager'
  const isFinance = role === 'finance'
  const isProcurement = role === 'procurement_officer'

  const canEdit = (isProcurement || isAdmin || isManager) && status === 'drafting'
  const canSubmit = (isProcurement || isAdmin || isManager) && status === 'drafting'
  const canApprove = (isFinance || isAdmin) && status === 'submitted'
  const canReject = (isFinance || isAdmin || isManager) && (status === 'submitted')
  const canMarkOrdered = (isProcurement || isAdmin || isManager) && status === 'approved'
  const canMarkFulfilled = (isProcurement || isAdmin || isManager) && status === 'ordered'
  const canCancel = (isAdmin || isManager) && !['fulfilled', 'cancelled'].includes(status)

  const sortedItems = [...(bundle.sourcing_bundle_items ?? [])].sort((a, b) => a.sort_order - b.sort_order)

  const grandTotal = sortedItems.reduce((sum, item) =>
    sum + (item.quantity_actual ?? 0) * (item.unit_price_actual ?? 0), 0)

  // Group by project for cost allocation
  const projectAllocations = sortedItems.reduce<Record<string, { name: string; total: number }>>((acc, item) => {
    const project = item.order_items?.orders?.projects?.project_name ?? 'No project'
    const lineTotal = (item.quantity_actual ?? 0) * (item.unit_price_actual ?? 0)
    if (!acc[project]) acc[project] = { name: project, total: 0 }
    acc[project].total += lineTotal
    return acc
  }, {})

  async function transition(nextStatus: SourcingBundleStatus, extra?: Record<string, any>) {
    setTransitioning(true)
    try {
      const patch: Record<string, any> = { status: nextStatus, ...extra }
      if (nextStatus === 'submitted') patch.submitted_at = new Date().toISOString()
      if (nextStatus === 'approved') { patch.approved_by = profile?.id; patch.approved_at = new Date().toISOString() }
      if (nextStatus === 'ordered') patch.ordered_at = new Date().toISOString()
      if (nextStatus === 'fulfilled') patch.fulfilled_at = new Date().toISOString()

      const { error } = await supabase.from('sourcing_bundles').update(patch).eq('id', id!)
      if (error) throw error

      if (nextStatus === 'cancelled') {
        // Release this bundle's line items so they can be re-sourced:
        // delete the bundle_items rows (allowed once cancelled — see
        // migration 056) and revert their order_items back to pending.
        const itemIds = (bundle?.sourcing_bundle_items ?? []).map(i => i.order_item_id)
        const { error: delErr } = await supabase.from('sourcing_bundle_items').delete().eq('bundle_id', id!)
        if (delErr) throw delErr
        if (itemIds.length > 0) {
          const { error: revertErr } = await supabase.from('order_items').update({ status: 'pending' }).in('id', itemIds)
          if (revertErr) throw revertErr
        }
      }

      qc.invalidateQueries({ queryKey: ['sourcing-bundle-detail', id] })
      qc.invalidateQueries({ queryKey: ['sourcing-bundles'] })
      qc.invalidateQueries({ queryKey: ['order-item-counts'] })
      toast(`Bundle moved to ${nextStatus}`, 'success')
      setShowRejectPanel(false)
      setFinanceNotes('')
    } catch (err: any) {
      toast(err.message, 'error')
    } finally {
      setTransitioning(false)
    }
  }

  async function linkExpense(expenseId: string | null) {
    const { error } = await supabase.from('sourcing_bundles').update({ expense_id: expenseId }).eq('id', id!)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['sourcing-bundle-detail', id] })
    toast(expenseId ? 'Linked to expense' : 'Expense link removed', 'success')
  }

  async function handleDelete() {
    if (!window.confirm('Delete this sourcing bundle? This cannot be undone.')) return
    const { error } = await supabase.from('sourcing_bundles').delete().eq('id', id!)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['sourcing-bundles'] })
    navigate('/sourcing')
    toast('Bundle deleted', 'success')
  }

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Link to="/sourcing" className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 font-mono">{bundle.bundle_code}</h1>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_CLS[status]}`}>
                {STATUS_STEPS.find(s => s.status === status)?.label ?? status}
              </span>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">Purchase Order — {vendorDisplay}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => window.print()}
            className="flex items-center gap-1.5 rounded-md border dark:border-slate-600 px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
            <Printer className="h-3.5 w-3.5" /> Print PO
          </button>
          {canEdit && (
            <Link to={`/sourcing/${id}/edit`}
              className="flex items-center gap-1.5 rounded-md border dark:border-slate-600 px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Link>
          )}
          {canCancel && (
            <button onClick={() => transition('cancelled')}
              disabled={transitioning}
              className="flex items-center gap-1.5 rounded-md border border-red-200 dark:border-red-800/40 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-60">
              <XCircle className="h-3.5 w-3.5" /> Cancel Bundle
            </button>
          )}
        </div>
      </div>

      {/* Status timeline */}
      <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 px-5 py-4 shadow-sm">
        <div className="flex items-center gap-0">
          {STATUS_STEPS.map((step, i) => {
            const stepIdx = STATUS_ORDER.indexOf(step.status)
            const isComplete = status !== 'cancelled' && statusIdx > stepIdx
            const isCurrent = status !== 'cancelled' && statusIdx === stepIdx
            const isCancelled = status === 'cancelled'
            return (
              <div key={step.status} className="flex items-center flex-1 min-w-0">
                <div className={`flex items-center gap-1.5 shrink-0 ${
                  isCancelled ? 'text-slate-300 dark:text-slate-600'
                  : isComplete ? 'text-green-500'
                  : isCurrent ? 'text-brand'
                  : 'text-slate-300 dark:text-slate-600'
                }`}>
                  <div className={`rounded-full p-1.5 ${
                    isCancelled ? 'bg-slate-100 dark:bg-slate-700'
                    : isComplete ? 'bg-green-50 dark:bg-green-900/20'
                    : isCurrent ? 'bg-brand/10'
                    : 'bg-slate-100 dark:bg-slate-700'
                  }`}>
                    {step.icon}
                  </div>
                  <span className={`text-[10px] font-medium hidden sm:block whitespace-nowrap ${
                    isCurrent ? 'text-brand' : isComplete ? 'text-green-600 dark:text-green-400' : ''
                  }`}>{step.label}</span>
                </div>
                {i < STATUS_STEPS.length - 1 && (
                  <div className={`h-px flex-1 mx-2 ${
                    !isCancelled && statusIdx > STATUS_ORDER.indexOf(step.status) ? 'bg-green-300 dark:bg-green-700' : 'bg-slate-200 dark:bg-slate-700'
                  }`} />
                )}
              </div>
            )
          })}
          {status === 'cancelled' && (
            <div className="ml-3 flex items-center gap-1.5 text-red-500">
              <XCircle className="h-4 w-4" />
              <span className="text-xs font-medium">Cancelled</span>
            </div>
          )}
        </div>
      </div>

      {/* Finance notes (if any) */}
      {bundle.finance_notes && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/10 px-4 py-3">
          <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">Finance Notes</p>
            <p className="text-sm text-amber-700 dark:text-amber-300 mt-0.5">{bundle.finance_notes}</p>
          </div>
        </div>
      )}

      {/* PO Document */}
      <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden print:shadow-none print:border-0">
        {/* PO header */}
        <div className="bg-[#1E3A5F] text-white px-6 py-5 flex items-start justify-between gap-4 print:bg-[#1E3A5F]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-200 mb-1">Purchase Order</p>
            <h2 className="text-2xl font-bold font-mono tracking-tight">{bundle.bundle_code}</h2>
            <p className="text-sm text-blue-200 mt-1">KUNCHO Operations</p>
          </div>
          <div className="text-right text-sm text-blue-100 space-y-0.5">
            <p><span className="text-blue-300 text-xs">Date:</span> {formatDate(bundle.created_at)}</p>
            {bundle.expected_delivery_date && (
              <p><span className="text-blue-300 text-xs">Expected delivery:</span> {formatDate(bundle.expected_delivery_date)}</p>
            )}
            {bundle.submitted_at && (
              <p><span className="text-blue-300 text-xs">Submitted:</span> {formatDate(bundle.submitted_at)}</p>
            )}
            {bundle.approved_at && (
              <p><span className="text-blue-300 text-xs">Approved:</span> {formatDate(bundle.approved_at)}</p>
            )}
          </div>
        </div>

        {/* Vendor + officer info */}
        <div className="px-6 py-4 border-b dark:border-slate-700 grid grid-cols-2 gap-6">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Vendor / Supplier</p>
            <p className="text-base font-semibold text-slate-800 dark:text-slate-100">{vendorDisplay}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Procurement Officer</p>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {(bundle.procurement_officer as any)?.full_name ?? '—'}
            </p>
            {bundle.approver && (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mt-2 mb-1">Approved by</p>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  {(bundle.approver as any)?.full_name}
                </p>
              </>
            )}
          </div>
        </div>

        {/* Items table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-700/40 border-b dark:border-slate-700">
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider w-8">#</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Item Description</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider hidden md:table-cell">Source PR</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider hidden lg:table-cell">Project</th>
                <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Qty</th>
                <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Unit</th>
                <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Unit Price</th>
                <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-700">
              {sortedItems.map((item, i) => {
                const oi = item.order_items
                const lineTotal = (item.quantity_actual ?? 0) * (item.unit_price_actual ?? 0)
                return (
                  <tr key={item.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-700/20 transition-colors">
                    <td className="px-4 py-3 text-slate-400 text-xs">{i + 1}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800 dark:text-slate-100">{oi?.item_name ?? '—'}</p>
                      {oi?.specifications && <p className="text-xs text-slate-400 mt-0.5">{oi.specifications}</p>}
                      {item.notes && <p className="text-xs text-slate-400 italic mt-0.5">{item.notes}</p>}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="font-mono text-xs text-brand">
                        {oi?.orders?.request_code ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {oi?.orders?.projects?.project_name ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700 dark:text-slate-200">
                      {item.quantity_actual ?? oi?.quantity ?? '—'}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400">
                      {oi?.unit ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700 dark:text-slate-200">
                      {item.unit_price_actual != null ? formatCurrency(item.unit_price_actual) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-800 dark:text-slate-100">
                      {lineTotal > 0 ? formatCurrency(lineTotal) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/30">
                <td colSpan={7} className="px-4 py-3 text-right text-sm font-semibold text-slate-600 dark:text-slate-300">
                  Grand Total
                </td>
                <td className="px-4 py-3 text-right text-base font-bold text-slate-800 dark:text-slate-100 tabular-nums">
                  {formatCurrency(grandTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Project cost allocation */}
        {Object.keys(projectAllocations).length > 1 && (
          <div className="px-6 py-4 border-t dark:border-slate-700 bg-slate-50 dark:bg-slate-700/20">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Cost Allocation by Project</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {Object.values(projectAllocations).map(proj => (
                <div key={proj.name} className="rounded-lg bg-white dark:bg-slate-800 border dark:border-slate-700 px-3 py-2">
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{proj.name}</p>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 tabular-nums">
                    {formatCurrency(proj.total)}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    {grandTotal > 0 ? Math.round((proj.total / grandTotal) * 100) : 0}% of total
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {bundle.notes && (
          <div className="px-6 py-4 border-t dark:border-slate-700">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Notes</p>
            <p className="text-sm text-slate-600 dark:text-slate-300">{bundle.notes}</p>
          </div>
        )}
      </div>

      {/* Action panel */}
      <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm space-y-4 print:hidden">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Actions</h3>

        {canSubmit && (
          <div className="flex items-center gap-3">
            <button
              onClick={() => transition('submitted')}
              disabled={transitioning}
              className="flex items-center gap-1.5 rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-60">
              <Send className="h-3.5 w-3.5" /> Submit to Finance
            </button>
            <p className="text-xs text-slate-400">Finance will review and approve this purchase order</p>
          </div>
        )}

        {canApprove && !showRejectPanel && (
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={() => transition('approved', { finance_notes: financeNotes || null })}
              disabled={transitioning}
              className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60">
              <Check className="h-3.5 w-3.5" /> Approve PO
            </button>
            {canReject && (
              <button
                onClick={() => setShowRejectPanel(true)}
                className="flex items-center gap-1.5 rounded-md border border-red-200 dark:border-red-800/40 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
                <XCircle className="h-3.5 w-3.5" /> Request Changes
              </button>
            )}
          </div>
        )}

        {showRejectPanel && (
          <div className="space-y-3 rounded-lg border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-900/10 p-4">
            <p className="text-sm font-medium text-red-700 dark:text-red-400">Request changes / send back to drafting</p>
            <textarea
              value={financeNotes}
              onChange={e => setFinanceNotes(e.target.value)}
              rows={3}
              placeholder="Explain what needs to be corrected…"
              className="w-full rounded-md border border-red-200 dark:border-red-700/50 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-400/40 resize-none" />
            <div className="flex items-center gap-2">
              <button
                onClick={() => transition('drafting', { finance_notes: financeNotes || null })}
                disabled={transitioning || !financeNotes.trim()}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60">
                {transitioning ? 'Sending…' : 'Send Back'}
              </button>
              <button onClick={() => { setShowRejectPanel(false); setFinanceNotes('') }}
                className="rounded-md px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">
                Cancel
              </button>
            </div>
          </div>
        )}

        {canMarkOrdered && (
          <div className="flex items-center gap-3">
            <button
              onClick={() => transition('ordered')}
              disabled={transitioning}
              className="flex items-center gap-1.5 rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-60">
              <TruckIcon className="h-3.5 w-3.5" /> Mark as Ordered
            </button>
            <p className="text-xs text-slate-400">Confirm the order has been placed with the vendor</p>
          </div>
        )}

        {canMarkFulfilled && (
          <div className="flex items-center gap-3">
            <button
              onClick={() => transition('fulfilled')}
              disabled={transitioning}
              className="flex items-center gap-1.5 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60">
              <Package className="h-3.5 w-3.5" /> Mark as Fulfilled
            </button>
            <p className="text-xs text-slate-400">Confirm all items have been received</p>
          </div>
        )}

        {status === 'fulfilled' && (
          <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
            <CheckCircle2 className="h-4 w-4" />
            <p className="text-sm font-medium">
              Fulfilled{bundle.fulfilled_at ? ` on ${formatDate(bundle.fulfilled_at)}` : ''}
            </p>
          </div>
        )}

        {status === 'cancelled' && (
          <p className="text-sm text-slate-400">This bundle has been cancelled.</p>
        )}

        {/* Reconcile to an expense once the order has actually been placed */}
        {['ordered', 'fulfilled'].includes(status) && (isAdmin || isManager || isFinance || isProcurement) && (
          <div className="space-y-1.5 pt-2 border-t dark:border-slate-700">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <Receipt className="h-3.5 w-3.5" /> Reconciled Expense
            </label>
            {bundle.expenses ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="rounded-md bg-slate-100 dark:bg-slate-700 px-2.5 py-1.5 text-sm text-slate-700 dark:text-slate-200">
                  <span className="font-mono text-xs font-semibold text-brand mr-1.5">{bundle.expenses.expense_code}</span>
                  {bundle.expenses.item_service_description}
                  {bundle.expenses.amount_etb != null && ` — ${formatCurrency(bundle.expenses.amount_etb)}`}
                </span>
                <button onClick={() => linkExpense(null)}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-500">
                  <Link2Off className="h-3 w-3" /> Unlink
                </button>
              </div>
            ) : (
              <SearchableSelect
                value={null}
                onChange={linkExpense}
                options={expenseOptions}
                placeholder="Search expenses to link…"
              />
            )}
            <p className="text-[11px] text-slate-400">Link the expense record where this vendor payment was recorded, for audit traceability.</p>
          </div>
        )}

        {/* Finance notes input for approve action */}
        {canApprove && !showRejectPanel && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Finance notes (optional)</label>
            <textarea
              value={financeNotes}
              onChange={e => setFinanceNotes(e.target.value)}
              rows={2}
              placeholder="Add a note when approving…"
              className="w-full rounded-md border dark:border-slate-600 bg-slate-50 dark:bg-slate-700/50 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/40 resize-none" />
          </div>
        )}

        {/* Danger zone */}
        {(isAdmin || isManager) && status === 'drafting' && (
          <div className="pt-2 border-t dark:border-slate-700">
            <button onClick={handleDelete}
              className="text-xs text-red-400 hover:text-red-600 hover:underline">
              Delete this bundle
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
