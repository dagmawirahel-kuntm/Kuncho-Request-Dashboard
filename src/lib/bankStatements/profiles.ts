// Bank profiles: how each bank lays out its PDF statement, so a statement
// from a known bank reads itself — the right columns, the lines that belong
// together, the opening and closing balances and the bank's own totals —
// with no mapping.
//
// A PDF has no cells, only words at positions. A profile names the header
// line and its columns; every word below it goes in the column it sits under.
// A transaction starts on the line with a date in the profile's `anchor`
// column, and every line after it, up to the next date, is part of it (a
// description that wraps, or an amount the bank prints a line lower).
//
// Adding a bank: copy the closest profile below, change the patterns to that
// bank's words, and check it with
//   npx tsx scripts/check-bank-statement.ts <statement.pdf>
// which prints the lines read and whether they add up to the bank's totals.
// A bank with no profile still imports: its columns are mapped once in the
// screen and remembered for that account.

import { parseAmount, parseDate, type ColumnMapping, type DateOrder, type Grid, type ParsedStatement } from './grid'
import { itemX2, textLines, type PdfItem, type PdfPageText, type TextLine } from './pdfText'

export type Col = 'date' | 'postDate' | 'reference' | 'narration' | 'debit' | 'credit' | 'balance' | 'type' | 'skip'

/** One transaction as read, before amounts and dates are parsed. */
export interface Txn { date: string; postDate: string; reference: string; narration: string; debit: string; credit: string; balance: string; type: string }

export interface BankProfile {
  id: string
  bank: string
  /** The name finance knows it by. */
  short: string
  /** Every pattern is found on the first page. */
  detect: RegExp[]
  /** The header line's text (its second line, with `headerLines: 2`, is merged in). */
  header: RegExp
  headerLines?: 1 | 2
  /** The printed header cells, left to right, and the column each one is. */
  columns: [RegExp, Col][]
  /** The column whose date starts a transaction. */
  anchor: Col
  dateOrder: DateOrder
  /** Page headers and footers: points from the page's top and bottom edge. */
  margins?: { top?: number; bottom?: number }
  /** Lines to drop wherever they appear (a page header repeated mid-page, a browser's print line). */
  skip?: RegExp[]
  /** Table lines carrying the opening and closing balance. */
  opening?: RegExp
  closing?: RegExp
  /** The line with total debits and credits: its label, or 'unlabelled' (only the two amounts). */
  totals?: RegExp | 'unlabelled'
  totalDebit?: RegExp
  totalCredit?: RegExp
  /** Columns the bank breaks mid-word: pieces at most `gap` points apart join without a space. */
  tight?: { columns: Col[]; gap: number }
  /** From the statement's text. The first capture group is the value. */
  accountNumber: RegExp
  period?: RegExp
  summaryOpening?: RegExp
  summaryClosing?: RegExp
  /** A last touch on each transaction. */
  fix?: (t: Txn) => void
}

const MONEY = '(-?[\\d,]+\\.\\d{2})'

export const BANK_PROFILES: BankProfile[] = [
  {
    // Printed from the web statement (Flexcube) in a browser; the page heading
    // repeats mid-page and the browser adds its own lines at the edges.
    id: 'dashen', bank: 'Dashen Bank', short: 'Dashen',
    detect: [/DASHEN\s+BANK/i, /DATE DESCRIPTION REFERENCE DEBIT CREDIT BALANCE/],
    header: /^DATE DESCRIPTION REFERENCE DEBIT CREDIT BALANCE$/,
    columns: [[/^DATE$/, 'date'], [/^DESCRIPTION$/, 'narration'], [/^REFERENCE$/, 'reference'],
      [/^DEBIT$/, 'debit'], [/^CREDIT$/, 'credit'], [/^BALANCE$/, 'balance']],
    anchor: 'date', dateOrder: 'dmy',
    margins: { top: 15, bottom: 10 },
    skip: [/^ACCOUNT NUMBER\b/, /^PERIOD OF STATEMENT\b/, /^-{10,}$/],
    opening: /BROUGHT FORWARD/, closing: /^NEW BALANCE\b/,
    totalDebit: /TOTAL DEBITS:/, totalCredit: /TOTAL CREDITS:/,
    // The 16-character reference runs onto a second line (145OWCL262160 / 003),
    // even across a page break.
    tight: { columns: ['reference'], gap: Infinity },
    accountNumber: /ACCOUNT NUMBER\s*:\s*(\d{6,})/,
    period: /PERIOD OF STATEMENT\s*:\s*(\S+)\s*-\s*(\S+)/,
    fix: t => { t.narration = t.narration.replace(/\s*\|\|\s*/g, ' · ') },
  },
  {
    id: 'zemen', bank: 'Zemen Bank', short: 'Zemen',
    detect: [/Zemen Bank/i, /Transaction Details/],
    header: /^Date Description Narrative Instrument No Debit Credit Closing$/, headerLines: 2,
    columns: [[/^Date$/, 'date'], [/^Description$/, 'type'], [/^Narrative$/, 'narration'], [/^Instrument No$/, 'skip'],
      [/^Debit$/, 'debit'], [/^Credit$/, 'credit'], [/^Closing Balance$/, 'balance']],
    anchor: 'date', dateOrder: 'dmy',
    margins: { bottom: 110 },
    totals: /^Total Debit\/Credit/,
    accountNumber: /Account Number\s+(\d{6,})/,
    period: /Statement Period\s+(\S+)\s+\S\s+(\S+)/,
    summaryOpening: new RegExp(`Opening Balance\\s+${MONEY}`), summaryClosing: new RegExp(`Closing Balance\\s+${MONEY}`),
    // The narrative opens with the transaction's reference.
    fix: t => {
      const m = t.narration.match(/^([A-Z0-9]{10,})\b\s*(.*)$/)
      if (m) { t.reference = m[1]; t.narration = m[2] }
    },
  },
  {
    id: 'coop', bank: 'Cooperative Bank of Oromia', short: 'Coop',
    detect: [/Cooperative Bank Of/i, /BOOKING VALUE TRANS/],
    header: /^BOOKING VALUE TRANS DEBIT CREDIT CLOSING$/, headerLines: 2,
    columns: [[/^BOOKING DATE$/, 'postDate'], [/^VALUE DATE$/, 'date'], [/^TRANS REFERENCE$/, 'reference'],
      [/^NARRATIVE$/, 'narration'], [/^DEBIT AMT$/, 'debit'], [/^CREDIT AMT$/, 'credit'], [/^CLOSING BALANCE$/, 'balance']],
    // The value date wraps (12-Jan- / 2026); the booking date doesn't.
    anchor: 'postDate', dateOrder: 'dmy',
    skip: [/^Bank Smarter Live Better$/, /Page \d+ of \d+$/],
    totals: 'unlabelled',
    accountNumber: /Account Number:\s*(\d{6,})/,
    period: /From\s+(\S+)\s+To\s+(\S+)/,
    summaryOpening: new RegExp(`Opening Balance:\\s*${MONEY}`), summaryClosing: new RegExp(`Closing Balance:\\s*${MONEY}`),
  },
  {
    // The statement doesn't print the bank's name; the account number does.
    // Each debit is printed a line below its transaction.
    id: 'awash', bank: 'Awash Bank', short: 'Awash',
    detect: [/Customer Statement/, /Account Category:/, /Posting Date Value Date Description Debit Amount Credit Amount Balance/],
    header: /^Posting Date Value Date Description Debit Amount Credit Amount Balance$/,
    columns: [[/^Posting Date$/, 'postDate'], [/^Value Date$/, 'date'], [/^Description$/, 'narration'],
      [/^Debit Amount$/, 'debit'], [/^Credit Amount$/, 'credit'], [/^Balance$/, 'balance']],
    anchor: 'postDate', dateOrder: 'mdy',
    margins: { bottom: 45 },
    opening: /^BBF:/,
    totals: 'unlabelled',
    accountNumber: /Account Number:\s*(\d{6,})/,
    period: /Statement Period:\s*(\S+)\s+To\s+(\S+)/,
    fix: t => {
      t.narration = t.narration.replace(/\s+0$/, '')
      // Transfers carry their reference in the description: OR:2511191078788128:…, IR:FT260067T6P1:…
      t.reference = t.narration.match(/^[OI]R:([A-Z0-9]{8,}):/)?.[1] ?? ''
    },
  },
  {
    // T24 core banking; doesn't print the bank's name. Text is cut at a fixed
    // width, mid-word, so close lines join without a space.
    id: 'abyssinia', bank: 'Bank of Abyssinia', short: 'Abyssinia',
    detect: [/Account Statement/, /Book Date Reference Description Value Date Debit Credit Closing Balance/],
    header: /^Book Date Reference Description Value Date Debit Credit Closing Balance$/,
    columns: [[/^Book Date$/, 'postDate'], [/^Reference$/, 'reference'], [/^Description$/, 'narration'],
      [/^Value Date$/, 'date'], [/^Debit$/, 'debit'], [/^Credit$/, 'credit'], [/^Closing Balance$/, 'balance']],
    anchor: 'postDate', dateOrder: 'dmy',
    margins: { top: 90, bottom: 45 },
    opening: /^Balance at Period S/, closing: /^Balance at Period E/,
    tight: { columns: ['reference', 'narration'], gap: 9.5 },
    accountNumber: /Account\s*:\s*(\d{6,})/,
  },
]

const COMMON_SKIP = [/^Page \d+ of \d+$/i]

export interface BankRead {
  profileId: string
  bank: string
  accountNumber: string | null
  periodFrom: string | null
  periodTo: string | null
  opening: number | null
  closing: number | null
  totalDebit: number | null
  totalCredit: number | null
  /** The grid's columns, always the same for a profile's grid. */
  mapping: ColumnMapping
}

export function detectBankProfile(pages: PdfPageText[]): BankProfile | null {
  const first = textLines(pages[0]?.items ?? []).map(l => l.text).join('\n')
  return BANK_PROFILES.find(p => p.detect.every(r => r.test(first))) ?? null
}

// ── Reading ─────────────────────────────────────────────────────────────
const GRID_HEADER = ['Value date', 'Post date', 'Reference', 'Narration', 'Money out', 'Money in', 'Balance', 'Type']
const PROFILE_MAPPING: ColumnMapping = {
  headerRow: 0, date: 0, postDate: 1, reference: 2, narration: [3], debit: 4, credit: 5, balance: 6, type: 7, dateOrder: 'ymd',
}
const AMOUNT_COLS: Col[] = ['debit', 'credit', 'balance']
const DATE_COLS: Col[] = ['date', 'postDate']

interface Column { start: number; end: number; x: number; col: Col }
interface Piece { y: number; page: number; text: string }
type Kind = 'txn' | 'opening' | 'closing' | 'totals' | 'totalDebit' | 'totalCredit'
interface Group { kind: Kind; text: string; pieces: Map<Col, Piece[]> }

function headerColumns(p: BankProfile, line: TextLine, second?: TextLine): Column[] | null {
  const chunks = toChunks(line.items)
  for (const c of second ? toChunks(second.items) : []) {
    const above = chunks.find(a => c.x < a.x2 + 4 && c.x2 > a.x - 4)
    if (above) { above.text += ` ${c.text}`; above.x = Math.min(above.x, c.x); above.x2 = Math.max(above.x2, c.x2) }
    else chunks.push(c)
  }
  chunks.sort((a, b) => a.x - b.x)
  const used = new Set<number>()
  const cols: Col[] = chunks.map(c => {
    const i = p.columns.findIndex(([re], k) => !used.has(k) && re.test(c.text))
    if (i < 0) return 'skip'
    used.add(i)
    return p.columns[i][1]
  })
  if (used.size !== p.columns.length) return null
  return chunks.map((c, i) => ({
    start: i === 0 ? -Infinity : (chunks[i - 1].x2 + c.x) / 2,
    end: i === chunks.length - 1 ? Infinity : (c.x2 + chunks[i + 1].x) / 2,
    x: c.x,
    col: cols[i],
  }))
}

function toChunks(items: PdfItem[]) {
  const chunks: { x: number; x2: number; text: string }[] = []
  for (const it of items) {
    const x = it.transform[4]
    const last = chunks[chunks.length - 1]
    if (last && x - last.x2 <= 4) { last.text += ` ${it.str.trim()}`; last.x2 = itemX2(it) }
    else chunks.push({ x, x2: itemX2(it), text: it.str.trim() })
  }
  return chunks.map(c => ({ ...c, text: c.text.replace(/\s+/g, ' ').trim() }))
}

// An amount is right-aligned and can start left of its header, so it goes
// by where it sits; text is left-aligned, so it goes by where it starts (a
// short wrapped word near the next column stays in its own).
function cellsOf(line: TextLine, columns: Column[]): Map<Col, string> {
  const cells = new Map<Col, string[]>()
  for (const it of line.items) {
    const x = it.transform[4]
    const mid = (x + itemX2(it)) / 2
    const c = /^-?(\d[\d,]*\.\d*|\d{1,3}(,\d{3})+)$/.test(it.str.trim())
      ? columns.find(k => mid >= k.start && mid < k.end) ?? columns[columns.length - 1]
      : [...columns].reverse().find(k => k.x <= x + 6) ?? columns[0]
    if (!cells.has(c.col)) cells.set(c.col, [])
    cells.get(c.col)!.push(it.str.trim())
  }
  return new Map([...cells].map(([k, v]) => [k, v.join(' ').replace(/\s+/g, ' ').trim()]))
}

function joinPieces(p: BankProfile, col: Col, pieces: Piece[]): string {
  let out = ''
  pieces.forEach((pc, i) => {
    if (i === 0) { out = pc.text; return }
    const prev = pieces[i - 1]
    const gap = prev.page === pc.page ? prev.y - pc.y : Infinity
    const together = AMOUNT_COLS.includes(col) || DATE_COLS.includes(col)
      || (!!p.tight && p.tight.columns.includes(col) && gap <= p.tight.gap)
    out += (together ? '' : ' ') + pc.text
  })
  return out.trim()
}

const firstMatch = (re: RegExp | undefined, text: string) => (re ? text.match(re)?.[1] ?? null : null)
const amountIn = (text: string) => {
  const all = text.match(/-?[\d,]+\.\d{2}\b/g)
  return all ? parseAmount(all[all.length - 1]) : null
}

export function readWithProfile(p: BankProfile, pages: PdfPageText[]): { grid: Grid; bank: BankRead } {
  const allText = pages.map(pg => textLines(pg.items).map(l => l.text).join('\n')).join('\n')
  const skip = [...COMMON_SKIP, ...(p.skip ?? [])]
  let columns: Column[] | null = null
  const groups: Group[] = []
  let cur: Group | null = null
  let ended = false

  const add = (g: Group, cells: Map<Col, string>, y: number, page: number) => {
    for (const [col, text] of cells) {
      if (!text || col === 'skip') continue
      if (!g.pieces.has(col)) g.pieces.set(col, [])
      g.pieces.get(col)!.push({ y, page, text })
    }
  }
  const start = (kind: Kind, text: string) => { cur = { kind, text, pieces: new Map() }; groups.push(cur); return cur }

  pages.forEach((page, pi) => {
    const top = page.height - (p.margins?.top ?? 0)
    const bottom = p.margins?.bottom ?? 0
    const lines = textLines(page.items).filter(l => l.y <= top && l.y >= bottom)
    // On a page with the header, what's above it is the page's own heading.
    const first = lines.findIndex(l => p.header.test(l.text))
    for (let i = Math.max(first, 0); i < lines.length; i++) {
      const l = lines[i]
      if (p.header.test(l.text)) {
        const second = p.headerLines === 2 ? lines[i + 1] : undefined
        columns = headerColumns(p, l, second) ?? columns
        if (second) i++
        continue
      }
      if (!columns || skip.some(r => r.test(l.text))) continue
      const cells = cellsOf(l, columns)
      const filled = [...cells].filter(([c, t]) => t && c !== 'skip')
      const amountsOnly = filled.length > 0 && filled.every(([c, t]) => AMOUNT_COLS.includes(c) && /^[-\d.,]+$/.test(t))

      if (p.opening?.test(l.text)) { add(start('opening', l.text), cells, l.y, pi); continue }
      if (p.closing?.test(l.text)) { add(start('closing', l.text), cells, l.y, pi); continue }
      if (p.totalDebit?.test(l.text)) { add(start('totalDebit', l.text), cells, l.y, pi); ended = true; continue }
      if (p.totalCredit?.test(l.text)) { add(start('totalCredit', l.text), cells, l.y, pi); ended = true; continue }
      const unlabelledTotals = p.totals === 'unlabelled' && amountsOnly
        && filled.length === 2 && cells.get('debit') && cells.get('credit')
      if ((p.totals instanceof RegExp && p.totals.test(l.text)) || unlabelledTotals) {
        add(start('totals', l.text), cells, l.y, pi); ended = true; continue
      }
      // After the totals only a figure cut onto the next line still belongs.
      if (ended) { if (cur && amountsOnly) add(cur, cells, l.y, pi); continue }
      if (parseDate(cells.get(p.anchor) ?? '', p.dateOrder)) { add(start('txn', l.text), cells, l.y, pi); continue }
      if (cur) add(cur, cells, l.y, pi)
    }
  })

  const cellOf = (g: Group, col: Col) => joinPieces(p, col, g.pieces.get(col) ?? [])
  // A balance line's figure is in the balance column, or else the last amount on it.
  const markerAmount = (g: Group | undefined, col: Col | null = 'balance') =>
    g ? (col ? parseAmount(cellOf(g, col)) : null) ?? amountIn([...g.pieces.values()].flat().map(x => x.text).join(' ')) : null
  const find = (k: Kind) => groups.find(g => g.kind === k)
  const lastOf = (k: Kind) => [...groups].reverse().find(g => g.kind === k)

  const rows: Grid = [GRID_HEADER]
  const opening = markerAmount(find('opening')) ?? parseAmount(firstMatch(p.summaryOpening, allText))
  const closing = markerAmount(lastOf('closing')) ?? parseAmount(firstMatch(p.summaryClosing, allText))
  if (opening != null) rows.push(['Opening balance', '', '', '', '', '', String(opening), ''])
  for (const g of groups.filter(x => x.kind === 'txn')) {
    const t: Txn = {
      date: cellOf(g, 'date') || cellOf(g, p.anchor), postDate: cellOf(g, 'postDate'), reference: cellOf(g, 'reference'),
      narration: cellOf(g, 'narration'), debit: cellOf(g, 'debit'), credit: cellOf(g, 'credit'),
      balance: cellOf(g, 'balance'), type: cellOf(g, 'type'),
    }
    p.fix?.(t)
    rows.push([
      parseDate(t.date, p.dateOrder) ?? t.date, t.postDate ? parseDate(t.postDate, p.dateOrder) ?? t.postDate : '',
      t.reference, t.narration, t.debit, t.credit, t.balance, t.type,
    ])
  }
  if (closing != null) rows.push(['Closing balance', '', '', '', '', '', String(closing), ''])

  const totals = lastOf('totals')
  const period = p.period ? allText.match(p.period) : null
  return {
    grid: rows,
    bank: {
      profileId: p.id, bank: p.bank,
      accountNumber: firstMatch(p.accountNumber, allText),
      periodFrom: period ? parseDate(period[1], p.dateOrder) : null,
      periodTo: period ? parseDate(period[2], p.dateOrder) : null,
      opening, closing,
      totalDebit: totals ? parseAmount(cellOf(totals, 'debit')) : markerAmount(find('totalDebit'), null),
      totalCredit: totals ? parseAmount(cellOf(totals, 'credit')) : markerAmount(find('totalCredit'), null),
      mapping: PROFILE_MAPPING,
    },
  }
}

// ── Checks against what the bank printed ────────────────────────────────
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * The bank's own figures against the lines read: its totals, and opening
 * plus money in less money out against its closing balance. Any difference
 * means a line was missed or misread.
 */
export function statementChecks(parsed: ParsedStatement, bank: BankRead): { agreed: string[]; problems: string[] } {
  const agreed: string[] = []
  const problems: string[] = []
  const out = parsed.lines.reduce((s, l) => s + (l.debit ?? 0), 0)
  const inn = parsed.lines.reduce((s, l) => s + (l.credit ?? 0), 0)
  const near = (a: number, b: number) => Math.abs(a - b) < 0.01
  if (bank.totalDebit != null) {
    if (near(out, Math.abs(bank.totalDebit))) agreed.push(`money out ${fmt(out)}`)
    else problems.push(`The bank's total money out is ${fmt(Math.abs(bank.totalDebit))}; the lines read add up to ${fmt(out)}.`)
  }
  if (bank.totalCredit != null) {
    if (near(inn, Math.abs(bank.totalCredit))) agreed.push(`money in ${fmt(inn)}`)
    else problems.push(`The bank's total money in is ${fmt(Math.abs(bank.totalCredit))}; the lines read add up to ${fmt(inn)}.`)
  }
  if (bank.opening != null && bank.closing != null) {
    const expected = bank.opening + inn - out
    if (near(expected, bank.closing)) agreed.push(`closing balance ${fmt(bank.closing)}`)
    else problems.push(`Opening ${fmt(bank.opening)} + in ${fmt(inn)} − out ${fmt(out)} = ${fmt(expected)}, but the bank's closing balance is ${fmt(bank.closing)}.`)
  }
  return { agreed, problems }
}

/** Whether a statement's account number is this account's (leading zeros and spacing aside). */
export function sameAccountNumber(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = (a ?? '').replace(/\D/g, '').replace(/^0+/, '')
  const y = (b ?? '').replace(/\D/g, '').replace(/^0+/, '')
  return x.length >= 6 && x === y
}
