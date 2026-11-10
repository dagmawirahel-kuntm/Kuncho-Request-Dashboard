// Payroll runs (migration 511): kinds, the month a run pays for, and the
// calls that build, check and save a run.
//
// Amounts typed on a run are the agreed take-home ("base net"). The database
// works the gross, PAYE and pension back from it on the person's whole month:
// salary first, then overtime, bonus and allowances on top at the marginal
// rate. Pension (7% + 11%) is on salary only. A line's tax is an estimate
// until its run is paid, then it is fixed.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { ecMonthName, toEthiopian, toGregorian } from '@/lib/ethiopianCalendar'

export const RUN_KINDS = ['Regular', 'Overtime', 'Bonus', 'Allowance', 'Back pay'] as const
export type RunKind = typeof RUN_KINDS[number]

export const KIND_NOTE: Record<RunKind, string> = {
  Regular: 'The month’s salary. Carries pension. One per person per month.',
  Overtime: 'Paid on its own date. Taxed on top of the month’s salary; no pension.',
  Bonus: 'Taxed on top of the month’s salary at the marginal rate; no pension.',
  Allowance: 'A taxable allowance. Taxed on top of salary; no pension.',
  'Back pay': 'Salary owed from an earlier month. Carries pension.',
}

export const carriesPension = (kind: string | null | undefined) => (kind ?? 'Regular') === 'Regular' || kind === 'Back pay'

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** The Gregorian dates of an Ethiopian month (day 1 to day 30). */
export function ecMonthDates(y: number, m: number) {
  return { start: iso(toGregorian(y, m, 1)), end: iso(toGregorian(y, m, 30)) }
}

/** The Ethiopian month most of a run's dates fall in (the database's rule). */
export function monthOfDates(start: string | null | undefined, end: string | null | undefined) {
  if (!start) return null
  const s = new Date(start + 'T00:00:00')
  const e = end ? new Date(end + 'T00:00:00') : s
  const mid = new Date(s.getTime() + Math.max(0, Math.floor((e.getTime() - s.getTime()) / 86400000 / 2)) * 86400000)
  const { year, month: m0 } = toEthiopian(mid)
  const month = m0 === 13 ? 12 : m0   // Pagume goes with Nehase for a pay period
  return { y: year, m: month, label: `${ecMonthName(month)} ${year}` }
}

/** This Ethiopian month and the eleven before it, newest first. */
export function recentEcMonths(count = 14) {
  const now = toEthiopian(new Date())
  let y = now.year
  let m = now.month === 13 ? 12 : now.month
  const out: { y: number; m: number; label: string }[] = []
  // one month ahead, so a run can be prepared before the month ends
  m += 1
  if (m > 12) { m = 1; y += 1 }
  for (let i = 0; i < count; i++) {
    out.push({ y, m, label: `${ecMonthName(m)} ${y}` })
    m -= 1
    if (m < 1) { m = 12; y -= 1 }
  }
  return out
}

export interface DraftRow {
  staff_id: string
  employee_name: string
  role: string | null
  monthly_salary: number | null
  days_paid: number
  days_in_period: number
  base_net: number | null
  open_advance: number
  bank_account_id: string | null
  already_on: string | null
  flags: string[]
}

/** Everyone on the monthly payroll for the dates, with what their record says. */
export function useRunDraft(kind: string, start: string | null | undefined, end: string | null | undefined, runId?: string) {
  return useQuery({
    queryKey: ['payroll-draft', kind, start, end, runId ?? null],
    enabled: !!start && !!end && end >= start,
    staleTime: 30000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('payroll_run_draft', {
        p_type: kind, p_start: start, p_end: end, p_run: runId ?? null,
      })
      if (error) throw error
      return (data ?? []) as DraftRow[]
    },
  })
}

export interface RunInput {
  id?: string
  payroll_type: string
  start_date: string | null
  end_date: string | null
  paid_on?: string | null
  pay_period?: string | null
  payment_method?: string | null
  account_id?: string | null
  transfer_id?: string | null
  vrf_id?: string | null
  notes?: string | null
}

export interface LineInput {
  staff_id: string
  base_net: number
  advance_recovery?: number
  days_paid?: number | null
  days_in_period?: number | null
  staff_bank_account_id?: string | null
  note?: string | null
}

export interface PreviewLine {
  staff_id: string
  base_net: number
  advance_recovery: number
  net_amount: number
  gross: number | null
  paye: number | null
  pension_employee: number | null
  pension_employer: number | null
}
export interface Preview {
  tax_month: string | null
  tax_month_moved: boolean
  lines: PreviewLine[]
}

export async function previewRun(run: RunInput, lines: LineInput[]) {
  const { data, error } = await supabase.rpc('payroll_run_preview', { p_run: run, p_lines: lines })
  if (error) throw error
  return data as Preview
}

export async function saveRun(run: RunInput, lines: LineInput[]) {
  const { data, error } = await supabase.rpc('payroll_run_save', { p_run: run, p_lines: lines })
  if (error) throw error
  return data as string
}

export const canBuildPayroll = (role: string | null | undefined) => role === 'admin' || role === 'finance' || role === 'hr_officer'
export const canPayPayroll = (role: string | null | undefined) => role === 'admin' || role === 'finance'
