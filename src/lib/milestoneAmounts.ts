// Client-side preview of recompute_all_contract_milestone_amounts, used ONLY
// to show amounts live as someone types a percentage into the milestone form.
//
// The database is authoritative: every stored amount is written by that
// trigger, never by the client.
//
// This file used to hold its own copy of the tax rule -- VAT 15%, WHT
// threshold 20,000, default WHT 3% -- which had to be "kept in step" with
// the SQL by hand. It now holds none of it. The contract's WHT basis (pre-VAT
// base, whether WHT applies, the rate) comes from contract_wht_basis(), the
// same function the trigger calls (migration 310), and all that is left here
// is splitting that basis by the milestone's percentage.
//
//   gross     = contract_value * pct / 100   — what is invoiced (as entered)
//   grossExVat= base_ex_vat    * pct / 100   — base for retention AND wht
//   retention = grossExVat * retention_percent / 100
//   wht       = wht_applies ? grossExVat * rate_fraction : 0
//   net       = gross - retention - wht

import type { ContractWhtBasis } from '@/types/database'

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

const ZERO: MilestoneAmounts = { gross: 0, grossExclVat: 0, retention: 0, wht: 0, net: 0, whtApplies: false }

export function computeMilestoneAmounts(
  terms: ContractTerms,
  basis: ContractWhtBasis | null,
  percent: number,
): MilestoneAmounts {
  const cv = Number(terms.contract_value ?? 0)
  if (!cv || !percent || percent <= 0 || !basis || basis.base_ex_vat == null) return ZERO

  const baseCv = Number(basis.base_ex_vat)
  const whtApplies = !!basis.wht_applies
  const rate = Number(basis.rate_fraction ?? 0)
  const retPct = terms.retention_percent ?? 0

  const gross = round2((cv * percent) / 100)
  const grossExclVat = round2((baseCv * percent) / 100)
  const retention = round2(((baseCv * percent) / 100) * (retPct / 100))
  const wht = whtApplies ? round2(((baseCv * percent) / 100) * rate) : 0

  return { gross, grossExclVat, retention, wht, net: round2(gross - retention - wht), whtApplies }
}
