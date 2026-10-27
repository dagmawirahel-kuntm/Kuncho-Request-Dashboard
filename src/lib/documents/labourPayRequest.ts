// Printable labour payment request: what the PM asks finance to pay — the
// pay sheets, each worker's line with any advance deducted and the bank
// account, the PM's sign-off and the signed attendance sheet (migration 479).
import {
  documentBaseCss, renderLetterhead, renderFooter, renderParty, renderHeading, bi, esc, escLines, docDate, docMoney,
  companyName, DOCUMENT_GRADIENTS,
} from '@/lib/documentTheme'
import type { Photo, RequestLine } from '@/lib/labourPayRequests'

export interface PayRequestPrint {
  code: string; status: string; projects: string | null
  sheets: { code: string | null; what: string | null; project: string | null; period: string; amount: number }[]
  lines: RequestLine[]
  note: string | null; signoff_text: string | null; signed_by_name: string | null; submitted_at: string | null
  approved_by_name: string | null; approved_at: string | null
  created_by_name: string | null; created_at: string
  photos: Photo[]
}

const num = (n: number | null | undefined) => n == null ? '—' : esc(Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }))
const isImage = (p: Photo) => /\.(jpe?g|png|webp|gif|heic)$/i.test(p.name || p.url)

export function buildPayRequestHtml(r: PayRequestPrint): string {
  const gross = r.lines.reduce((s, l) => s + Number(l.gross), 0)
  const ded = r.lines.reduce((s, l) => s + Number(l.deduction), 0)
  const net = r.lines.reduce((s, l) => s + Number(l.net), 0)
  const rows = r.lines.map((l, n) => `<tr>
    <td class="c">${n + 1}</td>
    <td><div style="font-weight:600">${esc(l.name)}</div>${l.crew_leader ? '<div style="font-size:8.4pt;color:#6b6453">Crew leader — paid for the crew</div>' : ''}
      ${!l.verified ? '<div style="font-size:8.4pt;color:#a33">Not verified by HR</div>' : ''}${l.held ? '<div style="font-size:8.4pt;color:#a33">Pay held until HR verifies</div>' : ''}</td>
    <td class="r">${num(l.days)}</td>
    <td class="r">${esc(docMoney(l.gross))}</td>
    <td class="r">${Number(l.deduction) > 0 ? `${esc(docMoney(l.deduction))}${l.deduction_note ? `<div style="font-size:8.2pt;color:#6b6453">${esc(l.deduction_note)}</div>` : ''}` : '—'}</td>
    <td class="r" style="font-weight:600">${esc(docMoney(l.net))}</td>
    <td style="font-size:8.8pt">${l.account_number ? `${esc(l.bank ?? '')}<br/>${esc(l.account_number)}` : '<span style="color:#a33">No account</span>'}</td>
  </tr>`).join('')
  const sheetRows = r.sheets.map(s => `<tr><td>${esc(s.code ?? '—')}</td><td>${esc(s.what ?? '')}<div style="font-size:8.4pt;color:#6b6453">${esc(s.project ?? '')}</div></td>
    <td>${esc(s.period)}</td><td class="r">${esc(docMoney(s.amount))}</td></tr>`).join('')
  const images = r.photos.filter(isImage)

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${esc(r.code)} - ${esc(companyName())}</title>
<style>
${documentBaseCss}
@page{margin:12mm 12mm 15mm}
body{padding:0;font-size:10pt;line-height:1.5;position:relative}
.total td{border-top:2px solid var(--acc);font-weight:700}
.sig-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:22px}
.sig-grid .box{border-top:1px solid #b9ad8c;padding-top:6px;font-size:9pt;color:#4a4536;min-height:60px}
.photo{page-break-before:always;text-align:center}
.photo img{max-width:100%;max-height:250mm}
</style></head><body>
${renderLetterhead({
  docTitle: 'LABOUR PAYMENT REQUEST', docCode: r.code, gradient: 'laborPayment',
  meta: [['Date', esc(docDate(r.submitted_at ?? r.created_at))], ['Status', esc(r.status)]],
})}
${renderParty({ label: 'Site', name: r.projects ?? '—', lines: [`Requested by ${r.signed_by_name ?? r.created_by_name ?? '—'}`] })}
${renderHeading('Pay sheets')}
<table class="doc-table">
  <thead><tr><th style="width:110px">Sheet</th><th>Work</th><th style="width:150px">Period</th><th class="r" style="width:110px">${bi('Amount')}</th></tr></thead>
  <tbody>${sheetRows}</tbody>
</table>
${renderHeading('Workers')}
<table class="doc-table">
  <thead><tr>
    <th class="c" style="width:28px">${bi('#')}</th><th>Worker</th><th class="r" style="width:50px">${bi('Days')}</th>
    <th class="r" style="width:90px">Gross</th><th class="r" style="width:90px">Advance</th><th class="r" style="width:95px">To send</th><th style="width:130px">Bank</th>
  </tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr class="total"><td></td><td colspan="2">${bi('Total')}</td><td class="r">${esc(docMoney(gross))}</td><td class="r">${esc(docMoney(ded))}</td><td class="r">${esc(docMoney(net))}</td><td></td></tr></tfoot>
</table>
${r.note ? `${renderHeading('Notes')}<div style="font-size:9.3pt">${escLines(r.note)}</div>` : ''}
${r.signoff_text ? `<div style="font-size:9.3pt;margin-top:10px;font-style:italic">“${esc(r.signoff_text)}”</div>` : ''}
<div style="font-size:8.6pt;color:#6b6453;margin-top:6px">Signed attendance sheet: ${r.photos.length ? `${r.photos.length} photo${r.photos.length === 1 ? '' : 's'} attached${images.length ? ' (following pages)' : ''}` : 'not attached'}.</div>
<div class="sig-grid">
  <div class="box">Project manager<br/><b>${esc(r.signed_by_name ?? '')}</b><br/>${esc(docDate(r.submitted_at))}</div>
  <div class="box">Approved by — finance<br/><b>${esc(r.approved_by_name ?? '')}</b><br/>${esc(docDate(r.approved_at))}</div>
</div>
${renderFooter(r.code, DOCUMENT_GRADIENTS.laborPayment.from)}
${images.map(p => `<div class="photo"><img src="${esc(p.url)}" alt="${esc(p.name)}"/></div>`).join('')}
</body></html>`
}
