// Parses a CBE-style bank statement CSV export:
// "Value Date","Post Date","Transaction Type","Narration","Debit","Credit","Balance","Reference"
// Amounts use comma thousands separators; dates are "DD MON YY"; the
// last two rows are "Starting Balance"/"Ending Balance" sentinels
// with the figure (plus a trailing " ETB") in the Reference column,
// not a real transaction. Verified against a real CBE export, not
// assumed — see the row-by-row running-balance check below.

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
  // Fields are fully quoted and don't contain embedded quotes in this
  // format, so a quote-delimited match per line is reliable and far
  // simpler than a general CSV state machine.
  const matches = line.match(/"([^"]*)"/g)
  if (!matches) return []
  return matches.map(m => m.slice(1, -1))
}

export function parseBankStatementCsv(csvText: string): ParsedStatement {
  const rawLines = csvText.split(/\r\n|\n/).filter(l => l.trim().length > 0)
  const lines: ParsedStatementLine[] = []
  let startingBalance: number | null = null
  let endingBalance: number | null = null
  let lineNo = 0

  for (let i = 1; i < rawLines.length; i++) {
    const fields = parseCsvLine(rawLines[i])
    if (fields.length < 8) continue
    const [valueDateRaw, , transactionType, narration, debit, credit, balance, reference] = fields

    if (/^Starting Balance$/i.test(valueDateRaw)) {
      startingBalance = parseAmount(reference)
      continue
    }
    if (/^Ending Balance$/i.test(valueDateRaw)) {
      endingBalance = parseAmount(reference)
      continue
    }

    const valueDate = parseStatementDate(valueDateRaw)
    if (!valueDate) continue // not a recognizable transaction row

    lineNo += 1
    lines.push({
      lineNo,
      valueDate,
      postDate: parseStatementDate(fields[1]) ?? valueDate,
      transactionType: transactionType || null,
      narration: narration || null,
      debitAmount: parseAmount(debit),
      creditAmount: parseAmount(credit),
      runningBalance: parseAmount(balance),
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
