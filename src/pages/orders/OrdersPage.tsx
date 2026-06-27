import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable, type QuickFilter } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatDate, formatCurrency } from '@/lib/utils'
import type { Order, OrderPriority } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { Plus, Pencil, Trash2, Package, Zap, AlertCircle, Clock, CheckCircle2 } from 'lucide-react'

// ── Priority chip ──────────────────────────────────────────────────────────────
const PRIORITY_STYLES: Record<OrderPriority, { label: string; cls: string }> = {
  normal:   { label: 'Normal',   cls: 'text-slate-500 bg-slate-100 dark:bg-slate-700 dark:text-slate-400' },
  urgent:   { label: 'Urgent',   cls: 'text-amber-700 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400' },
  critical: { label: 'Critical', cls: 'text-red-700 bg-red-50 dark:bg-red-900/30 dark:text-red-400' },
}

function PriorityChip({ priority }: { priority: OrderPriority | null }) {
  if (!priority || priority === 'normal') return <span className="text-xs text-slate-400">—</span>
  const { label, cls } = PRIORITY_STYLES[priority]
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>
}

// ── Required-by indicator ──────────────────────────────────────────────────────
function RequiredBy({ date }: { date: string | null }) {
  if (!date) return <span className="text-xs text-slate-400">—</span>
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(date)
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000)
  const cls = diff < 0 ? 'text-red-600 dark:text-red-400 font-semibold' : diff <= 3 ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-slate-600 dark:text-slate-300'
  const label = diff < 0 ? `Overdue ${Math.abs(diff)}d` : diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : formatDate(date)
  return <span className={`text-xs ${cls}`}>{label}</span>
}

// ── Quick filters ──────────────────────────────────────────────────────────────
const quickFilters: QuickFilter[] = [
  {
    columnId: 'approval_status',
    label: 'Approval',
    options: [
      { label: 'Pending',          value: 'pending' },
      { label: 'Manager Approved', value: 'manager_approved' },
      { label: 'Finance Approved', value: 'finance_approved' },
      { label: 'Rejected',         value: 'rejected' },
    ],
  },
  {
    columnId: 'priority',
    label: 'Priority',
    options: [
      { label: 'Critical', value: 'critical' },
      { label: 'Urgent',   value: 'urgent' },
      { label: 'Normal',   value: 'normal' },
    ],
  },
]

// ── Stat card ──────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, icon, accent }: { label: string; value: string | number; sub?: string; icon: React.ReactNode; accent?: string }) {
  return (
    <div className={`rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-4 flex items-center gap-3 shadow-sm ${accent ?? ''}`}>
      <div className="flex-shrink-0 rounded-lg bg-slate-100 dark:bg-slate-700 p-2 text-slate-500 dark:text-slate-400">{icon}</div>
      <div>
        <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">{label}</p>
        <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{value}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function OrdersPage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('*, projects(project_name), staff(employee_name), categories(category_name), vendors(vendor_name)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Order[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this order? This cannot be undone.')) return
    const { error } = await supabase.from('orders').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['orders'] })
    toast('Order deleted', 'success')
  }

  // Summary stats
  const stats = useMemo(() => {
    const pending   = data.filter(o => o.approval_status === 'pending').length
    const urgent    = data.filter(o => o.priority === 'urgent' || o.priority === 'critical').length
    const newItems  = data.filter(o => o.is_new_item).length
    const approved  = data.filter(o => o.approval_status === 'finance_approved').length
    return { pending, urgent, newItems, approved }
  }, [data])

  const columns: ColumnDef<Order>[] = useMemo(() => [
    {
      id: 'item',
      header: 'Item',
      cell: ({ row }) => {
        const o = row.original
        const name = o.order_name ?? (o.item_service_description ?? '').slice(0, 50) ?? '—'
        return (
          <div className="flex items-start gap-2 min-w-0">
            <div className={`mt-0.5 flex-shrink-0 rounded p-1 ${o.is_new_item ? 'bg-amber-50 text-amber-500' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'}`}>
              {o.is_new_item ? <Zap className="h-3 w-3" /> : <Package className="h-3 w-3" />}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate max-w-[200px]">{name}</p>
              {o.item_service_description && o.order_name && (
                <p className="text-xs text-slate-400 truncate max-w-[200px]">{o.item_service_description.slice(0, 60)}</p>
              )}
              {o.is_new_item && <span className="text-[10px] text-amber-600 font-medium">Market search required</span>}
            </div>
          </div>
        )
      },
    },
    {
      accessorKey: 'priority',
      header: 'Priority',
      filterFn: 'equals',
      cell: ({ getValue }) => <PriorityChip priority={getValue() as OrderPriority | null} />,
    },
    {
      accessorKey: 'required_by_date',
      header: 'Required By',
      cell: ({ getValue }) => <RequiredBy date={getValue() as string | null} />,
    },
    {
      id: 'qty_unit',
      header: 'Qty',
      cell: ({ row }) => {
        const { quantity, unit, unit_price_estimate } = row.original
        if (!quantity) return <span className="text-slate-400">—</span>
        return (
          <div className="tabular-nums">
            <p className="text-sm text-slate-800 dark:text-slate-100">{quantity}{unit ? ` ${unit}` : ''}</p>
            {unit_price_estimate && <p className="text-xs text-slate-400">{formatCurrency(unit_price_estimate)} ea.</p>}
          </div>
        )
      },
    },
    {
      id: 'project_name',
      header: 'Project',
      cell: ({ row }) => (row.original as any).projects?.project_name ?? <span className="text-slate-400">—</span>,
    },
    {
      id: 'staff_name',
      header: 'Requested By',
      cell: ({ row }) => (row.original as any).staff?.employee_name ?? <span className="text-slate-400">—</span>,
    },
    {
      accessorKey: 'approval_status',
      header: 'Approval',
      filterFn: 'equals',
      cell: ({ getValue }) => <StatusBadge status={getValue() as string} />,
    },
    {
      accessorKey: 'status',
      header: 'Fulfillment',
      cell: ({ getValue }) => getValue() ? <StatusBadge status={getValue() as string} /> : <span className="text-slate-400">—</span>,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Link to={`/orders/${row.original.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700" title="Edit">
            <Pencil className="h-3.5 w-3.5" />
          </Link>
          <button onClick={() => handleDelete(row.original.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20" title="Delete">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Purchase Orders</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Initiate and track procurement requests</p>
        </div>
        <Link to="/orders/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          <Plus className="h-4 w-4" /> New Order
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Awaiting Approval" value={stats.pending} icon={<Clock className="h-4 w-4" />} />
        <StatCard label="Urgent / Critical" value={stats.urgent} icon={<AlertCircle className="h-4 w-4 text-amber-500" />} />
        <StatCard label="New Items (Market)" value={stats.newItems} icon={<Zap className="h-4 w-4 text-amber-500" />} />
        <StatCard label="Fully Approved" value={stats.approved} icon={<CheckCircle2 className="h-4 w-4 text-green-500" />} />
      </div>

      {isLoading
        ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
        : (
          <DataTable
            columns={columns}
            data={data}
            searchPlaceholder="Search orders…"
            persistKey="orders"
            initialGlobalFilter={searchParams.get('q') ?? undefined}
            tableName="orders"
            queryKeys={['orders']}
            quickFilters={quickFilters}
          />
        )
      }
    </div>
  )
}
