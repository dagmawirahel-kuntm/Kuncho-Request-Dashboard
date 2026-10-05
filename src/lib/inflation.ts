import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Inflation to collection (migration 426).
//
// A proforma is priced at today's costs, but the money comes in over the job:
// an advance at signing, progress payments month by month, the final payment
// some time after handover. With prices rising, a birr collected in month 5
// buys less than one collected today. This works out, for a collection plan
// and a yearly rate:
//
//   worth today      what the whole price is worth in today's money once each
//                    payment is discounted back from the month it arrives
//   lost             price − worth today
//   allowance        the uplift that makes the payments worth today's price:
//                    1 / (worth today ÷ price) − 1
//
// The rate blends the benchmark's materials rate and its rate for everything
// else (labour, services) by the job's materials share — from the price guide
// costs where lines have them, else the benchmark's default share.

export interface InflationSettings {
  materials_rate: number
  general_rate: number
  default_materials_share: number
  default_months: number
  default_final_lag_months: number
  rate_note: string | null
  updated_at: string
  updated_by: string | null
}

export interface ObservedInflation {
  items: number
  median: number | null
  p25: number | null
  p75: number | null
  rising: number
  falling: number
  avg_days: number | null
  history_days: number | null
  prices: number
}

export interface CollectPlan {
  /** Months of work; progress payments spread over them. */
  months: number
  advancePct: number
  finalPct: number
  /** Months after the work ends that the final payment arrives. */
  finalLagMonths: number
}

export interface Tranche {
  label: string
  month: number
  share: number
  /** Nominal amount, and what it is worth in today's money. */
  amount: number
  worth: number
}

export interface InflationResult {
  rate: number
  tranches: Tranche[]
  worthToday: number
  lost: number
  allowancePct: number
  neededPrice: number
  /** Money-weighted months until the price is collected. */
  avgMonths: number
}

export const SETTINGS_FALLBACK: InflationSettings = {
  materials_rate: 0.18, general_rate: 0.13, default_materials_share: 0.6,
  default_months: 4, default_final_lag_months: 1, rate_note: null, updated_at: '', updated_by: null,
}

export function blendedRate(s: Pick<InflationSettings, 'materials_rate' | 'general_rate'>, materialsShare: number) {
  const m = Math.min(1, Math.max(0, materialsShare))
  return m * Number(s.materials_rate) + (1 - m) * Number(s.general_rate)
}

/** When each part of the price is collected. */
export function tranchesOf(plan: CollectPlan): Omit<Tranche, 'amount' | 'worth'>[] {
  const adv = Math.max(0, Math.min(100, plan.advancePct)) / 100
  const fin = Math.max(0, Math.min(100 - adv * 100, plan.finalPct)) / 100
  const prog = Math.max(0, 1 - adv - fin)
  const n = Math.max(0, Math.round(plan.months))
  const out: Omit<Tranche, 'amount' | 'worth'>[] = []
  if (adv > 0) out.push({ label: 'Advance', month: 0, share: adv })
  if (prog > 0) {
    if (n === 0) out.push({ label: 'Progress', month: 0, share: prog })
    else for (let i = 1; i <= n; i++) out.push({ label: `Month ${i}`, month: i, share: prog / n })
  }
  if (fin > 0) out.push({ label: 'Final', month: plan.months + Math.max(0, plan.finalLagMonths), share: fin })
  return out
}

export function inflationToCollection(price: number, plan: CollectPlan, yearlyRate: number): InflationResult {
  const base = Math.max(0, price)
  const tranches = tranchesOf(plan).map(t => {
    const amount = base * t.share
    const worth = amount / Math.pow(1 + yearlyRate, t.month / 12)
    return { ...t, amount, worth }
  })
  const worthToday = tranches.reduce((s, t) => s + t.worth, 0)
  const fraction = base > 0 ? worthToday / base : 1
  const allowancePct = fraction > 0 ? (1 / fraction - 1) * 100 : 0
  return {
    rate: yearlyRate,
    tranches,
    worthToday,
    lost: base - worthToday,
    allowancePct,
    neededPrice: fraction > 0 ? base / fraction : base,
    avgMonths: tranches.reduce((s, t) => s + t.share * t.month, 0),
  }
}

/** Whole months between two ISO dates, at least 0. */
export function monthsBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  if (!from || !to) return null
  const a = new Date(`${from}T00:00:00Z`), b = new Date(`${to}T00:00:00Z`)
  const m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + (b.getUTCDate() - a.getUTCDate()) / 30
  return m > 0 ? Math.round(m * 2) / 2 : null
}

export const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits).replace(/\.0$/, '')}%`

export function useInflationSettings() {
  return useQuery({
    queryKey: ['sales-inflation-settings'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('sales_inflation_settings').select('*').maybeSingle()
      if (error) throw error
      return (data ?? SETTINGS_FALLBACK) as InflationSettings
    },
  })
}

export function useObservedInflation(enabled = true) {
  return useQuery({
    queryKey: ['sales-inflation-observed'],
    enabled,
    staleTime: 60 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('sales_inflation_observed')
      if (error) throw error
      return data as ObservedInflation
    },
  })
}

/** Our own price history is a usable hint only with enough items over enough time. */
export function observedIsReliable(o: ObservedInflation | null | undefined) {
  return !!o && o.items >= 20 && (o.avg_days ?? 0) >= 120 && o.median != null
}
