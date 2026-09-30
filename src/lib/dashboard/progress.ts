import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface DayProgress {
  /** Waiting now. */
  waiting: number
  /** How far the count has come down today (migration 381). */
  cleared: number
  /** Working days in a row the queue reached zero. */
  streak: number
}

/**
 * Reports today's "waiting on you" count and reads back how the day is
 * going (record_dashboard_progress, migration 381). Keyed on the count, so
 * it only calls again when the count changes. Until that migration is run
 * the call fails and this returns null — the header just leaves the ring out.
 */
export function useDayProgress(userId: string | null, waiting: number | null) {
  const { data } = useQuery({
    queryKey: ['dash', 'progress', userId, waiting],
    enabled: !!userId && waiting != null,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('record_dashboard_progress', { p_waiting: waiting })
      if (error) throw error
      const row = (data as DayProgress[] | null)?.[0]
      return row ?? null
    },
  })
  return data ?? null
}
