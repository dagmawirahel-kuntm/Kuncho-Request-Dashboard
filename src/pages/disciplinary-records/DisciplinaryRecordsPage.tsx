import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatDateGC } from '@/lib/utils'
import type { DisciplinaryRecord } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { Plus, Pencil, Trash2 } from 'lucide-react'

type DisciplinaryRecordRow = DisciplinaryRecord & { staff: { employee_name: string } | null }

const CATEGORY_LABELS: Record<string, string> = {
  verbal_warning: 'Verbal Warning',
  written_warning: 'Written Warning',
  suspension: 'Suspension',
  dismissal: 'Dismissal',
  other: 'Other',
}

function truncate(text: string | null, max = 80) {
  if (!text) return '—'
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export default function DisciplinaryRecordsPage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const { role } = useAuth()
  const qc = useQueryClient()
  const canManage = role === 'hr_officer' || role === 'admin'

  const { data = [], isLoading } = useQuery({
    queryKey: ['disciplinary-records'],
    queryFn: async () => {
      const { data, error } = await supabase.from('disciplinary_records').select('*, staff(employee_name)').order('incident_date', { ascending: false })
      if (error) throw error
      return data as DisciplinaryRecordRow[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this disciplinary record? This cannot be undone.')) return
    const { error } = await supabase.from('disciplinary_records').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['disciplinary-records'] })
    toast('Disciplinary record deleted', 'success')
  }

  const columns: ColumnDef<DisciplinaryRecordRow>[] = useMemo(() => [
    { id: 'staff_name', header: 'Staff', cell: ({ row }) => row.original.staff?.employee_name ?? '—' },
    { accessorKey: 'incident_date', header: 'Incident Date', cell: ({ getValue }) => formatDateGC(getValue() as string) },
    { accessorKey: 'category', header: 'Category', cell: ({ getValue }) => <StatusBadge status={CATEGORY_LABELS[getValue() as string] ?? (getValue() as string)} /> },
    { accessorKey: 'description', header: 'Description', cell: ({ getValue }) => <span className="text-slate-600 dark:text-slate-300">{truncate(getValue() as string | null)}</span> },
    { accessorKey: 'action_taken', header: 'Action Taken', cell: ({ getValue }) => (getValue() as string) || '—' },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        canManage ? (
          <div className="flex items-center gap-1">
            <Link to={`/disciplinary-records/${row.original.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></Link>
            <button onClick={() => handleDelete(row.original.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ) : null
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [canManage])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Disciplinary Records</h1><p className="text-sm text-slate-500 dark:text-slate-400">Record of staff disciplinary actions</p></div>
        {canManage && (
          <Link to="/disciplinary-records/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
            <Plus className="h-4 w-4" /> New Record
          </Link>
        )}
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search disciplinary records…" persistKey="disciplinary-records" initialGlobalFilter={searchParams.get('q') ?? undefined} tableName={canManage ? 'disciplinary_records' : undefined} queryKeys={['disciplinary-records']} />}
    </div>
  )
}
