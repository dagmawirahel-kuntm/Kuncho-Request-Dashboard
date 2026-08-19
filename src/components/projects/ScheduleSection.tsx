import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatDateGC } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useMyStaffId } from '@/hooks/useMyStaff'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { buildTaskTree, daysSlipped } from '@/lib/scheduleTree'
import { ScheduleTaskFormModal } from './ScheduleTaskFormModal'
import { LinkBoqItemsModal } from './LinkBoqItemsModal'
import { ScheduleGanttChart } from './ScheduleGanttChart'
import type { Schedule, ScheduleTask, StaleScheduleBoqLink, ProjectPhysicalProgress } from '@/types/database'
import {
  CalendarRange, AlertTriangle, Plus, Link2, ClipboardList, Lock, RotateCcw, Pencil, ChevronRight,
  Table2, GanttChartSquare,
} from 'lucide-react'

const inputCls = 'w-full rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'

interface Props {
  projectId: string
  projectName: string
}

export function ScheduleSection({ projectId, projectName }: Props) {
  const { toast } = useToast()
  const { role } = useAuth()
  const { data: myStaff } = useMyStaffId()
  const qc = useQueryClient()
  const navigate = useNavigate()

  const [viewMode, setViewMode] = useState<'table' | 'gantt'>('table')
  const [building, setBuilding] = useState(false)
  const [showAddTask, setShowAddTask] = useState(false)
  const [editingTask, setEditingTask] = useState<ScheduleTask | null>(null)
  const [linkingTask, setLinkingTask] = useState<ScheduleTask | null>(null)
  const [creatingWoFor, setCreatingWoFor] = useState<ScheduleTask | null>(null)
  const [woType, setWoType] = useState<'site' | 'workshop'>('site')
  const [confirmApproveOpen, setConfirmApproveOpen] = useState(false)
  const [approving, setApproving] = useState(false)
  const [confirmResetOpen, setConfirmResetOpen] = useState(false)
  const [resetReason, setResetReason] = useState('')
  const [resetting, setResetting] = useState(false)

  const { data: schedule, isLoading: scheduleLoading } = useQuery({
    queryKey: ['project-schedule', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('schedules')
        .select('*, staff:owner_pm_staff_id(employee_name)')
        .eq('project_id', projectId)
        .neq('status', 'completed')
        .maybeSingle()
      if (error) throw error
      return data as (Schedule & { staff: { employee_name: string } | null }) | null
    },
  })

  const { data: approvedBoq } = useQuery({
    queryKey: ['project-approved-boq', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from('boqs').select('id, title').eq('project_id', projectId).eq('status', 'approved').maybeSingle()
      if (error) throw error
      return data as { id: string; title: string } | null
    },
  })

  const { data: tasks = [] } = useQuery({
    queryKey: ['schedule-tasks', schedule?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('schedule_tasks').select('*').eq('schedule_id', schedule!.id)
      if (error) throw error
      return (data ?? []) as ScheduleTask[]
    },
    enabled: !!schedule?.id,
  })

  const taskIds = useMemo(() => tasks.map(t => t.id), [tasks])

  const { data: boqLinkCounts = {} } = useQuery({
    queryKey: ['schedule-task-boq-link-counts', schedule?.id, taskIds.join(',')],
    queryFn: async () => {
      const { data, error } = await supabase.from('schedule_task_boq_items').select('schedule_task_id, boq_item_id').in('schedule_task_id', taskIds)
      if (error) throw error
      const counts: Record<string, string[]> = {}
      for (const row of data ?? []) {
        const key = row.schedule_task_id as string
        if (!counts[key]) counts[key] = []
        counts[key].push(row.boq_item_id as string)
      }
      return counts
    },
    enabled: taskIds.length > 0,
  })

  const { data: workOrdersByTask = {} } = useQuery({
    queryKey: ['schedule-task-work-orders', schedule?.id, taskIds.join(',')],
    queryFn: async () => {
      const { data, error } = await supabase.from('work_orders').select('id, schedule_task_id, status').in('schedule_task_id', taskIds)
      if (error) throw error
      const map: Record<string, { id: string; status: string }[]> = {}
      for (const wo of data ?? []) {
        const key = wo.schedule_task_id as string
        if (!map[key]) map[key] = []
        map[key].push({ id: wo.id, status: wo.status })
      }
      return map
    },
    enabled: taskIds.length > 0,
  })

  const { data: staleLinks = [] } = useQuery({
    queryKey: ['schedule-stale-boq-links', schedule?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_schedule_tasks_with_stale_boq_links').select('*').eq('schedule_id', schedule!.id)
      if (error) throw error
      return (data ?? []) as StaleScheduleBoqLink[]
    },
    enabled: !!schedule?.id,
  })

  // BOQ-value-weighted physical progress (PR 9c) — a distinct number from
  // the manually-entered projects.physical_progress field used in the
  // Progress vs Spend card elsewhere on this page; kept separate rather
  // than reconciled, per the user's explicit choice.
  const { data: physicalProgress } = useQuery({
    queryKey: ['project-physical-progress', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_project_physical_progress').select('*').eq('project_id', projectId).maybeSingle()
      if (error) throw error
      return data as ProjectPhysicalProgress | null
    },
    enabled: !!schedule,
  })

  const isOwnerPm = !!schedule && !!myStaff?.id && myStaff.id === schedule.owner_pm_staff_id
  const canManage = role === 'admin' || isOwnerPm
  const canResetBaseline = canManage || role === 'finance' || role === 'executive'
  // schedules_insert (220) only permits admin or project_manager to create
  // a schedule — gating the button to match avoids a raw RLS error for
  // anyone else who can merely view this page.
  const canBuildSchedule = role === 'admin' || role === 'project_manager'
  const staleTaskIds = new Set(staleLinks.map(l => l.task_id))

  const orderedTasks = useMemo(() => buildTaskTree(tasks), [tasks])
  const nextDisplayOrder = tasks.length > 0 ? Math.max(...tasks.map(t => t.display_order)) + 1 : 1

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ['project-schedule', projectId] })
    qc.invalidateQueries({ queryKey: ['schedule-tasks', schedule?.id] })
    qc.invalidateQueries({ queryKey: ['schedule-stale-boq-links', schedule?.id] })
  }

  async function handleBuildSchedule() {
    if (!myStaff?.id) { toast('Your account is not linked to a staff record', 'error'); return }
    setBuilding(true)
    const { data: newSchedule, error } = await supabase.from('schedules').insert([{
      project_id: projectId,
      boq_id: approvedBoq?.id ?? null,
      title: `${projectName} Schedule`,
      owner_pm_staff_id: myStaff.id,
      created_by_staff_id: myStaff.id,
    }]).select().single()

    if (error) { toast(error.message, 'error'); setBuilding(false); return }

    // Optional pre-population: one task per Category-level BOQ section —
    // a starting suggestion, fully editable, per the spec (item 28).
    if (approvedBoq?.id) {
      const { data: tree } = await supabase.rpc('v_boq_tree', { p_boq_id: approvedBoq.id })
      const categories = ((tree ?? []) as { id: string; node_type: string; name: string; depth: number }[])
        .filter(n => n.node_type === 'section' && n.depth === 2)
      if (categories.length > 0) {
        const today = new Date().toISOString().slice(0, 10)
        const rows = categories.map((c, i) => ({
          schedule_id: newSchedule.id,
          display_order: i + 1,
          title: c.name,
          current_start_date: today,
          current_duration_days: 5,
        }))
        await supabase.from('schedule_tasks').insert(rows)
      }
    }

    setBuilding(false)
    invalidateAll()
    toast('Schedule created', 'success')
  }

  async function handleApprove() {
    if (!schedule) return
    setApproving(true)
    const { error } = await supabase.rpc('approve_schedule', { p_schedule_id: schedule.id })
    setApproving(false)
    setConfirmApproveOpen(false)
    if (error) { toast(error.message, 'error'); return }
    invalidateAll()
    toast('Baseline locked', 'success')
  }

  async function handleResetBaseline() {
    if (!schedule) return
    if (!resetReason.trim()) { toast('A reason is required', 'error'); return }
    setResetting(true)
    const { error } = await supabase.rpc('reset_baseline', { p_schedule_id: schedule.id, p_reason: resetReason.trim() })
    setResetting(false)
    if (error) { toast(error.message, 'error'); return }
    setConfirmResetOpen(false)
    setResetReason('')
    invalidateAll()
    toast('Baseline reset', 'success')
  }

  async function handleCreateWorkOrder() {
    if (!creatingWoFor) return
    const { data, error } = await supabase.rpc('create_work_order_from_task', { p_task_id: creatingWoFor.id, p_work_type: woType })
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['schedule-task-work-orders', schedule?.id] })
    toast('Work order created', 'success')
    setCreatingWoFor(null)
    navigate(`/work-orders/${data}`)
  }

  if (scheduleLoading) {
    return <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm text-sm text-slate-400">Loading schedule…</div>
  }

  return (
    <div id="schedule" className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm space-y-4 scroll-mt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
          <CalendarRange className="h-4 w-4" /> Schedule
        </h3>
        {schedule && (
          <div className="flex items-center gap-2">
            <StatusBadge status={schedule.status} />
            {schedule.status === 'draft' && canManage && (
              <button onClick={() => setConfirmApproveOpen(true)}
                className="flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90">
                <Lock className="h-3.5 w-3.5" /> Approve &amp; Lock Baseline
              </button>
            )}
            {schedule.status === 'approved' && canResetBaseline && (
              <button onClick={() => setConfirmResetOpen(true)}
                className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700">
                <RotateCcw className="h-3.5 w-3.5" /> Reset Baseline
              </button>
            )}
          </div>
        )}
      </div>

      {!schedule && !approvedBoq && (
        <p className="py-4 text-center text-sm text-slate-400 dark:text-slate-500">
          No schedule yet. An approved BOQ isn't required, but is recommended before building one.
        </p>
      )}

      {!schedule && (
        <div className="flex items-center justify-between rounded-md border border-dashed dark:border-slate-600 p-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {approvedBoq ? 'BOQ approved — ready to build a schedule from it.' : 'No BOQ on file — you can still build a schedule from scratch.'}
            {!canBuildSchedule && ' Only the project\'s PM or an admin can build one.'}
          </p>
          {canBuildSchedule && (
            <button onClick={handleBuildSchedule} disabled={building}
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-60 shrink-0">
              {building ? 'Building…' : 'Build Schedule'}
            </button>
          )}
        </div>
      )}

      {schedule && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-medium text-slate-700 dark:text-slate-200">{schedule.title}</span>
            <span>PM: {schedule.staff?.employee_name ?? '—'}</span>
            <span>{schedule.baseline_locked_at ? `Baselined ${formatDateGC(schedule.baseline_locked_at)}` : 'Not yet baselined'}</span>
            {physicalProgress?.physical_progress_pct != null && (
              <span className="flex items-center gap-1.5" title="BOQ-value-weighted physical progress, from task progress rolled up through linked BOQ items">
                <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                  <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${physicalProgress.physical_progress_pct}%` }} />
                </span>
                <span className="font-medium text-slate-700 dark:text-slate-200">{physicalProgress.physical_progress_pct}% physical</span>
              </span>
            )}
          </div>

          {staleLinks.length > 0 && (
            <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-800 dark:text-amber-300">
                {staleLinks.length} task{staleLinks.length === 1 ? '' : 's'} linked to BOQ items from a superseded version — a change order landed since this schedule was built. Review and relink manually.
              </p>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400">{tasks.length} task{tasks.length === 1 ? '' : 's'}</span>
              <div className="flex items-center rounded-md border dark:border-slate-600 overflow-hidden">
                <button onClick={() => setViewMode('table')}
                  className={`flex items-center gap-1 px-2 py-1 text-xs ${viewMode === 'table' ? 'bg-brand text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
                  <Table2 className="h-3 w-3" /> Table
                </button>
                <button onClick={() => setViewMode('gantt')}
                  className={`flex items-center gap-1 px-2 py-1 text-xs border-l dark:border-slate-600 ${viewMode === 'gantt' ? 'bg-brand text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
                  <GanttChartSquare className="h-3 w-3" /> Gantt
                </button>
              </div>
            </div>
            {canManage && (
              <button onClick={() => setShowAddTask(true)}
                className="flex items-center gap-1 text-xs font-medium text-brand hover:underline">
                <Plus className="h-3.5 w-3.5" /> Add Task
              </button>
            )}
          </div>

          {tasks.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">No tasks yet.</p>
          ) : viewMode === 'gantt' ? (
            <ScheduleGanttChart tasks={orderedTasks} onEditTask={setEditingTask} />
          ) : (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-400 dark:text-slate-500 border-b dark:border-slate-700">
                    <th className="py-1.5 px-1 font-medium">Title</th>
                    <th className="py-1.5 px-1 font-medium">Planned</th>
                    <th className="py-1.5 px-1 font-medium">Current</th>
                    <th className="py-1.5 px-1 font-medium text-right">Dur.</th>
                    <th className="py-1.5 px-1 font-medium">Status</th>
                    <th className="py-1.5 px-1 font-medium">Progress</th>
                    <th className="py-1.5 px-1 font-medium text-right">Slip</th>
                    <th className="py-1.5 px-1 font-medium">Predecessor</th>
                    <th className="py-1.5 px-1 font-medium">BOQ</th>
                    <th className="py-1.5 px-1 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-slate-700">
                  {orderedTasks.map(task => {
                    const slip = daysSlipped(task)
                    const predecessor = tasks.find(t => t.id === task.predecessor_task_id)
                    const linkedCount = (boqLinkCounts[task.id] ?? []).length
                    const wos = workOrdersByTask[task.id] ?? []
                    const isStale = staleTaskIds.has(task.id)
                    return (
                      <tr key={task.id} id={`schedule-task-${task.id}`} className={isStale ? 'bg-amber-50/50 dark:bg-amber-900/10' : undefined}>
                        <td className="py-1.5 px-1 text-slate-700 dark:text-slate-200" style={{ paddingLeft: `${4 + (task.depth - 1) * 16}px` }}>
                          {task.title}
                        </td>
                        <td className="py-1.5 px-1 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {task.planned_start_date ? `${formatDateGC(task.planned_start_date)} – ${formatDateGC(task.planned_end_date)}` : '—'}
                        </td>
                        <td className="py-1.5 px-1 text-slate-700 dark:text-slate-200 whitespace-nowrap">
                          {formatDateGC(task.current_start_date)} – {formatDateGC(task.current_end_date)}
                        </td>
                        <td className="py-1.5 px-1 text-right text-slate-500 dark:text-slate-400">{task.current_duration_days}d</td>
                        <td className="py-1.5 px-1"><StatusBadge status={task.status} /></td>
                        <td className="py-1.5 px-1">
                          <div className="flex items-center gap-1.5" title={task.progress_source === 'derived' ? 'Derived from linked work order reports' : 'Manually set'}>
                            <span className="h-1.5 w-10 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700 shrink-0">
                              <span className={`block h-full rounded-full ${task.progress_source === 'derived' ? 'bg-blue-500' : 'bg-slate-400'}`} style={{ width: `${task.progress_pct}%` }} />
                            </span>
                            <span className="text-slate-500 dark:text-slate-400 whitespace-nowrap">{task.progress_pct}%{task.progress_source === 'derived' ? ' •' : ''}</span>
                          </div>
                        </td>
                        <td className={`py-1.5 px-1 text-right font-medium ${slip != null && slip > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-400'}`}>
                          {slip == null ? '—' : slip > 0 ? `+${slip}` : slip}
                        </td>
                        <td className="py-1.5 px-1 text-slate-500 dark:text-slate-400">
                          {predecessor ? (
                            <button
                              onClick={() => document.getElementById(`schedule-task-${predecessor.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                              className="hover:text-brand hover:underline truncate max-w-[120px] inline-block align-bottom">
                              {predecessor.title}
                            </button>
                          ) : '—'}
                        </td>
                        <td className="py-1.5 px-1 text-slate-500 dark:text-slate-400">
                          {linkedCount > 0 ? `${linkedCount} linked` : '—'}
                        </td>
                        <td className="py-1.5 px-1">
                          <div className="flex items-center gap-2">
                            {canManage && (
                              <button onClick={() => setEditingTask(task)} title="Edit" className="text-slate-400 hover:text-brand"><Pencil className="h-3.5 w-3.5" /></button>
                            )}
                            {canManage && (
                              <button onClick={() => setLinkingTask(task)} title="Link BOQ Items" className="text-slate-400 hover:text-brand"><Link2 className="h-3.5 w-3.5" /></button>
                            )}
                            {canManage && (
                              wos.length > 0 ? (
                                <button onClick={() => navigate(`/work-orders/${wos[0].id}`)} title="View Work Order" className="text-slate-400 hover:text-brand"><ChevronRight className="h-3.5 w-3.5" /></button>
                              ) : (
                                <button onClick={() => setCreatingWoFor(task)} title="Create Work Order" className="text-slate-400 hover:text-brand"><ClipboardList className="h-3.5 w-3.5" /></button>
                              )
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {(showAddTask || editingTask) && schedule && (
        <ScheduleTaskFormModal
          scheduleId={schedule.id}
          task={editingTask}
          allTasks={tasks}
          nextDisplayOrder={nextDisplayOrder}
          onClose={() => { setShowAddTask(false); setEditingTask(null) }}
          onSaved={invalidateAll}
        />
      )}

      {linkingTask && approvedBoq && schedule && (
        <LinkBoqItemsModal
          scheduleId={schedule.id}
          taskId={linkingTask.id}
          boqId={approvedBoq.id}
          alreadyLinkedIds={boqLinkCounts[linkingTask.id] ?? []}
          onClose={() => setLinkingTask(null)}
        />
      )}
      {linkingTask && !approvedBoq && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white dark:bg-slate-800 p-5 shadow-xl space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-300">This project has no approved BOQ to link items from.</p>
            <div className="flex justify-end"><button onClick={() => setLinkingTask(null)} className="rounded-md px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">Close</button></div>
          </div>
        </div>
      )}

      {creatingWoFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white dark:bg-slate-800 p-5 shadow-xl space-y-3">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <ClipboardList className="h-4 w-4" /> Create Work Order
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-300">From task: {creatingWoFor.title}</p>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Work Type</label>
              <select className={inputCls} value={woType} onChange={e => setWoType(e.target.value as 'site' | 'workshop')}>
                <option value="site">Site</option>
                <option value="workshop">Workshop</option>
              </select>
            </div>
            <div className="flex items-center gap-2 justify-end pt-1">
              <button onClick={() => setCreatingWoFor(null)} className="rounded-md px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
              <button onClick={handleCreateWorkOrder} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">Create</button>
            </div>
          </div>
        </div>
      )}

      {confirmApproveOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white dark:bg-slate-800 p-5 shadow-xl space-y-3">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Lock className="h-4 w-4 text-amber-500" /> Lock Baseline?
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              This locks the current dates as the official plan. You can still update current dates later; the baseline stays as a fixed reference point.
            </p>
            <div className="flex items-center gap-2 justify-end pt-1">
              <button onClick={() => setConfirmApproveOpen(false)} className="rounded-md px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
              <button onClick={handleApprove} disabled={approving}
                className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60">
                {approving ? 'Locking…' : 'Approve & Lock Baseline'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmResetOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white dark:bg-slate-800 p-5 shadow-xl space-y-3">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <RotateCcw className="h-4 w-4 text-amber-500" /> Reset Baseline?
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-300">Re-locks current dates as the new plan. A reason is logged for this event.</p>
            <textarea className={inputCls} rows={2} placeholder="Reason for resetting the baseline…" value={resetReason} onChange={e => setResetReason(e.target.value)} />
            <div className="flex items-center gap-2 justify-end pt-1">
              <button onClick={() => setConfirmResetOpen(false)} className="rounded-md px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
              <button onClick={handleResetBaseline} disabled={resetting}
                className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60">
                {resetting ? 'Resetting…' : 'Reset Baseline'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
