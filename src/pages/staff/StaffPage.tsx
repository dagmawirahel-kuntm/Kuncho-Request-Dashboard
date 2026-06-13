import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Staff } from '@/types/database'

const columns: ColumnDef<Staff>[] = [
  { accessorKey: 'employee_name', header: 'Name' },
  { accessorKey: 'staff_type', header: 'Type', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'role', header: 'Role', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'monthly_salary', header: 'Monthly Salary', cell: ({ getValue }) => formatCurrency(getValue() as number) },
  { accessorKey: 'payment_frequency', header: 'Pay Freq.', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'starting_date', header: 'Start Date', cell: ({ getValue }) => formatDate(getValue() as string) },
  { accessorKey: 'phone_number', header: 'Phone', cell: ({ getValue }) => getValue() ?? '—' },
]

export default function StaffPage() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['staff'],
    queryFn: async () => {
      const { data, error } = await supabase.from('staff').select('*').order('employee_name')
      if (error) throw error
      return data as Staff[]
    },
  })

  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold text-slate-800">Staff</h1><p className="text-sm text-slate-500">Employee records</p></div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search staff…" />}
    </div>
  )
}
