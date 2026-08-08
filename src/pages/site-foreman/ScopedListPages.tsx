import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { useMySiteForemanProjects } from '@/hooks/useMyStaff'
import { formatDate } from '@/lib/utils'
import { YesterdayNudge } from './YesterdayNudge'
import { Package, AlertTriangle, HardHat, FolderKanban } from 'lucide-react'

// Lightweight scoped-list pages. RLS on the underlying tables already restricts
// what the foreman can read; these pages just wrap the query with a project-in
// filter so the picker mirrors it.
function useScopedProjectIds() {
  const { projects } = useMySiteForemanProjects()
  return useMemo(() => projects.map(p => p.id), [projects])
}

function EmptyState({ icon: Icon, label }: { icon: typeof Package; label: string }) {
  return (
    <div className="rounded-xl border-2 border-dashed dark:border-slate-700 py-12 text-center">
      <Icon className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600 mb-2" />
      <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  )
}

export function MaterialsRequestedPage() {
  const ids = useScopedProjectIds()
  const { data = [], isLoading } = useQuery({
    queryKey: ['foreman-materials', ids],
    queryFn: async () => {
      if (ids.length === 0) return []
      const { data, error } = await supabase.from('stock_issues')
        .select('id, issued_date, quantity, notes, stock_items(item_name, unit), projects(project_name)')
        .in('project_id', ids).order('issued_date', { ascending: false }).limit(200)
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return data as any[]
    },
    enabled: ids.length > 0,
  })

  return (
    <div className="space-y-4">
      <YesterdayNudge />
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <Package className="h-5 w-5 text-brand" /> Materials Requested
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Stock issues on your sites.</p>
      </div>
      {isLoading ? <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
        : data.length === 0 ? <EmptyState icon={Package} label="No materials requested yet." />
        : (
          <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm divide-y dark:divide-slate-700">
            {data.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{r.stock_items?.item_name ?? '—'}</p>
                  <p className="text-xs text-slate-400">{r.projects?.project_name ?? '—'} · {r.issued_date ? formatDate(r.issued_date) : '—'}{r.notes ? ` · ${r.notes}` : ''}</p>
                </div>
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 shrink-0 tabular-nums">{r.quantity} {r.stock_items?.unit ?? ''}</span>
              </div>
            ))}
          </div>
        )}
    </div>
  )
}

export function HseLogPage() {
  const ids = useScopedProjectIds()
  const { data = [], isLoading } = useQuery({
    queryKey: ['foreman-hse', ids],
    queryFn: async () => {
      if (ids.length === 0) return []
      const { data, error } = await supabase.from('hse_incidents')
        .select('id, incident_date, incident_type, severity, description, status, projects(project_name)')
        .in('project_id', ids).order('incident_date', { ascending: false }).limit(200)
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return data as any[]
    },
    enabled: ids.length > 0,
  })

  return (
    <div className="space-y-4">
      <YesterdayNudge />
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-brand" /> HSE Log
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Incidents on your sites.</p>
        </div>
        <Link to="/hse-incidents/new" className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">Log an incident</Link>
      </div>
      {isLoading ? <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
        : data.length === 0 ? <EmptyState icon={AlertTriangle} label="No incidents logged." />
        : (
          <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm divide-y dark:divide-slate-700">
            {data.map(r => (
              <div key={r.id} className="px-4 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{r.incident_type ?? '—'} · {r.severity ?? '—'}</p>
                    <p className="text-xs text-slate-400 truncate">{r.projects?.project_name ?? '—'} · {r.incident_date ? formatDate(r.incident_date) : '—'}</p>
                    {r.description && <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{r.description}</p>}
                  </div>
                  <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-300 shrink-0 capitalize">{r.status ?? '—'}</span>
                </div>
              </div>
            ))}
          </div>
        )}
    </div>
  )
}

export function WorkOrdersOnMySitesPage() {
  const ids = useScopedProjectIds()
  const { data = [], isLoading } = useQuery({
    queryKey: ['foreman-workorders', ids],
    queryFn: async () => {
      if (ids.length === 0) return []
      const { data, error } = await supabase.from('work_orders')
        .select('id, work_type, scope_of_work, status, target_completion_date, projects(project_name)')
        .in('project_id', ids).order('updated_at', { ascending: false }).limit(200)
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return data as any[]
    },
    enabled: ids.length > 0,
  })

  return (
    <div className="space-y-4">
      <YesterdayNudge />
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <HardHat className="h-5 w-5 text-brand" /> Work Orders on My Sites
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">You can update status (progress → completed).</p>
      </div>
      {isLoading ? <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
        : data.length === 0 ? <EmptyState icon={HardHat} label="No work orders on your sites." />
        : (
          <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm divide-y dark:divide-slate-700">
            {data.map(w => (
              <Link key={w.id} to={`/work-orders/${w.id}/edit`} className="block px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/40">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{w.scope_of_work ?? w.work_type ?? 'Work order'}</p>
                    <p className="text-xs text-slate-400 truncate">{w.projects?.project_name ?? '—'}{w.target_completion_date ? ` · target ${formatDate(w.target_completion_date)}` : ''}</p>
                  </div>
                  <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-300 shrink-0 capitalize">{w.status ?? '—'}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
    </div>
  )
}

export function MyProjectsPage() {
  const { projects, isLoading } = useMySiteForemanProjects()
  return (
    <div className="space-y-4">
      <YesterdayNudge />
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <FolderKanban className="h-5 w-5 text-brand" /> My Projects
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Every site you're scoped to.</p>
      </div>
      {isLoading ? <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
        : projects.length === 0 ? <EmptyState icon={FolderKanban} label="You have no active project assignments." />
        : (
          <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm divide-y dark:divide-slate-700">
            {projects.map(p => (
              <Link key={p.id} to={`/projects/${p.id}`} className="block px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/40 text-sm font-medium text-slate-800 dark:text-slate-100">
                {p.project_name}
              </Link>
            ))}
          </div>
        )}
    </div>
  )
}
