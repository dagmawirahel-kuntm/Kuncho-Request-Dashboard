import type { UserRole } from '@/types/database'

// Mirrors the column list locked by the `enforce_expense_finance_fields`
// trigger in supabase/migrations/006_expense_workflow.sql, as extended by
// migration 098 to cover the payment-lifecycle columns — keep in sync.
export const FINANCE_ONLY_FIELDS = [
  'payment_status', 'paid_date', 'bank_ref', 'partially_paid',
  'partial_paid_amount', 'partial_payment_date', 'partial_payment_notes', 'total_payment_date',
  'account_id', 'transfer_id', 'tax_summary_id',
  'verify_wht', 'wht_handling_method', 'wht_fund',
  'payment_state', 'disbursed_by', 'payment_method',
] as const

export function canEditFinanceFields(role: UserRole | null) {
  return role === 'admin' || role === 'finance'
}

// The first-tier ("manager-level") approval on payroll, cash advances
// and sales. The role behind it was renamed manager -> executive in
// migration 149: Operations Manual v0.1 §12 lists no `manager` role at
// all, while §1/§6 require an Executive / CEO-MD tier that the schema
// previously lacked. Purely a rename — same holders (none yet), same
// scope — so nothing about who can approve what changed here.
//
// NOTE: purchase requests no longer call this. Manual §4.1's Materials
// chain has no PR approval step; that gate was retired in 149.
export function canApproveAsExecutive(role: UserRole | null) {
  return role === 'admin' || role === 'executive'
}

export function canApproveAsFinance(role: UserRole | null) {
  return role === 'admin' || role === 'finance'
}
