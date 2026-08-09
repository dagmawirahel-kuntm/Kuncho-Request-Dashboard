import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface Responsibility {
  id: string
  job_description_id: string
  responsibility_title: string
  responsibility_detail: string | null
  tier: string
  sort_order: number
}

export interface StaffCompetencySummary {
  staff_id: string
  job_description_id: string
  responsibilities_total: number
  responsibilities_rated: number
  avg_score: number | null
  last_rated_at: string | null
  has_gaps: boolean
  is_stale: boolean
}

export interface DeptGapRow {
  staff_id: string
  staff_name: string
  department_id: string | null
  department_name: string | null
  job_description_id: string | null
  role_name: string | null
  responsibilities_total: number | null
  responsibilities_rated: number | null
  avg_score: number | null
  last_rated_at: string | null
  has_gaps: boolean | null
  is_stale: boolean | null
  days_since_last_rated: number | null
}

// Responsibilities for a given JD.
export function useJdResponsibilities(jobDescriptionId: string | null | undefined) {
  return useQuery({
    enabled: !!jobDescriptionId,
    queryKey: ['jd-responsibilities', jobDescriptionId],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('key_responsibilities')
        .select('*')
        .eq('job_description_id', jobDescriptionId!)
        .eq('active', true)
        .order('sort_order')
      if (error) throw error
      return (data ?? []) as Responsibility[]
    },
  })
}

// Latest score per responsibility for one staff.
export function useStaffCurrentScores(staffId: string | null | undefined) {
  return useQuery({
    enabled: !!staffId,
    queryKey: ['staff-current-scores', staffId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_staff_current_scores')
        .select('*')
        .eq('staff_id', staffId!)
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []) as any[]
    },
  })
}

export function useStaffCompetencySummary(staffId: string | null | undefined) {
  return useQuery({
    enabled: !!staffId,
    queryKey: ['staff-competency-summary', staffId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_staff_competency_summary')
        .select('*')
        .eq('staff_id', staffId!)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as StaffCompetencySummary | null
    },
  })
}

export function useDepartmentGaps() {
  return useQuery({
    queryKey: ['dept-competency-gaps'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_department_competency_gaps').select('*')
      if (error) throw error
      return (data ?? []) as DeptGapRow[]
    },
  })
}

export function useSubcontractSummaries() {
  return useQuery({
    queryKey: ['subcontract-competency-summary'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_subcontract_competency_summary').select('*').order('last_rated_at', { ascending: false, nullsFirst: false })
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []) as any[]
    },
  })
}

export function useCandidateSummaries() {
  return useQuery({
    queryKey: ['candidate-competency-summary'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_candidate_competency_summary').select('*').order('last_rated_at', { ascending: false, nullsFirst: false })
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []) as any[]
    },
  })
}

export function useSubmitCompetencyRating() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: {
      responsibility_id: string
      score: number
      notes?: string | null
      staff_id?: string | null
      subcontract_id?: string | null
      candidate_id?: string | null
    }) => {
      const { data: user } = await supabase.auth.getUser()
      const payload = {
        responsibility_id: p.responsibility_id,
        score: p.score,
        notes: p.notes ?? null,
        staff_id: p.staff_id ?? null,
        subcontract_id: p.subcontract_id ?? null,
        candidate_id: p.candidate_id ?? null,
        rated_by: user.user?.id ?? null,
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await supabase.from('competency_ratings').insert([payload as any])
      if (error) throw error
    },
    onSuccess: (_, vars) => {
      if (vars.staff_id) {
        qc.invalidateQueries({ queryKey: ['staff-current-scores', vars.staff_id] })
        qc.invalidateQueries({ queryKey: ['staff-competency-summary', vars.staff_id] })
      }
      qc.invalidateQueries({ queryKey: ['dept-competency-gaps'] })
      qc.invalidateQueries({ queryKey: ['subcontract-competency-summary'] })
      qc.invalidateQueries({ queryKey: ['candidate-competency-summary'] })
    },
  })
}
