import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatEthiopian, toGregorian } from '@/lib/ethiopianCalendar'
import type { LeaveType } from '@/types/database'

// Leave rules as the Labour Proclamation 1156/2019 sets them. The day
// counting itself happens in the database (leave_day_count, migration
// 399); workingDays() below mirrors it so the form can show the number
// before saving.

export interface LeaveTypeInfo {
  value: LeaveType
  label: string
  rule: string
  counts: 'working' | 'calendar'
  certificate?: boolean
  // A usual length, used to fill the end date when it's known.
  usualDays?: number
  // The card shown on the form and printed on the paper form: what the
  // leave is for, how long, what it pays, what to bring, and whether it
  // comes out of the annual balance.
  when: string
  length: string
  pay: string
  bring: string
  usesBalance: string
  unpaid?: boolean
}

export const LEAVE_TYPES: LeaveTypeInfo[] = [
  { value: 'annual', label: 'Annual', counts: 'working',
    rule: '16 working days in the first year of service, plus 1 day for every further two years.',
    when: 'Rest or a holiday you plan ahead.', length: 'Up to what you have left this year.',
    pay: 'Full pay.', bring: 'Nothing — ask at least a week ahead.', usesBalance: 'Yes — it comes out of your annual leave.' },
  { value: 'sick', label: 'Sick', counts: 'working', certificate: true,
    rule: 'Needs a medical certificate. Up to 6 months in 12: first month full pay, next two at half pay, last three unpaid.',
    when: 'You are ill or injured and cannot work.', length: 'Up to 6 months in any 12.',
    pay: 'First month full pay, next 2 months half pay, last 3 months unpaid.', bring: 'A medical certificate from a recognised clinic.',
    usesBalance: 'No — annual leave is not touched.' },
  { value: 'maternity', label: 'Maternity', counts: 'calendar', usualDays: 120,
    rule: '30 days before and 90 days after the birth, paid — 120 days in a row.',
    when: 'Pregnancy and the birth of your child.', length: '30 days before the expected date and 90 days after — 120 days in a row, weekends included.',
    pay: 'Full pay.', bring: 'A doctor\'s note with the expected date.', usesBalance: 'No.' },
  { value: 'paternity', label: 'Paternity', counts: 'working', usualDays: 3,
    rule: '3 working days with pay.',
    when: 'Your child is born.', length: '3 working days.', pay: 'Full pay.', bring: 'The birth notice, when you are back.', usesBalance: 'No.' },
  { value: 'marriage', label: 'Marriage', counts: 'working', usualDays: 3,
    rule: '3 working days with pay.',
    when: 'Your wedding.', length: '3 working days.', pay: 'Full pay.', bring: 'The marriage certificate, when you are back.', usesBalance: 'No.' },
  { value: 'compassionate', label: 'Bereavement', counts: 'working', usualDays: 3,
    rule: '3 working days with pay on the death of a spouse or close relative.',
    when: 'A spouse, parent, child, brother or sister, or close relative has died.', length: '3 working days.',
    pay: 'Full pay.', bring: 'Nothing.', usesBalance: 'No.' },
  { value: 'unpaid', label: 'Unpaid', counts: 'working', unpaid: true,
    rule: 'Up to 5 days in a row for a serious personal matter, without pay.',
    when: 'A serious personal matter none of the other kinds covers.', length: 'Up to 5 days in a row.',
    pay: 'No pay — the days are taken off your salary.', bring: 'Say what it is for.', usesBalance: 'No, but it reduces your pay.' },
  { value: 'other', label: 'Other', counts: 'working',
    rule: 'Anything else — say what it is in the reason.',
    when: 'Court, exams, union duty or anything else.', length: 'As agreed with HR.', pay: 'As agreed with HR.',
    bring: 'A letter or summons that shows the reason.', usesBalance: 'HR decides.' },
]

export const LEAVE_TYPE: Record<string, LeaveTypeInfo> = Object.fromEntries(LEAVE_TYPES.map(t => [t.value, t]))

export function leaveLabel(type: string) {
  return LEAVE_TYPE[type]?.label ?? (type === 'leave' ? 'On leave' : type)
}

export const LEAVE_TONE: Record<string, string> = {
  annual: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  sick: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  maternity: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-300',
  paternity: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  marriage: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  compassionate: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  unpaid: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  other: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  leave: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
}

// Bar colour on the calendar.
export const LEAVE_BAR: Record<string, string> = {
  annual: 'bg-sky-400', sick: 'bg-rose-400', maternity: 'bg-fuchsia-400', paternity: 'bg-violet-400',
  marriage: 'bg-amber-400', compassionate: 'bg-slate-400', unpaid: 'bg-orange-400', other: 'bg-slate-300', leave: 'bg-slate-300',
}

export const ROUTING_LABEL: Record<string, string> = {
  line_manager: 'their line manager',
  department_head: 'the department head',
  hr_officer: 'HR',
  admin: 'an administrator',
  unresolved: 'nobody yet',
}

// ── Dates ────────────────────────────────────────────────────────────
export function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function parseIso(s: string) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(s: string, n: number) {
  const d = parseIso(s)
  d.setDate(d.getDate() + n)
  return iso(d)
}

/** Same rule as leave_working_days(): skip Sundays and public holidays. */
export function workingDays(start: string, end: string, holidays: Set<string>) {
  if (!start || !end || end < start) return null
  let n = 0
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (parseIso(d).getDay() !== 0 && !holidays.has(d)) n++
  }
  return n
}

export function calendarDays(start: string, end: string) {
  if (!start || !end || end < start) return null
  return Math.round((parseIso(end).getTime() - parseIso(start).getTime()) / 86400000) + 1
}

export function countDays(type: LeaveType, start: string, end: string, holidays: Set<string>) {
  return LEAVE_TYPE[type]?.counts === 'calendar' ? calendarDays(start, end) : workingDays(start, end, holidays)
}

/** The day `n` working days after `start` (inclusive), for "3 days" types. */
export function endAfterWorkingDays(start: string, n: number, holidays: Set<string>) {
  let d = start
  let left = n
  for (let guard = 0; guard < 400; guard++) {
    if (parseIso(d).getDay() !== 0 && !holidays.has(d)) left--
    if (left <= 0) return d
    d = addDays(d, 1)
  }
  return d
}

/** "12 Meskerem 2019" for an ISO date. */
export function ecLabel(s: string | null | undefined) {
  return s ? formatEthiopian(s) : ''
}

/**
 * Dates typed in the Ethiopian calendar into a Gregorian picker come out
 * about eight years early (2018-12-23 for 23 Nehase 2018). Anything that
 * old on a leave request is that mistake, not real leave.
 */
export function looksEthiopian(s: string) {
  return Number(s.slice(0, 4)) < new Date().getFullYear() - 5
}

/** Read a mistyped ISO date as Y-M-D in the Ethiopian calendar. */
export function ecTypedToGregorian(s: string) {
  const [y, m, d] = s.split('-').map(Number)
  return iso(toGregorian(y, m, d))
}

// ── Data ─────────────────────────────────────────────────────────────
export interface Holiday { id: string; holiday_date: string; name: string }

export function useHolidays() {
  return useQuery({
    queryKey: ['calendar-holidays'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('calendar_holidays')
        .select('id, holiday_date, name').is('applies_to_project_id', null).order('holiday_date')
      if (error) throw error
      return (data ?? []) as Holiday[]
    },
  })
}

export interface BreakdownPart { label: string; days: number }

export interface LeaveBalance {
  staff_id: string
  employee_name: string
  department_id: string | null
  staff_type: string | null
  role: string | null
  starting_date: string | null
  year_start: string
  year_end: string
  entitlement: number
  annual_taken: number
  annual_pending: number
  annual_left: number
  sick_taken_12m: number
  unpaid_taken: number
  other_taken: number
  on_leave_today: boolean
  in_probation: boolean
  probation_ends: string | null
  can_use: boolean
  breakdown: { parts: BreakdownPart[]; earned: number; carried: number; adjusted: number; service_years: number }
}

/** Balances the viewer may see: HR everyone, managers their people, staff themselves. */
export function useLeaveBalances() {
  return useQuery({
    queryKey: ['leave-balances'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('leave_balance_sheet')
      if (error) throw error
      return (data ?? []) as LeaveBalance[]
    },
  })
}

/** 12, 12.5 — leave counts in half days at most. */
export function fmtDays(n: number | null | undefined) {
  if (n == null) return '—'
  return String(Math.round(n * 2) / 2)
}

export function daysWord(n: number | null | undefined) {
  return `${fmtDays(n)} day${n === 1 ? '' : 's'}`
}

/** "16 base + 3 for 8 years' service = 19" */
export function breakdownLine(b: LeaveBalance['breakdown'] | null | undefined) {
  if (!b?.parts?.length) return ''
  return b.parts.map((p, i) => `${i === 0 ? '' : p.days < 0 ? ' − ' : ' + '}${fmtDays(Math.abs(p.days))} ${p.label.toLowerCase()}`).join('')
}

// ── Company leave policy (migration 404) ─────────────────────────────
export interface LeavePolicy {
  base_days: number
  extra_day_every_years: number
  max_annual_days: number | null
  new_joiner_rule: 'prorata' | 'full' | 'none_first_year'
  probation_months: number
  probation_rule: 'can_use' | 'accrue_only'
  leave_year_basis: 'fiscal' | 'anniversary'
  carry_over_max_days: number
  include_casual: boolean
  notes: string | null
  decided_at: string | null
  decided_by: string | null
  updated_at: string
}

export interface LeaveExtraDays {
  id: string
  label: string
  match_field: 'management_level' | 'staff_type' | 'employment_type' | 'department_id'
  match_value: string
  extra_days: number
  active: boolean
}

export function useLeavePolicy() {
  return useQuery({
    queryKey: ['leave-policy'],
    staleTime: 300_000,
    queryFn: async () => {
      const [pol, extra] = await Promise.all([
        supabase.from('leave_policy').select('*').maybeSingle(),
        supabase.from('leave_extra_days').select('id, label, match_field, match_value, extra_days, active').order('created_at'),
      ])
      if (pol.error) throw pol.error
      if (extra.error) throw extra.error
      return { policy: pol.data as LeavePolicy | null, extra: (extra.data ?? []) as LeaveExtraDays[] }
    },
  })
}

/**
 * One plain sentence about what this request means for the person:
 * "Sick leave, 4 working days: first month full pay. Bring a medical
 * certificate. Your annual leave is not affected."
 */
export function leavePreview(type: LeaveType, days: number | null, b: LeaveBalance | null, alreadyCounted = 0) {
  const t = LEAVE_TYPE[type]
  if (!t || days == null) return null
  const unit = t.counts === 'calendar' ? 'calendar' : 'working'
  const lines: { text: string; tone?: 'red' | 'amber' }[] = [{ text: `${t.label} leave, ${fmtDays(days)} ${unit} day${days === 1 ? '' : 's'}. ${t.pay}` }]
  if (type === 'annual' && b) {
    const left = b.annual_left + alreadyCounted - days
    if (!b.can_use && b.probation_ends) lines.push({ text: `Still on probation — annual leave can be taken from ${b.probation_ends}.`, tone: 'red' })
    lines.push(left < 0
      ? { text: `That is ${fmtDays(-left)} more than the ${fmtDays(b.annual_left + alreadyCounted)} left — the extra days would be unpaid unless approved specially.`, tone: 'red' }
      : { text: `${fmtDays(left)} day${left === 1 ? '' : 's'} of annual leave left after this.` })
  } else {
    lines.push({ text: t.usesBalance.startsWith('No') ? 'Annual leave is not affected.' : t.usesBalance })
  }
  if (t.certificate) lines.push({ text: `Bring: ${t.bring}`, tone: 'amber' })
  if (type === 'sick' && b && b.sick_taken_12m + days > 30) lines.push({ text: `With the ${fmtDays(b.sick_taken_12m)} sick days already taken in 12 months, part of this is past the first month — half pay.`, tone: 'amber' })
  if (type === 'unpaid' && days > 5) lines.push({ text: 'Unpaid leave is normally at most 5 days in a row.', tone: 'amber' })
  return lines
}

export const STATUS_MEANING: Record<string, string> = {
  pending: 'Waiting for a decision from the approver.',
  approved: 'Approved — the days are booked and, for annual leave, taken off the balance.',
  rejected: 'Not approved — see the note for why.',
  cancelled: 'Withdrawn — nothing was taken off.',
}

export interface TeamLeaveRow {
  request_id: string
  staff_id: string
  employee_name: string
  department_id: string | null
  start_date: string
  end_date: string
  days: number | null
  status: 'pending' | 'approved'
  leave_type: string
  cover_name: string | null
}

export function useTeamLeave(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ['leave-team-calendar', from, to],
    enabled: enabled && !!from && !!to && to >= from,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('leave_team_calendar', { p_from: from, p_to: to })
      if (error) throw error
      return (data ?? []) as TeamLeaveRow[]
    },
  })
}

export const LEAVE_QUERY_KEYS = [
  ['leave-requests'], ['leave-policy'], ['my-leave-requests'], ['leave-balances'], ['leave-team-calendar'], ['leave-awaiting-my-decision'],
]
