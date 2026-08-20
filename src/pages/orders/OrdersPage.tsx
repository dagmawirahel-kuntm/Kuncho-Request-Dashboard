import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import type { Order, OrderPriority } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import {
  Plus, Pencil, Trash2, Package, Zap, AlertCircle,
  CheckCircle2, Search, ChevronRight, AlertTriangle, XCircle,
} from 'lucide-react'

type OrderWithMeta = Order & {
  projects: { project_name: string } | null
  staff: { employee_name: string } | null
  _total: number
  _fulfilled: number
  _partial: number
  _blocked: number
}

// A line item's own status is the only thing that still reflects real
// progress — approval_status stopped moving once the manager→finance
// ladder was retired (migrations 149/163), so every request looked
// identically "Pending" regardless of whether it was brand new or
// already fully delivered.
const FULFILLED_ITEM_STATUSES = new Set(['sourced', 'stock_fulfilled'])
const PARTIAL_ITEM_STATUSES   = new Set(['partially_sourced', 'stock_pending_dispatch'])

// Single source of truth for "what state is this request really in" —
// shared by the stat cards, the filter chips, and (in spirit) the
// per-row FulfillmentBar, so all three always agree with each other.
type FulfillmentState = 'rejected' | 'needs_attention' | 'fulfilled' | 'sourcing' | 'not_started'

function classifyOrder(o: OrderWithMeta): FulfillmentState {
  if (o.approval_status === 'rejected') return 'rejected'
  if (o._blocked > 0) return 'needs_attention'
  if (o._total > 0 && o._fulfilled === o._total) return 'fulfilled'
  if (o._fulfilled > 0 || o._partial > 0) return 'sourcing'
  return 'not_started'
}

const FULFILLMENT_FILTERS: { label: string; value: FulfillmentState | 'all' }[] = [
  { label: 'All',             value: 'all' },
  { label: 'Needs Attention', value: 'needs_attention' },
  { label: 'Sourcing',        value: 'sourcing' },
  { label: 'Not Started',     value: 'not_started' },
  { label: 'Fulfilled',       value: 'fulfilled' },
  { label: 'Rejected',        value: 'rejected' },
]

const PRIORITY_CLS: Record<string, string> = {
  critical: 'text-red-700 bg-red-50 dark:bg-red-900/30 dark:text-red-400',
  urgent:   'text-amber-700 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400',
  normal:   'text-slate-500 bg-slate-100 dark:bg-slate-700 dark:text-slate-400',
}

function PriorityChip({ priority }: { priority: OrderPriority | null }) {
  if (!priority || priority === 'normal') return null
  const label = priority === 'critical' ? 'Critical' : 'Urgent'
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${PRIORITY_CLS[priority]}`}>
      {priority === 'critical' ? <AlertCircle className="h-3 w-3 mr-1" /> : <AlertTriangle className="h-3 w-3 mr-1" />}
      {label}
    </span>
  )
}

function RequiredBy({ date }: { date: string | null }) {
  if (!date) return <span className="text-xs text-slate-400">—</span>
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(date)
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000)
  const cls = diff < 0
    ? 'text-red-600 dark:text-red-400 font-semibold'
    : diff <= 3 ? 'text-amber-600 dark:text-amber-400 font-semibold'
    : 'text-slate-500 dark:text-slate-400'
  const label = diff < 0 ? `Overdue ${Math.abs(diff)}d` : diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : formatDate(date)
  return <span className={`text-xs ${cls}`}>{label}</span>
}

function StatCard({ label, value, icon, colorCls }: { label: string; value: number; icon: React.ReactNode; colorCls?: string }) {
  return (
    <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-4 flex items-center gap-3 shadow-sm">
      <div className={`rounded-lg p-2 ${colorCls ?? 'bg-slate-100 dark:bg-slate-700 text-slate-500'}`}>{icon}</div>
      <div>
        <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">{label}</p>
        <p className="text-xl font-bold text-slate-800 dark:text-slate-100">{value}</p>
      </div>
    </div>
  )
}

// ── Fulfillment bar — replaces the item-count + approval-status pair.
// Reads real per-line progress (sourced/partial/stuck) instead of the
// approval_status field, which nothing has moved since the approval
// ladder was retired.
function FulfillmentBar({ order, total, fulfilled, partial, blocked }: {
  order: Order; total: number; fulfilled: number; partial: number; blocked: number
}) {
  if (order.approval_status === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 dark:bg-red-900/30 px-2.5 py-0.5 text-xs font-medium text-red-600 dark:text-red-400">
        <XCircle className="h-3 w-3" />Rejected
      </span>
    )
  }
  if (total === 0) {
    return <span className="text-xs text-slate-400 dark:text-slate-500">No items yet</span>
  }
  const rest = total - fulfilled - partial - blocked
  const segWidth = (n: number) => `${Math.max((n / total) * 100, n > 0 ? 6 : 0)}%`
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex h-1.5 w-[72px] overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
        {fulfilled > 0 && <span className="h-full bg-green-500" style={{ width: segWidth(fulfilled) }} />}
        {partial > 0   && <span className="h-full bg-sky-500"   style={{ width: segWidth(partial) }} />}
        {rest > 0      && <span className="h-full"               style={{ width: segWidth(rest) }} />}
        {blocked > 0   && <span className="h-full bg-red-500"    style={{ width: segWidth(blocked) }} />}
      </div>
      <span className="flex items-center gap-1 text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
        {blocked > 0 ? (
          <span className="flex items-center gap-0.5 font-semibold text-red-600 dark:text-red-400">
            <AlertTriangle className="h-2.5 w-2.5" />{blocked} stuck
          </span>
        ) : (
          <><span className="font-semibold text-slate-700 dark:text-slate-200">{fulfilled + partial}</span>/{total}</>
        )}
      </span>
    </div>
  )
}

export default function PurchaseRequestsPage() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { role, user } = useAuth()
  const canCreate = role !== 'procurement_officer'
  // Matches orders' RLS delete grants exactly: admin, or staff on their
  // own request. Every other role can view/edit but not delete.
  function canDelete(order: OrderWithMeta) {
    return role === 'admin' || (role === 'staff' && order.requested_by_user_id === user?.id)
  }
  const [search, setSearch] = useState('')
  const [fulfillmentFilter, setFulfillmentFilter] = useState<FulfillmentState | 'all'>('all')

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('*, projects(project_name), staff(employee_name)')
        .eq('is_archived', false)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as (Order & { projects: { project_name: string } | null; staff: { employee_name: string } | null })[]
    },
  })

  const { data: itemRows = [] } = useQuery({
    queryKey: ['order-item-counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_items')
        .select('order_id, status')
      if (error) throw error
      return data as { order_id: string; status: string }[]
    },
  })

  const countMap = useMemo(() => {
    const m: Record<string, { total: number; fulfilled: number; partial: number; blocked: number }> = {}
    for (const row of itemRows) {
      if (!m[row.order_id]) m[row.order_id] = { total: 0, fulfilled: 0, partial: 0, blocked: 0 }
      const bucket = m[row.order_id]
      if (row.status !== 'cancelled') bucket.total++
      if (FULFILLED_ITEM_STATUSES.has(row.status)) bucket.fulfilled++
      else if (PARTIAL_ITEM_STATUSES.has(row.status)) bucket.partial++
      else if (row.status === 'unfulfilled') bucket.blocked++
    }
    return m
  }, [itemRows])

  const data: OrderWithMeta[] = useMemo(() =>
    orders.map(o => ({
      ...o,
      _total:     countMap[o.id]?.total     ?? 0,
      _fulfilled: countMap[o.id]?.fulfilled ?? 0,
      _partial:   countMap[o.id]?.partial   ?? 0,
      _blocked:   countMap[o.id]?.blocked   ?? 0,
    }))
  , [orders, countMap])

  const filtered = useMemo(() => {
    let list = data
    if (fulfillmentFilter !== 'all') list = list.filter(o => classifyOrder(o) === fulfillmentFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(o =>
        (o.request_code ?? '').toLowerCase().includes(q) ||
        (o.order_name ?? '').toLowerCase().includes(q) ||
        (o.item_service_description ?? '').toLowerCase().includes(q) ||
        ((o as any).projects?.project_name ?? '').toLowerCase().includes(q) ||
        ((o as any).staff?.employee_name ?? '').toLowerCase().includes(q)
      )
    }
    return list
  }, [data, fulfillmentFilter, search])

  const stats = useMemo(() => ({
    needsAttention: data.filter(o => classifyOrder(o) === 'needs_attention').length,
    urgent:         data.filter(o => o.priority === 'urgent' || o.priority === 'critical').length,
    newItems:       data.filter(o => o.is_new_item || o._total === 0).length,
    fulfilled:      data.filter(o => classifyOrder(o) === 'fulfilled').length,
  }), [data])

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this purchase request? All line items will be removed.')) return
    // .select() after delete reports which rows were actually removed —
    // RLS silently deletes 0 rows for a denied request rather than
    // erroring, so this is the only way to detect that and say so.
    const { data, error } = await supabase.from('orders').delete().eq('id', id).select('id')
    if (error) { toast(error.message, 'error'); return }
    if (!data || data.length === 0) {
      toast("You don't have permission to delete this request", 'error')
      return
    }
    qc.invalidateQueries({ queryKey: ['orders'] })
    qc.invalidateQueries({ queryKey: ['order-item-counts'] })
    toast('Purchase request deleted', 'success')
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Purchase Requests</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Initiate and track procurement requests</p>
        </div>
        {canCreate && (
          <Link to="/purchase-requests/new"
            className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
            <Plus className="h-4 w-4" /> New Request
          </Link>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Needs Attention" value={stats.needsAttention} icon={<AlertTriangle className="h-4 w-4" />} colorCls="bg-red-50 text-red-500 dark:bg-red-900/30" />
        <StatCard label="Urgent / Critical" value={stats.urgent} icon={<AlertCircle className="h-4 w-4" />} colorCls="bg-amber-50 text-amber-600 dark:bg-amber-900/30" />
        <StatCard label="New Items (Market)" value={stats.newItems} icon={<Zap className="h-4 w-4" />} colorCls="bg-purple-50 text-purple-500 dark:bg-purple-900/30" />
        <StatCard label="Fulfilled" value={stats.fulfilled} icon={<CheckCircle2 className="h-4 w-4" />} colorCls="bg-green-50 text-green-600 dark:bg-green-900/30" />
      </div>

      {/* Search + filter bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <input type="text" placeholder="Search requests…" value={search} onChange={e => setSearch(e.target.value)}
            className="w-full rounded-lg border dark:border-slate-600 bg-white dark:bg-slate-800 pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand" />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {FULFILLMENT_FILTERS.map(f => (
            <button key={f.value} onClick={() => setFulfillmentFilter(f.value)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                fulfillmentFilter === f.value
                  ? 'bg-brand text-white'
                  : 'bg-white dark:bg-slate-800 border dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-brand'
              }`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed dark:border-slate-700 bg-white dark:bg-slate-800 py-16 text-center">
          <Package className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600 mb-3" />
          <p className="text-sm text-slate-500">{search || fulfillmentFilter !== 'all' ? 'No matching requests.' : 'No purchase requests yet.'}</p>
          {!search && fulfillmentFilter === 'all' && canCreate && (
            <Link to="/purchase-requests/new" className="mt-3 inline-flex items-center gap-1 text-sm text-brand font-medium hover:underline">
              <Plus className="h-3.5 w-3.5" /> Create first request
            </Link>
          )}
        </div>
      ) : (
        <div className="rounded-xl border dark:border-slate-700 overflow-hidden divide-y divide-slate-100 dark:divide-slate-700/60 shadow-sm">
          {filtered.map(order => (
            <div key={order.id}
              className="group flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors cursor-pointer"
              onClick={() => navigate(`/purchase-requests/${order.id}`)}
            >
              {/* Icon */}
              <div className={`flex-shrink-0 rounded-lg p-2 ${order.is_new_item ? 'bg-amber-50 text-amber-500' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'}`}>
                {order.is_new_item ? <Zap className="h-4 w-4" /> : <Package className="h-4 w-4" />}
              </div>

              {/* Main info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {order.request_code && (
                    <span className="text-xs font-mono font-semibold text-brand">{order.request_code}</span>
                  )}
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                    {order.order_name || order.item_service_description?.slice(0, 60) || 'Untitled request'}
                  </span>
                  <PriorityChip priority={order.priority as OrderPriority | null} />
                </div>
                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                  {(order as any).projects?.project_name && (
                    <span className="text-xs text-slate-400">{(order as any).projects.project_name}</span>
                  )}
                  {(order as any).staff?.employee_name && (
                    <span className="text-xs text-slate-400">by {(order as any).staff.employee_name}</span>
                  )}
                  {order.is_new_item && (
                    <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">Market search required</span>
                  )}
                </div>
              </div>

              {/* Right meta */}
              <div className="hidden sm:flex items-center gap-5 flex-shrink-0">
                <div className="text-right min-w-[70px]">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide">Required by</p>
                  <RequiredBy date={order.required_by_date} />
                </div>
                <FulfillmentBar
                  order={order}
                  total={order._total}
                  fulfilled={order._fulfilled}
                  partial={order._partial}
                  blocked={order._blocked}
                />
              </div>

              {/* Actions */}
              <div className="flex items-center gap-0.5 flex-shrink-0">
                <button onClick={e => { e.stopPropagation(); navigate(`/purchase-requests/${order.id}/edit`) }}
                  title="Edit"
                  className="rounded p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                {canDelete(order) && (
                  <button onClick={e => { e.stopPropagation(); handleDelete(order.id) }}
                    title="Delete"
                    className="rounded p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
                <ChevronRight className="h-4 w-4 text-slate-300 dark:text-slate-600 group-hover:text-slate-400 transition-colors" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
