import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatDate, formatCurrency, cn } from '@/lib/utils'
import type { LaborRequisition } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react'

type LaborRequisitionRow = LaborRequisition & { projects: { project_name: string } | null }

export default function LaborRequisitionsPage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const { role, user } = useAuth()
  const qc = useQueryClient()

  // Can create/edit requisitions — matches the INSERT policy on labor_requisitions.
  const canRequest = role === 'admin' || role === 'manager' || role === 'project_manager' || role === 'operations_manager' || role === 'hr_officer'
  // Can approve/reject and delete — matches the UPDATE/DELETE policies, notably excludes manager/project_manager.
  const canManage = role === 'admin' || role === 'operations_manager' || role === 'hr_officer'

  const { data = [], isLoading } = useQuery({
    queryKey: ['labor-requisitions'],
    queryFn: async () => {
      const { data, error } = await supabase.from('labor_requisitions').select('*, projects(project_name)').order('created_at', { ascending: false })
      if (error) throw error
      return data as LaborRequisitionRow[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this labor requisition? This cannot be undone.')) return
    const { error } = await supabase.from('labor_requisitions').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['labor-requisitions'] })
    toast('Labor requisition deleted', 'success')
  }

  async function handleDecision(id: string, status: 'approved' | 'rejected') {
    if (!user) return
    const { error } = await supabase
      .from('labor_requisitions')
      .update({ status, approved_by: user.id, approved_at: new Date().toISOString() })
      .eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['labor-requisitions'] })
    toast(status === 'approved' ? 'Labor requisition approved' : 'Labor requisition rejected', 'success')
  }

  const columns: ColumnDef<LaborRequisitionRow>[] = useMemo(() => [
    { id: 'project_name', header: 'Project', cell: ({ row }) => row.original.projects?.project_name ?? '—' },
    { accessorKey: 'role_needed', header: 'Role Needed' },
    { accessorKey: 'headcount', header: 'Headcount' },
    {
      accessorKey: 'is_casual_or_new',
      header: 'Type',
      cell: ({ getValue }) => (
        <span className={cn(
          'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
          getValue()
            ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300'
            : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
        )}>
          {getValue() ? 'Casual' : 'Specialist'}
        </span>
      ),
    },
    { accessorKey: 'start_date', header: 'Start Date', cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'end_date', header: 'End Date', cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'estimated_day_rate', header: 'Day Rate', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    { accessorKey: 'estimated_total_cost', header: 'Est. Total Cost', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          {canManage && row.original.status === 'pending' && (
            <>
              <button onClick={() => handleDecision(row.original.id, 'approved')} className="rounded p-1 text-slate-400 hover:bg-green-50 hover:text-green-600 dark:hover:bg-green-900/30" title="Approve"><Check className="h-3.5 w-3.5" /></button>
              <button onClick={() => handleDecision(row.original.id, 'rejected')} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30" title="Reject"><X className="h-3.5 w-3.5" /></button>
            </>
          )}
          {canRequest && (
            <Link to={`/labor-requisitions/${row.original.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></Link>
          )}
          {canManage && (
            <button onClick={() => handleDelete(row.original.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
          )}
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [canManage, canRequest])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Labor Requisitions</h1><p className="text-sm text-slate-500 dark:text-slate-400">New and casual labor cost requests requiring approval</p></div>
        {canRequest && (
          <Link to="/labor-requisitions/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
            <Plus className="h-4 w-4" /> New Requisition
          </Link>
        )}
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search labor requisitions…" persistKey="labor-requisitions" initialGlobalFilter={searchParams.get('q') ?? undefined} tableName={canManage ? 'labor_requisitions' : undefined} queryKeys={['labor-requisitions']} />}
    </div>
  )
}
