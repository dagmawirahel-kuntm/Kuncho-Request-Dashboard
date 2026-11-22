// What a worker charged before for piece work (536): every earlier piece or
// fixed-price job they were on, with the agreed price, ranked by how close
// its work is to the one being agreed now.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export type PieceRate = {
  staff_id: string; name: string; labor_requisition_id: string; work: string; scope: string | null
  basis: 'per_volume' | 'fixed_price'; unit: string | null; price: number; done: number | null; paid: number | null
  project: string | null; worked_on: string | null; match: number; same_unit: boolean
}

/** Close enough to count as the same work (trigram similarity of the job's name). */
export const SAME_WORK = 0.35

export function usePieceRates(staffIds: string[], work: string, unit: string | null, exclude?: string | null) {
  const ids = [...staffIds].sort()
  return useQuery({
    queryKey: ['piece-rate-history', ids.join(','), work.trim().toLowerCase(), unit ?? '', exclude ?? ''],
    enabled: ids.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('piece_rate_history', {
        p_staff: ids, p_work: work.trim() || null, p_unit: unit || null, p_exclude: exclude ?? null,
      })
      if (error) throw error
      return (data ?? []).map((r: PieceRate) => ({ ...r, price: Number(r.price), match: Number(r.match) })) as PieceRate[]
    },
  })
}
