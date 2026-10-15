// What clients keep back when they pay (migration 455).
//
// A payment that arrives short of the invoice is split into income tax
// withheld (3% of the pre-VAT amount — a credit against profit tax), VAT
// withheld (government bodies keep 7.5% of the pre-VAT amount, half the VAT,
// and it comes off the VAT return), and a transfer charge the payer's bank
// took (up to 500). Anything more is still owed.

import type { WithholdingProfile } from '@/types/database'

export const WITHHOLDING_PROFILES: { value: WithholdingProfile; label: string; hint: string }[] = [
  { value: 'income_tax', label: '3% income tax', hint: 'Keeps 3% of the pre-VAT amount and gives a withholding certificate' },
  { value: 'government', label: 'Government: 3% + VAT withheld', hint: 'Keeps 3% income tax and 7.5% of the pre-VAT amount (half the VAT)' },
  { value: 'none', label: 'Pays in full', hint: 'Not a withholding agent — individuals, small businesses' },
]

export function withholdingProfileLabel(p: WithholdingProfile | null | undefined, businessType?: string | null) {
  const eff = p ?? (businessType === 'Government' ? 'government' : 'income_tax')
  return WITHHOLDING_PROFILES.find(x => x.value === eff)?.label ?? eff
}

export const RECEIPT_CHARGE_TOLERANCE = 500
