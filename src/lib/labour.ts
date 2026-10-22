import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useMyManagedProjects, useMySiteForemanProjects } from '@/hooks/useMyStaff'
import type { Tone } from '@/components/record/Record'

// Labour: ask → record → pay (migration 375). Words here are the words on
// the screens; the table and column names underneath stay as they were.

export type PayBasis = 'per_day' | 'per_volume' | 'fixed_price'
export type PayModel = 'individual' | 'gang_leader'
export type PayCycle = 'weekly' | 'engagement_end'

export const BASIS_LABEL: Record<PayBasis, string> = {
  per_day: 'By the day',
  per_volume: 'By quantity',
  fixed_price: 'Fixed price',
}
export const BASIS_HINT: Record<PayBasis, string> = {
  per_day: 'Paid for hours worked — 8 hours is a day.',
  per_volume: 'Paid for work done: m², pieces, metres…',
  fixed_price: 'One price for a whole task, paid in parts as it gets done.',
}

export interface LabourRequest {
  id: string
  project_id: string
  role_needed: string
  headcount: number
  start_date: string | null
  end_date: string | null
  status: 'pending' | 'approved' | 'rejected'
  payment_basis: PayBasis
  payment_model: PayModel
  pay_cycle: PayCycle
  estimated_day_rate: number | null
  estimated_days: number | null
  estimated_total_cost: number | null
  unit_rate: number | null
  volume_unit: string | null
  estimated_total_volume: number | null
  fixed_price_amount: number | null
  gang_leader_vendor_id: string | null
  scope_of_work: string | null
  site_location: string | null
  notes: string | null
  decision_note: string | null
  requested_by: string | null
  approved_by: string | null
  approved_at: string | null
  created_at: string
  closed_at: string | null
  close_reason: string | null
  slots_filled: number | null
  work_order_id: string | null
  overtime_rule: OvertimeRule
  overtime_multiplier: number | null
  overtime_hour_rate: number | null
  projects?: { project_name: string } | null
  vendors?: { vendor_name: string } | null
  work_orders?: { id: string; title: string | null; scope_of_work: string | null; status: string } | null
}

export type RequestStage = 'waiting' | 'active' | 'ended' | 'declined'

export function stageOf(r: Pick<LabourRequest, 'status' | 'closed_at' | 'end_date'>): RequestStage {
  if (r.status === 'rejected') return 'declined'
  if (r.status === 'pending') return 'waiting'
  if (r.closed_at || (r.end_date && r.end_date < new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10))) return 'ended'
  return 'active'
}
export const STAGE: Record<RequestStage, { label: string; tone: Tone }> = {
  waiting: { label: 'Waiting for approval', tone: 'amber' },
  active: { label: 'Active', tone: 'green' },
  ended: { label: 'Ended', tone: 'slate' },
  declined: { label: 'Declined', tone: 'red' },
}

export const APPROVER_ROLES = ['admin', 'operations_manager', 'hr_officer']
export const ALL_SITES_ROLES = ['admin', 'executive', 'operations_manager', 'hr_officer']

export function rateSummary(r: Pick<LabourRequest, 'payment_basis' | 'estimated_day_rate' | 'unit_rate' | 'volume_unit' | 'fixed_price_amount'>): string {
  const money = (n: number | null | undefined) => n == null ? '—' : `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })} ETB`
  if (r.payment_basis === 'per_volume') return `${money(r.unit_rate)} per ${r.volume_unit ?? 'unit'}`
  if (r.payment_basis === 'fixed_price') return `${money(r.fixed_price_amount)} for the task`
  return r.estimated_day_rate ? `${money(r.estimated_day_rate)} a day` : "Each worker's own day rate"
}

// ── Overtime (migration 458) ─────────────────────────────────────────
// An overtime hour is priced by the first that applies: an amount agreed
// for that worker that day; the request's own deal (a multiplier, or birr
// per hour); the company's rates by when it was worked.

export type OvertimeRule = 'company' | 'multiplier' | 'per_hour'
export type OvertimeSettings = {
  evening_multiplier: number; night_multiplier: number; rest_day_multiplier: number; holiday_multiplier: number
  rest_day: number; updated_at: string; updated_by_name: string | null
}
/** The rates in force on one request on one day (labour_overtime_day_rates). */
export type OvertimeDayRates = {
  labor_requisition_id: string; day_kind: 'working_day' | 'rest_day' | 'holiday'; holiday_name: string | null
  rule: OvertimeRule; multiplier: number | null; night_multiplier: number | null; hour_rate: number | null
}
/** One overtime entry, priced (labour_overtime_lines, and a pay sheet line's overtime_detail). */
export type OvertimeDetail = { date: string; hours: number; night_hours: number; rule: OvertimeRule | 'agreed'; basis: string; amount: number }

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const OT_COMPANY_ROLES = ['admin', 'finance', 'operations_manager', 'hr_officer']
export const OT_DEFAULTS = { evening_multiplier: 1.5, night_multiplier: 1.75, rest_day_multiplier: 2, holiday_multiplier: 2.5, rest_day: 0 }

const x = (n: number | null | undefined) => `${Number(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}×`

export function useOvertimeSettings() {
  return useQuery({
    queryKey: ['labour-overtime-settings'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('labour_overtime_settings').select('*').maybeSingle()
      if (error) throw error
      return (data ?? { ...OT_DEFAULTS, updated_at: '', updated_by_name: null }) as OvertimeSettings
    },
  })
}

/** "Company rates (1.5× · night 1.75× · …)", "2× the hourly rate", "150 ETB an hour". */
export function overtimeSummary(r: Pick<LabourRequest, 'overtime_rule' | 'overtime_multiplier' | 'overtime_hour_rate'>, s?: OvertimeSettings | null): string {
  if (r.overtime_rule === 'multiplier') return `${x(r.overtime_multiplier)} the hourly rate, any day`
  if (r.overtime_rule === 'per_hour') return `${Number(r.overtime_hour_rate ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} ETB an hour`
  if (!s) return 'Company rates'
  return `Company rates: ${x(s.evening_multiplier)} · night ${x(s.night_multiplier)} · ${WEEKDAYS[s.rest_day] ?? 'rest day'} ${x(s.rest_day_multiplier)} · holiday ${x(s.holiday_multiplier)}`
}

/** What a day's overtime comes to, for the Record screen's running total. */
export function overtimeAmount(rates: OvertimeDayRates | undefined, dayRate: number, hours: number, night: number, agreed: number | null): number {
  if (!hours) return 0
  if (agreed != null) return agreed
  if (!rates) return hours * dayRate / 8 * 1.5
  if (rates.rule === 'per_hour') return hours * Number(rates.hour_rate ?? 0)
  const n = Math.min(Math.max(night, 0), hours)
  return (hours - n) * dayRate / 8 * Number(rates.multiplier ?? 1.5) + n * dayRate / 8 * Number(rates.night_multiplier ?? rates.multiplier ?? 1.5)
}

/** "paid at 2× (rest day)", "night at 1.75×", "150 ETB an hour (request deal)". */
export function overtimeRateLabel(rates: OvertimeDayRates | undefined): string {
  if (!rates) return 'paid at 1.5×'
  if (rates.rule === 'per_hour') return `${Number(rates.hour_rate ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} ETB an hour (request deal)`
  if (rates.rule === 'multiplier') return `paid at ${x(rates.multiplier)} (request deal)`
  const day = rates.day_kind === 'holiday' ? (rates.holiday_name ?? 'holiday') : rates.day_kind === 'rest_day' ? 'rest day' : null
  return `paid at ${x(rates.multiplier)}${day ? ` (${day})` : ''} · after 10 pm ${x(rates.night_multiplier)}`
}

/** Rough cost of a request, for the approver. */
export function estimateOf(r: Pick<LabourRequest, 'payment_basis' | 'estimated_day_rate' | 'estimated_days' | 'headcount' | 'unit_rate' | 'estimated_total_volume' | 'fixed_price_amount' | 'estimated_total_cost'>): number | null {
  if (r.estimated_total_cost) return Number(r.estimated_total_cost)
  if (r.payment_basis === 'fixed_price') return r.fixed_price_amount
  if (r.payment_basis === 'per_volume') return r.unit_rate && r.estimated_total_volume ? r.unit_rate * r.estimated_total_volume : null
  return r.estimated_day_rate && r.estimated_days ? r.estimated_day_rate * r.estimated_days * (r.headcount || 1) : null
}

/** The sites this person can ask for, record and confirm labour on. */
export function useLabourSites() {
  const { hasRole } = useAuth()
  const { projects: managed, isLoading: l1 } = useMyManagedProjects()
  const { projects: foreman, isLoading: l2 } = useMySiteForemanProjects()
  const everywhere = hasRole(...ALL_SITES_ROLES)
  const all = useQuery({
    queryKey: ['labour-all-sites'],
    enabled: everywhere,
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('id, project_name').eq('active_for_year', true).order('project_name')
      if (error) throw error
      return (data ?? []) as { id: string; project_name: string }[]
    },
  })
  const mine = new Map<string, { id: string; project_name: string }>()
  for (const p of [...(managed ?? []), ...(foreman ?? [])]) mine.set(p.id, p)
  const sites = everywhere ? (all.data ?? [...mine.values()]) : [...mine.values()].sort((a, b) => a.project_name.localeCompare(b.project_name))
  return {
    sites,
    managedIds: new Set((managed ?? []).map(p => p.id)),
    everywhere,
    isLoading: l1 || l2 || (everywhere && all.isLoading),
  }
}

export const fmtMoney = (n: number | null | undefined) =>
  n == null ? '—' : `${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETB`

export const isoDay = (d: Date) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
  return z.toISOString().slice(0, 10)
}
export const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + n)
  return isoDay(d)
}
export const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

/** Where finance is with a confirmed pay sheet's payable. */
export const financeStatus = (e: { approval_status: string; payment_state: string } | null | undefined) =>
  !e ? 'With finance' : e.payment_state === 'paid' ? 'Paid' : e.approval_status === 'finance_approved' ? 'Approved, not paid yet'
    : e.approval_status === 'rejected' ? 'Sent back by finance' : 'Waiting for finance'
export const financeTone = (s: string): Tone =>
  s === 'Paid' ? 'green' : s.startsWith('Sent back') ? 'red' : s.startsWith('Approved') ? 'blue' : 'amber'
