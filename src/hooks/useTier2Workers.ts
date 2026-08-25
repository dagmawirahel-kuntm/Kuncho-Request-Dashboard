import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface TradeRosterEntry {
  trade_tag: string
  codename_amharic: string
  codename_english: string
  icon_emoji: string
  color_accent: string
  color_accent_2: string
  sort_order: number
}

export function useTradeRoster() {
  return useQuery({
    queryKey: ['tier2-trade-roster'],
    staleTime: 600_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('tier2_trade_roster').select('*').order('sort_order')
      if (error) throw error
      return (data ?? []) as TradeRosterEntry[]
    },
  })
}

export interface CasualWorkerRow {
  id: string
  employee_name: string
  photo_url: string | null
  trade_tag: string | null
  codename_amharic: string | null
  codename_english: string | null
  day_rate: number | null
  status: string | null
  first_engaged_at: string | null
  last_engaged_at: string | null
  employment_type: string | null
}

// Tier-2 staff rows. The card grid enriches these client-side with the
// rolling score view + badge summary, both of which have their own RLS.
export function useCasualWorkers() {
  return useQuery({
    queryKey: ['casual-workers-list'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff')
        .select('id, employee_name, photo_url, trade_tag, codename_amharic, codename_english, day_rate, status, first_engaged_at, last_engaged_at, employment_type')
        .eq('employment_type', 'tier_2_casual')
        .order('employee_name')
      if (error) throw error
      return (data ?? []) as CasualWorkerRow[]
    },
  })
}

export interface BadgeSummary { staff_id: string; badge_count: number; badge_codes: string[] }

export function useAllBadgeSummaries() {
  return useQuery({
    queryKey: ['staff-badge-summary-all'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_staff_badge_summary').select('*')
      if (error) throw error
      return (data ?? []) as BadgeSummary[]
    },
  })
}

export interface WorkerRolling {
  staff_id: string
  score_quality: number | null
  score_timeliness: number | null
  score_safety: number | null
  score_teamwork: number | null
  score_overall: number | null
  overall_score_100: number | null
  effective_sample_size: number
  sufficient_data: boolean
  rating_count_all_time: number
  last_rated_at: string | null
  tier_rank: 'legendary' | 'rare' | 'standard' | 'unranked'
}

export function useAllRolling() {
  return useQuery({
    queryKey: ['tier2-rolling-performance-all'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_staff_rolling_performance').select('*')
      if (error) throw error
      return (data ?? []) as WorkerRolling[]
    },
  })
}

// Worker payments + work history for the card-detail modal. Payments come from
// two shapes: individual model (expense.paid_to_staff_id = them) and gang-leader
// model (labor_expense_workers row for them). Combined client-side for display.
//
// These two shapes overlap, not partition: rollup_labor_timesheets_to_expense
// inserts a labor_expense_workers row for EVERY worker on a rollup regardless
// of payment_model, and separately sets expenses.paid_to_staff_id whenever the
// rollup is a single-worker "individual" model. So a solo worker's payment
// satisfies both queries for the exact same expense — shown unfiltered, it
// looked like they were paid twice for one real payment. Whenever an expense
// id appears in both, `individual` (the direct, whole-expense record) is kept
// and the redundant `gang` row for that same expense is dropped, since the
// worker wasn't actually paid "via a gang leader" in that case.
export function useWorkerHistory(staffId: string | undefined) {
  return useQuery({
    enabled: !!staffId,
    queryKey: ['tier2-worker-history', staffId],
    staleTime: 30_000,
    queryFn: async () => {
      const [allocations, individual, gang, badges] = await Promise.all([
        supabase.from('labor_allocations')
          .select('id, project_id, start_date, end_date, day_rate_snapshot, status, projects(project_name), labor_requisition_id, labor_requisitions(id, role_needed, end_date)')
          .eq('staff_id', staffId!).order('start_date', { ascending: false }),
        supabase.from('expenses')
          .select('id, amount_etb, date, project_id, payment_state, approval_status, projects(project_name)')
          .eq('paid_to_staff_id', staffId!),
        supabase.from('labor_expense_workers')
          .select('id, subtotal, days_worked, day_rate, expense_id, expenses(id, date, project_id, payment_state, approval_status, projects(project_name))')
          .eq('staff_id', staffId!),
        supabase.from('v_staff_badges').select('badge_code').eq('staff_id', staffId!),
      ])
      if (allocations.error) throw allocations.error
      if (individual.error) throw individual.error
      if (gang.error) throw gang.error
      if (badges.error) throw badges.error
      const individualExpenseIds = new Set((individual.data ?? []).map(e => e.id))
      return {
        allocations: allocations.data ?? [],
        individual: individual.data ?? [],
        gang: (gang.data ?? []).filter(r => !individualExpenseIds.has(r.expense_id)),
        badges: (badges.data ?? []).map(b => b.badge_code),
      }
    },
  })
}
