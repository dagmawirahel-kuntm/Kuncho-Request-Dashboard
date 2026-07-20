import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { formatCurrency, formatDate, cn } from '@/lib/utils'
import type { VehiclePenalty } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { Plus, Pencil, Trash2 } from 'lucide-react'

type PenaltyRow = VehiclePenalty & { vehicles: { name: string; plate_number: string | null } | null; staff: { employee_name: string } | null }

export default function VehiclePenaltiesPage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const { role, profile } = useAuth()
  const qc = useQueryClient()
  const canManage = role === 'admin' || role === 'manager' || role === 'logistics_officer' || !!profile?.is_logistics_officer

  const { data = [], isLoading } = useQuery({
    queryKey: ['vehicle-penalties'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicle_penalties').select('*, vehicles(name, plate_number), staff(employee_name)').order('penalty_date', { ascending: false })
      if (error) throw error
      return data as PenaltyRow[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this penalty record? This cannot be undone.')) return
    const { error } = await supabase.from('vehicle_penalties').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['vehicle-penalties'] })
    toast('Penalty deleted', 'success')
  }

  async function handleTogglePaid(id: string, next: boolean) {
    const { error } = await supabase.from('vehicle_penalties').update({ paid: next }).eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['vehicle-penalties'] })
    toast(next ? 'Marked paid' : 'Marked unpaid', 'success')
  }

  const columns: ColumnDef<PenaltyRow>[] = useMemo(() => [
    { id: 'vehicle', header: 'Vehicle', cell: ({ row }) => row.original.vehicles ? `${row.original.vehicles.name}${row.original.vehicles.plate_number ? ` (${row.original.vehicles.plate_number})` : ''}` : '—' },
    { id: 'driver', header: 'Driver', cell: ({ row }) => row.original.staff?.employee_name ?? '—' },
    { accessorKey: 'penalty_date', header: 'Date', cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'amount', header: 'Amount', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    { accessorKey: 'reason', header: 'Reason', cell: ({ getValue }) => <span className="truncate block max-w-xs">{(getValue() as string) ?? '—'}</span> },
    {
      accessorKey: 'paid', header: 'Paid',
      cell: ({ getValue, row }) => (
        <button
          disabled={!canManage}
          onClick={() => handleTogglePaid(row.original.id, !getValue())}
          className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
            getValue() ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
            canManage ? 'cursor-pointer hover:opacity-80' : 'cursor-default')}
        >
          {getValue() ? 'Paid' : 'Unpaid'}
        </button>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => canManage ? (
        <div className="flex items-center gap-1">
          <Link to={`/fleet/penalties/${row.original.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></Link>
          <button onClick={() => handleDelete(row.original.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ) : null,
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [canManage])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Traffic Penalties</h1><p className="text-sm text-slate-500 dark:text-slate-400">Fines against fleet vehicles — tracked here only, no tax/expense treatment applied yet</p></div>
        {canManage && (
          <Link to="/fleet/penalties/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
            <Plus className="h-4 w-4" /> Record Penalty
          </Link>
        )}
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search penalties…" persistKey="vehicle-penalties" initialGlobalFilter={searchParams.get('q') ?? undefined} tableName={canManage ? 'vehicle_penalties' : undefined} queryKeys={['vehicle-penalties']} />}
    </div>
  )
}
