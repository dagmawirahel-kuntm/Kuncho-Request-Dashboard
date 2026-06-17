import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { formatDate } from '@/lib/utils'
import type { Project } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { Plus, Pencil, Trash2, Check } from 'lucide-react'

export default function ProjectsPage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('*').order('project_name')
      if (error) throw error
      return data as Project[]
    },
  })

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete project "${name}"? This cannot be undone.`)) return
    const { error } = await supabase.from('projects').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['projects'] })
    qc.invalidateQueries({ queryKey: ['projects-lookup'] })
    toast('Project deleted', 'success')
  }

  const columns: ColumnDef<Project>[] = useMemo(() => [
    { accessorKey: 'project_name', header: 'Project Name' },
    { accessorKey: 'department', header: 'Department', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'start_date', header: 'Start Date', cell: ({ getValue }) => formatDate(getValue() as string) },
    {
      accessorKey: 'active_for_year',
      header: 'Active',
      cell: ({ getValue }) => getValue() ? <Check className="h-4 w-4 text-green-500" /> : <span className="text-slate-300">—</span>,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Link to={`/projects/${row.original.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></Link>
          <button onClick={() => handleDelete(row.original.id, row.original.project_name)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800">Projects</h1><p className="text-sm text-slate-500">Project and department directory</p></div>
        <Link to="/projects/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          <Plus className="h-4 w-4" /> Add Project
        </Link>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search projects…" persistKey="projects" initialGlobalFilter={searchParams.get('q') ?? undefined} tableName="projects" queryKeys={['projects', 'projects-lookup']} />}
    </div>
  )
}
