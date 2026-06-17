import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { formatCurrency } from '@/lib/utils'
import type { PayrollTax } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { Plus, Pencil, Trash2 } from 'lucide-react'

export default function PayrollTaxesPage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['payroll-taxes'],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll_taxes').select('*, staff(employee_name), payroll(pay_period)').order('created_at', { ascending: false })
      if (error) throw error
      return data as PayrollTax[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this tax record? This cannot be undone.')) return
    const { error } = await supabase.from('payroll_taxes').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['payroll-taxes'] })
    toast('Tax record deleted', 'success')
  }

  const columns: ColumnDef<PayrollTax>[] = useMemo(() => [
    { accessorKey: 'record_name', header: 'Record', cell: ({ getValue }) => getValue() ?? '—' },
    { id: 'staff_name', header: 'Staff', cell: ({ row }) => (row.original as any).staff?.employee_name ?? '—' },
    { accessorKey: 'payroll_month', header: 'Month', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'gross_salary', header: 'Gross Salary', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    { accessorKey: 'tax_amount', header: 'Tax Amount', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    { accessorKey: 'taxable', header: 'Taxable', cell: ({ getValue }) => getValue() ?? '—' },
    { id: 'payroll_period', header: 'Pay Period', cell: ({ row }) => (row.original as any).payroll?.pay_period ?? '—' },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Link to={`/payroll-taxes/${row.original.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></Link>
          <button onClick={() => handleDelete(row.original.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800">Payroll Taxes</h1><p className="text-sm text-slate-500">Staff payroll tax records</p></div>
        <Link to="/payroll-taxes/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          <Plus className="h-4 w-4" /> Add Record
        </Link>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search payroll taxes…" persistKey="payroll-taxes" initialGlobalFilter={searchParams.get('q') ?? undefined} tableName="payroll_taxes" queryKeys={['payroll-taxes']} />}
    </div>
  )
}
