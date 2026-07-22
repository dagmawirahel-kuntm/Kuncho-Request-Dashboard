import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useMyStaffId } from '@/hooks/useMyStaff'
import { KpiCard } from '@/components/shared/KpiCard'
import { BudgetGroupBar } from '@/components/shared/BudgetGroupBar'
import { ProgressVsSpendCard } from '@/components/shared/ProgressVsSpendCard'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { RoleViewSwitcher } from '@/components/shared/RoleViewSwitcher'
import { formatCurrency, formatCurrencyCompact, formatDate } from '@/lib/utils'
import type { Project, ProjectCostGroupBudget, Order, LaborAllocation, WorkOrder } from '@/types/database'
import { Wallet, Clock3, Receipt, TrendingUp, TrendingDown, AlertTriangle, ShoppingCart, HardHat, Hammer } from 'lucide-react'

interface BudgetSummary {
  project_id: string
  total_budget: number
  total_actual_core: number
  total_committed_core: number
  total_committed_with_labor: number
  total_actual_with_labor: number
  any_group_over_budget: boolean
  bid_margin: number | null
  projected_margin_core: number | null
}

export default function ProjectManagerViewPage() {
  const { role } = useAuth()
  const { data: staff } = useMyStaffId()
  const staffId = staff?.id
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)

  const { data: myProjects = [], isLoading: loadingProjects } = useQuery({
    queryKey: ['pm-view-my-projects', staffId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('project_manager_id', staffId!)
        .order('project_name')
      if (error) throw error
      return data as Project[]
    },
    enabled: !!staffId,
  })

  const activeProjectId = selectedProjectId ?? myProjects[0]?.id ?? null
  const activeProject = myProjects.find(p => p.id === activeProjectId) ?? null
  const projectIds = useMemo(() => myProjects.map(p => p.id), [myProjects])

  const { data: summary } = useQuery({
    queryKey: ['pm-view-budget-summary', activeProjectId],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_project_budget_summary').select('*').eq('project_id', activeProjectId!).maybeSingle()
      if (error) throw error
      return data as BudgetSummary | null
    },
    enabled: !!activeProjectId,
  })

  const { data: groups = [] } = useQuery({
    queryKey: ['pm-view-cost-groups', activeProjectId],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_project_cost_group_budget').select('*').eq('project_id', activeProjectId!).order('sort_order')
      if (error) throw error
      return data as ProjectCostGroupBudget[]
    },
    enabled: !!activeProjectId,
  })

  const { data: myOrders = [] } = useQuery({
    queryKey: ['pm-view-open-prs', projectIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('*, projects(project_name)')
        .in('project_id', projectIds)
        .in('approval_status', ['pending', 'manager_approved'])
        .order('order_date', { ascending: false })
        .limit(8)
      if (error) throw error
      return data as unknown as (Order & { projects: { project_name: string } | null })[]
    },
    enabled: projectIds.length > 0,
  })

  const { data: myLabor = [] } = useQuery({
    queryKey: ['pm-view-labor', projectIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('labor_allocations')
        .select('*, projects(project_name)')
        .in('project_id', projectIds)
        .in('status', ['planned', 'active'])
        .order('start_date', { ascending: false })
        .limit(8)
      if (error) throw error
      return data as unknown as (LaborAllocation & { projects: { project_name: string } | null })[]
    },
    enabled: projectIds.length > 0,
  })

  const { data: myWorkOrders = [] } = useQuery({
    queryKey: ['pm-view-work-orders', projectIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_orders')
        .select('*, projects(project_name)')
        .in('project_id', projectIds)
        .not('status', 'in', '(completed,cancelled)')
        .order('created_at', { ascending: false })
        .limit(8)
      if (error) throw error
      return data as unknown as (WorkOrder & { projects: { project_name: string } | null })[]
    },
    enabled: projectIds.length > 0,
  })

  const budgetUsedPct = summary && summary.total_budget > 0
    ? ((summary.total_actual_core + summary.total_committed_core) / summary.total_budget) * 100
    : null

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">My Projects</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Where you're the named project manager</p>
      </div>

      <RoleViewSwitcher mode="base" role={role} />

      {loadingProjects ? (
        <p className="py-12 text-center text-sm text-slate-400">Loading…</p>
      ) : myProjects.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-400">No projects are assigned to you as project manager yet.</p>
      ) : (
        <>
          {myProjects.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {myProjects.map(p => (
                <button
                  key={p.id}
                  onClick={() => setSelectedProjectId(p.id)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${
                    p.id === activeProjectId
                      ? 'bg-brand text-white border-brand'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}
                >
                  {p.project_name}
                </button>
              ))}
            </div>
          )}

          {activeProject && (
            <>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Link to={`/projects/${activeProject.id}`} className="text-sm font-semibold text-slate-800 dark:text-slate-100 hover:text-brand hover:underline">
                  {activeProject.project_name} — full workspace →
                </Link>
                {activeProject.stage && <StatusBadge status={activeProject.stage} />}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <KpiCard
                  label="Remaining"
                  value={summary ? formatCurrencyCompact(summary.total_budget - summary.total_actual_core - summary.total_committed_core) : '—'}
                  title={summary ? formatCurrency(summary.total_budget - summary.total_actual_core - summary.total_committed_core) : undefined}
                  icon={summary?.any_group_over_budget ? AlertTriangle : Wallet}
                  color={summary?.any_group_over_budget ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-600'}
                />
                <KpiCard
                  label="Committed"
                  value={summary ? formatCurrencyCompact(summary.total_committed_core) : '—'}
                  title={summary ? formatCurrency(summary.total_committed_core) : undefined}
                  icon={Clock3} color="bg-amber-50 text-amber-600"
                />
                <KpiCard
                  label="Cost Budget"
                  value={summary ? formatCurrencyCompact(summary.total_budget) : '—'}
                  title={summary ? formatCurrency(summary.total_budget) : undefined}
                  icon={Wallet} color="bg-slate-100 text-slate-600"
                />
                <KpiCard
                  label="Actual (Paid)"
                  value={summary ? formatCurrencyCompact(summary.total_actual_core) : '—'}
                  title={summary ? formatCurrency(summary.total_actual_core) : undefined}
                  icon={Receipt} color="bg-emerald-50 text-emerald-600"
                />
                <KpiCard
                  label="Projected Margin"
                  value={summary?.projected_margin_core != null ? `${(summary.projected_margin_core * 100).toFixed(1)}%` : '—'}
                  sub={summary?.bid_margin != null ? `bid ${(summary.bid_margin * 100).toFixed(1)}%` : undefined}
                  icon={summary?.projected_margin_core != null && summary.bid_margin != null && summary.projected_margin_core < summary.bid_margin ? TrendingDown : TrendingUp}
                  color="bg-purple-50 text-purple-600"
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                <div className="lg:col-span-2">
                  <BudgetGroupBar title="Budget vs Actual by Cost Group" groups={groups} />
                </div>
                <ProgressVsSpendCard physicalProgress={activeProject.physical_progress} budgetUsedPct={budgetUsedPct} />
              </div>
            </>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm p-5 space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                <ShoppingCart className="h-4 w-4 text-brand" /> Open Purchase Requests
              </h2>
              {myOrders.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-400">Nothing awaiting approval</p>
              ) : (
                <div className="divide-y dark:divide-slate-700">
                  {myOrders.map(o => (
                    <Link key={o.id} to={`/purchase-requests/${o.id}`} className="flex items-center justify-between gap-2 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/40 -mx-2 px-2 rounded">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-700 dark:text-slate-200">{o.item_service_description ?? o.order_name ?? '—'}</p>
                        <p className="text-xs text-slate-400 truncate">{o.projects?.project_name}</p>
                      </div>
                      <StatusBadge status={o.approval_status} />
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm p-5 space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                <HardHat className="h-4 w-4 text-brand" /> Labor Allocations
              </h2>
              {myLabor.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-400">No active labor allocations</p>
              ) : (
                <div className="divide-y dark:divide-slate-700">
                  {myLabor.map(l => (
                    <div key={l.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-700 dark:text-slate-200">{l.projects?.project_name}</p>
                        <p className="text-xs text-slate-400">{formatDate(l.start_date)} – {l.end_date ? formatDate(l.end_date) : 'open'}</p>
                      </div>
                      <StatusBadge status={l.status} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm p-5 space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                <Hammer className="h-4 w-4 text-brand" /> Open Work Orders
              </h2>
              {myWorkOrders.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-400">No open work orders</p>
              ) : (
                <div className="divide-y dark:divide-slate-700">
                  {myWorkOrders.map(w => (
                    <Link key={w.id} to={`/work-orders/${w.id}`} className="flex items-center justify-between gap-2 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/40 -mx-2 px-2 rounded">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-700 dark:text-slate-200">{w.scope_of_work}</p>
                        <p className="text-xs text-slate-400 truncate">{w.projects?.project_name}</p>
                      </div>
                      <StatusBadge status={w.status} />
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
