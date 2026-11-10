import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { isClearingParty, type BankLine, type LineParty } from '@/lib/bankReconciliation'

/**
 * Who on record the bank says a line paid or came from: the vendor, staff
 * member or client with that bank account, else that name. Null when the
 * statement names nobody, or only a clearing house such as the NBE.
 */
export function useLineParty(line: Pick<BankLine, 'line_id' | 'counterparty_name' | 'counterparty_account'>) {
  const named = !!(line.counterparty_name || line.counterparty_account) && !isClearingParty(line.counterparty_name)
  return useQuery({
    queryKey: ['bank-line-party', line.line_id],
    enabled: named,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<LineParty | null> => {
      const { data, error } = await supabase.rpc('bank_line_party', { p_line_id: line.line_id })
      if (error) throw error
      return ((data ?? []) as LineParty[])[0] ?? null
    },
  })
}
