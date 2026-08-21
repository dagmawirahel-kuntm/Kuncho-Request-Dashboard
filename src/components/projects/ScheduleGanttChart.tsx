import { useEffect, useMemo, useRef, useState } from 'react'
import { formatDateGC } from '@/lib/utils'
import { daysSlipped } from '@/lib/scheduleTree'
import type { ScheduleTask, ScheduleTaskStatus } from '@/types/database'
import { AlertTriangle } from 'lucide-react'

// Read-mostly visualization. Deliberately NO drag-to-resize/move — clicking
// a bar opens the same ScheduleTaskFormModal the table view uses, so there
// is one reliable editing path, not two fragile pixel-to-date ones.
//
// Reuses ScheduleSection's already-ordered task list (buildTaskTree) rather
// than calling v_schedule_gantt_data — that RPC computes the identical
// DFS/depth shape, so a separate call would just be a second round-trip.

type Zoom = 'day' | 'week' | 'month'
const PX_PER_DAY: Record<Zoom, number> = { day: 30, week: 12, month: 4.5 }

const DAY_MS = 86400000

// Track (translucent) + fill (solid) per status, so progress reads as "how
// much of the colored bar is filled" instead of a muddy dark overlay.
const STATUS_STYLE: Record<ScheduleTaskStatus, { track: string; fill: string; label: string }> = {
  not_started: { track: 'bg-slate-300/50 dark:bg-slate-600/50', fill: 'bg-slate-400 dark:bg-slate-500', label: 'Not started' },
  in_progress: { track: 'bg-blue-500/25', fill: 'bg-blue-500', label: 'In progress' },
  completed: { track: 'bg-green-500/25', fill: 'bg-green-500', label: 'Completed' },
  blocked: { track: 'bg-red-500/25', fill: 'bg-red-500', label: 'Blocked' },
  on_hold: { track: 'bg-amber-400/25', fill: 'bg-amber-400', label: 'On hold' },
}

type GanttTask = ScheduleTask & { depth: number }

interface Props {
  tasks: GanttTask[]
  onEditTask: (task: ScheduleTask) => void
  fullscreen?: boolean
}

export function ScheduleGanttChart({ tasks, onEditTask, fullscreen = false }: Props) {
  const [zoom, setZoom] = useState<Zoom>('week')
  const scrollRef = useRef<HTMLDivElement>(null)
  // Stable across renders (keeps the memo/hooks pure — no Date.now() inside them).
  const [todayStr] = useState(() => new Date().toISOString().slice(0, 10))

  const ROW_H = fullscreen ? 38 : 34
  const BAR_H = 18
  const LABEL_W = fullscreen ? 300 : 240
  const HEADER_H = 46
  const pxPerDay = PX_PER_DAY[zoom]

  // Which rows are phase/summary rows (a parent of some other task).
  const childParentIds = useMemo(() => {
    const s = new Set<string>()
    for (const t of tasks) if (t.parent_task_id) s.add(t.parent_task_id)
    return s
  }, [tasks])

  const { rangeStartMs, totalDays, rowIndexById } = useMemo(() => {
    if (tasks.length === 0) return { rangeStartMs: 0, totalDays: 1, rowIndexById: new Map<string, number>() }
    const all: number[] = []
    for (const t of tasks) {
      all.push(new Date(t.current_start_date).getTime(), new Date(t.current_end_date).getTime())
      if (t.planned_start_date) all.push(new Date(t.planned_start_date).getTime())
      if (t.planned_end_date) all.push(new Date(t.planned_end_date).getTime())
    }
    const minMs = Math.min(...all)
    const maxMs = Math.max(...all)
    // Pad so edge bars and the today line aren't clipped.
    const start = minMs - 5 * DAY_MS
    const days = Math.max(1, Math.ceil((maxMs - minMs) / DAY_MS) + 12)
    const idx = new Map<string, number>()
    tasks.forEach((t, i) => idx.set(t.id, i))
    return { rangeStartMs: start, totalDays: days, rowIndexById: idx }
  }, [tasks])

  // Per-day calendar metadata (weekend shading, week/month gridlines, labels).
  const days = useMemo(() => {
    const out: { i: number; date: Date; weekend: boolean; monthStart: boolean; weekStart: boolean }[] = []
    for (let i = 0; i < totalDays; i++) {
      const date = new Date(rangeStartMs + i * DAY_MS)
      const dow = date.getDay()
      out.push({
        i, date,
        weekend: dow === 0 || dow === 6,
        monthStart: date.getDate() === 1,
        weekStart: dow === 1, // Monday
      })
    }
    return out
  }, [rangeStartMs, totalDays])

  const monthMarks = useMemo(() => {
    const marks: { x: number; label: string }[] = []
    const start = new Date(rangeStartMs)
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
    while (cursor.getTime() < rangeStartMs + totalDays * DAY_MS) {
      const off = Math.round((cursor.getTime() - rangeStartMs) / DAY_MS)
      marks.push({ x: off * pxPerDay, label: cursor.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) })
      cursor.setMonth(cursor.getMonth() + 1)
    }
    return marks
  }, [rangeStartMs, totalDays, pxPerDay])

  function dayOffset(dateStr: string) {
    return Math.round((new Date(dateStr).getTime() - rangeStartMs) / DAY_MS)
  }

  const chartW = totalDays * pxPerDay
  const bodyH = tasks.length * ROW_H
  const todayX = (dayOffset(todayStr) + 0.5) * pxPerDay
  const todayInRange = dayOffset(todayStr) >= 0 && dayOffset(todayStr) < totalDays

  // Center today on first paint / zoom change.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !todayInRange) return
    el.scrollLeft = Math.max(0, todayX - el.clientWidth / 2 + LABEL_W)
  }, [todayX, todayInRange, LABEL_W])

  if (tasks.length === 0) return null

  const showDayLabels = zoom === 'day'
  const maxHeight = fullscreen ? '100%' : 480

  return (
    <div className="flex flex-col gap-2" style={fullscreen ? { height: '100%' } : undefined}>
      {/* Toolbar: zoom + legend */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center rounded-md border dark:border-slate-600 overflow-hidden text-xs">
          {(['day', 'week', 'month'] as Zoom[]).map(z => (
            <button key={z} onClick={() => setZoom(z)}
              className={`px-2.5 py-1 capitalize ${zoom === z ? 'bg-brand text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
              {z}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] text-slate-500 dark:text-slate-400">
          <LegendChip className="bg-blue-500" label="In progress" />
          <LegendChip className="bg-green-500" label="Completed" />
          <LegendChip className="bg-red-500" label="Blocked" />
          <LegendChip className="bg-amber-400" label="On hold" />
          <LegendChip className="bg-slate-400" label="Not started" />
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-3 rounded-sm border border-dashed border-slate-400" /> Baseline</span>
          <span className="flex items-center gap-1"><span className="inline-block h-3 w-0.5 bg-rose-500" /> Today</span>
        </div>
      </div>

      {/* Chart scroll area */}
      <div ref={scrollRef} className="overflow-auto border rounded-md dark:border-slate-700 bg-white dark:bg-slate-800"
        style={{ maxHeight, height: fullscreen ? '100%' : undefined }}>
        <div style={{ width: LABEL_W + chartW, minWidth: '100%' }}>
          {/* HEADER (sticky top) */}
          <div className="flex sticky top-0 z-20" style={{ height: HEADER_H }}>
            <div className="sticky left-0 z-30 shrink-0 bg-slate-50 dark:bg-slate-900 border-r border-b dark:border-slate-700 flex items-end px-3 pb-1"
              style={{ width: LABEL_W }}>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Task</span>
            </div>
            <div className="relative shrink-0 bg-slate-50 dark:bg-slate-900 border-b dark:border-slate-700" style={{ width: chartW, height: HEADER_H }}>
              {/* Month row */}
              {monthMarks.map(m => (
                <div key={m.x} className="absolute top-0 h-1/2 flex items-center border-l dark:border-slate-700 pl-1.5 text-[11px] font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap"
                  style={{ left: m.x }}>{m.label}</div>
              ))}
              {/* Day/week tick row */}
              <div className="absolute bottom-0 left-0 right-0 h-1/2 border-t dark:border-slate-700">
                {days.map(d => {
                  if (showDayLabels) {
                    return (
                      <div key={d.i} className={`absolute bottom-0 top-0 flex items-center justify-center text-[9px] ${d.weekend ? 'text-slate-300 dark:text-slate-600' : 'text-slate-500 dark:text-slate-400'}`}
                        style={{ left: d.i * pxPerDay, width: pxPerDay }}>{d.date.getDate()}</div>
                    )
                  }
                  if (d.weekStart) {
                    return (
                      <div key={d.i} className="absolute bottom-0 top-0 flex items-center border-l dark:border-slate-700/60 pl-0.5 text-[9px] text-slate-400"
                        style={{ left: d.i * pxPerDay }}>{d.date.getDate()}</div>
                    )
                  }
                  return null
                })}
              </div>
            </div>
          </div>

          {/* BODY */}
          <div className="flex" style={{ height: bodyH }}>
            {/* Sticky label column */}
            <div className="sticky left-0 z-10 shrink-0 bg-white dark:bg-slate-800 border-r dark:border-slate-700" style={{ width: LABEL_W }}>
              {tasks.map((t, i) => {
                const isSummary = childParentIds.has(t.id)
                return (
                  <div key={t.id} className={`flex items-center gap-1.5 text-xs truncate px-2 border-b dark:border-slate-800 ${i % 2 ? 'bg-slate-50/60 dark:bg-slate-800/40' : ''} ${isSummary ? 'font-semibold text-slate-800 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300'}`}
                    style={{ height: ROW_H, paddingLeft: `${8 + (t.depth - 1) * 14}px` }} title={t.title}>
                    <span className="truncate">{t.title}</span>
                  </div>
                )
              })}
            </div>

            {/* Timeline body */}
            <div className="relative shrink-0" style={{ width: chartW, height: bodyH }}>
              {/* Weekend shading + week gridlines */}
              {days.map(d => (
                <div key={d.i} className="absolute top-0 bottom-0" style={{ left: d.i * pxPerDay, width: pxPerDay }}>
                  {d.weekend && <div className="absolute inset-0 bg-slate-100/70 dark:bg-slate-900/40" />}
                  {(d.weekStart || d.monthStart) && (
                    <div className={`absolute inset-y-0 left-0 border-l ${d.monthStart ? 'border-slate-200 dark:border-slate-700' : 'border-slate-100 dark:border-slate-800'}`} />
                  )}
                </div>
              ))}

              {/* Row separators + zebra */}
              {tasks.map((t, i) => (
                <div key={t.id} className={`absolute left-0 right-0 border-b dark:border-slate-800 ${i % 2 ? 'bg-slate-50/40 dark:bg-slate-800/20' : ''}`}
                  style={{ top: i * ROW_H, height: ROW_H }} />
              ))}

              {/* Today line */}
              {todayInRange && (
                <div className="absolute top-0 z-10 w-0.5 bg-rose-500/80 pointer-events-none" style={{ left: todayX, height: bodyH }} />
              )}

              {/* Dependency arrows */}
              <svg className="absolute top-0 left-0 pointer-events-none" width={chartW} height={bodyH}>
                <defs>
                  <marker id="gantt-arrow" markerWidth="7" markerHeight="7" refX="5.5" refY="3" orient="auto">
                    <path d="M0,0 L6,3 L0,6 z" className="fill-slate-400 dark:fill-slate-500" />
                  </marker>
                </defs>
                {tasks.map(t => {
                  if (!t.predecessor_task_id) return null
                  const predIdx = rowIndexById.get(t.predecessor_task_id)
                  const pred = tasks.find(p => p.id === t.predecessor_task_id)
                  const myIdx = rowIndexById.get(t.id)
                  if (predIdx == null || myIdx == null || !pred) return null
                  const x1 = (dayOffset(pred.current_end_date) + 1) * pxPerDay
                  const y1 = predIdx * ROW_H + 6 + BAR_H / 2
                  const x2 = dayOffset(t.current_start_date) * pxPerDay
                  const y2 = myIdx * ROW_H + 6 + BAR_H / 2
                  const midX = Math.max(x1 + 8, x2 - 8)
                  return (
                    <path key={t.id} d={`M${x1},${y1} L${midX},${y1} L${midX},${y2} L${x2 - 2},${y2}`}
                      fill="none" strokeWidth={1.25} markerEnd="url(#gantt-arrow)" className="stroke-slate-400/70 dark:stroke-slate-500/70" />
                  )
                })}
              </svg>

              {/* Bars */}
              {tasks.map((t, i) => {
                const rowTop = i * ROW_H
                const barTop = rowTop + 6
                const isSummary = childParentIds.has(t.id)
                const slip = daysSlipped(t)
                const overdue = t.current_end_date < todayStr && t.status !== 'completed'
                const st = STATUS_STYLE[t.status]

                const left = dayOffset(t.current_start_date) * pxPerDay
                const width = Math.max(4, (dayOffset(t.current_end_date) - dayOffset(t.current_start_date) + 1) * pxPerDay)

                const hasBaseline = !!t.planned_start_date && !!t.planned_end_date
                const bLeft = hasBaseline ? dayOffset(t.planned_start_date!) * pxPerDay : 0
                const bWidth = hasBaseline ? Math.max(4, (dayOffset(t.planned_end_date!) - dayOffset(t.planned_start_date!) + 1) * pxPerDay) : 0

                const tip = `${t.title} — ${formatDateGC(t.current_start_date)} to ${formatDateGC(t.current_end_date)}`
                  + `${slip != null && slip !== 0 ? ` (${slip > 0 ? '+' : ''}${slip}d vs plan)` : ''}`
                  + ` — ${t.progress_pct}% ${t.progress_source === 'derived' ? '(from work orders)' : '(manual)'}`

                if (isSummary) {
                  // Phase/summary bar: slim dark span with end caps.
                  return (
                    <div key={t.id} className="absolute" style={{ top: rowTop, height: ROW_H, left: 0, right: 0 }}>
                      <button onClick={() => onEditTask(t)} title={tip}
                        className="absolute cursor-pointer group" style={{ left, width, top: barTop + 3, height: BAR_H - 6 }}>
                        <div className="absolute inset-0 rounded-sm bg-slate-700 dark:bg-slate-300 group-hover:brightness-110" />
                        <div className="absolute -bottom-1 left-0 w-2 h-2 bg-slate-700 dark:bg-slate-300" style={{ clipPath: 'polygon(0 0, 100% 0, 0 100%)' }} />
                        <div className="absolute -bottom-1 right-0 w-2 h-2 bg-slate-700 dark:bg-slate-300" style={{ clipPath: 'polygon(100% 0, 0 0, 100% 100%)' }} />
                      </button>
                    </div>
                  )
                }

                return (
                  <div key={t.id} className="absolute" style={{ top: rowTop, height: ROW_H, left: 0, right: 0 }}>
                    {/* Baseline ghost (thin, under the main bar) */}
                    {hasBaseline && (
                      <div className="absolute rounded-sm border border-dashed border-slate-400/70 dark:border-slate-500/70"
                        style={{ left: bLeft, width: bWidth, top: barTop + BAR_H + 1, height: 3 }} title="Baseline (planned)" />
                    )}
                    {/* Main bar: translucent track + solid progress fill */}
                    <button onClick={() => onEditTask(t)} title={tip}
                      className={`absolute rounded-md cursor-pointer overflow-hidden ring-1 ring-inset ring-black/5 dark:ring-white/10 shadow-sm hover:brightness-105 ${st.track} ${overdue ? 'outline outline-2 outline-offset-1 outline-amber-500' : ''}`}
                      style={{ left, width, top: barTop, height: BAR_H }}>
                      <span className={`absolute inset-y-0 left-0 ${st.fill}`} style={{ width: `${t.progress_pct}%` }} />
                      {width > 34 && (
                        <span className="absolute inset-0 flex items-center justify-end pr-1 text-[10px] font-medium text-slate-700 dark:text-slate-100 mix-blend-luminosity">
                          {t.progress_pct}%
                        </span>
                      )}
                      {overdue && width <= 34 && (
                        <AlertTriangle className="absolute inset-0 m-auto h-3 w-3 text-amber-600" />
                      )}
                    </button>
                    {/* Slip badge to the right of the bar */}
                    {slip != null && slip > 0 && (
                      <span className="absolute text-[9px] font-semibold text-red-500 whitespace-nowrap"
                        style={{ left: left + width + 4, top: barTop + 3 }}>+{slip}d</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function LegendChip({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`inline-block h-2.5 w-3 rounded-sm ${className}`} />
      {label}
    </span>
  )
}
