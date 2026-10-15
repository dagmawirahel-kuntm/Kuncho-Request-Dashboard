import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Receipts to chase (migration 452): paid purchases from VAT suppliers with
// no VAT receipt captured yet, and where the chase on each one stands.

export type ChaseStatus = 'asked' | 'promised' | 'not_coming'

export interface ChaseRow {
  expense_id: string
  expense_code: string | null
  label: string | null
  vendor_id: string | null
  vendor_name: string | null
  vendor_phone: string | null
  contact_person: string | null
  project_name: string | null
  payment_state: string
  paid_on: string
  from_bank: boolean
  ec_year: number
  ec_month: number
  period_label: string
  days_since: number
  amount: number
  paid_amount: number
  vat: number
  chase_status: ChaseStatus | null
  asked_count: number
  last_asked_at: string | null
  promised_on: string | null
  chase_note: string | null
  promise_late: boolean
}

export function useReceiptChase() {
  return useQuery({
    queryKey: ['vat-receipt-chase'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('vat_receipt_chase_list')
      if (error) throw error
      return (data ?? []) as ChaseRow[]
    },
  })
}
