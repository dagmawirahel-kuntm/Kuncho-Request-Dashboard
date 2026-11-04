// Export a list to an Excel workbook. Used where the data is people's
// details: account numbers, phone numbers and IDs are written as text, so
// Excel keeps their leading zeros and every digit (a CSV opened in Excel
// turns 0047784497011 into 4.77845E+10). Money is a number with two
// decimals, dates are real dates, and the header row is frozen and filtered.

export type XlsxKind = 'text' | 'money' | 'number' | 'date'

export interface XlsxColumn<T> {
  header: string
  value: (row: T) => string | number | null | undefined
  kind?: XlsxKind
  width?: number
}

const FORMATS: Record<XlsxKind, string> = { text: '@', money: '#,##0.00', number: '0', date: 'dd mmm yyyy' }

function cellValue(v: string | number | null | undefined, kind: XlsxKind): string | number | Date | null {
  if (v == null || v === '') return null
  if (kind === 'text') return String(v)
  if (kind === 'date') {
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/)
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : String(v)
  }
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : String(v)
}

/** Today as yyyy-mm-dd, for file names. */
export const fileDate = () => new Date().toISOString().slice(0, 10)

export async function downloadXlsx<T>(filename: string, sheetName: string, columns: XlsxColumn<T>[], rows: T[]) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.created = new Date()
  const ws = wb.addWorksheet(sheetName.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = columns.map((c, i) => ({
    key: String(i),
    header: c.header,
    width: c.width ?? Math.min(40, Math.max(c.header.length + 2, 12)),
    style: { numFmt: FORMATS[c.kind ?? 'text'] },
  }))
  for (const r of rows) {
    ws.addRow(Object.fromEntries(columns.map((c, i) => [String(i), cellValue(c.value(r), c.kind ?? 'text')])))
  }
  ws.getRow(1).font = { bold: true }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } }

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
