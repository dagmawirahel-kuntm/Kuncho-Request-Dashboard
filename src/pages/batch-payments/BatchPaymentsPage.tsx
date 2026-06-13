import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { formatDate } from '@/lib/utils'
import type { BatchPayment } from '@/types/database'

const columns: ColumnDef<BatchPayment>[] = [
  { accessorKey: 'payment_code', header: 'Code', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'notes', header: 'Notes', cell: ({ getValue }) => <span className="text-slate-400">{(getValue() as string) ?? '—'}</span> },
  { accessorKey: 'created_at', header: 'Created', cell: ({ getValue }) => formatDate(getValue() as string) },
]

export default function BatchPaymentsPage() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['batch-payments'],
    queryFn: async () => {
      const { data, error } = await supabase.from('batch_payments').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data as BatchPayment[]
    },
  })

  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold text-slate-800">Batch Payments</h1><p className="text-sm text-slate-500">Grouped payment batches</p></div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search batches…" />}
    </div>
  )
}
