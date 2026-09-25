import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable, type QuickFilter } from '@/components/shared/DataTable'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Opportunity, OpportunityStage } from '@/types/database'
import { OPEN_STAGES, SOURCE_LABEL, STAGES, STAGE_BY_VALUE } from '@/lib/salesJourney'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { Plus, Pencil, Trash2 } from 'lucide-react'

const opportunityQuickFilters: QuickFilter[] = [
  {
    columnId: 'stage',
    label: 'Stage',
    options: STAGES.map(s => ({ label: s.label, value: s.value })),
  },
]

type Row = Opportunity & {
  clients?: { client_name: string } | null
  staff?: { employee_name: string } | null
  brought_by?: { employee_name: string } | null
}

export default function OpportunitiesPage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { role } = useAuth()
  // Write access matches RLS: sales, admin, executive and — since finance
  // keeps the sales record (migration 330) — finance.
  const canWrite = role === 'admin' || role === 'executive' || role === 'finance' || (role as string) === 'sales'

  const { data = [], isLoading } = useQuery({
    queryKey: ['opportunities'],
    queryFn: async () => {
      const { data, error } = await supabase.from('opportunities')
        .select('*, clients(client_name), staff:owner_staff_id(employee_name), brought_by:brought_by_staff_id(employee_name)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Row[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this opportunity? This cannot be undone.')) return
    const { error } = await supabase.from('opportunities').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['opportunities'] })
    toast('Opportunity deleted', 'success')
  }

  // The pipeline at a glance: what is in play at each stage, and how deals end.
  const pipeline = useMemo(() => {
    const by = (st: OpportunityStage) => data.filter(o => o.stage === st)
    const sum = (rows: Row[]) => rows.reduce((t, o) => t + Number(o.estimated_value ?? 0), 0)
    const won = by('won'), lost = by('lost')
    return {
      open: OPEN_STAGES.map(st => ({ ...STAGE_BY_VALUE[st], count: by(st).length, value: sum(by(st)) })),
      won: { count: won.length, value: sum(won) },
      lost: lost.length,
      winRate: won.length + lost.length > 0 ? Math.round((won.length / (won.length + lost.length)) * 100) : null,
    }
  }, [data])

  const columns: ColumnDef<Row>[] = useMemo(() => {
    const cols: ColumnDef<Row>[] = [
      { accessorKey: 'title', header: 'Title', cell: ({ getValue }) => <span className="max-w-xs truncate block font-medium text-slate-800 dark:text-slate-100">{(getValue() as string) ?? '—'}</span> },
      {
        id: 'client_or_prospect',
        header: 'Client / Prospect',
        cell: ({ row }) => row.original.clients?.client_name ?? row.original.prospect_name ?? '—',
      },
      { accessorKey: 'estimated_value', header: 'Est. Value (ETB)', cell: ({ getValue }) => formatCurrency(getValue() as number) },
      {
        accessorKey: 'stage', header: 'Stage', filterFn: 'equals',
        cell: ({ row }) => {
          const st = STAGE_BY_VALUE[row.original.stage]
          return st
            ? <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.cls}`} title={row.original.lost_reason ?? undefined}>{st.label}</span>
            : '—'
        },
      },
      {
        id: 'source', header: 'Came from',
        accessorFn: r => [r.source ? SOURCE_LABEL[r.source] : null, r.brought_by?.employee_name, r.referrer_name].filter(Boolean).join(' · '),
        cell: ({ getValue }) => <span className="text-xs text-slate-600 dark:text-slate-300">{(getValue() as string) || '—'}</span>,
      },
      { id: 'owner_name', header: 'Owner', cell: ({ row }) => row.original.staff?.employee_name ?? '—' },
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
        <div><h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Opportunities</h1><p className="text-sm text-slate-500 dark:text-slate-400">Every deal from first contact to won or lost</p></div>
        {canWrite && (
          <Link to="/opportunities/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
            <Plus className="h-4 w-4" /> New Opportunity
          </Link>
        )}
      </div>
      {data.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {pipeline.open.map(st => (
            <div key={st.value} className="rounded-lg border bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
              <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.cls}`}>{st.label}</span>
              <p className="mt-1 text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(st.value)}</p>
              <p className="text-[10px] text-slate-400">{st.count} deal{st.count === 1 ? '' : 's'}</p>
            </div>
          ))}
          <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 dark:border-green-800/40 dark:bg-green-900/20">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-green-700 dark:text-green-300">Won</p>
            <p className="mt-1 text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(pipeline.won.value)}</p>
            <p className="text-[10px] text-slate-400">{pipeline.won.count} won · {pipeline.lost} lost</p>
          </div>
          <div className="rounded-lg border bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Win rate</p>
            <p className="mt-1 text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">{pipeline.winRate == null ? '—' : `${pipeline.winRate}%`}</p>
            <p className="text-[10px] text-slate-400">of deals decided</p>
          </div>
        </div>
      )}
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
