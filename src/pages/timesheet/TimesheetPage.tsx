import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { formatDate } from '@/lib/utils'
import type { Timesheet } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { OwnRecordsBanner } from '@/components/shared/OwnRecordsBanner'
import { Plus, Pencil, Trash2 } from 'lucide-react'

export default function TimesheetPage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const { role } = useAuth()
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['timesheet'],
    queryFn: async () => {
      const { data, error } = await supabase.from('timesheet').select('*, staff(employee_name), projects(project_name)').order('created_at', { ascending: false })
      if (error) throw error
      return data as Timesheet[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this entry? This cannot be undone.')) return
    const { error } = await supabase.from('timesheet').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['timesheet'] })
    toast('Entry deleted', 'success')
  }

  const columns: ColumnDef<Timesheet>[] = useMemo(() => [
    { accessorKey: 'code', header: 'Code', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'date', header: 'Date', cell: ({ getValue }) => formatDate(getValue() as string) },
    { id: 'staff_name', header: 'Staff', cell: ({ row }) => (row.original as any).staff?.employee_name ?? '—' },
    { accessorKey: 'check_in_time', header: 'Check In', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'check_out_time', header: 'Check Out', cell: ({ getValue }) => getValue() ?? '—' },
    { id: 'project_name', header: 'Project', cell: ({ row }) => (row.original as any).projects?.project_name ?? '—' },
    { accessorKey: 'notes', header: 'Notes', cell: ({ getValue }) => <span className="text-slate-400 truncate block max-w-xs">{(getValue() as string) ?? '—'}</span> },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Link to={`/timesheet/${row.original.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></Link>
          <button onClick={() => handleDelete(row.original.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800">Timesheet</h1><p className="text-sm text-slate-500">Staff attendance and time tracking</p></div>
        <Link to="/timesheet/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          <Plus className="h-4 w-4" /> New Entry
        </Link>
      </div>
      {role === 'staff' && <OwnRecordsBanner />}
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search timesheet…" persistKey="timesheet" initialGlobalFilter={searchParams.get('q') ?? undefined} tableName="timesheet" queryKeys={['timesheet']} />}
    </div>
  )
}
