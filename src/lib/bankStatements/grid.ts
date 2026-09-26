// Every statement — CBE's CSV, another bank's Excel, a PDF — is first read
// into a grid of text cells, row by row. This file turns such a grid into
// statement lines: it finds the header row, works out which column is which
// (or takes the layout finance mapped by hand), reads dates and amounts in
// the forms Ethiopian banks use, and checks the running balance.
//
// Nothing here is bank-specific. The header words cover CBE, Awash, Abyssinia,
// Dashen, Tsedey and the rest as far as their exports have been seen; a layout
// that isn't recognised is mapped once in the UI and saved for that account.

export interface StatementLine {
  valueDate: string          // ISO date
  postDate: string | null
  transactionType: string | null
  narration: string | null
  debit: number | null        // money out, positive
  credit: number | null       // money in, positive
  balance: number | null      // running balance after the line
  reference: string | null
}

export type DateOrder = 'dmy' | 'mdy' | 'ymd'

/** Which grid column holds what. Column indexes are 0-based. */
export interface ColumnMapping {
  headerRow: number
  date: number
  postDate?: number | null
  type?: number | null
  narration: number[]
  reference?: number | null
  debit?: number | null
  credit?: number | null
  /** One signed amount column (negative = money out) instead of debit/credit. */
  amount?: number | null
  /** A DR/CR column that says which way an unsigned amount goes. */
  drcr?: number | null
  balance?: number | null
  dateOrder: DateOrder
}

export interface ParsedStatement {
  lines: StatementLine[]
  startingBalance: number | null
  endingBalance: number | null
  /** Running-balance breaks and other things finance should look at. */
  warnings: string[]
  /** Rows that had a date-like first cell but couldn't be read. */
  skipped: number
  reversed: boolean
}

export type Grid = string[][]

// ── Header words ────────────────────────────────────────────────────────
type Field = 'date' | 'postDate' | 'type' | 'narration' | 'reference' | 'debit' | 'credit' | 'amount' | 'drcr' | 'balance'

const HEADER_WORDS: Record<Field, string[]> = {
  date: ['valuedate', 'transactiondate', 'txndate', 'trandate', 'transdate', 'date', 'valdate', 'effectivedate'],
  postDate: ['postdate', 'postingdate', 'bookdate', 'bookingdate', 'entrydate'],
  type: ['transactiontype', 'trantype', 'txntype', 'type'],
  narration: ['narration', 'narrative', 'description', 'particulars', 'details', 'transactiondetails', 'paymentdetails',
    'remark', 'remarks', 'memo', 'transactiondescription', 'beneficiary', 'payee'],
  reference: ['reference', 'referenceno', 'referencenumber', 'ref', 'refno', 'chequeno', 'chqno', 'transactionid',
    'txnid', 'ftno', 'instrumentno', 'transactionreference', 'documentno'],
  debit: ['debit', 'debits', 'withdrawal', 'withdrawals', 'dr', 'debitamount', 'moneyout', 'paidout', 'debitetb'],
  credit: ['credit', 'credits', 'deposit', 'deposits', 'cr', 'creditamount', 'moneyin', 'paidin', 'creditetb'],
  amount: ['amount', 'transactionamount', 'amountetb'],
  drcr: ['drcr', 'debitcredit', 'crdr', 'dc'],
  balance: ['balance', 'runningbalance', 'closingbalance', 'availablebalance', 'ledgerbalance', 'balanceetb', 'bookbalance'],
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')

function fieldOf(cell: string): Field | null {
  const n = norm(cell)
  if (!n) return null
  for (const f of Object.keys(HEADER_WORDS) as Field[]) {
    if (HEADER_WORDS[f].includes(n)) return f
  }
  return null
}

/** A short, stable description of a header row, used to remember a layout. */
export function headerSignature(grid: Grid, headerRow: number): string {
  return (grid[headerRow] ?? []).map(c => norm(c)).filter(Boolean).join('|').slice(0, 300)
}

/**
 * Find the header row and read the columns off it. Returns null when no row
 * looks like a statement header — the UI then asks finance to map it.
 */
export function detectMapping(grid: Grid): ColumnMapping | null {
  let best: { row: number; hits: Partial<Record<Field, number[]>>; score: number } | null = null
  for (let r = 0; r < Math.min(grid.length, 60); r++) {
    const hits: Partial<Record<Field, number[]>> = {}
    grid[r].forEach((cell, c) => {
      const f = fieldOf(cell)
      if (f) (hits[f] ??= []).push(c)
    })
    const hasDate = !!hits.date
    const hasMoney = !!(hits.debit || hits.credit || hits.amount)
    const score = Object.keys(hits).length
    if (hasDate && hasMoney && (!best || score > best.score)) best = { row: r, hits, score }
  }
  if (!best) return null
  const h = best.hits
  // "Date" alone might be the posting date next to a "Value Date"; prefer
  // the value date as the line's date.
  return {
    headerRow: best.row,
    date: h.date![0],
    postDate: h.postDate?.[0] ?? null,
    type: h.type?.[0] ?? null,
    narration: h.narration ?? [],
    reference: h.reference?.[0] ?? null,
    debit: h.debit?.[0] ?? null,
    credit: h.credit?.[0] ?? null,
    amount: h.debit || h.credit ? null : h.amount?.[0] ?? null,
    drcr: h.drcr?.[0] ?? null,
    balance: h.balance?.[0] ?? null,
    dateOrder: guessDateOrder(grid, best.row + 1, h.date![0]),
  }
}

// ── Dates ───────────────────────────────────────────────────────────────
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}

function iso(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Reads the date forms statements use; numeric d/m order comes from the mapping. */
export function parseDate(raw: string, order: DateOrder = 'dmy'): string | null {
  const s = raw.trim()
  if (!s) return null
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/)
  if (m) return iso(+m[1], +m[2], +m[3])
  // 11 AUG 26, 11-Aug-2026, 11 August 2026
  m = s.match(/^(\d{1,2})[\s\-/.]+([A-Za-z]{3,9})[\s\-/.,]+(\d{2,4})$/)
  if (m) {
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()]
    if (mon) return iso(+m[3], mon, +m[1])
  }
  // Aug 11, 2026
  m = s.match(/^([A-Za-z]{3,9})[\s.]+(\d{1,2}),?\s+(\d{2,4})$/)
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return iso(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2])
  // 11/08/2026, 11.08.26, 2026/08/11
  m = s.match(/^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})$/)
  if (m) {
    const [a, b, c] = [+m[1], +m[2], +m[3]]
    if (m[1].length === 4) return iso(a, b, c)
    return order === 'mdy' ? iso(c, a, b) : iso(c, b, a)
  }
  // An Excel serial day number that slipped through as text.
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date(Math.round((parseFloat(s) - 25569) * 86400000))
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
  }
  return null
}

function guessDateOrder(grid: Grid, from: number, col: number): DateOrder {
  // If any numeric date has a first part over 12 it is d/m; a second part
  // over 12 means m/d. Ethiopian banks write d/m, so that is the default.
  for (let r = from; r < Math.min(grid.length, from + 200); r++) {
    const m = (grid[r]?.[col] ?? '').trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}$/)
    if (!m) continue
    if (+m[1] > 12) return 'dmy'
    if (+m[2] > 12) return 'mdy'
  }
  return 'dmy'
}

// ── Amounts ─────────────────────────────────────────────────────────────
/** "1,234.50", "(1,234.50)", "1,234.50 CR", "ETB 1 234,50-"… → signed number. */
export function parseAmount(raw: string | null | undefined): number | null {
  if (raw == null) return null
  let s = String(raw).trim()
  if (!s || s === '-' || s === '—') return null
  let sign = 1
  if (/\(.*\)/.test(s)) { sign = -1; s = s.replace(/[()]/g, '') }
  if (/\bDR\b\.?$/i.test(s) || /-$/.test(s)) { sign = -1; s = s.replace(/\bDR\b\.?$/i, '').replace(/-$/, '') }
  s = s.replace(/\bCR\b\.?$/i, '').replace(/ETB|BIRR|BR\.?/gi, '').replace(/\s/g, '')
  if (s.startsWith('-')) { sign = -sign; s = s.slice(1) }
  // A comma decimal ("1.234,50") only when there's no dot after it.
  if (/,\d{1,2}$/.test(s) && !/\.\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
  s = s.replace(/,/g, '')
  if (!/^\d+(\.\d+)?$/.test(s)) return null
  return sign * parseFloat(s)
}

const round2 = (n: number) => Math.round(n * 100) / 100

// ── Grid → lines ────────────────────────────────────────────────────────
export function applyMapping(grid: Grid, map: ColumnMapping): ParsedStatement {
  const lines: StatementLine[] = []
  const warnings: string[] = []
  let startingBalance: number | null = null
  let endingBalance: number | null = null
  let skipped = 0
  const cell = (row: string[], i: number | null | undefined) => (i == null ? '' : (row[i] ?? '').trim())
  const headerSig = headerSignature(grid, map.headerRow)

  // Statement summaries above the table often carry the opening and closing
  // balances ("Opening Balance: 6,359,691.55").
  for (let r = 0; r < map.headerRow; r++) {
    const text = (grid[r] ?? []).join(' ')
    if (/\b(opening|starting|beginning)\s+balance/i.test(text)) startingBalance = lastAmount(grid[r]) ?? startingBalance
    if (/\b(closing|ending)\s+balance/i.test(text)) endingBalance = lastAmount(grid[r]) ?? endingBalance
  }

  for (let r = map.headerRow + 1; r < grid.length; r++) {
    const row = grid[r]
    if (!row || row.every(c => !c?.trim())) continue
    // A header repeated on the next PDF page.
    if (headerSignature(grid, r) === headerSig) continue

    const first = row.map(c => c.trim()).filter(Boolean).join(' ')
    // Opening/closing balance rows carry the figure somewhere on the row.
    if (/\b(starting|opening|beginning|brought forward|b\/f)\b.*balance|^balance b\/?f/i.test(first) || /^(starting|opening) balance/i.test(cell(row, map.date))) {
      startingBalance = lastAmount(row) ?? startingBalance
      continue
    }
    if (/\b(ending|closing|carried forward|c\/f)\b.*balance/i.test(first) || /^(ending|closing) balance/i.test(cell(row, map.date))) {
      endingBalance = lastAmount(row) ?? endingBalance
      continue
    }

    const date = parseDate(cell(row, map.date), map.dateOrder)
    if (!date) {
      // A narration that ran onto the next line (common in PDFs).
      const text = map.narration.map(i => cell(row, i)).filter(Boolean).join(' ')
      const hasMoney = [map.debit, map.credit, map.amount, map.balance].some(i => parseAmount(cell(row, i)) != null)
      if (text && !hasMoney && lines.length > 0) {
        const prev = lines[lines.length - 1]
        prev.narration = [prev.narration, text].filter(Boolean).join(' ')
      } else if (hasMoney) {
        skipped++
      }
      continue
    }

    let debit: number | null = null
    let credit: number | null = null
    if (map.amount != null) {
      const a = parseAmount(cell(row, map.amount))
      if (a != null) {
        const dir = cell(row, map.drcr).toUpperCase()
        const out = dir.startsWith('D') || (!dir.startsWith('C') && a < 0)
        if (out) debit = Math.abs(a); else credit = Math.abs(a)
      }
    } else {
      // Some banks print debits as negatives; the column says the direction.
      const d = parseAmount(cell(row, map.debit))
      const c = parseAmount(cell(row, map.credit))
      if (d != null && d !== 0) debit = Math.abs(d)
      if (c != null && c !== 0) credit = Math.abs(c)
    }
    if (debit == null && credit == null) { skipped++; continue }

    const narration = map.narration.map(i => cell(row, i)).filter(Boolean).join(' ') || null
    lines.push({
      valueDate: date,
      postDate: map.postDate != null ? parseDate(cell(row, map.postDate), map.dateOrder) : null,
      transactionType: cell(row, map.type) || null,
      narration,
      debit: debit != null ? round2(debit) : null,
      credit: credit != null ? round2(credit) : null,
      balance: parseAmount(cell(row, map.balance)),
      reference: cell(row, map.reference) || null,
    })
  }

  // Newest-first statements are put in date order, so running balances chain.
  let reversed = false
  if (lines.length > 1 && lines[0].valueDate > lines[lines.length - 1].valueDate) {
    lines.reverse(); reversed = true
  }

  // Opening balance when the statement doesn't print one: the first line's
  // balance before it.
  if (startingBalance == null && lines[0]?.balance != null) {
    startingBalance = round2(lines[0].balance - (lines[0].credit ?? 0) + (lines[0].debit ?? 0))
  }
  if (endingBalance == null && lines.length > 0) endingBalance = lines[lines.length - 1].balance

  // Running balance: each line should move the balance by exactly its amount.
  let running = startingBalance
  let breaks = 0
  let swapped = 0
  for (const [i, l] of lines.entries()) {
    if (running != null && l.balance != null) {
      const expected = round2(running - (l.debit ?? 0) + (l.credit ?? 0))
      if (Math.abs(expected - l.balance) > 0.01) {
        breaks++
        // The same line read the other way round would fit: debit and credit
        // columns are probably swapped.
        const flipped = round2(running + (l.debit ?? 0) - (l.credit ?? 0))
        if (Math.abs(flipped - l.balance) <= 0.01) swapped++
        if (breaks <= 5) warnings.push(`Line ${i + 1} (${l.valueDate}): expected balance ${expected.toFixed(2)}, statement shows ${l.balance.toFixed(2)}`)
      }
    }
    running = l.balance ?? (running != null ? round2(running - (l.debit ?? 0) + (l.credit ?? 0)) : null)
  }
  if (breaks > 5) warnings.push(`…and ${breaks - 5} more balance breaks`)
  if (swapped > 0 && swapped >= breaks * 0.8) {
    warnings.unshift('Money in and money out look swapped — check the Debit and Credit columns in the mapping')
  } else if (breaks > 0) {
    warnings.unshift(`${breaks} running-balance break${breaks === 1 ? '' : 's'} — a page or rows may be missing, or a column is mapped wrongly`)
  }
  if (lines.length > 0 && lines.every(l => l.balance == null)) {
    warnings.push('No running balance was read — the statement can\'t be checked for missing rows. Map a Balance column if it has one.')
  }
  return { lines, startingBalance, endingBalance, warnings, skipped, reversed }
}

function lastAmount(row: string[]): number | null {
  for (let i = row.length - 1; i >= 0; i--) {
    const n = parseAmount(row[i])
    if (n != null) return n
    // "Opening Balance: 250,000.00" in one cell.
    const tokens = (row[i] ?? '').match(/\(?-?\d[\d,]*(\.\d+)?\)?/g)
    if (tokens) {
      const t = parseAmount(tokens[tokens.length - 1])
      if (t != null) return t
    }
  }
  return null
}
