import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency } from '@/lib/utils'

// Taxes, by tax month (507). Every Ethiopian month has four returns — VAT,
// withholding, payroll tax and pension — and each goes the same way: what
// the books say, declared, paid. Profit tax goes that way once a year.

export type TaxCode = 'VAT' | 'WHT' | 'SCH_A' | 'PENSION' | 'SCH_C'
export const MONTHLY: TaxCode[] = ['VAT', 'WHT', 'SCH_A', 'PENSION']
export const TAX_NAME: Record<TaxCode, string> = {
  VAT: 'VAT', WHT: 'Withholding', SCH_A: 'Payroll tax', PENSION: 'Pension', SCH_C: 'Profit tax',
}
export const TAX_LONG: Record<TaxCode, string> = {
  VAT: 'VAT return', WHT: 'Withholding return', SCH_A: 'Payroll tax (Schedule A)', PENSION: 'Pension contributions', SCH_C: 'Profit tax (Schedule C)',
}

/** Where a return stands. */
export type ReturnState = 'future' | 'running' | 'to_declare' | 'late' | 'to_pay' | 'late_pay' | 'done'

export interface TaxReturn {
  id: string; code: TaxCode; period: string; ec_year: number; ec_month: number | null
  start: string; end: string; due: string | null
  /** What the books say; null for profit tax, which comes from the year's accounts. */
  books: number | null
  basis: Record<string, number | null>
  declared: number | null; reference: string | null; declared_on: string | null
  paid: number | null; paid_on: string | null
  paid_by_expense: string | null; paid_by_code: string | null
  paid_from_account: string | null; paid_from_name: string | null
  status: string
  state: ReturnState
  /** Profit tax only. */
  deductible_expenses?: number; client_wht_credits?: number
}

export interface TaxMonthRow {
  ec_year: number; ec_month: number; label: string; start: string; end: string
  returns: Partial<Record<TaxCode, TaxReturn>>
}

export interface TaxYear {
  fy: { id: string; label: string; start: string; end: string; is_current: boolean }
  years: { id: string; label: string; is_current: boolean }[]
  today: string
  can_record: boolean
  months: TaxMonthRow[]
  yearly: Partial<Record<TaxCode, TaxReturn>>
}

export interface GovBill {
  id: string; code: string | null; date: string; description: string | null; payee: string | null
  amount: number; payment_state: string | null
  /** What is left once the returns it already pays are taken. */
  left: number
  pays: { id: string; code: TaxCode; period: string; amount: number }[]
}

export interface TaxMonth {
  ec_year: number; ec_month: number; label: string; start: string; end: string; today: string
  prev: { ec_year: number; ec_month: number; label: string }
  next: { ec_year: number; ec_month: number; label: string } | null
  is_current: boolean
  can_record: boolean
  returns: Partial<Record<TaxCode, TaxReturn>>
  bills: GovBill[]
  claimed: { expense_id: string; code: string | null; vendor: string | null; tin: string | null; vat: number; receipt_no: string | null; ticked: boolean; part_no: number | null }[]
  unflagged: { expense_id: string; code: string | null; vendor: string | null; amount: number; vat: number }[]
}

export function canSeeTaxes(role: string | null | undefined, isTaxOfficer?: boolean | null) {
  return role === 'admin' || role === 'executive' || role === 'finance' || !!isTaxOfficer
}

export function useTaxYear(fy: string | null) {
  const { role, profile } = useAuth()
  return useQuery({
    queryKey: ['tax-year', fy],
    enabled: canSeeTaxes(role, profile?.is_tax_officer),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('tax_year_open', { p_fiscal_period_id: fy })
      if (error) throw error
      return data as TaxYear
    },
  })
}

export function useTaxMonth(y: number | null, m: number | null) {
  const { role, profile } = useAuth()
  return useQuery({
    queryKey: ['tax-month', y, m],
    enabled: y != null && m != null && canSeeTaxes(role, profile?.is_tax_officer),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('tax_month_open', { p_ec_year: y, p_ec_month: m })
      if (error) throw error
      return data as TaxMonth
    },
  })
}

/** After anything is recorded: the year, the month, the receipt chase and the ledger-facing views. */
export function useTaxRefresh() {
  const qc = useQueryClient()
  return () => {
    for (const k of ['tax-year', 'tax-month', 'vat-receipt-chase', 'tax-impact', 'tax-hub', 'tax-filing-lines']) qc.invalidateQueries({ queryKey: [k] })
  }
}

export async function declareReturn(id: string, amount: number, reference: string | null, on: string | null) {
  const { error } = await supabase.rpc('tax_return_declare', { p_filing: id, p_amount: amount, p_reference: reference, p_on: on })
  if (error) throw error
}
export async function payReturn(id: string, amount: number, on: string | null, by: { expense?: string; account?: string }) {
  const { error } = await supabase.rpc('tax_return_pay', {
    p_filing: id, p_amount: amount, p_on: on, p_expense: by.expense ?? null, p_account: by.account ?? null,
  })
  if (error) throw error
}
export async function undoReturn(id: string, what: 'payment' | 'declaration') {
  const { error } = await supabase.rpc('tax_return_undo', { p_filing: id, p_what: what })
  if (error) throw error
}
export type ReceiptAction = 'held' | 'not_held' | 'no_vat' | 'vat'
export async function markReceipts(ids: string[], action: ReceiptAction, receiptNo?: string | null) {
  const { error } = await supabase.rpc('tax_receipt_held', { p_expense_ids: ids, p_action: action, p_receipt_no: receiptNo ?? null })
  if (error) throw error
}

// ── Words and numbers ──────────────────────────────────────────────────────
export const etb = (n: number | null | undefined) => formatCurrency(Math.round(Number(n ?? 0))).replace(/\.00$/, '')
export const etb2 = (n: number | null | undefined) => formatCurrency(Number(n ?? 0))

/** "today", "tomorrow", "in 5 days", "3 days ago" from a date, against today. */
export function daysFrom(iso: string, today: string) {
  return Math.round((Date.parse(`${iso}T00:00:00`) - Date.parse(`${today}T00:00:00`)) / 864e5)
}
export function whenText(iso: string, today: string) {
  const d = daysFrom(iso, today)
  if (d === 0) return 'today'
  if (d === 1) return 'tomorrow'
  if (d === -1) return 'yesterday'
  return d > 0 ? `in ${d} days` : `${-d} days ago`
}
export const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'
export const longDate = (iso: string | null | undefined) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

export type Tone = 'red' | 'amber' | 'green' | 'slate' | 'blue'
/** A return's state in a few words, with its tone. */
export function stateLabel(r: TaxReturn, today: string): { text: string; tone: Tone } {
  switch (r.state) {
    case 'done': return { text: r.declared === 0 && !r.paid ? 'Done · nil' : 'Done', tone: 'green' }
    case 'future': return { text: 'Not started', tone: 'slate' }
    case 'running': return { text: 'Month running', tone: 'slate' }
    case 'to_declare': return { text: `Declare ${r.due ? whenText(r.due, today) : ''}`.trim(), tone: 'amber' }
    case 'late': return { text: 'Late: not declared', tone: 'red' }
    case 'to_pay': return { text: `Declared · pay ${r.due ? whenText(r.due, today) : ''}`.trim(), tone: 'amber' }
    case 'late_pay': return { text: 'Late: declared, not paid', tone: 'red' }
  }
}
export const TONE_PILL: Record<Tone, string> = {
  red: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  blue: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
}

/** The amount a return comes to: declared if it was, else what the books say. */
export const returnAmount = (r: TaxReturn) => Number(r.declared ?? r.books ?? 0)
export const needsAction = (r: TaxReturn) => ['to_declare', 'late', 'to_pay', 'late_pay'].includes(r.state)

export const monthPath = (y: number, m: number) => `/taxes/${y}/${m}`

// ── Which bill paid a return ───────────────────────────────────────────────
const WORDS: Record<TaxCode, RegExp> = {
  VAT: /\bvat\b|value added/i,
  WHT: /\bwht\b|withh/i,
  SCH_A: /payroll|paye|income tax|employ|salary|\btx\b/i,
  PENSION: /pension|pens\b/i,
  SCH_C: /profit|\bsch.?c\b|business income/i,
}

/**
 * How well each government bill fits a return: its amount matches (alone,
 * or payroll tax with pension), its description names the tax. Best first;
 * bills with nothing left are skipped.
 */
export function billFits(r: TaxReturn, bills: GovBill[], pair?: TaxReturn) {
  const target = returnAmount(r)
  const tol = (n: number) => Math.max(1, n * 0.005)
  const pairSum = pair ? target + returnAmount(pair) : null
  return bills
    .filter(b => b.left > 0.5 && !b.pays.some(p => p.id === r.id))
    .map(b => {
      const reasons: string[] = []
      let score = 0
      if (target > 0 && Math.abs(b.left - target) <= tol(target)) { score += 3; reasons.push('same amount') }
      else if (pairSum && Math.abs(b.left - pairSum) <= tol(pairSum)) { score += 3; reasons.push(`payroll tax and pension together`) }
      if (WORDS[r.code].test(b.description ?? '')) { score += 1; reasons.push(`mentions ${TAX_NAME[r.code].toLowerCase()}`) }
      return { bill: b, score, reasons }
    })
    .sort((a, b) => b.score - a.score || Date.parse(a.bill.date) - Date.parse(b.bill.date))
}
