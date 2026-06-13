import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { formatDate } from '@/lib/utils'
import type { Project } from '@/types/database'

const columns: ColumnDef<Project>[] = [
  { accessorKey: 'project_name', header: 'Project' },
  { accessorKey: 'department', header: 'Department', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'start_date', header: 'Start Date', cell: ({ getValue }) => formatDate(getValue() as string) },
  { accessorKey: 'active_for_year', header: 'Active', cell: ({ getValue }) => (getValue() ? '✓ Active' : 'Inactive') },
]

export default function ProjectsPage() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('*').order('project_name')
      if (error) throw error
      return data as Project[]
    },
  })

  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold text-slate-800">Projects</h1><p className="text-sm text-slate-500">Active and past projects</p></div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search projects…" />}
    </div>
  )
}
