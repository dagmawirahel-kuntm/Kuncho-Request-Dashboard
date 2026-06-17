import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { formatCurrency } from '@/lib/utils'
import type { TaxSummary } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { Plus, Pencil, Trash2 } from 'lucide-react'

export default function TaxSummaryPage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['tax-summary'],
    queryFn: async () => {
      const { data, error } = await supabase.from('tax_summary').select('*').order('month', { ascending: false })
      if (error) throw error
      return data as TaxSummary[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this tax summary? This cannot be undone.')) return
    const { error } = await supabase.from('tax_summary').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['tax-summary'] })
    toast('Tax summary deleted', 'success')
  }

  const columns: ColumnDef<TaxSummary>[] = useMemo(() => [
    { accessorKey: 'month', header: 'Month' },
    { accessorKey: 'vat_from_expenses', header: 'VAT from Expenses', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    { accessorKey: 'vat_from_sales', header: 'VAT from Sales', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    { accessorKey: 'wht_from_expenses', header: 'WHT from Expenses', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    { accessorKey: 'wht_deducted_by_client', header: 'WHT by Client', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Link to={`/tax-summary/${row.original.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></Link>
          <button onClick={() => handleDelete(row.original.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800">Tax Summary</h1><p className="text-sm text-slate-500">Monthly VAT and WHT summary</p></div>
        <Link to="/tax-summary/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          <Plus className="h-4 w-4" /> Add Summary
        </Link>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search tax summaries…" persistKey="tax-summary" initialGlobalFilter={searchParams.get('q') ?? undefined} tableName="tax_summary" queryKeys={['tax-summary']} />}
    </div>
  )
}
