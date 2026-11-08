import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency } from '@/lib/utils'

// Jobs and cost buckets (503). A cost bucket (projects.is_internal) never
// ends and never closes: it has an owner who approves its spending before
// finance, a monthly budget, a default category for spending with none, and
// an in-use switch (active_for_year) that keeps it in the pickers. A job may
// have no client yet, or be Kuncho's own work (own_work).

export type SortKind = 'bucket' | 'job' | 'own' | 'test'
export const SORT_LABEL: Record<SortKind, string> = {
  bucket: 'Cost bucket',
  job: 'Job · client not known yet',
  own: 'Job · our own work',
  test: 'Not real · close it',
}

export interface OverheadRow {
  /** null: overhead recorded with no bucket. */
  id: string | null
  name: string
  in_use: boolean
  owner_id: string | null
  owner_name: string | null
  monthly_budget: number | null
  category_id: string | null
  category_name: string | null
  months: { month: string; spent: number }[]
  this_month: number
  same_month_last_year: number
  last_12: number
  n_costs: number
  waiting_owner: number
  to_sort: boolean
  suggested_kind: SortKind | null
}

export interface BucketWaitingRow {
  id: string; expense_code: string | null; date: string; description: string | null; amount: number
  payee: string | null; requested_by: string | null; bucket_id: string; bucket: string; owner_name: string | null
}

export function useOverheadSummary(enabled = true) {
  return useQuery({
    queryKey: ['overhead-summary'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('overhead_summary', { p_months: 12 })
      if (error) throw error
      return (data ?? []) as OverheadRow[]
    },
    enabled,
  })
}

export function useBucketWaiting(enabled = true) {
  return useQuery({
    queryKey: ['bucket-waiting'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bucket_waiting')
      if (error) throw error
      return (data ?? []) as BucketWaitingRow[]
    },
    enabled,
  })
}

/** Every bucket's owner, for the approval queue. */
export function useBucketOwners() {
  return useQuery({
    queryKey: ['bucket-owners'],
    staleTime: 300000,
    queryFn: async () => {
      const { data, error } = await supabase.from('projects')
        .select('id, bucket_owner_id, owner:user_profiles!bucket_owner_id(full_name)')
        .eq('is_internal', true).not('bucket_owner_id', 'is', null)
      if (error) throw error
      const rows = (data ?? []) as unknown as { id: string; bucket_owner_id: string; owner: { full_name: string | null } | null }[]
      return new Map(rows.map(r => [r.id, { owner_id: r.bucket_owner_id, owner_name: r.owner?.full_name ?? null }]))
    },
  })
}

/** Whether the signed-in person owns a cost bucket (for the nav). */
export function useOwnsBucket() {
  const { user } = useAuth()
  const q = useQuery({
    queryKey: ['owns-bucket', user?.id],
    staleTime: 300000,
    enabled: !!user?.id,
    queryFn: async () => {
      const { count, error } = await supabase.from('projects').select('id', { count: 'exact', head: true })
        .eq('is_internal', true).eq('bucket_owner_id', user!.id)
      if (error) throw error
      return (count ?? 0) > 0
    },
  })
  return q.data ?? false
}

/** The fields a project picker reads (useProjects). */
export interface PickerProject {
  id: string; project_name: string; department?: string | null
  is_internal?: boolean | null; active_for_year?: boolean | null
  costing_closed_at?: string | null; kind_sorted_at?: string | null
}

/**
 * Whether a project belongs in a picker for a new cost: not a job whose
 * costing is closed (502), not a bucket switched out of use (503). The one
 * already chosen always stays.
 */
export function pickableForCost(p: PickerProject, current?: string | null) {
  if (p.id === current) return true
  if (p.costing_closed_at) return false
  if (p.is_internal) return !!p.active_for_year || !p.kind_sorted_at
  return true
}

/** A picker option: buckets read as company overhead. */
export function costPickerOption(p: PickerProject) {
  return p.is_internal
    ? { id: p.id, label: `Overhead · ${p.project_name}`, sub: 'Company overhead' }
    : { id: p.id, label: p.project_name, sub: p.costing_closed_at ? 'Costing closed' : p.department ?? undefined }
}

/** Buckets first, then jobs, each by name. */
export function costPickerOptions(projects: PickerProject[], current?: string | null) {
  const list = projects.filter(p => pickableForCost(p, current))
  return [...list.filter(p => p.is_internal), ...list.filter(p => !p.is_internal)].map(costPickerOption)
}

export const money = (n: number | null | undefined) => formatCurrency(Number(n ?? 0)).replace(/\.00$/, '')
export const short = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)))
export const monthName = (iso: string, year = false) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { month: 'short', ...(year ? { year: 'numeric' } : {}) })
export const btnSm = 'inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium disabled:opacity-50 dark:border-slate-600'
