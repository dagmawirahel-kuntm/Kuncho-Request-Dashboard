import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { formatDate, formatDateTime } from '@/lib/utils'
import type { Timesheet } from '@/types/database'

const columns: ColumnDef<Timesheet>[] = [
  { accessorKey: 'code', header: 'Code', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'date', header: 'Date', cell: ({ getValue }) => formatDate(getValue() as string) },
  { accessorKey: 'check_in_time', header: 'Check In', cell: ({ getValue }) => formatDateTime(getValue() as string) },
  { accessorKey: 'check_out_time', header: 'Check Out', cell: ({ getValue }) => formatDateTime(getValue() as string) },
  { accessorKey: 'notes', header: 'Notes', cell: ({ getValue }) => <span className="text-slate-400">{(getValue() as string) ?? '—'}</span> },
]

export default function TimesheetPage() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['timesheet'],
    queryFn: async () => {
      const { data, error } = await supabase.from('timesheet').select('*').order('date', { ascending: false })
      if (error) throw error
      return data as Timesheet[]
    },
  })

  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold text-slate-800">Timesheet</h1><p className="text-sm text-slate-500">Employee attendance and hours</p></div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search timesheet…" />}
    </div>
  )
}
