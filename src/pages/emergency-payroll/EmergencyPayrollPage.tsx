import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { EmergencyPayrollSummary } from '@/types/database'

const columns: ColumnDef<EmergencyPayrollSummary>[] = [
  { accessorKey: 'record_name', header: 'Record', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'payroll_month', header: 'Month', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'days_worked', header: 'Days Worked', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'total_bonus', header: 'Bonus', cell: ({ getValue }) => formatCurrency(getValue() as number) },
  { accessorKey: 'payment_date', header: 'Payment Date', cell: ({ getValue }) => formatDate(getValue() as string) },
  { accessorKey: 'payment_status', header: 'Status', cell: ({ getValue }) => getValue() ? <StatusBadge status={getValue() as string} /> : '—' },
]

export default function EmergencyPayrollPage() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['emergency-payroll'],
    queryFn: async () => {
      const { data, error } = await supabase.from('emergency_payroll_summary').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data as EmergencyPayrollSummary[]
    },
  })

  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold text-slate-800">Emergency Payroll</h1><p className="text-sm text-slate-500">Emergency payroll summaries</p></div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search records…" />}
    </div>
  )
}
