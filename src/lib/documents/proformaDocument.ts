import { amountInWords } from '@/lib/amountInWords'
import {
  documentBaseCss, renderLetterhead, renderFooter, renderParty, renderBankAccounts, renderSignoff, renderHeading, renderWords,
  bi, amOf, esc, escLines, docDate, docMoney, docProfile, companyName, DOCUMENT_GRADIENTS, type CompanySignoff, type VerifyInfo,
} from '@/lib/documentTheme'

export interface ProformaDocLine { description: string; qty: number; unit: string; unitPrice: number; section?: string | null }

export interface ProformaDocInput {
  number: string | null
  version?: number
  date: string
  validityDays: number
  client: { client_name: string; tin?: string | null; address?: string | null; phone_number?: string | null; email?: string | null } | null
  projectName?: string | null
  lines: ProformaDocLine[]
  subtotal: number
  vat: number
  vatRate: number
  total: number
  paymentTerms: string
  notes: string
  scope?: string | null
  exclusions?: string | null
  preparedBy?: { name: string; phone?: string | null; email?: string | null } | null
  signoff?: CompanySignoff | null
  verify?: VerifyInfo | null
  /** Not saved yet: a faint DRAFT across the page. */
  draft?: boolean
  /** On-screen preview: shrunk to fit the side panel (never when printed). */
  preview?: boolean
}

function addDays(d: string, n: number) {
  const x = new Date(`${d}T00:00:00`)
  x.setDate(x.getDate() + n)
  return x.toISOString().slice(0, 10)
}

/** Lines grouped under their section, keeping the order they were entered in. */
export function groupBySection(lines: ProformaDocLine[]) {
  const groups: { section: string | null; lines: ProformaDocLine[] }[] = []
  for (const l of lines) {
    const s = l.section?.trim() || null
    const last = groups[groups.length - 1]
    if (last && last.section === s) last.lines.push(l)
    else groups.push({ section: s, lines: [l] })
  }
  return groups
}

/**
 * The proforma as it goes to the client, in the heritage style: a warm
 * opening, the lines grouped by section with subtotals, VAT and the total
 * in words, scope and exclusions, numbered terms, where to pay, our
 * signature beside a block for the client to accept, and the QR check.
 */
export function buildProformaHtml(p: ProformaDocInput): string {
  const prof = docProfile()
  const groups = groupBySection(p.lines)
  const sectioned = groups.some(g => g.section)
  let n = 0
  const body = groups.map((g, gi) => {
    const letter = String.fromCharCode(65 + (gi % 26))
    const sub = g.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0)
    const rows = g.lines.map((l, li) => {
      n++
      return `<tr>
        <td class="c">${sectioned && g.section ? `${letter}.${li + 1}` : n}</td>
        <td>${escLines(l.description || '—')}</td>
        <td class="r">${esc(Number(l.qty).toLocaleString('en-US', { maximumFractionDigits: 3 }))}</td>
        <td class="c">${esc(l.unit)}</td>
        <td class="r">${docMoney(l.unitPrice, '')}</td>
        <td class="r">${docMoney(l.qty * l.unitPrice, '')}</td>
      </tr>`
    }).join('')
    if (!sectioned || !g.section) return rows
    return `<tr class="sec"><td class="c">${letter}</td><td colspan="5">${esc(g.section)}</td></tr>${rows}
      <tr class="secsub"><td></td><td colspan="4">Subtotal · ${esc(g.section)}</td><td class="r">${docMoney(sub, '')}</td></tr>`
  }).join('')

  const validUntil = addDays(p.date, p.validityDays || 0)
  const vatPct = Math.round(p.vatRate * 1000) / 10
  const prepared = p.preparedBy ? [p.preparedBy.name, p.preparedBy.phone, p.preparedBy.email].filter(Boolean).join(' · ') : null
  const client = p.client?.client_name ?? 'Sir / Madam'

  // Numbered terms: validity, payment, currency and VAT, then the house terms.
  const terms = [
    `This offer is valid until <b>${esc(docDate(validUntil))}</b> — prices may be revised after that date.`,
    p.paymentTerms ? `Payment: ${escLines(p.paymentTerms)}.`.replace(/\.\.$/, '.') : null,
    `Prices are in Ethiopian Birr${p.vat > 0 ? ` and VAT at ${vatPct}% is shown separately` : ''}.`,
    ...(prof.proforma_terms ? prof.proforma_terms.split(/\r?\n/).map(t => t.trim()).filter(Boolean).map(escLines) : []),
  ].filter(Boolean)

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${esc(p.number ?? 'Proforma')} - ${esc(prof.legal_name)}</title>
<style>
${documentBaseCss}
${p.preview ? 'html{zoom:0.58}' : ''}
@media print{html{zoom:1}}
@page{margin:12mm 12mm 15mm}
body{padding:${p.preview ? '34px 46px' : '0'};font-size:10pt;line-height:1.5;position:relative}
</style>
</head>
<body>
${p.draft ? '<div class="doc-watermark">DRAFT</div>' : ''}
${renderLetterhead({
  docTitle: 'PROFORMA INVOICE',
  docCode: p.number ? `${p.number}${p.version && p.version > 1 ? ` · v${p.version}` : ''}` : undefined,
  meta: [['Date', esc(docDate(p.date))], ['Valid until', esc(docDate(validUntil))]],
  gradient: 'proforma',
})}
${p.client ? renderParty({
  label: 'Prepared for', name: p.client.client_name, tin: p.client.tin,
  lines: [p.client.address, p.client.phone_number, p.client.email],
  right: p.projectName ? `<div class="lbl">Project${amOf('Project') ? `<span class="am">${amOf('Project')}</span>` : ''}</div><b class="name">${esc(p.projectName)}</b>` : '',
}) : ''}
<p class="doc-salute">Dear ${esc(client)},<br/>
Thank you for the opportunity to work with you. We are pleased to submit our proforma${p.projectName ? ` for <b>${esc(p.projectName)}</b>` : ''}, prepared with care by ${esc(companyName())}. We would be glad to answer any question about it.</p>
${p.scope ? `${renderHeading('Scope of work')}<div style="font-size:9.8pt;line-height:1.6">${escLines(p.scope)}</div>` : ''}
${renderHeading('Price schedule', 'የዋጋ ዝርዝር')}
<table class="doc-table">
  <thead><tr>
    <th class="c" style="width:44px">${bi('#')}</th><th>${bi('Description')}</th><th class="r" style="width:62px">${bi('Qty')}</th>
    <th class="c" style="width:58px">${bi('Unit')}</th><th class="r" style="width:112px">${bi('Unit price')} <span style="font-weight:400;opacity:.8">(ETB)</span></th><th class="r" style="width:124px">${bi('Amount')} <span style="font-weight:400;opacity:.8">(ETB)</span></th>
  </tr></thead>
  <tbody>${body || '<tr><td colspan="6" class="c" style="color:#9a927c;padding:18px">No lines yet</td></tr>'}</tbody>
</table>
<table class="doc-totals">
  <tr><td>Subtotal${amOf('Subtotal') ? `<span class="am">${amOf('Subtotal')}</span>` : ''}</td><td style="text-align:right">${docMoney(p.subtotal)}</td></tr>
  <tr><td>VAT (${vatPct}%)${amOf('VAT') ? `<span class="am">${amOf('VAT')}</span>` : ''}</td><td style="text-align:right">${docMoney(p.vat)}</td></tr>
  <tr class="grand"><td>Grand total${amOf('Grand total') ? `<span class="am">${amOf('Grand total')}</span>` : ''}</td><td style="text-align:right">${docMoney(p.total)}</td></tr>
</table>
${renderWords(amountInWords(p.total))}
${p.exclusions || p.notes ? `<div class="doc-blocks">
  ${p.exclusions ? `<div>${renderHeading('Not included')}${escLines(p.exclusions)}</div>` : '<div></div>'}
  ${p.notes ? `<div>${renderHeading('Notes')}${escLines(p.notes)}</div>` : ''}
</div>` : ''}
${renderHeading('Terms')}
<ol class="doc-terms">${terms.map(t => `<li>${t}</li>`).join('')}</ol>
${renderBankAccounts('Payments to')}
${renderSignoff({ signoff: p.signoff, preparedBy: prepared, verify: p.verify, acceptance: p.client?.client_name ?? null })}
<p style="font-size:7.8pt;color:#9a927c;margin-top:12px;font-style:italic">This proforma is a quotation, not a tax invoice.</p>
${renderFooter(p.number ?? undefined, DOCUMENT_GRADIENTS.proforma.from)}
</body>
</html>`
}

/** Draft or sent past its valid-until date reads as expired, whatever is stored. */
export function effectiveStatus<S extends string>(p: { status: S; date: string; validity_days: number | null; valid_until?: string | null }): S | 'expired' {
  const until = p.valid_until ?? addDays(p.date, p.validity_days ?? 30)
  return (p.status === 'draft' || p.status === 'sent') && until < new Date().toISOString().slice(0, 10) ? 'expired' : p.status
}
