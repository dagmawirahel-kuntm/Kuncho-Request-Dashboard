import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Daily site report follow-up (migration 421): which working days on each
// live site have no submitted report, and who should be nudged about them.

export type SiteStatus = 'working' | 'partial' | 'no_work'
export type NoWorkReason = 'rain' | 'holiday' | 'waiting_materials' | 'waiting_client' | 'no_labour' | 'payment' | 'access' | 'other'
export type PpeCompliance = 'all' | 'most' | 'few'

export const SITE_STATUS_LABEL: Record<SiteStatus, string> = {
  working: 'Full day of work', partial: 'Part of the day', no_work: 'No work today',
}

export const NO_WORK_REASON_LABEL: Record<NoWorkReason, string> = {
  rain: 'Rain', holiday: 'Holiday', waiting_materials: 'Waiting for materials', waiting_client: 'Waiting for the client',
  no_labour: 'No labour', payment: 'Payment issue', access: 'No access to site', other: 'Other',
}

export const BLOCKER_CAUSES = [
  { value: 'materials', label: 'Materials' },
  { value: 'labour', label: 'Labour' },
  { value: 'client_decision', label: 'Client decision' },
  { value: 'drawings', label: 'Drawings / design' },
  { value: 'payment', label: 'Payment' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'weather', label: 'Weather' },
  { value: 'access', label: 'Site access' },
  { value: 'other_trade', label: 'Another trade' },
] as const
export const BLOCKER_LABEL: Record<string, string> = Object.fromEntries(BLOCKER_CAUSES.map(c => [c.value, c.label]))

export const PPE_LABEL: Record<PpeCompliance, string> = { all: 'Everyone', most: 'Most', few: 'Few or none' }

export interface WorkItem {
  work_order_id: string
  label: string
  progress_before: number | null
  progress_after: number | null
  note: string
}

export interface PmSite {
  project_id: string
  project_name: string
  dates: string[]
  drafts: number
  with_activity: number
  oldest: string
  foremen: string[] | null
  last_reminded_at: string | null
}

export interface ForemanSite {
  project_id: string
  project_name: string
  days: { date: string; draft_id: string | null }[]
  oldest: string
  pm_name: string | null
  reminder: { from: string; message: string | null; at: string } | null
}

export interface NudgeSummary {
  as_pm: PmSite[]
  as_foreman: ForemanSite[]
  due_today: { project_id: string; project_name: string }[]
}

export function useSiteReportSummary(enabled = true) {
  return useQuery({
    queryKey: ['site-report-summary'],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('site_report_nudge_summary')
      if (error) throw error
      return (data ?? { as_pm: [], as_foreman: [], due_today: [] }) as NudgeSummary
    },
  })
}

export interface Gap {
  project_id: string
  project_name: string
  report_date: string
  state: 'missing' | 'draft'
  draft_id: string | null
  had_activity: boolean
  foreman_staff_ids: string[]
  foreman_names: string[]
  pm_staff_id: string | null
  pm_name: string | null
  pm_user_id: string | null
  last_reminded_at: string | null
}

export function useSiteReportGaps() {
  return useQuery({
    queryKey: ['site-report-gaps'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('site_report_gaps', { p_project_id: null })
      if (error) throw error
      return (data ?? []) as Gap[]
    },
  })
}

export interface Pause { id: string; project_id: string; paused_from: string; paused_until: string | null; reason: string; ended_at: string | null }

export function useActivePauses() {
  return useQuery({
    queryKey: ['site-report-pauses'],
    queryFn: async () => {
      const { data, error } = await supabase.from('site_report_pauses').select('id, project_id, paused_from, paused_until, reason, ended_at').is('ended_at', null)
      if (error) throw error
      return (data ?? []) as Pause[]
    },
  })
}

/** Today in Addis Ababa, as YYYY-MM-DD (reports are due by the site's day, not UTC's). */
export function siteToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(new Date())
}

export function shiftDay(iso: string, by: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + by)
  return d.toISOString().slice(0, 10)
}

/** "Mon 29" style label for a date chip. */
export function dayChip(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** "Mon 29 Sep" for longer copy. */
export function dayLong(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

export function reportLink(projectId: string, date: string) {
  return `/site-foreman/daily-report?project=${projectId}&date=${date}`
}

/** PM → the site's foremen: please send these days. Returns how many were reminded. */
export async function remindForeman(site: Pick<PmSite, 'project_id' | 'dates'>, message?: string) {
  const days = site.dates.map(dayChip).join(', ')
  const { data, error } = await supabase.rpc('site_report_remind', {
    p_project_id: site.project_id,
    p_dates: site.dates,
    p_message: message?.trim() || `Please send the daily site reports for ${days}.`,
  })
  if (error) throw error
  return Number(data ?? 0)
}
