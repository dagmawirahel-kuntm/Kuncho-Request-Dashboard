// Amount in words for payment vouchers.
//
// A payment authorisation that only carries a numeral is trivially
// altered — 8,000 becomes 18,000 with one pen stroke, and Ethiopian
// banks routinely reject vouchers that lack the written amount. Every
// Payment Request therefore restates its total in words, which is why
// this lives in lib/ rather than inside one document template.
//
// Deliberately small and dependency-free: it handles the range a
// construction payment actually occupies (up to hundreds of millions)
// and formats cents as "and NN/100", the convention used on the
// company's existing hand-written vouchers.

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
]
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

// Scale words are applied largest-first, so the list is ordered to match.
const SCALES: { value: number; name: string }[] = [
  { value: 1_000_000_000, name: 'Billion' },
  { value: 1_000_000,     name: 'Million' },
  { value: 1_000,         name: 'Thousand' },
]

function under1000(n: number): string {
  if (n === 0) return ''
  if (n < 20) return ONES[n]
  if (n < 100) {
    const t = TENS[Math.floor(n / 10)]
    const o = n % 10
    return o ? `${t}-${ONES[o]}` : t
  }
  const h = `${ONES[Math.floor(n / 100)]} Hundred`
  const rest = n % 100
  return rest ? `${h} ${under1000(rest)}` : h
}

function wholeToWords(n: number): string {
  if (n === 0) return 'Zero'
  const parts: string[] = []
  let remaining = n
  for (const { value, name } of SCALES) {
    if (remaining >= value) {
      const count = Math.floor(remaining / value)
      parts.push(`${under1000(count)} ${name}`)
      remaining %= value
    }
  }
  if (remaining > 0) parts.push(under1000(remaining))
  return parts.join(' ')
}

/**
 * "8,540.75" -> "Eight Thousand Five Hundred Forty and 75/100 Birr"
 *
 * Returns an empty string for null/NaN so a caller can omit the line
 * entirely rather than printing "Zero Birr" on a document that simply
 * has not been totalled yet. Negative totals are prefixed "Minus" —
 * they should not occur on a Payment Request, but silently dropping the
 * sign on a financial document is worse than printing an odd one.
 */
export function amountInWords(amount: number | null | undefined, currencyWord = 'Birr'): string {
  if (amount == null || !Number.isFinite(amount)) return ''

  const negative = amount < 0
  const abs = Math.abs(amount)

  // Round to cents first: doing it after the split lets 0.999 print as
  // "Zero and 100/100".
  const totalCents = Math.round(abs * 100)
  const whole = Math.floor(totalCents / 100)
  const cents = totalCents % 100

  // Above the Billion scale the words stop being useful on a voucher and
  // start being a liability, so fall back to the numeral rather than
  // producing something a bank clerk cannot check.
  if (whole >= 1_000_000_000_000) return ''

  const words = wholeToWords(whole)
  const centsPart = cents > 0 ? ` and ${String(cents).padStart(2, '0')}/100` : ''
  return `${negative ? 'Minus ' : ''}${words}${centsPart} ${currencyWord}`
}
