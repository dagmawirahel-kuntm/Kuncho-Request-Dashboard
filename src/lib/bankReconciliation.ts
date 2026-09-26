// Shapes and labels for bank reconciliation (migrations 341–343).

export type LineDirection = 'debit' | 'credit'

export type ReconciledAs =
  | 'batch' | 'expense' | 'sale' | 'payroll' | 'vrf' | 'vrf_return'
  | 'opening_balance' | 'internal' | 'classified'

interface LinkRef { id: string; label: string; amount: number }

/** A row of v_bank_line_status: a statement line and what it settles. */
export interface BankLine {
  line_id: string
  import_id: string
  account_id: string
  line_no: number
  value_date: string
  transaction_type: string | null
  narration: string | null
  reference: string | null
  reference_code: string | null
  debit_amount: number | null
  credit_amount: number | null
  running_balance: number | null
  transfer_id: string | null
  direction: LineDirection
  amount: number
  classification: string | null
  classification_note: string | null
  batch: LinkRef | null
  expenses: LinkRef[] | null
  sales: LinkRef[] | null
  payroll: LinkRef | null
  vrf: LinkRef | null
  internal: { account_id: string; account_name: string; source: string; line_id: string | null } | null
  reconciled_as: ReconciledAs | null
  linked_amount: number | null
}

export interface Suggestion {
  kind: 'expense' | 'batch' | 'vrf' | 'payroll' | 'sale' | 'internal_line' | 'internal_account' | 'purchase_order'
  target_id: string
  label: string
  detail: string | null
  amount: number | null
  target_date: string | null
  score: number
  reason: string
}

export interface AccountOverview {
  account_id: string
  account_name: string
  status: string | null
  type: string | null
  first_date: string | null
  last_date: string | null
  line_count: number
  open_count: number
  oldest_open: string | null
  statement_balance: number | null
  statement_date: string | null
  close_id: string | null
  closed_through: string | null
  closed_balance: number | null
  close_variance: number | null
  closed_at: string | null
  last_import_at: string | null
}

export const LINE_SELECT = '*'

// How a line with nothing on record behind it can be explained, by direction.
export const CLASSIFICATIONS: Record<LineDirection, { value: string; label: string; hint: string }[]> = {
  debit: [
    { value: 'bank_charge', label: 'Bank charge', hint: 'Service charges, commissions, SMS fees' },
    { value: 'withholding_tax', label: 'Withholding tax paid', hint: 'WHT paid over to the revenue office' },
    { value: 'payroll_tax', label: 'Payroll tax / pension paid', hint: 'Income tax or pension remitted' },
    { value: 'loan_repayment', label: 'Loan repayment', hint: 'Paying back a loan' },
    { value: 'owner_drawing', label: 'Owner withdrawal', hint: 'Money taken out by the owners' },
    { value: 'other_expense', label: 'Other expense', hint: 'Anything else paid out' },
  ],
  credit: [
    { value: 'other_income', label: 'Other income', hint: 'Interest and other income that isn\'t a sale' },
    { value: 'owner_injection', label: 'Owner contribution', hint: 'Money put in by the owners' },
    { value: 'loan_received', label: 'Loan received', hint: 'A loan paid into the account' },
    { value: 'vendor_refund', label: 'Refund from a vendor', hint: 'A supplier paying money back' },
    { value: 'wht_refund', label: 'Withholding tax refund', hint: 'WHT returned to Kuncho' },
  ],
}

export function classificationLabel(v: string | null | undefined): string {
  if (!v) return ''
  if (v === 'internal_transfer') return 'Transfer between accounts'
  const all = [...CLASSIFICATIONS.debit, ...CLASSIFICATIONS.credit]
  return all.find(c => c.value === v)?.label ?? v.replace(/_/g, ' ')
}

export const KIND_LABEL: Record<Suggestion['kind'] | ReconciledAs, string> = {
  expense: 'Expense', batch: 'Batch payment', vrf: 'Vendor request', payroll: 'Payroll', sale: 'Sale',
  internal_line: 'Transfer', internal_account: 'Transfer', purchase_order: 'Purchase order',
  vrf_return: 'Vendor request return', opening_balance: 'Opening balance', internal: 'Transfer', classified: 'Explained',
}

/** What a reconciled line settles, in words, with a link where there is one. */
export function describeReconciled(l: BankLine): { text: string; to: string | null }[] {
  switch (l.reconciled_as) {
    case 'batch': return l.batch ? [{ text: l.batch.label, to: `/batch-payments/${l.batch.id}` }] : []
    case 'expense': return (l.expenses ?? []).map(e => ({ text: e.label, to: `/expenses/${e.id}` }))
    case 'sale': return (l.sales ?? []).map(s => ({ text: s.label, to: `/sales/${s.id}` }))
    case 'payroll': return l.payroll ? [{ text: l.payroll.label, to: `/payroll/${l.payroll.id}` }] : []
    case 'vrf': return l.vrf ? [{ text: l.vrf.label, to: `/vendor-receipts/${l.vrf.id}` }] : []
    case 'internal': return [{ text: `${l.direction === 'credit' ? 'From' : 'To'} ${l.internal?.account_name ?? 'another account'}${l.internal?.source === 'counterpart' ? ' (its statement not imported yet)' : ''}`, to: null }]
    case 'classified': return [{ text: classificationLabel(l.classification) + (l.classification_note ? ` — ${l.classification_note}` : ''), to: null }]
    case 'vrf_return': return [{ text: 'Vendor request money returned', to: null }]
    case 'opening_balance': return [{ text: 'Opening balance', to: null }]
    default: return []
  }
}

/** A narration's words without the numbers that change from line to line —
 *  the starting point for a rule ("SERVICE CHARGE FOR 0012345" → "SERVICE CHARGE FOR"). */
export function ruleTextFrom(narration: string | null): string {
  return (narration ?? '').replace(/\d[\d,./-]*/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
}
