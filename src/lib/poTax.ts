// A PO's tax arithmetic — the figures the printed PO shows, and the ones an
// expense raised from it must carry. The database has the same rule in
// po_expense_tax() (migration 341), which the GRN trigger uses; keep the two
// in step.

export const VAT_RATE = 0.15
export const WHT_RATE = 0.03
// Ethiopian withholding rule: a purchase only falls in the WHT bracket once
// its subtotal (goods/services value before VAT) exceeds this floor. Below
// it, no WHT applies regardless of the vendor's tax-registration status.
export const WHT_SUBTOTAL_THRESHOLD = 20000

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * VAT, gross and WHT for a PO subtotal (after any vendor discount). The
 * expense is the gross — what the vendor invoices — and the WHT is withheld
 * from it at payment, so gross − WHT is what actually goes to the vendor.
 */
export function poTax(subtotal: number, vendorWhtEligible: boolean) {
  const vat = round2(subtotal * VAT_RATE)
  const gross = round2(subtotal) + vat
  const wht = vendorWhtEligible && subtotal > WHT_SUBTOTAL_THRESHOLD ? round2(subtotal * WHT_RATE) : 0
  return { vat, gross, wht }
}
