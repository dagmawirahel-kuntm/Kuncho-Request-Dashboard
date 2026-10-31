import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useMyStaffId } from '@/hooks/useMyStaff'
import type { Tone } from '@/components/record/Record'

// Labour costed to the project, a day at a time (migrations 489–491): each
// PM asks for the next day's headcount, then fills one end-of-day sheet —
// who was paid for the day, and how it split across projects (build or
// post-event repair) and the workshop, stock production or idle time.

export type Bucket = 'build' | 'repair' | 'workshop' | 'stock' | 'idle'
export const PROJECT_BUCKETS: Bucket[] = ['build', 'repair']
export const OTHER_BUCKETS: Bucket[] = ['workshop', 'stock', 'idle']
export const BUCKET_LABEL: Record<Bucket, string> = {
  build: 'Build',
  repair: 'Repair',
  workshop: 'Workshop maintenance',
  stock: 'Stock fixture production',
  idle: 'General / idle',
}
export const BUCKET_SHORT: Record<Bucket, string> = {
  build: 'Build', repair: 'Repair', workshop: 'Workshop', stock: 'Stock', idle: 'Idle',
}

export type DayStatus = 'none' | 'open' | 'submitted' | 'locked'
export const DAY_STATUS: Record<DayStatus, { label: string; tone: Tone }> = {
  none: { label: 'Not started', tone: 'slate' },
  open: { label: 'With the PM', tone: 'amber' },
  submitted: { label: 'Sent for review', tone: 'blue' },
  locked: { label: 'Locked', tone: 'green' },
}
export type RequestStatus = 'draft' | 'submitted' | 'approved' | 'rejected'
export const REQUEST_STATUS: Record<RequestStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'slate' },
  submitted: { label: 'Waiting for approval', tone: 'amber' },
  approved: { label: 'Approved', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
}

export type Alloc = { project_id: string; bucket: Bucket; days: number }
export type SheetWorker = {
  staff_id: string; name: string; trade: string | null; day_rate: number | null; photo_url: string | null; verified: boolean
  paid_days: number; overtime_hours: number; overtime_night_hours: number; note: string | null
  paid: boolean; elsewhere: number; alloc: Alloc[]
}
export type DaySheet = {
  pm: { id: string; name: string | null }
  date: string
  starts_on: string | null
  can_edit: boolean
  is_approver: boolean
  day: null | {
    id: string; status: Exclude<DayStatus, 'none'>; saved_at: string | null; saved_by_name: string | null
    submitted_at: string | null; locked_at: string | null; locked_by_name: string | null; review_note: string | null
    changes: number; paid: boolean
  }
  prefilled_from: string | null
  workers: SheetWorker[]
  projects: { id: string; name: string; mine: boolean; delivered: boolean }[]
  buckets: Record<'workshop' | 'stock' | 'idle', { id: string; name: string } | null>
  request: null | {
    id: string; code: string; status: RequestStatus; decided_by_name: string | null; decision_note: string | null
    starts_on: string; ends_on: string | null; weekdays: number[]; works_today: boolean
    lines: { trade: string; headcount: number }[]
  }
  jobs: PieceJob[]
}

/** A volume or fixed-price job on the PM's day sheet (492). */
export type PieceJob = {
  id: string; what: string; scope: string | null; basis: 'per_volume' | 'fixed_price'
  project_id: string; project: string; work_order_id: string | null; work_order: string | null
  unit: string | null; unit_rate: number | null; fixed_price: number | null; planned_volume: number | null
  crew_leader: string | null
  /** Volume measured, or % done, before this day. */
  done_before: number
  /** Volume measured, or % added, on this day. */
  today: number | null
  today_paid: boolean
  crew: { staff_id: string; name: string; present: boolean }[]
}

/** A PM's standing crew (492): from work_date, on weekdays, until ends_on (or changed). */
export type CrewRequest = {
  id: string; code: string; pm_staff_id: string; work_date: string; ends_on: string | null; weekdays: number[]; status: RequestStatus; note: string | null
  created_by_name: string | null; submitted_at: string | null; decided_by_name: string | null; decided_at: string | null; decision_note: string | null
  staff: { employee_name: string } | null
  labour_day_request_lines: { trade_tag: string; headcount: number }[]
}
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
/** "Mon–Sat", "Mon Wed Fri", "every day". */
export function weekdaysLabel(days: number[]) {
  const d = [...days].sort()
  if (d.length === 7) return 'every day'
  if (d.join() === '1,2,3,4,5,6') return 'Mon–Sat'
  if (d.join() === '1,2,3,4,5') return 'Mon–Fri'
  return d.map(x => WEEKDAYS[x - 1]).join(' ')
}
const shortDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
/** "From Mon 3 Nov, Mon–Sat, until changed" / "Only Wed 5 Nov" / "Mon 3 Nov – Sat 15 Nov, Mon–Sat". */
export function crewSpan(r: Pick<CrewRequest, 'work_date' | 'ends_on' | 'weekdays' | 'labour_day_request_lines'>) {
  if (!r.labour_day_request_lines.length) return `No crew from ${shortDay(r.work_date)}`
  if (r.ends_on === r.work_date) return `Only ${shortDay(r.work_date)}`
  if (r.ends_on) return `${shortDay(r.work_date)} – ${shortDay(r.ends_on)}, ${weekdaysLabel(r.weekdays)}`
  return `From ${shortDay(r.work_date)}, ${weekdaysLabel(r.weekdays)}, until changed`
}
/** The approved request that sets the crew on a day: the latest-starting one whose range covers it (as labour_day_expected). */
export function crewInEffect(list: CrewRequest[], date: string) {
  return list.filter(r => r.status === 'approved' && r.work_date <= date && (!r.ends_on || r.ends_on >= date))
    .sort((a, b) => b.work_date.localeCompare(a.work_date))[0] ?? null
}

export type BoardRow = {
  pm_staff_id: string; pm_name: string; work_date: string; day_id: string | null; status: DayStatus
  workers: number; paid_days: number; allocated_days: number; mismatched: number
  request_id: string | null; request_code: string | null; request_status: RequestStatus | null; requested: number; changes: number
  jobs: number
}

export type DaySettings = {
  starts_on: string | null; workshop_project_id: string | null; stock_project_id: string | null; idle_project_id: string | null
  costing_open_days: number; updated_at: string
  /** The weekday (1 Mon … 7 Sun) each week's days are due by (494). */
  week_due_dow?: number
}

export function useDaySettings() {
  return useQuery({
    queryKey: ['labour-day-settings'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('labour_day_settings').select('*').maybeSingle()
      if (error) throw error
      return (data ?? { starts_on: null, workshop_project_id: null, stock_project_id: null, idle_project_id: null, costing_open_days: 14, updated_at: '' }) as DaySettings
    },
  })
}

export const DAY_APPROVER_ROLES = ['admin', 'operations_manager', 'hr_officer']

/** Who's asking: their own staff record, and whether they run other PMs' days too. */
export function useDayPeople() {
  const { hasRole } = useAuth()
  const { data: me, isLoading } = useMyStaffId()
  // hasRole counts the operations-manager badge (447) as the role.
  const approver = hasRole(...DAY_APPROVER_ROLES)
  const seeAll = approver || hasRole('finance', 'executive')
  // PMs to pick from: whoever manages a live, non-internal project.
  const pms = useQuery({
    queryKey: ['labour-day-pms'],
    enabled: seeAll,
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('project_manager_id, staff:project_manager_id(id, employee_name)')
        .not('project_manager_id', 'is', null).eq('active_for_year', true)
      if (error) throw error
      const m = new Map<string, string>()
      for (const r of (data ?? []) as unknown as { staff: { id: string; employee_name: string } | null }[]) if (r.staff) m.set(r.staff.id, r.staff.employee_name)
      return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
    },
  })
  return { me: me ?? null, approver, seeAll, pms: pms.data ?? [], isLoading: isLoading || (seeAll && pms.isLoading) }
}

export function useTrades() {
  return useQuery({
    queryKey: ['tier2-trades'],
    staleTime: 600_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('tier2_trade_roster').select('trade_tag, codename_english, codename_amharic, icon_emoji').order('sort_order')
      if (error) throw error
      return (data ?? []) as { trade_tag: string; codename_english: string; codename_amharic: string | null; icon_emoji: string | null }[]
    },
  })
}

/** "Carpenter" from "carpenter", "Electrician helper" from "electrician_helper". */
export const tradeName = (t: string | null | undefined) =>
  t ? t.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()) : 'No trade'

export const halfDays = (n: number) => (n === 0.5 ? '½' : Number.isInteger(n) ? String(n) : `${Math.floor(n)}½`)

/** The four flags (labour_flags). */
export type LabourFlags = {
  costing_open_days: number
  day_mismatches: { pm_staff_id: string; pm: string; date: string; status: DayStatus; why: string }[]
  over_budget: { project_id: string; project: string; cost: number; budget: number; over: number }[]
  costing_open: { project_id: string; project: string; delivered_at: string; days: number }[]
  awaiting_inspection: { check_id: string; code: string; project_id: string; project: string; received_at: string; items: number }[]
}
export function useLabourFlags(enabled = true) {
  return useQuery({
    queryKey: ['labour-flags'],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('labour_flags')
      if (error) throw error
      return data as LabourFlags | null
    },
  })
}

// ── A project's closing (491) ─────────────────────────────────────────
export type FixtureRow = {
  fixture_id: string; name: string; quantity: number; unit: string; sent: number; back: number; missing: number
  still_out: number; damaged: number; awaiting_inspection: number; last_check_at: string | null
}
export type CheckLine = {
  fixture_id: string; name: string; unit: string; quantity: number; ok_qty: number; damaged_qty: number; missing_qty: number
  checklist: { item: string; ok: boolean }[]; photos: { url: string; name?: string | null }[]; note: string | null
  repair: { id: string; status: string } | null
}
export type FixtureCheck = {
  id: string; code: string; kind: 'dispatch' | 'return'; status: 'done' | 'received' | 'inspected'; note: string | null
  checked_by_name: string | null; checked_at: string; inspected_by_name: string | null; inspected_at: string | null
  photos: { url: string; name?: string | null }[]; lines: CheckLine[] | null
}
export type DamageCharge = {
  id: string; code: string; project_id: string; check_id: string | null; fixture_id: string | null; fixture: string | null
  description: string; amount: number; photos: { url: string; name?: string | null }[]
  status: 'raised' | 'approved' | 'invoiced' | 'waived'; raised_by_name: string | null; raised_at: string
  decided_by_name: string | null; decided_at: string | null; decision_note: string | null
}
export type ProjectClosing = {
  stage: 'active' | 'delivered' | 'closed'
  delivered_at: string | null; delivered_by_name: string | null
  costing_closed_at: string | null; costing_closed_by_name: string | null
  costing_open_days: number; open_for_days: number | null
  damage_chargeable: boolean; damage_terms: string | null
  can_deliver: boolean; can_close: boolean; can_inspect: boolean; can_set_terms: boolean
  blockers: { kind: string; label: string; n: number }[]
  fixtures: FixtureRow[]; checks: FixtureCheck[]; charges: DamageCharge[]
  events: { id: string; kind: string; note: string | null; by_name: string | null; at: string }[]
}
export const CHARGE_STATUS: Record<DamageCharge['status'], { label: string; tone: Tone }> = {
  raised: { label: 'Waiting for finance', tone: 'amber' },
  approved: { label: 'Approved — to invoice', tone: 'blue' },
  invoiced: { label: 'Invoiced', tone: 'green' },
  waived: { label: 'Waived', tone: 'slate' },
}
export const STAGE_LABEL: Record<ProjectClosing['stage'], { label: string; tone: Tone }> = {
  active: { label: 'In progress', tone: 'blue' },
  delivered: { label: 'Delivered · costing open', tone: 'amber' },
  closed: { label: 'Costing closed', tone: 'green' },
}

export const DEFAULT_CHECKLIST = ['Complete — nothing missing', 'No scratches or dents', 'Finish and paint intact', 'Fittings and hardware work', 'Clean']
