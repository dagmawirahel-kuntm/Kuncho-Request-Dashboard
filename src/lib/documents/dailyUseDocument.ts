// The daily "what was it used for" form (547): a day's request lines by who
// asked for them, each with a place to say what it went to — a project,
// stock, or the workshop's running costs — plus the stock issued that day and
// blank rows for stock taken without a slip. Printed in the morning, filled
// in by hand, signed, and entered back on the Daily use page.
import { documentBaseCss, renderLetterhead, renderFooter, renderHeading, esc, docDate } from '@/lib/documentTheme'
import type { DailyUseLine, DailyUseSheet } from '@/lib/dailyUse'

const qty = (n: number | null, unit: string | null) =>
  n == null ? '—' : `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 3 })} ${unit ?? ''}`.trim()

function useCell(l: DailyUseLine): string {
  const box = (on: boolean) => `<span class="box">${on ? '✓' : ''}</span>`
  const project = l.used_for === 'project' ? esc(l.used_for_project ?? '') : ''
  return `<div class="use">
    <span>${box(l.used_for === 'project')} Project <span class="blank">${project}</span></span>
    <span>${box(l.used_for === 'stock')} Stock</span>
    <span>${box(l.used_for === 'workshop')} Workshop</span>
  </div>`
}

export function buildDailyUseHtml(sheet: DailyUseSheet, blankStockRows = 6): string {
  const byOwner = new Map<string, DailyUseLine[]>()
  for (const l of sheet.lines) {
    const k = l.owner ?? 'Not said'
    byOwner.set(k, [...(byOwner.get(k) ?? []), l])
  }
  const groups = [...byOwner].map(([owner, lines]) => `
    <div class="group">
      <div class="owner">${esc(owner)}</div>
      <table class="doc-table">
        <thead><tr>
          <th style="width:26px" class="c">#</th><th>Item</th><th class="r" style="width:80px">Qty</th>
          <th style="width:92px">Request</th><th style="width:250px">Used for</th>
        </tr></thead>
        <tbody>${lines.map((l, i) => `<tr>
          <td class="c">${i + 1}</td>
          <td><b>${esc(l.item)}</b>${l.po ? `<div class="muted">On ${esc(l.po)}</div>` : ''}${l.held ? '<div class="muted">Waiting for approval</div>' : ''}</td>
          <td class="r">${esc(qty(l.quantity, l.unit))}</td>
          <td>${esc(l.request_code ?? '')}</td>
          <td>${useCell(l)}</td>
        </tr>`).join('')}</tbody>
      </table>
      <div class="sig"><span>Signed by ${esc(owner === 'Not said' ? '' : owner)}</span><span class="line"></span></div>
    </div>`).join('')

  const stockRows = sheet.stock.map(s => `<tr>
      <td><b>${esc(s.item)}</b></td><td class="r">${esc(qty(s.quantity, s.unit))}</td>
      <td>${esc(s.to ?? '')}</td><td>${esc(s.project ?? '')}</td></tr>`).join('')
  const blanks = Array.from({ length: blankStockRows }, () => '<tr class="blankrow"><td></td><td></td><td></td><td></td></tr>').join('')

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Daily use ${esc(sheet.date)}</title>
<style>
${documentBaseCss}
@page{margin:12mm 12mm 15mm}
body{padding:0;font-size:9.6pt;line-height:1.45;position:relative}
.intro{font-size:9pt;color:#4f493c;margin:6px 0 10px}
.group{margin-top:12px;break-inside:avoid}
.owner{font-weight:700;font-size:10.5pt;margin-bottom:4px}
.muted{font-size:8pt;color:#6b6453}
.use{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:8.8pt}
.box{display:inline-block;width:11px;height:11px;border:1px solid #6b6453;vertical-align:-2px;margin-right:3px;text-align:center;line-height:10px;font-size:9px}
.blank{display:inline-block;min-width:110px;border-bottom:1px dotted #8c8471}
.sig{display:flex;align-items:flex-end;gap:10px;margin-top:6px;font-size:8.6pt;color:#4f493c}
.sig .line{flex:0 0 160px;border-bottom:1px solid #8c8471;height:16px}
.blankrow td{height:22px}
.signoff{display:grid;grid-template-columns:1fr 1fr 1fr;gap:28px;margin-top:24px;font-size:9pt}
.signoff .line{border-top:1px solid #8c8471;padding-top:5px;margin-top:40px;color:#6b6453}
</style>
</head>
<body>
${renderLetterhead({
  docTitle: 'DAILY USE',
  meta: [['Date', esc(docDate(sheet.date))], ...(sheet.requester ? [['Requested by', esc(sheet.requester)] as [string, string]] : [])],
  gradient: 'purchaseRequest',
})}
<p class="intro">For each line, tick what it was used for: the project it went to, stock, or the workshop's own running costs (tools, maintenance, PPE). Write the project's name. The person who asked signs for their lines.</p>
${groups || '<p class="muted">No request lines on this day.</p>'}
<div class="group">
  ${renderHeading('Taken from stock')}
  <table class="doc-table">
    <thead><tr><th>Item</th><th class="r" style="width:90px">Qty</th><th style="width:150px">Taken by</th><th style="width:200px">Used for (project / workshop)</th></tr></thead>
    <tbody>${stockRows}${blanks}</tbody>
  </table>
  <p class="muted">Issued in Kuncho today, then blank rows for anything else taken from stock.</p>
</div>
<div class="signoff">
  <div><div class="line">Workshop lead</div></div>
  <div><div class="line">Store keeper</div></div>
  <div><div class="line">Checked by (finance)</div></div>
</div>
${renderFooter(`Daily use ${sheet.date}`)}
</body>
</html>`
}
