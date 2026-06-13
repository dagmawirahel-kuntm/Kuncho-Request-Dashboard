import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { formatCurrency } from '@/lib/utils'
import type { TaxSummary } from '@/types/database'

const columns: ColumnDef<TaxSummary>[] = [
  { accessorKey: 'month', header: 'Month' },
  { accessorKey: 'vat_from_expenses', header: 'VAT (Expenses)', cell: ({ getValue }) => formatCurrency(getValue() as number) },
  { accessorKey: 'vat_from_sales', header: 'VAT (Sales)', cell: ({ getValue }) => formatCurrency(getValue() as number) },
  { accessorKey: 'wht_from_expenses', header: 'WHT (Expenses)', cell: ({ getValue }) => formatCurrency(getValue() as number) },
  { accessorKey: 'wht_deducted_by_client', header: 'WHT by Client', cell: ({ getValue }) => formatCurrency(getValue() as number) },
]

export default function TaxSummaryPage() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['tax-summary'],
    queryFn: async () => {
      const { data, error } = await supabase.from('tax_summary').select('*').order('month', { ascending: false })
      if (error) throw error
      return data as TaxSummary[]
    },
  })

  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold text-slate-800">Tax Summary</h1><p className="text-sm text-slate-500">VAT and withholding tax by month</p></div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search months…" />}
    </div>
  )
}
