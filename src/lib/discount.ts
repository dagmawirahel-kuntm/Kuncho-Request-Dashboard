// Discounts on proformas (migration 383). One discount on the whole job, a
// percentage or a fixed amount in ETB, taken off before VAT. The database
// checks the same arithmetic, so round the same way it does: to the cent.

export type DiscountKind = 'percent' | 'amount'

export interface Discount {
  kind: DiscountKind
  value: number
  reason?: string | null
}

const cents = (n: number) => Math.round(n * 100) / 100

/** The discount in ETB (before VAT), never more than the lines themselves. */
export function discountAmount(linesTotal: number, d: Discount | null | undefined): number {
  // Work from the lines in cents, as the database stores them, so a
  // percentage lands on exactly the figure it checks against.
  const lines = cents(linesTotal)
  if (!d || !(d.value > 0) || !(lines > 0)) return 0
  const raw = d.kind === 'percent' ? cents((lines * Math.min(d.value, 100)) / 100) : cents(d.value)
  return Math.min(raw, lines)
}

/** The discount as a percentage of the lines, to two places. */
export function discountPercent(linesTotal: number, amount: number): number {
  return linesTotal > 0 ? Math.round((amount / linesTotal) * 10000) / 100 : 0
}

/** "10%" or "ETB 5,000" — how the discount was expressed. */
export function discountLabel(d: Discount): string {
  return d.kind === 'percent'
    ? `${Number(d.value)}%`
    : `ETB ${Number(d.value).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

/** The approval limit when the company profile doesn't say (migration 383). */
export const DEFAULT_DISCOUNT_LIMIT = 10

/** Totals with the discount taken off before VAT. */
export function discountedTotals(linesTotal: number, d: Discount | null | undefined, vatRate: number) {
  const amount = discountAmount(linesTotal, d)
  const subtotal = cents(linesTotal - amount)
  const vat = cents(subtotal * vatRate)
  return { linesTotal: cents(linesTotal), amount, percent: discountPercent(linesTotal, amount), subtotal, vat, total: cents(subtotal + vat) }
}
