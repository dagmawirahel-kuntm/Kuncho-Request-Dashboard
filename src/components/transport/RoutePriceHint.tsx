import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Info, Layers } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'

// While booking: what this route usually costs hired, whether the quote is
// out of line, and other jobs collecting from the same place that day.
export function RoutePriceHint({ jobId, pickupId, dropoffId, jobType, mode, amount, date }: {
  jobId?: string | null
  pickupId: string | null | undefined
  dropoffId: string | null | undefined
  jobType: string | null | undefined
  mode: string | null | undefined
  amount: number | null | undefined
  date: string | null | undefined
}) {
  const { data: route } = useQuery({
    queryKey: ['route-price', pickupId, dropoffId],
    enabled: !!pickupId && !!dropoffId,
    staleTime: 300_000,
    queryFn: async () => {
      const { data } = await supabase.from('v_transport_route_costs').select('jobs, median_price, low_price, high_price, last_price, km')
        .or(`and(pickup_id.eq.${pickupId},dropoff_id.eq.${dropoffId}),and(pickup_id.eq.${dropoffId},dropoff_id.eq.${pickupId})`)
      const rows = (data ?? []) as { jobs: number; median_price: number; low_price: number; high_price: number; last_price: number; km: number | null }[]
      return rows.sort((a, b) => b.jobs - a.jobs)[0] ?? null
    },
  })
  const { data: typical } = useQuery({
    queryKey: ['route-price-type', jobType],
    enabled: !!jobType,
    staleTime: 300_000,
    queryFn: async () => {
      const { data } = await supabase.from('v_transport_month_prices').select('month, median_price, priced_jobs')
        .eq('transport_mode', 'hired').eq('job_type', jobType!).order('month', { ascending: false }).limit(2)
      return ((data ?? []) as { month: string; median_price: number | null; priced_jobs: number }[]).find(r => r.median_price) ?? null
    },
  })
  const { data: sameDay = [] } = useQuery({
    queryKey: ['same-day-pickups', pickupId, date],
    enabled: !!pickupId && !!date,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase.from('v_transport_jobs_clean').select('id, request_name, transport_mode, job_status')
        .eq('pickup_id', pickupId!).eq('job_date', date!)
      return ((data ?? []) as { id: string; request_name: string | null; transport_mode: string; job_status: string }[]).filter(j => j.id !== jobId)
    },
  })

  if (mode !== 'hired' && !sameDay.length) return null
  const ref = route ? { price: route.median_price, low: route.low_price, high: route.high_price, what: `this route (${route.jobs} hired job${route.jobs === 1 ? '' : 's'}${route.km ? `, ${route.km} km` : ''})` }
    : typical?.median_price ? { price: typical.median_price, low: null, high: null, what: `a hired ${String(jobType).replace('_', ' ')} lately` } : null
  const over = ref && amount ? Math.round(((amount - ref.price) / ref.price) * 100) : null

  return (
    <div className="space-y-1.5 text-xs">
      {mode === 'hired' && ref && (
        <p className={`flex items-start gap-1.5 ${over != null && over > 25 ? 'font-medium text-red-600' : 'text-slate-500 dark:text-slate-400'}`}>
          {over != null && over > 25 ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          <span>
            Usually {formatCurrency(ref.price)} for {ref.what}{ref.low != null && ref.high != null && ref.low !== ref.high ? ` — most between ${formatCurrency(ref.low)} and ${formatCurrency(ref.high)}` : ''}.
            {over != null && over > 25 && ` This quote is ${over}% above — ask for a better price or another carrier.`}
            {over != null && over < -25 && ` This quote is ${-over}% below the usual — check it covers loading and the return.`}
          </span>
        </p>
      )}
      {sameDay.length > 0 && (
        <p className="flex items-start gap-1.5 text-sky-700 dark:text-sky-300">
          <Layers className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{sameDay.length} other job{sameDay.length === 1 ? '' : 's'} collect from the same place that day ({sameDay.slice(0, 2).map(j => j.request_name ?? 'unnamed').join(', ')}) — one trip may do for both.</span>
        </p>
      )}
    </div>
  )
}
