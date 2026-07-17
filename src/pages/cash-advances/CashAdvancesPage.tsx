import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable, type QuickFilter } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { CashAdvance } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useFiscalYear } from '@/contexts/FiscalYearContext'
import { Plus, Pencil, Trash2 } from 'lucide-react'

const cashAdvanceQuickFilters: QuickFilter[] = [
  {
    columnId: 'approval_status',
    label: 'Approval',
    options: [
      { label: 'Pending', value: 'pending' },
      { label: 'Manager Approved', value: 'manager_approved' },
      { label: 'Finance Approved', value: 'finance_approved' },
      { label: 'Rejected', value: 'rejected' },
    ],
  },
]

export default function CashAdvancesPage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { fiscalPeriodId } = useFiscalYear()

  const { data = [], isLoading } = useQuery({
    queryKey: ['cash-advances', fiscalPeriodId],
    queryFn: async () => {
      let q = supabase.from('cash_advances').select('*, staff(employee_name), accounts(account_name), payroll(payroll_record)').order('created_at', { ascending: false })
      if (fiscalPeriodId) q = q.eq('fiscal_period_id', fiscalPeriodId)
      const { data, error } = await q
      if (error) throw error
      return data as CashAdvance[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this advance? This cannot be undone.')) return
    const { error } = await supabase.from('cash_advances').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['cash-advances'] })
    toast('Advance deleted', 'success')
  }

  const columns: ColumnDef<CashAdvance>[] = useMemo(() => [
    { accessorKey: 'advance_id_code', header: 'Code', cell: ({ getValue }) => getValue() ?? '—' },
    { id: 'staff_name', header: 'Staff', cell: ({ row }) => (row.original as any).staff?.employee_name ?? '—' },
    { id: 'account_name', header: 'Account', cell: ({ row }) => (row.original as any).accounts?.account_name ?? '—' },
    { accessorKey: 'amount_advanced', header: 'Amount (ETB)', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    { accessorKey: 'date_given', header: 'Date Given', cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'notes', header: 'Notes', cell: ({ getValue }) => <span className="text-slate-400 truncate block max-w-xs">{(getValue() as string) ?? '—'}</span> },
    { id: 'payroll_name', header: 'Payroll', cell: ({ row }) => (row.original as any).payroll?.payroll_record ?? '—' },
    { accessorKey: 'approval_status', header: 'Approval', filterFn: 'equals', cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Link to={`/cash-advances/${row.original.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></Link>
          <button onClick={() => handleDelete(row.original.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800">Cash Advances</h1><p className="text-sm text-slate-500">Staff cash advance records</p></div>
        <Link to="/cash-advances/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          <Plus className="h-4 w-4" /> New Advance
        </Link>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search advances…" persistKey="cash-advances" initialGlobalFilter={searchParams.get('q') ?? undefined} tableName="cash_advances" queryKeys={['cash-advances']} quickFilters={cashAdvanceQuickFilters} />}
    </div>
  )
}
