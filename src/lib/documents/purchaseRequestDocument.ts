import {
  documentBaseCss, renderLetterhead, renderFooter, renderParty, renderHeading,
  bi, amOf, esc, escLines, docDate, docMoney, DOCUMENT_GRADIENTS,
} from '@/lib/documentTheme'

export interface PurchaseRequestDocLine {
  name: string
  specifications?: string | null
  quantity: number | null
  unit: string | null
  estUnitPrice: number | null
  status: string
}

export interface PurchaseRequestDocInput {
  code: string | null
  title: string
  description?: string | null
  projectName?: string | null
  requestedBy?: string | null
  procurementOfficer?: string | null
  neededBy?: string | null
  priority?: string | null
  submitted: string
  notes?: string | null
  vendorNotes?: string | null
  rejected?: { reason: string | null } | null
  lines: PurchaseRequestDocLine[]
}

/**
 * A purchase request as a page: what a site or office asks to be bought,
 * in the same heritage frame as the purchase order it turns into — the
 * request, what's needed and by when, each line with its estimate and where
 * it stands, and signatures for the requester and whoever approves it. An
 * internal document: no prices are promised to anyone.
 */
export function buildPurchaseRequestHtml(p: PurchaseRequestDocInput): string {
  const lbl = (en: string) => `${en}${amOf(en) ? `<span class="am">${amOf(en)}</span>` : ''}`
  const estimated = p.lines.reduce((s, l) => s + (l.quantity ?? 0) * (l.estUnitPrice ?? 0), 0)
  const unpriced = p.lines.filter(l => !(l.estUnitPrice && l.estUnitPrice > 0)).length
  const priority = p.priority && p.priority !== 'normal' ? p.priority[0].toUpperCase() + p.priority.slice(1) : 'Normal'

  const rows = p.lines.map((l, i) => {
    const amount = (l.quantity ?? 0) * (l.estUnitPrice ?? 0)
    return `<tr${l.status === 'Cancelled' ? ' style="color:#9a927c;text-decoration:line-through"' : ''}>
      <td class="c">${i + 1}</td>
      <td>
        <div style="font-weight:600">${esc(l.name || '—')}</div>
        ${l.specifications ? `<div style="font-size:8.4pt;color:#6b6453;margin-top:2px">${escLines(l.specifications)}</div>` : ''}
      </td>
      <td class="r">${l.quantity != null ? esc(Number(l.quantity).toLocaleString('en-US', { maximumFractionDigits: 3 })) : '—'}</td>
      <td class="c">${esc(l.unit ?? '—')}</td>
      <td class="r">${l.estUnitPrice ? docMoney(l.estUnitPrice, '') : '—'}</td>
      <td class="r">${amount > 0 ? docMoney(amount, '') : '—'}</td>
      <td style="font-size:8.4pt">${esc(l.status)}</td>
    </tr>`
  }).join('')

  const right = `
    ${p.neededBy ? `<div class="lbl">${lbl('Needed by')}</div><div style="font-weight:600">${esc(docDate(p.neededBy))}</div>` : ''}
    <div class="lbl" style="margin-top:8px">${lbl('Priority')}</div><div style="font-weight:600${priority !== 'Normal' ? ';color:#8a2a12' : ''}">${esc(priority)}</div>
    ${p.procurementOfficer ? `<div class="lbl" style="margin-top:8px">${lbl('Procurement officer')}</div><div style="font-weight:600">${esc(p.procurementOfficer)}</div>` : ''}`

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${esc(p.code ?? 'Purchase request')}</title>
<style>
${documentBaseCss}
@page{margin:12mm 12mm 15mm}
body{padding:0;font-size:10pt;line-height:1.5;position:relative}
.pr-rejected{margin:10px 0;padding:8px 12px;border:1px solid #e3b4a8;background:#fbefeb;color:#8a2a12;font-size:9.4pt}
.pr-sign{display:grid;grid-template-columns:1fr 1fr 1fr;gap:28px;margin-top:26px;font-size:9pt}
.pr-sign .line{border-top:1px solid #8c8471;padding-top:5px;margin-top:46px}
.pr-sign .muted{color:#6b6453}
</style>
</head>
<body>
${p.rejected ? '<div class="doc-watermark">NOT TO BE SOURCED</div>' : ''}
${renderLetterhead({
  docTitle: 'PURCHASE REQUEST',
  docCode: p.code ?? undefined,
  meta: [['Date', esc(docDate(p.submitted))], ...(p.neededBy ? [['Needed by', esc(docDate(p.neededBy))] as [string, string]] : [])],
  gradient: 'purchaseRequest',
})}
${renderParty({
  label: p.projectName ? 'Project' : 'Request',
  name: p.projectName ?? p.title,
  lines: [p.projectName ? p.title : null, p.description, p.requestedBy ? `Requested by ${p.requestedBy}` : null],
  right,
})}
${p.rejected ? `<div class="pr-rejected"><b>Rejected — not to be sourced.</b>${p.rejected.reason ? ` ${esc(p.rejected.reason)}` : ''}</div>` : ''}
<table class="doc-table">
  <thead>
    <tr>
      <th class="c" style="width:36px">${bi('#')}</th>
      <th>${bi('Description')}</th>
      <th class="r" style="width:58px">${bi('Qty')}</th>
      <th class="c" style="width:54px">${bi('Unit')}</th>
      <th class="r" style="width:96px">${bi('Est. price')} <span style="font-weight:400;opacity:.8">(ETB)</span></th>
      <th class="r" style="width:104px">${bi('Amount')} <span style="font-weight:400;opacity:.8">(ETB)</span></th>
      <th style="width:92px">${bi('Status')}</th>
    </tr>
  </thead>
  <tbody>${rows || '<tr><td colspan="7" class="c" style="color:#9a927c;padding:18px">No items on this request</td></tr>'}</tbody>
</table>
<table class="doc-totals">
  <tr class="grand"><td>${lbl('Estimated total')}</td><td style="text-align:right">${estimated > 0 ? docMoney(estimated) : '—'}</td></tr>
</table>
<p style="font-size:8.4pt;color:#6b6453;margin-top:4px">
  Estimates from the requester${unpriced ? `; ${unpriced} line${unpriced === 1 ? ' has' : 's have'} no estimate yet` : ''}. Actual prices are set on the purchase order.
</p>
${p.notes || p.vendorNotes ? `<div class="doc-blocks">
  ${p.notes ? `<div>${renderHeading('Notes')}${escLines(p.notes)}</div>` : '<div></div>'}
  ${p.vendorNotes ? `<div>${renderHeading('Vendor notes')}${escLines(p.vendorNotes)}</div>` : ''}
</div>` : ''}
<div class="pr-sign">
  <div><div class="line"><b>${esc(p.requestedBy ?? '')}</b>${p.requestedBy ? '<br/>' : ''}<span class="muted">${lbl('Requested by')}</span></div></div>
  <div><div class="line"><span class="muted">Checked by the site / department head</span></div></div>
  <div><div class="line"><span class="muted">${lbl('Approved by')} (name, signature, date)</span></div></div>
</div>
<p style="font-size:7.8pt;color:#9a927c;margin-top:14px;font-style:italic">Internal document — a request to buy, not an order to a vendor.</p>
${renderFooter(p.code ?? undefined, DOCUMENT_GRADIENTS.purchaseRequest.from)}
</body>
</html>`
}
