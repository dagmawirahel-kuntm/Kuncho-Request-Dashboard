import { createContext, useContext, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'

interface FiscalPeriod {
  id: string
  label: string
  start_date: string
  end_date: string
  is_current: boolean
}

interface FiscalYearContextValue {
  periods: FiscalPeriod[]
  current: FiscalPeriod | undefined
  /** The dropdown's raw value: a fiscal_periods.id, or 'all'. */
  value: string
  /** Only takes effect for admin — see canToggle. */
  setValue: (v: string) => void
  /** The id to filter queries by, or null for "no filter" (all time). */
  fiscalPeriodId: string | null
  /** Only admin can move off the current fiscal year. */
  canToggle: boolean
}

const FiscalYearContext = createContext<FiscalYearContextValue | null>(null)

const STORAGE_KEY = 'fiscal-year-filter'

/**
 * One global fiscal-year selector for the whole app (AppShell header),
 * replacing what used to be a separate dropdown per page. Every list this
 * feeds (Sales, Tax Summary, Transfers, Cash Advances, Timesheet, Expenses
 * Records tab) reads from here instead of owning its own filter state.
 *
 * Access rule: only admin can move off the current fiscal year. Every other
 * role is hard-locked to the current period regardless of what's in
 * localStorage or what this context's own state says — the effective
 * fiscalPeriodId ignores the stored selection entirely for non-admins, it's
 * not just a default they could override client-side.
 *
 * Never consumed by the project workspace or budget-vs-actual views — those
 * keep aggregating a project's full history unconditionally, independent of
 * this control.
 */
export function FiscalYearProvider({ children }: { children: React.ReactNode }) {
  const { role } = useAuth()
  const canToggle = role === 'admin'

  const { data: periods = [] } = useQuery({
    queryKey: ['fiscal-periods'],
    staleTime: 300000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fiscal_periods')
        .select('id,label,start_date,end_date,is_current')
        .order('start_date', { ascending: false })
      if (error) throw error
      return data as FiscalPeriod[]
    },
  })

  const current = periods.find(p => p.is_current)

  const [selected, setSelected] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY))

  // Once periods load, fall back to the current FY if nothing (valid) is stored.
  useEffect(() => {
    if (!current) return
    if (selected === null) { setSelected(current.id); return }
    if (selected !== 'all' && !periods.some(p => p.id === selected)) setSelected(current.id)
  }, [current, periods, selected])

  useEffect(() => {
    if (selected !== null) localStorage.setItem(STORAGE_KEY, selected)
  }, [selected])

  function setValue(v: string) {
    if (!canToggle) return
    setSelected(v)
  }

  // Non-admins are hard-locked to the current FY — the stored/selected value
  // is never consulted for them, so there's no client-side path to see
  // legacy data by poking localStorage.
  const effectiveValue = canToggle ? (selected ?? current?.id ?? 'all') : (current?.id ?? 'all')
  const fiscalPeriodId = effectiveValue === 'all' ? null : effectiveValue

  return (
    <FiscalYearContext.Provider value={{ periods, current, value: effectiveValue, setValue, fiscalPeriodId, canToggle }}>
      {children}
    </FiscalYearContext.Provider>
  )
}

export function useFiscalYear() {
  const ctx = useContext(FiscalYearContext)
  if (!ctx) throw new Error('useFiscalYear must be used within a FiscalYearProvider')
  return ctx
}
