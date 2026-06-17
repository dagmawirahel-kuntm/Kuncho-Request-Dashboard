import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Staff } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { Plus, Pencil, Trash2 } from 'lucide-react'

export default function StaffPage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['staff'],
    queryFn: async () => {
      const { data, error } = await supabase.from('staff').select('*').order('employee_name')
      if (error) throw error
      return data as Staff[]
    },
  })

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete staff member "${name}"? This cannot be undone.`)) return
    const { error } = await supabase.from('staff').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['staff'] })
    qc.invalidateQueries({ queryKey: ['staff-lookup'] })
    toast('Staff member deleted', 'success')
  }

  const columns: ColumnDef<Staff>[] = useMemo(() => [
    { accessorKey: 'employee_name', header: 'Name' },
    { accessorKey: 'staff_type', header: 'Type', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'role', header: 'Role', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'monthly_salary', header: 'Monthly Salary', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    { accessorKey: 'day_rate', header: 'Day Rate', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    { accessorKey: 'phone_number', header: 'Phone', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'starting_date', header: 'Start Date', cell: ({ getValue }) => formatDate(getValue() as string) },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Link to={`/staff/${row.original.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></Link>
          <button onClick={() => handleDelete(row.original.id, row.original.employee_name)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800">Staff</h1><p className="text-sm text-slate-500">Employee and contractor directory</p></div>
        <Link to="/staff/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          <Plus className="h-4 w-4" /> Add Staff
        </Link>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search staff…" persistKey="staff" initialGlobalFilter={searchParams.get('q') ?? undefined} tableName="staff" queryKeys={['staff', 'staff-lookup']} />}
    </div>
  )
}
