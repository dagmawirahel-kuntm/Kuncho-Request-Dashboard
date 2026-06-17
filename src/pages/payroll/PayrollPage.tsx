import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatDate } from '@/lib/utils'
import type { Payroll } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { Plus, Pencil, Trash2 } from 'lucide-react'

export default function PayrollPage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['payroll'],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data as Payroll[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this payroll record? This cannot be undone.')) return
    const { error } = await supabase.from('payroll').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['payroll'] })
    qc.invalidateQueries({ queryKey: ['payroll-lookup'] })
    toast('Payroll deleted', 'success')
  }

  const columns: ColumnDef<Payroll>[] = useMemo(() => [
    { accessorKey: 'payroll_record', header: 'Record', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'pay_period', header: 'Pay Period', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'payroll_type', header: 'Type', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'start_date', header: 'Start', cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'end_date', header: 'End', cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'payment_status', header: 'Status', cell: ({ getValue }) => getValue() ? <StatusBadge status={getValue() as string} /> : '—' },
    { accessorKey: 'payment_method', header: 'Method', cell: ({ getValue }) => getValue() ?? '—' },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Link to={`/payroll/${row.original.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></Link>
          <button onClick={() => handleDelete(row.original.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800">Payroll</h1><p className="text-sm text-slate-500">Payroll runs and records</p></div>
        <Link to="/payroll/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          <Plus className="h-4 w-4" /> Add Payroll
        </Link>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search payroll…" persistKey="payroll" initialGlobalFilter={searchParams.get('q') ?? undefined} tableName="payroll" queryKeys={['payroll', 'payroll-lookup']} />}
    </div>
  )
}
