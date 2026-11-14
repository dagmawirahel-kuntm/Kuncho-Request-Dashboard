// What labour gives back to the people who record it (migration 515): the
// pay-day promise, one tap to send a site's pay, the site's pulse, each
// worker's slip and history.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// ── The pay week ────────────────────────────────────────────────────────────
/** Recorded by the cut-off, paid on pay day. Off until admin or operations sets it. */
export type PayWeek = {
  enabled: boolean; cutoff_dow: number; cutoff_hour: number; pay_dow: number; updated_by_name: string | null
  /** At the cut-off the system turns locked days into one draft payment request per site manager (516). */
  auto_prepare?: boolean; last_closed_to?: string | null
}

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function usePayWeek() {
  return useQuery({
    queryKey: ['labour-pay-week'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('labour_pay_week_settings').select('*').maybeSingle()
      if (error) throw error
      return (data ?? null) as PayWeek | null
    },
  })
}

// Addis Ababa is UTC+3 all year. A date shifted by it reads, in its UTC
// fields, as the clock on the wall there.
const ADDIS_MS = 3 * 3_600_000
const wall = (d: Date) => new Date(d.getTime() + ADDIS_MS)

/** The first cut-off at or after a moment. */
export function nextCutoff(s: PayWeek, from: Date = new Date()): Date {
  const a = wall(from)
  const c = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate(), s.cutoff_hour))
  let add = (s.cutoff_dow - a.getUTCDay() + 7) % 7
  if (add === 0 && a.getTime() > c.getTime()) add = 7
  c.setUTCDate(c.getUTCDate() + add)
  return new Date(c.getTime() - ADDIS_MS)
}

/** The pay day that follows a cut-off, as yyyy-mm-dd. */
export function payDayAfter(s: PayWeek, cutoff: Date): string {
  const a = wall(cutoff)
  const add = (s.pay_dow - a.getUTCDay() + 7) % 7 || 7
  return new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate() + add)).toISOString().slice(0, 10)
}

const clock = (h: number) => `${h % 12 || 12}${h < 12 ? ' am' : ' pm'}`
const dayShort = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

/**
 * Where a day's work stands against the promise: in time for which pay day,
 * and how long is left; or late, and which pay day it now falls to.
 */
export function payWeekFor(s: PayWeek | null | undefined, workDate: string, now: Date = new Date()) {
  if (!s?.enabled) return null
  const own = nextCutoff(s, new Date(`${workDate}T00:00:00+03:00`))
  const onTime = now.getTime() <= own.getTime()
  const cutoff = onTime ? own : nextCutoff(s, now)
  const hoursLeft = Math.max(0, Math.floor((cutoff.getTime() - now.getTime()) / 3_600_000))
  return {
    onTime,
    payDay: payDayAfter(s, cutoff),
    payDayLabel: dayShort(payDayAfter(s, cutoff)),
    cutoffLabel: `${DAYS[s.cutoff_dow]} ${clock(s.cutoff_hour)}`,
    left: hoursLeft >= 48 ? `${Math.floor(hoursLeft / 24)} days left` : hoursLeft >= 1 ? `${hoursLeft} hour${hoursLeft === 1 ? '' : 's'} left` : 'under an hour left',
  }
}

/** The promise in one line, for settings and help. */
export const payWeekLine = (s: PayWeek) => `Recorded by ${DAYS[s.cutoff_dow]} ${clock(s.cutoff_hour)}, paid on ${DAYS[s.pay_dow]}`

// ── One tap: a site's pay ───────────────────────────────────────────────────
export type WeekPaySite = {
  project_id: string; project_name: string
  /** Requests with work recorded and not confirmed, and what it comes to. */
  to_confirm: number; to_confirm_amount: number
  /** Pay sheets confirmed and in no payment request. */
  confirmed: number; confirmed_amount: number
  workers: number; first_day: string | null; last_day: string | null; unverified: number
  /** Jobs with pay waiting and nobody named on them (a crew, or a fixed-price task). */
  crews: number
}

export function useWeekPaySites(enabled = true) {
  return useQuery({
    queryKey: ['labour-week-pay-sites'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('labour_week_pay_sites')
      if (error) throw error
      return (data ?? []) as WeekPaySite[]
    },
  })
}

export type SentWeekPay = { request_id: string; code: string; confirmed: number; sheets: number; total: number; skipped: string[] }

export async function sendWeekPay(projectId: string): Promise<SentWeekPay> {
  const { data, error } = await supabase.rpc('labour_send_week_pay', { p_project: projectId })
  if (error) throw error
  return data as SentWeekPay
}

// ── The site's pulse ────────────────────────────────────────────────────────
export type SitePulse = {
  week_start: string; week_cost: number; week_workers: number; week_days: number; last_week_cost: number
  total_cost: number; budget: number | null
  /** Jobs paid by the piece (quantity against what was asked for) or at a fixed price (% of the task against 100). */
  output: { role: string; basis: 'per_volume' | 'fixed_price'; unit: string | null; planned: number | null; week: number; last_week: number; total: number }[]
}

export function useSitePulse(projectId: string | null) {
  return useQuery({
    queryKey: ['labour-site-pulse', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('labour_site_pulse', { p_project: projectId })
      if (error) throw error
      return (data ?? null) as SitePulse | null
    },
  })
}

// ── Each worker's week ──────────────────────────────────────────────────────
export type WorkerSlip = {
  /** Null when the work is recorded for a job with nobody named on it. */
  staff_id: string | null; name: string; phone: string | null
  /** The bot tells them itself each evening. */
  linked: boolean
  /** How many people share it, when it was recorded for a crew. */
  crew: number
  /** The week in a few words: "4 days", "46 m²", "Electrician 40%". */
  summary: string | null
  amount: number; message: string
  lines: { date: string; site: string | null; what: string | null; basis: string; days: number; overtime_hours: number | null; quantity: number | null; unit: string | null; percent_done: number | null; amount: number }[]
}

/** One site, or several at once (a PM's day sheet covers all of theirs). */
export function useSiteSlips(projectIds: string[], weekOf: string, enabled = true) {
  return useQuery({
    queryKey: ['labour-site-slips', projectIds.join(','), weekOf],
    enabled: enabled && projectIds.length > 0,
    queryFn: async () => {
      const one = projectIds.length === 1
      const { data, error } = await supabase.rpc('labour_site_slips', { p_project: one ? projectIds[0] : null, p_week_of: weekOf, p_projects: one ? null : projectIds })
      if (error) throw error
      return (data ?? []) as WorkerSlip[]
    },
  })
}

// ── A worker's record ───────────────────────────────────────────────────────
export type WorkerHistory = {
  name: string; phone: string | null; trade: string | null; verified: boolean; linked: boolean
  first_day: string | null; last_day: string | null
  /** Days paid by the day; days_recorded counts every date with work of any kind. */
  days: number; days_recorded: number
  /** Work paid by the piece, by unit; and how many fixed-price tasks. */
  piece: { unit: string; qty: number }[]; tasks: number
  earned: number | null; day_rate: number | null; on_site_now: string | null
  sites: { project: string; days: number; last_day: string; work: string | null }[]
}

export function useWorkerHistory(staffId: string | null) {
  return useQuery({
    queryKey: ['labour-worker-history', staffId],
    enabled: !!staffId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('labour_worker_history', { p_staff: staffId })
      if (error) throw error
      return (data ?? null) as WorkerHistory | null
    },
  })
}

// ── Where the pay is (516) ──────────────────────────────────────────────────
/** A stage of labour pay on its way from recorded to paid, for one site manager. */
export type PipelineRow = {
  stage: number
  key: 'open' | 'review' | 'locked' | 'to_send' | 'with_finance' | 'approved' | 'sent' | 'paid' | 'held'
  pm_staff_id: string | null; pm_name: string; amount: number; items: number; oldest: string | null
}

export function usePayPipeline(enabled = true) {
  return useQuery({
    queryKey: ['labour-pay-pipeline'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('labour_pay_pipeline')
      if (error) throw error
      return (data ?? []) as PipelineRow[]
    },
  })
}

export type WeekClosed = {
  ran: boolean; to?: string
  requests?: { pm: string; request_id?: string; code?: string; added?: number; total?: number; workers?: number; skipped: string[] }[]
}

/** Admin or operations: prepare everything payable up to today now, without waiting for the cut-off. */
export async function prepareWeekPay(): Promise<WeekClosed> {
  const { data, error } = await supabase.rpc('labour_week_close', { p_force: true })
  if (error) throw error
  return data as WeekClosed
}

export async function setAutoPrepare(on: boolean) {
  const { error } = await supabase.rpc('set_labour_auto_prepare', { p_on: on })
  if (error) throw error
}
