import { useMemo, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useStaffDirectory } from '@/hooks/useLookups'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Pill } from '@/components/record/Record'
import type { WorkOrder } from '@/types/database'
import { STALE_DAYS, WO_STATUS, daysSince, useMyJobIds, type WorkOrderBoardRow } from '@/lib/workOrders'
import { BLOCKER_KIND, BlockedIcon, blockerEffect, dayWord, daysBetween, type BlockerKind } from '@/lib/workOrderBlockers'
import { AlertTriangle, CalendarClock, Hammer, Plus, Search, Wrench, HardHat, CheckCircle2 } from 'lucide-react'

type Row = WorkOrder & { projects: { project_name: string } | null }
type Tab = 'mine' | 'attention' | 'blocked' | 'in_progress' | 'requested' | 'completed' | 'cancelled'

const today = () => new Date().toISOString().slice(0, 10)

// What needs a manager now: an open order that is stopped by a blocker,
// late (against its due date pushed by the days it was blocked, 397), or
// that nobody has updated for a few days. A blocked order isn't "stale" —
// the blocker is why.
function attentionOf(w: Row, b: WorkOrderBoardRow | undefined): string | null {
  if (w.status === 'completed' || w.status === 'cancelled') return null
  const eff = blockerEffect(b)
  if (eff?.blocked) {
    const k = BLOCKER_KIND[(b?.main_blocker_kind ?? 'other') as BlockerKind] ?? BLOCKER_KIND.other
    return `Blocked ${eff.since ? dayWord(daysBetween(eff.since)) : ''} — ${k.label.toLowerCase()}`
  }
  const due = b?.adjusted_due_date ?? w.target_completion_date
  if (due && due < today()) return `Late since ${formatDate(due)}`
  const since = daysSince(b?.last_update_at ?? w.created_at)
  if (since != null && since >= STALE_DAYS) return `No update for ${since} days`
  return null
}

export default function WorkOrdersPage() {
  const [params, setParams] = useSearchParams()
  const { role } = useAuth()
  const canManage = ['admin', 'executive', 'operations_manager', 'project_manager'].includes(role ?? '')
  const myJobs = useMyJobIds()
  // A technician comes here for their own jobs; managers for what needs them.
  const tab = (params.get('tab') as Tab) || (role === 'technician' ? 'mine' : 'attention')
  const [q, setQ] = useState(params.get('q') ?? '')
  const [project, setProject] = useState('')

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['work-orders'],
    queryFn: async () => {
      const { data, error } = await supabase.from('work_orders').select('*, projects(project_name)').order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as Row[]
    },
  })
  const { data: board = [] } = useQuery({
    queryKey: ['work-order-board'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_work_order_board').select('*')
      if (error) throw error
      return (data ?? []) as WorkOrderBoardRow[]
    },
  })
  const boardById = useMemo(() => new Map(board.map(b => [b.work_order_id, b])), [board])
  const { data: staffDirectory = [] } = useStaffDirectory()
  const staffName = useMemo(() => new Map((staffDirectory as { id: string; employee_name: string }[]).map(s => [s.id, s.employee_name])), [staffDirectory])

  const projects = useMemo(() => {
    const m = new Map<string, string>()
    for (const o of orders) if (o.projects) m.set(o.project_id, o.projects.project_name)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [orders])

  const needle = q.trim().toLowerCase()
  const filtered = orders.filter(o => (!project || o.project_id === project)
    && (!needle || `${o.title ?? ''} ${o.scope_of_work} ${o.projects?.project_name ?? ''}`.toLowerCase().includes(needle)))
  const inTab = (t: Tab, o: Row) => t === 'mine' ? myJobs.has(o.id) && o.status !== 'cancelled'
    : t === 'attention' ? !!attentionOf(o, boardById.get(o.id))
    : t === 'blocked' ? Number(boardById.get(o.id)?.open_blockers ?? 0) > 0 && o.status !== 'completed' && o.status !== 'cancelled'
    : o.status === t
  const count = (t: Tab) => filtered.filter(o => inTab(t, o)).length
  const shown = filtered.filter(o => inTab(tab, o))
    .sort((a, b) => (a.target_completion_date ?? '9999').localeCompare(b.target_completion_date ?? '9999'))

  const TABS: { key: Tab; label: string }[] = [
    ...(myJobs.size > 0 || role === 'technician' ? [{ key: 'mine' as Tab, label: 'My jobs' }] : []),
    { key: 'attention', label: 'Needs attention' }, { key: 'blocked', label: 'Held up' }, { key: 'in_progress', label: 'In progress' },
    { key: 'requested', label: 'Not started' }, { key: 'completed', label: 'Done' }, { key: 'cancelled', label: 'Cancelled' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Work Orders</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Jobs our own teams do, broken into items. Update what's done from site; progress, status and labour cost follow.</p>
        </div>
        {canManage && (
          <Link to="/work-orders/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
            <Plus className="h-4 w-4" /> New work order
          </Link>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search jobs…"
            className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <select value={project} onChange={e => setProject(e.target.value)} className="rounded-lg border px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
          <option value="">All projects</option>
          {projects.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b dark:border-slate-700">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setParams(p => { const n = new URLSearchParams(p); n.set('tab', t.key); return n }, { replace: true })}
            className={`shrink-0 border-b-2 px-3 pb-2 text-sm font-medium ${tab === t.key ? 'border-brand text-brand' : 'border-transparent text-slate-500'}`}>
            {t.label} <span className={`ml-1 rounded-full px-1.5 text-xs ${t.key === 'attention' && count(t.key) > 0 ? 'bg-amber-100 text-amber-700' : 'text-slate-400'}`}>{count(t.key)}</span>
          </button>
        ))}
      </div>

      {isLoading ? <p className="py-12 text-center text-sm text-slate-400">Loading…</p> : shown.length === 0 ? (
        <p className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
          {tab === 'attention' || tab === 'blocked' ? <><CheckCircle2 className="h-4 w-4 text-emerald-500" /> {tab === 'blocked' ? 'Nothing is holding up an open job.' : 'Every open job is up to date.'}</>
            : tab === 'mine' ? 'No jobs yet. When you lead a work order or are put on its crew, it shows here.' : 'Nothing here.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {shown.map(o => {
            const b = boardById.get(o.id)
            const flag = attentionOf(o, b)
            const pct = Math.round(Number(o.current_progress_pct ?? 0))
            const st = WO_STATUS[o.status] ?? WO_STATUS.requested
            return (
              <Link key={o.id} to={`/work-orders/${o.id}`}
                className={`block rounded-xl border bg-white p-4 transition-colors hover:border-brand dark:bg-slate-800 ${flag?.startsWith('Blocked') ? 'border-red-300 dark:border-red-800' : flag ? 'border-amber-300 dark:border-amber-700' : 'dark:border-slate-700'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-800 dark:text-slate-100">{o.title || o.scope_of_work}</p>
                    <p className="truncate text-xs text-slate-500">{o.projects?.project_name ?? '—'}</p>
                  </div>
                  <span className="shrink-0" title={o.work_type === 'workshop' ? 'Workshop' : 'Site'}>
                    {o.work_type === 'workshop' ? <Hammer className="h-4 w-4 text-amber-500" /> : <Wrench className="h-4 w-4 text-blue-500" />}
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                    <div className={`h-full rounded-full ${o.status === 'completed' ? 'bg-emerald-500' : 'bg-brand'}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                  <span className="w-10 text-right text-xs font-semibold tabular-nums text-slate-600 dark:text-slate-300">{pct}%</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                  <Pill tone={st.tone}>{st.label}</Pill>
                  {b && b.items_total > 0 && <span>{b.items_done}/{b.items_total} items</span>}
                  {o.assigned_lead_staff_id && <span className="truncate">Lead: {staffName.get(o.assigned_lead_staff_id) ?? '—'}</span>}
                  {o.target_completion_date && (
                    <span className="inline-flex items-center gap-1"><CalendarClock className="h-3 w-3" />
                      {b?.days_lost ? <>{formatDate(b.adjusted_due_date)} <span className="text-red-600">(+{b.days_lost}d)</span></> : formatDate(o.target_completion_date)}
                    </span>
                  )}
                  {b && Number(b.open_blockers ?? 0) > 0 && !Number(b.stopping_blockers ?? 0) && <span className="text-amber-600">Slowed: {b.main_blocker}</span>}
                  {b && Number(b.labour_cost) > 0 && <span className="inline-flex items-center gap-1"><HardHat className="h-3 w-3" />{formatCurrency(b.labour_cost)}</span>}
                </div>
                {flag && (
                  <p className={`mt-2 flex items-center gap-1 text-xs font-medium ${flag.startsWith('Blocked') ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'}`}>
                    {flag.startsWith('Blocked') ? <BlockedIcon className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}{flag}
                  </p>
                )}
                {flag?.startsWith('Blocked') && b?.main_blocker && <p className="mt-0.5 truncate text-[11px] text-slate-500">{b.main_blocker}</p>}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
