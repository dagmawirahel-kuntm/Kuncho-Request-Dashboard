import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatDate } from '@/lib/utils'
import type { Order, OrderApprovalStatus, OrderPriority } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import {
  Plus, Pencil, Trash2, Package, Zap, AlertCircle, Clock,
  CheckCircle2, Search, ChevronRight, AlertTriangle, ListChecks,
} from 'lucide-react'

type OrderWithMeta = Order & {
  projects: { project_name: string } | null
  staff: { employee_name: string } | null
  _itemCount: number
  _pendingItems: number
}

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

function ItemCountBadge({ total, pending }: { total: number; pending: number }) {
  return (
    <div className="flex items-center gap-1">
      <span className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-300">
        <ListChecks className="h-3 w-3" />{total}
      </span>
      {pending > 0 && pending < total && (
        <span className="text-[10px] text-slate-400">{pending} pending</span>
      )}
    </div>
  )
}

// ── Approval badge filter ──────────────────────────────────────────────────────
const APPROVAL_FILTERS: { label: string; value: OrderApprovalStatus | 'all' }[] = [
  { label: 'All',              value: 'all' },
  { label: 'Pending',          value: 'pending' },
  { label: 'Manager Approved', value: 'manager_approved' },
  { label: 'Finance Approved', value: 'finance_approved' },
  { label: 'Rejected',         value: 'rejected' },
]

export default function PurchaseRequestsPage() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [approvalFilter, setApprovalFilter] = useState<OrderApprovalStatus | 'all'>('all')

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('*, projects(project_name), staff(employee_name)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as (Order & { projects: { project_name: string } | null; staff: { employee_name: string } | null })[]
    },
  })

  const { data: itemCounts = [] } = useQuery({
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
    const m: Record<string, { total: number; pending: number }> = {}
    for (const row of itemCounts) {
      if (!m[row.order_id]) m[row.order_id] = { total: 0, pending: 0 }
      m[row.order_id].total++
      if (row.status === 'pending') m[row.order_id].pending++
    }
    return m
  }, [itemCounts])

  const data: OrderWithMeta[] = useMemo(() =>
    orders.map(o => ({
      ...o,
      _itemCount:   countMap[o.id]?.total   ?? 0,
      _pendingItems: countMap[o.id]?.pending ?? 0,
    }))
  , [orders, countMap])

  const filtered = useMemo(() => {
    let list = data
    if (approvalFilter !== 'all') list = list.filter(o => o.approval_status === approvalFilter)
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
  }, [data, approvalFilter, search])

  const stats = useMemo(() => ({
    pending:  data.filter(o => o.approval_status === 'pending').length,
    urgent:   data.filter(o => o.priority === 'urgent' || o.priority === 'critical').length,
    newItems: data.filter(o => o.is_new_item || o._itemCount === 0).length,
    approved: data.filter(o => o.approval_status === 'finance_approved').length,
  }), [data])

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this purchase request? All line items will be removed.')) return
    const { error } = await supabase.from('orders').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
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
        <Link to="/purchase-requests/new"
          className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          <Plus className="h-4 w-4" /> New Request
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Awaiting Approval" value={stats.pending} icon={<Clock className="h-4 w-4" />} colorCls="bg-amber-50 text-amber-600 dark:bg-amber-900/30" />
        <StatCard label="Urgent / Critical" value={stats.urgent} icon={<AlertCircle className="h-4 w-4" />} colorCls="bg-red-50 text-red-500 dark:bg-red-900/30" />
        <StatCard label="New Items (Market)" value={stats.newItems} icon={<Zap className="h-4 w-4" />} colorCls="bg-purple-50 text-purple-500 dark:bg-purple-900/30" />
        <StatCard label="Fully Approved" value={stats.approved} icon={<CheckCircle2 className="h-4 w-4" />} colorCls="bg-green-50 text-green-600 dark:bg-green-900/30" />
      </div>

      {/* Search + filter bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <input type="text" placeholder="Search requests…" value={search} onChange={e => setSearch(e.target.value)}
            className="w-full rounded-lg border dark:border-slate-600 bg-white dark:bg-slate-800 pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand" />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {APPROVAL_FILTERS.map(f => (
            <button key={f.value} onClick={() => setApprovalFilter(f.value)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                approvalFilter === f.value
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
          <p className="text-sm text-slate-500">{search || approvalFilter !== 'all' ? 'No matching requests.' : 'No purchase requests yet.'}</p>
          {!search && approvalFilter === 'all' && (
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
              onClick={() => navigate(`/purchase-requests/${order.id}/edit`)}
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
                <ItemCountBadge total={order._itemCount} pending={order._pendingItems} />
                <div className="text-right min-w-[70px]">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide">Required by</p>
                  <RequiredBy date={order.required_by_date} />
                </div>
                <StatusBadge status={order.approval_status} />
              </div>

              {/* Actions */}
              <div className="flex items-center gap-0.5 flex-shrink-0">
                <button onClick={e => { e.stopPropagation(); navigate(`/purchase-requests/${order.id}/edit`) }}
                  title="Edit"
                  className="rounded p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors opacity-0 group-hover:opacity-100">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={e => { e.stopPropagation(); handleDelete(order.id) }}
                  title="Delete"
                  className="rounded p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors opacity-0 group-hover:opacity-100">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <ChevronRight className="h-4 w-4 text-slate-300 dark:text-slate-600 group-hover:text-slate-400 transition-colors" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
