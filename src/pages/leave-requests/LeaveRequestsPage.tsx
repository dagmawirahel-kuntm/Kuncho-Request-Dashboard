import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatDateGC } from '@/lib/utils'
import type { LeaveRequest } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react'

type LeaveRequestRow = LeaveRequest & { staff: { employee_name: string } | null }

export default function LeaveRequestsPage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const { role, user } = useAuth()
  const qc = useQueryClient()
  const canManage = role === 'hr_officer' || role === 'admin'

  const { data = [], isLoading } = useQuery({
    queryKey: ['leave-requests'],
    queryFn: async () => {
      const { data, error } = await supabase.from('leave_requests').select('*, staff(employee_name)').order('created_at', { ascending: false })
      if (error) throw error
      return data as LeaveRequestRow[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this leave request? This cannot be undone.')) return
    const { error } = await supabase.from('leave_requests').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['leave-requests'] })
    toast('Leave request deleted', 'success')
  }

  async function handleDecision(id: string, status: 'approved' | 'rejected') {
    if (!user) return
    const { error } = await supabase
      .from('leave_requests')
      .update({ status, approved_by: user.id, approved_at: new Date().toISOString() })
      .eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['leave-requests'] })
    toast(status === 'approved' ? 'Leave request approved' : 'Leave request rejected', 'success')
  }

  const columns: ColumnDef<LeaveRequestRow>[] = useMemo(() => [
    { id: 'staff_name', header: 'Staff', cell: ({ row }) => row.original.staff?.employee_name ?? '—' },
    { accessorKey: 'leave_type', header: 'Type', cell: ({ getValue }) => <span className="capitalize">{getValue() as string}</span> },
    { accessorKey: 'start_date', header: 'Start Date', cell: ({ getValue }) => formatDateGC(getValue() as string) },
    { accessorKey: 'end_date', header: 'End Date', cell: ({ getValue }) => formatDateGC(getValue() as string) },
    { accessorKey: 'days', header: 'Days', cell: ({ getValue }) => getValue() ?? '—' },
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
          {canManage && (
            <>
              <Link to={`/leave-requests/${row.original.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></Link>
              <button onClick={() => handleDelete(row.original.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
            </>
          )}
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [canManage])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Leave Requests</h1><p className="text-sm text-slate-500 dark:text-slate-400">Staff leave applications and approvals</p></div>
        {canManage && (
          <Link to="/leave-requests/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
            <Plus className="h-4 w-4" /> New Leave Request
          </Link>
        )}
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search leave requests…" persistKey="leave-requests" initialGlobalFilter={searchParams.get('q') ?? undefined} tableName={canManage ? 'leave_requests' : undefined} queryKeys={['leave-requests']} />}
    </div>
  )
}
