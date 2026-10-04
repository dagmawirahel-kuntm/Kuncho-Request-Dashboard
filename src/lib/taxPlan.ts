import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// The monthly tax plan (migration 411): management's goal per tax, the
// benchmark the books point to with the tax policies applied, and what was
// recorded, declared and paid.

export type TaxCode = 'VAT' | 'WHT' | 'SCH_A' | 'PENSION'
export const TAX_CODES: TaxCode[] = ['VAT', 'WHT', 'SCH_A', 'PENSION']

export interface TaxPlanPart { label: string; amount: number; count?: number; full?: number }

export interface TaxPlanSchedule {
  code: TaxCode
  label: string
  recorded: number
  benchmark: number
  parts: TaxPlanPart[]
  effects: Record<string, number>
  goal: number | null
  goal_note: string | null
  filing_id: string | null
  filing_status: 'draft' | 'filed' | 'acknowledged' | null
  declared: number | null
  paid: number | null
  due_date: string | null
  payment_date: string | null
}

export type PolicyArea = 'procurement' | 'sales' | 'payroll' | 'compliance'

export interface TaxPolicy {
  code: string
  area: PolicyArea
  name: string
  description: string | null
  unit: 'pct' | 'etb'
  value: number
  is_active: boolean
  saved_value: number
  saved_active: boolean
  updated_at: string
  /** What the policy does to this period's benchmark, in ETB (negative lowers it). */
  effect: number
}

export interface TaxSuggestion {
  key: string
  tone: 'save' | 'risk' | 'info' | 'good'
  title: string
  detail: string
  amount: number | null
  amount_label: string | null
  link?: string
}

export interface TaxDue {
  filing_id: string
  code: string
  period_label: string
  ec_year: number
  ec_month: number | null
  due_date: string
  status: 'draft' | 'filed' | 'acknowledged'
  declared: number | null
  paid: number | null
  expected: number | null
}

export interface TaxPlan {
  period: { ec_year: number; ec_month: number; label: string; start: string; end: string; is_current: boolean; is_future: boolean }
  rates: { vat: number; wht: number; wht_goods: number; wht_services: number }
  schedules: TaxPlanSchedule[]
  totals: { recorded: number; benchmark: number; goal: number | null; declared: number | null; paid: number | null }
  policies: TaxPolicy[]
  suggestions: TaxSuggestion[]
  due_in_period: TaxDue[]
  can_manage: boolean
}

export interface TaxPlanMonth {
  ec_year: number
  ec_month: number
  label: string
  is_current: boolean
  recorded: number
  benchmark: number
  goal: number | null
  declared: number | null
  paid: number | null
}

/** Policy changes being tried, not saved: {code: {on, v}}. */
export type WhatIf = Record<string, { on: boolean; v: number }>

export function useTaxPlan(ecYear: number | null, ecMonth: number | null, whatIf: WhatIf | null) {
  return useQuery({
    queryKey: ['tax-plan', ecYear, ecMonth, whatIf],
    placeholderData: prev => prev,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('tax_plan', {
        p_ec_year: ecYear, p_ec_month: ecMonth,
        p_what_if: whatIf && Object.keys(whatIf).length ? whatIf : null,
      })
      if (error) throw error
      return data as TaxPlan
    },
  })
}

export function useTaxPlanHistory() {
  return useQuery({
    queryKey: ['tax-plan-history'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('tax_plan_history', { p_back: 5 })
      if (error) throw error
      return (data ?? []) as TaxPlanMonth[]
    },
  })
}

export const POLICY_AREA_LABEL: Record<PolicyArea, string> = {
  procurement: 'Procurement', sales: 'Sales', payroll: 'Payroll', compliance: 'Compliance',
}

/** Next tax period (Ethiopian months 1–12; Pagume is declared with a neighbour). */
export function shiftPeriod(y: number, m: number, by: number): { y: number; m: number } {
  const i = y * 12 + (m - 1) + by
  return { y: Math.floor(i / 12), m: (i % 12) + 1 }
}

// ── Trainer (migration 412) ─────────────────────────────────────────────

export type StepKind = 'paperwork' | 'procurement' | 'timing' | 'pay_policy' | 'protect' | 'info' | 'advice'

export interface TrainerStep {
  tax: TaxCode
  code: string
  kind: StepKind
  title: string
  detail: string
  /** ETB the step takes off this month's benchmark (0 for advice). */
  amount: number
  /** For WHT: what is at risk of becoming the company's cost. */
  exposure?: number
  estimate?: boolean
  patch?: WhatIf
  link?: string
}

export interface TrainerLevers {
  period: { ec_year: number; ec_month: number; label: string; is_current: boolean; end: string }
  base: Record<TaxCode, number>
  steps: TrainerStep[]
}

export interface YearMonth {
  ec_year: number
  ec_month: number
  label: string
  state: 'done' | 'current' | 'ahead'
  value: number
  source: 'declared' | 'benchmark' | 'projected' | 'run rate'
  benchmark: number
  declared: number | null
  goal: number | null
}

export interface YearTax {
  code: TaxCode
  label: string
  done: number
  current: number
  ahead: number
  projected: number
  run_rate: number
  months_left: number
  goal: number | null
  monthly_goals_total: number | null
  needed_per_month: number | null
  months: YearMonth[]
}

export interface TaxYear {
  fiscal_period: { id: string; label: string; start: string; end: string; is_current: boolean }
  current: { ec_year: number; ec_month: number }
  taxes: YearTax[]
  can_manage: boolean
}

export function useTaxLevers(ecYear: number | null, ecMonth: number | null, whatIf: WhatIf | null) {
  return useQuery({
    queryKey: ['tax-levers', ecYear, ecMonth, whatIf],
    placeholderData: prev => prev,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('tax_plan_levers', {
        p_ec_year: ecYear, p_ec_month: ecMonth,
        p_what_if: whatIf && Object.keys(whatIf).length ? whatIf : null,
      })
      if (error) throw error
      return data as TrainerLevers
    },
  })
}

export function useTaxYear() {
  return useQuery({
    queryKey: ['tax-year'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('tax_plan_year', { p_fiscal_period_id: null })
      if (error) throw error
      return data as TaxYear
    },
  })
}

/** Easiest first: what costs nothing, then where things are bought, then timing, then pay. */
export const STEP_ORDER: StepKind[] = ['paperwork', 'procurement', 'timing', 'pay_policy']

export const STEP_KIND_LABEL: Record<StepKind, string> = {
  paperwork: 'Paperwork', procurement: 'Procurement', timing: 'Timing', pay_policy: 'Pay policy',
  protect: 'Protect', info: 'Good to know', advice: 'Ask the tax officer',
}

// ── Forecast and VAT goal (migration 419) ───────────────────────────────

export interface ForecastVat {
  sales_invoiced: number
  sales_to_invoice: number
  sales_expected: number
  input_claimed: number
  input_expected: number
  input_waiting_receipts: number
  input_approved_bills: number
  /** With nothing more done. */
  course: number
  /** With this month's receipts captured and approved VAT-supplier bills paid. */
  with_steps: number
  credit_in: number
  payable: number
  credit_out: number
  expected_wht: number
  expectations: number
}

export interface Expectation {
  id: string
  kind: 'sale' | 'purchase'
  label: string
  amount: number
  amount_includes_vat: boolean
  vat_applies: boolean
  milestone_id: string | null
  note: string | null
  vat: number
}

export interface ForecastMonth {
  ec_year: number
  ec_month: number
  label: string
  start: string
  end: string
  is_current: boolean
  vat: ForecastVat
  wht: number
  sch_a: number
  pension: number
  payroll_projected: boolean
  goals: Partial<Record<TaxCode, number>>
  expectations: Expectation[]
}

export interface UnscheduledMilestone { id: string; title: string; kind: string | null; project: string | null; gross: number; vat: number }

export interface TaxForecast {
  rate: number
  months: ForecastMonth[]
  unscheduled: { milestones: UnscheduledMilestone[]; open_orders: { count: number; value: number; vat: number } }
  can_manage: boolean
}

export function useTaxForecast() {
  return useQuery({
    queryKey: ['tax-forecast'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('tax_forecast', { p_months: 6 })
      if (error) throw error
      return data as TaxForecast
    },
  })
}

export type GoalTier = 'paperwork' | 'timing' | 'procurement' | 'sales_timing'

export interface GoalLever {
  code: string
  tier: GoalTier
  title: string
  detail: string
  capacity: number
  used: number
  caveat: string | null
  link: string | null
}

export interface VatGoal {
  period: { ec_year: number; ec_month: number; label: string; is_current: boolean }
  rate: number
  target: number
  course: number
  with_steps: number
  need: number
  parts: ForecastVat
  /** The easiest tier that gets there; null when it can't be reached. */
  reached_with: 'already' | GoalTier | null
  levers: GoalLever[]
  closest: number
  remaining: number
  would_take: { purchases_incl_vat: number; cash_cost: number; invoicing_incl_vat: number } | null
  credit: { amount: number; used_up_in: string | null; months: { label: string; vat: number; credit_left: number }[] } | null
}

export function useVatGoal(y: number | null, m: number | null, target: number | null) {
  return useQuery({
    queryKey: ['vat-goal', y, m, target],
    enabled: y != null && m != null && target != null,
    placeholderData: prev => prev,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('tax_vat_goal', { p_ec_year: y, p_ec_month: m, p_target: target })
      if (error) throw error
      return data as VatGoal
    },
  })
}

export const TIER_LABEL: Record<GoalTier, string> = {
  paperwork: 'Paperwork', timing: 'Timing', procurement: 'Procurement', sales_timing: 'Invoice timing',
}
