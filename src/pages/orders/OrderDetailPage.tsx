import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { StatusBadge } from '@/components/shared/StatusBadge'
import type { Order, OrderItem, OrderItemStatus } from '@/types/database'
import { useProjects, useStaff, useVendors, useUserProfiles } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { canApproveAsManager, canApproveAsFinance } from '@/lib/expenseAccess'
import { formatDate } from '@/lib/utils'
import {
  ArrowLeft, Pencil, CheckCircle2, Clock, XCircle, Building2,
  User, Calendar, AlertCircle, AlertTriangle, Package,
  ChevronDown, ChevronRight, Zap, Copy,
} from 'lucide-react'

type StepStatus = 'done' | 'active' | 'rejected' | 'waiting'

const ITEM_S: Record<OrderItemStatus, { label: string; bg: string; border: string }> = {
  pending:           { label: 'Pending',     bg: 'text-slate-500 bg-slate-100 dark:bg-slate-700',         border: 'border-l-slate-300 dark:border-l-slate-500' },
  sourced:           { label: 'Sourced',     bg: 'text-green-700 bg-green-50 dark:bg-green-900/30',       border: 'border-l-green-400' },
  partially_sourced: { label: 'Partial',     bg: 'text-amber-700 bg-amber-50 dark:bg-amber-900/30',       border: 'border-l-amber-400' },
  unfulfilled:       { label: 'Unfulfilled', bg: 'text-red-700 bg-red-50 dark:bg-red-900/30',             border: 'border-l-red-400' },
  cancelled:         { label: 'Cancelled',   bg: 'text-slate-400 bg-slate-50 dark:bg-slate-800',           border: 'border-l-slate-200 dark:border-l-slate-700' },
}

const ALL_STATUSES: OrderItemStatus[] = ['pending', 'sourced', 'partially_sourced', 'unfulfilled', 'cancelled']

const inputCls = 'w-full rounded-md border dark:border-slate-600 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:text-slate-100'

// ── Approval step dot ─────────────────────────────────────────────────────────
function StepDot({ status }: { status: StepStatus }) {
  return (
    <div className={`flex-shrink-0 h-9 w-9 rounded-full border-2 flex items-center justify-center z-10 transition-colors ${
      status === 'done'     ? 'bg-green-500 border-green-500 text-white shadow-sm shadow-green-200 dark:shadow-green-900' :
      status === 'active'   ? 'bg-amber-400 border-amber-400 text-white shadow-sm shadow-amber-200 dark:shadow-amber-900' :
      status === 'rejected' ? 'bg-red-500 border-red-500 text-white shadow-sm shadow-red-200 dark:shadow-red-900' :
                              'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600'
    }`}>
      {status === 'done'     && <CheckCircle2 className="h-4 w-4" />}
      {status === 'active'   && <Clock className="h-4 w-4" />}
      {status === 'rejected' && <XCircle className="h-4 w-4" />}
    </div>
  )
}

// ── Page loader ───────────────────────────────────────────────────────────────
export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>()

  const { data: order, isLoading } = useQuery({
    queryKey: ['order', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('orders').select('*').eq('id', id!).single()
      if (error) throw error
      return data as Order
    },
    enabled: !!id,
  })

  const { data: items = [] } = useQuery({
    queryKey: ['order-items', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_items').select('*').eq('order_id', id!).order('sort_order')
      if (error) throw error
      return data as OrderItem[]
    },
    enabled: !!id,
  })

  if (isLoading) return (
    <div className="py-24 text-center text-sm text-slate-400">Loading request…</div>
  )

  if (!order) return (
    <div className="py-24 text-center space-y-2">
      <p className="text-sm text-slate-500">Purchase request not found.</p>
      <Link to="/purchase-requests" className="inline-flex items-center gap-1 text-sm text-brand hover:underline">
        <ArrowLeft className="h-4 w-4" />Back to list
      </Link>
    </div>
  )

  return <DetailContent order={order} items={items} />
}

// ── Main detail content ───────────────────────────────────────────────────────
function DetailContent({ order, items }: { order: Order; items: OrderItem[] }) {
  const { role } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data: projects = [] }     = useProjects()
  const { data: staff = [] }        = useStaff()
  const { data: vendors = [] }      = useVendors()
  const { data: userProfiles = [] } = useUserProfiles()

  const [rejecting, setRejecting]         = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')
  const [expanded, setExpanded]           = useState<Set<string>>(new Set())

  function profileName(uid: string | null) {
    if (!uid) return null
    return (userProfiles as any[]).find(p => p.id === uid)?.full_name ?? '—'
  }

  function lookupName(list: any[], fk: string | null, key: string) {
    if (!fk) return '—'
    return list.find(i => i.id === fk)?.[key] ?? '—'
  }

  function toggleExpand(id: string) {
    setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const approvalStatus   = order.approval_status ?? 'pending'
  const showManagerAct   = approvalStatus === 'pending' && canApproveAsManager(role)
  const showFinanceAct   = approvalStatus === 'manager_approved' && canApproveAsFinance(role)
  const canResubmit      = approvalStatus === 'rejected' && (role === 'admin' || role === 'manager' || role === 'procurement_officer')
  const canUpdateItems   = role === 'admin' || role === 'manager' || role === 'procurement_officer'

  const rejectedAtMgr    = approvalStatus === 'rejected' && !order.manager_approved_by
  const rejectedAtFin    = approvalStatus === 'rejected' && !!order.manager_approved_by
  const step2: StepStatus = rejectedAtMgr ? 'rejected' : approvalStatus === 'pending' ? 'active' : 'done'
  const step3: StepStatus = rejectedAtFin  ? 'rejected' : approvalStatus === 'finance_approved' ? 'done' : approvalStatus === 'manager_approved' ? 'active' : 'waiting'

  const line1Cls = step2 === 'rejected' ? 'bg-red-300 dark:bg-red-700'  : step2 === 'done' ? 'bg-green-400' : 'bg-slate-200 dark:bg-slate-600'
  const line2Cls = step3 === 'rejected' ? 'bg-red-300 dark:bg-red-700'  : step3 === 'done' ? 'bg-green-400' : 'bg-slate-200 dark:bg-slate-600'

  async function handleApproval(nextStatus: string, extra: Record<string, unknown> = {}) {
    const { error } = await supabase.from('orders')
      .update({ approval_status: nextStatus, ...extra }).eq('id', order.id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['order', order.id] })
    qc.invalidateQueries({ queryKey: ['orders'] })
    toast('Approval updated', 'success')
    setRejecting(false); setRejectionReason('')
  }

  async function handleItemStatus(itemId: string, status: OrderItemStatus) {
    const { error } = await supabase.from('order_items').update({ status }).eq('id', itemId)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['order-items', order.id] })
    qc.invalidateQueries({ queryKey: ['order-item-counts'] })
    toast('Line status updated', 'success')
  }

  // Required-by urgency
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const reqDiff = order.required_by_date
    ? Math.round((new Date(order.required_by_date).getTime() - today.getTime()) / 86400000)
    : null

  const projectName      = lookupName(projects, order.project_id, 'project_name')
  const procOfficerName  = lookupName(staff, order.staff_id, 'employee_name')
  const requestedByName  = profileName((order as any).requested_by_user_id)
  const vendorName       = lookupName(vendors, order.recommended_vendor_id, 'vendor_name')
  const unfilledCount = items.filter(i => i.status === 'unfulfilled').length

  return (
    <div className="space-y-4">

      {/* Top bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <Link to="/purchase-requests"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand transition-colors">
          <ArrowLeft className="h-4 w-4" />Purchase Requests
        </Link>
        <Link to={`/purchase-requests/${order.id}/edit`}
          className="inline-flex items-center gap-1.5 rounded-md border dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:border-brand hover:text-brand transition-colors shadow-sm">
          <Pencil className="h-3.5 w-3.5" />Edit Request
        </Link>
      </div>

      {/* Hero card */}
      <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            {order.request_code && (
              <div className="flex items-center gap-2 mb-1.5">
                <span className="font-mono text-sm font-bold text-brand tracking-wider">{order.request_code}</span>
                <button
                  onClick={() => { navigator.clipboard.writeText(order.request_code!); toast('Copied to clipboard', 'success') }}
                  className="rounded p-0.5 text-slate-400 hover:text-brand hover:bg-brand/10 transition-colors"
                  title="Copy code">
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 leading-snug">
              {order.order_name || 'Untitled Request'}
            </h1>
            {order.item_service_description && (
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                {order.item_service_description}
              </p>
            )}
          </div>

          {/* Status chips */}
          <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
            {order.is_new_item && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700/50 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                <Zap className="h-3 w-3" />Market search
              </span>
            )}
            {order.priority && order.priority !== 'normal' && (
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
                order.priority === 'critical'
                  ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                  : 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
              }`}>
                {order.priority === 'critical'
                  ? <AlertCircle className="h-3 w-3" />
                  : <AlertTriangle className="h-3 w-3" />}
                {order.priority === 'critical' ? 'Critical' : 'Urgent'}
              </span>
            )}
            <StatusBadge status={approvalStatus} />
          </div>
        </div>

        {/* Required-by row */}
        {reqDiff !== null && (
          <div className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ${
            reqDiff < 0
              ? 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'
              : reqDiff <= 3
              ? 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400'
              : 'bg-slate-50 text-slate-500 dark:bg-slate-700/40'
          }`}>
            <Calendar className="h-4 w-4" />
            {reqDiff < 0
              ? `${Math.abs(reqDiff)} day${Math.abs(reqDiff) !== 1 ? 's' : ''} overdue`
              : reqDiff === 0 ? 'Required today'
              : reqDiff === 1 ? 'Required tomorrow'
              : `Required in ${reqDiff} days · ${formatDate(order.required_by_date)}`}
          </div>
        )}
      </div>

      {/* Metadata strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { icon: <Building2 className="h-4 w-4" />, label: 'Project',              value: projectName },
          { icon: <User className="h-4 w-4" />,      label: 'Requested By',         value: requestedByName ?? '—' },
          { icon: <User className="h-4 w-4" />,      label: 'Procurement Officer',  value: procOfficerName },
          { icon: <Calendar className="h-4 w-4" />,  label: 'Submitted',            value: formatDate(order.created_at) ?? '—' },
        ].map(m => (
          <div key={m.label} className="flex items-center gap-3 rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 shadow-sm">
            <div className="rounded-lg bg-slate-100 dark:bg-slate-700 p-2 text-slate-500 flex-shrink-0">{m.icon}</div>
            <div className="min-w-0">
              <p className="text-[10px] text-slate-400 uppercase tracking-wide font-medium">{m.label}</p>
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">{m.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Approval workflow panel */}
      <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm space-y-5">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Approval Workflow</p>

        {/* Stepper */}
        <div>
          <div className="flex items-center px-4">
            <StepDot status="done" />
            <div className={`flex-1 h-0.5 transition-colors ${line1Cls}`} />
            <StepDot status={step2} />
            <div className={`flex-1 h-0.5 transition-colors ${line2Cls}`} />
            <StepDot status={step3} />
          </div>

          <div className="flex mt-3 px-4">
            {/* Step 1 */}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Submitted</p>
              <p className="text-[11px] text-green-600 dark:text-green-400">Recorded</p>
              <p className="text-[10px] text-slate-400 mt-0.5">{formatDate(order.created_at) ?? '—'}</p>
            </div>

            {/* Step 2 */}
            <div className="flex-1 min-w-0 text-center">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Manager Review</p>
              <p className={`text-[11px] ${
                step2 === 'done'     ? 'text-green-600 dark:text-green-400'  :
                step2 === 'rejected' ? 'text-red-500 dark:text-red-400'      :
                step2 === 'active'   ? 'text-amber-600 dark:text-amber-400'  :
                                       'text-slate-400'
              }`}>
                {step2 === 'done'     ? (profileName(order.manager_approved_by) ?? 'Approved') :
                 step2 === 'rejected' ? 'Rejected'       :
                 step2 === 'active'   ? 'Awaiting review' : '—'}
              </p>
              {order.manager_approved_at && step2 === 'done' && (
                <p className="text-[10px] text-slate-400 mt-0.5">{formatDate(order.manager_approved_at)}</p>
              )}
            </div>

            {/* Step 3 */}
            <div className="flex-1 min-w-0 text-right">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Finance Review</p>
              <p className={`text-[11px] ${
                step3 === 'done'     ? 'text-green-600 dark:text-green-400'  :
                step3 === 'rejected' ? 'text-red-500 dark:text-red-400'      :
                step3 === 'active'   ? 'text-amber-600 dark:text-amber-400'  :
                                       'text-slate-400'
              }`}>
                {step3 === 'done'     ? (profileName(order.finance_approved_by) ?? 'Approved') :
                 step3 === 'rejected' ? 'Rejected'        :
                 step3 === 'active'   ? 'Awaiting review' : '—'}
              </p>
              {order.finance_approved_at && step3 === 'done' && (
                <p className="text-[10px] text-slate-400 mt-0.5">{formatDate(order.finance_approved_at)}</p>
              )}
            </div>
          </div>
        </div>

        {/* Rejection notice */}
        {approvalStatus === 'rejected' && order.rejection_reason && (
          <div className="flex items-start gap-2.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/40 p-3.5">
            <XCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-red-700 dark:text-red-400 mb-0.5">Rejection reason</p>
              <p className="text-sm text-red-600 dark:text-red-300">{order.rejection_reason}</p>
            </div>
          </div>
        )}

        {/* Approval action buttons */}
        {(showManagerAct || showFinanceAct) && !rejecting && (
          <div className="flex gap-2 pt-1 border-t dark:border-slate-700">
            <button
              onClick={() => handleApproval(showFinanceAct ? 'finance_approved' : 'manager_approved')}
              className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors shadow-sm">
              {showFinanceAct ? 'Final Approval' : 'Approve'}
            </button>
            <button
              onClick={() => setRejecting(true)}
              className="rounded-md bg-white dark:bg-slate-700 border dark:border-slate-600 px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
              Reject
            </button>
          </div>
        )}

        {/* Rejection form */}
        {(showManagerAct || showFinanceAct) && rejecting && (
          <div className="space-y-2.5 pt-1 border-t dark:border-slate-700">
            <p className="text-xs text-slate-500 dark:text-slate-400">Enter a reason so the requester knows what to fix:</p>
            <textarea rows={2} className={inputCls} placeholder="Rejection reason (required)…"
              value={rejectionReason} onChange={e => setRejectionReason(e.target.value)} autoFocus />
            <div className="flex gap-2">
              <button
                disabled={!rejectionReason.trim()}
                onClick={() => handleApproval('rejected', { rejection_reason: rejectionReason })}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors">
                Confirm Rejection
              </button>
              <button
                onClick={() => { setRejecting(false); setRejectionReason('') }}
                className="rounded-md border dark:border-slate-600 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Resubmit */}
        {canResubmit && (
          <div className="pt-1 border-t dark:border-slate-700">
            <button
              onClick={() => handleApproval('pending', { rejection_reason: null })}
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 transition-colors shadow-sm">
              Resubmit for Approval
            </button>
          </div>
        )}
      </div>

      {/* Line items */}
      <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden shadow-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Line Items
            <span className="ml-2 text-xs font-normal text-slate-400">{items.length} item{items.length !== 1 ? 's' : ''}</span>
          </p>
          {unfilledCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700/40 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
              <AlertCircle className="h-3 w-3" />{unfilledCount} unfulfilled
            </span>
          )}
        </div>

        {items.length === 0 ? (
          <div className="py-12 text-center">
            <Package className="mx-auto h-6 w-6 text-slate-300 mb-2" />
            <p className="text-sm text-slate-400">No line items on this request.</p>
          </div>
        ) : (
          <>
            {/* Column headers */}
            <div className="hidden sm:flex items-center gap-3 px-4 py-2 bg-slate-50 dark:bg-slate-700/30 border-b dark:border-slate-700">
              <span className="w-6 text-[10px] text-slate-400 font-bold">#</span>
              <span className="flex-1 text-[10px] text-slate-400 font-bold uppercase tracking-wider">Item</span>
              <span className="w-28 text-[10px] text-slate-400 font-bold uppercase tracking-wider text-right">Qty</span>
              <span className="w-28 text-[10px] text-slate-400 font-bold uppercase tracking-wider text-right">Est. Price</span>
              <span className="w-32 text-[10px] text-slate-400 font-bold uppercase tracking-wider text-right">Status</span>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {items.map((item, idx) => {
                const st = ITEM_S[item.status] ?? ITEM_S.pending
                const isExpanded = expanded.has(item.id)
                return (
                  <div key={item.id} className={`border-l-4 ${st.border} transition-all`}>
                    <div className="flex items-center gap-3 px-4 py-3">
                      <span className="flex-shrink-0 text-xs text-slate-400 font-mono w-6 text-center">{idx + 1}</span>

                      {/* Name + specs toggle */}
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${
                          item.status === 'cancelled'
                            ? 'line-through text-slate-400'
                            : 'text-slate-800 dark:text-slate-100'
                        }`}>
                          {item.item_name}
                        </p>
                        {item.specifications && (
                          <button
                            onClick={() => toggleExpand(item.id)}
                            className="mt-0.5 inline-flex items-center gap-0.5 text-[11px] text-slate-400 hover:text-brand transition-colors">
                            {isExpanded
                              ? <><ChevronDown className="h-3 w-3" />Hide specs</>
                              : <><ChevronRight className="h-3 w-3" />Show specs</>}
                          </button>
                        )}
                      </div>

                      {/* Qty + Unit */}
                      <div className="flex-shrink-0 text-right w-28">
                        {item.quantity
                          ? <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                              {item.quantity} <span className="text-xs font-normal text-slate-400">{item.unit}</span>
                            </p>
                          : <p className="text-xs text-slate-300">—</p>
                        }
                      </div>

                      {/* Est price */}
                      <div className="flex-shrink-0 text-right w-28 hidden sm:block">
                        {item.unit_price_est
                          ? <p className="text-sm text-slate-600 dark:text-slate-300">
                              {Number(item.unit_price_est).toLocaleString()} ETB
                            </p>
                          : <p className="text-xs text-slate-300">—</p>
                        }
                      </div>

                      {/* Status: select for authorized, badge for others */}
                      {canUpdateItems ? (
                        <select
                          value={item.status}
                          onChange={e => handleItemStatus(item.id, e.target.value as OrderItemStatus)}
                          className="flex-shrink-0 w-32 rounded-md border dark:border-slate-600 px-2 py-1 text-xs outline-none bg-white dark:bg-slate-800 focus:ring-2 focus:ring-brand text-slate-600 dark:text-slate-300 cursor-pointer">
                          {ALL_STATUSES.map(s => (
                            <option key={s} value={s}>{ITEM_S[s].label}</option>
                          ))}
                        </select>
                      ) : (
                        <span className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${st.bg}`}>
                          {st.label}
                        </span>
                      )}
                    </div>

                    {/* Expanded specs */}
                    {isExpanded && item.specifications && (
                      <div className="px-4 pb-3 pl-12">
                        <p className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-700/40 rounded-lg px-3 py-2 leading-relaxed">
                          {item.specifications}
                        </p>
                      </div>
                    )}

                    {/* Fulfillment notes */}
                    {item.fulfillment_notes && item.status !== 'pending' && (
                      <div className="px-4 pb-3 pl-12">
                        <p className="text-xs text-slate-400 dark:text-slate-500 italic">{item.fulfillment_notes}</p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Unfulfilled warning */}
            {unfilledCount > 0 && (
              <div className="flex items-start gap-2.5 m-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 p-3">
                <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  {unfilledCount} line item{unfilledCount !== 1 ? 's' : ''} could not be sourced.
                  A new purchase request should be created for the remainder, or mark as cancelled if no longer needed.
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Notes + vendor context */}
      {(order.notes || order.vendor_recommendation) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {order.notes && (
            <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Notes</p>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">{order.notes}</p>
            </div>
          )}
          {order.vendor_recommendation && (
            <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Vendor Notes</p>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{order.vendor_recommendation}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
