import type { ScheduleTask } from '@/types/database'

// DFS tree order matching the DB's own v_schedule_gantt_data depth
// convention (root depth = 1) — used to indent/order the table view the
// same way the (later) Gantt view will via that RPC, without a second
// round-trip just to render a flat table.
export function buildTaskTree(tasks: ScheduleTask[]): (ScheduleTask & { depth: number })[] {
  const byParent = new Map<string | null, ScheduleTask[]>()
  for (const t of tasks) {
    const key = t.parent_task_id
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(t)
  }
  for (const list of byParent.values()) list.sort((a, b) => a.display_order - b.display_order)

  const result: (ScheduleTask & { depth: number })[] = []
  function walk(parentId: string | null, depth: number) {
    for (const t of byParent.get(parentId) ?? []) {
      result.push({ ...t, depth })
      walk(t.id, depth + 1)
    }
  }
  walk(null, 1)
  return result
}

export function daysSlipped(t: Pick<ScheduleTask, 'current_end_date' | 'planned_end_date'>): number | null {
  if (!t.planned_end_date) return null
  const current = new Date(t.current_end_date).getTime()
  const planned = new Date(t.planned_end_date).getTime()
  return Math.round((current - planned) / 86400000)
}

// How many tasks are transitively reachable from `taskId` via
// auto_cascade=true predecessor->successor links. This is an existence/
// reach count for the "N downstream task(s)" warning (item 32) — it
// deliberately does NOT replicate the cascade trigger's working-day math
// client-side (duplicating that logic in JS would be its own source of
// drift from the DB's actual behavior); it only answers "how many tasks
// COULD move," which is what the warning needs.
export function countDownstream(tasks: ScheduleTask[], taskId: string): number {
  const bySuccessor = new Map<string, ScheduleTask[]>()
  for (const t of tasks) {
    if (t.predecessor_task_id) {
      if (!bySuccessor.has(t.predecessor_task_id)) bySuccessor.set(t.predecessor_task_id, [])
      bySuccessor.get(t.predecessor_task_id)!.push(t)
    }
  }
  const seen = new Set<string>()
  function walk(id: string) {
    for (const s of bySuccessor.get(id) ?? []) {
      if (s.auto_cascade && !seen.has(s.id)) {
        seen.add(s.id)
        walk(s.id)
      }
    }
  }
  walk(taskId)
  return seen.size
}
