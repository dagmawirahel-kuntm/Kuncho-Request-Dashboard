// The week draft for a PM (labour week report): the Excel template, filled
// in with what Kuncho already knows — the PM, the week, the workers they had
// lately and their open piece / fixed-price jobs with each crew — so the PM
// only writes the days. It reads back through Paste a report (labourPaste):
// worker rows, then the Piece work block, which each job's Code ties back.
import type { PieceJob } from '@/lib/labourDay'
import { jobCode } from '@/lib/labourPaste'

const DAYS = ['Mon ሰኞ', 'Tue ማክሰኞ', 'Wed ረቡዕ', 'Thu ሐሙስ', 'Fri ዓርብ', 'Sat ቅዳሜ', 'Sun እሁድ']
const YELLOW = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4C2' } } as const
const GREY = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2F6' } } as const
const BLUE = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE4EEF8' } } as const
const thin = { style: 'thin', color: { argb: 'FFB8C2CC' } } as const
const box = { top: thin, left: thin, bottom: thin, right: thin }

type DraftInput = {
  pmName: string
  /** Monday, YYYY-MM-DD. */
  week: string
  /** Names to start the worker rows with (recent workers of this PM). */
  workers: { name: string; where: string | null }[]
  /** What the Where column offers: the PM's projects, Workshop, Stock… */
  wheres: string[]
  jobs: PieceJob[]
  blankRows?: number
}

export async function downloadWeekDraft(input: DraftInput) {
  const buf = await buildWeekDraft(input)
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `Labour week ${input.week} — ${input.pmName.replace(/[\\/:*?"<>|]/g, ' ')}.xlsx`
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

/** The draft workbook's bytes. */
export async function buildWeekDraft({ pmName, week, workers, wheres, jobs, blankRows = 8 }: DraftInput): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Week report', { views: [{ state: 'frozen', xSplit: 1, ySplit: 7 }] })
  ws.columns = [{ width: 34 }, ...DAYS.map(() => ({ width: 11 })), { width: 24 }, { width: 16 }, { width: 22 }, { width: 13 }]
  const monday = new Date(`${week}T00:00:00`)

  ws.getCell('A1').value = 'Labour week report — casual workers and piece work'
  ws.getCell('A1').font = { bold: true, size: 14 }
  ws.getCell('A2').value = 'የሳምንት የቀን ሠራተኞች እና የቁራጭ ሥራ ሪፖርት · send it by Saturday with the photo of the signed attendance sheet'
  ws.getCell('A2').font = { italic: true, color: { argb: 'FF5B6675' } }
  ws.getCell('A3').value = 'PM'; ws.getCell('B3').value = pmName
  ws.getCell('A4').value = 'Week starting (Monday)'; ws.getCell('B4').value = monday; ws.getCell('B4').numFmt = 'ddd d mmm yyyy'
  for (const a of ['A3', 'A4']) ws.getCell(a).font = { bold: true }
  ws.mergeCells('B3:D3'); ws.mergeCells('B4:D4')
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 }
  ws.getCell('F3').value = 'Fill the yellow cells.'
  ws.getCell('F4').value = "1 = full day · 0.5 = half day · empty = didn't work · 1+2 = 2 h overtime"

  // ── Workers ──
  ws.getCell('A6').value = 'Date'
  DAYS.forEach((_, i) => {
    const c = ws.getCell(6, 2 + i)
    c.value = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)
    c.numFmt = 'd mmm'; c.alignment = { horizontal: 'center' }; c.font = { color: { argb: 'FF5B6675' } }
  })
  const head = ws.getRow(7)
  head.values = ['Worker (full name)', ...DAYS, 'Where', 'Overtime', 'Days']
  head.eachCell(c => { c.font = { bold: true }; c.fill = GREY; c.border = box; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true } })

  let r = 8
  const rows = [...workers, ...Array.from({ length: blankRows }, () => ({ name: '', where: null }))]
  const firstWorker = r
  for (const w of rows) {
    const row = ws.getRow(r)
    row.getCell(1).value = w.name || null
    if (w.where) row.getCell(9).value = w.where
    for (let c = 2; c <= 10; c++) { const cell = row.getCell(c); cell.fill = YELLOW; cell.border = box; if (c <= 8) cell.alignment = { horizontal: 'center' } }
    row.getCell(1).border = box
    row.getCell(11).value = { formula: `SUMPRODUCT(IFERROR(--LEFT(SUBSTITUTE(TRIM(B${r}:H${r}),"+"," ")&" ",FIND(" ",SUBSTITUTE(TRIM(B${r}:H${r}),"+"," ")&" ")-1),0))` }
    row.getCell(11).border = box
    r++
  }
  const lastWorker = r - 1
  if (wheres.length) {
    const list = `"${wheres.map(w => w.replace(/[",]/g, ' ')).join(',').slice(0, 250)}"`
    for (let i = firstWorker; i <= lastWorker; i++) {
      ws.getCell(i, 9).dataValidation = { type: 'list', allowBlank: true, showErrorMessage: false, formulae: [list] }
    }
  }
  const total = ws.getRow(r)
  total.getCell(1).value = 'Total'
  total.getCell(1).font = { bold: true }
  for (let c = 2; c <= 8; c++) {
    const col = String.fromCharCode(64 + c)
    total.getCell(c).value = { formula: `SUMPRODUCT(IFERROR(--LEFT(SUBSTITUTE(TRIM(${col}${firstWorker}:${col}${lastWorker}),"+"," ")&" ",FIND(" ",SUBSTITUTE(TRIM(${col}${firstWorker}:${col}${lastWorker}),"+"," ")&" ")-1),0))` }
    total.getCell(c).alignment = { horizontal: 'center' }
  }
  total.getCell(11).value = { formula: `SUM(K${firstWorker}:K${lastWorker})` }
  r += 2

  // ── Piece work ──
  ws.getCell(r, 1).value = 'Piece work · ቁራጭ ሥራ'
  ws.getCell(r, 1).font = { bold: true, size: 12 }
  ws.getCell(r, 3).value = 'Tick (✓ or 1) the days the crew worked. Measured = the amount done this week; for a fixed-price job, the % done so far.'
  ws.getCell(r, 3).font = { italic: true, color: { argb: 'FF5B6675' } }
  r++
  const ph = ws.getRow(r)
  ph.values = ['Job', ...DAYS, 'Measured', 'Unit', 'Crew', 'Code']
  ph.eachCell(c => { c.font = { bold: true }; c.fill = BLUE; c.border = box; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true } })
  r++
  const jobRows = jobs.length ? jobs : []
  for (const j of jobRows) {
    const row = ws.getRow(r)
    row.getCell(1).value = `${j.what} · ${j.project}`
    row.getCell(1).alignment = { wrapText: true, vertical: 'top' }
    for (let c = 2; c <= 9; c++) { const cell = row.getCell(c); cell.fill = YELLOW; cell.border = box; cell.alignment = { horizontal: 'center', vertical: 'top' } }
    row.getCell(10).value = j.basis === 'per_volume' ? (j.unit ?? 'unit') : '% done to date'
    row.getCell(11).value = j.crew.map(c => c.name).join(', ') || '—'
    row.getCell(11).alignment = { wrapText: true, vertical: 'top' }
    row.getCell(12).value = jobCode(j.id)
    row.getCell(12).font = { color: { argb: 'FF8A94A3' }, size: 9 }
    for (const c of [1, 10, 11, 12]) row.getCell(c).border = box
    r++
  }
  // Room for a job the PM writes in by name.
  for (let i = 0; i < 3; i++) {
    const row = ws.getRow(r)
    for (let c = 1; c <= 9; c++) { const cell = row.getCell(c); if (c > 1) cell.fill = YELLOW; cell.border = box }
    r++
  }
  r++
  ws.getCell(r, 1).value = 'Days counts every day, including cells like "1 Workshop" or "1+2". Piece-work crews are paid by the job, not by the day — list them under Piece work, not as workers.'
  ws.getCell(r + 1, 1).value = 'PM signature: ____________________     Date: ______________'

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}

/** A filled draft (or the old template) as tab-separated lines, for Paste a report. */
export async function workbookToText(buffer: ArrayBuffer): Promise<string> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const ws = wb.worksheets.find(w => /week/i.test(w.name)) ?? wb.worksheets[0]
  const lines: string[] = []
  ws.eachRow({ includeEmpty: false }, row => {
    const cells: string[] = []
    for (let c = 1; c <= Math.max(row.cellCount, 12); c++) {
      const cell = row.getCell(c)
      const v = cell.value
      let t: string
      if (v instanceof Date) t = v.toISOString().slice(0, 10)
      else if (v && typeof v === 'object' && 'formula' in v) t = ''   // totals, dates: not report data
      else t = (cell.text ?? '').toString()
      cells.push(t.replace(/[\t\n\r]+/g, ' ').trim())
    }
    lines.push(cells.join('\t').replace(/\t+$/, ''))
  })
  return lines.join('\n')
}
