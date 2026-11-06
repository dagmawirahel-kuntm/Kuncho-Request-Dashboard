import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Which bank transaction locks an expense (migration 501).

export interface ExpenseBankLock {
  how: 'direct' | 'batch' | 'part' | 'vrf'
  via: string | null
  line_id: string
  account_id: string
  account_name: string
  value_date: string
  amount: number
  reference: string | null
  narration: string | null
  period_closed: boolean
}

/** The first locking line of a locked expense, for lists. */
export interface ExpenseBankLockSummary {
  expense_id: string
  how: ExpenseBankLock['how']
  n: number
  account_name: string
  value_date: string
  amount: number
  reference: string | null
}

export const LOCK_HOW: Record<ExpenseBankLock['how'], string> = {
  direct: 'Paid directly',
  batch: 'Paid in a batch',
  part: 'Paid in parts',
  vrf: 'Paid through its vendor request',
}

/** Where a locking line opens: on the bank statement, among the reconciled lines, with its "Undo match". */
export const bankLineHref = (l: { account_id: string; line_id: string }) =>
  `/bank-statement-import?tab=queue&account=${l.account_id}&line=${l.line_id}&done=1`

/** Every locked expense, by id (admin, finance and executives; empty for others). */
export function useExpenseBankLockIndex(enabled: boolean) {
  return useQuery({
    queryKey: ['expense-bank-lock-index'],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('expense_bank_lock_index')
      if (error) throw error
      return new Map(((data ?? []) as ExpenseBankLockSummary[]).map(r => [r.expense_id, r]))
    },
  })
}
