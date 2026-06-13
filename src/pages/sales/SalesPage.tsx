import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Sale } from '@/types/database'

const columns: ColumnDef<Sale>[] = [
  { accessorKey: 'sales_description', header: 'Description' },
  { accessorKey: 'date', header: 'Date', cell: ({ getValue }) => formatDate(getValue() as string) },
  { accessorKey: 'amount', header: 'Amount', cell: ({ getValue }) => formatCurrency(getValue() as number) },
  { accessorKey: 'product_or_service', header: 'Product/Service', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'payment_method', header: 'Payment Method', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'sales_status', header: 'Status', cell: ({ getValue }) => getValue() ? <StatusBadge status={getValue() as string} /> : '—' },
]

export default function SalesPage() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['sales'],
    queryFn: async () => {
      const { data, error } = await supabase.from('sales').select('*').order('date', { ascending: false })
      if (error) throw error
      return data as Sale[]
    },
  })

  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold text-slate-800">Sales</h1><p className="text-sm text-slate-500">Revenue records</p></div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search sales…" />}
    </div>
  )
}
