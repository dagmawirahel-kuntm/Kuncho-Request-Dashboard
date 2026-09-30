// Printable labour pay sheet: what the project manager confirmed is owed
// on a labour request for a period (labour_pay_sheets, migration 375).
import {
  documentBaseCss, renderLetterhead, renderFooter, renderParty, renderHeading, bi, amOf, esc, escLines, docDate, docMoney,
  companyName, DOCUMENT_GRADIENTS,
} from '@/lib/documentTheme'

export interface PayLine {
  staff_id: string | null; worker_name: string; first_day: string | null; last_day: string | null
  days: number | null; hours: number | null; overtime_hours: number | null; quantity: number | null; percent_done: number | null
  rate: number | null; overtime_amount: number | null; amount: number
}

export interface PaySheetPrint {
  code: string; project_name: string | null; role_needed: string
  payment_basis: 'per_day' | 'per_volume' | 'fixed_price'; volume_unit: string | null
  crew_leader: string | null
  period_start: string; period_end: string; total: number
  lines: PayLine[]
  confirmed_by_name: string | null; confirmed_at: string; note: string | null
  finance_status: string | null
}

const num = (n: number | null | undefined, d = 2) => n == null ? '—' : esc(Number(n).toLocaleString('en-US', { maximumFractionDigits: d }))
const lbl = (en: string) => `${esc(en)}${amOf(en) ? `<span class="am">${esc(amOf(en))}</span>` : ''}`

export function buildPaySheetHtml(s: PaySheetPrint): string {
  const byDay = s.payment_basis === 'per_day'
  const byQty = s.payment_basis === 'per_volume'
  const workHead = byDay ? `${bi('Days')}` : byQty ? `${esc(s.volume_unit ?? 'Quantity')}` : '% done'
  const rows = s.lines.map((l, n) => `<tr>
    <td class="c">${n + 1}</td>
    <td><div style="font-weight:600">${esc(l.worker_name)}</div>
      <div style="font-size:8.4pt;color:#6b6453">${esc(docDate(l.first_day))}${l.last_day && l.last_day !== l.first_day ? ` – ${esc(docDate(l.last_day))}` : ''}</div></td>
    <td class="r">${byDay ? `${num(l.days)}${l.hours != null ? `<div style="font-size:8.4pt;color:#6b6453">${num(l.hours)} h</div>` : ''}` : byQty ? num(l.quantity, 3) : `${num(l.percent_done)}%`}</td>
    ${byDay ? `<td class="r">${l.overtime_hours ? `${num(l.overtime_hours)} h<div style="font-size:8.4pt;color:#6b6453">${esc(docMoney(l.overtime_amount))}</div>` : '—'}</td>` : ''}
    <td class="r">${esc(docMoney(l.rate))}</td>
    <td class="r" style="font-weight:600">${esc(docMoney(l.amount))}</td>
  </tr>`).join('')

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${esc(s.code)} - ${esc(companyName())}</title>
<style>
${documentBaseCss}
@page{margin:12mm 12mm 15mm}
body{padding:0;font-size:10pt;line-height:1.5;position:relative}
.total td{border-top:2px solid var(--acc);font-weight:700}
.sig-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:22px}
.sig-grid .box{border-top:1px solid #b9ad8c;padding-top:6px;font-size:9pt;color:#4a4536;min-height:60px}
</style></head><body>
${renderLetterhead({
  docTitle: 'LABOUR PAY SHEET', docCode: s.code, gradient: 'laborPayment',
  meta: [['Period', `${esc(docDate(s.period_start))} – ${esc(docDate(s.period_end))}`], ['Date', esc(docDate(s.confirmed_at))]],
})}
${renderParty({
  label: 'Site', name: s.project_name ?? '—',
  lines: [s.role_needed, s.crew_leader ? `Paid to crew leader: ${s.crew_leader}` : null],
  right: s.finance_status ? `Finance: <b>${esc(s.finance_status)}</b>` : undefined,
})}
<table class="doc-table">
  <thead><tr>
    <th class="c" style="width:34px">${bi('#')}</th><th>${byDay ? 'Worker' : 'Worker / crew'}</th>
    <th class="r" style="width:80px">${workHead}</th>
    ${byDay ? `<th class="r" style="width:84px">Overtime</th>` : ''}
    <th class="r" style="width:100px">${byDay ? 'Day rate' : byQty ? 'Unit rate' : 'Task price'}</th>
    <th class="r" style="width:110px">${bi('Amount')}</th>
  </tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr class="total"><td></td><td colspan="${byDay ? 4 : 3}">${bi('Total')}</td><td class="r">${esc(docMoney(s.total))}</td></tr></tfoot>
</table>
${s.note ? `${renderHeading('Notes')}<div style="font-size:9.3pt">${escLines(s.note)}</div>` : ''}
<div style="font-size:8.6pt;color:#6b6453;margin-top:8px">Day work is paid for hours worked: 8 hours is a day; overtime is paid at 1.5× the hourly rate.</div>
<div class="sig-grid">
  <div class="box">${lbl('Confirmed by')}<br/><b>${esc(s.confirmed_by_name ?? '')}</b><br/>${esc(docDate(s.confirmed_at))}</div>
  <div class="box">${lbl('Approved by')} — finance</div>
</div>
${renderFooter(s.code, DOCUMENT_GRADIENTS.laborPayment.from)}
</body></html>`
}
