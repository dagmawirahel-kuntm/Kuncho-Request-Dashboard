import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { TrainerHintBanner } from '@/components/shared/TrainerHintBanner'
import { resolveHint } from '@/lib/trainerHints'
import type { Order, OrderItem, OrderItemStatus, FinanceSourcingReview } from '@/types/database'
import { useProjects, useStaff, useUserProfiles } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { canApproveAsExecutive, canApproveAsFinance } from '@/lib/expenseAccess'
import { formatDate, formatCurrency } from '@/lib/utils'
import {
  ArrowLeft, Pencil, CheckCircle2, Clock, XCircle, Building2,
  User, Calendar, AlertCircle, AlertTriangle, Package,
  ChevronDown, ChevronRight, Zap, Copy, Receipt, Wallet,
} from 'lucide-react'

type OrderItemWithCostGroup = OrderItem & {
  sub_categories: { parent_category_id: string | null; categories: { cost_group_id: string | null } | null } | null
}

const ITEM_S: Record<OrderItemStatus, { label: string; bg: string; border: string }> = {
  pending:                { label: 'Pending',       bg: 'text-slate-500 bg-slate-100 dark:bg-slate-700',         border: 'border-l-slate-300 dark:border-l-slate-500' },
  sourced:                { label: 'Sourced',       bg: 'text-green-700 bg-green-50 dark:bg-green-900/30',       border: 'border-l-green-400' },
  partially_sourced:      { label: 'Partial',       bg: 'text-amber-700 bg-amber-50 dark:bg-amber-900/30',       border: 'border-l-amber-400' },
  stock_pending_dispatch: { label: 'Stock — Pending Dispatch', bg: 'text-sky-700 bg-sky-50 dark:bg-sky-900/30',  border: 'border-l-sky-400' },
  stock_fulfilled:        { label: 'Stock',         bg: 'text-emerald-700 bg-emerald-50 dark:bg-emerald-900/30', border: 'border-l-emerald-400' },
  unfulfilled:            { label: 'Unfulfilled',   bg: 'text-red-700 bg-red-50 dark:bg-red-900/30',             border: 'border-l-red-400' },
  cancelled:              { label: 'Cancelled',     bg: 'text-slate-400 bg-slate-50 dark:bg-slate-800',           border: 'border-l-slate-200 dark:border-l-slate-700' },
}

const ALL_STATUSES: OrderItemStatus[] = ['pending', 'sourced', 'partially_sourced', 'stock_pending_dispatch', 'stock_fulfilled', 'unfulfilled', 'cancelled']

const inputCls = 'w-full rounded-md border dark:border-slate-600 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:text-slate-100'

// ── Fulfillment — reads real per-line state instead of approval_status,
// which nothing has moved since the manager→finance ladder was retired
// (migrations 149/163). Mirrors the same read used on the list page.
const FULFILLED_ITEM_STATUSES = new Set<OrderItemStatus>(['sourced', 'stock_fulfilled'])
const PARTIAL_ITEM_STATUSES   = new Set<OrderItemStatus>(['partially_sourced', 'stock_pending_dispatch'])

type Fulfillment = { total: number; fulfilled: number; partial: number; blocked: number; reviewPending: number }

function FulfillmentChip({ order, f }: { order: Order; f: Fulfillment }) {
  const base = 'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold'
  if (order.approval_status === 'rejected') {
    return <span className={`${base} bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400`}><XCircle className="h-3.5 w-3.5" />Rejected</span>
  }
  if (f.blocked > 0) {
    return <span className={`${base} bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400`}><AlertTriangle className="h-3.5 w-3.5" />Needs attention</span>
  }
  if (f.reviewPending > 0) {
    return <span className={`${base} bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400`}><Wallet className="h-3.5 w-3.5" />Awaiting finance</span>
  }
  if (f.total > 0 && f.fulfilled === f.total) {
    return <span className={`${base} bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400`}><CheckCircle2 className="h-3.5 w-3.5" />Fulfilled</span>
  }
  if (f.fulfilled > 0 || f.partial > 0) {
    return <span className={`${base} bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400`}><Clock className="h-3.5 w-3.5" />Sourcing &middot; {f.fulfilled + f.partial}/{f.total}</span>
  }
  return <span className={`${base} bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400`}><Clock className="h-3.5 w-3.5" />{f.total > 0 ? 'Not started' : 'No items yet'}</span>
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
        .from('order_items')
        .select('*, sub_categories(parent_category_id, categories(cost_group_id))')
        .eq('order_id', id!).order('sort_order')
      if (error) throw error
      return data as unknown as OrderItemWithCostGroup[]
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
function DetailContent({ order, items }: { order: Order; items: OrderItemWithCostGroup[] }) {
  const { role } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data: projects = [] }     = useProjects()
  const { data: staff = [] }        = useStaff()
  const { data: userProfiles = [] } = useUserProfiles()

  const [rejecting, setRejecting]         = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')
  const [expanded, setExpanded]           = useState<Set<string>>(new Set())

  // ── Finance sourcing review (147) — the "should we pursue this"
  // gate between stock check and sourcing bundle creation, distinct
  // from the manager/finance approval above (which answers "release
  // this payment"). §3/§4: any finance role holder can act, no
  // identity lock and no separate escalation tier.
  const itemIds = useMemo(() => items.map(i => i.id), [items])
  const canReviewSourcing = role === 'admin' || role === 'finance'

  const { data: sourcingReviews = [] } = useQuery({
    queryKey: ['finance-sourcing-reviews', order.id],
    queryFn: async () => {
      if (itemIds.length === 0) return []
      const { data, error } = await supabase.from('finance_sourcing_reviews').select('*').in('order_item_id', itemIds)
      if (error) throw error
      return data as FinanceSourcingReview[]
    },
    enabled: itemIds.length > 0,
  })
  const reviewByItem = useMemo(() => new Map(sourcingReviews.map(r => [r.order_item_id, r])), [sourcingReviews])

  const fulfillment: Fulfillment = useMemo(() => {
    const relevant = items.filter(i => i.status !== 'cancelled')
    return {
      total:         relevant.length,
      fulfilled:     relevant.filter(i => FULFILLED_ITEM_STATUSES.has(i.status)).length,
      partial:       relevant.filter(i => PARTIAL_ITEM_STATUSES.has(i.status)).length,
      blocked:       relevant.filter(i => i.status === 'unfulfilled').length,
      reviewPending: sourcingReviews.filter(r => r.status === 'pending').length,
    }
  }, [items, sourcingReviews])

  // Trainer hint: has any of this order's items already been bundled into a
  // sourcing bundle (this codebase's PO).
  const { data: hasBundle } = useQuery({
    queryKey: ['order-has-bundle', order.id],
    queryFn: async () => {
      if (itemIds.length === 0) return false
      const { count, error } = await supabase.from('sourcing_bundle_items').select('id', { count: 'exact', head: true }).in('order_item_id', itemIds)
      if (error) throw error
      return (count ?? 0) > 0
    },
    enabled: itemIds.length > 0,
  })
  const orderHint = useMemo(() => {
    if (hasBundle === undefined) return null
    const unsourced = items.some(i => i.status === 'pending' || i.status === 'partially_sourced')
    return resolveHint({
      entityType: 'purchase_request',
      id: order.id,
      approvalStatus: order.approval_status,
      hasItems: items.length > 0,
      hasPendingItems: unsourced,
      allItemsResolved: items.length > 0 && !unsourced,
      hasBundle: !!hasBundle,
    })
  }, [order, items, hasBundle])

  const { data: costGroupBudgets = [] } = useQuery({
    queryKey: ['cost-group-remaining', order.project_id],
    queryFn: async () => {
      if (!order.project_id) return []
      const { data, error } = await supabase
        .from('v_project_cost_group_budget')
        .select('cost_group_id, cost_group_name, remaining_amount')
        .eq('project_id', order.project_id)
      if (error) throw error
      return data
    },
    enabled: !!order.project_id,
  })
  const costGroupById = useMemo(() => {
    const m = new Map<string, { name: string; remaining: number }>()
    for (const g of costGroupBudgets) {
      if (g.cost_group_id) m.set(g.cost_group_id, { name: g.cost_group_name, remaining: g.remaining_amount })
    }
    return m
  }, [costGroupBudgets])

  async function handleFinanceReviewDecision(orderItemId: string, decision: 'approved' | 'rejected') {
    const { error } = await supabase.from('finance_sourcing_reviews').update({ status: decision }).eq('order_item_id', orderItemId)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['finance-sourcing-reviews', order.id] })
    toast(decision === 'approved' ? 'Cleared for sourcing' : 'Rejected — will not be sourced', 'success')
  }

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
  // The PR approval ladder was retired in migrations 149/163 (Operations
  // Manual v0.1 §4.1 has no PR approval step; 163 dropped the enforcing
  // trigger, so approval_status now gates nothing). What remains is a
  // simple "don't source this" switch: rejected requests are excluded
  // from the sourcing bundle builder, and can be reopened.
  const canCancelRequest = canApproveAsExecutive(role) || canApproveAsFinance(role)
  const canCreate        = role !== 'procurement_officer'
  const canUpdateItems   = role === 'admin' || role === 'executive' || role === 'procurement_officer'

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
  const unfilledCount = items.filter(i => i.status === 'unfulfilled').length

  return (
    <div className="space-y-4">

      {/* Top bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <Link to="/purchase-requests"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand transition-colors">
          <ArrowLeft className="h-4 w-4" />Purchase Requests
        </Link>
        {canCreate && (
          <Link to={`/purchase-requests/${order.id}/edit`}
            className="inline-flex items-center gap-1.5 rounded-md border dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:border-brand hover:text-brand transition-colors shadow-sm">
            <Pencil className="h-3.5 w-3.5" />Edit Request
          </Link>
        )}
      </div>

      <TrainerHintBanner entityType="purchase_request" entityId={order.id} hint={orderHint} />

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
            <FulfillmentChip order={order} f={fulfillment} />
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

      {/* Fulfillment panel — replaces the dead approval-ladder stepper.
          approval_status stopped moving once the manager→finance ladder
          was retired (migrations 149/163); this reads the same real
          signal the list page does: each line's own status plus finance
          sourcing review, both of which are live below. */}
      <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Fulfillment</p>
          <FulfillmentChip order={order} f={fulfillment} />
        </div>

        {approvalStatus !== 'rejected' && fulfillment.total > 0 && (() => {
          const rest = fulfillment.total - fulfillment.fulfilled - fulfillment.partial - fulfillment.blocked
          const seg = (n: number) => `${Math.max((n / fulfillment.total) * 100, n > 0 ? 4 : 0)}%`
          return (
            <div className="space-y-2">
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                {fulfillment.fulfilled > 0 && <span className="h-full bg-green-500" style={{ width: seg(fulfillment.fulfilled) }} />}
                {fulfillment.partial > 0   && <span className="h-full bg-sky-500"   style={{ width: seg(fulfillment.partial) }} />}
                {rest > 0                  && <span className="h-full"              style={{ width: seg(rest) }} />}
                {fulfillment.blocked > 0   && <span className="h-full bg-red-500"   style={{ width: seg(fulfillment.blocked) }} />}
              </div>
              <div className="flex items-center gap-3 flex-wrap text-[11px] text-slate-500 dark:text-slate-400">
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-green-500" />{fulfillment.fulfilled} sourced</span>
                {fulfillment.partial > 0 && <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-sky-500" />{fulfillment.partial} partial</span>}
                {rest > 0 && <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-slate-300 dark:bg-slate-600" />{rest} waiting</span>}
                {fulfillment.blocked > 0 && (
                  <span className="flex items-center gap-1 font-medium text-red-600 dark:text-red-400"><span className="h-1.5 w-1.5 rounded-full bg-red-500" />{fulfillment.blocked} stuck</span>
                )}
                {fulfillment.reviewPending > 0 && (
                  <span className="flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400"><Wallet className="h-3 w-3" />{fulfillment.reviewPending} awaiting finance</span>
                )}
              </div>
            </div>
          )
        })()}

        {/* Historical approval record — only the handful of requests
            approved under the old ladder before it was retired show
            anything here. */}
        {(order.manager_approved_by || order.finance_approved_by) && (
          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            {order.manager_approved_by && (
              <>Approved by {profileName(order.manager_approved_by) ?? '—'}{order.manager_approved_at ? ` on ${formatDate(order.manager_approved_at)}` : ''} under the previous approval process.{order.finance_approved_by ? ' ' : ''}</>
            )}
            {order.finance_approved_by && (
              <>Finance-approved by {profileName(order.finance_approved_by) ?? '—'}{order.finance_approved_at ? ` on ${formatDate(order.finance_approved_at)}` : ''}.</>
            )}
          </p>
        )}

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

        {approvalStatus !== 'rejected' && canCancelRequest && !rejecting && (
          <div className="flex gap-2 pt-1 border-t dark:border-slate-700">
            <button
              onClick={() => setRejecting(true)}
              className="rounded-md bg-white dark:bg-slate-700 border dark:border-slate-600 px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
              Reject — don't source this
            </button>
          </div>
        )}

        {/* Rejection form */}
        {canCancelRequest && rejecting && (
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

        {/* Reopen a rejected request so it can be sourced again */}
        {approvalStatus === 'rejected' && canCancelRequest && (
          <div className="pt-1 border-t dark:border-slate-700">
            <button
              onClick={() => handleApproval('pending', { rejection_reason: null })}
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 transition-colors shadow-sm">
              Reopen Request
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
              <span className="w-28 text-[10px] text-slate-400 font-bold uppercase tracking-wider text-right">Expense</span>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {items.map((item, idx) => {
                const st = ITEM_S[item.status] ?? ITEM_S.pending
                const isExpanded = expanded.has(item.id)
                return (
                  <div key={item.id} className={`border-l-4 ${st.border} transition-all`}>
                    <div className="flex items-center gap-3 px-4 py-3">
                      <span className="flex-shrink-0 text-xs text-slate-400 font-mono w-6 text-center">{idx + 1}</span>

                      {/* Name + specs toggle + market check badge */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className={`text-sm font-medium ${
                            item.status === 'cancelled'
                              ? 'line-through text-slate-400'
                              : 'text-slate-800 dark:text-slate-100'
                          }`}>
                            {item.item_name}
                          </p>
                          {(item as any).needs_market_check && (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700/40 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400 flex-shrink-0">
                              <Zap className="h-2.5 w-2.5" />Check price
                            </span>
                          )}
                        </div>
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

                      {/* Create Expense link (procurement officer / admin) */}
                      {canUpdateItems && item.status !== 'cancelled' && (
                        <Link
                          to={`/expenses/new?pr_id=${order.id}&line_id=${item.id}`}
                          title="Create expense for this line item"
                          className="flex-shrink-0 w-28 inline-flex items-center justify-end gap-1 text-xs text-brand hover:underline">
                          <Receipt className="h-3.5 w-3.5" />Create expense
                        </Link>
                      )}
                      {(!canUpdateItems || item.status === 'cancelled') && (
                        <span className="flex-shrink-0 w-28" />
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

                    {/* Finance sourcing review — a separate gate from
                        the manager/finance approval above; this one
                        answers "should we pursue sourcing this line,"
                        not "release this payment" (147). */}
                    {(() => {
                      const review = reviewByItem.get(item.id)
                      if (!review) return null
                      const costGroupId = item.sub_categories?.categories?.cost_group_id ?? null
                      const budgetInfo = costGroupId ? costGroupById.get(costGroupId) : undefined
                      if (review.status === 'exempt') {
                        return (
                          <div className="px-4 pb-3 pl-12">
                            <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                              <Wallet className="h-3 w-3" />Finance review not needed — below the budget threshold
                            </span>
                          </div>
                        )
                      }
                      if (review.status === 'approved' || review.status === 'rejected') {
                        return (
                          <div className="px-4 pb-3 pl-12">
                            <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${review.status === 'approved' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                              <Wallet className="h-3 w-3" />
                              Finance {review.status === 'approved' ? 'cleared for sourcing' : 'rejected — will not be sourced'}
                              {review.reviewed_by && ` · ${profileName(review.reviewed_by)}`}
                              {review.reviewed_at && ` · ${formatDate(review.reviewed_at)}`}
                            </span>
                          </div>
                        )
                      }
                      // pending
                      return (
                        <div className="mx-4 mb-3 ml-12 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 p-3 space-y-2">
                          <p className="text-xs font-medium text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                            <Wallet className="h-3.5 w-3.5" />Finance review needed before this can be sourced
                          </p>
                          {budgetInfo ? (
                            <p className="text-[11px] text-amber-600 dark:text-amber-400">
                              {formatCurrency(budgetInfo.remaining)} remaining in {budgetInfo.name} for this project
                            </p>
                          ) : (
                            <p className="text-[11px] text-amber-600 dark:text-amber-400">Budget context unavailable for this line's cost group</p>
                          )}
                          {canReviewSourcing && (
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleFinanceReviewDecision(item.id, 'approved')}
                                className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 transition-colors">
                                Approve Sourcing
                              </button>
                              <button
                                onClick={() => handleFinanceReviewDecision(item.id, 'rejected')}
                                className="rounded-md bg-white dark:bg-slate-700 border dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                                Reject
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    })()}
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
