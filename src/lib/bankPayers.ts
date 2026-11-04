import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface Payer { id: string; full_name: string | null }

/** Admin and finance users: who can make a payment from the bank (498). */
export function usePayers() {
  return useQuery({
    queryKey: ['bank-payers'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('user_profiles').select('id, full_name')
        .in('role', ['admin', 'finance']).eq('account_status', 'active').order('full_name')
      if (error) throw error
      return (data ?? []) as Payer[]
    },
  })
}

/** Who usually makes an account's payments, if anyone is set (498). */
export function useAccountPayer(accountId: string | null | undefined) {
  return useQuery({
    queryKey: ['accounts', 'payer', accountId],
    enabled: !!accountId,
    queryFn: async () => {
      const { data, error } = await supabase.from('accounts').select('default_payer_id').eq('id', accountId!).maybeSingle()
      if (error) throw error
      return (data?.default_payer_id ?? null) as string | null
    },
  })
}
