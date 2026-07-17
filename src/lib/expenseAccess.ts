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

export function canApproveAsManager(role: UserRole | null) {
  return role === 'admin' || role === 'manager'
}

export function canApproveAsFinance(role: UserRole | null) {
  return role === 'admin' || role === 'finance'
}
