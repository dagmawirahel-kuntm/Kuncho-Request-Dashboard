import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable, type QuickFilter } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatDate } from '@/lib/utils'
import type { HseIncident, HseIncidentType, HseSeverity } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { Plus, Pencil, Trash2 } from 'lucide-react'

type HseIncidentRow = HseIncident & { projects: { project_name: string } | null }

const INCIDENT_TYPE_LABELS: Record<HseIncidentType, string> = {
  near_miss: 'Near Miss',
  first_aid: 'First Aid',
  injury: 'Injury',
  property_damage: 'Property Damage',
  environmental: 'Environmental',
  other: 'Other',
}

const SEVERITY_CLS: Record<HseSeverity, string> = {
  low: 'text-slate-600 bg-slate-100 dark:bg-slate-700 dark:text-slate-300',
  medium: 'text-yellow-700 bg-yellow-100 dark:bg-yellow-900/40 dark:text-yellow-300',
  high: 'text-orange-700 bg-orange-100 dark:bg-orange-900/40 dark:text-orange-300',
  critical: 'text-red-700 bg-red-100 dark:bg-red-900/40 dark:text-red-300',
}

function SeverityBadge({ severity }: { severity: HseSeverity | null }) {
  if (!severity) return <span>—</span>
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${SEVERITY_CLS[severity]}`}>
      {severity}
    </span>
  )
}

const hseIncidentQuickFilters: QuickFilter[] = [
  {
    columnId: 'severity',
    label: 'Severity',
    options: [
      { label: 'Low', value: 'low' },
      { label: 'Medium', value: 'medium' },
      { label: 'High', value: 'high' },
      { label: 'Critical', value: 'critical' },
    ],
  },
  {
    columnId: 'status',
    label: 'Status',
    options: [
      { label: 'Open', value: 'open' },
      { label: 'Investigating', value: 'investigating' },
      { label: 'Closed', value: 'closed' },
    ],
  },
]

export default function HseIncidentsPage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { role } = useAuth()
  const canWrite = role === 'admin' || role === 'manager' || (role as string) === 'hse_officer'

  const { data = [], isLoading } = useQuery({
    queryKey: ['hse-incidents'],
    queryFn: async () => {
      const { data, error } = await supabase.from('hse_incidents').select('*, projects(project_name)').order('incident_date', { ascending: false })
      if (error) throw error
      return data as unknown as HseIncidentRow[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this incident record? This cannot be undone.')) return
    const { error } = await supabase.from('hse_incidents').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['hse-incidents'] })
    toast('Incident deleted', 'success')
  }

  const columns: ColumnDef<HseIncidentRow>[] = useMemo(() => [
    { accessorKey: 'incident_date', header: 'Date', cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'incident_type', header: 'Type', cell: ({ getValue }) => INCIDENT_TYPE_LABELS[getValue() as HseIncidentType] ?? getValue() },
    { accessorKey: 'severity', header: 'Severity', cell: ({ getValue }) => <SeverityBadge severity={getValue() as HseSeverity} /> },
    { id: 'project_name', header: 'Project', cell: ({ row }) => row.original.projects?.project_name ?? '—' },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => getValue() ? <StatusBadge status={(getValue() as string).toLowerCase()} /> : '—' },
    { accessorKey: 'description', header: 'Description', cell: ({ getValue }) => <span className="text-slate-500 dark:text-slate-400 truncate block max-w-xs">{(getValue() as string) ?? '—'}</span> },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          {canWrite && (
            <>
              <Link to={`/hse-incidents/${row.original.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></Link>
              <button onClick={() => handleDelete(row.original.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
            </>
          )}
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [canWrite])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">HSE Incidents</h1><p className="text-sm text-slate-500 dark:text-slate-400">Health, safety & environment incident log</p></div>
        {canWrite && (
          <Link to="/hse-incidents/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
            <Plus className="h-4 w-4" /> New Incident
          </Link>
        )}
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div> : (
        <DataTable
          columns={columns}
          data={data}
          searchPlaceholder="Search incidents…"
          persistKey="hse-incidents"
          initialGlobalFilter={searchParams.get('q') ?? undefined}
          tableName={canWrite ? 'hse_incidents' : undefined}
          queryKeys={['hse-incidents']}
          quickFilters={hseIncidentQuickFilters}
        />
      )}
    </div>
  )
}
