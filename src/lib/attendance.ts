import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toEthiopian, toGregorian, ecMonthLength, ETHIOPIAN_MONTHS } from '@/lib/ethiopianCalendar'

// Daily staff attendance (migration 400). One row per person per day;
// leave, Sundays and public holidays aren't stored — they come from
// leave_requests and calendar_holidays and are shown alongside.

export type AttendanceStatus = 'present' | 'late' | 'half_day' | 'field' | 'excused' | 'absent'

export interface StatusInfo {
  value: AttendanceStatus
  label: string
  code: string
  // How much of a working day it counts as.
  worked: number
  hint: string
  chip: string
  cell: string
}

export const STATUSES: StatusInfo[] = [
  { value: 'present', label: 'Present', code: 'P', worked: 1, hint: 'Came in on time',
    chip: 'bg-emerald-600 text-white', cell: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200' },
  { value: 'late', label: 'Late', code: 'L', worked: 1, hint: 'Came in after the start time',
    chip: 'bg-amber-500 text-white', cell: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' },
  { value: 'half_day', label: 'Half day', code: '½', worked: 0.5, hint: 'Worked half the day',
    chip: 'bg-sky-600 text-white', cell: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200' },
  { value: 'field', label: 'Out on work', code: 'F', worked: 1, hint: 'Working away — client, supplier, another site',
    chip: 'bg-violet-600 text-white', cell: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200' },
  { value: 'excused', label: 'Excused', code: 'E', worked: 0, hint: 'Away with permission, not on leave',
    chip: 'bg-slate-500 text-white', cell: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200' },
  { value: 'absent', label: 'Absent', code: 'A', worked: 0, hint: 'Did not come, no permission',
    chip: 'bg-red-600 text-white', cell: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200' },
]
export const STATUS: Record<string, StatusInfo> = Object.fromEntries(STATUSES.map(s => [s.value, s]))

// The after-lunch roll-call (migration 401). Half day doesn't apply —
// it is already a half.
export type PmStatus = 'present' | 'late' | 'field' | 'excused' | 'absent'
export const PM_STATUSES: (StatusInfo & { value: PmStatus })[] = [
  { ...STATUS.present, value: 'present', label: 'Back', hint: 'Back from lunch on time' },
  { ...STATUS.late, value: 'late', label: 'Back late', hint: 'Back after lunch ended' },
  { ...STATUS.field, value: 'field' },
  { ...STATUS.excused, value: 'excused', hint: 'Left with permission' },
  { ...STATUS.absent, value: 'absent', label: "Didn't come back", hint: 'Left without permission' },
]
export const PM_STATUS: Record<string, StatusInfo> = Object.fromEntries(PM_STATUSES.map(s => [s.value, s]))

/**
 * How much of a working day a record counts as. Until the after-lunch
 * roll-call is taken the morning mark decides the whole day; once it
 * is, each half counts half.
 */
export function dayCredit(r: Pick<AttendanceRow, 'status' | 'pm_status'>) {
  if (!r.pm_status) return STATUS[r.status]?.worked ?? 0
  const am = r.status === 'half_day' ? 0.5 : (STATUS[r.status]?.worked ?? 0) > 0 ? 0.5 : 0
  const pm = (PM_STATUS[r.pm_status]?.worked ?? 0) > 0 ? 0.5 : 0
  return r.status === 'half_day' ? Math.max(am, pm) : am + pm
}

export const PLACES = [
  { value: 'office', label: 'Office' },
  { value: 'workshop', label: 'Workshop' },
  { value: 'leather_workshop', label: 'Leather workshop' },
  { value: 'site', label: 'Site' },
  { value: 'field', label: 'Out' },
] as const
export const PLACE_LABEL: Record<string, string> = Object.fromEntries(PLACES.map(p => [p.value, p.label]))

/** staff.staff_type (where they normally work) → the usual place. */
export function usualPlace(staffType: string | null | undefined): string | null {
  switch (staffType) {
    case 'Office': return 'office'
    case 'Work Shop': return 'workshop'
    case 'Leather Workshop': return 'leather_workshop'
    case 'Site': return 'site'
    case 'Field': return 'field'
    default: return null
  }
}

export interface AttendanceRow {
  id: string
  staff_id: string
  work_date: string
  status: AttendanceStatus
  check_in_at: string | null
  check_out_at: string | null
  place: string | null
  project_id: string | null
  note: string | null
  source: 'self' | 'register'
  pm_status: PmStatus | null
  pm_at: string | null
  pm_recorded_by: string | null
  pm_recorded_at: string | null
  from_paper: boolean
  in_lat: number | null
  in_lng: number | null
  out_lat: number | null
  out_lng: number | null
  recorded_by: string | null
  recorded_at: string
  updated_by: string | null
  updated_at: string | null
}

export interface AttendancePerson {
  staff_id: string
  employee_name: string
  role: string | null
  staff_type: string | null
  department_id: string | null
  department_name: string | null
  reports_to_id: string | null
  can_record: boolean
  is_me: boolean
}

export interface AttendanceLogRow {
  id: number
  attendance_id: string | null
  staff_id: string | null
  work_date: string | null
  action: 'insert' | 'update' | 'delete' | 'lock' | 'unlock'
  old_row: Partial<AttendanceRow> & { label?: string; start_date?: string; end_date?: string } | null
  new_row: Partial<AttendanceRow> & { label?: string; start_date?: string; end_date?: string } | null
  reason: string | null
  changed_by: string | null
  changed_at: string
}

export interface AttendanceLock { id: string; start_date: string; end_date: string; label: string; locked_by: string | null; locked_at: string }
export interface AttendanceSettings { day_starts: string; late_after_minutes: number; day_ends: string; lunch_ends: string }

// ── Time ─────────────────────────────────────────────────────────────
// Everything is shown in Addis Ababa time (UTC+3, no daylight saving).
const ADDIS_MS = 3 * 3600 * 1000

export function addisToday() {
  return new Date(Date.now() + ADDIS_MS).toISOString().slice(0, 10)
}

/** '08:42' for a stored timestamp. */
export function addisTime(ts: string | null | undefined) {
  if (!ts) return ''
  return new Date(new Date(ts).getTime() + ADDIS_MS).toISOString().slice(11, 16)
}

/** '1 Oct, 08:42' in Addis time, whatever the browser's zone. */
export function addisDateTime(ts: string | null | undefined, withYear = false) {
  if (!ts) return ''
  return new Date(ts).toLocaleString('en-GB', { timeZone: 'Africa/Addis_Ababa', day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), hour: '2-digit', minute: '2-digit' })
}

/** A typed '08:42' on a given day → timestamp to store. */
export function addisTimestamp(date: string, hhmm: string) {
  return hhmm ? `${date}T${hhmm}:00+03:00` : null
}

export function hoursWorked(r: Pick<AttendanceRow, 'check_in_at' | 'check_out_at'>) {
  if (!r.check_in_at || !r.check_out_at) return null
  return Math.max(0, (new Date(r.check_out_at).getTime() - new Date(r.check_in_at).getTime()) / 3600000)
}

export function fmtHours(h: number | null) {
  if (h == null) return ''
  const m = Math.round(h * 60)
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

// ── Ethiopian months (payroll runs on them) ──────────────────────────
function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export interface EcMonth { year: number; month: number }

export function ecMonthOf(isoDate: string): EcMonth {
  const e = toEthiopian(isoDate)
  return { year: e.year, month: e.month }
}

export function ecMonthRange(m: EcMonth) {
  return { start: iso(toGregorian(m.year, m.month, 1)), end: iso(toGregorian(m.year, m.month, ecMonthLength(m.year, m.month))) }
}

export function ecMonthLabel(m: EcMonth) {
  return `${ETHIOPIAN_MONTHS[m.month - 1]} ${m.year}`
}

export function shiftEcMonth(m: EcMonth, by: number): EcMonth {
  let { year, month } = m
  month += by
  while (month > 13) { month -= 13; year++ }
  while (month < 1) { month += 13; year-- }
  return { year, month }
}

export function daysBetween(start: string, end: string) {
  const out: string[] = []
  const d = new Date(start + 'T00:00:00')
  const last = new Date(end + 'T00:00:00')
  while (d <= last) { out.push(iso(d)); d.setDate(d.getDate() + 1) }
  return out
}

export function isSunday(isoDate: string) {
  return new Date(isoDate + 'T00:00:00').getDay() === 0
}

/**
 * Working days in a row checked in on time (present, or out on work),
 * counting back from today. Sundays, public holidays, approved leave and
 * excused days are stepped over, not counted and not breaking it. Today
 * still blank doesn't break it either — the day isn't over. Anything else
 * (late, half day, absent, a working day with nothing recorded) ends it.
 */
export function onTimeStreak(
  rows: Pick<AttendanceRow, 'work_date' | 'status'>[],
  today: string,
  isOff: (date: string) => boolean,
  from: string,
) {
  const byDate = new Map(rows.map(r => [r.work_date, r.status]))
  let n = 0
  for (const d of daysBetween(from, today).reverse()) {
    const status = byDate.get(d)
    if (status === 'present' || status === 'field') { n++; continue }
    if (status === 'excused' || (!status && (isOff(d) || d === today))) continue
    break
  }
  return n
}

// ── Data ─────────────────────────────────────────────────────────────
export function useAttendancePeople() {
  return useQuery({
    queryKey: ['attendance-people'],
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('attendance_people')
      if (error) throw error
      return (data ?? []) as AttendancePerson[]
    },
  })
}

export function useAttendance(from: string, to: string, staffId?: string | null) {
  return useQuery({
    queryKey: ['staff-attendance', from, to, staffId ?? 'all'],
    enabled: !!from && !!to,
    queryFn: async () => {
      let q = supabase.from('staff_attendance').select('*').gte('work_date', from).lte('work_date', to)
      if (staffId) q = q.eq('staff_id', staffId)
      const { data, error } = await q.order('work_date')
      if (error) throw error
      return (data ?? []) as AttendanceRow[]
    },
  })
}

export function useAttendanceLocks() {
  return useQuery({
    queryKey: ['attendance-locks'],
    queryFn: async () => {
      const { data, error } = await supabase.from('attendance_locks').select('*').order('start_date', { ascending: false })
      if (error) throw error
      return (data ?? []) as AttendanceLock[]
    },
  })
}

export function useAttendanceSettings() {
  return useQuery({
    queryKey: ['attendance-settings'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('attendance_settings').select('day_starts, late_after_minutes, day_ends, lunch_ends').maybeSingle()
      if (error) throw error
      return (data ?? { day_starts: '08:30:00', late_after_minutes: 15, day_ends: '17:30:00', lunch_ends: '13:30:00' }) as AttendanceSettings
    },
  })
}

/** Names for the user ids stamped on records (recorded_by, changed_by…). */
export function useUserNames() {
  return useQuery({
    queryKey: ['user-names'],
    staleTime: 600_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('user_profiles').select('id, full_name')
      if (error) throw error
      return new Map(((data ?? []) as { id: string; full_name: string | null }[]).map(u => [u.id, u.full_name ?? 'Someone']))
    },
  })
}

export const ATTENDANCE_KEYS = [['staff-attendance'], ['attendance-log'], ['attendance-locks']]

export function lockFor(date: string, locks: AttendanceLock[]) {
  return locks.find(l => date >= l.start_date && date <= l.end_date) ?? null
}

// One line saying what a log entry changed, for the history lists.
export function describeChange(h: AttendanceLogRow): string {
  if (h.action === 'lock') return `Locked ${h.new_row?.label ?? ''}`
  if (h.action === 'unlock') return `Unlocked ${h.old_row?.label ?? ''}`
  if (h.action === 'delete') return `Deleted (was ${STATUS[h.old_row?.status ?? '']?.label ?? '—'})`
  if (h.action === 'insert') {
    const n = h.new_row
    return `Recorded ${STATUS[n?.status ?? '']?.label ?? ''}${n?.check_in_at ? ` · in ${addisTime(n.check_in_at)}` : ''}${n?.pm_status ? ` · after lunch ${PM_STATUS[n.pm_status]?.label ?? ''}` : ''}${n?.source === 'self' ? ' (self check-in)' : ''}${n?.from_paper ? ' (from paper)' : ''}`
  }
  const o = h.old_row ?? {}, n = h.new_row ?? {}
  const parts: string[] = []
  if (o.status !== n.status) parts.push(`${STATUS[o.status ?? '']?.label ?? '—'} → ${STATUS[n.status ?? '']?.label ?? '—'}`)
  if (o.check_in_at !== n.check_in_at) parts.push(`in ${addisTime(o.check_in_at) || '—'} → ${addisTime(n.check_in_at) || '—'}`)
  if (o.pm_status !== n.pm_status) parts.push(`after lunch ${PM_STATUS[o.pm_status ?? '']?.label ?? '—'} → ${PM_STATUS[n.pm_status ?? '']?.label ?? '—'}`)
  if (o.check_out_at !== n.check_out_at) parts.push(`out ${addisTime(o.check_out_at) || '—'} → ${addisTime(n.check_out_at) || '—'}`)
  if (o.note !== n.note) parts.push('note changed')
  if (o.place !== n.place) parts.push('place changed')
  return parts.join(' · ') || 'Saved with no visible change'
}
