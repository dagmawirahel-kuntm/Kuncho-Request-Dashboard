// A week on a site, packed (migration 480): the project's Summary tab, the
// all-projects week page and the Telegram group post read the same numbers.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { addDays, dayLabel, fmtMoney, isoDay } from '@/lib/labour'

export type WeekOrder = {
  id: string; title: string; status: string; due: string | null
  before: number | null; now: number | null; gain: number | null; updated: boolean; note: string | null
  person_days: number; workers: number; cost: number | null; flags: ('no_update' | 'overdue')[]
}
export type WeekLabour = {
  person_days: number; workers: number; days_on_site: number; overtime_hours: number
  cost: number | null; prev_person_days: number; prev_cost: number | null; no_work_order_days: number
  by_day?: { date: string; people: number }[]
}
export type WeekPay = { to_request: number; to_request_amount: number | null; with_finance: number; returned: number; paid_week: number | null }
export type TelegramGroup = { chat_id: number; title: string | null; show_costs: boolean; linked_at: string; last_posted_at: string | null }

export type ProjectWeek = {
  project: { id: string; name: string; pm: string | null; progress: number | null }
  from: string; to: string; current: boolean; costs: boolean
  labour: WeekLabour & { by_day: { date: string; people: number }[] }
  orders: WeekOrder[]; finished: string[]; overdue: { title: string; due: string }[]
  idle_orders: number; open_orders: number; pay: WeekPay; unverified: number; quiet_requests: number
  groups: TelegramGroup[]; can_link: boolean
}

export type OverviewRow = {
  project: ProjectWeek['project']; labour: WeekLabour; by_day: { date: string; people: number }[]
  orders_worked: number; no_update: number; gain: number | null; finished: number; overdue: number
  pay: WeekPay; unverified: number; costs: boolean
}

/** The Monday of the week holding this day. */
export function mondayOf(iso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  return addDays(iso, -((d.getDay() + 6) % 7))
}
export const thisMonday = () => mondayOf(isoDay(new Date()))
export const weekLabel = (from: string) => `${dayLabel(from)} – ${dayLabel(addDays(from, 6))}`

export function useProjectWeek(projectId: string, from: string) {
  return useQuery({
    queryKey: ['project-week', projectId, from],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('project_week_summary', { p_project: projectId, p_from: from })
      if (error) throw error
      return data as ProjectWeek | null
    },
  })
}

export function useWeekOverview(from: string) {
  return useQuery({
    queryKey: ['projects-week', from],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('projects_week_overview', { p_from: from })
      if (error) throw error
      return data as { from: string; to: string; projects: OverviewRow[] } | null
    },
  })
}

export function progressText(o: Pick<WeekOrder, 'before' | 'now' | 'updated'>): string {
  if (o.updated && o.before != null && o.now != null && o.before !== o.now) return `${Math.round(o.before)}% → ${Math.round(o.now)}%`
  if (o.now != null) return `${Math.round(o.now)}%`
  return 'no progress set'
}

/** Plain text to paste into a chat or an email. */
export function weekAsText(w: ProjectWeek): string {
  const l = w.labour
  const lines = [
    `${w.project.name} — ${w.current ? 'this week so far' : 'week of'} ${weekLabel(w.from)}`,
    l.person_days ? `${l.person_days} person-days · ${l.workers} workers · ${l.days_on_site} days on site${l.prev_person_days ? ` (last week ${l.prev_person_days})` : ''}` : 'No labour recorded',
    ...(w.costs && l.cost ? [`Labour ${fmtMoney(l.cost)}`] : []),
    '',
    ...w.orders.map(o => `• ${o.title} — ${o.person_days ? `${o.person_days} day${o.person_days === 1 ? '' : 's'} · ` : ''}${progressText(o)}${o.flags.includes('no_update') ? ' (no progress update)' : ''}`),
    ...(w.finished.length ? ['', `Finished: ${w.finished.join(', ')}`] : []),
    ...(w.overdue.length ? [`${w.overdue.length} overdue: ${w.overdue.slice(0, 3).map(o => o.title).join(', ')}${w.overdue.length > 3 ? '…' : ''}`] : []),
    ...(w.pay.to_request ? [`${w.pay.to_request} confirmed pay sheet${w.pay.to_request === 1 ? '' : 's'} not yet sent to finance`] : []),
    ...(w.pay.with_finance ? [`${w.pay.with_finance} payment request with finance`] : []),
  ]
  return lines.join('\n')
}
