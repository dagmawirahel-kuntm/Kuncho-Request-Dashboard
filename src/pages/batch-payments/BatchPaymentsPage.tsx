import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { formatDate } from '@/lib/utils'
import type { BatchPayment } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { Plus, Pencil, Trash2 } from 'lucide-react'

export default function BatchPaymentsPage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['batch-payments'],
    queryFn: async () => {
      const { data, error } = await supabase.from('batch_payments').select('*, user_profiles(full_name), batch_payment_expenses(expense_id)').order('created_at', { ascending: false })
      if (error) throw error
      return data as BatchPayment[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this batch payment? This cannot be undone.')) return
    const { error } = await supabase.from('batch_payments').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['batch-payments'] })
    toast('Payment deleted', 'success')
  }

  const columns: ColumnDef<BatchPayment>[] = useMemo(() => [
    { accessorKey: 'payment_code', header: 'Payment Code', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'notes', header: 'Notes', cell: ({ getValue }) => <span className="text-slate-400 truncate block max-w-sm">{(getValue() as string) ?? '—'}</span> },
    { accessorKey: 'created_at', header: 'Created', cell: ({ getValue }) => formatDate(getValue() as string) },
    { id: 'assignee_name', header: 'Assignee', cell: ({ row }) => (row.original as any).user_profiles?.full_name ?? '—' },
    { id: 'expenses_count', header: 'Expenses', cell: ({ row }) => (row.original as any).batch_payment_expenses?.length ?? 0 },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Link to={`/batch-payments/${row.original.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></Link>
          <button onClick={() => handleDelete(row.original.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800">Batch Payments</h1><p className="text-sm text-slate-500">Batch payment records</p></div>
        <Link to="/batch-payments/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          <Plus className="h-4 w-4" /> Add Payment
        </Link>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search payments…" persistKey="batch-payments" initialGlobalFilter={searchParams.get('q') ?? undefined} tableName="batch_payments" queryKeys={['batch-payments']} />}
    </div>
  )
}
