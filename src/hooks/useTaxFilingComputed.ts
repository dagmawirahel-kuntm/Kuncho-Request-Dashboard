import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { TaxFilingComputed } from '@/types/database'

/**
 * What each filing in a fiscal year should declare, computed from sales,
 * receipts, expenses and payroll by tax_filing_computed() (migration 313),
 * keyed by filing id.
 *
 * The function returns aggregates only and refuses callers outside the tax
 * read set, so this is only enabled for people who can see Tax Filings.
 */
export function useTaxFilingComputed(fiscalPeriodId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ['tax-filing-computed', fiscalPeriodId ?? null],
    enabled: enabled && !!fiscalPeriodId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('tax_filing_computed', { p_fiscal_period_id: fiscalPeriodId })
      if (error) throw error
      return new Map((data as TaxFilingComputed[]).map(c => [c.filing_id, c]))
    },
  })
}

/** Human labels for the figures in tax_filing_computed()'s basis. */
export const BASIS_LABEL: Record<string, string> = {
  output_vat: 'Output VAT on sales',
  input_vat: 'Input VAT from tax-reviewed receipts',
  input_vat_pending_review: 'Input VAT flagged, awaiting review',
  sale_count: 'Sales in period',
  reviewed_receipt_count: 'Tax-reviewed receipts',
  paid_expense_count: 'Paid vendor payments with WHT',
  pending_expense_count: 'Unpaid vendor payments with WHT',
  wht_pending_unpaid: 'WHT on unpaid payments (not yet withheld)',
  payroll_runs: 'Payroll runs in period',
  paid_staff_count: 'Staff paid',
  net_paid: 'Net paid (agreed take-home)',
  gross_paid: 'Gross (grossed up from net)',
  net_unpaid: 'Net on unpaid runs',
  paye_incl_unpaid: 'PAYE if unpaid runs are paid',
  employee_share: 'Employee pension (7%)',
  employer_share: 'Employer pension (11%)',
  schedule_employees: 'Employees in declaration schedule',
  client_wht_credits_expected: 'WHT clients should withhold (credit)',
  deductible_expenses: 'Deductible expenses (Government Statement)',
}

/** Basis keys that are counts rather than money. */
export const BASIS_COUNT_KEYS = new Set([
  'sale_count', 'reviewed_receipt_count', 'paid_expense_count',
  'pending_expense_count', 'payroll_runs', 'paid_staff_count', 'schedule_employees',
])
