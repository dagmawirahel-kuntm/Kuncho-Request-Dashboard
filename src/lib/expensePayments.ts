import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type {
  ExpensePartDueOn, ExpensePartKind, ExpensePartState, ExpensePaymentPart, ExpenseWhtMode, PoPlanPart,
} from '@/types/database'

// Payments in parts (migration 430).
//
// One expense, many payments. The parts always add up to the bill (its amount
// less any vendor credit); finance approves the bill once and each part only
// needs a payer who is not the approver. Withholding is a choice per bill:
// all of it from the last part, or a share from each part by size. Each part
// goes planned → sent → paid (bank line, or cash confirmed), posts its own
// entry in the books and can carry its own Payment Request.

export const PART_KIND_LABEL: Record<ExpensePartKind, string> = {
  advance: 'Advance',
  installment: 'Installment',
  on_delivery: 'On delivery',
  final: 'Final',
  retention: 'Retention',
}

export const PART_STATE_LABEL: Record<ExpensePartState, string> = {
  planned: 'Planned', sent: 'Sent', paid: 'Paid', cancelled: 'Replaced',
}

export const WHT_MODE_LABEL: Record<ExpenseWhtMode, { short: string; long: string }> = {
  last: { short: 'From the last payment', long: 'All of the withholding is taken from the last payment; the earlier ones go out in full.' },
  each: { short: 'From each payment', long: 'Each payment carries its share of the withholding, in proportion to its size.' },
}

/** One row of a plan being edited. Amounts are birr, or percent for a PO plan. */
export interface PlanRow {
  key: string
  value: number | null
  kind: ExpensePartKind
  due_on: ExpensePartDueOn
  due_date: string | null
  days: number | null
  label: string
}

export interface PlanPreset { id: string; name: string; parts: { pct: number; kind: ExpensePartKind; due_on: ExpensePartDueOn; days?: number }[] }

/** Common splits. "On delivery" parts are only offered for purchase orders. */
export const PLAN_PRESETS: PlanPreset[] = [
  { id: '50-50', name: '50 / 50', parts: [
    { pct: 50, kind: 'advance', due_on: 'now' }, { pct: 50, kind: 'final', due_on: 'date' }] },
  { id: '30-70', name: '30 / 70', parts: [
    { pct: 30, kind: 'advance', due_on: 'now' }, { pct: 70, kind: 'final', due_on: 'date' }] },
  { id: '30-60-10', name: '30 / 60 / 10', parts: [
    { pct: 30, kind: 'advance', due_on: 'now' }, { pct: 60, kind: 'installment', due_on: 'date' },
    { pct: 10, kind: 'retention', due_on: 'date' }] },
  { id: '3x', name: 'Three equal', parts: [
    { pct: 33.34, kind: 'installment', due_on: 'now' }, { pct: 33.33, kind: 'installment', due_on: 'date' },
    { pct: 33.33, kind: 'final', due_on: 'date' }] },
]

export const PO_PLAN_PRESETS: PlanPreset[] = [
  { id: 'adv-del', name: '40 now / 60 on delivery', parts: [
    { pct: 40, kind: 'advance', due_on: 'now' }, { pct: 60, kind: 'on_delivery', due_on: 'delivery' }] },
  { id: 'adv-del-ret', name: '30 now / 60 on delivery / 10 after 30 days', parts: [
    { pct: 30, kind: 'advance', due_on: 'now' }, { pct: 60, kind: 'on_delivery', due_on: 'delivery' },
    { pct: 10, kind: 'retention', due_on: 'delivery', days: 30 }] },
  { id: 'del-ret', name: '90 on delivery / 10 after 30 days', parts: [
    { pct: 90, kind: 'on_delivery', due_on: 'delivery' }, { pct: 10, kind: 'retention', due_on: 'delivery', days: 30 }] },
  { id: '50-50', name: '50 now / 50 on delivery', parts: [
    { pct: 50, kind: 'advance', due_on: 'now' }, { pct: 50, kind: 'on_delivery', due_on: 'delivery' }] },
]

let rowSeq = 0
export const newRowKey = () => `r${++rowSeq}`

/** Birr amounts for a preset over `total`; the last part takes the rounding. */
export function presetRows(preset: PlanPreset, total: number, asPercent = false): PlanRow[] {
  let left = Math.round(total * 100) / 100
  return preset.parts.map((p, i) => {
    const last = i === preset.parts.length - 1
    const amt = asPercent ? p.pct : last ? left : Math.round(total * p.pct) / 100
    if (!asPercent) left = Math.round((left - amt) * 100) / 100
    return { key: newRowKey(), value: amt, kind: p.kind, due_on: p.due_on, due_date: null, days: p.days ?? null, label: '' }
  })
}

/** Withholding per planned row, the way the database places it. */
export function previewWht(values: number[], whtLeft: number, mode: ExpenseWhtMode): number[] {
  if (!values.length || whtLeft <= 0) return values.map(() => 0)
  if (mode === 'last') return values.map((_, i) => (i === values.length - 1 ? whtLeft : 0))
  const sum = values.reduce((s, v) => s + v, 0)
  let acc = 0
  return values.map((v, i) => {
    const w = i === values.length - 1 ? Math.round((whtLeft - acc) * 100) / 100 : Math.round((whtLeft * v / (sum || 1)) * 100) / 100
    acc += w
    return w
  })
}

/** "Due now", "Due 12 Nov", "On delivery + 30 days", "Waits for the GRN". */
export function partDueText(p: Pick<ExpensePaymentPart, 'due_on' | 'due_date' | 'due_days' | 'due_by' | 'grn_date' | 'state'>,
  fmt: (d: string) => string): string {
  if (p.state !== 'planned') return ''
  if (p.due_on === 'now') return 'Due now'
  if (p.due_on === 'date') return p.due_date ? `Due ${fmt(p.due_date)}` : 'No date set'
  if (!p.grn_date) return p.due_days ? `${p.due_days} days after delivery · waits for the GRN` : 'On delivery · waits for the GRN'
  return p.due_by ? `Due ${fmt(p.due_by)}${p.due_days ? ` (${p.due_days} days after delivery)` : ' (delivered)'}` : 'On delivery'
}

export function useExpenseParts(expenseId: string | null | undefined) {
  return useQuery({
    queryKey: ['expense-parts', expenseId],
    enabled: !!expenseId,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_expense_payments').select('*').eq('expense_id', expenseId!).order('seq')
      if (error) throw error
      return (data ?? []) as ExpensePaymentPart[]
    },
  })
}

/** Sent cash (and "other") parts waiting for someone to confirm them. */
export function useSentCashParts(enabled = true) {
  return useQuery({
    queryKey: ['expense-parts-sent-cash'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_expense_payments').select('*')
        .eq('state', 'sent').in('payment_method', ['cash', 'other']).order('sent_at')
      if (error) throw error
      return (data ?? []) as ExpensePaymentPart[]
    },
  })
}

export function useRefreshParts() {
  const qc = useQueryClient()
  return (expenseId?: string | null) => {
    qc.invalidateQueries({ queryKey: ['expense-parts', ...(expenseId ? [expenseId] : [])] })
    qc.invalidateQueries({ queryKey: ['expense-parts-sent-cash'] })
    qc.invalidateQueries({ queryKey: ['expense-detail'] })
    for (const k of ['v-to-pay-queue', 'v-awaiting-bank-confirmation', 'v-recent-payments', 'expenses', 'payment-requests']) {
      qc.invalidateQueries({ queryKey: [k] })
    }
  }
}

export async function savePlan(expenseId: string, rows: PlanRow[], whtMode: ExpenseWhtMode) {
  const { error } = await supabase.rpc('set_expense_payment_plan', {
    p_expense_id: expenseId,
    p_parts: rows.map(r => ({
      amount: r.value, kind: r.kind, due_on: r.due_on, due_date: r.due_on === 'date' ? r.due_date : null,
      days: r.due_on === 'delivery' ? r.days : null, label: r.label.trim() || null,
    })),
    p_wht_mode: whtMode,
  })
  if (error) throw new Error(error.message)
}

export async function savePoPlan(bundleId: string, rows: PlanRow[] | null, whtMode: ExpenseWhtMode) {
  const plan: PoPlanPart[] | null = rows && rows.length
    ? rows.map(r => ({ pct: Number(r.value ?? 0), kind: r.kind, due_on: r.due_on === 'date' ? 'now' : r.due_on,
                       days: r.due_on === 'delivery' ? r.days : null, label: r.label.trim() || null }))
    : null
  const { error } = await supabase.from('sourcing_bundles').update({ payment_plan: plan, plan_wht_mode: whtMode }).eq('id', bundleId)
  if (error) throw new Error(error.message)
}
