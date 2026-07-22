import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { RoleViewSwitcher } from '@/components/shared/RoleViewSwitcher'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Project, SourcingBundle, VehicleMaintenanceRequest, VehiclePenalty } from '@/types/database'
import { Briefcase, ShoppingCart, GitPullRequestArrow, Truck, AlertTriangle, ArrowRight, ArrowUpDown } from 'lucide-react'

interface BudgetSummary {
  project_id: string
  total_budget: number
  total_actual_core: number
  total_committed_core: number
  any_group_over_budget: boolean
  projected_margin_core: number | null
}
interface VariationRow {
  id: string
  project_id: string
  requested_amount_delta: number
  reason: string | null
  status: string
  created_at: string
  cost_groups: { name: string } | null
  projects: { project_name: string } | null
}
type SubmittedBundle = SourcingBundle & { vendors: { vendor_name: string } | null }
type MaintenanceRow = VehicleMaintenanceRequest & { vehicles: { name: string; plate_number: string | null } | null }
type PenaltyRow = VehiclePenalty & { vehicles: { name: string; plate_number: string | null } | null }

type SortKey = 'name' | 'utilization' | 'margin'

function SectionCard({ title, icon: Icon, to, count, children }: { title: string; icon: React.ElementType; to: string; count?: number; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
          <Icon className="h-4 w-4 text-brand" /> {title}
          {count != null && count > 0 && (
            <span className="rounded-full bg-brand/10 text-brand px-1.5 py-0.5 text-[10px] font-semibold">{count}</span>
          )}
        </h2>
        <Link to={to} className="flex items-center gap-1 text-xs text-slate-400 hover:text-brand">
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      {children}
    </div>
  )
}

export default function OperationsManagerViewPage() {
  const { role } = useAuth()
  const [sortKey, setSortKey] = useState<SortKey>('utilization')

  const { data: projects = [] } = useQuery({
    queryKey: ['ops-view-projects'],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('*').order('project_name')
      if (error) throw error
      return data as Project[]
    },
  })

  const { data: summaries = [], isLoading: loadingPortfolio } = useQuery({
    queryKey: ['ops-view-portfolio-summary'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_project_budget_summary').select('*')
      if (error) throw error
      return data as BudgetSummary[]
    },
  })

  const { data: bundles = [], isLoading: loadingBundles } = useQuery({
    queryKey: ['ops-view-po-queue'],
    queryFn: async () => {
      // RLS itself caps this to bundles <= ETB 500,000 for operations_manager (133)
      const { data, error } = await supabase
        .from('sourcing_bundles')
        .select('*, vendors(vendor_name)')
        .eq('status', 'submitted')
        .order('total_value', { ascending: false })
      if (error) throw error
      return data as unknown as SubmittedBundle[]
    },
  })

  const { data: variations = [], isLoading: loadingVariations } = useQuery({
    queryKey: ['ops-view-variations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('budget_variations')
        .select('*, cost_groups(name), projects(project_name)')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as VariationRow[]
    },
  })

  const { data: maintenance = [] } = useQuery({
    queryKey: ['ops-view-maintenance'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicle_maintenance_requests')
        .select('*, vehicles(name, plate_number)')
        .order('created_at', { ascending: false })
        .limit(6)
      if (error) throw error
      return data as unknown as MaintenanceRow[]
    },
  })

  const { data: penalties = [] } = useQuery({
    queryKey: ['ops-view-penalties'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicle_penalties')
        .select('*, vehicles(name, plate_number)')
        .eq('paid', false)
        .order('penalty_date', { ascending: false })
        .limit(6)
      if (error) throw error
      return data as unknown as PenaltyRow[]
    },
  })

  const summaryByProject = useMemo(() => new Map(summaries.map(s => [s.project_id, s])), [summaries])

  const portfolio = useMemo(() => {
    const rows = projects.map(p => {
      const s = summaryByProject.get(p.id)
      const utilization = s && s.total_budget > 0 ? ((s.total_actual_core + s.total_committed_core) / s.total_budget) * 100 : null
      return { project: p, summary: s ?? null, utilization }
    })
    const sorted = [...rows]
    if (sortKey === 'utilization') sorted.sort((a, b) => (b.utilization ?? -1) - (a.utilization ?? -1))
    else if (sortKey === 'margin') sorted.sort((a, b) => (a.summary?.projected_margin_core ?? 1) - (b.summary?.projected_margin_core ?? 1))
    else sorted.sort((a, b) => a.project.project_name.localeCompare(b.project.project_name))
    return sorted
  }, [projects, summaryByProject, sortKey])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Operations</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Portfolio health, approvals awaiting you, and fleet oversight</p>
      </div>

      <RoleViewSwitcher mode="base" role={role} />

      <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
            <Briefcase className="h-4 w-4 text-brand" /> Portfolio Rollup
          </h2>
          <div className="flex items-center gap-1">
            {(['utilization', 'margin', 'name'] as SortKey[]).map(k => (
              <button
                key={k}
                onClick={() => setSortKey(k)}
                className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium capitalize ${sortKey === k ? 'bg-brand text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
              >
                <ArrowUpDown className="h-3 w-3" /> {k === 'utilization' ? 'Budget Used %' : k}
              </button>
            ))}
          </div>
        </div>
        {loadingPortfolio ? (
          <p className="py-6 text-center text-xs text-slate-400">Loading…</p>
        ) : portfolio.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">No projects yet</p>
        ) : (
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="px-2 py-1.5">Project</th>
                  <th className="px-2 py-1.5">Stage</th>
                  <th className="px-2 py-1.5 text-right">Budget</th>
                  <th className="px-2 py-1.5 text-right">Budget Used</th>
                  <th className="px-2 py-1.5 text-right">Margin</th>
                  <th className="px-2 py-1.5 text-center">Health</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-700">
                {portfolio.map(({ project, summary, utilization }) => (
                  <tr key={project.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <td className="px-2 py-2">
                      <Link to={`/projects/${project.id}`} className="font-medium text-slate-700 dark:text-slate-200 hover:text-brand hover:underline">
                        {project.project_name}
                      </Link>
                    </td>
                    <td className="px-2 py-2">{project.stage ? <StatusBadge status={project.stage} /> : '—'}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{summary ? formatCurrency(summary.total_budget) : '—'}</td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {utilization != null ? (
                        <span className={utilization > 100 ? 'font-semibold text-red-600 dark:text-red-400' : 'text-slate-600 dark:text-slate-300'}>{utilization.toFixed(0)}%</span>
                      ) : '—'}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                      {summary?.projected_margin_core != null ? `${(summary.projected_margin_core * 100).toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-2 py-2 text-center">
                      {summary?.any_group_over_budget
                        ? <AlertTriangle className="h-4 w-4 text-red-500 inline" />
                        : <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="POs Awaiting Your Approval (≤ ETB 500,000)" icon={ShoppingCart} to="/sourcing" count={bundles.length}>
          {loadingBundles ? (
            <p className="py-6 text-center text-xs text-slate-400">Loading…</p>
          ) : bundles.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">Nothing awaiting approval</p>
          ) : (
            <div className="divide-y dark:divide-slate-700">
              {bundles.map(b => (
                <Link key={b.id} to={`/sourcing/${b.id}`} className="flex items-center justify-between gap-2 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/40 -mx-2 px-2 rounded">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-700 dark:text-slate-200">{b.bundle_code}</p>
                    <p className="text-xs text-slate-400 truncate">{b.vendors?.vendor_name ?? b.vendor_name ?? '—'}</p>
                  </div>
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 tabular-nums shrink-0">{formatCurrency(b.total_value)}</span>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Variation Requests Awaiting Sign-Off" icon={GitPullRequestArrow} to="/projects" count={variations.length}>
          {loadingVariations ? (
            <p className="py-6 text-center text-xs text-slate-400">Loading…</p>
          ) : variations.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">Nothing awaiting sign-off</p>
          ) : (
            <div className="divide-y dark:divide-slate-700">
              {variations.map(v => (
                <Link key={v.id} to={`/projects/${v.project_id}`} className="flex items-center justify-between gap-2 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/40 -mx-2 px-2 rounded">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-700 dark:text-slate-200">{v.projects?.project_name} — {v.cost_groups?.name ?? 'Cost group'}</p>
                    <p className="text-xs text-slate-400 truncate">{v.reason ?? 'No reason given'} · {formatDate(v.created_at)}</p>
                  </div>
                  <span className={`text-xs font-semibold tabular-nums shrink-0 ${v.requested_amount_delta < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                    {v.requested_amount_delta > 0 ? '+' : ''}{formatCurrency(v.requested_amount_delta)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Vehicle Maintenance — All Fleet" icon={Truck} to="/fleet/maintenance" count={maintenance.length}>
          {maintenance.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No maintenance requests</p>
          ) : (
            <div className="divide-y dark:divide-slate-700">
              {maintenance.map(m => (
                <div key={m.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-700 dark:text-slate-200">{m.vehicles?.name ?? '—'} <span className="text-slate-400">{m.vehicles?.plate_number}</span></p>
                    <p className="text-xs text-slate-400 truncate">{m.issue_description}</p>
                  </div>
                  <StatusBadge status={m.status} />
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Unpaid Vehicle Penalties — All Fleet" icon={AlertTriangle} to="/fleet/penalties" count={penalties.length}>
          {penalties.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No unpaid penalties</p>
          ) : (
            <div className="divide-y dark:divide-slate-700">
              {penalties.map(p => (
                <div key={p.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-700 dark:text-slate-200">{p.vehicles?.name ?? '—'} <span className="text-slate-400">{p.vehicles?.plate_number}</span></p>
                    <p className="text-xs text-slate-400 truncate">{p.reason ?? 'Traffic penalty'} · {formatDate(p.penalty_date)}</p>
                  </div>
                  <span className="text-xs font-semibold text-red-600 dark:text-red-400 tabular-nums shrink-0">{formatCurrency(p.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  )
}
