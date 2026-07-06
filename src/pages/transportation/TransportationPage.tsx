import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable, type QuickFilter } from '@/components/shared/DataTable'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { TransportationRequest, TransportJobStatus, TransportJobType, TransportMode } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { OwnRecordsBanner } from '@/components/shared/OwnRecordsBanner'
import { Plus, Pencil, Trash2, Truck, User } from 'lucide-react'

type JobRow = TransportationRequest & {
  projects: { project_name: string } | null
  expenses: { item_service_description: string | null; payment_status: boolean } | null
  pickup: { location_name: string } | null
  dropoff: { location_name: string } | null
  vendors: { vendor_name: string } | null
  vehicles: { name: string } | null
  assigned: { employee_name: string } | null
}

const JOB_STATUS_CLS: Record<TransportJobStatus, string> = {
  requested:   'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  assigned:    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  in_progress: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  completed:   'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  cancelled:   'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
}

const JOB_TYPE_LABEL: Record<TransportJobType, string> = {
  material_move:    'Material',
  purchase_pickup:  'Purchase Pickup',
  document_courier: 'Courier',
  people_move:      'People',
}

const MODE_LABEL: Record<TransportMode, string> = {
  own_fleet:    'Own fleet',
  ride_hailing: 'Ride-hailing',
  hired:        'Hired',
}

const transportQuickFilters: QuickFilter[] = [
  {
    columnId: 'job_status',
    label: 'Status',
    options: [
      { label: 'Requested', value: 'requested' },
      { label: 'Assigned', value: 'assigned' },
      { label: 'In Progress', value: 'in_progress' },
      { label: 'Completed', value: 'completed' },
      { label: 'Cancelled', value: 'cancelled' },
    ],
  },
  {
    columnId: 'transport_mode',
    label: 'Mode',
    options: [
      { label: 'Own fleet', value: 'own_fleet' },
      { label: 'Ride-hailing', value: 'ride_hailing' },
      { label: 'Hired', value: 'hired' },
    ],
  },
]

export default function TransportationPage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const { role, user } = useAuth()
  const qc = useQueryClient()
  const [myJobsOnly, setMyJobsOnly] = useState(false)

  const { data = [], isLoading } = useQuery({
    queryKey: ['transportation'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transportation_requests')
        .select(`*,
          projects(project_name),
          expenses(item_service_description, payment_status),
          pickup:locations!pickup_location_id(location_name),
          dropoff:locations!dropoff_location_id(location_name),
          vendors(vendor_name),
          vehicles(name),
          assigned:staff!assigned_staff_id(employee_name, user_id, email)
        `)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as JobRow[]
    },
  })

  // "My Jobs": jobs whose assigned staff record belongs to the current user
  const filtered = useMemo(() => {
    if (!myJobsOnly) return data
    const email = user?.email?.toLowerCase() ?? ''
    return data.filter(j => {
      const a = j.assigned as (JobRow['assigned'] & { user_id?: string | null; email?: string | null }) | null
      return a && (a.user_id === user?.id || (a.email ?? '').toLowerCase() === email)
    })
  }, [data, myJobsOnly, user])

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this job? This cannot be undone.')) return
    const { error } = await supabase.from('transportation_requests').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['transportation'] })
    toast('Job deleted', 'success')
  }

  const columns: ColumnDef<JobRow>[] = useMemo(() => [
    {
      accessorKey: 'request_name', header: 'Job',
      cell: ({ row }) => (
        <Link to={`/transportation/${row.original.id}/edit`} className="block max-w-xs">
          <span className="font-medium text-slate-800 dark:text-slate-100 hover:text-brand hover:underline truncate block">
            {row.original.request_name ?? '—'}
          </span>
          <span className="text-[10px] text-slate-400">{JOB_TYPE_LABEL[row.original.job_type] ?? row.original.job_type}</span>
        </Link>
      ),
    },
    {
      accessorKey: 'job_status', header: 'Status', filterFn: 'equals',
      cell: ({ getValue }) => {
        const s = getValue() as TransportJobStatus
        return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${JOB_STATUS_CLS[s] ?? ''}`}>{s.replace('_', ' ')}</span>
      },
    },
    {
      accessorKey: 'transport_mode', header: 'Mode', filterFn: 'equals',
      cell: ({ row }) => (
        <div className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
          <Truck className="h-3 w-3 text-slate-400" />
          {row.original.vehicles?.name ?? MODE_LABEL[row.original.transport_mode] ?? '—'}
          {row.original.transport_mode === 'hired' && row.original.hired_vehicle_class && (
            <span className="text-[10px] text-slate-400">({row.original.hired_vehicle_class.replace('_', ' ')})</span>
          )}
        </div>
      ),
    },
    {
      id: 'assigned', header: 'Assigned',
      cell: ({ row }) => row.original.assigned
        ? <span className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300"><User className="h-3 w-3 text-slate-400" />{row.original.assigned.employee_name}</span>
        : <span className="text-slate-300 dark:text-slate-600 text-xs">—</span>,
    },
    {
      id: 'route', header: 'Route',
      cell: ({ row }) => {
        const from = row.original.pickup?.location_name ?? row.original.pickup_location_text
        const to = row.original.dropoff?.location_name ?? row.original.dropoff_location_text
        if (!from && !to) return <span className="text-slate-300 dark:text-slate-600">—</span>
        return <span className="text-xs text-slate-500 dark:text-slate-400 max-w-[14rem] truncate block">{from ?? '?'} → {to ?? '?'}</span>
      },
    },
    { accessorKey: 'requested_date', header: 'Date', cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'amount', header: 'Cost', cell: ({ getValue }) => getValue() != null ? formatCurrency(getValue() as number) : '—' },
    {
      id: 'paid', header: 'Payment',
      cell: ({ row }) => {
        // Payment derives from the linked, finance-gated expense — the old
        // free-standing "Paid" checkbox is gone.
        if (row.original.expenses) {
          return row.original.expenses.payment_status
            ? <span className="rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">Paid</span>
            : <span className="rounded-full bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">Unpaid</span>
        }
        if (row.original.transport_mode === 'own_fleet') {
          return <span className="text-[10px] text-slate-400">n/a</span>
        }
        return <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400">No expense</span>
      },
    },
    { id: 'project', header: 'Project', cell: ({ row }) => row.original.projects?.project_name ?? '—' },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Link to={`/transportation/${row.original.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></Link>
          <button onClick={() => handleDelete(row.original.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Transport Jobs</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Dispatch, track, and settle every transport engagement</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMyJobsOnly(v => !v)}
            className={`rounded-md px-3 py-2 text-sm font-medium border transition-colors ${
              myJobsOnly
                ? 'bg-brand text-white border-brand'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700'
            }`}
          >
            My Jobs
          </button>
          <Link to="/logistics" className="rounded-md border dark:border-slate-600 px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
            Fleet
          </Link>
          <Link to="/transportation/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
            <Plus className="h-4 w-4" /> New Job
          </Link>
        </div>
      </div>
      {role === 'staff' && <OwnRecordsBanner />}
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={filtered} searchPlaceholder="Search jobs…" persistKey="transportation" initialGlobalFilter={searchParams.get('q') ?? undefined} tableName="transportation_requests" queryKeys={['transportation']} quickFilters={transportQuickFilters} />}
    </div>
  )
}
