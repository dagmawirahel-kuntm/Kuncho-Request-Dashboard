import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable, type QuickFilter } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Contract } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { Plus, Pencil, Trash2, FileText } from 'lucide-react'

const contractQuickFilters: QuickFilter[] = [
  {
    columnId: 'status',
    label: 'Status',
    options: [
      { label: 'Draft', value: 'draft' },
      { label: 'Signed', value: 'signed' },
      { label: 'Active', value: 'active' },
      { label: 'Completed', value: 'completed' },
      { label: 'Terminated', value: 'terminated' },
    ],
  },
]

export default function ContractsPage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { role } = useAuth()
  // Write access (create/edit/delete) is restricted by RLS to sales, admin,
  // and manager roles — mirror that here so the UI matches what the DB allows.
  const canWrite = role === 'admin' || role === 'manager' || (role as string) === 'sales'

  const { data = [], isLoading } = useQuery({
    queryKey: ['contracts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('contracts').select('*, clients(client_name), projects(project_name)').order('created_at', { ascending: false })
      if (error) throw error
      return data as Contract[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this contract? This cannot be undone.')) return
    const { error } = await supabase.from('contracts').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['contracts'] })
    toast('Contract deleted', 'success')
  }

  const columns: ColumnDef<Contract>[] = useMemo(() => {
    const cols: ColumnDef<Contract>[] = [
      { accessorKey: 'contract_no', header: 'Contract No.', cell: ({ getValue }) => <span className="font-mono text-xs font-bold text-brand">{(getValue() as string) ?? '—'}</span> },
      { id: 'client_name', header: 'Client', cell: ({ row }) => (row.original as any).clients?.client_name ?? '—' },
      { id: 'project_name', header: 'Project', cell: ({ row }) => (row.original as any).projects?.project_name ?? '—' },
      { accessorKey: 'contract_value', header: 'Value (ETB)', cell: ({ getValue }) => formatCurrency(getValue() as number) },
      { accessorKey: 'signed_date', header: 'Signed Date', cell: ({ getValue }) => formatDate(getValue() as string) },
      { accessorKey: 'status', header: 'Status', filterFn: 'equals', cell: ({ getValue }) => getValue() ? <StatusBadge status={getValue() as string} /> : '—' },
      {
        id: 'document', header: 'Document',
        cell: ({ row }) => row.original.document_url ? (
          <a
            href={row.original.document_url} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-brand hover:underline"
            title={row.original.document_name ?? 'View document'}
          >
            <FileText className="h-3.5 w-3.5" /> View
          </a>
        ) : <span className="text-xs text-slate-300 dark:text-slate-600">—</span>,
      },
    ]
    if (canWrite) {
      cols.push({
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <Link to={`/contracts/${row.original.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200" title="Edit"><Pencil className="h-3.5 w-3.5" /></Link>
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
        <div><h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Contracts</h1><p className="text-sm text-slate-500 dark:text-slate-400">KUN/CON client contracts</p></div>
        {canWrite && (
          <Link to="/contracts/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
            <Plus className="h-4 w-4" /> New Contract
          </Link>
        )}
      </div>
      {isLoading ? (
        <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
      ) : (
        <DataTable
          columns={columns}
          data={data}
          searchPlaceholder="Search contracts…"
          persistKey="contracts"
          initialGlobalFilter={searchParams.get('q') ?? undefined}
          tableName={canWrite ? 'contracts' : undefined}
          queryKeys={['contracts']}
          quickFilters={contractQuickFilters}
        />
      )}
    </div>
  )
}
