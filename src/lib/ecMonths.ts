import { toEthiopian, toGregorian, ecMonthLength, ecPeriodLabel } from '@/lib/ethiopianCalendar'

// Month-end works in Ethiopian months (finance's periods).

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export interface EcMonth { year: number; month: number; from: string; to: string; label: string }

// Pagume is part of Nehase (fiscal_periods.pagume_attaches_to = 'nehase'),
// so Nehase's month-end runs to the last day of Pagume.
function ecMonth(year: number, month: number, suffix = ''): EcMonth {
  const lastMonth = month === 12 ? 13 : month
  return {
    year, month,
    from: isoDate(toGregorian(year, month, 1)),
    to: isoDate(toGregorian(year, lastMonth, ecMonthLength(year, lastMonth))),
    label: ecPeriodLabel(year, month) + suffix,
  }
}

// The month in progress, then the last twelve that have ended, newest first.
export function recentEcMonths(): EcMonth[] {
  const today = toEthiopian(new Date())
  let y = today.year
  let m = today.month === 13 ? 12 : today.month
  const out: EcMonth[] = [ecMonth(y, m, ' (in progress)')]
  while (out.length < 13) {
    m -= 1
    if (m < 1) { m = 12; y -= 1 }
    out.push(ecMonth(y, m))
  }
  return out
}

/** The last Ethiopian month that has ended. */
export function lastEndedEcMonth(): EcMonth {
  return recentEcMonths()[1]
}
