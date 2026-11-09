import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Government payments (506): the cost bucket that takes Government Expense,
// and its bills with the returns each pays. Read by the Taxes page and the
// bucket's own page.

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
