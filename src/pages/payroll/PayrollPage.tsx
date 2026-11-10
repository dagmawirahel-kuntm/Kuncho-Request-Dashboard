import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Payroll } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { monthOfDates } from '@/lib/payroll'
import { ecMonthName } from '@/lib/ethiopianCalendar'

type PayrollRow = Payroll & { accounts: { account_name: string } | null; payroll_staff: { staff_id: string; net_amount: number | null }[] | null }

export default function PayrollPage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['payroll'],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll').select('*, accounts(account_name), payroll_staff(staff_id, net_amount)').eq('is_archived', false).order('start_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })
      if (error) throw error
      return data as PayrollRow[]
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

  const columns: ColumnDef<PayrollRow>[] = useMemo(() => [
    {
      accessorKey: 'payroll_record', header: 'Record',
      cell: ({ row, getValue }) => (
        <Link to={`/payroll/${row.original.id}`} className="font-mono text-xs font-bold text-brand hover:underline">
          {(getValue() as string) ?? '—'}
        </Link>
      ),
    },
    {
      id: 'pays_for', header: 'Pays for',
      accessorFn: r => monthOfDates(r.start_date, r.end_date)?.label ?? '',
      cell: ({ row }) => {
        const r = row.original
        const pays = monthOfDates(r.start_date, r.end_date)
        const taxLabel = r.tax_ec_year && r.tax_ec_month ? `${ecMonthName(r.tax_ec_month)} ${r.tax_ec_year}` : null
        return (
          <div>
            <span className="font-medium">{pays?.label ?? '—'}</span>
            <div className="text-[11px] text-slate-400">{formatDate(r.start_date)} → {formatDate(r.end_date)}</div>
            {taxLabel && pays && taxLabel !== pays.label && <div className="text-[11px] text-amber-600">declared in {taxLabel}</div>}
          </div>
        )
      },
    },
    { accessorKey: 'payroll_type', header: 'Kind', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'paid_on', header: 'Paid on', cell: ({ getValue }) => getValue() ? formatDate(getValue() as string) : <span className="text-slate-300">—</span> },
    {
      id: 'total_net', header: 'Total Net (ETB)',
      cell: ({ row }) => {
        const links = row.original.payroll_staff ?? []
        const total = links.reduce((s, l) => s + Number(l.net_amount ?? 0), 0)
        return total > 0
          ? <span className="font-semibold tabular-nums">{formatCurrency(total)}</span>
          : <span className="text-slate-300">—</span>
      },
    },
    { accessorKey: 'payment_status', header: 'Status', cell: ({ getValue }) => getValue() ? <StatusBadge status={getValue() as string} /> : '—' },
    { accessorKey: 'approval_status', header: 'Approval', filterFn: 'equals', cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
    { id: 'account_name', header: 'Account', cell: ({ row }) => row.original.accounts?.account_name ?? '—' },
    { id: 'staff_count', header: 'Employees', cell: ({ row }) => row.original.payroll_staff?.length ?? 0 },
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
        <div><h1 className="text-xl font-bold text-slate-800">Payroll</h1><p className="text-sm text-slate-500">Salary, overtime, bonus, allowance and back-pay runs, by the month they pay for</p></div>
        <Link to="/payroll/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          <Plus className="h-4 w-4" /> New Run
        </Link>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search payroll…" persistKey="payroll" initialGlobalFilter={searchParams.get('q') ?? undefined} tableName="payroll" queryKeys={['payroll', 'payroll-lookup']} />}
    </div>
  )
}
