import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { EmergencyPayrollSummary } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { Plus, Pencil, Trash2 } from 'lucide-react'

export default function EmergencyPayrollPage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['emergency-payroll'],
    queryFn: async () => {
      const { data, error } = await supabase.from('emergency_payroll_summary').select('*, staff(employee_name), payroll(payroll_record)').order('created_at', { ascending: false })
      if (error) throw error
      return data as EmergencyPayrollSummary[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this payroll record? This cannot be undone.')) return
    const { error } = await supabase.from('emergency_payroll_summary').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['emergency-payroll'] })
    toast('Record deleted', 'success')
  }

  const columns: ColumnDef<EmergencyPayrollSummary>[] = useMemo(() => [
    { id: 'staff_name', header: 'Staff', cell: ({ row }) => (row.original as any).staff?.employee_name ?? '—' },
    { accessorKey: 'payroll_month', header: 'Month', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'days_worked', header: 'Days Worked', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'total_ot_days', header: 'OT Days', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'total_bonus', header: 'Bonus', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    { accessorKey: 'advance_taken', header: 'Advance', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    { accessorKey: 'payment_status', header: 'Status', cell: ({ getValue }) => getValue() ? <StatusBadge status={getValue() as string} /> : '—' },
    { accessorKey: 'payment_date', header: 'Payment Date', cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'notes', header: 'Notes', cell: ({ getValue }) => <span className="text-slate-400 truncate block max-w-xs">{(getValue() as string) ?? '—'}</span> },
    { id: 'payroll_record', header: 'Payroll', cell: ({ row }) => (row.original as any).payroll?.payroll_record ?? '—' },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Link to={`/emergency-payroll/${row.original.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></Link>
          <button onClick={() => handleDelete(row.original.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800">Emergency Payroll</h1><p className="text-sm text-slate-500">Emergency and contract payroll records</p></div>
        <Link to="/emergency-payroll/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          <Plus className="h-4 w-4" /> Add Record
        </Link>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search payroll…" persistKey="emergency-payroll" initialGlobalFilter={searchParams.get('q') ?? undefined} tableName="emergency_payroll_summary" queryKeys={['emergency-payroll']} />}
    </div>
  )
}
