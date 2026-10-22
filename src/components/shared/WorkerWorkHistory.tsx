import { Link } from 'react-router-dom'
import { Building2, ClipboardList } from 'lucide-react'
import { useWorkerWorkHistory, type WorkerProject, type WorkerWorkOrder } from '@/hooks/useTier2Workers'
import { formatDate } from '@/lib/utils'

const STATUS: Record<string, string> = { requested: 'Not started', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled', on_hold: 'On hold' }
const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`
const span = (a: string | null, b: string | null) => !a ? null : a === b || !b ? formatDate(a) : `${formatDate(a)} – ${formatDate(b)}`

function Now() {
  return <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">Now</span>
}

/** "On Plastering of stairs · Solomon Apartment" — the work orders and projects a worker is on now. */
export function WorkerCurrentWork({ staffId }: { staffId: string }) {
  const { data, isLoading } = useWorkerWorkHistory(staffId)
  if (isLoading) return <span className="text-slate-400">…</span>
  const wos = (data?.workOrders ?? []).filter(w => w.current)
  const projects = (data?.projects ?? []).filter(p => p.current)
  if (!wos.length && !projects.length) return <span className="text-slate-400">Not on a site now</span>
  return (
    <div className="space-y-0.5">
      {wos.map(w => <Link key={w.id} to={`/work-orders/${w.id}`} className="block text-brand hover:underline">{w.title}</Link>)}
      {projects.filter(p => !wos.some(w => w.project_id === p.project_id)).map(p => (
        <Link key={p.project_id} to={`/projects/${p.project_id}`} className="block text-brand hover:underline">{p.project_name}</Link>
      ))}
      {wos.length > 0 && <span className="block text-xs text-slate-500">{[...new Set(wos.map(w => w.project_name).filter(Boolean))].join(', ')}</span>}
    </div>
  )
}

/** The work orders a worker has been put on and the projects they've worked on (migration 459). */
export function WorkerWorkHistory({ staffId }: { staffId: string }) {
  const { data, isLoading, error } = useWorkerWorkHistory(staffId)
  if (isLoading) return <p className="text-sm text-slate-400">Loading…</p>
  if (error) return <p className="text-sm text-red-600">{(error as Error).message}</p>
  const { workOrders = [], projects = [] } = data ?? {}

  return (
    <div className="space-y-5">
      <section>
        <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400"><Building2 className="h-3.5 w-3.5" /> Projects</h4>
        {projects.length === 0 ? <p className="text-sm text-slate-400">No project work recorded yet.</p> : (
          <div className="divide-y rounded-lg border text-sm dark:divide-slate-700 dark:border-slate-700">
            {projects.map((p: WorkerProject) => (
              <div key={p.project_id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link to={`/projects/${p.project_id}`} className="truncate font-medium text-slate-700 hover:text-brand dark:text-slate-200">{p.project_name}</Link>
                    {p.current && <Now />}
                  </div>
                  <p className="text-xs text-slate-500">
                    {span(p.first_day, p.last_day) ?? 'No days recorded yet'}
                    {p.work_orders > 0 ? ` · ${p.work_orders} work order${p.work_orders === 1 ? '' : 's'}` : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{days(p.days)}</p>
                  {p.hours ? <p className="text-[11px] text-slate-400">{Number(p.hours).toLocaleString()} h</p> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400"><ClipboardList className="h-3.5 w-3.5" /> Work orders</h4>
        {workOrders.length === 0 ? <p className="text-sm text-slate-400">Not put on a work order yet.</p> : (
          <div className="divide-y rounded-lg border text-sm dark:divide-slate-700 dark:border-slate-700">
            {workOrders.map((w: WorkerWorkOrder) => (
              <div key={w.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link to={`/work-orders/${w.id}`} className="truncate font-medium text-slate-700 hover:text-brand dark:text-slate-200">{w.title}</Link>
                    {w.current && <Now />}
                  </div>
                  <p className="text-xs text-slate-500">
                    {w.project_name ?? '—'} · {STATUS[w.status] ?? w.status.replace(/_/g, ' ')}
                    {w.role_on_wo ? ` · ${w.role_on_wo}` : ''}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {w.crew_since ? `On the crew from ${formatDate(w.crew_since)}${w.crew_until ? ` to ${formatDate(w.crew_until)}` : ''}` : 'Through a labour request'}
                    {w.last_day ? ` · last worked ${formatDate(w.last_day)}` : ''}
                  </p>
                </div>
                <p className="shrink-0 font-semibold tabular-nums text-slate-800 dark:text-slate-100">{w.days ? days(w.days) : '—'}</p>
              </div>
            ))}
          </div>
        )}
        {projects.some(p => p.days > workOrders.filter(w => w.project_id === p.project_id).reduce((s, w) => s + w.days, 0)) && (
          <p className="mt-1.5 text-[11px] text-slate-400">Some days were recorded on labour requests not linked to a work order, so they count for the project only.</p>
        )}
      </section>
    </div>
  )
}
