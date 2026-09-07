// Parses a CBE bank statement CSV export. CBE ships (at least) two column
// orders, and they differ in where Reference sits:
//
//   "Value Date","Post Date","Transaction Type","Narration","Debit","Credit","Balance","Reference"
//   ValueDate,PostDate,TransactionType,Narration,Reference,Debit,Credit,Balance
//
// Reading the second with the first's fixed positions is silent and total:
// every Debit lands in credit, every Credit in balance, and the Balance
// string in reference. That is what happened to the 11–19 Aug 2026 statement
// — 48 lines imported with no reference at all, so not one of them could
// match an expense, and the transfers written at commit were all backwards.
// So the columns are read from the header row by name rather than assumed,
// falling back to the older fixed order only when no header is recognisable.
//
// Amounts use comma thousands separators; dates are "DD MON YY". Some
// exports end with "Starting Balance"/"Ending Balance" sentinel rows
// carrying the figure (plus a trailing " ETB") rather than a transaction;
// others (the second layout above) carry no sentinels at all.

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
  balanceWarnings: string[]
}

const MONTHS: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
}

function parseStatementDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2})$/)
  if (!m) return null
  const [, day, monAbbr, yy] = m
  const mm = MONTHS[monAbbr.toUpperCase()]
  if (!mm) return null
  return `20${yy}-${mm}-${day.padStart(2, '0')}`
}

function parseAmount(s: string): number | null {
  const trimmed = s.trim().replace(/ ETB$/i, '').replace(/,/g, '')
  if (!trimmed) return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

function parseCsvLine(line: string): string[] {
  // Transaction rows are fully quoted and don't contain embedded quotes in
  // either format, so a quote-delimited match is reliable and far simpler
  // than a general CSV state machine. Header rows are sometimes unquoted,
  // hence the plain split when the row carries no quotes at all.
  const matches = line.match(/"([^"]*)"/g)
  if (!matches) return line.includes(',') ? line.split(',').map(f => f.trim()) : []
  return matches.map(m => m.slice(1, -1))
}

interface ColumnIndex {
  valueDate: number
  postDate: number
  transactionType: number
  narration: number
  debit: number
  credit: number
  balance: number
  reference: number
}

// The layout this parser was originally written against, used when a file
// arrives with no header we can read.
const LEGACY_COLUMNS: ColumnIndex = {
  valueDate: 0, postDate: 1, transactionType: 2, narration: 3,
  debit: 4, credit: 5, balance: 6, reference: 7,
}

const HEADER_NAMES: Record<string, keyof ColumnIndex> = {
  valuedate: 'valueDate',
  postdate: 'postDate',
  transactiontype: 'transactionType',
  narration: 'narration',
  debit: 'debit',
  credit: 'credit',
  balance: 'balance',
  reference: 'reference',
}

// "Value Date" and "ValueDate" are the same column; so are "REFERENCE" and
// "Reference". Everything that isn't a letter is dropped before matching.
function columnsFromHeader(headerRow: string): ColumnIndex | null {
  const fields = parseCsvLine(headerRow)
  if (fields.length === 0) return null

  const found: Partial<ColumnIndex> = {}
  fields.forEach((field, i) => {
    const key = HEADER_NAMES[field.trim().toLowerCase().replace(/[^a-z]/g, '')]
    if (key && found[key] === undefined) found[key] = i
  })

  const complete = (Object.values(HEADER_NAMES) as (keyof ColumnIndex)[])
    .every(key => found[key] !== undefined)
  return complete ? (found as ColumnIndex) : null
}

export function parseBankStatementCsv(csvText: string): ParsedStatement {
  const rawLines = csvText.split(/\r\n|\n/).filter(l => l.trim().length > 0)
  const lines: ParsedStatementLine[] = []
  let startingBalance: number | null = null
  let endingBalance: number | null = null
  let lineNo = 0

  const cols = (rawLines.length > 0 ? columnsFromHeader(rawLines[0]) : null) ?? LEGACY_COLUMNS

  for (let i = 1; i < rawLines.length; i++) {
    const fields = parseCsvLine(rawLines[i])
    if (fields.length < 8) continue
    const valueDateRaw = fields[cols.valueDate]
    const reference = fields[cols.reference]

    // The sentinel rows carry their figure in the Reference column of the
    // layout that has them; read the last field as a fallback so a file that
    // puts it elsewhere still yields a balance rather than a silent null.
    if (/^Starting Balance$/i.test(valueDateRaw)) {
      startingBalance = parseAmount(reference) ?? parseAmount(fields[fields.length - 1])
      continue
    }
    if (/^Ending Balance$/i.test(valueDateRaw)) {
      endingBalance = parseAmount(reference) ?? parseAmount(fields[fields.length - 1])
      continue
    }

    const valueDate = parseStatementDate(valueDateRaw)
    if (!valueDate) continue // not a recognizable transaction row

    lineNo += 1
    lines.push({
      lineNo,
      valueDate,
      postDate: parseStatementDate(fields[cols.postDate]) ?? valueDate,
      transactionType: fields[cols.transactionType] || null,
      narration: fields[cols.narration] || null,
      debitAmount: parseAmount(fields[cols.debit]),
      creditAmount: parseAmount(fields[cols.credit]),
      runningBalance: parseAmount(fields[cols.balance]),
      reference: reference || null,
      referenceCode: reference ? reference.split('\\')[0].trim() : null,
    })
  }

  const balanceWarnings: string[] = []
  let running = startingBalance
  for (const line of lines) {
    if (running != null && line.runningBalance != null) {
      const expected = running - (line.debitAmount ?? 0) + (line.creditAmount ?? 0)
      if (Math.abs(expected - line.runningBalance) > 0.01) {
        balanceWarnings.push(`Line ${line.lineNo} (${line.valueDate}): expected balance ${expected.toFixed(2)}, statement shows ${line.runningBalance.toFixed(2)}`)
      }
    }
    running = line.runningBalance ?? running
  }

  return {
    lines,
    periodStart: lines[0]?.valueDate ?? null,
    periodEnd: lines[lines.length - 1]?.valueDate ?? null,
    startingBalance,
    endingBalance,
    balanceWarnings,
  }
}
