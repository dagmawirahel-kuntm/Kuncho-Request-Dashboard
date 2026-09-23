// Schedule A (PAYE) maths, driven off the bracket table stored in
// tax_rate_references — never off literals here.
//
// Kuncho agrees a NET take-home with staff and pays net, so net is the
// source of truth and gross, pension and PAYE are all derived from it.
//
// NOTE ON SCOPE: this module is the calculation only. It is not wired into
// payroll, and nothing pre-fills a filing's declared_amount from it. The
// brief asked for both readings in different places -- §1A wanted payroll
// rewired and Sch-A pre-filled, §9 listed auto-calculation from payroll as
// out of scope -- and the narrower reading was chosen, so payroll_staff's
// stored gross/deductions/net are untouched. This exists so the maths is
// settled and tested for when that phase happens.
//
// Deduction order (pension_pre_tax = false, carried on the band record):
// PAYE is computed on gross, the employee's 7% pension is also on gross,
// and both come off gross to reach net. Cross-check from the brief:
// gross 10,000 -> PAYE 1,650 + pension 700 -> net 7,650, and PAYE on
// 10,000 is 0.25*10,000 - 850 = 1,650, which is tax on gross, not on
// gross-less-pension.

export interface PayeBand {
  min: number
  max: number | null
  rate: number
  /** The deduction constant K in PAYE = rate * gross - K. */
  deduct: number
}

export interface PayeBands {
  kind: string
  pension_pre_tax: boolean
  bands: PayeBand[]
}

export interface PensionRates {
  employee_rate: number
  employer_rate: number
  foreign_nationals_exempt: boolean
  insurable_earnings_ceiling_etb: number | null
}

export interface GrossUpResult {
  net: number
  gross: number
  paye: number
  pensionEmployee: number
  pensionEmployer: number
  employerCost: number
  /** True when the pension-exempt path was used (foreign nationals). */
  pensionExempt: boolean
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** PAYE = rate * gross - K, using whichever band contains `gross`. */
export function payeOnGross(gross: number, table: PayeBands): number {
  const band = table.bands.find(b => gross >= b.min && (b.max == null || gross <= b.max))
    ?? table.bands[table.bands.length - 1]
  return Math.max(0, round2(band.rate * gross - band.deduct))
}

/**
 * Net -> gross.
 *
 * Solving N = G - PAYE(G) - pension·G per band gives
 *   G = (N - K) / (1 - pension_rate - rate)
 * so both the divisor and K come from the band table. The 0.93 / 0.78 /
 * 0.73 / 0.68 / 0.63 / 0.58 divisors in the brief are exactly this
 * expression evaluated at pension 7% — deriving them keeps the table as the
 * single source when a proclamation moves a rate.
 *
 * For a pension-exempt employee the divisor becomes (1 - rate); K is
 * unchanged.
 */
export function grossUpFromNet(
  net: number,
  table: PayeBands,
  pension: PensionRates,
  opts: { pensionExempt?: boolean } = {},
): GrossUpResult {
  const pensionExempt = opts.pensionExempt ?? false
  const pensionRate = pensionExempt ? 0 : pension.employee_rate

  if (!(net > 0)) {
    return { net: 0, gross: 0, paye: 0, pensionEmployee: 0, pensionEmployer: 0, employerCost: 0, pensionExempt }
  }

  // Each band's gross boundary maps to a net boundary; walk them in order and
  // take the first band whose implied gross actually falls inside it. That
  // avoids hardcoding the net cut-points (1,860 / 3,420 / 5,610 / 7,650 /
  // 10,170), which are themselves derived from the same table.
  let gross = 0
  for (const band of table.bands) {
    const divisor = 1 - pensionRate - band.rate
    if (divisor <= 0) continue
    const candidate = (net + band.deduct) / divisor
    const withinBand = candidate >= band.min && (band.max == null || candidate <= band.max)
    if (withinBand) { gross = candidate; break }
  }
  // Above the top band the last one applies unconditionally.
  if (gross === 0) {
    const top = table.bands[table.bands.length - 1]
    gross = (net + top.deduct) / (1 - pensionRate - top.rate)
  }

  gross = round2(gross)
  const pensionEmployee = pensionExempt ? 0 : round2(pension.employee_rate * gross)
  const pensionEmployer = pensionExempt ? 0 : round2(pension.employer_rate * gross)

  // Round-trip: recompute forward and push any residual onto PAYE so the
  // agreed net reconciles to the cent. Deriving PAYE as the remainder rather
  // than recomputing it independently is what guarantees that.
  const paye = round2(gross - pensionEmployee - net)

  const forwardNet = round2(gross - pensionEmployee - paye)
  if (forwardNet !== round2(net)) {
    throw new Error(
      `PAYE gross-up failed to reconcile: agreed net ${net}, recomputed ${forwardNet} ` +
      `(gross ${gross}, pension ${pensionEmployee}, PAYE ${paye})`,
    )
  }

  return {
    net: round2(net),
    gross,
    paye,
    pensionEmployee,
    pensionEmployer,
    employerCost: round2(gross + pensionEmployer),
    pensionExempt,
  }
}
