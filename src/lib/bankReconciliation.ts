// Shapes and labels for bank reconciliation (migrations 344–346).

export type LineDirection = 'debit' | 'credit'

export type ReconciledAs =
  | 'batch' | 'expense' | 'sale' | 'payroll' | 'vrf' | 'vrf_return'
  | 'opening_balance' | 'internal' | 'classified'

interface LinkRef { id: string; label: string; amount: number }

/** Whether a yyyy-mm-dd date falls between from and to (either may be blank). */
export function inRange(date: string | null, from: string, to: string) {
  if (!from && !to) return true
  if (!date) return false
  return (!from || date >= from) && (!to || date <= to)
}

/** A row of v_bank_line_status: a statement line and what it settles. */
/** Open expenses that together add up to an outgoing bank line (452). */
export interface LineCombination {
  expense_ids: string[]
  total: number
  difference: number
  n: number
  same_vendor: boolean
  vendor_names: string | null
  codes: string | null
  score: number
}

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
  /** Who the bank says the line paid (debits) or came from (credits), when the statement names them. */
  counterparty_name: string | null
  counterparty_account: string | null
}

export interface Suggestion {
  kind: 'expense' | 'expense_part' | 'batch' | 'vrf' | 'vrf_part' | 'payroll' | 'sale' | 'internal_line' | 'internal_account' | 'purchase_order' | 'bank_charge'
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
    { value: 'refund_paid', label: 'Refund paid back', hint: 'Returning money received by mistake (clears "Refund owed")' },
  ],
  credit: [
    { value: 'other_income', label: 'Other income', hint: 'Interest and other income that isn\'t a sale' },
    { value: 'owner_injection', label: 'Owner contribution', hint: 'Money put in by the owners' },
    { value: 'loan_received', label: 'Loan received', hint: 'A loan paid into the account' },
    { value: 'vendor_refund', label: 'Refund from a vendor', hint: 'A supplier paying money back' },
    { value: 'wht_refund', label: 'Withholding tax refund', hint: 'WHT returned to Kuncho' },
    { value: 'refund_owed', label: 'Received by mistake', hint: 'A wrong payer or a double payment, to be paid back — held as a refund owed' },
  ],
}

export function classificationLabel(v: string | null | undefined): string {
  if (!v) return ''
  if (v === 'internal_transfer') return 'Transfer between accounts'
  const all = [...CLASSIFICATIONS.debit, ...CLASSIFICATIONS.credit]
  return all.find(c => c.value === v)?.label ?? v.replace(/_/g, ' ')
}

export const KIND_LABEL: Record<Suggestion['kind'] | ReconciledAs, string> = {
  expense: 'Expense', expense_part: 'Part of a bill', batch: 'Batch payment', vrf: 'Vendor request', vrf_part: 'Vendor request part', payroll: 'Payroll', sale: 'Sale',
  internal_line: 'Transfer', internal_account: 'Transfer', purchase_order: 'Purchase order', bank_charge: 'Bank charge',
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

type Named = Pick<BankLine, 'counterparty_name' | 'narration' | 'transaction_type' | 'reference'>

/**
 * What a line is called in a list: who the bank says it paid or came from,
 * else its narration. A clearing house (the NBE for transfers to other banks)
 * isn't who was paid, so such a line goes by its transaction type.
 */
export function lineTitle(l: Named): string {
  if (l.counterparty_name && isClearingParty(l.counterparty_name)) return l.transaction_type || l.narration || '—'
  return l.counterparty_name || l.narration || l.transaction_type || '—'
}

/** The rest of what the bank says about a line, for the small text under its title. */
export function lineSubtitle(l: Named): string {
  const title = lineTitle(l)
  const via = l.counterparty_name && isClearingParty(l.counterparty_name) ? `via ${l.counterparty_name}` : null
  return [via, l.narration, l.transaction_type, l.reference]
    .filter((v, i, all): v is string => !!v && v !== title && all.indexOf(v) === i)
    .join(' · ')
}

/** A bank, clearing house or wallet the money passed through, not who it was for (506, bank_party_clearing). */
export function isClearingParty(name: string | null | undefined): boolean {
  return /(national bank of ethiopia|\bnbe\b|e[ -]?money|depository|telebirr|inter ?bank|\bcpo|rtgs|settlement|\bswitch\b|payable account|payable$)/i.test(name ?? '')
}

/** The vendor, staff member or client a line's other party is on record as (bank_line_party, 506). */
export interface LineParty {
  kind: 'vendor' | 'staff' | 'client'
  id: string
  name: string
  /** Matched on their bank account, or on the name alone. */
  how: 'account' | 'name'
}
