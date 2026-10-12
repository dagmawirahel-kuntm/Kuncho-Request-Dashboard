// The stock count on paper (migration 446). Printed from a count, carried
// round the shelves, filled in by hand and typed in afterwards. The number
// on the left of each row is the line number on the screen, so typing in
// goes row for row. Blind by default: the system's figure is left off, so
// whoever counts writes what is there rather than what is expected.
// A count that is already posted or cancelled prints as its result instead.
import QRCode from 'qrcode'
import { BRAND_NAVY, companyName, esc } from '@/lib/documentTheme'
import { formatEthiopian } from '@/lib/ethiopianCalendar'
import { formatDateGC } from '@/lib/utils'

export interface SheetCount {
  id: string
  code: string
  warehouse_zone: string | null
  status: string
  count_date: string
  notes: string | null
  paper_counted_by?: string | null
}

export interface SheetLine {
  line_no: number | null
  item_name: string
  amharic_name: string | null
  item_code: string | null
  unit: string
  warehouse_zone: string | null
  system_qty: number
  counted_qty: number | null
  note: string | null
}

export interface SheetOptions {
  /** Leave out what the system says, so the count isn't copied from it. */
  blind: boolean
  /** Only the lines nobody has counted yet, for a second round. */
  onlyUncounted: boolean
  /** Empty rows at the end for things on the shelf that aren't on the list. */
  blankRows: number
  /** Which print this is, on every page, so an old copy is easy to spot. */
  printNo: number
  /** What the QR code opens: this count on the screen. */
  url: string
}

const qty = (v: number | null | undefined) => v == null ? '' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 3 })
const both = (d: string) => `${esc(formatDateGC(d))} <span class="ec">(${esc(formatEthiopian(d))} E.C.)</span>`
// For the page corners, which are CSS strings.
const cssStr = (s: string) => s.replace(/[\\"<>\n]/g, ' ')

function css(footer: string) {
  return `
  @page {
    size: A4; margin: 10mm 10mm 13mm;
    @bottom-left { content: "${cssStr(footer)}"; font: 8pt Arial, sans-serif; color: #555; }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8pt Arial, sans-serif; color: #555; }
  }
  * { box-sizing: border-box; }
  body { font-family: Arial, "Noto Sans Ethiopic", "Nyala", sans-serif; color: #111; margin: 0; font-size: 10.5px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  header { display: flex; justify-content: space-between; gap: 12px; border-bottom: 2px solid ${BRAND_NAVY}; padding-bottom: 6px; }
  header h1 { font-size: 18px; margin: 1px 0 4px; color: ${BRAND_NAVY}; }
  .co { color: #555; font-size: 10px; letter-spacing: .3px; }
  .meta { display: grid; grid-template-columns: auto auto; gap: 1px 10px; font-size: 10.5px; }
  .meta span { color: #555; }
  .qr { text-align: center; font-size: 8.5px; color: #555; width: 25mm; }
  .qr svg { width: 22mm; height: 22mm; display: block; margin: 0 auto 2px; }
  .qr b { display: block; color: #111; font-size: 12px; letter-spacing: .5px; }
  .how { border: 1px solid #999; background: #f6f8fa; padding: 5px 8px; margin: 7px 0 8px; font-size: 9.5px; }
  .how ol { margin: 2px 0 0; padding-left: 15px; }
  .how li { margin: 1px 0; }
  .blind { display: inline-block; border: 1px solid ${BRAND_NAVY}; color: ${BRAND_NAVY}; border-radius: 3px; padding: 0 4px; font-size: 9px; font-weight: bold; }
  h2 { font-size: 11px; margin: 10px 0 3px; color: ${BRAND_NAVY}; text-transform: uppercase; letter-spacing: .4px; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  th, td { border: 1px solid #777; padding: 2px 4px; vertical-align: middle; text-align: left; }
  th { background: #e9eef4; font-size: 9px; text-transform: uppercase; letter-spacing: .3px; }
  td { height: 8.5mm; }
  tbody tr:nth-child(even) td:not(.box) { background: #fafafa; }
  body.result td { height: 6mm; }
  .no { width: 9mm; text-align: center; font-weight: bold; font-variant-numeric: tabular-nums; }
  .name b { font-size: 10.5px; }
  .name .am { display: block; color: #444; font-size: 9.5px; }
  .code { width: 22mm; font-size: 9px; color: #333; }
  .unit { width: 13mm; font-size: 9.5px; }
  .num { width: 17mm; text-align: right; font-variant-numeric: tabular-nums; }
  .box { width: 24mm; background: #fff; border: 1.6px solid #111; }
  th.box { background: #e9eef4; border: 1px solid #777; }
  .rem { width: 34mm; }
  .zone td { height: auto; background: #dfe6ee !important; font-weight: bold; color: ${BRAND_NAVY}; font-size: 10px; padding: 3px 6px; }
  .neg { color: #b42318; font-weight: bold; } .pos { color: #067647; font-weight: bold; }
  .sign { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 22px; page-break-inside: avoid; }
  .sign div { border-top: 1px solid #111; padding-top: 3px; font-size: 9.5px; }
  .sign div b { display: block; font-size: 10.5px; margin-bottom: 1px; }
  .office { margin-top: 12px; border: 1px dashed #555; padding: 5px 8px; font-size: 9.5px; page-break-inside: avoid; }
  .line { border-bottom: 1px solid #111; display: inline-block; min-width: 120px; height: 12px; }
  .tick { display: inline-block; width: 10px; height: 10px; border: 1px solid #111; vertical-align: -1px; margin: 0 3px 0 6px; }
  .ec { color: #555; font-size: 9.5px; }
  .muted { color: #555; }
  `
}

export async function stockCountSheetHtml(count: SheetCount, allLines: SheetLine[], o: SheetOptions): Promise<string> {
  const result = count.status !== 'counting'
  const lines = [...allLines]
    .filter(l => result || !o.onlyUncounted || l.counted_qty == null)
    .sort((a, b) => (a.line_no ?? 1e9) - (b.line_no ?? 1e9) || a.item_name.localeCompare(b.item_name))
  const showSystem = result || !o.blind
  const zones = new Set(lines.map(l => l.warehouse_zone ?? ''))
  const grouped = zones.size > 1
  const cols = 5 + (showSystem ? 1 : 0) + (result ? 1 : 0)

  const qr = await QRCode.toString(o.url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' })
  const printed = new Date()
  const printedAt = `${formatDateGC(printed.toISOString())} ${printed.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
  const where = count.warehouse_zone ?? 'Everything'
  const title = result ? 'Stock count result' : 'Stock count sheet'

  let lastZone: string | null = null
  const rows = lines.map(l => {
    const z = l.warehouse_zone ?? ''
    const head = grouped && z !== lastZone ? `<tr class="zone"><td colspan="${cols}">${esc(z || 'No location set')}</td></tr>` : ''
    lastZone = z
    const d = l.counted_qty == null ? null : Number(l.counted_qty) - Number(l.system_qty)
    return `${head}<tr>
      <td class="no">${l.line_no ?? ''}</td>
      <td class="name"><b>${esc(l.item_name)}</b>${l.amharic_name ? `<span class="am">${esc(l.amharic_name)}</span>` : ''}</td>
      <td class="code">${esc(l.item_code ?? '')}</td>
      <td class="unit">${esc(l.unit)}</td>
      ${showSystem ? `<td class="num">${qty(l.system_qty)}</td>` : ''}
      <td class="box${result ? ' num' : ''}">${result ? (l.counted_qty == null ? '<span class="muted">not counted</span>' : `<b>${qty(l.counted_qty)}</b>`) : ''}</td>
      ${result ? `<td class="num ${d && d < 0 ? 'neg' : d && d > 0 ? 'pos' : ''}">${d == null ? '' : d === 0 ? '✓' : `${d > 0 ? '+' : ''}${qty(d)}`}</td>` : ''}
      <td class="rem">${result ? esc(l.note ?? '') : ''}</td>
    </tr>`
  }).join('')

  const blanks = result ? '' : Array.from({ length: Math.max(0, o.blankRows) }).map(() =>
    '<tr><td class="no"></td><td class="name"></td><td class="code"></td><td class="unit"></td><td class="box"></td><td class="rem"></td></tr>').join('')

  const body = `
  <header>
    <div>
      <div class="co">${esc(companyName())}</div>
      <h1>${title}</h1>
      <div class="meta">
        <span>Count</span><b>${esc(count.code)}</b>
        <span>Where</span><b>${esc(where)}</b>
        <span>Started</span><div>${both(count.count_date)}</div>
        <span>Lines</span><div>${lines.length}${lines.length !== allLines.length ? ` <span class="muted">of ${allLines.length} — only those not counted yet</span>` : ''}</div>
        ${count.notes ? `<span>Note</span><div>${esc(count.notes)}</div>` : ''}
        <span>Printed</span><div>${esc(printedAt)}${result ? '' : ` · print no. <b>${o.printNo}</b>`}${!result && o.blind ? ' &nbsp;<span class="blind">BLIND COUNT</span>' : ''}</div>
      </div>
    </div>
    <div class="qr">${qr}<b>${esc(count.code)}</b>Scan to open this count</div>
  </header>

  ${result ? '' : `
  <div class="how"><b>How to fill this in</b>
    <ol>
      <li>Count each item where it sits and write the number in the <b>Counted</b> box, in the unit shown. None there: write <b>0</b>. An empty box means "not counted".</li>
      <li>Damaged, expired or set aside for someone? Count it, and say how many under <b>Remark</b>.</li>
      <li>Made a mistake? Cross it out and write the right number beside it. Don't write over it.</li>
      <li>Something on the shelf that isn't on this list goes in the rows at the end.</li>
      <li>Nothing goes in or out of these shelves until the sheet is back and typed in.</li>
    </ol>
  </div>`}

  <table>
    <thead><tr>
      <th class="no">#</th><th>Item</th><th class="code">Code</th><th class="unit">Unit</th>
      ${showSystem ? '<th class="num">System</th>' : ''}
      <th class="box${result ? ' num' : ''}">Counted</th>
      ${result ? '<th class="num">Difference</th>' : ''}
      <th class="rem">Remark</th>
    </tr></thead>
    <tbody>${rows || `<tr><td colspan="${cols}" class="muted">Nothing left to count.</td></tr>`}</tbody>
  </table>

  ${blanks ? `
  <h2>Found on the shelf but not on this list</h2>
  <table>
    <thead><tr><th class="no">#</th><th>Item — name or description</th><th class="code">Code, if known</th><th class="unit">Unit</th><th class="box">Counted</th><th class="rem">Remark</th></tr></thead>
    <tbody>${blanks}</tbody>
  </table>` : ''}

  <div class="sign">
    <div><b>Counted by</b>${result && count.paper_counted_by ? esc(count.paper_counted_by) : 'Name and signature'}</div>
    <div><b>Checked by</b>Name and signature</div>
    <div><b>Finished</b>Date and time</div>
  </div>
  ${result ? '' : `
  <div class="office">
    <b>Office</b> — Typed into the system by <span class="line"></span> on <span class="line" style="min-width:90px"></span>
    <span class="tick"></span>Photo of this sheet kept with the count
  </div>`}`

  const footer = `${count.code} · ${where}${result ? '' : ` · print no. ${o.printNo} · ${printedAt}`}`
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} ${esc(count.code)}</title><style>${css(footer)}</style></head><body${result ? ' class="result"' : ''}>${body}</body></html>`
}
