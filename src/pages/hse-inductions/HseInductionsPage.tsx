import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { formatDate } from '@/lib/utils'
import type { HseInduction } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { Plus, Pencil, Trash2 } from 'lucide-react'

type HseInductionRow = HseInduction & {
  staff: { employee_name: string } | null
  inducted_by: { employee_name: string } | null
  projects: { project_name: string } | null
}

function isExpired(validUntil: string | null): boolean {
  if (!validUntil) return false
  return new Date(validUntil) < new Date(new Date().toISOString().slice(0, 10))
}

export default function HseInductionsPage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { role } = useAuth()
  const canWrite = role === 'admin' || role === 'manager' || (role as string) === 'hse_officer'

  const { data = [], isLoading } = useQuery({
    queryKey: ['hse-inductions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hse_inductions')
        .select('*, staff:staff_id(employee_name), inducted_by:inducted_by_staff_id(employee_name), projects(project_name)')
        .order('induction_date', { ascending: false })
      if (error) throw error
      return data as unknown as HseInductionRow[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this induction record? This cannot be undone.')) return
    const { error } = await supabase.from('hse_inductions').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['hse-inductions'] })
    toast('Induction deleted', 'success')
  }

  const columns: ColumnDef<HseInductionRow>[] = useMemo(() => [
    { id: 'person', header: 'Person', cell: ({ row }) => row.original.staff?.employee_name ?? row.original.person_name ?? '—' },
    { id: 'project_name', header: 'Project', cell: ({ row }) => row.original.projects?.project_name ?? '—' },
    { accessorKey: 'induction_date', header: 'Induction Date', cell: ({ getValue }) => formatDate(getValue() as string) },
    { id: 'inducted_by_name', header: 'Inducted By', cell: ({ row }) => row.original.inducted_by?.employee_name ?? '—' },
    {
      accessorKey: 'valid_until',
      header: 'Valid Until',
      cell: ({ getValue }) => {
        const v = getValue() as string | null
        if (!v) return '—'
        return <span className={isExpired(v) ? 'text-red-600 dark:text-red-400 font-medium' : undefined}>{formatDate(v)}</span>
      },
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          {canWrite && (
            <>
              <Link to={`/hse-inductions/${row.original.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></Link>
              <button onClick={() => handleDelete(row.original.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
            </>
          )}
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [canWrite])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">HSE Inductions</h1><p className="text-sm text-slate-500 dark:text-slate-400">Site safety induction records</p></div>
        {canWrite && (
          <Link to="/hse-inductions/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
            <Plus className="h-4 w-4" /> New Induction
          </Link>
        )}
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div> : (
        <DataTable
          columns={columns}
          data={data}
          searchPlaceholder="Search inductions…"
          persistKey="hse-inductions"
          initialGlobalFilter={searchParams.get('q') ?? undefined}
          tableName={canWrite ? 'hse_inductions' : undefined}
          queryKeys={['hse-inductions']}
        />
      )}
    </div>
  )
}
