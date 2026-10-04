import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'

// Tax impact (migration 423): every open expense and un-raised PO that
// brings claimable VAT this month, ranked T1 (biggest) down. The rank is the
// identifier: the same T-number shows on the PO, the expense raised from it,
// the approval and payment queues and the table, so an item can be followed
// from screen to screen.

export type ImpactQueue = 'approve' | 'pay' | 'raise'

export interface ImpactItem {
  kind: 'expense' | 'po'
  id: string
  code: string | null
  label: string | null
  vendor: string | null
  vendor_type: string | null
  amount: number
  vat: number
  /** 'vat' is ranked; 'unknown' (vendor listed only as "Supplier") is not — ask for a VAT receipt. */
  cls: 'vat' | 'unknown'
  queue: ImpactQueue
  entered_at: string
  age_days: number
  rank: number | null
  share: number | null
  cum_share: number | null
  high: boolean
  reaches_goal: boolean
  escalated: boolean
  overtook: { id: string; code: string | null; vat: number; rank: number | null } | null
  jumped: number
  overdue: boolean
  po_id: string | null
  po_code: string | null
}

export interface TaxImpact {
  period: { ec_year: number; ec_month: number; label: string; end: string; days_left: number }
  rate: number
  goal: number | null
  course: number
  need: number | null
  basis: 'goal' | 'queue'
  settings: { high_share: number; approve_age_days: number; pay_age_days: number; countdown_days: number }
  items: ImpactItem[]
  computed_at: string
  seen: string[]
}

export function canSeeTaxImpact(role: string | null | undefined, isTaxOfficer?: boolean) {
  return role === 'admin' || role === 'executive' || role === 'finance' || !!isTaxOfficer
}

export function useTaxImpact(enabled = true) {
  const { role, profile } = useAuth()
  const allowed = canSeeTaxImpact(role, profile?.is_tax_officer)
  const q = useQuery({
    queryKey: ['tax-impact'],
    enabled: enabled && allowed,
    staleTime: 2 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('tax_impact_items')
      if (error) throw error
      return data as TaxImpact
    },
  })
  const maps = useMemo(() => {
    const byId = new Map<string, ImpactItem>()
    const byPo = new Map<string, ImpactItem>()
    for (const it of q.data?.items ?? []) {
      byId.set(it.id, it)
      if (it.po_id) {
        const prev = byPo.get(it.po_id)
        // A PO can have several payment requests: the PO wears the best rank among them.
        if (!prev || (it.rank ?? 1e9) < (prev.rank ?? 1e9)) byPo.set(it.po_id, it)
      }
    }
    return { byId, byPo }
  }, [q.data])
  return { ...q, allowed, ...maps }
}

/** After approving or paying: recompute the ranking now. */
export function useRefreshTaxImpact() {
  const qc = useQueryClient()
  return async () => {
    const { data } = await supabase.rpc('tax_impact_refresh')
    if (data) qc.setQueryData(['tax-impact'], data)
    else qc.invalidateQueries({ queryKey: ['tax-impact'] })
  }
}

export async function markImpactSeen(ids: string[]) {
  if (!ids.length) return
  await supabase.rpc('tax_impact_mark_seen', { p_ids: ids })
}

export const QUEUE_LABEL: Record<ImpactQueue, string> = {
  approve: 'Waiting for approval',
  pay: 'Approved, not paid',
  raise: 'PO not raised for payment',
}

export function nextStep(it: ImpactItem, periodLabel: string): string {
  if (it.cls === 'unknown') return 'Ask the vendor for a VAT receipt'
  if (it.queue === 'approve') return `Approve, then pay by the end of ${periodLabel}`
  if (it.queue === 'pay') return `Pay by the end of ${periodLabel}`
  return `Raise the payment request and pay in ${periodLabel}`
}

/** How full the tag's meter is: 4 bars at 20%+ of the gap, 3 at 10%+, 2 at 5%+, else 1. */
export function meterLevel(share: number | null): number {
  const s = share ?? 0
  return s >= 0.2 ? 4 : s >= 0.1 ? 3 : s >= 0.05 ? 2 : 1
}

export const pctText = (n: number | null | undefined) => n == null ? '—' : `${(n * 100).toFixed(n < 0.01 ? 1 : 0)}%`
