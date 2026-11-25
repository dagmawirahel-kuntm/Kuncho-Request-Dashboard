// Where a purchase order's payment stands (538): the vendor account finance
// approved on it, the vendor's account now, and the bill.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export type PoPaymentStatus = {
  pay_to: { bank: string | null; account: string | null; name: string | null; set_at: string; set_by: string | null } | null
  vendor: { id: string; name: string; bank: string | null; account: string | null; phone: string | null; verified: boolean; account_changed_at: string | null } | null
  matches: boolean
  needs_call: boolean
  bill: {
    id: string; code: string; amount: number; wht: number; to_vendor: number
    approval: 'pending' | 'manager_approved' | 'finance_approved' | 'rejected'
    state: 'unpaid' | 'approved_to_pay' | 'sent' | 'paid' | 'advance' | 'void'
    in_parts: boolean; category_id: string | null; category: string | null
    approved_by: string | null; approved_by_id: string | null; approved_at: string | null
    paid_by: string | null; paid_date: string | null; method: string | null; bank_ref: string | null
  } | null
  /** The general ledger procurement picked (547); finance picks the sub ledger inside it. */
  general_ledger: { id: string; code: string; name: string } | null
  po_approved_by_finance: boolean
}

export function usePoPaymentStatus(bundleId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['po-payment-status', bundleId],
    enabled: !!bundleId && enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('po_payment_status', { p_bundle: bundleId })
      if (error) throw error
      return data as PoPaymentStatus
    },
  })
}
