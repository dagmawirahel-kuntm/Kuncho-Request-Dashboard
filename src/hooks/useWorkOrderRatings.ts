import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Team-Ratings surface data — one row per person who could be rated on this
// WO: the assigned lead + everyone reachable via work_order_labor →
// labor_allocations.staff_id. The lead may or may not overlap the labor rows;
// dedupe by staff_id so the modal opens once per person.
export function useWorkOrderTeam(workOrderId: string | undefined, leadStaffId: string | null) {
  return useQuery({
    enabled: !!workOrderId,
    queryKey: ['work-order-team', workOrderId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_order_labor')
        .select('labor_allocations(staff_id, staff:staff(id, employee_name, role, photo_url))')
        .eq('work_order_id', workOrderId!)
      if (error) throw error
      const seen = new Map<string, { id: string; employee_name: string; role: string | null; photo_url: string | null }>()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const row of (data ?? []) as any[]) {
        const s = row.labor_allocations?.staff
        if (s?.id && !seen.has(s.id)) seen.set(s.id, s)
      }
      if (leadStaffId && !seen.has(leadStaffId)) {
        const { data: leadRow } = await supabase.from('staff').select('id, employee_name, role, photo_url').eq('id', leadStaffId).maybeSingle()
        if (leadRow) seen.set(leadStaffId, leadRow as { id: string; employee_name: string; role: string | null; photo_url: string | null })
      }
      return [...seen.values()]
    },
  })
}

export interface WorkOrderRatingRow {
  id: string
  work_order_id: string
  rated_staff_id: string
  rater_staff_id: string
  score_quality: number
  score_timeliness: number
  score_safety: number
  score_teamwork: number
  comment: string | null
  rated_at: string
}

// Ratings for one WO — visible to the rater themselves, the WO's project PM,
// and admin/exec/HR (RLS enforces this; queries just no-op for ratees).
export function useWorkOrderRatings(workOrderId: string | undefined) {
  return useQuery({
    enabled: !!workOrderId,
    queryKey: ['work-order-ratings', workOrderId],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_order_ratings')
        .select('*')
        .eq('work_order_id', workOrderId!)
      if (error) throw error
      return (data ?? []) as WorkOrderRatingRow[]
    },
  })
}

export interface RatingUpsert {
  work_order_id: string
  rated_staff_id: string
  rater_staff_id: string
  score_quality: number
  score_timeliness: number
  score_safety: number
  score_teamwork: number
  comment: string | null
}

export function useUpsertWorkOrderRating() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: RatingUpsert) => {
      // Upsert on the unique (WO, ratee, rater) triple — a rater editing their
      // own rating for the same person on the same WO overwrites in place.
      const { data, error } = await supabase
        .from('work_order_ratings')
        .upsert(payload, { onConflict: 'work_order_id,rated_staff_id,rater_staff_id' })
        .select()
        .single()
      if (error) throw error
      return data as WorkOrderRatingRow
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['work-order-ratings', row.work_order_id] })
      qc.invalidateQueries({ queryKey: ['rolling-performance', row.rated_staff_id] })
      qc.invalidateQueries({ queryKey: ['rolling-performance-all'] })
    },
  })
}

export function useDeleteWorkOrderRating() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (row: Pick<WorkOrderRatingRow, 'id' | 'work_order_id' | 'rated_staff_id'>) => {
      const { error } = await supabase.from('work_order_ratings').delete().eq('id', row.id)
      if (error) throw error
      return row
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['work-order-ratings', row.work_order_id] })
      qc.invalidateQueries({ queryKey: ['rolling-performance', row.rated_staff_id] })
      qc.invalidateQueries({ queryKey: ['rolling-performance-all'] })
    },
  })
}

export interface RollingPerformanceRow {
  staff_id: string
  score_quality: number | null
  score_timeliness: number | null
  score_safety: number | null
  score_teamwork: number | null
  score_overall: number | null
  effective_sample_size: number
  sufficient_data: boolean
  rating_count_all_time: number
  last_rated_at: string | null
}

// One person's rolling score — the view filters access by RLS-analogous rules
// itself (the caller only sees rows they may see), so a null result on a
// visible staff id means "no ratings yet."
export function useRollingPerformance(staffId: string | undefined) {
  return useQuery({
    enabled: !!staffId,
    queryKey: ['rolling-performance', staffId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_staff_rolling_performance')
        .select('*')
        .eq('staff_id', staffId!)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as RollingPerformanceRow | null
    },
  })
}

// All rows the caller may see — used by the exec leaderboard. Admin/exec/HR
// get everyone; PMs get their own team; a plain staff caller only sees
// themselves, which the leaderboard hides.
export function useAllRollingPerformance() {
  return useQuery({
    queryKey: ['rolling-performance-all'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_staff_rolling_performance')
        .select('*')
      if (error) throw error
      return (data ?? []) as RollingPerformanceRow[]
    },
  })
}

export interface ReviewEvidenceRow {
  rating_id: string
  work_order_id: string
  work_order_scope: string
  project_id: string
  project_name: string
  rater_staff_id: string
  rater_name: string | null
  score_quality: number
  score_timeliness: number
  score_safety: number
  score_teamwork: number
  comment: string | null
  rated_at: string
}

export function useReviewEvidence(staffId: string | undefined, fromDate: string | undefined, toDate: string | undefined) {
  return useQuery({
    enabled: !!staffId && !!fromDate && !!toDate,
    queryKey: ['review-evidence', staffId, fromDate, toDate],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('v_staff_performance_review_evidence', {
        p_staff_id: staffId!,
        p_from_date: fromDate!,
        p_to_date: toDate!,
      })
      if (error) throw error
      return (data ?? []) as ReviewEvidenceRow[]
    },
  })
}
