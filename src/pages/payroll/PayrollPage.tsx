import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatDate } from '@/lib/utils'
import type { Payroll } from '@/types/database'

const columns: ColumnDef<Payroll>[] = [
  { accessorKey: 'payroll_record', header: 'Record', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'pay_period', header: 'Pay Period', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'start_date', header: 'Start', cell: ({ getValue }) => formatDate(getValue() as string) },
  { accessorKey: 'end_date', header: 'End', cell: ({ getValue }) => formatDate(getValue() as string) },
  { accessorKey: 'payment_method', header: 'Method', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'payment_status', header: 'Status', cell: ({ getValue }) => getValue() ? <StatusBadge status={getValue() as string} /> : '—' },
]

export default function PayrollPage() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['payroll'],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data as Payroll[]
    },
  })

  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold text-slate-800">Payroll</h1><p className="text-sm text-slate-500">Payroll runs and records</p></div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search payroll…" />}
    </div>
  )
}
