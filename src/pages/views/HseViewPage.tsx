import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { RoleViewSwitcher } from '@/components/shared/RoleViewSwitcher'
import { formatDate } from '@/lib/utils'
import type { HseIncident, HseInduction } from '@/types/database'
import { AlertTriangle, ShieldCheck, ArrowRight } from 'lucide-react'

type IncidentRow = HseIncident & { projects: { project_name: string } | null }

function SectionCard({ title, icon: Icon, to, children }: { title: string; icon: React.ElementType; to: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
          <Icon className="h-4 w-4 text-brand" /> {title}
        </h2>
        <Link to={to} className="flex items-center gap-1 text-xs text-slate-400 hover:text-brand">
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      {children}
    </div>
  )
}

// HSE is the least built-out department today (per spec) — this
// composes the two existing pages (incidents, inductions) into a
// landing view rather than inventing new content to fill the page.
export default function HseViewPage() {
  const { role } = useAuth()

  const { data: incidents = [], isLoading: loadingIncidents } = useQuery({
    queryKey: ['hse-view-open-incidents'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hse_incidents')
        .select('*, projects(project_name)')
        .neq('status', 'closed')
        .order('incident_date', { ascending: false })
        .limit(10)
      if (error) throw error
      return data as unknown as IncidentRow[]
    },
  })

  const { data: recentInductions = [], isLoading: loadingInductions } = useQuery({
    queryKey: ['hse-view-recent-inductions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hse_inductions')
        .select('*')
        .order('induction_date', { ascending: false })
        .limit(8)
      if (error) throw error
      return data as HseInduction[]
    },
  })

  const criticalOpen = incidents.filter(i => i.severity === 'critical' || i.severity === 'high').length

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">HSE</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Open incidents and recent inductions</p>
      </div>

      <RoleViewSwitcher mode="base" role={role} />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4">
          <p className="text-xs text-slate-400">Open Incidents</p>
          <p className="mt-1 text-xl font-bold text-blue-600">{incidents.length}</p>
        </div>
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4">
          <p className="text-xs text-slate-400">High/Critical Open</p>
          <p className="mt-1 text-xl font-bold text-red-600">{criticalOpen}</p>
        </div>
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4">
          <p className="text-xs text-slate-400">Recent Inductions</p>
          <p className="mt-1 text-xl font-bold text-emerald-600">{recentInductions.length}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="Open Incidents" icon={AlertTriangle} to="/hse-incidents">
          {loadingIncidents ? (
            <p className="py-6 text-center text-xs text-slate-400">Loading…</p>
          ) : incidents.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No open incidents</p>
          ) : (
            <div className="divide-y dark:divide-slate-700">
              {incidents.map(i => (
                <Link key={i.id} to="/hse-incidents" className="flex items-center justify-between gap-2 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/40 -mx-2 px-2 rounded">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-700 dark:text-slate-200">{i.incident_type.replace('_', ' ')} · {i.projects?.project_name ?? '—'}</p>
                    <p className="text-xs text-slate-400 truncate">{formatDate(i.incident_date)}</p>
                  </div>
                  <StatusBadge status={i.severity} />
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Recent Inductions" icon={ShieldCheck} to="/hse-inductions">
          {loadingInductions ? (
            <p className="py-6 text-center text-xs text-slate-400">Loading…</p>
          ) : recentInductions.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No inductions recorded</p>
          ) : (
            <div className="divide-y dark:divide-slate-700">
              {recentInductions.map(i => (
                <div key={i.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <p className="truncate font-medium text-slate-700 dark:text-slate-200">{i.person_name ?? '—'}</p>
                  <p className="text-xs text-slate-400">{formatDate(i.induction_date)}</p>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  )
}
