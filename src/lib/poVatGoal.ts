import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// What each purchase order could do for a month's saved VAT goal
// (migration 422). Shown on the Purchase orders pages behind a toggle that
// only admins and executives see.

export type PoVatStep = 'receipt' | 'pay' | 'raise' | 'ask' | 'switch' | 'counted'

export interface PoVatEffect {
  id: string
  code: string
  status: string
  vendor: string | null
  vendor_type: string | null
  /** PO total before VAT. */
  total: number
  /** Input VAT already claimed in the month. */
  counted: number
  /** Paid, due in the month's return, receipt not captured or reviewed. */
  receipt: number
  /** Approved or in flight: claimed if paid before the month ends. */
  pay: number
  /** Not raised or not approved yet: claimed only if raised and paid in the month. */
  raise: number
  /** Vendor type does not say whether it gives VAT receipts. */
  ask: number
  /** No VAT receipt from this vendor: what a VAT supplier at the same total would bring. */
  switch: number
  potential: number
  /** Share of the gap to the goal this PO closes (0–1), when a goal is saved and not yet met. */
  share: number | null
  /** With this PO and every bigger one done, the goal is reached. */
  reaches_goal: boolean
  step: PoVatStep
}

export interface PoVatGoal {
  period: { ec_year: number; ec_month: number; label: string; is_current: boolean }
  rate: number
  goal: number | null
  course: number
  with_steps: number
  need: number | null
  goal_months: { ec_year: number; ec_month: number; label: string; goal: number }[]
  totals: { potential: number; receipt: number; pay: number; raise: number; ask: number; switch: number; counted: number; pos: number }
  pos: PoVatEffect[]
}

export function canSeePoVatGoal(role: string | null | undefined) {
  return role === 'admin' || role === 'executive'
}

export function usePoVatGoal(enabled: boolean, period: { y: number; m: number } | null) {
  return useQuery({
    queryKey: ['po-vat-goal', period?.y ?? null, period?.m ?? null],
    enabled,
    staleTime: 5 * 60_000,
    placeholderData: prev => prev,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('tax_po_goal_effect', { p_ec_year: period?.y ?? null, p_ec_month: period?.m ?? null })
      if (error) throw error
      return data as PoVatGoal
    },
  })
}

const KEY = 'po-vat-goal-on'

/** The admin toggle, remembered in this browser. */
export function usePoVatToggle(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try { return localStorage.getItem(KEY) === '1' } catch { return false }
  })
  return [on, (v: boolean) => {
    try { localStorage.setItem(KEY, v ? '1' : '0') } catch { /* private mode */ }
    setOn(v)
  }]
}

export function stepText(step: PoVatStep, period: PoVatGoal['period']): { label: string; detail: string } {
  switch (step) {
    case 'receipt': return { label: 'Capture the receipt', detail: 'Paid, and due in this return — its VAT receipt is not captured or reviewed yet. Free to claim.' }
    case 'pay': return { label: 'Pay before the month ends', detail: 'The payment is approved. Its VAT is claimed in the month it is paid.' }
    case 'raise': return period.is_current
      ? { label: 'Raise and pay this month', detail: 'No approved payment yet. Its VAT counts only if it is raised, approved and paid this month.' }
      : { label: `Pay it in ${period.label}`, detail: `Its VAT counts in ${period.label} only if it is paid in that month.` }
    case 'ask': return { label: 'Ask for a VAT receipt', detail: 'The vendor is listed as "Supplier", which does not say whether it gives VAT receipts. With one, this VAT could be claimed.' }
    case 'switch': return { label: 'No VAT receipt', detail: 'This vendor gives no VAT receipt. Bought from a VAT supplier at the same total price, this VAT could be claimed — not if the VAT supplier is dearer by the VAT.' }
    default: return { label: 'Already counted', detail: 'Its VAT is already claimed in this month.' }
  }
}

/** "1.23M" / "291.9K" / "850" — compact ETB for chips. */
export function compactEtb(n: number): string {
  const a = Math.abs(n)
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e4 ? `${(a / 1e3).toFixed(0)}K` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : a.toFixed(0)
  return (n < 0 ? '−' : '') + s
}
