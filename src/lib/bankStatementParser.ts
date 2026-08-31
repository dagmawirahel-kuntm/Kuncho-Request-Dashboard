// Parses a CBE bank statement CSV export.
//
// This used to assume a fixed column order and skip the header row
// entirely: field 4 was Debit, field 5 was Credit, field 6 was Balance,
// field 7 was Reference, always. When CBE issued a statement with a
// different layout the assumption held silently and every row landed one
// column to the left — 46 outgoing payments (5,069,507.93 ETB) were
// recorded as money *in*, the running balance was filed as the
// reference, and the real reference was dropped. Nothing failed; the
// import just reported the opposite of what the bank said.
//
// So the layout is now read from the header rather than assumed, and the
// file has to prove itself before it can be imported:
//
//   · columns are located by name, with aliases, in whatever order and
//     at whatever position they appear
//   · a file whose required columns cannot be found is rejected outright
//     rather than parsed positionally as a guess
//   · every row is checked against the running balance the bank itself
//     printed, which is what makes a column mix-up impossible to miss:
//     if debit and credit are transposed the arithmetic fails on the
//     first line that has either
//
// The balance check no longer depends on finding a "Starting Balance"
// sentinel. It compares each line to the previous line's balance, so it
// works from the second transaction onwards on any file — the older
// version silently did nothing when the sentinel was absent, which is
// exactly what happened on the statement that broke.

export interface ParsedStatementLine {
  lineNo: number
  valueDate: string | null // ISO date
  postDate: string | null
  transactionType: string | null
  narration: string | null
  debitAmount: number | null
  creditAmount: number | null
  runningBalance: number | null
  reference: string | null
  referenceCode: string | null // reference with the trailing "\XXX" branch suffix stripped
}

export interface ParsedStatement {
  lines: ParsedStatementLine[]
  periodStart: string | null
  periodEnd: string | null
  startingBalance: number | null
  endingBalance: number | null
  /** Non-blocking notes — rows skipped, reference column absent, etc. */
  balanceWarnings: string[]
  /** Blocking problems. A file with any of these must not be imported. */
  errors: string[]
  /** Which CSV column each field was read from, for display before import. */
  columnMap: Record<string, string>
}

const MONTHS: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
}

function parseStatementDate(s: string | undefined): string | null {
  if (!s) return null
  const t = s.trim()
  // "DD MON YY" / "DD MON YYYY" — the format CBE prints.
  const m = t.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{2}|\d{4})$/)
  if (m) {
    const [, day, monAbbr, year] = m
    const mm = MONTHS[monAbbr.toUpperCase()]
    if (mm) {
      const yyyy = year.length === 2 ? `20${year}` : year
      return `${yyyy}-${mm}-${day.padStart(2, '0')}`
    }
  }
  // ISO or near-ISO, in case an export is taken from a different channel.
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  return null
}

function parseAmount(s: string | undefined): number | null {
  if (s == null) return null
  // Strip currency suffixes, thousands separators, and the parenthesised
  // negative some exports use for outgoing amounts.
  let t = s.trim().replace(/\s*(ETB|BIRR)$/i, '').replace(/,/g, '').trim()
  if (!t) return null
  let negative = false
  if (/^\(.*\)$/.test(t)) { negative = true; t = t.slice(1, -1).trim() }
  if (t === '-' || t === '') return null
  const n = Number(t)
  if (!Number.isFinite(n)) return null
  if (n === 0) return null
  return negative ? -n : n
}

// A real CSV splitter. The previous version matched quoted runs with a
// regex, which meant an unquoted or empty-unquoted field silently
// vanished from the row and shifted everything after it — the same class
// of failure this parser now exists to prevent.
function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i++ } else { inQuotes = false }
      } else field += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      out.push(field); field = ''
    } else field += ch
  }
  out.push(field)
  return out.map(f => f.trim())
}

function normaliseHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '')
}

// Header aliases, most specific first within each field. Matched by exact
// normalised name, then by "contains", so "Transaction Debit Amount"
// still resolves.
const COLUMN_ALIASES: Record<string, string[]> = {
  valueDate:       ['valuedate', 'transactiondate', 'trxdate', 'date'],
  postDate:        ['postdate', 'postingdate', 'bookingdate'],
  transactionType: ['transactiontype', 'trxtype', 'type', 'channel'],
  narration:       ['narration', 'description', 'details', 'particulars', 'remark', 'remarks'],
  debitAmount:     ['debit', 'debitamount', 'withdrawal', 'withdrawals', 'dr', 'dramount', 'moneyout', 'paidout'],
  creditAmount:    ['credit', 'creditamount', 'deposit', 'deposits', 'cr', 'cramount', 'moneyin', 'paidin'],
  runningBalance:  ['balance', 'runningbalance', 'closingbalance', 'availablebalance', 'bal'],
  reference:       ['reference', 'referenceno', 'referencenumber', 'ref', 'refno', 'transactionreference', 'trxreference'],
}

function resolveColumns(headers: string[]): { index: Record<string, number>; map: Record<string, string> } {
  const norm = headers.map(normaliseHeader)
  const index: Record<string, number> = {}
  const map: Record<string, string> = {}
  const taken = new Set<number>()

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    let found = -1
    for (const alias of aliases) {
      const exact = norm.findIndex((h, i) => h === alias && !taken.has(i))
      if (exact !== -1) { found = exact; break }
    }
    if (found === -1) {
      for (const alias of aliases) {
        const partial = norm.findIndex((h, i) => h.includes(alias) && !taken.has(i))
        if (partial !== -1) { found = partial; break }
      }
    }
    if (found !== -1) {
      index[field] = found
      map[field] = headers[found]
      taken.add(found)
    }
  }
  return { index, map }
}

// The header is not always the first line — exports sometimes carry an
// account/period preamble. Take the first row in which the required
// money columns can all be found.
function findHeaderRow(rows: string[][]): { rowIndex: number; index: Record<string, number>; map: Record<string, string> } | null {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const { index, map } = resolveColumns(rows[i])
    if (index.debitAmount != null && index.creditAmount != null && index.valueDate != null) {
      return { rowIndex: i, index, map }
    }
  }
  return null
}

export function parseBankStatementCsv(csvText: string): ParsedStatement {
  const rawRows = csvText.split(/\r\n|\n/).filter(l => l.trim().length > 0).map(parseCsvLine)

  const empty: ParsedStatement = {
    lines: [], periodStart: null, periodEnd: null,
    startingBalance: null, endingBalance: null,
    balanceWarnings: [], errors: [], columnMap: {},
  }

  if (rawRows.length === 0) {
    return { ...empty, errors: ['The file is empty.'] }
  }

  const header = findHeaderRow(rawRows)
  if (!header) {
    return {
      ...empty,
      errors: [
        'Could not find a header row with Value Date, Debit and Credit columns. ' +
        'This file will not be imported by position — a layout change is exactly what previously ' +
        'caused outgoing payments to be recorded as money in. Check the export format.',
      ],
    }
  }

  const { rowIndex, index, map } = header
  const errors: string[] = []
  const balanceWarnings: string[] = []

  if (index.runningBalance == null) {
    errors.push(
      'No running-balance column found. The balance is what proves debit and credit ' +
      'have not been transposed, so a statement without it cannot be verified.',
    )
  }
  if (index.reference == null) {
    balanceWarnings.push(
      'No reference column found — lines will import, but auto-matching relies on the ' +
      'bank reference and will not find anything.',
    )
  }

  const field = (row: string[], name: string): string | undefined =>
    index[name] != null ? row[index[name]] : undefined

  const lines: ParsedStatementLine[] = []
  let startingBalance: number | null = null
  let endingBalance: number | null = null
  let lineNo = 0
  let skipped = 0

  for (let i = rowIndex + 1; i < rawRows.length; i++) {
    const row = rawRows[i]
    if (row.every(c => c === '')) continue

    const valueDateRaw = field(row, 'valueDate') ?? ''

    // Balance sentinels: the figure sits in whichever cell of the row is
    // a number, not reliably in the reference column.
    if (/^starting\s*balance$/i.test(valueDateRaw)) {
      startingBalance = row.map(parseAmount).find(v => v != null) ?? null
      continue
    }
    if (/^ending\s*balance$/i.test(valueDateRaw)) {
      endingBalance = row.map(parseAmount).find(v => v != null) ?? null
      continue
    }

    const valueDate = parseStatementDate(valueDateRaw)
    if (!valueDate) { skipped++; continue }

    const reference = field(row, 'reference') || null
    lineNo += 1
    lines.push({
      lineNo,
      valueDate,
      postDate: parseStatementDate(field(row, 'postDate')) ?? valueDate,
      transactionType: field(row, 'transactionType') || null,
      narration: field(row, 'narration') || null,
      debitAmount: parseAmount(field(row, 'debitAmount')),
      creditAmount: parseAmount(field(row, 'creditAmount')),
      runningBalance: parseAmount(field(row, 'runningBalance')),
      reference,
      referenceCode: reference ? reference.split('\\')[0].trim() : null,
    })
  }

  if (skipped > 0) {
    balanceWarnings.push(`${skipped} row(s) skipped — no recognisable date in the "${map.valueDate}" column.`)
  }
  if (lines.length === 0) {
    errors.push('No transaction rows were found under the header.')
  }

  // ── The check that would have caught the transposition ────────────────────
  //
  // Each line must explain the movement in the bank's own printed
  // balance: balance = previousBalance − debit + credit. Anchored to the
  // starting balance when the file states one, otherwise to the first
  // line that carries a balance, so it works on any export.
  let mismatches = 0
  // Only lines that actually had a preceding balance to compare against
  // count as verifiable. Counting every line with a balance — including
  // the first, which has nothing before it — understates the failure rate
  // and let a fully transposed file through as a mere warning.
  let verifiable = 0
  let firstMismatch: string | null = null
  let running: number | null = startingBalance
  for (const line of lines) {
    if (running != null && line.runningBalance != null) {
      verifiable++
      const expected = running - (line.debitAmount ?? 0) + (line.creditAmount ?? 0)
      if (Math.abs(expected - line.runningBalance) > 0.01) {
        mismatches++
        if (!firstMismatch) {
          firstMismatch = `line ${line.lineNo} (${line.valueDate}): balance should be ` +
            `${expected.toFixed(2)} but the statement shows ${line.runningBalance.toFixed(2)}`
        }
      }
    }
    running = line.runningBalance ?? running
  }

  if (mismatches > 0) {
    const checked = verifiable
    // A missing page breaks a line or two; wrong columns break most of
    // them. The two need different responses, so separate them by rate
    // rather than by count.
    if (mismatches >= 2 && mismatches > checked / 2) {
      errors.push(
        `${mismatches} of ${checked} lines do not agree with the statement's own running balance ` +
        `(first: ${firstMismatch}). At this scale the Debit/Credit/Balance columns are almost ` +
        `certainly being read from the wrong place — detected as Debit="${map.debitAmount}", ` +
        `Credit="${map.creditAmount}", Balance="${map.runningBalance}". Importing would record ` +
        `payments on the wrong side.`,
      )
    } else {
      balanceWarnings.push(
        `${mismatches} running-balance mismatch(es) — the file may be missing rows or a page ` +
        `(first: ${firstMismatch}).`,
      )
    }
  }

  if (endingBalance != null && lines.length > 0) {
    const last = [...lines].reverse().find(l => l.runningBalance != null)?.runningBalance
    if (last != null && Math.abs(last - endingBalance) > 0.01) {
      balanceWarnings.push(
        `The last line's balance (${last.toFixed(2)}) does not match the stated ending balance ` +
        `(${endingBalance.toFixed(2)}).`,
      )
    }
  }

  return {
    lines,
    periodStart: lines[0]?.valueDate ?? null,
    periodEnd: lines[lines.length - 1]?.valueDate ?? null,
    startingBalance,
    endingBalance,
    balanceWarnings,
    errors,
    columnMap: map,
  }
}
