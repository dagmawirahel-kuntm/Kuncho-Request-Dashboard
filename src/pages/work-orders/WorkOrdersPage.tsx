import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable, type QuickFilter } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatCurrency, cn } from '@/lib/utils'
import type { WorkOrder, WorkOrderCostRow } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { useStaffDirectory } from '@/hooks/useLookups'
import { Plus, Trash2, Hammer, Wrench } from 'lucide-react'

type WorkOrderRow = WorkOrder & {
  projects: { project_name: string } | null
}

const quickFilters: QuickFilter[] = [
  {
    columnId: 'status',
    label: 'Status',
    options: [
      { label: 'Requested', value: 'requested' },
      { label: 'In Progress', value: 'in_progress' },
      { label: 'Completed', value: 'completed' },
      { label: 'Cancelled', value: 'cancelled' },
    ],
  },
  {
    columnId: 'work_type',
    label: 'Type',
    options: [
      { label: 'Workshop', value: 'workshop' },
      { label: 'Site', value: 'site' },
    ],
  },
]

export default function WorkOrdersPage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const { role } = useAuth()
  const qc = useQueryClient()
  const canManage = role === 'admin' || role === 'manager' || role === 'operations_manager' || role === 'project_manager'

  const { data = [], isLoading } = useQuery({
    queryKey: ['work-orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_orders')
        .select('*, projects(project_name)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as WorkOrderRow[]
    },
  })

  const { data: staffDirectory = [] } = useStaffDirectory()
  const staffNameById = useMemo(() => new Map(staffDirectory.map((s: any) => [s.id, s.employee_name])), [staffDirectory])

  const { data: costs = [] } = useQuery({
    queryKey: ['work-order-costs'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_work_order_cost').select('*')
      if (error) throw error
      return data as WorkOrderCostRow[]
    },
  })
  const costByWorkOrder = useMemo(() => new Map(costs.map(c => [c.work_order_id, c.total_cost])), [costs])

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this work order? This cannot be undone.')) return
    const { error } = await supabase.from('work_orders').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['work-orders'] })
    toast('Work order deleted', 'success')
  }

  const columns: ColumnDef<WorkOrderRow>[] = useMemo(() => {
    const cols: ColumnDef<WorkOrderRow>[] = [
      { id: 'project', header: 'Project', cell: ({ row }) => row.original.projects?.project_name ?? '—' },
      {
        accessorKey: 'work_type', header: 'Type', filterFn: 'equals',
        cell: ({ getValue }) => (
          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold',
            getValue() === 'workshop' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300')}>
            {getValue() === 'workshop' ? <Hammer className="h-2.5 w-2.5" /> : <Wrench className="h-2.5 w-2.5" />}
            {getValue() === 'workshop' ? 'Workshop' : 'Site'}
          </span>
        ),
      },
      {
        accessorKey: 'scope_of_work', header: 'Scope',
        cell: ({ getValue, row }) => (
          <Link to={`/work-orders/${row.original.id}`} className="truncate block max-w-xs font-medium text-slate-800 dark:text-slate-100 hover:text-brand hover:underline">
            {getValue() as string}
          </Link>
        ),
      },
      { id: 'lead', header: 'Lead', cell: ({ row }) => (row.original.assigned_lead_staff_id && staffNameById.get(row.original.assigned_lead_staff_id)) ?? '—' },
      { accessorKey: 'status', header: 'Status', filterFn: 'equals', cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
      { id: 'cost', header: 'Cost', cell: ({ row }) => formatCurrency(costByWorkOrder.get(row.original.id) ?? 0) },
    ]
    if (canManage) {
      cols.push({
        id: 'actions', header: '',
        cell: ({ row }) => (
          <button onClick={() => handleDelete(row.original.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30" title="Delete">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ),
      })
    }
    return cols
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, costByWorkOrder, staffNameById])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Work Orders</h1><p className="text-sm text-slate-500 dark:text-slate-400">Workshop and site-based internal work, costed from linked labor and materials</p></div>
        {canManage && (
          <Link to="/work-orders/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
            <Plus className="h-4 w-4" /> New Work Order
          </Link>
        )}
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : (
        <DataTable
          columns={columns}
          data={data}
          searchPlaceholder="Search work orders…"
          persistKey="work-orders"
          initialGlobalFilter={searchParams.get('q') ?? undefined}
          tableName={canManage ? 'work_orders' : undefined}
          queryKeys={['work-orders']}
          quickFilters={quickFilters}
        />
      )}
    </div>
  )
}
