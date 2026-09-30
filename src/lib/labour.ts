import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useMyManagedProjects, useMySiteForemanProjects } from '@/hooks/useMyStaff'
import type { Tone } from '@/components/record/Record'

// Labour: ask → record → pay (migration 375). Words here are the words on
// the screens; the table and column names underneath stay as they were.

export type PayBasis = 'per_day' | 'per_volume' | 'fixed_price'
export type PayModel = 'individual' | 'gang_leader'
export type PayCycle = 'weekly' | 'engagement_end'

export const BASIS_LABEL: Record<PayBasis, string> = {
  per_day: 'By the day',
  per_volume: 'By quantity',
  fixed_price: 'Fixed price',
}
export const BASIS_HINT: Record<PayBasis, string> = {
  per_day: 'Paid for hours worked — 8 hours is a day.',
  per_volume: 'Paid for work done: m², pieces, metres…',
  fixed_price: 'One price for a whole task, paid in parts as it gets done.',
}

export interface LabourRequest {
  id: string
  project_id: string
  role_needed: string
  headcount: number
  start_date: string | null
  end_date: string | null
  status: 'pending' | 'approved' | 'rejected'
  payment_basis: PayBasis
  payment_model: PayModel
  pay_cycle: PayCycle
  estimated_day_rate: number | null
  estimated_days: number | null
  estimated_total_cost: number | null
  unit_rate: number | null
  volume_unit: string | null
  estimated_total_volume: number | null
  fixed_price_amount: number | null
  gang_leader_vendor_id: string | null
  scope_of_work: string | null
  site_location: string | null
  notes: string | null
  decision_note: string | null
  requested_by: string | null
  approved_by: string | null
  approved_at: string | null
  created_at: string
  closed_at: string | null
  close_reason: string | null
  slots_filled: number | null
  work_order_id: string | null
  projects?: { project_name: string } | null
  vendors?: { vendor_name: string } | null
}

export type RequestStage = 'waiting' | 'active' | 'ended' | 'declined'

export function stageOf(r: Pick<LabourRequest, 'status' | 'closed_at' | 'end_date'>): RequestStage {
  if (r.status === 'rejected') return 'declined'
  if (r.status === 'pending') return 'waiting'
  if (r.closed_at || (r.end_date && r.end_date < new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10))) return 'ended'
  return 'active'
}
export const STAGE: Record<RequestStage, { label: string; tone: Tone }> = {
  waiting: { label: 'Waiting for approval', tone: 'amber' },
  active: { label: 'Active', tone: 'green' },
  ended: { label: 'Ended', tone: 'slate' },
  declined: { label: 'Declined', tone: 'red' },
}

export const APPROVER_ROLES = ['admin', 'operations_manager', 'hr_officer']
export const ALL_SITES_ROLES = ['admin', 'executive', 'operations_manager', 'hr_officer']

export function rateSummary(r: Pick<LabourRequest, 'payment_basis' | 'estimated_day_rate' | 'unit_rate' | 'volume_unit' | 'fixed_price_amount'>): string {
  const money = (n: number | null | undefined) => n == null ? '—' : `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })} ETB`
  if (r.payment_basis === 'per_volume') return `${money(r.unit_rate)} per ${r.volume_unit ?? 'unit'}`
  if (r.payment_basis === 'fixed_price') return `${money(r.fixed_price_amount)} for the task`
  return r.estimated_day_rate ? `${money(r.estimated_day_rate)} a day` : "Each worker's own day rate"
}

/** Rough cost of a request, for the approver. */
export function estimateOf(r: Pick<LabourRequest, 'payment_basis' | 'estimated_day_rate' | 'estimated_days' | 'headcount' | 'unit_rate' | 'estimated_total_volume' | 'fixed_price_amount' | 'estimated_total_cost'>): number | null {
  if (r.estimated_total_cost) return Number(r.estimated_total_cost)
  if (r.payment_basis === 'fixed_price') return r.fixed_price_amount
  if (r.payment_basis === 'per_volume') return r.unit_rate && r.estimated_total_volume ? r.unit_rate * r.estimated_total_volume : null
  return r.estimated_day_rate && r.estimated_days ? r.estimated_day_rate * r.estimated_days * (r.headcount || 1) : null
}

/** The sites this person can ask for, record and confirm labour on. */
export function useLabourSites() {
  const { role } = useAuth()
  const { projects: managed, isLoading: l1 } = useMyManagedProjects()
  const { projects: foreman, isLoading: l2 } = useMySiteForemanProjects()
  const everywhere = ALL_SITES_ROLES.includes(role ?? '')
  const all = useQuery({
    queryKey: ['labour-all-sites'],
    enabled: everywhere,
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('id, project_name').eq('active_for_year', true).order('project_name')
      if (error) throw error
      return (data ?? []) as { id: string; project_name: string }[]
    },
  })
  const mine = new Map<string, { id: string; project_name: string }>()
  for (const p of [...(managed ?? []), ...(foreman ?? [])]) mine.set(p.id, p)
  const sites = everywhere ? (all.data ?? [...mine.values()]) : [...mine.values()].sort((a, b) => a.project_name.localeCompare(b.project_name))
  return {
    sites,
    managedIds: new Set((managed ?? []).map(p => p.id)),
    everywhere,
    isLoading: l1 || l2 || (everywhere && all.isLoading),
  }
}

export const fmtMoney = (n: number | null | undefined) =>
  n == null ? '—' : `${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETB`

export const isoDay = (d: Date) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
  return z.toISOString().slice(0, 10)
}
export const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + n)
  return isoDay(d)
}
export const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

/** Where finance is with a confirmed pay sheet's payable. */
export const financeStatus = (e: { approval_status: string; payment_state: string } | null | undefined) =>
  !e ? 'With finance' : e.payment_state === 'paid' ? 'Paid' : e.approval_status === 'approved' ? 'Approved, not paid yet'
    : e.approval_status === 'rejected' ? 'Sent back by finance' : 'Waiting for finance'
export const financeTone = (s: string): Tone =>
  s === 'Paid' ? 'green' : s.startsWith('Sent back') ? 'red' : s.startsWith('Approved') ? 'blue' : 'amber'
