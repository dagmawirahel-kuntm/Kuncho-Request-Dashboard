import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { Pill, Stat, type Tone } from '@/components/record/Record'
import { formatDate, formatCurrency } from '@/lib/utils'
import type { LaborRequisition } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { Plus, Pencil, Trash2, Check, Eye, AlertTriangle, UserX } from 'lucide-react'

type Row = LaborRequisition & { projects: { project_name: string } | null }
type Tab = 'pending' | 'short' | 'on_site' | 'ending' | 'overdue' | 'done' | 'all'

const today = () => new Date().toISOString().slice(0, 10)
const inDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const daysSince = (d: string) => Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000))

export default function LaborRequisitionsPage() {
  const [params, setParams] = useSearchParams()
  const { toast } = useToast()
  const { role } = useAuth()
  const qc = useQueryClient()
  const tab = (params.get('tab') as Tab) || 'pending'
  const setTab = (t: Tab) => setParams(p => { const n = new URLSearchParams(p); n.set('tab', t); return n }, { replace: true })

  // Raise/edit matches the INSERT policy; approving is HR and admin only
  // (enforce_labor_req_approval_authority); deleting matches DELETE.
  const canRequest = role === 'admin' || role === 'executive' || role === 'project_manager' || role === 'operations_manager' || role === 'hr_officer'
  const canApprove = role === 'admin' || role === 'hr_officer'
  const canDelete = role === 'admin' || role === 'operations_manager' || role === 'hr_officer'
  const canTidy = canDelete || role === 'executive'

  const { data = [], isLoading } = useQuery({
    queryKey: ['labor-requisitions'],
    queryFn: async () => {
      const { data, error } = await supabase.from('labor_requisitions').select('*, projects(project_name)')
        .order('role_needed', { ascending: true }).order('created_at', { ascending: false })
      if (error) throw error
      return data as Row[]
    },
  })
  // Workers still on requisitions that have ended.
  const { data: onSite = [] } = useQuery({
    queryKey: ['labor-requisitions', 'active-allocations'],
    queryFn: async () => {
      const { data, error } = await supabase.from('labor_allocations').select('labor_requisition_id, end_date').in('status', ['active', 'planned'])
      if (error) throw error
      return (data ?? []) as { labor_requisition_id: string | null; end_date: string | null }[]
    },
  })
  const activeByReq = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of onSite) if (a.labor_requisition_id) m.set(a.labor_requisition_id, (m.get(a.labor_requisition_id) ?? 0) + 1)
    return m
  }, [onSite])

  const t0 = today(), soon = inDays(7)
  const buckets = useMemo(() => {
    const open = (r: Row) => r.status === 'approved' && !r.closed_at
    const ended = (r: Row) => !!r.end_date && r.end_date < t0
    return {
      pending: data.filter(r => r.status === 'pending'),
      short: data.filter(r => open(r) && !ended(r) && r.slots_filled < r.headcount),
      on_site: data.filter(r => open(r) && !ended(r) && (activeByReq.get(r.id) ?? 0) > 0),
      ending: data.filter(r => open(r) && !!r.end_date && r.end_date >= t0 && r.end_date <= soon),
      overdue: data.filter(r => r.status === 'approved' && ended(r) && (activeByReq.get(r.id) ?? 0) > 0),
      done: data.filter(r => r.status === 'rejected' || !!r.closed_at || (r.status === 'approved' && ended(r) && !activeByReq.get(r.id))),
      all: data,
    } as Record<Tab, Row[]>
  }, [data, activeByReq, t0, soon])

  const TABS: { id: Tab; label: string; tone?: Tone }[] = [
    { id: 'pending', label: 'Waiting for a decision', tone: 'amber' },
    { id: 'short', label: 'Short of workers', tone: 'red' },
    { id: 'on_site', label: 'On site' },
    { id: 'ending', label: 'Ending this week' },
    { id: 'overdue', label: 'Past end date', tone: 'red' },
    { id: 'done', label: 'Closed & rejected' },
    { id: 'all', label: 'All' },
  ]

  async function approve(id: string) {
    const { error } = await supabase.from('labor_requisitions').update({ status: 'approved' }).eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['labor-requisitions'] })
    toast('Approved', 'success')
  }
  async function remove(id: string) {
    if (!window.confirm('Delete this labour requisition? This cannot be undone.')) return
    const { error } = await supabase.from('labor_requisitions').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['labor-requisitions'] })
    toast('Deleted', 'success')
  }
  async function releaseExpired() {
    const { data: n, error } = await supabase.rpc('complete_expired_labor_allocations', { p_req: null })
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['labor-requisitions'] })
    toast(n ? `${n} worker${n === 1 ? '' : 's'} released from ended requisitions` : 'Nobody to release — everyone left has recorded work after the end date.', n ? 'success' : 'info')
  }

  const columns: ColumnDef<Row>[] = useMemo(() => [
    { id: 'project_name', accessorFn: r => r.projects?.project_name ?? 'No project', header: 'Project' },
    {
      accessorKey: 'role_needed', header: 'Role',
      cell: ({ row: { original: r } }) => (
        <Link to={`/labor-requisitions/${r.id}`} className="font-medium text-slate-800 hover:text-brand dark:text-slate-100">{r.role_needed}</Link>
      ),
    },
    {
      id: 'placed', header: 'Placed', accessorFn: r => r.slots_filled / Math.max(r.headcount, 1),
      cell: ({ row: { original: r } }) => r.status !== 'approved' ? <span className="text-slate-400">{r.headcount} needed</span> : (
        <span className={`tabular-nums ${r.slots_filled >= r.headcount ? 'text-emerald-600' : r.slots_filled > 0 ? 'text-amber-600' : 'text-red-600'}`}>{r.slots_filled} of {r.headcount}</span>
      ),
    },
    {
      id: 'dates', header: 'Dates', accessorFn: r => r.start_date,
      cell: ({ row: { original: r } }) => (
        <span className={`whitespace-nowrap text-xs ${r.end_date && r.end_date < t0 && activeByReq.get(r.id) ? 'font-semibold text-red-600' : 'text-slate-500'}`}>
          {formatDate(r.start_date)} → {r.end_date ? formatDate(r.end_date) : 'open'}
        </span>
      ),
    },
    {
      id: 'cost', header: 'Estimate', accessorFn: r => r.estimated_total_cost ?? 0,
      cell: ({ row: { original: r } }) => r.estimated_total_cost ? <span className="tabular-nums">{formatCurrency(r.estimated_total_cost)}</span> : <span className="text-xs text-amber-600">No estimate</span>,
    },
    {
      id: 'status', header: 'Status', accessorFn: r => r.status,
      cell: ({ row: { original: r } }) => {
        const n = activeByReq.get(r.id) ?? 0
        if (r.status === 'pending') {
          const d = daysSince(r.created_at)
          return <Pill tone={d > 7 ? 'red' : 'amber'}>Waiting {d === 0 ? 'since today' : `${d} day${d === 1 ? '' : 's'}`}</Pill>
        }
        if (r.status === 'rejected') return <Pill tone="red">Rejected</Pill>
        if (r.closed_at) return <Pill>Closed</Pill>
        if (r.end_date && r.end_date < t0) return n ? <Pill tone="red" icon={AlertTriangle}>{n} past end</Pill> : <Pill>Ended</Pill>
        return n ? <Pill tone="green">{n} on site</Pill> : <Pill tone="blue">Approved</Pill>
      },
    },
    {
      id: 'actions', header: '',
      cell: ({ row: { original: r } }) => (
        <div className="flex items-center gap-1">
          <Link to={`/labor-requisitions/${r.id}`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700" title="Open"><Eye className="h-3.5 w-3.5" /></Link>
          {canApprove && r.status === 'pending' && (
            <button onClick={() => approve(r.id)} className="rounded p-1 text-slate-400 hover:bg-green-50 hover:text-green-600 dark:hover:bg-green-900/30" title="Approve (open it to reject with a reason)"><Check className="h-3.5 w-3.5" /></button>
          )}
          {canRequest && r.status === 'pending' && (
            <Link to={`/labor-requisitions/${r.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></Link>
          )}
          {canDelete && r.status !== 'approved' && (
            <button onClick={() => remove(r.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
          )}
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [canApprove, canRequest, canDelete, activeByReq, t0])

  const pendingValue = buckets.pending.reduce((s, r) => s + Number(r.estimated_total_cost ?? 0), 0)
  const oldestPending = buckets.pending.reduce((m, r) => Math.max(m, daysSince(r.created_at)), 0)
  const onSiteCount = [...activeByReq.values()].reduce((s, n) => s + n, 0)
  const overdueWorkers = buckets.overdue.reduce((s, r) => s + (activeByReq.get(r.id) ?? 0), 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Labour requisitions</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Requests for workers on a project, from the ask to the people on site.</p>
        </div>
        {canRequest && (
          <Link to="/labor-requisitions/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
            <Plus className="h-4 w-4" /> New requisition
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Waiting for a decision" value={buckets.pending.length} tone={oldestPending > 7 ? 'red' : buckets.pending.length ? 'amber' : undefined}
          sub={buckets.pending.length ? `${formatCurrency(pendingValue)} · oldest ${oldestPending} days` : 'None'} />
        <Stat label="Short of workers" value={buckets.short.length} tone={buckets.short.length ? 'red' : undefined}
          sub={`${buckets.short.reduce((s, r) => s + (r.headcount - r.slots_filled), 0)} places to fill`} />
        <Stat label="Workers on site" value={onSiteCount} sub={`${buckets.on_site.length} requisitions`} />
        <Stat label="Past end date" value={overdueWorkers} tone={overdueWorkers ? 'red' : undefined} sub={`${buckets.overdue.length} requisitions to extend or end`} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {TABS.map(t => {
          const n = buckets[t.id].length
          const on = tab === t.id
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${on ? 'border-brand bg-brand text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
              {t.label} <span className={on ? 'text-white/80' : t.tone === 'red' && n ? 'font-bold text-red-600' : t.tone === 'amber' && n ? 'font-bold text-amber-600' : 'text-slate-400'}>{n}</span>
            </button>
          )
        })}
        {tab === 'overdue' && canTidy && buckets.overdue.length > 0 && (
          <button onClick={releaseExpired} className="ml-auto inline-flex items-center gap-1 rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-900/20"
            title="Finish the allocations of workers with no work recorded after their requisition ended">
            <UserX className="h-3.5 w-3.5" /> Release those with no work since the end
          </button>
        )}
      </div>

      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : (
        <DataTable columns={columns} data={buckets[tab]} searchPlaceholder="Search by role or project…" persistKey={`labor-requisitions-${tab}`}
          initialGlobalFilter={params.get('q') ?? undefined} groupBy={{ columnId: 'project_name', kind: 'text' }} />
      )}
    </div>
  )
}
