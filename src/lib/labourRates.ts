import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Standard rates by trade and raises (545). A trade's standard is paid on every
// project; a worker gets more only through a raise admin or operations approved.

export type TradeRate = { trade_tag: string; day_rate: number | null; rate_set_at: string | null; rate_set_by_name: string | null }
export type Raise = {
  id: string; staff_id: string; rate: number; reason: string | null; status: 'pending' | 'approved' | 'rejected' | 'ended'
  requested_by_name: string | null; requested_at: string; decided_by_name: string | null; decided_at: string | null; decision_note: string | null
  staff?: { employee_name: string; trade_tag: string | null; day_rate: number | null } | null
}
export type SetRateResult = { status: 'set' | 'standard' | 'approved' | 'requested'; rate: number; standard?: number }

export function useTradeRates() {
  return useQuery({
    queryKey: ['labour-trade-rates'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('tier2_trade_roster').select('trade_tag, day_rate, rate_set_at, rate_set_by_name').order('sort_order')
      if (error) throw error
      return (data ?? []) as TradeRate[]
    },
  })
}

/** Raises still in play: asked for, or approved. */
export function useOpenRaises(enabled = true) {
  return useQuery({
    queryKey: ['labour-rate-raises'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('worker_rate_raises')
        .select('*, staff:staff_id(employee_name, trade_tag, day_rate)').in('status', ['pending', 'approved']).order('requested_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as Raise[]
    },
  })
}

/** Ask for (or, for admin and operations, set) a worker's day rate. */
export async function setWorkerRate(staffId: string, rate: number, reason?: string | null): Promise<SetRateResult> {
  const { data, error } = await supabase.rpc('worker_set_day_rate', { p_staff: staffId, p_rate: rate, p_reason: reason ?? null })
  if (error) throw error
  return data as SetRateResult
}

export function rateMessage(name: string, r: SetRateResult) {
  const n = Number(r.rate).toLocaleString()
  if (r.status === 'requested') return `Raise to ${n} a day asked for ${name} — admin or operations approve it. Until then they're paid the standard ${Number(r.standard).toLocaleString()}.`
  if (r.status === 'approved') return `${name}: ${n} a day (raise approved)`
  if (r.status === 'standard') return `${name} is back on the standard ${n} a day`
  return `${name}: ${n} a day`
}

export const RATE_QUERY_KEYS = ['labour-rate-raises', 'labour-trade-rates', 'labour-pm-workers', 'labour-casual-workers', 'labour-day', 'labour-pay-weeks', 'worker-register']
