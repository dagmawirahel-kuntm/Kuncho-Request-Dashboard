import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// The tax hub (/taxes, 506): each tax program's "what needs doing", read
// with the same tables and views the program's own page reads, so row-level
// security decides what each person sees. Each query runs only for someone
// who can open that program.

const DUE_SOON_DAYS = 14

export interface FilingDue {
  id: string; display_label: string | null; schedule_code: string; period_label: string | null
  due_date_greg: string; status: string; is_overdue: boolean
}

/** Returns not yet acknowledged that are late or due in the next two weeks. */
export function useFilingsDue(enabled: boolean) {
  return useQuery({
    queryKey: ['tax-hub', 'filings-due'],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const cutoff = new Date(Date.now() + DUE_SOON_DAYS * 864e5).toISOString().slice(0, 10)
      const { data, error } = await supabase.from('v_tax_filings')
        .select('id, display_label, schedule_code, period_label, due_date_greg, status, is_overdue')
        .neq('status', 'acknowledged').not('due_date_greg', 'is', null).lte('due_date_greg', cutoff)
        .order('due_date_greg')
      if (error) throw error
      return (data ?? []) as FilingDue[]
    },
  })
}

export interface VatNow {
  period_label: string; net_vat: number; position: string; needs_receipt_count: number
  input_vat_needs_receipt: number; in_review_count: number; pending_review_count: number; vat_filing_status: string | null
}

/** This month's VAT position (the VAT Receipt Tracker's top row). */
export function useVatNow(enabled: boolean) {
  return useQuery({
    queryKey: ['tax-hub', 'vat-now'],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_vat_position_by_ec_period')
        .select('period_label, net_vat, position, needs_receipt_count, input_vat_needs_receipt, in_review_count, pending_review_count, vat_filing_status')
        .eq('is_current', true).maybeSingle()
      if (error) throw error
      return data as VatNow | null
    },
  })
}

/** Vendor tax receipts by the step they wait at. */
export function useReceiptSteps(enabled: boolean) {
  return useQuery({
    queryKey: ['tax-hub', 'receipt-steps'],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('vendor_receipts').select('status')
        .in('status', ['pending_verification', 'verified'])
      if (error) throw error
      const rows = (data ?? []) as { status: string }[]
      return {
        toVerify: rows.filter(r => r.status === 'pending_verification').length,
        withTaxOfficer: rows.filter(r => r.status === 'verified').length,
      }
    },
  })
}

/** This fiscal year's Government Expense Statement, in total. */
export function useGovStatementYear(enabled: boolean) {
  return useQuery({
    queryKey: ['tax-hub', 'gov-statement'],
    enabled,
    staleTime: 300_000,
    queryFn: async () => {
      const { data: fy, error: e1 } = await supabase.from('fiscal_periods').select('id, label').eq('is_current', true).maybeSingle()
      if (e1) throw e1
      if (!fy) return null
      const { data, error } = await supabase.from('v_government_expense_statement_by_ec_period')
        .select('amount, line_count').eq('fiscal_period_id', fy.id)
      if (error) throw error
      const rows = (data ?? []) as { amount: number; line_count: number }[]
      return {
        label: fy.label as string,
        amount: rows.reduce((s, r) => s + Number(r.amount ?? 0), 0),
        lines: rows.reduce((s, r) => s + Number(r.line_count ?? 0), 0),
      }
    },
  })
}

/** The cost bucket government payments go to (506): the one taking Government Expense. */
export function useTaxBucket() {
  return useQuery({
    queryKey: ['tax-bucket'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('tax_bucket')
      if (error) throw error
      return (data ?? null) as string | null
    },
  })
}

export interface GovPayment {
  id: string; expense_code: string | null; date: string; description: string | null; amount: number; payee: string | null
  approval_status: string; payment_state: string | null
}
export interface FilingPaid {
  id: string; schedule_code: string; period_label: string | null; paid_amount: number; payment_date: string | null
  paid_by_expense_id: string | null; paid_from_account_id: string | null; account: { account_name: string } | null
}

/**
 * What was paid to the government: the bucket's bills, and each return's
 * payment as Tax Filings records it, so a bill shows the return it paid.
 */
export function useGovernmentPayments(bucket: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['tax-hub', 'payments', bucket],
    enabled: enabled && !!bucket,
    queryFn: async () => {
      const [bills, filings] = await Promise.all([
        supabase.rpc('bucket_recent', { p_project: bucket, p_limit: 40 }),
        supabase.from('tax_filings')
          .select('id, schedule_code, period_label, paid_amount, payment_date, paid_by_expense_id, paid_from_account_id, account:accounts!paid_from_account_id(account_name)')
          .gt('paid_amount', 0).order('payment_date', { ascending: false }),
      ])
      if (bills.error) throw bills.error
      return {
        bills: ((bills.data ?? []) as GovPayment[]).filter(b => b.approval_status !== 'bank'),
        // A person who can't read returns still sees the bills.
        filings: filings.error ? [] : (filings.data ?? []) as unknown as FilingPaid[],
      }
    },
  })
}

export const SCHEDULE_LABEL: Record<string, string> = {
  VAT: 'VAT', WHT: 'Withholding', SCH_A: 'Payroll tax', PENSION: 'Pension', SCH_C: 'Profit tax',
}

/** "today", "tomorrow", "in 5 days", "3 days late". */
export function dueText(iso: string) {
  const t = new Date()
  const days = Math.round((Date.parse(`${iso}T00:00:00`) - new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()) / 864e5)
  if (days === 0) return 'due today'
  if (days === 1) return 'due tomorrow'
  if (days > 1) return `due in ${days} days`
  return `${-days} day${days === -1 ? '' : 's'} late`
}
