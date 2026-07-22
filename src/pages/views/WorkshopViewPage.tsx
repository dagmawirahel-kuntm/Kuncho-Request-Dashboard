import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useStaffDirectory } from '@/hooks/useLookups'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { RoleViewSwitcher } from '@/components/shared/RoleViewSwitcher'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { WorkOrder, WorkOrderCostRow, StaffFfeSkillLevelRow } from '@/types/database'
import { Hammer, Award, ArrowRight } from 'lucide-react'

type OpenWorkOrder = WorkOrder & { projects: { project_name: string } | null }

const LEVEL_CLS: Record<string, string> = {
  Advanced: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  Intermediate: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  Beginner: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
}
const levelRank: Record<string, number> = { Advanced: 3, Intermediate: 2, Beginner: 1 }

export default function WorkshopViewPage() {
  const { role } = useAuth()

  const { data: workOrders = [], isLoading: loadingOrders } = useQuery({
    queryKey: ['workshop-view-open-orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_orders')
        .select('*, projects(project_name)')
        .eq('work_type', 'workshop')
        .not('status', 'in', '(completed,cancelled)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as OpenWorkOrder[]
    },
  })

  const { data: costs = [] } = useQuery({
    queryKey: ['workshop-view-costs'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_work_order_cost').select('*')
      if (error) throw error
      return data as WorkOrderCostRow[]
    },
  })

  const { data: skillLevels = [] } = useQuery({
    queryKey: ['workshop-view-skill-levels'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_staff_ffe_skill_level').select('*')
      if (error) throw error
      return data as StaffFfeSkillLevelRow[]
    },
  })

  const { data: staffDirectory = [] } = useStaffDirectory()
  const staffNameById = useMemo(() => new Map(staffDirectory.map((s: any) => [s.id, s.employee_name])), [staffDirectory])
  const costByWorkOrder = useMemo(() => new Map(costs.map(c => [c.work_order_id, c])), [costs])
  const sortedCandidates = useMemo(
    () => [...skillLevels].sort((a, b) => (levelRank[b.skill_level] ?? 0) - (levelRank[a.skill_level] ?? 0)),
    [skillLevels]
  )

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Workshop</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Open workshop work orders, their derived cost, and who's available for the next task</p>
      </div>

      <RoleViewSwitcher mode="workshop" role={role} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              <Hammer className="h-4 w-4 text-brand" /> Open Workshop Work Orders
            </h2>
            <Link to="/work-orders" className="flex items-center gap-1 text-xs text-slate-400 hover:text-brand">
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {loadingOrders ? (
            <p className="py-6 text-center text-xs text-slate-400">Loading…</p>
          ) : workOrders.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No open workshop work orders</p>
          ) : (
            <div className="divide-y dark:divide-slate-700">
              {workOrders.map(w => {
                const cost = costByWorkOrder.get(w.id)
                return (
                  <Link key={w.id} to={`/work-orders/${w.id}`} className="flex items-center justify-between gap-2 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/40 -mx-2 px-2 rounded">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-700 dark:text-slate-200">{w.scope_of_work}</p>
                      <p className="text-xs text-slate-400 truncate">
                        {w.projects?.project_name} · Lead: {(w.assigned_lead_staff_id && staffNameById.get(w.assigned_lead_staff_id)) ?? '—'}
                        {w.target_completion_date ? ` · due ${formatDate(w.target_completion_date)}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 tabular-nums">{formatCurrency(cost?.total_cost ?? 0)}</span>
                      <StatusBadge status={w.status} />
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm p-5 space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
            <Award className="h-4 w-4 text-brand" /> FF&E Skill Levels
          </h2>
          <p className="text-xs text-slate-400">Suggestion only — doesn't block who you assign</p>
          {sortedCandidates.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No checklists recorded yet</p>
          ) : (
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {sortedCandidates.map(c => (
                <div key={`${c.staff_id}-${c.job_description_id}`} className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-xs">
                  <span className="text-slate-700 dark:text-slate-200 truncate">{staffNameById.get(c.staff_id) ?? '—'} <span className="text-slate-400">· {c.role_name}</span></span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold shrink-0 ${LEVEL_CLS[c.skill_level]}`}>{c.skill_level}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
