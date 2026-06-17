import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable, type QuickFilter } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { TransportationRequest } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { Plus, Pencil, Trash2 } from 'lucide-react'

const transportQuickFilters: QuickFilter[] = [
  { columnId: 'payment_status', label: 'Payment', options: [{ label: 'Paid', value: true }, { label: 'Pending', value: false }] },
]

export default function TransportationPage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['transportation'],
    queryFn: async () => {
      const { data, error } = await supabase.from('transportation_requests').select('*, projects(project_name)').order('created_at', { ascending: false })
      if (error) throw error
      return data as TransportationRequest[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this request? This cannot be undone.')) return
    const { error } = await supabase.from('transportation_requests').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['transportation'] })
    toast('Request deleted', 'success')
  }

  const columns: ColumnDef<TransportationRequest>[] = useMemo(() => [
    { accessorKey: 'request_name', header: 'Request', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'requested_date', header: 'Date', cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'vehicle_type', header: 'Vehicle', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'driver_name', header: 'Driver', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'amount', header: 'Amount', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    { accessorKey: 'delivery_status', header: 'Delivery', cell: ({ getValue }) => getValue() ? <StatusBadge status={getValue() as string} /> : '—' },
    { id: 'project', header: 'Project', cell: ({ row }) => (row.original as any).projects?.project_name ?? '—' },
    { accessorKey: 'payment_status', header: 'Paid', filterFn: 'equals', cell: ({ getValue }) => <StatusBadge status={getValue() ? 'paid' : 'pending'} /> },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Link to={`/transportation/${row.original.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></Link>
          <button onClick={() => handleDelete(row.original.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800">Transportation</h1><p className="text-sm text-slate-500">Transportation requests and logistics</p></div>
        <Link to="/transportation/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          <Plus className="h-4 w-4" /> New Request
        </Link>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search requests…" persistKey="transportation" initialGlobalFilter={searchParams.get('q') ?? undefined} tableName="transportation_requests" queryKeys={['transportation']} quickFilters={transportQuickFilters} />}
    </div>
  )
}
