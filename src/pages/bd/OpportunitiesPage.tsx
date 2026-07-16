import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable, type QuickFilter } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Opportunity } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { Plus, Pencil, Trash2 } from 'lucide-react'

const opportunityQuickFilters: QuickFilter[] = [
  {
    columnId: 'stage',
    label: 'Stage',
    options: [
      { label: 'Lead', value: 'lead' },
      { label: 'Qualified', value: 'qualified' },
      { label: 'Quoted', value: 'quoted' },
      { label: 'Won', value: 'won' },
      { label: 'Lost', value: 'lost' },
    ],
  },
]

export default function OpportunitiesPage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { role } = useAuth()
  // Write access (create/edit/delete) is restricted by RLS to sales, admin,
  // and manager roles — mirror that here so the UI matches what the DB allows.
  const canWrite = role === 'admin' || role === 'manager' || (role as string) === 'sales'

  const { data = [], isLoading } = useQuery({
    queryKey: ['opportunities'],
    queryFn: async () => {
      const { data, error } = await supabase.from('opportunities').select('*, clients(client_name), staff:owner_staff_id(employee_name)').order('created_at', { ascending: false })
      if (error) throw error
      return data as Opportunity[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this opportunity? This cannot be undone.')) return
    const { error } = await supabase.from('opportunities').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['opportunities'] })
    toast('Opportunity deleted', 'success')
  }

  const columns: ColumnDef<Opportunity>[] = useMemo(() => {
    const cols: ColumnDef<Opportunity>[] = [
      { accessorKey: 'title', header: 'Title', cell: ({ getValue }) => <span className="max-w-xs truncate block font-medium text-slate-800 dark:text-slate-100">{(getValue() as string) ?? '—'}</span> },
      {
        id: 'client_or_prospect',
        header: 'Client / Prospect',
        cell: ({ row }) => (row.original as any).clients?.client_name ?? row.original.prospect_name ?? '—',
      },
      { accessorKey: 'estimated_value', header: 'Est. Value (ETB)', cell: ({ getValue }) => formatCurrency(getValue() as number) },
      { accessorKey: 'stage', header: 'Stage', filterFn: 'equals', cell: ({ getValue }) => getValue() ? <StatusBadge status={getValue() as string} /> : '—' },
      { id: 'owner_name', header: 'Owner', cell: ({ row }) => (row.original as any).staff?.employee_name ?? '—' },
      { accessorKey: 'expected_close_date', header: 'Expected Close', cell: ({ getValue }) => formatDate(getValue() as string) },
    ]
    if (canWrite) {
      cols.push({
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <Link to={`/opportunities/${row.original.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200" title="Edit"><Pencil className="h-3.5 w-3.5" /></Link>
            <button onClick={() => handleDelete(row.original.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ),
      })
    }
    return cols
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canWrite])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Opportunities</h1><p className="text-sm text-slate-500 dark:text-slate-400">Pre-sale pipeline</p></div>
        {canWrite && (
          <Link to="/opportunities/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
            <Plus className="h-4 w-4" /> New Opportunity
          </Link>
        )}
      </div>
      {isLoading ? (
        <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
      ) : (
        <DataTable
          columns={columns}
          data={data}
          searchPlaceholder="Search opportunities…"
          persistKey="opportunities"
          initialGlobalFilter={searchParams.get('q') ?? undefined}
          tableName={canWrite ? 'opportunities' : undefined}
          queryKeys={['opportunities']}
          quickFilters={opportunityQuickFilters}
        />
      )}
    </div>
  )
}
