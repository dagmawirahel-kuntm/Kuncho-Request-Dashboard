// Printable Site Delivery Note and Goods Received Note, in the same frame
// as every other document (documentTheme).
import {
  documentBaseCss, renderLetterhead, renderFooter, renderParty, renderHeading, bi, amOf, esc, escLines, docDate,
  companyName, DOCUMENT_GRADIENTS,
} from '@/lib/documentTheme'

const num = (n: number | null | undefined) => n == null ? '—' : esc(Number(n).toLocaleString('en-US', { maximumFractionDigits: 3 }))
const lbl = (en: string) => `${esc(en)}${amOf(en) ? `<span class="am">${esc(amOf(en))}</span>` : ''}`
const when = (d: string | null | undefined) => d ? `${esc(docDate(d))} ${esc(new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))}` : '—'

function page(code: string, body: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${esc(code)} - ${esc(companyName())}</title>
<style>
${documentBaseCss}
@page{margin:12mm 12mm 15mm}
body{padding:0;font-size:10pt;line-height:1.5;position:relative}
.flag{color:#8a2d1a;font-weight:600}
.sig-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:22px}
.sig-grid .box{border-top:1px solid #b9ad8c;padding-top:6px;font-size:9pt;color:#4a4536;min-height:60px}
.photos{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.photos img{height:90px;width:auto;border:1px solid #dccfa9;border-radius:3px}
</style></head><body>
${body}
${renderFooter(code, DOCUMENT_GRADIENTS.delivery.from)}
</body></html>`
}

export interface SdnPrint {
  sdn_code: string; status: string; bundle_code: string | null; vendor_name: string | null; project_name: string | null
  vendor_delivery_ref: string | null; driver_name: string | null; vehicle_plate: string | null; expected_on: string | null
  issued_at: string; issued_by_name: string | null; notes: string | null
  signed_at: string | null; signed_by_name: string | null; sign_notes: string | null
  photos: { url: string; name?: string | null }[]
  items: { item_name: string | null; unit: string | null; quantity_sent: number; quantity_received: number | null; quantity_damaged: number; quantity_rejected: number; notes: string | null }[]
}

export function buildSdnHtml(s: SdnPrint): string {
  const signed = !!s.signed_at
  const rows = s.items.map((i, n) => {
    const flagged = signed && (i.quantity_received !== i.quantity_sent || i.quantity_damaged > 0 || i.quantity_rejected > 0)
    return `<tr>
      <td class="c">${n + 1}</td>
      <td><div style="font-weight:600">${esc(i.item_name ?? '—')}</div>${i.notes ? `<div style="font-size:8.4pt;color:#6b6453">${esc(i.notes)}</div>` : ''}</td>
      <td class="c">${esc(i.unit ?? '')}</td>
      <td class="r">${num(i.quantity_sent)}</td>
      <td class="r${flagged ? ' flag' : ''}">${signed ? num(i.quantity_received) : ''}</td>
      <td class="r">${signed ? num(i.quantity_damaged) : ''}</td>
      <td class="r">${signed ? num(i.quantity_rejected) : ''}</td>
    </tr>`
  }).join('')
  const transport = [s.driver_name && `Driver: <b>${esc(s.driver_name)}</b>`, s.vehicle_plate && `Vehicle: <b>${esc(s.vehicle_plate)}</b>`,
    s.vendor_delivery_ref && `Vendor delivery note: <b>${esc(s.vendor_delivery_ref)}</b>`].filter(Boolean).join('<br/>')

  return page(s.sdn_code, `
${renderLetterhead({
  docTitle: 'SITE DELIVERY NOTE', docCode: s.sdn_code, gradient: 'delivery',
  meta: [['Date', esc(docDate(s.issued_at))], ['Purchase order', esc(s.bundle_code ?? '—')],
    ...(s.expected_on ? [['Expected delivery', esc(docDate(s.expected_on))] as [string, string]] : [])],
})}
${renderParty({ label: 'Delivered to', name: s.project_name ?? '—', lines: [s.vendor_name ? `From ${s.vendor_name}` : null], right: transport })}
<table class="doc-table">
  <thead><tr>
    <th class="c" style="width:34px">${bi('#')}</th><th>${bi('Description')}</th><th class="c" style="width:56px">${bi('Unit')}</th>
    <th class="r" style="width:66px">${bi('Sent')}</th><th class="r" style="width:74px">${bi('Received')}</th>
    <th class="r" style="width:70px">${bi('Damaged')}</th><th class="r" style="width:70px">${bi('Refused')}</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
${s.notes ? `${renderHeading('Notes')}<div style="font-size:9.3pt">${escLines(s.notes)}</div>` : ''}
${signed ? `${renderHeading('Received by')}<div style="font-size:9.3pt">Signed on site by <b>${esc(s.signed_by_name ?? '—')}</b> on ${when(s.signed_at)}.${s.sign_notes ? `<br/>${escLines(s.sign_notes)}` : ''}</div>
${s.photos.length ? `<div class="photos">${s.photos.slice(0, 6).map(p => `<img src="${esc(p.url)}" alt=""/>`).join('')}</div>` : ''}` : `
<div class="sig-grid">
  <div class="box">${lbl('Sent by')}<br/>${esc(s.issued_by_name ?? '')}</div>
  <div class="box">${lbl('Received by')} — name, signature, date</div>
</div>`}
`)
}

export interface GrnPrint {
  grn_code: string; received_at: string; received_by_name: string | null; bundle_code: string | null; vendor_name: string | null
  project_names: string | null; delivery_note_ref: string | null; driver_name: string | null; vehicle_plate: string | null
  sdn_code: string | null; notes: string | null
  items: { item_name: string | null; unit: string | null; ledger: string | null; quantity_received: number | null; quantity_accepted: number; quantity_damaged: number; quantity_rejected: number; condition_notes: string | null }[]
}

export function buildGrnHtml(g: GrnPrint): string {
  const rows = g.items.map((i, n) => `<tr>
    <td class="c">${n + 1}</td>
    <td><div style="font-weight:600">${esc(i.item_name ?? '—')}</div>${i.condition_notes ? `<div style="font-size:8.4pt;color:#6b6453">${esc(i.condition_notes)}</div>` : ''}</td>
    <td style="font-size:8.6pt;color:#6b6453">${esc(i.ledger ?? '')}</td>
    <td class="c">${esc(i.unit ?? '')}</td>
    <td class="r">${num(i.quantity_received)}</td>
    <td class="r">${num(i.quantity_accepted)}</td>
    <td class="r${i.quantity_damaged > 0 ? ' flag' : ''}">${num(i.quantity_damaged)}</td>
    <td class="r${i.quantity_rejected > 0 ? ' flag' : ''}">${num(i.quantity_rejected)}</td>
  </tr>`).join('')
  const right = [g.delivery_note_ref && `Vendor delivery note: <b>${esc(g.delivery_note_ref)}</b>`, g.sdn_code && `Site delivery note: <b>${esc(g.sdn_code)}</b>`,
    g.driver_name && `Driver: <b>${esc(g.driver_name)}</b>`, g.vehicle_plate && `Vehicle: <b>${esc(g.vehicle_plate)}</b>`].filter(Boolean).join('<br/>')

  return page(g.grn_code, `
${renderLetterhead({
  docTitle: 'GOODS RECEIVED NOTE', docCode: g.grn_code, gradient: 'delivery',
  meta: [['Date', esc(docDate(g.received_at))], ['Purchase order', esc(g.bundle_code ?? '—')]],
})}
${renderParty({ label: 'Vendor', name: g.vendor_name ?? '—', lines: [g.project_names ? `For ${g.project_names}` : null], right })}
<table class="doc-table">
  <thead><tr>
    <th class="c" style="width:30px">${bi('#')}</th><th>${bi('Description')}</th><th style="width:96px">Ledger</th><th class="c" style="width:50px">${bi('Unit')}</th>
    <th class="r" style="width:64px">${bi('Received')}</th><th class="r" style="width:64px">${bi('Accepted')}</th>
    <th class="r" style="width:64px">${bi('Damaged')}</th><th class="r" style="width:64px">${bi('Refused')}</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
${g.notes ? `${renderHeading('Notes')}<div style="font-size:9.3pt">${escLines(g.notes)}</div>` : ''}
<div class="sig-grid">
  <div class="box">${lbl('Received by')}<br/><b>${esc(g.received_by_name ?? '')}</b><br/>${when(g.received_at)}</div>
  <div class="box">Checked by (stores / procurement) — name, signature, date</div>
</div>
`)
}
