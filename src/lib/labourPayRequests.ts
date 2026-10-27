// The PM's labour payment request and finance's labour queue (migration 479).
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Tone } from '@/components/record/Record'

export type PayRequestStatus = 'draft' | 'submitted' | 'returned' | 'approved' | 'sent' | 'cancelled'

export const REQUEST_STATUS: Record<PayRequestStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'slate' },
  submitted: { label: 'With finance', tone: 'blue' },
  returned: { label: 'Sent back', tone: 'red' },
  approved: { label: 'Approved — to pay', tone: 'amber' },
  sent: { label: 'In a payment', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'slate' },
}

/** A confirmed pay sheet (or held pay) not yet in a request. */
export type PayableDraft = {
  expense_id: string; expense_code: string | null; project_id: string; project_name: string | null; what: string | null
  period_start: string | null; period_end: string | null; amount: number; workers: number; unverified: number
  held: boolean; pay_sheet_code: string | null
}

/** One worker (or crew leader) on a request. */
export type RequestLine = {
  staff_id: string | null; name: string; payee: string; crew_leader: boolean; days: number | null
  gross: number; deduction: number; deduction_note: string | null; net: number
  bank: string | null; account_number: string | null; account_holder: string | null
  verified: boolean; held: boolean; expense_codes: string | null
}

export type RequestRow = {
  id: string; code: string; status: PayRequestStatus; created_by_name: string | null; created_at: string
  submitted_at: string | null; approved_at: string | null; returned_reason: string | null; projects: string | null
  sheets: number; workers: number; gross: number | null; deductions: number | null; net: number | null; unverified: number
  batch_payment_id: string | null; batch_code: string | null; batch_paid: boolean
}

export type Photo = { url: string; name: string }

export type PayRequest = {
  id: string; code: string; status: PayRequestStatus; note: string | null; attendance_photos: Photo[]
  signoff_text: string | null; signed_by_name: string | null; submitted_at: string | null
  returned_reason: string | null; returned_at: string | null; returned_by_name: string | null
  approved_at: string | null; approved_by_name: string | null; batch_payment_id: string | null
  created_by: string | null; created_by_name: string | null; created_at: string
}

export const SIGNOFF = 'I confirm these people worked these days on these jobs, as shown on the attached signed attendance sheet, and that any cash advance they took is deducted above.'

export function usePayableDrafts(enabled = true) {
  return useQuery({
    queryKey: ['labour-payable-drafts'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('labour_payable_drafts')
      if (error) throw error
      return (data ?? []) as PayableDraft[]
    },
  })
}

export function usePayRequestList(scope: 'mine' | 'finance', enabled = true) {
  return useQuery({
    queryKey: ['labour-pay-requests', scope],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('labour_pay_request_list', { p_scope: scope })
      if (error) throw error
      return (data ?? []) as RequestRow[]
    },
  })
}
