// Shared words and checks for purchase requests and purchase orders.
//
// A "sourcing bundle" in the database is a purchase order on screen: one
// vendor, one order, built from lines of one or more purchase requests.

import type { SourcingBundleStatus } from '@/types/database'
import type { Tone } from '@/components/record/Record'

export const PO_STATUS: Record<SourcingBundleStatus, { label: string; tone: Tone }> = {
  drafting:  { label: 'Drafting',          tone: 'slate' },
  submitted: { label: 'Awaiting finance',  tone: 'amber' },
  approved:  { label: 'Finance approved',  tone: 'blue' },
  ordered:   { label: 'Ordered',           tone: 'violet' },
  fulfilled: { label: 'Received',          tone: 'green' },
  cancelled: { label: 'Cancelled',         tone: 'red' },
}

/**
 * A PO line priced this much (percent) or more above the request's own
 * estimate is flagged, so whoever approves the order sees it.
 */
export const PRICE_CHECK_PERCENT = 15

/** How far the ordered unit price is above the request's estimate, in percent — null when there's nothing to compare or it isn't over the line. */
export function priceOverEstimate(estimate: number | null | undefined, actual: number | null | undefined): number | null {
  const est = Number(estimate ?? 0)
  const act = Number(actual ?? 0)
  if (!(est > 0) || !(act > 0)) return null
  const pct = ((act - est) / est) * 100
  return pct >= PRICE_CHECK_PERCENT ? Math.round(pct) : null
}
