import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { formatCurrency } from '@/lib/utils'
import type { PayrollTax } from '@/types/database'

const columns: ColumnDef<PayrollTax>[] = [
  { accessorKey: 'record_name', header: 'Record', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'payroll_month', header: 'Month', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'gross_salary', header: 'Gross Salary', cell: ({ getValue }) => formatCurrency(getValue() as number) },
  { accessorKey: 'tax_amount', header: 'Tax Amount', cell: ({ getValue }) => formatCurrency(getValue() as number) },
  { accessorKey: 'taxable', header: 'Taxable', cell: ({ getValue }) => getValue() ?? '—' },
]

export default function PayrollTaxesPage() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['payroll-taxes'],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll_taxes').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data as PayrollTax[]
    },
  })

  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold text-slate-800">Payroll Taxes</h1><p className="text-sm text-slate-500">Employee income tax records</p></div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search records…" />}
    </div>
  )
}
