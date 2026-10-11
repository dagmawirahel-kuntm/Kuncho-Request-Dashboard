import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Tone } from '@/components/record/Record'
import type { ApprovalQueueRow } from '@/lib/expenseQuality'
import { EXPENSE_TYPE_THEME } from '@/lib/expenseTypeTheme'
import type { ExpenseType } from '@/types/database'

// What an approver needs to decide (migration 444): what approving each bill
// does, what is odd about it, what the cash can bear — and a question to
// whoever raised it, instead of a reject.

/** v_approval_context: one row per bill waiting for approval. */
export interface ApprovalContextRow {
  expense_id: string
  spot_paid: boolean
  spot_paid_by: string | null
  spot_paid_by_name: string | null
  spot_paid_at: string | null
  spot_paid_method: string | null
  bank_line_id: string | null
  bank_line_date: string | null
  bank_line_amount: number | null
  bank_line_ref: string | null
  payee_paid_count: number
  payee_paid_total: number
  payee_typical_amount: number | null
  payee_last_paid_on: string | null
  vendor_verification: string | null
  bundle_code: string | null
  payment_pattern: string | null
  po_status: string | null
  delivered_on: string | null
  contract_value: number | null
  project_spent: number
  project_approved_unpaid: number
  project_waiting: number
  question_id: string | null
  question: string | null
  asked_by_name: string | null
  asked_at: string | null
  answer: string | null
  answered_by_name: string | null
  answered_at: string | null
}

export function useApprovalContext() {
  return useQuery({
    queryKey: ['approval-context'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_approval_context').select('*')
      if (error) throw error
      return new Map(((data ?? []) as ApprovalContextRow[]).map(r => [r.expense_id, r]))
    },
  })
}

/** A question asked about an expense, and its answer. */
export interface ExpenseQuestion {
  id: string
  expense_id: string
  question: string
  asked_by: string
  asked_by_name: string | null
  asked_at: string
  answer: string | null
  answered_by: string | null
  answered_by_name: string | null
  answered_at: string | null
}

export function useExpenseQuestions(expenseId: string | null | undefined) {
  return useQuery({
    queryKey: ['expense-questions', expenseId],
    enabled: !!expenseId,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_expense_questions').select('*').eq('expense_id', expenseId!).order('asked_at')
      if (error) throw error
      return (data ?? []) as ExpenseQuestion[]
    },
  })
}

// ── Can the cash bear it ─────────────────────────────────────────────────────
export interface CashCover {
  /** What the books show in the bank accounts. */
  banks: number
  /** Held in wallets and personal accounts, not counted against the queue. */
  wallets: number
  /** Sent from the banks and not yet out of the books' balance. */
  sent: number
  /** Approved and waiting to be paid. */
  approved: number
  approvedCount: number
}

export function useCashCover() {
  return useQuery({
    queryKey: ['approval-cash-cover'],
    staleTime: 60_000,
    queryFn: async (): Promise<CashCover> => {
      const [acc, pay] = await Promise.all([
        supabase.from('v_account_control').select('role, type, app_balance, awaiting_bank_amount, not_opened'),
        supabase.from('v_to_pay_queue').select('cash_to_send'),
      ])
      if (acc.error) throw acc.error
      if (pay.error) throw pay.error
      const rows = (acc.data ?? []) as { role: string | null; type: string | null; app_balance: number | null; awaiting_bank_amount: number | null; not_opened: boolean }[]
      const isBank = (r: { role: string | null; type: string | null }) =>
        r.role === 'main' || r.role === 'collection' || (r.type ?? '').toLowerCase().includes('bank')
      const open = rows.filter(r => !r.not_opened)
      const banks = open.filter(isBank)
      return {
        banks: banks.reduce((s, r) => s + Number(r.app_balance ?? 0), 0),
        wallets: open.filter(r => r.role === 'wallet').reduce((s, r) => s + Math.max(0, Number(r.app_balance ?? 0)), 0),
        sent: banks.reduce((s, r) => s + Number(r.awaiting_bank_amount ?? 0), 0),
        approved: ((pay.data ?? []) as { cash_to_send: number | null }[]).reduce((s, r) => s + Number(r.cash_to_send ?? 0), 0),
        approvedCount: (pay.data ?? []).length,
      }
    },
  })
}

// ── What is worth knowing about a bill ──────────────────────────────────────
export type Signal = 'answered' | 'paid_already' | 'unverified' | 'unusual' | 'first_payment' | 'waits_delivery' | 'asked' | 'mine'

export const SIGNAL_META: Record<Signal, { label: string; tone: Tone; help: string }> = {
  answered:       { label: 'Answered', tone: 'violet', help: 'You asked; the requester answered — decide now' },
  paid_already:   { label: 'Paid already', tone: 'green', help: 'Paid at the gate or already on the bank statement — approving puts it in the books' },
  unverified:     { label: 'Unverified bank details', tone: 'red', help: 'The vendor’s bank details have not been checked by a second person' },
  unusual:        { label: 'Unusual amount', tone: 'amber', help: 'Three times or more what this payee is usually paid' },
  first_payment:  { label: 'First payment', tone: 'amber', help: 'This vendor has not been paid in the last year' },
  waits_delivery: { label: 'Waits for delivery', tone: 'blue', help: 'Paid on delivery and not delivered yet — it can’t be paid until the goods arrive' },
  asked:          { label: 'Asked', tone: 'blue', help: 'Waiting for the requester to answer your question' },
  mine:           { label: 'Raised by you', tone: 'slate', help: 'You raised it — better approved by someone else' },
}
export const SIGNAL_ORDER: Signal[] = ['answered', 'paid_already', 'unverified', 'unusual', 'first_payment', 'waits_delivery', 'asked', 'mine']

/** How many times its usual amount a bill is, when the payee has a track record. */
export function timesUsual(r: ApprovalQueueRow, c: ApprovalContextRow | undefined): number | null {
  if (!c || c.payee_paid_count < 3 || !c.payee_typical_amount || Number(c.payee_typical_amount) <= 0) return null
  return Number(r.amount_etb ?? 0) / Number(c.payee_typical_amount)
}

export function signalsOf(r: ApprovalQueueRow, c: ApprovalContextRow | undefined, me: string | null): Signal[] {
  const out: Signal[] = []
  if (c?.question_id && c.answered_at) out.push('answered')
  if (c && (c.spot_paid || c.bank_line_id)) out.push('paid_already')
  if (c?.vendor_verification === 'pending_verification') out.push('unverified')
  if ((timesUsual(r, c) ?? 0) >= 3) out.push('unusual')
  if (c && r.vendor_id && c.payee_paid_count === 0) out.push('first_payment')
  if (c?.bundle_code && c.payment_pattern !== 'pay_in_advance' && !c.delivered_on) out.push('waits_delivery')
  if (c?.question_id && !c.answered_at) out.push('asked')
  if (me && r.purchaser_user_id === me) out.push('mine')
  return out
}

// ── Grouping the queue ──────────────────────────────────────────────────────
export type GroupBy = 'age' | 'project' | 'payee' | 'requester' | 'type'
export const GROUP_BY_LABEL: Record<GroupBy, string> = {
  age: 'Age', project: 'Project', payee: 'Payee', requester: 'Who raised it', type: 'What it is',
}

export function groupKey(r: ApprovalQueueRow, by: Exclude<GroupBy, 'age'>): { key: string; label: string } {
  switch (by) {
    case 'project': return r.project_id ? { key: r.project_id, label: r.project_name ?? 'Project' }
      : { key: r.is_overhead ? 'overhead' : 'none', label: r.is_overhead ? 'Company overhead' : 'No project' }
    case 'payee': return { key: (r.vendor_id ?? r.payee_name ?? 'none').toLowerCase(), label: r.payee_name ?? 'No payee' }
    case 'requester': return { key: r.purchaser_user_id ?? 'none', label: r.requested_by_name ?? 'Not recorded' }
    case 'type': return { key: r.expense_type, label: EXPENSE_TYPE_THEME[r.expense_type as ExpenseType]?.label ?? r.expense_type }
  }
}
