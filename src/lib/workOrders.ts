import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useMyStaffId } from '@/hooks/useMyStaff'
import type { Tone } from '@/components/record/Record'

// Work orders (386): a job broken into items; progress follows the items.

export interface WorkOrderItem {
  id: string
  work_order_id: string
  description: string
  unit: string | null
  /** null: a step to tick, done when done_quantity > 0 */
  quantity: number | null
  done_quantity: number
  sort_order: number
}

export interface WorkOrderBoardRow {
  work_order_id: string
  items_total: number
  items_done: number
  last_update_at: string | null
  open_labour_requests: number
  labour_cost: number
  // Blockers (397)
  open_blockers?: number
  stopping_blockers?: number
  blocked_since?: string | null
  main_blocker_kind?: string | null
  main_blocker?: string | null
  /** Days the work was stopped, each day once. */
  days_lost?: number
  /** The target date pushed by days_lost. */
  adjusted_due_date?: string | null
  /** Labour estimate from the order's requests (408). */
  labour_estimate?: number
  /** People with labour logged on the order, old log and new entries. */
  workers_logged?: number
}

/** Attendance logged on the order before the labour screens (408). */
export interface WorkOrderLabourHistoryRow {
  work_order_id: string
  staff_id: string
  worker_name: string | null
  days: number
  first_day: string
  last_day: string
  cost: number
  drafted_for_pay: number
  paid_under_other_order: number
}

export interface WorkOrderLabourRow {
  work_order_id: string
  labor_requisition_id: string
  role_needed: string
  headcount: number
  status: 'pending' | 'approved' | 'rejected'
  payment_basis: string
  start_date: string | null
  end_date: string | null
  closed_at: string | null
  confirmed_cost: number
  recorded_cost: number
  days_recorded: number
  last_recorded: string | null
}

export const WO_STATUS: Record<string, { label: string; tone: Tone }> = {
  requested: { label: 'Not started', tone: 'amber' },
  in_progress: { label: 'In progress', tone: 'blue' },
  completed: { label: 'Done', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'slate' },
}

export const itemShare = (i: Pick<WorkOrderItem, 'quantity' | 'done_quantity'>) =>
  i.quantity == null ? (i.done_quantity > 0 ? 1 : 0) : Math.min(Number(i.done_quantity) / Number(i.quantity), 1)

export const itemDone = (i: Pick<WorkOrderItem, 'quantity' | 'done_quantity'>) => itemShare(i) >= 1

/** Same arithmetic as work_order_items_progress() in the database. */
export const itemsProgress = (items: Pick<WorkOrderItem, 'quantity' | 'done_quantity'>[]) =>
  items.length ? Math.round(1000 * items.reduce((s, i) => s + itemShare(i), 0) / items.length) / 10 : null

export const daysSince = (ts: string | null | undefined) =>
  ts ? Math.floor((Date.now() - new Date(ts).getTime()) / 86_400_000) : null

/** An open order nobody has updated for this many days needs a look. */
export const STALE_DAYS = 4

export const UNITS = ['m²', 'm', 'm³', 'pcs', 'sets', 'rooms', 'points', 'kg']

export function useWorkOrderItems(workOrderId: string) {
  return useQuery({
    queryKey: ['work-order-items', workOrderId],
    enabled: !!workOrderId,
    queryFn: async () => {
      const { data, error } = await supabase.from('work_order_items').select('*').eq('work_order_id', workOrderId).order('sort_order')
      if (error) throw error
      return (data ?? []) as WorkOrderItem[]
    },
  })
}


/** The work orders the signed-in person leads or is on the crew of (388):
 *  theirs to record progress on, whatever their login role. */
export function useMyJobIds() {
  const { data: me } = useMyStaffId()
  const staffId = me?.id
  const query = useQuery({
    queryKey: ['my-work-order-ids', staffId],
    queryFn: async () => {
      const [lead, crew] = await Promise.all([
        supabase.from('work_orders').select('id').eq('assigned_lead_staff_id', staffId!),
        supabase.from('work_order_crew').select('work_order_id').eq('staff_id', staffId!).is('removed_at', null),
      ])
      if (lead.error) throw lead.error
      if (crew.error) throw crew.error
      return new Set([...(lead.data ?? []).map(r => r.id as string), ...(crew.data ?? []).map(r => r.work_order_id as string)])
    },
    enabled: !!staffId,
  })
  return query.data ?? EMPTY_IDS
}
const EMPTY_IDS: ReadonlySet<string> = new Set()

// ── Project → work order → people → work done (migration 476) ─────────

/** Someone on a work order's crew, or recorded on it. */
export interface WorkOrderPerson {
  staff_id: string | null
  name: string
  trade: string | null
  casual: boolean | null
  role: string | null
  is_lead: boolean | null
  on_crew: boolean
  since: string | null
  days: number
  hours: number
  overtime_hours: number
  quantity: number | null
  today: number | null
  first_day: string | null
  last_day: string | null
  /** null when this viewer doesn't see labour costs */
  cost: number | null
  unconfirmed: number | null
  requests: { id: string; role: string; open: boolean }[]
}

export function useWorkOrderPeople(workOrderId: string | undefined) {
  return useQuery({
    queryKey: ['work-order-people', workOrderId],
    enabled: !!workOrderId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('work_order_people', { p_wo: workOrderId })
      if (error) throw error
      const d = (data ?? {}) as { people?: WorkOrderPerson[]; costs_visible?: boolean }
      return { people: d.people ?? [], costsVisible: !!d.costs_visible }
    },
  })
}

export type WorkFlag = 'no_progress' | 'behind' | 'idle' | 'overdue'
export const WORK_FLAG: Record<WorkFlag, { label: string; hint: string; tone: Tone }> = {
  no_progress: { label: 'No progress logged', hint: 'Worked on in the last two weeks, but nobody has updated its progress', tone: 'amber' },
  behind: { label: 'Labour ahead of progress', hint: 'More of the planned labour is spent than the job is done', tone: 'red' },
  idle: { label: 'Crew idle', hint: 'People on the crew, but no work recorded for two weeks', tone: 'slate' },
  overdue: { label: 'Overdue', hint: 'Past its target date', tone: 'red' },
}

/** One work order on the project's work board. */
export interface ProjectWorkRow {
  id: string
  title: string
  status: string
  progress: number | null
  due: string | null
  lead: string | null
  crew: number
  today: number
  week_days: number
  person_days: number
  cost: number | null
  planned: number | null
  spent_pct: number | null
  last_worked: string | null
  last_update: string | null
  flags: WorkFlag[]
}

export function useProjectWorkBoard(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project-work-board', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('project_work_board', { p_project: projectId })
      if (error) throw error
      const d = (data ?? {}) as {
        orders?: ProjectWorkRow[]; costs_visible?: boolean
        unlinked?: { requests: number; person_days: number; cost: number | null; last_worked: string | null }
      }
      return { orders: d.orders ?? [], unlinked: d.unlinked ?? null, costsVisible: !!d.costs_visible }
    },
  })
}
