import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { CashAdvance } from '@/types/database'

const columns: ColumnDef<CashAdvance>[] = [
  { accessorKey: 'advance_id_code', header: 'Advance ID', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'amount_advanced', header: 'Amount', cell: ({ getValue }) => formatCurrency(getValue() as number) },
  { accessorKey: 'date_given', header: 'Date Given', cell: ({ getValue }) => formatDate(getValue() as string) },
  { accessorKey: 'notes', header: 'Notes', cell: ({ getValue }) => <span className="text-slate-400">{(getValue() as string) ?? '—'}</span> },
]

export default function CashAdvancesPage() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['cash-advances'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cash_advances').select('*').order('date_given', { ascending: false })
      if (error) throw error
      return data as CashAdvance[]
    },
  })

  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold text-slate-800">Cash Advances</h1><p className="text-sm text-slate-500">Staff cash advances</p></div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search advances…" />}
    </div>
  )
}
