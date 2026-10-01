import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { VAT_RATE } from '@/lib/poTax'
import type { Tone } from '@/components/record/Record'

// Expenses that arrive complete (migration 395): what can be missing on
// one, the approval queue, and the checks the form runs before saving —
// the same rules the database enforces, said before the save rather than
// after it.

/** The project picker's "no project, on purpose" choice. */
export const OVERHEAD = '__overhead__'

export type ExpenseIssue =
  | 'no_project' | 'no_ledger' | 'no_payee' | 'typed_payee' | 'vague_ledger'
  | 'no_receipt' | 'no_bank_ref' | 'possible_duplicate'

export const ISSUE: Record<ExpenseIssue, { label: string; hint: string; tone: Tone; blocksApproval?: boolean; dismissable?: boolean }> = {
  no_project:   { label: 'No project', hint: 'Pick the project, or mark it company overhead.', tone: 'red', blocksApproval: true },
  no_ledger:    { label: 'No ledger', hint: 'Nothing to post the cost to — pick a general ledger.', tone: 'red', blocksApproval: true },
  no_payee:     { label: 'No payee', hint: 'Nobody is named as paid.', tone: 'red' },
  typed_payee:  { label: 'Payee typed in', hint: 'Named in free text — link the vendor so it counts on their statement.', tone: 'amber', dismissable: true },
  vague_ledger: { label: 'Vague ledger', hint: 'Filed under Multiple or Petty — one ledger would say what it was.', tone: 'amber', dismissable: true },
  no_receipt:   { label: 'No receipt', hint: 'Paid, with no receipt photo — VAT on it cannot be claimed.', tone: 'amber', dismissable: true },
  no_bank_ref:  { label: 'No bank ref', hint: 'Paid by transfer with no bank reference.', tone: 'amber' },
  possible_duplicate: { label: 'Possible duplicate', hint: 'Same payee and amount within 3 days of another expense.', tone: 'violet', dismissable: true },
}

export const ISSUE_ORDER: ExpenseIssue[] = ['no_project', 'no_ledger', 'no_payee', 'possible_duplicate', 'typed_payee', 'no_receipt', 'no_bank_ref', 'vague_ledger']

export interface ExpenseIssueRow {
  id: string
  expense_code: string | null
  date: string
  created_at: string
  amount_etb: number
  expense_type: string
  item_service_description: string | null
  project_id: string | null
  project_name: string | null
  is_overhead: boolean
  category_id: string | null
  category_name: string | null
  vendor_id: string | null
  vendor_name: string | null
  vendors_name: string | null
  paid_to_staff_id: string | null
  approval_status: string
  payment_state: string | null
  payment_method: string | null
  receipt_url: string | null
  bank_ref: string | null
  purchaser_user_id: string | null
  sourcing_bundle_id: string | null
  issues: ExpenseIssue[]
}

export interface ApprovalQueueRow {
  id: string
  expense_code: string | null
  date: string
  created_at: string
  age_days: number
  amount_etb: number
  expense_type: string
  item_service_description: string | null
  project_id: string | null
  project_name: string | null
  is_overhead: boolean
  category_id: string | null
  category_name: string | null
  vendor_id: string | null
  payee_name: string | null
  purchaser_user_id: string | null
  requested_by_name: string | null
  receipt_url: string | null
  approval_status: string
  issues: ExpenseIssue[]
}

export function useExpenseIssues() {
  return useQuery({
    queryKey: ['expense-issues'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_expense_issues').select('*').order('date', { ascending: false })
      if (error) throw error
      return (data ?? []) as ExpenseIssueRow[]
    },
  })
}

export function useApprovalQueue() {
  return useQuery({
    queryKey: ['expense-approval-queue'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_expense_approval_queue').select('*').order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as ApprovalQueueRow[]
    },
  })
}

/** Age buckets for the queue: what a reader acts on first. */
export const AGE_BUCKETS = [
  { key: 'old', label: 'Over 2 weeks', min: 15, tone: 'red' as Tone },
  { key: 'week', label: '1–2 weeks', min: 8, tone: 'amber' as Tone },
  { key: 'new', label: 'This week', min: 0, tone: 'slate' as Tone },
]
export const ageBucket = (days: number) => AGE_BUCKETS.find(b => days >= b.min) ?? AGE_BUCKETS[AGE_BUCKETS.length - 1]

/** The VAT inside a VAT-inclusive total, as the receipt would print it. */
export const vatInside = (gross: number) => Math.round((gross * VAT_RATE / (1 + VAT_RATE)) * 100) / 100

// The project picker value <-> the two columns it stands for.
export const projectChoice = (projectId: string | null | undefined, isOverhead: boolean | null | undefined) =>
  projectId ?? (isOverhead ? OVERHEAD : null)
export const fromProjectChoice = (v: string | null) =>
  v === OVERHEAD ? { project_id: null, is_overhead: true } : { project_id: v, is_overhead: false }

/** What the expense form checks before it saves. Keys are the fields. */
export function expenseFormProblems(f: {
  item_service_description?: string | null
  amount_etb?: number | null
  date?: string | null
  expense_type?: string | null
  project_id?: string | null
  is_overhead?: boolean | null
  vendor_id?: string | null
  paid_to_staff_id?: string | null
  vendors_name?: string | null
  receipt_url?: string | null
  receipt_is_vat?: boolean | null
  receipt_vat_amount?: number | null
}, isNew: boolean): Partial<Record<'description' | 'amount' | 'date' | 'project' | 'payee' | 'receipt_vat', string>> {
  const out: Partial<Record<'description' | 'amount' | 'date' | 'project' | 'payee' | 'receipt_vat', string>> = {}
  if (!f.item_service_description?.trim()) out.description = 'Say what it was for'
  if (f.amount_etb == null || Number(f.amount_etb) <= 0) out.amount = 'Enter the amount'
  if (!f.date) out.date = 'Enter the date'
  const typedIn = (f.expense_type ?? 'general') === 'general'
  if (isNew && typedIn && !f.project_id && !f.is_overhead) out.project = 'Pick the project, or company overhead'
  if (isNew && typedIn && !f.vendor_id && !f.paid_to_staff_id && !f.vendors_name?.trim()) out.payee = 'Say who is paid'
  if (f.receipt_is_vat && f.receipt_vat_amount != null && f.amount_etb != null && Number(f.receipt_vat_amount) > Number(f.amount_etb)) {
    out.receipt_vat = 'The VAT cannot be more than the total'
  }
  return out
}

/** Other expenses to the same payee for the same amount within 3 days. */
export async function findPossibleDuplicates(f: {
  id?: string; amount_etb?: number | null; date?: string | null
  vendor_id?: string | null; paid_to_staff_id?: string | null; vendors_name?: string | null
}) {
  if (!f.amount_etb || !f.date) return []
  const d = new Date(f.date)
  const from = new Date(d.getTime() - 3 * 86_400_000).toISOString().slice(0, 10)
  const to = new Date(d.getTime() + 3 * 86_400_000).toISOString().slice(0, 10)
  let q = supabase.from('expenses').select('id, expense_code, date, amount_etb, item_service_description')
    .eq('amount_etb', f.amount_etb).gte('date', from).lte('date', to).eq('is_archived', false).limit(5)
  if (f.vendor_id) q = q.eq('vendor_id', f.vendor_id)
  else if (f.paid_to_staff_id) q = q.eq('paid_to_staff_id', f.paid_to_staff_id)
  else if (f.vendors_name?.trim()) q = q.ilike('vendors_name', f.vendors_name.trim())
  else return []
  if (f.id) q = q.neq('id', f.id)
  const { data } = await q
  return (data ?? []) as { id: string; expense_code: string | null; date: string; amount_etb: number; item_service_description: string | null }[]
}
