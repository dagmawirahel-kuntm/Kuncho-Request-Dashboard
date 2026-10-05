import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { TrainerHintBanner } from '@/components/shared/TrainerHintBanner'
import { resolveHint } from '@/lib/trainerHints'
import type { Order, OrderItem, OrderItemStatus, SourcingBundleStatus } from '@/types/database'
import { PO_STATUS, priceOverEstimate } from '@/lib/purchasing'
import { useProjects, useStaff, useUserProfiles } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { canApproveAsExecutive, canApproveAsFinance } from '@/lib/expenseAccess'
import { formatDate } from '@/lib/utils'
import { FactList, Panel, Pill, RecordHeader, RecordLayout } from '@/components/record/Record'
import { useCompanyProfile } from '@/lib/companyProfile'
import { printHtml } from '@/lib/documents/issue'
import { buildPurchaseRequestHtml } from '@/lib/documents/purchaseRequestDocument'
import {
  ArrowLeft, Pencil, CheckCircle2, Clock, XCircle, Building2,
  User, Calendar, AlertCircle, AlertTriangle, Package,
  ChevronDown, ChevronRight, Zap, Receipt, StickyNote, Store, ClipboardList, Printer, Truck, TrendingUp,
} from 'lucide-react'
import { useMarkEntityRead } from '@/lib/notifications'

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

type PoLine = {
  order_item_id: string
  quantity_actual: number | null
  unit_price_actual: number | null
  sourcing_bundles: {
    id: string; bundle_code: string; status: SourcingBundleStatus; vendor_name: string | null
    expected_delivery_date: string | null; vendors: { vendor_name: string } | null
  } | null
}

type Fulfillment = { total: number; fulfilled: number; partial: number; blocked: number }

function FulfillmentChip({ order, f }: { order: Order; f: Fulfillment }) {
  const base = 'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold'
  if (order.approval_status === 'rejected') {
    return <span className={`${base} bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400`}><XCircle className="h-3.5 w-3.5" />Rejected</span>
  }
  if (f.blocked > 0) {
    return <span className={`${base} bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400`}><AlertTriangle className="h-3.5 w-3.5" />Needs attention</span>
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
  // Opening the purchase request reads its notifications.
  useMarkEntityRead(id)

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
        .select('*')
        .eq('order_id', id!).order('sort_order')
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
  const { data: userProfiles = [] } = useUserProfiles()
  // The letterhead for the printed request.
  useCompanyProfile()

  const [rejecting, setRejecting]         = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')
  const [expanded, setExpanded]           = useState<Set<string>>(new Set())

  // Finance sourcing review (147) was retired as a gate — see migration
  // 226. It made the PR → sourcing process too tight, so purchase
  // requests no longer generate or read review rows; fulfillment below
  // reads only each line's own status.
  const itemIds = useMemo(() => items.map(i => i.id), [items])

  const fulfillment: Fulfillment = useMemo(() => {
    const relevant = items.filter(i => i.status !== 'cancelled')
    return {
      total:     relevant.length,
      fulfilled: relevant.filter(i => FULFILLED_ITEM_STATUSES.has(i.status)).length,
      partial:   relevant.filter(i => PARTIAL_ITEM_STATUSES.has(i.status)).length,
      blocked:   relevant.filter(i => i.status === 'unfulfilled').length,
    }
  }, [items])

  // The purchase orders this request's lines went onto — for each line's
  // "on PO-…" and the list in the side rail. Also answers the trainer hint's
  // "has any of it been put on a PO yet".
  const { data: poLines } = useQuery({
    queryKey: ['order-po-lines', order.id, itemIds],
    queryFn: async () => {
      if (itemIds.length === 0) return [] as PoLine[]
      const { data, error } = await supabase.from('sourcing_bundle_items')
        .select('order_item_id, quantity_actual, unit_price_actual, sourcing_bundles(id, bundle_code, status, vendor_name, expected_delivery_date, vendors(vendor_name))')
        .in('order_item_id', itemIds)
      if (error) throw error
      return (data ?? []) as unknown as PoLine[]
    },
    enabled: itemIds.length > 0,
  })
  const hasBundle = poLines === undefined ? undefined : poLines.length > 0
  const poByItem = useMemo(() => new Map((poLines ?? []).filter(l => l.sourcing_bundles).map(l => [l.order_item_id, l])), [poLines])
  const purchaseOrders = useMemo(() => {
    const m = new Map<string, { po: NonNullable<PoLine['sourcing_bundles']>; lines: number; value: number }>()
    for (const l of poLines ?? []) {
      if (!l.sourcing_bundles) continue
      const e = m.get(l.sourcing_bundles.id) ?? { po: l.sourcing_bundles, lines: 0, value: 0 }
      e.lines++
      e.value += Number(l.quantity_actual ?? 0) * Number(l.unit_price_actual ?? 0)
      m.set(l.sourcing_bundles.id, e)
    }
    return [...m.values()]
  }, [poLines])
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

  // The request as a page, in the same frame as the purchase order it becomes.
  function printRequest() {
    printHtml(buildPurchaseRequestHtml({
      code: order.request_code, title: order.order_name || 'Purchase request', description: order.item_service_description,
      projectName: order.project_id ? projectName : null, requestedBy: requestedByName, procurementOfficer: order.staff_id ? procOfficerName : null,
      neededBy: order.required_by_date, priority: order.priority, submitted: order.created_at,
      notes: order.notes, vendorNotes: order.vendor_recommendation,
      rejected: approvalStatus === 'rejected' ? { reason: order.rejection_reason ?? null } : null,
      lines: items.map(i => ({ name: i.item_name, specifications: i.specifications, quantity: i.quantity, unit: i.unit, estUnitPrice: i.unit_price_est, status: `${(ITEM_S[i.status] ?? ITEM_S.pending).label}${poByItem.get(i.id)?.sourcing_bundles ? ` · ${poByItem.get(i.id)!.sourcing_bundles!.bundle_code}` : ''}` })),
    }), `${order.request_code ?? 'Purchase request'} - ${order.order_name ?? ''}`.trim())
  }

  const rest = fulfillment.total - fulfillment.fulfilled - fulfillment.partial - fulfillment.blocked
  const seg = (n: number) => `${Math.max((n / Math.max(fulfillment.total, 1)) * 100, n > 0 ? 4 : 0)}%`
  const dueTone: 'red' | 'amber' | undefined = reqDiff == null ? undefined : reqDiff < 0 ? 'red' : reqDiff <= 3 ? 'amber' : undefined
  const dueText = reqDiff == null ? null
    : reqDiff < 0 ? `${Math.abs(reqDiff)} day${Math.abs(reqDiff) !== 1 ? 's' : ''} overdue`
    : reqDiff === 0 ? 'Needed today' : reqDiff === 1 ? 'Needed tomorrow' : `Needed in ${reqDiff} days`

  return (
    <div className="pb-20 sm:pb-0">
      <RecordHeader
        back={{ to: '/purchase-requests', label: 'Purchase requests' }}
        code={order.request_code}
        title={order.order_name || 'Untitled request'}
        subtitle={order.item_service_description}
        pills={<>
          <FulfillmentChip order={order} f={fulfillment} />
          {order.priority === 'critical' && <Pill tone="red" icon={AlertCircle}>Critical</Pill>}
          {order.priority && order.priority !== 'normal' && order.priority !== 'critical' && <Pill tone="amber" icon={AlertTriangle}>Urgent</Pill>}
          {order.is_new_item && <Pill tone="amber" icon={Zap}>Market search</Pill>}
        </>}
        meta={[
          { icon: Building2, value: projectName },
          ...(dueText ? [{ icon: Calendar, value: `${dueText} · ${formatDate(order.required_by_date)}`, tone: dueTone }] : []),
          { icon: User, value: requestedByName ?? '—' },
        ]}
        actions={[
          { label: 'Reopen request', onClick: () => handleApproval('pending', { rejection_reason: null }), primary: true, hidden: !(approvalStatus === 'rejected' && canCancelRequest) },
          { label: 'Print', icon: Printer, onClick: printRequest },
          { label: 'Edit', icon: Pencil, to: `/purchase-requests/${order.id}/edit`, hidden: !canCreate },
          { label: "Reject — don't source", icon: XCircle, onClick: () => setRejecting(true), danger: true, hidden: !(approvalStatus !== 'rejected' && canCancelRequest) },
        ]}
      />

      <div className="space-y-4">
        <TrainerHintBanner entityType="purchase_request" entityId={order.id} hint={orderHint} />

        {approvalStatus === 'rejected' && order.rejection_reason && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3.5 dark:border-red-700/40 dark:bg-red-900/20">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
            <div>
              <p className="text-xs font-semibold text-red-700 dark:text-red-400">Rejected — not to be sourced</p>
              <p className="text-sm text-red-600 dark:text-red-300">{order.rejection_reason}</p>
            </div>
          </div>
        )}

        {canCancelRequest && rejecting && (
          <Panel title="Reject this request" icon={XCircle}>
            <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">Say why, so the requester knows what to fix:</p>
            <textarea rows={2} className={inputCls} placeholder="Reason (required)…" value={rejectionReason} onChange={e => setRejectionReason(e.target.value)} autoFocus />
            <div className="mt-2 flex gap-2">
              <button disabled={!rejectionReason.trim()} onClick={() => handleApproval('rejected', { rejection_reason: rejectionReason })}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">Confirm rejection</button>
              <button onClick={() => { setRejecting(false); setRejectionReason('') }}
                className="rounded-md border px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">Cancel</button>
            </div>
          </Panel>
        )}

        <RecordLayout
          main={<>
            <Panel title="Items" icon={Package} count={items.length} padded={false}
              action={unfilledCount > 0 && <Pill tone="red" icon={AlertCircle}>{unfilledCount} can't be sourced</Pill>}>
              {items.length === 0 ? (
                <div className="py-12 text-center">
                  <Package className="mx-auto mb-2 h-6 w-6 text-slate-300" />
                  <p className="text-sm text-slate-400">No items on this request.</p>
                </div>
              ) : (
                <>
                  <div className="hidden grid-cols-[2rem_minmax(0,1fr)_6rem_7rem_9rem] gap-3 border-b bg-slate-50 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 sm:grid dark:border-slate-700 dark:bg-slate-900/30">
                    <span>#</span><span>Item</span><span className="text-right">Qty</span><span className="text-right">Est. price</span><span className="text-right">Status</span>
                  </div>
                  <ul className="divide-y divide-slate-100 dark:divide-slate-700/60">
                    {items.map((item, idx) => {
                      const st = ITEM_S[item.status] ?? ITEM_S.pending
                      const isExpanded = expanded.has(item.id)
                      const cancelled = item.status === 'cancelled'
                      return (
                        <li key={item.id} className={`border-l-4 ${st.border}`}>
                          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1.5 px-4 py-3 sm:grid-cols-[2rem_minmax(0,1fr)_6rem_7rem_9rem] sm:items-center">
                            <span className="hidden font-mono text-xs text-slate-400 sm:block">{idx + 1}</span>
                            <div className="min-w-0">
                              <p className={`text-sm font-medium ${cancelled ? 'text-slate-400 line-through' : 'text-slate-800 dark:text-slate-100'}`}>
                                <span className="mr-1 font-mono text-xs text-slate-400 sm:hidden">{idx + 1}.</span>{item.item_name}
                              </p>
                              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
                                <span className="sm:hidden">{item.quantity ? `${item.quantity} ${item.unit ?? ''}` : 'no qty'}{item.unit_price_est ? ` · ${Number(item.unit_price_est).toLocaleString()} ETB each` : ''}</span>
                                {(item as { needs_market_check?: boolean }).needs_market_check && <span className="inline-flex items-center gap-0.5 text-amber-600"><Zap className="h-3 w-3" />Check price</span>}
                                {(() => {
                                  const pl = poByItem.get(item.id)
                                  if (!pl?.sourcing_bundles) return null
                                  const over = priceOverEstimate(item.unit_price_est, pl.unit_price_actual)
                                  return <>
                                    <Link to={`/sourcing/${pl.sourcing_bundles.id}`} className="inline-flex items-center gap-0.5 font-medium text-brand hover:underline"
                                      title={`${PO_STATUS[pl.sourcing_bundles.status]?.label ?? pl.sourcing_bundles.status}${pl.unit_price_actual ? ` · ${Number(pl.unit_price_actual).toLocaleString()} ETB each` : ''}`}>
                                      <Truck className="h-3 w-3" />On {pl.sourcing_bundles.bundle_code}
                                    </Link>
                                    {over != null && <span className="inline-flex items-center gap-0.5 font-medium text-amber-600 dark:text-amber-400" title="Ordered price against this line's estimate"><TrendingUp className="h-3 w-3" />{over}% over estimate</span>}
                                  </>
                                })()}
                                {item.specifications && (
                                  <button onClick={() => toggleExpand(item.id)} className="inline-flex items-center gap-0.5 hover:text-brand">
                                    {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}Specs
                                  </button>
                                )}
                                {canUpdateItems && !cancelled && (
                                  <Link to={`/expenses/new?pr_id=${order.id}&line_id=${item.id}`} className="inline-flex items-center gap-0.5 text-brand hover:underline">
                                    <Receipt className="h-3 w-3" />Create expense
                                  </Link>
                                )}
                              </div>
                            </div>
                            <span className="hidden text-right text-sm font-semibold text-slate-700 sm:block dark:text-slate-200">
                              {item.quantity ? <>{item.quantity} <span className="text-xs font-normal text-slate-400">{item.unit}</span></> : '—'}
                            </span>
                            <span className="hidden text-right text-sm text-slate-600 sm:block dark:text-slate-300">
                              {item.unit_price_est ? `${Number(item.unit_price_est).toLocaleString()}` : '—'}
                            </span>
                            <div className="row-span-2 flex justify-end sm:row-span-1">
                              {canUpdateItems ? (
                                <select value={item.status} onChange={e => handleItemStatus(item.id, e.target.value as OrderItemStatus)} aria-label="Line status"
                                  className="w-36 cursor-pointer rounded-md border bg-white px-2 py-1 text-xs text-slate-600 outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                  {ALL_STATUSES.map(s => <option key={s} value={s}>{ITEM_S[s].label}</option>)}
                                </select>
                              ) : (
                                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${st.bg}`}>{st.label}</span>
                              )}
                            </div>
                          </div>
                          {isExpanded && item.specifications && (
                            <p className="mx-4 mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500 sm:ml-12 dark:bg-slate-700/40 dark:text-slate-400">{item.specifications}</p>
                          )}
                          {item.fulfillment_notes && item.status !== 'pending' && (
                            <p className="px-4 pb-3 text-xs italic text-slate-400 sm:pl-12 dark:text-slate-500">{item.fulfillment_notes}</p>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                  {unfilledCount > 0 && (
                    <div className="m-4 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-700/40 dark:bg-amber-900/20">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                      <p className="text-xs text-amber-700 dark:text-amber-300">
                        {unfilledCount} item{unfilledCount !== 1 ? 's' : ''} could not be sourced. Raise a new request for the remainder, or mark {unfilledCount !== 1 ? 'them' : 'it'} cancelled if no longer needed.
                      </p>
                    </div>
                  )}
                </>
              )}
            </Panel>

            {(order.notes || order.vendor_recommendation) && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {order.notes && (
                  <Panel title="Notes" icon={StickyNote}>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-600 dark:text-slate-300">{order.notes}</p>
                  </Panel>
                )}
                {order.vendor_recommendation && (
                  <Panel title="Vendor notes" icon={Store}>
                    <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">{order.vendor_recommendation}</p>
                  </Panel>
                )}
              </div>
            )}
          </>}
          rail={<>
            <Panel title="Fulfillment" icon={CheckCircle2}>
              {approvalStatus !== 'rejected' && fulfillment.total > 0 ? (
                <div className="space-y-2">
                  <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                    {fulfillment.fulfilled > 0 && <span className="h-full bg-green-500" style={{ width: seg(fulfillment.fulfilled) }} />}
                    {fulfillment.partial > 0 && <span className="h-full bg-sky-500" style={{ width: seg(fulfillment.partial) }} />}
                    {rest > 0 && <span className="h-full" style={{ width: seg(rest) }} />}
                    {fulfillment.blocked > 0 && <span className="h-full bg-red-500" style={{ width: seg(fulfillment.blocked) }} />}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                    <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-green-500" />{fulfillment.fulfilled} sourced</span>
                    <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sky-500" />{fulfillment.partial} partial</span>
                    <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-slate-300 dark:bg-slate-600" />{rest} waiting</span>
                    <span className={`flex items-center gap-1.5 ${fulfillment.blocked ? 'font-medium text-red-600 dark:text-red-400' : ''}`}><span className="h-2 w-2 rounded-full bg-red-500" />{fulfillment.blocked} stuck</span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-400">{approvalStatus === 'rejected' ? 'Rejected — nothing will be sourced.' : 'No items yet.'}</p>
              )}
              {(order.manager_approved_by || order.finance_approved_by) && (
                <p className="mt-3 border-t pt-2 text-[11px] text-slate-400 dark:border-slate-700 dark:text-slate-500">
                  {order.manager_approved_by && <>Approved by {profileName(order.manager_approved_by) ?? '—'}{order.manager_approved_at ? ` on ${formatDate(order.manager_approved_at)}` : ''} under the previous approval process.{order.finance_approved_by ? ' ' : ''}</>}
                  {order.finance_approved_by && <>Finance-approved by {profileName(order.finance_approved_by) ?? '—'}{order.finance_approved_at ? ` on ${formatDate(order.finance_approved_at)}` : ''}.</>}
                </p>
              )}
            </Panel>
            <Panel title="Purchase orders" icon={Truck} count={purchaseOrders.length}>
              {purchaseOrders.length === 0 ? (
                <p className="text-sm text-slate-400">{approvalStatus === 'rejected' ? 'None — rejected.' : 'None yet — procurement puts the lines on a purchase order.'}</p>
              ) : (
                <ul className="-my-1 divide-y text-sm dark:divide-slate-700">
                  {purchaseOrders.map(({ po, lines, value }) => {
                    const st = PO_STATUS[po.status]
                    return (
                      <li key={po.id} className="py-2">
                        <Link to={`/sourcing/${po.id}`} className="group flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-mono text-xs font-semibold text-brand group-hover:underline">{po.bundle_code}</p>
                            <p className="truncate text-xs text-slate-600 dark:text-slate-300">{po.vendors?.vendor_name ?? po.vendor_name ?? 'No vendor yet'}</p>
                            <p className="text-[11px] text-slate-400">{lines} line{lines === 1 ? '' : 's'} from this request{value > 0 ? ` · ${Math.round(value).toLocaleString()} ETB` : ''}</p>
                          </div>
                          {st && <Pill tone={st.tone}>{st.label}</Pill>}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Panel>
            <Panel title="Details" icon={ClipboardList}>
              <FactList facts={[
                { label: 'Project', value: order.project_id ? <Link to={`/projects/${order.project_id}`} className="text-brand hover:underline">{projectName}</Link> : '—' },
                { label: 'Needed by', value: order.required_by_date ? formatDate(order.required_by_date) : '—', hint: dueText ?? undefined, tone: dueTone },
                { label: 'Priority', value: order.priority ? order.priority[0].toUpperCase() + order.priority.slice(1) : 'Normal', tone: order.priority === 'critical' ? 'red' : order.priority && order.priority !== 'normal' ? 'amber' : undefined },
                { label: 'Requested by', value: requestedByName ?? '—' },
                { label: 'Procurement officer', value: procOfficerName },
                { label: 'Submitted', value: formatDate(order.created_at) ?? '—' },
              ]} />
            </Panel>
          </>}
        />
      </div>
    </div>
  )
}
