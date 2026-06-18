import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable, type QuickFilter } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatDate } from '@/lib/utils'
import type { Order } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { Plus, Pencil, Trash2 } from 'lucide-react'

const orderQuickFilters: QuickFilter[] = [
  {
    columnId: 'status',
    label: 'Status',
    options: [
      { label: 'Pending', value: 'pending' },
      { label: 'Approved', value: 'approved' },
      { label: 'Rejected', value: 'rejected' },
      { label: 'Completed', value: 'completed' },
    ],
  },
]

export default function OrdersPage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['orders'],
    queryFn: async () => {
      const { data, error } = await supabase.from('orders').select('*, projects(project_name), staff(employee_name), categories(category_name), vendors(vendor_name)').order('created_at', { ascending: false })
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

  const columns: ColumnDef<Order>[] = useMemo(() => [
    { accessorKey: 'order_name', header: 'Order', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'order_date', header: 'Date', cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'item_service_description', header: 'Description', cell: ({ getValue }) => (
      <span className="max-w-xs truncate block">{(getValue() as string) ?? '—'}</span>
    )},
    { accessorKey: 'quantity', header: 'Qty', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'status', header: 'Status', filterFn: 'equals', cell: ({ getValue }) => getValue() ? <StatusBadge status={getValue() as string} /> : '—' },
    { accessorKey: 'vendor_recommendation', header: 'Vendor Rec.', cell: ({ getValue }) => getValue() ?? '—' },
    { id: 'project_name', header: 'Project', cell: ({ row }) => (row.original as any).projects?.project_name ?? '—' },
    { id: 'staff_name', header: 'Ordered By', cell: ({ row }) => (row.original as any).staff?.employee_name ?? '—' },
    { id: 'category_name', header: 'General Ledger', cell: ({ row }) => (row.original as any).categories?.category_name ?? '—' },
    { id: 'recommended_vendor_name', header: 'Recommended Vendor', cell: ({ row }) => (row.original as any).vendors?.vendor_name ?? '—' },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Link to={`/orders/${row.original.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></Link>
          <button onClick={() => handleDelete(row.original.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800">Orders</h1><p className="text-sm text-slate-500">Purchase orders and requests</p></div>
        <Link to="/orders/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          <Plus className="h-4 w-4" /> New Order
        </Link>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search orders…" persistKey="orders" initialGlobalFilter={searchParams.get('q') ?? undefined} tableName="orders" queryKeys={['orders']} quickFilters={orderQuickFilters} />}
    </div>
  )
}
