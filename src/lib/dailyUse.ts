// A day's request lines and what each was used for (547), for the Daily use
// page and its printable form.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export type UsedFor = 'project' | 'stock' | 'workshop'

export type DailyUseLine = {
  id: string; order_id: string; request_code: string | null; request: string | null
  owner_id: string | null; owner: string | null
  item: string; quantity: number | null; unit: string | null; status: string
  request_project: string | null; held: boolean; approval: string
  po: string | null
  used_for: UsedFor | null; used_for_project_id: string | null; used_for_project: string | null; used_for_note: string | null
}

export type DailyUseStock = { id: string; item: string; quantity: number; unit: string | null; project: string | null; to: string | null; type: string; cost: number | null }

export type DailyUseSheet = { date: string; requester: string | null; lines: DailyUseLine[]; stock: DailyUseStock[] }

export function useDailyUse(date: string, requester: string | null) {
  return useQuery({
    queryKey: ['daily-use', date, requester],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('daily_use_sheet', { p_date: date, p_requester: requester })
      if (error) throw error
      return data as DailyUseSheet
    },
  })
}

/** People whose requests wait for an admin (547) — the daily form defaults to them. */
export function useHeldRequesters() {
  return useQuery({
    queryKey: ['held-requesters'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('user_profiles').select('id, full_name').eq('requests_need_admin_approval', true).order('full_name')
      if (error) throw error
      return (data ?? []) as { id: string; full_name: string }[]
    },
  })
}
