// Turns a tax_rate_references.rate_note into a one-line hint for the filing
// form.
//
// rate_note is deliberately free-form: a flat rate, a contribution pair, a
// mixed set of per-category rates, or Schedule A's full bracket table all
// live in the same column. Rather than switch on every `kind` and go stale
// the moment a new one is seeded, this walks whatever numeric fields the
// object has and labels them from their own keys. A shape nobody wrote code
// for still renders something true.
//
// Rates are stored as FRACTIONS (0.15, not 15) — the same convention the
// bracket table uses, so the gross-up maths and this display agree.

const PERCENT_KEYS_TO_SKIP = new Set([
  'kind', 'currency', 'pension_pre_tax', 'note', 'bands',
  'registration_threshold_etb', 'threshold_window_months',
  'insurable_earnings_ceiling_etb', 'ceiling_note',
  'foreign_nationals_exempt', 'withholding_threshold_etb',
])

function humanise(key: string): string {
  return key.replace(/_rate$/, '').replace(/_/g, ' ')
}

function pct(n: number): string {
  // 0.075 -> "7.5%", 0.15 -> "15%"
  const v = n * 100
  return `${Number.isInteger(v) ? v : Number(v.toFixed(2))}%`
}

/** Short human summary of a rate reference, or null if there is nothing to say. */
export function summariseRateNote(note: Record<string, unknown> | null | undefined): string | null {
  if (!note || typeof note !== 'object') return null

  const parts: string[] = []

  if (Array.isArray(note.bands) && note.bands.length > 0) {
    const bands = note.bands as { rate: number }[]
    const lo = Math.min(...bands.map(b => b.rate))
    const hi = Math.max(...bands.map(b => b.rate))
    parts.push(`${bands.length} bands, ${pct(lo)}–${pct(hi)}`)
  }

  for (const [key, value] of Object.entries(note)) {
    if (PERCENT_KEYS_TO_SKIP.has(key)) continue
    if (typeof value !== 'number') continue
    // Anything above 1 is not a fraction — it is a money threshold that
    // happened to miss the skip list. Show it as-is rather than as 200000%.
    parts.push(value <= 1 ? `${humanise(key)} ${pct(value)}` : `${humanise(key)} ${value.toLocaleString()}`)
  }

  if (typeof note.withholding_threshold_etb === 'number') {
    parts.push(`applies at/above ETB ${note.withholding_threshold_etb.toLocaleString()}`)
  }
  if (typeof note.registration_threshold_etb === 'number') {
    parts.push(`registration threshold ETB ${note.registration_threshold_etb.toLocaleString()}`)
  }

  const summary = parts.join(' · ')
  const extra = typeof note.note === 'string' ? note.note : null

  if (!summary) return extra
  return extra ? `${summary} — ${extra}` : summary
}
