import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { VehicleMaintenanceRequest } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { Plus, Pencil, Trash2, Check, X, Receipt } from 'lucide-react'

type MaintenanceRow = VehicleMaintenanceRequest & { vehicles: { name: string; plate_number: string | null } | null }

export default function VehicleMaintenancePage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const { role, user, profile } = useAuth()
  const qc = useQueryClient()
  const canManage = role === 'admin' || role === 'manager' || role === 'logistics_officer' || !!profile?.is_logistics_officer

  const { data = [], isLoading } = useQuery({
    queryKey: ['vehicle-maintenance-requests'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicle_maintenance_requests').select('*, vehicles(name, plate_number)').order('created_at', { ascending: false })
      if (error) throw error
      return data as MaintenanceRow[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this maintenance request? This cannot be undone.')) return
    const { error } = await supabase.from('vehicle_maintenance_requests').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['vehicle-maintenance-requests'] })
    toast('Maintenance request deleted', 'success')
  }

  async function handleDecision(id: string, status: 'approved' | 'rejected') {
    if (!user) return
    const { error } = await supabase
      .from('vehicle_maintenance_requests')
      .update({ status, approved_by: user.id, approved_at: new Date().toISOString() })
      .eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['vehicle-maintenance-requests'] })
    toast(status === 'approved' ? 'Maintenance request approved' : 'Maintenance request rejected', 'success')
  }

  async function handleCreateExpense(row: MaintenanceRow) {
    if (!row.actual_cost) { toast('Set the actual cost before creating an expense', 'error'); return }
    const { data: category } = await supabase.from('categories').select('id').eq('category_name', 'Transportation').maybeSingle()
    const { data: expense, error } = await supabase.from('expenses').insert([{
      item_service_description: `Vehicle maintenance — ${row.vehicles?.name ?? 'Vehicle'}: ${row.issue_description}`,
      amount_etb: row.actual_cost,
      date: (row.completed_at ?? new Date().toISOString()).slice(0, 10),
      category_id: category?.id ?? null,
      purchaser_user_id: user?.id ?? null,
      approval_status: 'pending',
      requested: true,
      payment_status: false,
      partially_paid: false,
      contacted: false,
      verify_wht: false,
      is_new_item: false,
      is_allocated: false,
      receipt_delivered: false,
      delivery_status: [],
    }]).select('id').single()
    if (error || !expense) { toast(error?.message ?? 'Failed to create expense', 'error'); return }
    const { error: linkErr } = await supabase.from('vehicle_maintenance_requests').update({ expense_id: expense.id }).eq('id', row.id)
    if (linkErr) toast(`Expense created but linking failed: ${linkErr.message}`, 'error')
    qc.invalidateQueries({ queryKey: ['vehicle-maintenance-requests'] })
    qc.invalidateQueries({ queryKey: ['expenses'] })
    toast('Expense created and linked', 'success')
  }

  const columns: ColumnDef<MaintenanceRow>[] = useMemo(() => [
    { id: 'vehicle', header: 'Vehicle', cell: ({ row }) => row.original.vehicles ? `${row.original.vehicles.name}${row.original.vehicles.plate_number ? ` (${row.original.vehicles.plate_number})` : ''}` : '—' },
    { accessorKey: 'issue_description', header: 'Issue', cell: ({ getValue }) => <span className="truncate block max-w-xs">{getValue() as string}</span> },
    { accessorKey: 'estimated_cost', header: 'Estimated Cost', cell: ({ getValue }) => getValue() != null ? formatCurrency(getValue() as number) : '—' },
    { accessorKey: 'actual_cost', header: 'Actual Cost', cell: ({ getValue }) => getValue() != null ? formatCurrency(getValue() as number) : '—' },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
    { accessorKey: 'completed_at', header: 'Completed', cell: ({ getValue }) => getValue() ? formatDate(getValue() as string) : '—' },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          {canManage && row.original.status === 'pending' && (
            <>
              <button onClick={() => handleDecision(row.original.id, 'approved')} className="rounded p-1 text-slate-400 hover:bg-green-50 hover:text-green-600" title="Approve"><Check className="h-3.5 w-3.5" /></button>
              <button onClick={() => handleDecision(row.original.id, 'rejected')} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Reject"><X className="h-3.5 w-3.5" /></button>
            </>
          )}
          {canManage && row.original.status === 'completed' && row.original.actual_cost != null && !row.original.expense_id && (
            <button onClick={() => handleCreateExpense(row.original)} className="rounded p-1 text-slate-400 hover:bg-brand/10 hover:text-brand" title="Create Expense"><Receipt className="h-3.5 w-3.5" /></button>
          )}
          {canManage && (
            <>
              <Link to={`/fleet/maintenance/${row.original.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></Link>
              <button onClick={() => handleDelete(row.original.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
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
        <div><h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Vehicle Maintenance</h1><p className="text-sm text-slate-500 dark:text-slate-400">Repair requests and completed work</p></div>
        <Link to="/fleet/maintenance/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          <Plus className="h-4 w-4" /> Report Issue
        </Link>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search maintenance requests…" persistKey="vehicle-maintenance" initialGlobalFilter={searchParams.get('q') ?? undefined} tableName={canManage ? 'vehicle_maintenance_requests' : undefined} queryKeys={['vehicle-maintenance-requests']} />}
    </div>
  )
}
