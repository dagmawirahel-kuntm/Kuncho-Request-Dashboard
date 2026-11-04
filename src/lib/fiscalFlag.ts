// Flagging dates outside the fiscal year being worked in. A statement can
// reach back into last year (Abyssinia's runs from July 2025); its lines
// belong to that year's books, and counted with this year's they mislead.
// The year is the one chosen in the header (the current one for everyone
// but admin); with "All years" chosen, dates are compared to the current one.

import { useFiscalYear } from '@/contexts/FiscalYearContext'

export interface FyFlag {
  /** The year being worked in. */
  fy: { label: string; start_date: string; end_date: string } | null
  /** The date is outside that year. */
  outside: (date: string | null | undefined) => boolean
  /** The fiscal year a date falls in, e.g. FY2025/26. */
  fyOf: (date: string) => string
}

/** Ethiopia's year runs 1 Hamle – 30 Sene: 8 July to 7 July. */
function fyLabelFor(date: string): string {
  const y = Number(date.slice(0, 4))
  const start = date.slice(5) >= '07-08' ? y : y - 1
  return `FY${start}/${String(start + 1).slice(2)}`
}

export function useFyFlag(): FyFlag {
  const { periods, fiscalPeriodId, current } = useFiscalYear()
  const fy = (fiscalPeriodId ? periods.find(p => p.id === fiscalPeriodId) : null) ?? current ?? null
  return {
    fy,
    outside: d => !!fy && !!d && (d < fy.start_date || d > fy.end_date),
    fyOf: d => periods.find(p => d >= p.start_date && d <= p.end_date)?.label ?? fyLabelFor(d),
  }
}
