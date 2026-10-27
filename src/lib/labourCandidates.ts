import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Who can do this job (migration 478): the data behind WorkerPicker.

export type Candidate = {
  staff_id: string; name: string; trade: string | null; day_rate: number | null; phone: string | null; verified: boolean
  busy_today: { project: string | null; what: string | null } | null; open_elsewhere: number; days_here: number
  last_worked: string | null; last_site: string | null; score: number | null; on_this_job: boolean
}

// The words people type for the work, to the trade tags workers carry.
const WORK_TRADES: [RegExp, string[]][] = [
  [/mason|block|hcb/i, ['mason', 'meson']],
  [/plaster/i, ['plasterer', 'mason', 'meson']],
  [/carpent|wood|form ?work/i, ['carpenter']],
  [/paint/i, ['painter']],
  [/putty|gypsum/i, ['putty_worker', 'painter']],
  [/tile|ceramic|granite/i, ['tile_setter']],
  [/electric/i, ['electrician_helper']],
  [/plumb/i, ['plumber_helper']],
  [/steel|rebar|bar/i, ['steel_fixer']],
  [/chisel/i, ['chiseler']],
  [/clean/i, ['cleaner', 'laborer', 'general_laborer']],
  [/labou?r|helper|daily/i, ['laborer', 'general_laborer']],
]
/** The trade tags that fit what someone typed as the work. */
export const tradesFor = (work: string) => WORK_TRADES.find(([re]) => re.test(work))?.[1] ?? []

export function useLabourCandidates(projectId: string | null | undefined, workOrderId?: string | null, date?: string) {
  return useQuery({
    queryKey: ['labour-candidates', projectId, workOrderId ?? null, date ?? null],
    enabled: !!projectId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('labour_candidates', { p_project: projectId, p_work_order: workOrderId ?? null, ...(date ? { p_date: date } : {}) })
      if (error) throw error
      return (data ?? []) as Candidate[]
    },
  })
}

