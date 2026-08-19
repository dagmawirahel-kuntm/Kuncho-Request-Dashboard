import ExcelJS from 'exceljs'

// Parses a real BOQ Excel file into the tree shape create_boq_from_parsed_tree
// expects. Built directly against a real sample file (ABAY_DETAIL_PRICE.xlsx),
// not a guessed format -- its actual conventions:
//
//   - A preamble (invoice header, client info) precedes a column-header row
//     whose DESCRIPTION cell marks where the real data starts.
//   - Room-level headers (depth 1) live in column A, on their own row.
//   - Category-level headers (depth 2) live in column B, merged B:G on that
//     row -- there is no dedicated column for them; the merge is the signal.
//   - Line items (depth 3) also live in column B, but are NOT merged, and
//     carry real numeric Unit/Qty/Rate in columns E/F/G. Column D holds an
//     optional clarifying note, independent of the merge-replicated text a
//     header row shows in every column it spans.
//   - Every row (headers included) carries the same `=Rate*Qty` formula in
//     the TOTAL column, so header rows harmlessly evaluate to 0 -- there is
//     no real per-section subtotal formula to lean on.
//   - A "GRAND TOTAL" row closes the hierarchical section. What follows,
//     up to a "TOTAL PRICE" row (or the end of the sheet), is a short list
//     of flat lump-sum add-ons with no unit/qty/rate breakdown at all --
//     these become top-level lump_sum items, not children of any room.

export type ParsedNodeType = 'section' | 'line_item' | 'lump_sum'

export interface ParsedBoqNode {
  client_key: string
  parent_client_key: string | null
  node_type: ParsedNodeType
  name: string
  notes: string | null
  unit: string | null
  quantity: number | null
  unit_rate_etb: number | null
  total_etb: number | null
  is_priced_elsewhere: boolean
  display_order: number
  depth: number // preview indentation only, not sent to the RPC
}

export interface SkippedRow {
  row: number
  reason: string
}

export interface ParsedBoq {
  nodes: ParsedBoqNode[]
  warnings: string[]
  skippedRows: SkippedRow[]
  declaredGrandTotal: number | null
  computedGrandTotal: number
}

const HEADER_ROW_MARKER = /description/i
const GRAND_TOTAL_MARKER = /grand\s*total/i
const FINAL_TOTAL_MARKER = /total\s*price/i

function cellText(cell: ExcelJS.Cell): string | null {
  const v = cell.value
  if (v == null) return null
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'object') {
    // Rich text: mixed formatting within one cell -- exceljs represents it
    // as { richText: [{ text, font? }, ...] } instead of a plain string.
    // Found via a real row in the sample file ("Column cladding") that was
    // otherwise a completely normal line item; without this, the whole row
    // silently vanished (no name in either grouping column -> treated as a
    // blank spacer), a real ~77k ETB gap against the file's own declared total.
    const richText = (v as { richText?: { text?: string }[] }).richText
    if (Array.isArray(richText)) {
      const joined = richText.map(r => r.text ?? '').join('').trim()
      return joined || null
    }
    if ('result' in v) {
      const r = (v as { result?: unknown }).result
      return typeof r === 'string' ? r.trim() || null : null
    }
  }
  return null
}

function cellNumber(cell: ExcelJS.Cell): number | null {
  const v = cell.value
  if (typeof v === 'number') return v
  if (typeof v === 'object' && v != null && 'result' in (v as object)) {
    const r = (v as { result?: unknown }).result
    if (typeof r === 'number') return r
  }
  return null
}

// A row anywhere in the merged range reads back the merge's top-left value
// via exceljs; only the anchor cell's own coordinates equal its own address.
function isMergeAnchor(cell: ExcelJS.Cell): boolean {
  return !cell.isMerged || cell.master?.address === cell.address
}

function findRowByMarker(ws: ExcelJS.Worksheet, marker: RegExp, fromRow: number, toRow?: number): number | null {
  const last = toRow ?? ws.rowCount
  for (let r = fromRow; r <= last; r++) {
    const row = ws.getRow(r)
    for (let c = 1; c <= (ws.columnCount || 10); c++) {
      const text = cellText(row.getCell(c))
      if (text && marker.test(text)) return r
    }
  }
  return null
}

export async function parseBoqExcel(buffer: ArrayBuffer): Promise<ParsedBoq> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const ws = wb.worksheets[0]
  if (!ws) throw new Error('The workbook has no sheets')

  const warnings: string[] = []
  const skippedRows: SkippedRow[] = []
  const nodes: ParsedBoqNode[] = []

  const headerRow = findRowByMarker(ws, HEADER_ROW_MARKER, 1, 60)
  if (headerRow == null) {
    throw new Error('Could not find the column header row (looking for a "DESCRIPTION" cell) -- this file may not match the expected BOQ layout')
  }

  const grandTotalRow = findRowByMarker(ws, GRAND_TOTAL_MARKER, headerRow + 1)
  const itemsEndRow = grandTotalRow ? grandTotalRow - 1 : ws.rowCount

  let displayOrder = 0
  let roomKey: string | null = null
  let categoryKey: string | null = null
  let keyCounter = 0
  function nextKey() { return `n${keyCounter++}` }

  for (let r = headerRow + 1; r <= itemsEndRow; r++) {
    const row = ws.getRow(r)
    const aCell = row.getCell(1)
    const bCell = row.getCell(2)
    const aText = cellText(aCell)
    const bText = cellText(bCell)

    if (!aText && !bText) continue // blank spacer row

    if (aText && isMergeAnchor(aCell)) {
      // Room-level header
      const key = nextKey()
      displayOrder++
      nodes.push({
        client_key: key, parent_client_key: null, node_type: 'section',
        name: aText, notes: null, unit: null, quantity: null, unit_rate_etb: null, total_etb: null,
        is_priced_elsewhere: false, display_order: displayOrder, depth: 1,
      })
      roomKey = key
      categoryKey = null
      continue
    }

    if (!bText) {
      skippedRows.push({ row: r, reason: 'No description text found in either the room or item column' })
      continue
    }

    const qty = cellNumber(row.getCell(6))
    const rate = cellNumber(row.getCell(7))
    const looksLikeHeader = bCell.isMerged

    if (looksLikeHeader) {
      if (qty != null || rate != null) {
        // A merged row that somehow also carries real numbers -- ambiguous,
        // don't silently guess which reading is right.
        skippedRows.push({ row: r, reason: `"${bText}" looks like a category header (merged row) but also has a quantity/rate -- flagged rather than guessed` })
        continue
      }
      const key = nextKey()
      displayOrder++
      nodes.push({
        client_key: key, parent_client_key: roomKey, node_type: 'section',
        name: bText, notes: null, unit: null, quantity: null, unit_rate_etb: null, total_etb: null,
        is_priced_elsewhere: false, display_order: displayOrder, depth: roomKey ? 2 : 1,
      })
      categoryKey = key
      continue
    }

    // Line item. A quantity with no rate is PR 9a's is_priced_elsewhere
    // case -- a real pattern in this file, not malformed data: rows like
    // "12 pcs Meeting chair" with no price, whose cost is folded into one
    // of the trailing lump-sum totals (FURNITURE/TV/FLAG/...) instead of
    // priced per line. Only a rate with no quantity, or neither present,
    // is genuinely ambiguous.
    const unit = cellText(row.getCell(5))
    if (qty == null) {
      skippedRows.push({ row: r, reason: `"${bText}" has no room/category grouping and no quantity -- can't tell if this is a line item or a mis-formatted header` })
      continue
    }
    const notes = cellText(row.getCell(4))
    const isPricedElsewhere = rate == null
    displayOrder++
    nodes.push({
      client_key: nextKey(), parent_client_key: categoryKey ?? roomKey, node_type: 'line_item',
      name: bText, notes, unit, quantity: qty,
      unit_rate_etb: isPricedElsewhere ? 0 : rate,
      total_etb: isPricedElsewhere ? 0 : qty * (rate as number),
      is_priced_elsewhere: isPricedElsewhere,
      display_order: displayOrder, depth: roomKey ? (categoryKey ? 3 : 2) : 1,
    })
  }

  if (nodes.length === 0) {
    throw new Error('No BOQ rows were recognized in this file')
  }

  // Lump-sum tail: rows after GRAND TOTAL up to (not including) TOTAL PRICE.
  let declaredGrandTotal: number | null = null
  if (grandTotalRow) {
    const gtRow = ws.getRow(grandTotalRow)
    for (let c = 1; c <= (ws.columnCount || 10); c++) {
      const n = cellNumber(gtRow.getCell(c))
      if (n != null) { declaredGrandTotal = n; break }
    }

    const finalTotalRow = findRowByMarker(ws, FINAL_TOTAL_MARKER, grandTotalRow + 1)
    const tailEnd = finalTotalRow ? finalTotalRow - 1 : ws.rowCount
    for (let r = grandTotalRow + 1; r <= tailEnd; r++) {
      const row = ws.getRow(r)
      let label: string | null = null
      let total: number | null = null
      for (let c = 1; c <= (ws.columnCount || 10); c++) {
        const cell = row.getCell(c)
        const t = cellText(cell)
        const n = cellNumber(cell)
        if (t && !label) label = t
        if (n != null) total = n
      }
      if (!label && total == null) continue
      if (!label || total == null) {
        skippedRows.push({ row: r, reason: 'Expected a lump-sum add-on (label + flat total) but only found one of the two' })
        continue
      }
      displayOrder++
      nodes.push({
        client_key: nextKey(), parent_client_key: null, node_type: 'lump_sum',
        name: label, notes: null, unit: null, quantity: null, unit_rate_etb: null, total_etb: total,
        is_priced_elsewhere: false, display_order: displayOrder, depth: 1,
      })
    }

    if (declaredGrandTotal == null) {
      warnings.push('Could not read a numeric value off the GRAND TOTAL row')
    }
  } else {
    warnings.push('No "GRAND TOTAL" row found -- treating the whole sheet as the itemized section, no lump-sum add-ons parsed')
  }

  const computedGrandTotal = nodes.reduce((sum, n) => sum + (n.node_type !== 'section' ? (n.total_etb ?? 0) : 0), 0)

  if (skippedRows.length > 0) {
    warnings.push(`${skippedRows.length} row(s) could not be confidently classified and were skipped -- review before importing`)
  }

  return { nodes, warnings, skippedRows, declaredGrandTotal, computedGrandTotal }
}
