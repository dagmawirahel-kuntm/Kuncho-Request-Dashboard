import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import type { OnboardingTask } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { Plus, Pencil, Trash2, Check } from 'lucide-react'

type OnboardingTaskRow = OnboardingTask & { staff: { employee_name: string } | null }

export default function OnboardingTasksPage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const { role } = useAuth()
  const qc = useQueryClient()
  const canManage = role === 'hr_officer' || role === 'admin' || role === 'manager'

  const { data = [], isLoading } = useQuery({
    queryKey: ['onboarding-tasks'],
    queryFn: async () => {
      const { data, error } = await supabase.from('onboarding_tasks').select('*, staff(employee_name)').order('created_at', { ascending: false })
      if (error) throw error
      return data as OnboardingTaskRow[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this onboarding task? This cannot be undone.')) return
    const { error } = await supabase.from('onboarding_tasks').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['onboarding-tasks'] })
    toast('Onboarding task deleted', 'success')
  }

  async function handleToggleDone(row: OnboardingTaskRow) {
    if (!canManage) return
    const nextDone = !row.is_done
    const { error } = await supabase
      .from('onboarding_tasks')
      .update({ is_done: nextDone, done_at: nextDone ? new Date().toISOString() : null })
      .eq('id', row.id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['onboarding-tasks'] })
    toast(nextDone ? 'Task marked done' : 'Task marked not done', 'success')
  }

  const columns: ColumnDef<OnboardingTaskRow>[] = useMemo(() => [
    { id: 'staff_name', header: 'Staff', cell: ({ row }) => row.original.staff?.employee_name ?? '—' },
    { accessorKey: 'task', header: 'Task' },
    {
      accessorKey: 'is_done',
      header: 'Done',
      cell: ({ row }) => (
        <button
          onClick={() => handleToggleDone(row.original)}
          disabled={!canManage}
          title={row.original.is_done ? 'Mark as not done' : 'Mark as done'}
          className={`flex h-5 w-5 items-center justify-center rounded border transition-colors ${row.original.is_done ? 'border-green-500 bg-green-500 text-white' : 'border-slate-300 dark:border-slate-600'} ${canManage ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}
        >
          {row.original.is_done && <Check className="h-3.5 w-3.5" />}
        </button>
      ),
    },
    { accessorKey: 'notes', header: 'Notes', cell: ({ getValue }) => <span className="text-slate-400 dark:text-slate-500 truncate block max-w-xs">{(getValue() as string) ?? '—'}</span> },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        canManage ? (
          <div className="flex items-center gap-1">
            <Link to={`/onboarding-tasks/${row.original.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></Link>
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
        <div><h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Onboarding Tasks</h1><p className="text-sm text-slate-500 dark:text-slate-400">New hire onboarding checklist</p></div>
        {canManage && (
          <Link to="/onboarding-tasks/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
            <Plus className="h-4 w-4" /> New Task
          </Link>
        )}
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search onboarding tasks…" persistKey="onboarding-tasks" initialGlobalFilter={searchParams.get('q') ?? undefined} tableName={canManage ? 'onboarding_tasks' : undefined} queryKeys={['onboarding-tasks']} />}
    </div>
  )
}
