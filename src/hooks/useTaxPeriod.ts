import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toEthiopian, toGregorian, ecMonthLength, ecPeriodLabel } from '@/lib/ethiopianCalendar'

interface FyPagume {
  start_date: string
  end_date: string
  pagume_attaches_to: 'nehase' | 'meskerem'
}

export interface TaxPeriod {
  year: number
  month: number
  /** "2019-02": sorts in time order. */
  key: string
  /** "Tikimt 2019" */
  label: string
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function taxPeriod(year: number, month: number): TaxPeriod {
  return { year, month, key: `${year}-${String(month).padStart(2, '0')}`, label: ecPeriodLabel(year, month) }
}

function usePagumeYears() {
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
  return years
}

/**
 * The TAX period (Ethiopian month) a date is declared in, and each period's
 * first and last Gregorian day. Mirrors tax_period_for_date() and
 * tax_period_bounds() (migration 315), which every tax view and the
 * month-end close group by: the calendar month, except that Pagume goes
 * with Nehase or with the next Meskerem as the fiscal year decides.
 */
export function useTaxPeriods() {
  const years = usePagumeYears()
  // Same default as the database: Nehase when no fiscal year covers it.
  const pagumeTo = useCallback((ecYear: number): 'nehase' | 'meskerem' => {
    const day = iso(toGregorian(ecYear, 13, 1))
    return years.find(y => day >= y.start_date && day <= y.end_date)?.pagume_attaches_to ?? 'nehase'
  }, [years])

  const periodOf = useCallback((date: string | null | undefined): TaxPeriod | null => {
    if (!date) return null
    const ec = toEthiopian(date.slice(0, 10))
    if (ec.month !== 13) return taxPeriod(ec.year, ec.month)
    return pagumeTo(ec.year) === 'meskerem' ? taxPeriod(ec.year + 1, 1) : taxPeriod(ec.year, 12)
  }, [pagumeTo])

  /** First and last Gregorian day of a tax period, Pagume included where it belongs. */
  const rangeOf = useCallback((year: number, month: number): { from: string; to: string } => {
    const from = month === 1 && pagumeTo(year - 1) === 'meskerem'
      ? toGregorian(year - 1, 13, 1)
      : toGregorian(year, month, 1)
    const to = month === 12 && pagumeTo(year) === 'nehase'
      ? toGregorian(year, 13, ecMonthLength(year, 13))
      : toGregorian(year, month, 30)
    return { from: iso(from), to: iso(to) }
  }, [pagumeTo])

  return { periodOf, rangeOf }
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
  const { periodOf } = useTaxPeriods()
  return useCallback((date: string | null | undefined): string | null => periodOf(date)?.label ?? null, [periodOf])
}
