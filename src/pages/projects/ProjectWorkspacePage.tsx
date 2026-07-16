import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { KpiCard } from '@/components/shared/KpiCard'
import { BudgetGroupBar } from '@/components/shared/BudgetGroupBar'
import { RecentActivityFeed, type ActivityItem } from '@/components/shared/RecentActivityFeed'
import type { Project, ProjectStage, ProjectCostGroupBudget, ProjectBudgetSummary } from '@/types/database'
import {
  ChevronLeft, Building2, User, CalendarClock, Wallet, Receipt,
  Clock3, TrendingUp, TrendingDown, ShieldCheck, AlertTriangle, Package, TruckIcon, ClipboardCheck,
  Handshake, PenTool, ClipboardList, HardHat, CheckCircle2, FileCheck2,
} from 'lucide-react'

type ProjectDetail = Project & {
  staff: { employee_name: string } | null
  clients: { client_name: string } | null
  locations: { location_name: string } | null
}

const HEALTH_CLS: Record<string, string> = {
  'On Track':  'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  'At Risk':   'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  'Off Track': 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
}

// Operations manual §6.1 — seven lifecycle gates, in order
const STAGE_STEPS: { stage: ProjectStage; label: string; icon: React.ReactNode }[] = [
  { stage: 'business_development',          label: 'Business Dev',    icon: <Handshake className="h-3.5 w-3.5" /> },
  { stage: 'design_approvals',               label: 'Design',          icon: <PenTool className="h-3.5 w-3.5" /> },
  { stage: 'pre_construction_mobilization',  label: 'Mobilization',    icon: <ClipboardList className="h-3.5 w-3.5" /> },
  { stage: 'procurement_logistics',          label: 'Procurement',     icon: <Package className="h-3.5 w-3.5" /> },
  { stage: 'site_execution',                 label: 'Site Execution',  icon: <HardHat className="h-3.5 w-3.5" /> },
  { stage: 'quality_snagging_handover',      label: 'Snagging',        icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  { stage: 'closeout_final_accounts',        label: 'Closeout',        icon: <FileCheck2 className="h-3.5 w-3.5" /> },
]
const STAGE_ORDER: ProjectStage[] = STAGE_STEPS.map(s => s.stage)

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  const diff = new Date(dateStr).getTime() - new Date().setHours(0, 0, 0, 0)
  return Math.round(diff / 86400000)
}

export default function ProjectWorkspacePage() {
  const { id } = useParams<{ id: string }>()

  const { data: project, isLoading: loadingProject, error: projectError } = useQuery({
    queryKey: ['project-workspace', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('*, staff(employee_name), clients(client_name), locations!location_id(location_name)')
        .eq('id', id!)
        .single()
      if (error) throw error
      return data as unknown as ProjectDetail
    },
    enabled: !!id,
  })

  const { data: summary } = useQuery({
    queryKey: ['project-budget-summary', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_project_budget_summary').select('*').eq('project_id', id!).maybeSingle()
      if (error) throw error
      return data as ProjectBudgetSummary | null
    },
    enabled: !!id,
  })

  const { data: groups = [] } = useQuery({
    queryKey: ['project-budget-groups', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_project_cost_group_budget')
        .select('*')
        .eq('project_id', id!)
        .order('sort_order')
      if (error) throw error
      return data as ProjectCostGroupBudget[]
    },
    enabled: !!id,
  })

  const { data: recentExpenses = [] } = useQuery({
    queryKey: ['project-workspace-expenses', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('id, expense_code, item_service_description, amount_etb, date, payment_status')
        .eq('project_id', id!)
        .order('date', { ascending: false })
        .limit(8)
      if (error) throw error
      return data
    },
    enabled: !!id,
  })

  const { data: openBundles = [] } = useQuery({
    queryKey: ['project-workspace-bundles', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sourcing_bundle_items')
        .select('bundle_id, sourcing_bundles(id, bundle_code, status, created_at), order_items!inner(orders!inner(project_id))')
        .eq('order_items.orders.project_id', id!)
      if (error) throw error
      const seen = new Map<string, { id: string; bundle_code: string; status: string; created_at: string }>()
      for (const row of data as any[]) {
        const b = row.sourcing_bundles
        if (b && !seen.has(b.id)) seen.set(b.id, b)
      }
      return [...seen.values()]
    },
    enabled: !!id,
  })

  const { data: transportJobs = [] } = useQuery({
    queryKey: ['project-workspace-transport', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transportation_requests')
        .select('id, request_name, job_status, requested_date')
        .eq('project_id', id!)
        .order('requested_date', { ascending: false })
        .limit(8)
      if (error) throw error
      return data
    },
    enabled: !!id,
  })

  const { data: pendingGrns = [] } = useQuery({
    queryKey: ['project-workspace-grns', id],
    queryFn: async () => {
      const bundleIds = openBundles.filter(b => b.status === 'ordered').map(b => b.id)
      if (bundleIds.length === 0) return []
      const { data, error } = await supabase
        .from('goods_received_notes')
        .select('id, grn_code, sourcing_bundle_id, received_at')
        .in('sourcing_bundle_id', bundleIds)
      if (error) throw error
      return data
    },
    enabled: !!id && openBundles.length > 0,
  })

  if (loadingProject) return <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
  if (projectError) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm font-medium text-red-500">Couldn't load this project</p>
        <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">{(projectError as { message?: string }).message ?? String(projectError)}</p>
      </div>
    )
  }
  if (!project) return <div className="py-16 text-center text-sm text-slate-400">Project not found.</div>

  const daysLeft = daysUntil(project.target_handover_date)
  const budgetUsedPct = summary && summary.total_budget > 0
    ? ((summary.total_actual_core + summary.total_committed_core) / summary.total_budget) * 100
    : null
  const progressSpendGap = budgetUsedPct != null && project.physical_progress != null
    ? budgetUsedPct - project.physical_progress
    : null

  const activityItems: ActivityItem[] = [
    ...recentExpenses.map(e => ({
      id: `exp-${e.id}`,
      label: e.item_service_description ?? e.expense_code ?? 'Expense',
      sub: `${e.expense_code ?? ''} · ${e.amount_etb != null ? formatCurrency(e.amount_etb) : ''} · ${e.payment_status ? 'Paid' : 'Unpaid'}`,
      date: e.date,
      to: `/expenses/${e.id}`,
      icon: Receipt,
    })),
    ...openBundles.map(b => ({
      id: `po-${b.id}`,
      label: b.bundle_code,
      sub: `Purchase Order · ${b.status}`,
      date: b.created_at,
      to: `/sourcing/${b.id}`,
      icon: Package,
    })),
    ...pendingGrns.map(g => ({
      id: `grn-${g.id}`,
      label: g.grn_code,
      sub: 'Goods Received Note',
      date: g.received_at,
      to: `/sourcing/${g.sourcing_bundle_id}`,
      icon: ClipboardCheck,
    })),
    ...transportJobs.map(t => ({
      id: `tr-${t.id}`,
      label: t.request_name ?? 'Transport job',
      sub: `Transport · ${t.job_status.replace('_', ' ')}`,
      date: t.requested_date,
      to: `/transportation/${t.id}/edit`,
      icon: TruckIcon,
    })),
  ]

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Link to="/projects" className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">{project.project_name}</h1>
              {project.health && (
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${HEALTH_CLS[project.health] ?? ''}`}>
                  {project.health}
                </span>
              )}
              {summary?.budget_baseline_locked_at && (
                <span className="flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-700 px-2.5 py-0.5 text-[11px] font-medium text-slate-500 dark:text-slate-300">
                  <ShieldCheck className="h-3 w-3" /> Baseline locked {formatDate(summary.budget_baseline_locked_at)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 flex-wrap mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /> {project.clients?.client_name ?? '—'}</span>
              <span className="flex items-center gap-1"><User className="h-3.5 w-3.5" /> {project.staff?.employee_name ?? '—'}</span>
              {project.target_handover_date && (
                <span className="flex items-center gap-1">
                  <CalendarClock className="h-3.5 w-3.5" /> {formatDate(project.target_handover_date)}
                  {daysLeft != null && (
                    <span className={daysLeft < 0 ? 'text-red-500 font-medium' : ''}>
                      {' '}({daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d left`})
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Stage timeline */}
      {project.stage && (
        <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 px-5 py-4 shadow-sm">
          <div className="flex items-center gap-0">
            {STAGE_STEPS.map((step, i) => {
              const stageIdx = STAGE_ORDER.indexOf(project.stage!)
              const stepIdx = STAGE_ORDER.indexOf(step.stage)
              const isComplete = stageIdx > stepIdx
              const isCurrent = stageIdx === stepIdx
              return (
                <div key={step.stage} className="flex items-center flex-1 min-w-0">
                  <div className={`flex items-center gap-1.5 shrink-0 ${
                    isComplete ? 'text-green-500' : isCurrent ? 'text-brand' : 'text-slate-300 dark:text-slate-600'
                  }`}>
                    <div className={`rounded-full p-1.5 ${
                      isComplete ? 'bg-green-50 dark:bg-green-900/20' : isCurrent ? 'bg-brand/10' : 'bg-slate-100 dark:bg-slate-700'
                    }`}>
                      {step.icon}
                    </div>
                    <span className={`text-[10px] font-medium hidden sm:block whitespace-nowrap ${
                      isCurrent ? 'text-brand' : isComplete ? 'text-green-600 dark:text-green-400' : ''
                    }`}>{step.label}</span>
                  </div>
                  {i < STAGE_STEPS.length - 1 && (
                    <div className={`h-px flex-1 mx-2 ${isComplete ? 'bg-green-300 dark:bg-green-700' : 'bg-slate-200 dark:bg-slate-700'}`} />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Summary band */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="Contract Value" value={project.contract_value != null ? formatCurrency(project.contract_value) : '—'} icon={Wallet} color="bg-blue-50 text-blue-600" />
        <KpiCard label="Cost Budget" value={summary ? formatCurrency(summary.total_budget) : '—'} icon={Wallet} color="bg-slate-100 text-slate-600" />
        <KpiCard label="Committed" value={summary ? formatCurrency(summary.total_committed_core) : '—'} sub={summary ? `${formatCurrency(summary.total_committed_with_labor)} incl. labor` : undefined} icon={Clock3} color="bg-amber-50 text-amber-600" />
        <KpiCard label="Actual (Paid)" value={summary ? formatCurrency(summary.total_actual_core) : '—'} sub={summary ? `${formatCurrency(summary.total_actual_with_labor)} incl. labor` : undefined} icon={Receipt} color="bg-emerald-50 text-emerald-600" />
        <KpiCard
          label="Remaining"
          value={summary ? formatCurrency(summary.total_budget - summary.total_actual_core - summary.total_committed_core) : '—'}
          icon={summary?.any_group_over_budget ? AlertTriangle : Wallet}
          color={summary?.any_group_over_budget ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-600'}
        />
        <KpiCard
          label="Projected Margin"
          value={summary?.projected_margin_core != null ? `${(summary.projected_margin_core * 100).toFixed(1)}%` : '—'}
          sub={summary?.bid_margin != null ? `bid ${(summary.bid_margin * 100).toFixed(1)}%` : undefined}
          icon={summary?.projected_margin_core != null && summary.bid_margin != null && summary.projected_margin_core < summary.bid_margin ? TrendingDown : TrendingUp}
          color="bg-purple-50 text-purple-600"
        />
      </div>

      {/* Budget vs actual by cost group + progress vs spend */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <BudgetGroupBar title="Budget vs Actual by Cost Group" groups={groups} />
        </div>
        <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Progress vs Spend</h3>
          <div className="mt-4 space-y-3">
            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-slate-500 dark:text-slate-400">Physical progress</span>
                <span className="font-medium text-slate-700 dark:text-slate-200">{project.physical_progress != null ? `${project.physical_progress}%` : '—'}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                <div className="h-full rounded-full bg-blue-500" style={{ width: `${project.physical_progress ?? 0}%` }} />
              </div>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-slate-500 dark:text-slate-400">Budget used</span>
                <span className="font-medium text-slate-700 dark:text-slate-200">{budgetUsedPct != null ? `${budgetUsedPct.toFixed(0)}%` : '—'}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                <div className={`h-full rounded-full ${budgetUsedPct != null && budgetUsedPct > 100 ? 'bg-red-500' : 'bg-amber-500'}`} style={{ width: `${Math.min(budgetUsedPct ?? 0, 100)}%` }} />
              </div>
            </div>
            {progressSpendGap != null && (
              <div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${progressSpendGap > 15 ? 'bg-red-50 dark:bg-red-900/10 text-red-700 dark:text-red-300' : progressSpendGap > 5 ? 'bg-amber-50 dark:bg-amber-900/10 text-amber-700 dark:text-amber-300' : 'bg-slate-50 dark:bg-slate-700/30 text-slate-500 dark:text-slate-400'}`}>
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  {progressSpendGap > 5
                    ? `Spending is ${progressSpendGap.toFixed(0)} points ahead of physical progress — early warning signal.`
                    : 'Spend and progress are roughly in line.'}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Activity */}
      <RecentActivityFeed title="Recent Activity" items={activityItems} emptyText="No activity recorded for this project yet" />
    </div>
  )
}
