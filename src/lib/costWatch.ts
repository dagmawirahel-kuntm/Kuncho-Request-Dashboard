import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Cost watch (527): where each project's money is heading, by cost group,
// on each step from requested to paid.

export const STAGES = [
  { key: 'paid', label: 'Paid' },
  { key: 'approved', label: 'Approved to pay' },
  { key: 'ordered', label: 'Ordered or billed' },
  { key: 'requested', label: 'Requested' },
] as const
export type StageKey = typeof STAGES[number]['key']

export interface WatchRow {
  project_id: string
  project_name: string
  pm_name: string | null
  value: number | null
  value_source: 'contract' | 'quotation' | 'invoiced' | null
  cost_group_id: string | null
  cost_group: string
  sort_order: number
  requested: number
  ordered: number
  approved: number
  paid: number
  new_now: number
  new_before: number
  unpriced: number
}

export interface WatchGroup { id: string | null; name: string; sort: number; requested: number; ordered: number; approved: number; paid: number; total: number; new_now: number; unpriced: number }
export interface WatchProject {
  id: string
  name: string
  pm: string | null
  value: number | null
  valueSource: WatchRow['value_source']
  groups: WatchGroup[]
  total: number
  stages: Record<StageKey, number>
  newNow: number
  newBefore: number
  unpriced: number
}

export interface WatchMove { at: string; project_id: string; project_name: string; amount: number; groups: Record<string, number>; step: string; code: string | null; link: string; who: string | null }
export interface TrendRow { week: string | null; cost_group_id: string | null; cost_group: string; added: number }

const num = (v: unknown) => Number(v ?? 0)

/** Rows per project and cost group, folded into one entry per project. */
export function foldProjects(rows: WatchRow[]): WatchProject[] {
  const by = new Map<string, WatchProject>()
  for (const r of rows) {
    let p = by.get(r.project_id)
    if (!p) {
      p = { id: r.project_id, name: r.project_name, pm: r.pm_name, value: r.value == null ? null : num(r.value), valueSource: r.value_source,
        groups: [], total: 0, stages: { paid: 0, approved: 0, ordered: 0, requested: 0 }, newNow: 0, newBefore: 0, unpriced: 0 }
      by.set(r.project_id, p)
    }
    const g: WatchGroup = { id: r.cost_group_id, name: r.cost_group, sort: r.sort_order, requested: num(r.requested), ordered: num(r.ordered),
      approved: num(r.approved), paid: num(r.paid), total: 0, new_now: num(r.new_now), unpriced: r.unpriced ?? 0 }
    g.total = g.requested + g.ordered + g.approved + g.paid
    p.groups.push(g)
    p.total += g.total
    for (const s of STAGES) p.stages[s.key] += g[s.key]
    p.newNow += g.new_now
    p.newBefore += num(r.new_before)
    p.unpriced += g.unpriced
  }
  for (const p of by.values()) p.groups.sort((a, b) => a.sort - b.sort)
  return [...by.values()]
}

const LIVE = { refetchInterval: 60_000, refetchOnWindowFocus: true, staleTime: 30_000 }

export function useCostWatch(days: number) {
  return useQuery({
    queryKey: ['cost-watch', days],
    ...LIVE,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('cost_watch', { p_days: days })
      if (error) throw error
      return foldProjects((data ?? []) as WatchRow[])
    },
  })
}

export function useCostWatchMoves(projectId?: string) {
  return useQuery({
    queryKey: ['cost-watch-moves', projectId ?? null],
    ...LIVE,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('cost_watch_moves', { p_limit: 40, p_project: projectId ?? null })
      if (error) throw error
      return (data ?? []) as WatchMove[]
    },
  })
}

export function useCostWatchTrend(projectId: string | null, weeks = 16) {
  return useQuery({
    queryKey: ['cost-watch-trend', projectId, weeks],
    enabled: !!projectId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('cost_watch_trend', { p_project: projectId, p_weeks: weeks })
      if (error) throw error
      return (data ?? []) as TrendRow[]
    },
  })
}

/** Monday of each of the last `weeks` weeks, as yyyy-mm-dd, oldest first. */
export function lastWeeks(weeks: number, today = new Date()) {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  const out: string[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    const w = new Date(d); w.setDate(d.getDate() - 7 * i)
    out.push(`${w.getFullYear()}-${String(w.getMonth() + 1).padStart(2, '0')}-${String(w.getDate()).padStart(2, '0')}`)
  }
  return out
}

/** Running total per cost group, week by week, starting from what came before. */
export function cumulative(rows: TrendRow[], weeks: string[]) {
  const groups = [...new Set(rows.map(r => r.cost_group))]
  const run: Record<string, number> = Object.fromEntries(groups.map(g => [g, 0]))
  for (const r of rows) if (r.week == null) run[r.cost_group] += num(r.added)
  return {
    groups,
    points: weeks.map(w => {
      for (const r of rows) if (r.week === w) run[r.cost_group] += num(r.added)
      return { week: w, ...run }
    }),
  }
}

/** Labour, not Labor, on screen. */
export const groupLabel = (name: string) => (name === 'Labor' ? 'Labour' : name)

// ── Needs a look: plain rules over the same numbers ──────────────────
export type AlertLevel = 'act' | 'check'
export interface WatchAlert { level: AlertLevel; projectId: string; projectName: string; title: string; detail: string; weight: number }

/** The thresholds, in one place so they can be tuned. */
export const ALERT_RULES = {
  jumpTimes: 3,          // this period more than 3× the one before …
  jumpMin: 1_000_000,    // … and over 1M
  newMin: 1_000_000,     // new spending over 1M with nothing before
  unpricedMin: 15,       // requested lines with no price
  noPmMin: 100_000,      // cost with no project manager
  approvedMin: 1_500_000, // approved to pay, not paid
}

const short = (n: number) => {
  const a = Math.abs(n)
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, '')}M`
  if (a >= 1e3) return `${Math.round(n / 1e3)}K`
  return String(Math.round(n))
}

/** What someone should look at, most urgent and biggest first. */
export function watchAlerts(projects: WatchProject[], days: number, rules = ALERT_RULES): WatchAlert[] {
  const out: WatchAlert[] = []
  const add = (p: WatchProject, level: AlertLevel, title: string, detail: string, weight: number) =>
    out.push({ level, projectId: p.id, projectName: p.name, title, detail, weight })
  for (const p of projects) {
    if (p.value && p.total > p.value) {
      const what = p.valueSource === 'invoiced' ? 'invoiced so far' : p.valueSource === 'quotation' ? 'the accepted quotation' : 'the contract'
      add(p, 'act', 'Cost past what it is worth', `${short(p.total)} against ${short(p.value)} (${what}), ${Math.round((p.total / p.value) * 100)}%.`, p.total - p.value)
    }
    if (p.newBefore > 0 && p.newNow > rules.jumpTimes * p.newBefore && p.newNow > rules.jumpMin) {
      add(p, 'check', `${Math.round(p.newNow / p.newBefore)}× the ${days} days before`, `+${short(p.newNow)} in ${days} days against ${short(p.newBefore)} before.`, p.newNow)
    }
    if (p.newBefore === 0 && p.newNow > rules.newMin) {
      add(p, 'check', 'New spending', `+${short(p.newNow)} in ${days} days, nothing the ${days} days before.`, p.newNow)
    }
    if (p.unpriced >= rules.unpricedMin) {
      add(p, 'check', `${p.unpriced} requested lines not priced`, 'No estimate and no past price: the real cost is higher than shown.', p.unpriced * 10_000)
    }
    if (!p.pm && p.total > rules.noPmMin) {
      add(p, 'check', 'No project manager', `${short(p.total)} of cost and nobody answers for it.`, p.total)
    }
    if (p.stages.approved > rules.approvedMin) {
      add(p, 'check', `${short(p.stages.approved)} approved, not paid`, 'Approved to pay and still waiting: suppliers or labour may be chasing it.', p.stages.approved)
    }
  }
  return out.sort((a, b) => (a.level === b.level ? b.weight - a.weight : a.level === 'act' ? -1 : 1))
}

/** One colour per cost group, fixed by the group (never by rank). */
export const GROUP_SLOT: Record<string, number> = { Materials: 1, Labor: 2, Subcontract: 3, Transport: 4, Overhead: 5 }
export const colorOf = (name: string) => (GROUP_SLOT[name] ? `var(--cw-g${GROUP_SLOT[name]})` : 'var(--cw-other)')
