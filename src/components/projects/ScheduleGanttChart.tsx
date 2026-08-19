import { useMemo } from 'react'
import { formatDateGC } from '@/lib/utils'
import { daysSlipped } from '@/lib/scheduleTree'
import type { ScheduleTask, ScheduleTaskStatus } from '@/types/database'
import { AlertTriangle } from 'lucide-react'

// Read-mostly visualization (item 35-37 of the PR 9b prompt). Deliberately
// NO drag-to-resize or drag-to-move here — clicking a bar opens the same
// ScheduleTaskFormModal the table view uses for editing, so there is one
// reliable editing path, not two fragile pixel-to-date ones. This is a
// scoping decision, not an oversight.
//
// Reuses ScheduleSection's already-loaded, already-ordered task list
// (buildTaskTree) rather than calling v_schedule_gantt_data — that RPC
// (219) computes the identical DFS/depth shape, verified against this
// exact client-side walk in migration 219's checkpoint, so calling it
// separately here would just be a second round-trip and a second parallel
// data path for the same schedule, not a different result.

const ROW_HEIGHT = 32
const BAR_HEIGHT = 16
const PX_PER_DAY = 10
const LABEL_COL_WIDTH = 220

const STATUS_BAR_CLASS: Record<ScheduleTaskStatus, string> = {
  not_started: 'bg-slate-300 dark:bg-slate-600',
  in_progress: 'bg-blue-500',
  completed: 'bg-green-500',
  blocked: 'bg-red-500',
  on_hold: 'bg-red-300 dark:bg-red-400/70',
}

type GanttTask = ScheduleTask & { depth: number }

interface Props {
  tasks: GanttTask[]
  onEditTask: (task: ScheduleTask) => void
}

export function ScheduleGanttChart({ tasks, onEditTask }: Props) {
  const { rangeStartMs, totalDays, rowIndexById } = useMemo(() => {
    // The 0-task case renders nothing (see the early return below) — this
    // branch just needs a stable, non-empty shape so the hook stays pure.
    if (tasks.length === 0) return { rangeStartMs: 0, totalDays: 1, rowIndexById: new Map<string, number>() }

    const allDates: number[] = []
    for (const t of tasks) {
      allDates.push(new Date(t.current_start_date).getTime(), new Date(t.current_end_date).getTime())
      if (t.planned_start_date) allDates.push(new Date(t.planned_start_date).getTime())
      if (t.planned_end_date) allDates.push(new Date(t.planned_end_date).getTime())
    }
    const minMs = Math.min(...allDates)
    const maxMs = Math.max(...allDates)
    // Pad a few days on each side so bars at the edges aren't clipped.
    const start = minMs - 3 * 86400000
    const days = Math.max(1, Math.ceil((maxMs - minMs) / 86400000) + 6)

    const idx = new Map<string, number>()
    tasks.forEach((t, i) => idx.set(t.id, i))

    return { rangeStartMs: start, totalDays: days, rowIndexById: idx }
  }, [tasks])

  function dayOffset(dateStr: string) {
    return Math.round((new Date(dateStr).getTime() - rangeStartMs) / 86400000)
  }

  const chartWidth = totalDays * PX_PER_DAY
  const chartHeight = tasks.length * ROW_HEIGHT

  // Month gridlines/labels along the top.
  const monthMarks = useMemo(() => {
    const marks: { x: number; label: string }[] = []
    const start = new Date(rangeStartMs)
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
    while (cursor.getTime() < rangeStartMs + totalDays * 86400000) {
      const x = Math.round((cursor.getTime() - rangeStartMs) / 86400000) * PX_PER_DAY
      marks.push({ x, label: cursor.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) })
      cursor.setMonth(cursor.getMonth() + 1)
    }
    return marks
  }, [rangeStartMs, totalDays])

  if (tasks.length === 0) return null

  return (
    <div className="overflow-x-auto border rounded-md dark:border-slate-700">
      <div className="flex" style={{ width: LABEL_COL_WIDTH + chartWidth }}>
        {/* Label column */}
        <div className="shrink-0 border-r dark:border-slate-700" style={{ width: LABEL_COL_WIDTH }}>
          <div className="h-6 border-b dark:border-slate-700" />
          {tasks.map(t => (
            <div key={t.id} className="flex items-center text-xs text-slate-700 dark:text-slate-200 truncate px-2 border-b dark:border-slate-800"
              style={{ height: ROW_HEIGHT, paddingLeft: `${8 + (t.depth - 1) * 12}px` }} title={t.title}>
              {t.title}
            </div>
          ))}
        </div>

        {/* Timeline */}
        <div className="relative" style={{ width: chartWidth }}>
          <div className="h-6 border-b dark:border-slate-700 relative">
            {monthMarks.map(m => (
              <div key={m.x} className="absolute top-0 h-full text-[10px] text-slate-400 border-l dark:border-slate-700 pl-1 pt-1"
                style={{ left: m.x }}>
                {m.label}
              </div>
            ))}
          </div>

          <svg className="absolute top-6 left-0 pointer-events-none" width={chartWidth} height={chartHeight}>
            <defs>
              <marker id="gantt-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 z" className="fill-slate-400 dark:fill-slate-500" />
              </marker>
            </defs>
            {tasks.map(t => {
              if (!t.predecessor_task_id) return null
              const predIdx = rowIndexById.get(t.predecessor_task_id)
              const pred = tasks.find(p => p.id === t.predecessor_task_id)
              const myIdx = rowIndexById.get(t.id)
              if (predIdx == null || myIdx == null || !pred) return null
              const x1 = dayOffset(pred.current_end_date) * PX_PER_DAY
              const y1 = predIdx * ROW_HEIGHT + ROW_HEIGHT / 2
              const x2 = dayOffset(t.current_start_date) * PX_PER_DAY
              const y2 = myIdx * ROW_HEIGHT + ROW_HEIGHT / 2
              return (
                <path key={t.id} d={`M${x1},${y1} L${x1 + 6},${y1} L${x1 + 6},${y2} L${x2 - 2},${y2}`}
                  fill="none" strokeWidth={1} markerEnd="url(#gantt-arrow)" className="stroke-slate-400 dark:stroke-slate-500" />
              )
            })}
          </svg>

          {tasks.map((t, i) => {
            const top = i * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2
            const slip = daysSlipped(t)
            const overdue = t.current_end_date < new Date().toISOString().slice(0, 10) && t.status !== 'completed'

            const hasBaseline = !!t.planned_start_date && !!t.planned_end_date
            const baselineLeft = hasBaseline ? dayOffset(t.planned_start_date!) * PX_PER_DAY : 0
            const baselineWidth = hasBaseline ? Math.max(2, (dayOffset(t.planned_end_date!) - dayOffset(t.planned_start_date!) + 1) * PX_PER_DAY) : 0

            const currentLeft = dayOffset(t.current_start_date) * PX_PER_DAY
            const currentWidth = Math.max(2, (dayOffset(t.current_end_date) - dayOffset(t.current_start_date) + 1) * PX_PER_DAY)

            return (
              <div key={t.id} className="absolute border-b dark:border-slate-800" style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT, left: 0, width: chartWidth }}>
                {/* Baseline ghost bar, behind the current bar */}
                {hasBaseline && (
                  <div className="absolute rounded-sm border border-dashed border-slate-400 dark:border-slate-500 bg-slate-200/40 dark:bg-slate-500/20"
                    style={{ left: baselineLeft, width: baselineWidth, top, height: BAR_HEIGHT }} />
                )}
                {/* Current bar, with a darker progress-fill overlay (PR 9c) growing
                    from the left — same bar, no separate track, so slip and
                    progress read together at a glance. */}
                <button
                  onClick={() => onEditTask(t)}
                  title={`${t.title} — ${formatDateGC(t.current_start_date)} to ${formatDateGC(t.current_end_date)}${slip != null && slip !== 0 ? ` (${slip > 0 ? '+' : ''}${slip}d vs plan)` : ''} — ${t.progress_pct}% ${t.progress_source === 'derived' ? '(from work orders)' : '(manual)'}`}
                  className={`absolute rounded-sm cursor-pointer hover:brightness-110 flex items-center overflow-hidden ${STATUS_BAR_CLASS[t.status]} ${overdue ? 'ring-2 ring-offset-1 ring-amber-500 dark:ring-offset-slate-800' : ''}`}
                  style={{ left: currentLeft, width: currentWidth, top, height: BAR_HEIGHT }}
                >
                  <span className="absolute inset-y-0 left-0 bg-black/25" style={{ width: `${t.progress_pct}%` }} />
                  {overdue && <AlertTriangle className="relative h-3 w-3 text-amber-700 dark:text-amber-300 mx-auto" />}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
