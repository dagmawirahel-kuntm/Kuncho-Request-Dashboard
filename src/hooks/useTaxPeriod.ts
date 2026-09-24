import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toEthiopian, ecPeriodLabel } from '@/lib/ethiopianCalendar'

interface FyPagume {
  start_date: string
  end_date: string
  pagume_attaches_to: 'nehase' | 'meskerem'
}

/**
 * Returns a function mapping a date to the label of the TAX period it is
 * declared in — e.g. 8 Sep 2026 -> "Nehase 2018" when FY2026/27 declares
 * Pagume with Nehase. Mirrors tax_period_for_date() (migration 315), which
 * is what every tax view groups by, so a label shown beside a record always
 * matches the return its amount lands in.
 *
 * The only difference from the plain calendar is Pagume, so the conversion
 * itself stays in ethiopianCalendar.ts; this adds the fiscal-year setting.
 */
export function useTaxPeriodLabel() {
  const { data: years = [] } = useQuery({
    queryKey: ['fiscal-periods', 'pagume'],
    staleTime: 300000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fiscal_periods')
        .select('start_date,end_date,pagume_attaches_to')
      if (error) throw error
      return data as FyPagume[]
    },
  })

  return useCallback((date: string | null | undefined): string | null => {
    if (!date) return null
    const ec = toEthiopian(date)
    if (ec.month !== 13) return ecPeriodLabel(ec.year, ec.month)
    const day = date.slice(0, 10)
    const fy = years.find(y => day >= y.start_date && day <= y.end_date)
    // Same default as the database: Nehase when no fiscal year covers it.
    return (fy?.pagume_attaches_to ?? 'nehase') === 'meskerem'
      ? ecPeriodLabel(ec.year + 1, 1)
      : ecPeriodLabel(ec.year, 12)
  }, [years])
}
