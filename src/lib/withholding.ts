// Withholding tax on vendor payments.
//
// Every WHT figure recorded so far is 3% of the VAT-exclusive amount — the
// purchase-order screen's rule, and what the WHT return has been filed on.
// That is the standard rate proposed here.
//
// A payee who gives no TIN is withheld at a much higher rate (30% is the
// figure generally applied in Ethiopia). It is offered, never assumed: the
// system has no record of whether a payee declined to give a TIN or simply
// hasn't had one entered, and that is for the person paying to confirm.
//
// Nothing records whether an amount includes VAT either, so that is a
// choice too. It defaults on for a vendor with a TIN (VAT registration
// requires one) and off for one without.

export const VAT_RATE = 0.15

export const WHT_RATES = {
  standard: { rate: 0.03, label: '3% — standard' },
  no_tin:   { rate: 0.30, label: '30% — payee gave no TIN' },
} as const

export type WhtRateKey = keyof typeof WHT_RATES

const round2 = (n: number) => Math.round(n * 100) / 100

/** The base withholding is charged on: the amount without its VAT. */
export function whtBase(gross: number, includesVat: boolean): number {
  return includesVat ? gross / (1 + VAT_RATE) : gross
}

export function proposeWht(gross: number, includesVat: boolean, rate: number): number {
  return round2(whtBase(gross, includesVat) * rate)
}
