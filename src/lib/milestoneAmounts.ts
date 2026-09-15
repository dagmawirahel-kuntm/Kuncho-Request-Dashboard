// Client-side mirror of recompute_all_contract_milestone_amounts
// (migration 233), used ONLY to preview amounts live as someone types a
// percentage into the milestone form.
//
// The database is authoritative: every stored amount is written by that
// trigger, never by the client. This exists so the form can show what the
// numbers will become before the row is saved. Keep the two in step — if
// the SQL changes, change this with it.
//
// Derivation (identical to the migration's):
//   base_cv   = includes_vat ? contract_value / 1.15 : contract_value
//   whtApplies= base_cv >= 20,000          (tested at CONTRACT level, so a
//                                           small milestone still carries its
//                                           share of a qualifying contract)
//   gross     = contract_value * pct / 100   — what is invoiced (as entered)
//   grossExVat= base_cv        * pct / 100   — base for retention AND wht
//   retention = grossExVat * retention_percent / 100
//   wht       = whtApplies ? grossExVat * wht_rate / 100 : 0
//   net       = gross - retention - wht

export const VAT_RATE = 0.15
export const WHT_THRESHOLD_ETB = 20_000
// Matches the SQL's COALESCE(wht_rate, 3) — i.e. 3%, the same effective rate
// as ClientDetailPage's WHT_RATE = 0.03 fallback, expressed as a percentage.
export const DEFAULT_WHT_RATE_PCT = 3

export interface ContractTerms {
  contract_value: number | null
  contract_value_includes_vat: boolean | null
  wht_rate: number | null
  retention_percent: number | null
}

export interface MilestoneAmounts {
  gross: number
  grossExclVat: number
  retention: number
  wht: number
  net: number
  whtApplies: boolean
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function computeMilestoneAmounts(terms: ContractTerms, percent: number): MilestoneAmounts {
  const cv = Number(terms.contract_value ?? 0)
  if (!cv || !percent || percent <= 0) {
    return { gross: 0, grossExclVat: 0, retention: 0, wht: 0, net: 0, whtApplies: false }
  }

  const baseCv = terms.contract_value_includes_vat ? cv / (1 + VAT_RATE) : cv
  const whtApplies = baseCv >= WHT_THRESHOLD_ETB
  const ratePct = terms.wht_rate ?? DEFAULT_WHT_RATE_PCT
  const retPct = terms.retention_percent ?? 0

  const gross = round2((cv * percent) / 100)
  const grossExclVat = round2((baseCv * percent) / 100)
  const retention = round2(((baseCv * percent) / 100) * (retPct / 100))
  const wht = whtApplies ? round2(((baseCv * percent) / 100) * (ratePct / 100)) : 0

  return { gross, grossExclVat, retention, wht, net: round2(gross - retention - wht), whtApplies }
}
