// Reading a statement file into a grid of text cells. CSV (CBE's internet
// banking export, or any bank's), Excel (.xlsx) and PDF are supported; the
// grid then goes through grid.ts, the same for every format.

import { parseDate, type Grid } from './grid'

export type SourceFormat = 'csv' | 'xlsx' | 'pdf'

export interface ReadStatement {
  format: SourceFormat
  grid: Grid
  /** The header row for PDFs, where columns are rebuilt from positions. */
  pdfHeaderRow?: number | null
}

export async function readStatementFile(file: File): Promise<ReadStatement> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv') || file.type === 'text/csv') {
    return { format: 'csv', grid: parseCsv(await file.text()) }
  }
  if (name.endsWith('.xlsx')) {
    return { format: 'xlsx', grid: await readXlsx(await file.arrayBuffer()) }
  }
  if (name.endsWith('.xls')) {
    throw new Error('Old .xls files can\'t be read — open it in Excel and save it as .xlsx (or CSV), then upload that.')
  }
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    const { grid, headerRow } = await readPdf(await file.arrayBuffer())
    return { format: 'pdf', grid, pdfHeaderRow: headerRow }
  }
  throw new Error('Upload the statement as CSV, Excel (.xlsx) or PDF')
}

// ── CSV ─────────────────────────────────────────────────────────────────
export function parseCsv(text: string): Grid {
  const rows: Grid = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const src = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += ch
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(c => c.trim())) rows.push(row)
      row = []
    } else field += ch
  }
  row.push(field)
  if (row.some(c => c.trim())) rows.push(row)
  return rows.map(r => r.map(c => c.trim()))
}

// ── Excel ───────────────────────────────────────────────────────────────
async function readXlsx(buf: ArrayBuffer): Promise<Grid> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  // The sheet with the most rows is the statement (others are covers/notes).
  const sheet = [...wb.worksheets].sort((a, b) => b.actualRowCount - a.actualRowCount)[0]
  if (!sheet) throw new Error('This workbook has no sheets')
  const grid: Grid = []
  sheet.eachRow({ includeEmpty: false }, row => {
    const cells: string[] = []
    const values = row.values as unknown[]
    for (let c = 1; c < values.length; c++) cells.push(cellText(values[c]))
    grid.push(cells)
  })
  return grid
}

function cellText(v: unknown): string {
  if (v == null) return ''
  if (v instanceof Date) {
    // Excel dates are stored at midnight UTC.
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`
  }
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'object') {
    const o = v as { richText?: { text: string }[]; result?: unknown; text?: string; error?: string }
    if (o.richText) return o.richText.map(t => t.text).join('').trim()
    if ('result' in o) return cellText(o.result)
    if (o.text != null) return String(o.text).trim()
  }
  return String(v).trim()
}

// ── PDF ─────────────────────────────────────────────────────────────────
// A PDF has no cells, only words at positions. The statement's header row
// gives the column positions and every later word goes in the column it sits
// under. A description that wraps puts its pieces on the lines above and/or
// below the line carrying the date; those pieces are joined to the
// transaction they belong to.
interface PdfItem { str: string; transform: number[]; width: number; height: number }
interface Chunk { x: number; x2: number; text: string }
interface PdfRow { y: number; cells: string[]; inTable: boolean }

const HEADER_HINT = /^(value ?date|date|trans(action)? ?date|post(ing)? ?date|narration|description|particulars|details|debit|credit|withdrawals?|deposits?|balance|reference|ref(erence)? ?no\.?|amount)$/i
const SUMMARY_ROW = /\b(opening|closing|starting|ending|brought|carried)\b|\btotal/i

async function readPdf(buf: ArrayBuffer): Promise<{ grid: Grid; headerRow: number | null }> {
  const pdfjs = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  return pdfToGrid(pdfjs, new Uint8Array(buf))
}

interface PdfJsLike {
  getDocument(src: { data: Uint8Array }): { promise: Promise<{
    numPages: number
    getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }>
  }> }
}

/** Exported so it can be exercised outside the browser with pdf.js's Node build. */
export async function pdfToGrid(pdfjs: PdfJsLike, data: Uint8Array): Promise<{ grid: Grid; headerRow: number | null }> {
  const doc = await pdfjs.getDocument({ data }).promise
  const grid: Grid = []
  let headerRow: number | null = null
  let columns: { start: number; end: number }[] | null = null
  let dateCol = 0
  let sawText = false

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const items = ((await page.getTextContent()).items as PdfItem[])
      .filter(it => typeof it.str === 'string' && it.str.trim() !== '')
    if (items.length > 0) sawText = true

    // Words on (nearly) the same baseline form a visual line.
    const baselines: { y: number; items: PdfItem[] }[] = []
    for (const it of items) {
      const y = it.transform[5]
      const b = baselines.find(l => Math.abs(l.y - y) <= 2)
      if (b) b.items.push(it); else baselines.push({ y, items: [it] })
    }
    baselines.sort((a, b) => b.y - a.y)

    const rows: PdfRow[] = []
    for (const b of baselines) {
      b.items.sort((a, c) => a.transform[4] - c.transform[4])
      const chunks = toChunks(b.items)
      if (chunks.filter(c => HEADER_HINT.test(c.text)).length >= 3) {
        columns = chunks.map((c, i) => ({
          start: i === 0 ? -Infinity : (chunks[i - 1].x2 + c.x) / 2,
          end: i === chunks.length - 1 ? Infinity : (c.x2 + chunks[i + 1].x) / 2,
        }))
        const valueDate = chunks.findIndex(c => /value ?date/i.test(c.text))
        dateCol = valueDate >= 0 ? valueDate : Math.max(0, chunks.findIndex(c => /date/i.test(c.text)))
        rows.push({ y: b.y, cells: chunks.map(c => c.text), inTable: false })
        if (headerRow == null) headerRow = grid.length + rows.length - 1
        continue
      }
      if (!columns) { rows.push({ y: b.y, cells: chunks.map(c => c.text), inTable: false }); continue }
      // Each word goes in the column it sits under.
      const cells = columns.map(() => [] as string[])
      for (const it of b.items) {
        const mid = it.transform[4] + (it.width || it.str.length * 4) / 2
        let idx = columns.findIndex(col => mid >= col.start && mid < col.end)
        if (idx < 0) idx = columns.length - 1
        cells[idx].push(it.str.trim())
      }
      const text = cells.map(c => c.join(' ').replace(/\s+/g, ' ').trim())
      rows.push({ y: b.y, cells: text, inTable: !SUMMARY_ROW.test(text.join(' ')) })
    }
    grid.push(...joinWrappedRows(rows, dateCol).map(r => r.cells))
  }
  if (!sawText) {
    throw new Error('This PDF is a scanned image with no text in it. Ask the bank for the CSV or Excel export, or a PDF downloaded from internet banking.')
  }
  return { grid, headerRow }
}

function toChunks(items: PdfItem[]): Chunk[] {
  const chunks: Chunk[] = []
  for (const it of items) {
    const x = it.transform[4]
    const x2 = x + (it.width || it.str.length * 4)
    const last = chunks[chunks.length - 1]
    // Words a space apart are one piece of text; a wider gap starts the next.
    if (last && x - last.x2 <= Math.max(2.5, (it.height || 8) * 0.35)) {
      last.text += (x - last.x2 > 0.5 ? ' ' : '') + it.str
      last.x2 = x2
    } else chunks.push({ x, x2, text: it.str })
  }
  return chunks.map(c => ({ ...c, text: c.text.replace(/\s+/g, ' ').trim() }))
}

/**
 * Pieces of a wrapped description sit on lines with no date. Lines of one
 * transaction are closer together than the gap between transactions, so the
 * table is first cut at the wider gaps; a block holding exactly one dated
 * line is that transaction. Otherwise: when the page's first row under the
 * header has a date, cells are top-aligned and a piece belongs to the
 * transaction above it; if not, to the nearest dated line.
 */
function joinWrappedRows(rows: PdfRow[], dateCol: number): PdfRow[] {
  const isAnchor = (r: PdfRow) => r.inTable && parseDate(r.cells[dateCol] ?? '') != null
  const anchors = rows.filter(isAnchor)
  if (anchors.length === 0) return rows
  const table = rows.filter(r => r.inTable)
  const topAligned = isAnchor(table[0])
  const home = new Map<PdfRow, PdfRow>()

  // Line spacing inside a cell: the tightest gap between two wrapped pieces
  // (between transactions there's the cell padding too). Cut at the wider gaps.
  const gaps = table.slice(1).map((r, i) => table[i].y - r.y)
  const within = gaps.filter((g, i) => g >= 3 && !isAnchor(table[i]) && !isAnchor(table[i + 1]))
  const lineSpacing = within.length ? Math.min(...within) : Infinity
  const blocks: PdfRow[][] = [[]]
  table.forEach((r, i) => {
    if (i > 0 && gaps[i - 1] > lineSpacing * 1.25) blocks.push([])
    blocks[blocks.length - 1].push(r)
  })
  let lastAnchor: PdfRow | null = null
  for (const block of blocks) {
    const inBlock = block.filter(isAnchor)
    for (const r of block) {
      if (isAnchor(r)) { lastAnchor = r; continue }
      if (inBlock.length === 1) { home.set(r, inBlock[0]); continue }
      const h = topAligned ? lastAnchor
        : anchors.reduce((best, a) => (Math.abs(a.y - r.y) < Math.abs(best.y - r.y) ? a : best), anchors[0])
      if (h) home.set(r, h)
    }
  }

  const pieces = new Map<PdfRow, PdfRow[]>(anchors.map(a => [a, [a]]))
  for (const [piece, anchor] of home) pieces.get(anchor)!.push(piece)
  return rows.filter(r => !home.has(r)).map(r => {
    const group = pieces.get(r)
    if (!group || group.length === 1) return r
    group.sort((a, b) => b.y - a.y)
    return { ...r, cells: r.cells.map((_, i) => group.map(g => g.cells[i]).filter(Boolean).join(' ').trim()) }
  })
}
