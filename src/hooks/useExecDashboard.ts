import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export type Health = 'red' | 'yellow' | 'green'

export interface ProjectExecRow {
  project_id: string
  project_name: string
  stage: string | null
  stage_entered_at: string | null
  days_in_stage: number | null
  assigned_pm_staff_id: string | null
  pm_name: string | null
  client_id: string | null
  client_name: string | null
  last_activity_at: string
  days_since_last_activity: number
  contract_value_etb: number | null
  budget_total: number
  committed_total: number
  actual_total: number
  remaining_budget: number
  budget_utilization_pct: number | null
  client_invoiced_total: number
  client_paid_total: number
  client_outstanding_total: number
  client_outstanding_oldest_days: number | null
  vendor_approved_unpaid_total: number
  vendor_approved_unpaid_oldest_days: number | null
  projected_margin_etb: number | null
  projected_margin_pct: number | null
  physical_progress_pct: number | null
  hse_incidents_last_7d: number
  hse_incidents_last_30d: number
  open_work_orders: number
  overdue_work_orders: number
  health_status: Health
  health_reasons: string[]
  refreshed_at: string
}

export function useExecProjects() {
  return useQuery({
    queryKey: ['exec-projects'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('mv_project_exec_summary').select('*')
      if (error) throw error
      return (data ?? []) as ProjectExecRow[]
    },
  })
}

export function useCashRunway() {
  return useQuery({
    queryKey: ['exec-cash-runway'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('mv_exec_gadget_cash_runway').select('*').maybeSingle()
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? null) as any
    },
  })
}

export function useArAging() {
  return useQuery({
    queryKey: ['exec-ar-aging'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('mv_exec_gadget_ar_aging').select('*').maybeSingle()
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? null) as any
    },
  })
}

export function useApAging() {
  return useQuery({
    queryKey: ['exec-ap-aging'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('mv_exec_gadget_ap_aging').select('*').maybeSingle()
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? null) as any
    },
  })
}

export function useMarginLeaderboard() {
  return useQuery({
    queryKey: ['exec-margin-leaderboard'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('mv_exec_gadget_margin_leaderboard').select('*').order('rank')
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []) as any[]
    },
  })
}

export function useLedgerFailures() {
  return useQuery({
    queryKey: ['exec-ledger-failures'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('mv_exec_gadget_ledger_failures').select('*').order('days_since', { ascending: false })
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []) as any[]
    },
  })
}

export function useGovernanceFlags() {
  return useQuery({
    queryKey: ['exec-governance-flags'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('mv_exec_gadget_governance_flags').select('*')
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []) as any[]
    },
  })
}

export function useLastRefresh() {
  return useQuery({
    queryKey: ['exec-last-refresh'],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exec_dashboard_refresh_log')
        .select('refreshed_at, duration_ms, success, error_message')
        .order('refreshed_at', { ascending: false }).limit(1).maybeSingle()
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? null) as any
    },
  })
}

export function useRefreshExecDashboard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('refresh_exec_dashboard_now')
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exec-projects'] })
      qc.invalidateQueries({ queryKey: ['exec-cash-runway'] })
      qc.invalidateQueries({ queryKey: ['exec-ar-aging'] })
      qc.invalidateQueries({ queryKey: ['exec-ap-aging'] })
      qc.invalidateQueries({ queryKey: ['exec-margin-leaderboard'] })
      qc.invalidateQueries({ queryKey: ['exec-ledger-failures'] })
      qc.invalidateQueries({ queryKey: ['exec-governance-flags'] })
      qc.invalidateQueries({ queryKey: ['exec-last-refresh'] })
    },
  })
}
