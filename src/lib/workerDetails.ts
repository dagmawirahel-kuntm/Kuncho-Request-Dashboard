// A worker's details, filled in once by whoever hires them; HR reviews
// them (migration 482). The same fields for someone already on file
// (staff) and someone named on a request that isn't approved yet
// (candidate) — their details move across when they are hired.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export type Who = { staff_id?: string | null; candidate_id?: string | null }

/** What the site team fills in. */
export type DetailsInput = {
  name?: string; phone?: string; national_id?: string; id_document_url?: string | null; id_document_name?: string | null
  photo_url?: string | null; trade?: string | null; day_rate?: number | null
  bank_id?: string | null; account_number?: string; account_holder?: string
}

export type WorkerDetails = DetailsInput & {
  bank: string | null; gaps: string[]
  /** Approved labour requests made since 28 Oct 2026 they were on; phone and ID are needed from the 4th. */
  hires?: number; id_needed?: boolean
  verified_at?: string | null; verified_by_name?: string | null; verification_note?: string | null
  details_at: string | null; details_by_name: string | null
  returned_at?: string | null; returned_reason?: string | null; returned_by_name?: string | null
}

export type MyWorker = {
  kind: 'staff' | 'candidate'; id: string; name: string; phone: string | null; photo_url: string | null; sites: string | null
  gaps: string[]; verified: boolean; details_at: string | null; details_by_name: string | null
  returned_reason: string | null; returned_by_name: string | null; last_worked: string | null
}

export type DetailsState = 'returned' | 'missing' | 'with_hr' | 'verified'
export const DETAILS_STATE: Record<DetailsState, { label: string; tone: 'red' | 'amber' | 'blue' | 'green' }> = {
  returned: { label: 'Sent back by HR', tone: 'red' },
  missing: { label: 'Details missing', tone: 'amber' },
  with_hr: { label: 'With HR to confirm', tone: 'blue' },
  verified: { label: 'Verified', tone: 'green' },
}
export const stateOf = (w: { gaps: string[] | null; verified: boolean; returned_reason?: string | null }): DetailsState =>
  w.returned_reason ? 'returned' : w.verified ? 'verified' : (w.gaps?.length ?? 0) > 0 ? 'missing' : 'with_hr'

const args = (who: Who) => ({ p_staff: who.staff_id ?? null, p_candidate: who.staff_id ? null : who.candidate_id ?? null })

export function useWorkerDetails(who: Who | null) {
  return useQuery({
    queryKey: ['worker-details', who?.staff_id ?? null, who?.candidate_id ?? null],
    enabled: !!(who?.staff_id || who?.candidate_id),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('worker_details_get', args(who!))
      if (error) throw error
      return data as WorkerDetails
    },
  })
}

/** Saves what was filled in; returns what is still missing. */
export async function saveWorkerDetails(who: Who, d: DetailsInput): Promise<string[]> {
  const clean = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined))
  const { data, error } = await supabase.rpc('worker_details_save', { ...args(who), p_d: clean })
  if (error) throw new Error(error.message)
  return ((data as { gaps: string[] | null })?.gaps) ?? []
}

/** The banks a worker can be paid into. */
export function useBanks() {
  return useQuery({
    queryKey: ['banks-lookup'],
    staleTime: 600_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('accounts').select('id, account_name').in('type', ['Bank', 'Bank Account']).order('account_name')
      if (error) throw error
      return (data ?? []) as { id: string; account_name: string }[]
    },
  })
}

export function useMyWorkers(enabled = true) {
  return useQuery({
    queryKey: ['my-workers-details'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_workers_details')
      if (error) throw error
      return (data ?? []) as MyWorker[]
    },
  })
}

/** Something filled in on a draft person, worth sending. */
export const hasDetails = (d: DetailsInput | undefined) =>
  !!d && Object.entries(d).some(([k, v]) => !['name', 'phone', 'photo_url'].includes(k) && v != null && v !== '')
