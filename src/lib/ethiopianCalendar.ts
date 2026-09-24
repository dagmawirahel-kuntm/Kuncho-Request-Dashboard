// Gregorian <-> Ethiopian (Amete Mihret) calendar conversion.
//
// Uses the Julian Day Number as a common intermediate so both directions
// share one well-tested astronomical algorithm (Fliegel & Van Flandern,
// 1968) for the Gregorian side. The Ethiopian epoch (JDN 1724221) is the
// proleptic-Gregorian equivalent of 29 Aug 8 CE (Julian) — 1 Meskerem,
// Ethiopian year 1 — and has been cross-checked against two independent
// public reference points: Ethiopian Christmas (Tahsas 29) landing on
// 7 Jan in non-shifted years, and the Ethiopian Millennium new year.
// Round-trip tested across 1980-2040 with zero mismatches.

export const ETHIOPIAN_MONTHS = [
  'Meskerem', 'Tikimt', 'Hidar', 'Tahsas', 'Tir', 'Yekatit',
  'Megabit', 'Miazia', 'Ginbot', 'Sene', 'Hamle', 'Nehase', 'Pagume',
]

export const ETHIOPIAN_MONTHS_SHORT = [
  'Mesk', 'Tik', 'Hid', 'Tahs', 'Tir', 'Yek',
  'Meg', 'Miaz', 'Gin', 'Sene', 'Ham', 'Nehs', 'Pag',
]

export interface EthiopianDate {
  year: number
  month: number  // 1-13 (13 = Pagume)
  day: number    // 1-30 (1-5, or 1-6 in an Ethiopian leap year, for Pagume)
}

const ETHIOPIAN_EPOCH_JDN = 1724221

function gregorianToJDN(year: number, month: number, day: number): number {
  const a = Math.floor((14 - month) / 12)
  const y = year + 4800 - a
  const m = month + 12 * a - 3
  return day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045
}

function jdnToGregorian(jdn: number): { year: number; month: number; day: number } {
  const a = jdn + 32044
  const b = Math.floor((4 * a + 3) / 146097)
  const c = a - Math.floor((146097 * b) / 4)
  const d = Math.floor((4 * c + 3) / 1461)
  const e = c - Math.floor((1461 * d) / 4)
  const m = Math.floor((5 * e + 2) / 153)
  const day = e - Math.floor((153 * m + 2) / 5) + 1
  const month = m + 3 - 12 * Math.floor(m / 10)
  const year = 100 * b + d - 4800 + Math.floor(m / 10)
  return { year, month, day }
}

function ethiopianToJDN(year: number, month: number, day: number): number {
  return ETHIOPIAN_EPOCH_JDN + 365 * (year - 1) + Math.floor(year / 4) + 30 * (month - 1) + (day - 1)
}

function jdnToEthiopian(jdn: number): EthiopianDate {
  const n = jdn - ETHIOPIAN_EPOCH_JDN
  const cycle = Math.floor(n / 1461)
  let remainder = n - cycle * 1461
  let year = cycle * 4 + 1
  // Walk forward within this 4-year (1461-day) cycle; terminates in <=4 steps.
  for (;;) {
    const isLeap = year % 4 === 3
    const yearLen = isLeap ? 366 : 365
    if (remainder < yearLen) break
    remainder -= yearLen
    year++
  }
  const month = Math.floor(remainder / 30) + 1
  const day = (remainder % 30) + 1
  return { year, month, day }
}

/** Convert a Gregorian date (Date object, or 'YYYY-MM-DD' string) to Ethiopian. */
export function toEthiopian(date: Date | string): EthiopianDate {
  const d = typeof date === 'string' ? new Date(date + (date.length === 10 ? 'T00:00:00' : '')) : date
  return jdnToEthiopian(gregorianToJDN(d.getFullYear(), d.getMonth() + 1, d.getDate()))
}

/** Convert an Ethiopian date to a Gregorian Date object. */
export function toGregorian(year: number, month: number, day: number): Date {
  const { year: gy, month: gm, day: gd } = jdnToGregorian(ethiopianToJDN(year, month, day))
  return new Date(gy, gm - 1, gd)
}

export function isEthiopianLeapYear(year: number): boolean {
  return year % 4 === 3
}

/** e.g. "27 Sene 2018" */
export function formatEthiopian(date: Date | string, short = false): string {
  const { year, month, day } = toEthiopian(date)
  const names = short ? ETHIOPIAN_MONTHS_SHORT : ETHIOPIAN_MONTHS
  return `${day} ${names[month - 1]} ${year}`
}

// ── Tax filing period labels ─────────────────────────────────────────────
// Filing periods are named by Ethiopian month and year and never by a
// Gregorian month. These reuse the conversion above rather than adding a
// second one.
//
// The database carries its own copy of this arithmetic (migration 301:
// ec_to_gregorian, gregorian_to_ec, ec_month_start_greg, ec_month_end_greg),
// because a generated column and an RPC both need it server-side. The two
// are the same formula — same epoch (JDN 1724221), and `year % 4 === 3`
// here is `(year + 1) % 4 = 0` there — and both were verified against the
// same anchors including the Pagume leap edges. Anything that decides a
// stored date asks the database; this side is for display.

/** Month index is 1-13, matching the database's ec_month_name(). */
export function ecMonthName(month: number): string {
  return ETHIOPIAN_MONTHS[month - 1] ?? `Month ${month}`
}

/**
 * The label shown wherever a filing period appears. Mirrors the
 * tax_filings.period_label generated column so the UI and the database
 * agree exactly: "Nehase 2018" for a monthly period, "2018 E.C." for an
 * annual one.
 */
export function ecPeriodLabel(ecYear: number, ecMonth: number | null): string {
  return ecMonth == null ? `${ecYear} E.C.` : `${ecMonthName(ecMonth)} ${ecYear}`
}

/** Days in an Ethiopian month: 30 for all but Pagume, which has 5 or 6. */
export function ecMonthLength(ecYear: number, ecMonth: number): number {
  return ecMonth === 13 ? (isEthiopianLeapYear(ecYear) ? 6 : 5) : 30
}

/**
 * The Ethiopian period a Gregorian date falls in, e.g. "Hamle 2018" — i.e.
 * the monthly VAT / WHT / payroll return it belongs to. Same rule the
 * database views use (gregorian_to_ec), for display beside a record's date.
 */
export function ecPeriodLabelForDate(date: string | null | undefined): string | null {
  if (!date) return null
  const ec = toEthiopian(date)
  return ecPeriodLabel(ec.year, ec.month)
}
