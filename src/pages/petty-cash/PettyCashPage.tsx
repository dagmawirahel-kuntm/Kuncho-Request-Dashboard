import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { formatCurrency, cn } from '@/lib/utils'
import type { PettyCashFloat } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { Plus, Pencil, Trash2, Wallet } from 'lucide-react'

type PettyCashFloatRow = PettyCashFloat & {
  staff: { employee_name: string } | null
  projects: { project_name: string } | null
}

export default function PettyCashPage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const { role } = useAuth()
  const qc = useQueryClient()
  const canManage = role === 'admin' || role === 'manager' || role === 'finance' || role === 'project_manager'

  const { data = [], isLoading } = useQuery({
    queryKey: ['petty-cash-floats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('petty_cash_floats')
        .select('*, staff(employee_name), projects(project_name)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as PettyCashFloatRow[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this petty cash float? This cannot be undone.')) return
    const { error } = await supabase.from('petty_cash_floats').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['petty-cash-floats'] })
    toast('Float deleted', 'success')
  }

  const columns: ColumnDef<PettyCashFloatRow>[] = useMemo(() => [
    { id: 'custodian', header: 'Custodian', cell: ({ row }) => row.original.staff?.employee_name ?? '—' },
    { id: 'project', header: 'Project', cell: ({ row }) => row.original.projects?.project_name ?? 'Office-wide' },
    { accessorKey: 'float_amount', header: 'Float Amount', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    {
      accessorKey: 'current_balance', header: 'Current Balance',
      cell: ({ getValue, row }) => (
        <span className={cn('font-semibold', (getValue() as number) < row.original.float_amount * 0.2 ? 'text-amber-600' : 'text-slate-700 dark:text-slate-200')}>
          {formatCurrency(getValue() as number)}
        </span>
      ),
    },
    {
      accessorKey: 'active', header: 'Status',
      cell: ({ getValue }) => (
        <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
          getValue() ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400')}>
          {getValue() ? 'Active' : 'Closed'}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Link to={`/petty-cash/${row.original.id}`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700" title="View"><Wallet className="h-3.5 w-3.5" /></Link>
          {canManage && (
            <>
              <Link to={`/petty-cash/${row.original.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></Link>
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
        <div><h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Petty Cash</h1><p className="text-sm text-slate-500 dark:text-slate-400">Custodian floats, spend, and replenishment</p></div>
        {canManage && (
          <Link to="/petty-cash/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
            <Plus className="h-4 w-4" /> New Float
          </Link>
        )}
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search floats…" persistKey="petty-cash-floats" initialGlobalFilter={searchParams.get('q') ?? undefined} tableName={canManage ? 'petty_cash_floats' : undefined} queryKeys={['petty-cash-floats']} />}
    </div>
  )
}
