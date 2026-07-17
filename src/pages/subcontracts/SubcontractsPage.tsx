import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatCurrency } from '@/lib/utils'
import type { SubcontractorEngagement } from '@/types/database'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { Plus, Eye, Trash2 } from 'lucide-react'

type SubcontractRow = SubcontractorEngagement & {
  vendors: { vendor_name: string } | null
  projects: { project_name: string } | null
}

const WRITE_ROLES = ['admin', 'manager', 'project_manager', 'procurement_officer']

export default function SubcontractsPage() {
  const [searchParams] = useSearchParams()
  const { role } = useAuth()
  const canWrite = !!role && WRITE_ROLES.includes(role)
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['subcontractor-engagements'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subcontractor_engagements')
        .select('*, vendors(vendor_name), projects(project_name)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as SubcontractRow[]
    },
  })

  // Lightweight second query: which engagements have at least one certificate.
  const { data: certRows = [] } = useQuery({
    queryKey: ['subcontract-cert-engagement-ids'],
    queryFn: async () => {
      const { data, error } = await supabase.from('subcontractor_completion_certificates').select('engagement_id')
      if (error) throw error
      return data as { engagement_id: string }[]
    },
  })
  const engagementsWithCerts = useMemo(() => new Set(certRows.map(c => c.engagement_id)), [certRows])

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this engagement? This cannot be undone.')) return
    const { error } = await supabase.from('subcontractor_engagements').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['subcontractor-engagements'] })
    toast('Engagement deleted', 'success')
  }

  const columns: ColumnDef<SubcontractRow>[] = useMemo(() => [
    { id: 'vendor_name', header: 'Vendor', cell: ({ row }) => row.original.vendors?.vendor_name ?? '—' },
    { id: 'project_name', header: 'Project', cell: ({ row }) => row.original.projects?.project_name ?? '—' },
    {
      accessorKey: 'scope_of_work',
      header: 'Scope of Work',
      cell: ({ getValue }) => {
        const v = (getValue() as string) ?? ''
        return <span className="text-slate-500 dark:text-slate-400 truncate block max-w-xs">{v ? (v.length > 60 ? `${v.slice(0, 60)}…` : v) : '—'}</span>
      },
    },
    { accessorKey: 'agreed_amount', header: 'Agreed Amount (ETB)', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    {
      accessorKey: 'percent_complete',
      header: '% Complete',
      cell: ({ getValue }) => {
        const pct = Math.max(0, Math.min(100, (getValue() as number) ?? 0))
        return (
          <div className="flex items-center gap-2 w-28">
            <div className="h-1.5 flex-1 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
              <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">{pct}%</span>
          </div>
        )
      },
    },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
    {
      id: 'certificates',
      header: 'Certificates',
      cell: ({ row }) => engagementsWithCerts.has(row.original.id)
        ? <span className="text-xs text-green-600 dark:text-green-400 font-medium">Certified</span>
        : <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">None yet</span>,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Link to={`/subcontracts/${row.original.id}`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200" title="View">
            <Eye className="h-3.5 w-3.5" />
          </Link>
          {canWrite && (
            <button onClick={() => handleDelete(row.original.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20" title="Delete">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [engagementsWithCerts, canWrite])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Subcontract Engagements</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Subcontractor scopes of work, agreed amounts and completion certificates</p>
        </div>
        {canWrite && (
          <Link to="/subcontracts/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
            <Plus className="h-4 w-4" /> New Engagement
          </Link>
        )}
      </div>
      {isLoading ? (
        <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
      ) : (
        <DataTable
          columns={columns}
          data={data}
          searchPlaceholder="Search engagements…"
          persistKey="subcontracts"
          initialGlobalFilter={searchParams.get('q') ?? undefined}
          tableName={canWrite ? 'subcontractor_engagements' : undefined}
          queryKeys={['subcontractor-engagements']}
        />
      )}
    </div>
  )
}
