import { useQuery } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import type { DesignPackage } from '@/types/database'
import { useAuth } from '@/contexts/AuthContext'
import { Plus, Eye } from 'lucide-react'

type DesignPackageRow = DesignPackage & { projects: { project_name: string } | null }

export default function DesignPackagesPage() {
  const [searchParams] = useSearchParams()
  const { role } = useAuth()
  const canWrite = role === 'design' || role === 'admin' || role === 'manager'

  const { data = [], isLoading } = useQuery({
    queryKey: ['design-packages'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('design_packages')
        .select('*, projects(project_name)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as DesignPackageRow[]
    },
  })

  const columns: ColumnDef<DesignPackageRow>[] = useMemo(() => [
    { accessorKey: 'title', header: 'Title', cell: ({ getValue }) => <span className="font-medium text-slate-800 dark:text-slate-100">{getValue() as string}</span> },
    { id: 'project_name', header: 'Project', cell: ({ row }) => row.original.projects?.project_name ?? '—' },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
    { accessorKey: 'brief', header: 'Brief', cell: ({ getValue }) => <span className="text-slate-500 dark:text-slate-400 truncate block max-w-xs">{(getValue() as string) ?? '—'}</span> },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Link to={`/design/${row.original.id}`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200" title="View">
            <Eye className="h-3.5 w-3.5" />
          </Link>
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Design Packages</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Design briefs, drawing registers and FF&amp;E schedules</p>
        </div>
        {canWrite && (
          <Link to="/design/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
            <Plus className="h-4 w-4" /> New Design Package
          </Link>
        )}
      </div>
      {isLoading ? (
        <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
      ) : (
        <DataTable columns={columns} data={data} searchPlaceholder="Search design packages…" persistKey="design-packages" initialGlobalFilter={searchParams.get('q') ?? undefined} />
      )}
    </div>
  )
}
