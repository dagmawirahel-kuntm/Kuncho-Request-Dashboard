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
  costing_closed_at?: string | null; kind_sorted_at?: string | null; suggested_kind?: string | null
}

/** A bucket overhead can be put in: in use, and not one the one-time sort is
 *  about to turn into a job. */
export function isTargetBucket(p: PickerProject) {
  if (!p.is_internal || p.costing_closed_at) return false
  // Not sorted yet: a bucket-to-be counts whether or not it's switched on.
  if (!p.kind_sorted_at && p.suggested_kind) return p.suggested_kind === 'bucket'
  return !!p.active_for_year
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

// ── Variance through the fiscal year (503e) ─────────────────────────────────
// Fiscal months run Hamle … Sene (Pagume counted with Nehase). With no budget
// set, a bucket's usual month (the average of the completed months before
// this one, up to twelve) stands in as the reference.

export const FISCAL_MONTHS = ['Hamle', 'Nehase', 'Meskerem', 'Tikimt', 'Hidar', 'Tahsas', 'Tir', 'Yekatit', 'Megabit', 'Miyazya', 'Genbot', 'Sene']

export interface VarianceMonth { idx: number; start: string; spent: number; last_year: number }
export interface VarianceRow {
  id: string | null; name: string; in_use: boolean; monthly_budget: number | null
  /** The average completed month before this one; 0 when there is none yet. */
  usual: number
  months: VarianceMonth[]
  fytd: number; last_fytd: number; fy_label: string; cur_idx: number
}
export interface OverheadHistory {
  fy_label: string; fy_start: string; fy_end: string; today: string; data_from: string | null
  cur_month_start: string
  /** How many completed months the usual month averages (0: none yet). */
  usual_months: number
  /** Whether the records reach back into last fiscal year at all. */
  has_last_year: boolean
}

export function useOverheadVariance() {
  return useQuery({
    queryKey: ['overhead-variance'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('overhead_variance', {})
      if (error) throw error
      return ((data ?? []) as VarianceRow[]).map(r => ({
        // Whole birr: the usual month is an average, its cents mean nothing.
        ...r, usual: Math.round(Number(r.usual)), fytd: Number(r.fytd), last_fytd: Number(r.last_fytd),
        monthly_budget: r.monthly_budget == null ? null : Number(r.monthly_budget),
        months: r.months.map(m => ({ ...m, spent: Number(m.spent), last_year: Number(m.last_year) })),
      }))
    },
  })
}

export function useOverheadHistory() {
  return useQuery({
    queryKey: ['overhead-history'],
    staleTime: 300000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('overhead_history', {})
      if (error) throw error
      return data as OverheadHistory
    },
  })
}

export type CompareWith = 'reference' | 'last_year'

/** What a month is held against: the budget if set, else the usual month. */
export function referenceOf(r: Pick<VarianceRow, 'monthly_budget' | 'usual'>): { value: number; kind: 'budget' | 'usual' } | null {
  if (Number(r.monthly_budget ?? 0) > 0) return { value: Number(r.monthly_budget), kind: 'budget' }
  if (Number(r.usual) > 0) return { value: Number(r.usual), kind: 'usual' }
  return null
}

/** -3 … +3: how far a month sits below or above what it is compared with. */
export function varianceBand(spent: number, against: number): number | null {
  if (!(against > 0) || !(spent > 0)) return null
  const r = spent / against
  return r >= 2 ? 3 : r >= 1.4 ? 2 : r >= 1.1 ? 1 : r > 0.9 ? 0 : r > 0.7 ? -1 : r > 0.4 ? -2 : -3
}

/** Diverging fills, blue below ↔ red above, gray for about usual. Ink passes
 *  4.5:1 on every step: slate-900 in light, white in dark. */
export const BAND_FILL: Record<number, string> = {
  [-3]: 'bg-[#3987e5] dark:bg-[#2a6fd0]',
  [-2]: 'bg-[#86b6ef] dark:bg-[#234d85]',
  [-1]: 'bg-[#cde2fb] dark:bg-[#1f3554]',
  0: 'bg-[#f0efec] dark:bg-[#383835]',
  1: 'bg-[#f8cfce] dark:bg-[#4f2a2a]',
  2: 'bg-[#ef9493] dark:bg-[#8f3333]',
  3: 'bg-[#e34948] dark:bg-[#c53b3b]',
}
export const BAND_LABEL: Record<number, string> = {
  [-3]: 'far below', [-2]: 'below', [-1]: 'a bit below', 0: 'about usual', 1: 'a bit above', 2: 'above', 3: 'far above (2× or more)',
}

/** "1.4×" or "−30%": a month against what it is compared with. */
export function ratioText(spent: number, against: number) {
  if (!(against > 0)) return null
  const r = spent / against
  if (r >= 1.5) return `${r >= 10 ? Math.round(r) : r.toFixed(1)}×`
  const pct = Math.round((r - 1) * 100)
  return pct === 0 ? 'the same' : `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`
}

export const gregMonth = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

/**
 * How far into the current fiscal month today is (0–1). A month still running
 * is held against that share of its reference, not a whole month. Fiscal
 * months are 30 days; Nehase carries Pagume (35 or 36).
 */
export function monthShare(history: Pick<OverheadHistory, 'today' | 'cur_month_start'> | undefined, curIdx: number) {
  if (!history) return 1
  const len = curIdx === 1 ? 35 : 30
  const days = Math.round((Date.parse(history.today) - Date.parse(history.cur_month_start)) / 86400000) + 1
  return Math.min(1, Math.max(days, 1) / len)
}

/** What one month is held against: its share of the reference while it runs. */
export function againstFor(m: VarianceMonth, row: VarianceRow, history: OverheadHistory | undefined, base: number | null | undefined) {
  if (!(Number(base) > 0)) return 0
  return Number(base) * (m.idx === row.cur_idx ? monthShare(history, row.cur_idx) : 1)
}
