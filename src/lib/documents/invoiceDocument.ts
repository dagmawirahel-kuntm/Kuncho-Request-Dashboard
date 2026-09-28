import { amountInWords } from '@/lib/amountInWords'
import {
  documentBaseCss, renderLetterhead, renderFooter, renderParty, renderBankAccounts, renderSignoff, renderHeading, renderWords,
  bi, amOf, esc, escLines, docDate, docMoney, docProfile, DOCUMENT_GRADIENTS, type CompanySignoff, type VerifyInfo,
} from '@/lib/documentTheme'

export interface InvoiceDocInput {
  number: string | null
  date: string
  dueDate: string | null
  client: { client_name: string; tin?: string | null; address?: string | null; phone_number?: string | null; email?: string | null } | null
  description: string
  /** Amount billed, VAT included (as sales.amount holds it). */
  amount: number
  vatRate: number
  vatExempt: boolean
  reference?: { proforma?: string | null; contract?: string | null; request?: string | null; projectName?: string | null }
  /** For a share of a proforma or contract: what the whole is and what went before. */
  basis?: { label: string; total: number; percent: number | null; previouslyInvoiced: number } | null
  notes?: string | null
  signoff?: CompanySignoff | null
  verify?: VerifyInfo | null
  preview?: boolean
}

/**
 * The invoice the client pays against, in the heritage style: both TINs
 * and our VAT number, the VAT broken out of the billed amount, what it's a
 * share of, the total in words, payment instructions, signature and the
 * QR check.
 */
export function buildInvoiceHtml(p: InvoiceDocInput): string {
  const prof = docProfile()
  const rate = p.vatExempt ? 0 : p.vatRate
  const net = Math.round((p.amount / (1 + rate)) * 100) / 100
  const vat = Math.round((p.amount - net) * 100) / 100
  const tax = !!prof.vat_reg_no && !p.vatExempt
  const refs = [
    p.reference?.proforma ? `Proforma <b>${esc(p.reference.proforma)}</b>` : null,
    p.reference?.contract ? `Contract <b>${esc(p.reference.contract)}</b>` : null,
    p.reference?.request ? `Payment request <b>${esc(p.reference.request)}</b>` : null,
    p.reference?.projectName ? `Project <b>${esc(p.reference.projectName)}</b>` : null,
  ].filter(Boolean).join('<br/>')
  const meta: [string, string][] = [['Date', esc(docDate(p.date))], ...(p.dueDate ? [['Due', esc(docDate(p.dueDate))] as [string, string]] : [])]
  const lbl = (en: string) => `${en}${amOf(en) ? `<span class="am">${amOf(en)}</span>` : ''}`

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${esc(p.number ?? 'Invoice')} - ${esc(prof.legal_name)}</title>
<style>
${documentBaseCss}
${p.preview ? 'html{zoom:0.62}' : ''}
@media print{html{zoom:1}}
@page{margin:12mm 12mm 15mm}
body{padding:${p.preview ? '34px 46px' : '0'};font-size:10pt;line-height:1.5;position:relative}
.basis{font-size:8.6pt;color:#6b6453;margin-top:4px}
.due{display:inline-block;margin-top:6px;padding:3px 10px;background:#f5efe0;border:1px solid #dccfa9;color:var(--acc);font-size:8.8pt;font-weight:600}
</style>
</head>
<body>
${renderLetterhead({ docTitle: tax ? 'TAX INVOICE' : 'INVOICE', docCode: p.number ?? undefined, meta, gradient: 'invoice' })}
${p.client ? renderParty({
  label: 'Bill to', name: p.client.client_name, tin: p.client.tin,
  lines: [p.client.address, p.client.phone_number, p.client.email],
  right: `${refs ? `<div class="lbl">Reference${amOf('Reference') ? `<span class="am">${amOf('Reference')}</span>` : ''}</div><div>${refs}</div>` : ''}${p.dueDate ? `<div class="due">Please pay by ${esc(docDate(p.dueDate))}</div>` : ''}`,
}) : ''}
<table class="doc-table">
  <thead><tr><th class="c" style="width:44px">${bi('#')}</th><th>${bi('Description')}</th><th class="r" style="width:170px">${bi('Amount excl. VAT')} <span style="font-weight:400;opacity:.8">(ETB)</span></th></tr></thead>
  <tbody>
    <tr><td class="c">1</td><td>${escLines(p.description || '—')}
      ${p.basis ? `<div class="basis">${p.basis.percent != null ? `${Number(p.basis.percent)}% of ` : 'Part of '}${esc(p.basis.label)} (${docMoney(p.basis.total)} incl. VAT)${p.basis.previouslyInvoiced > 0 ? `<br/>Invoiced before this: ${docMoney(p.basis.previouslyInvoiced)} · still to invoice after this: ${docMoney(Math.max(0, p.basis.total - p.basis.previouslyInvoiced - p.amount))}` : ''}</div>` : ''}
    </td><td class="r">${docMoney(net, '')}</td></tr>
  </tbody>
</table>
<table class="doc-totals">
  <tr><td>${lbl('Amount excl. VAT')}</td><td style="text-align:right">${docMoney(net)}</td></tr>
  <tr><td>${p.vatExempt ? 'VAT (exempt)' : `VAT (${Math.round(rate * 1000) / 10}%)`}${amOf('VAT') ? `<span class="am">${amOf('VAT')}</span>` : ''}</td><td style="text-align:right">${docMoney(vat)}</td></tr>
  <tr class="grand"><td>${lbl('Total due')}</td><td style="text-align:right">${docMoney(p.amount)}</td></tr>
</table>
${renderWords(amountInWords(p.amount))}
${renderHeading('Payment', 'ክፍያ')}
<ol class="doc-terms">
  <li>Please quote <b>${esc(p.number ?? 'this invoice number')}</b> as the reference when you pay${p.dueDate ? `, by <b>${esc(docDate(p.dueDate))}</b>` : ''}.</li>
  <li>If you withhold tax on this payment, kindly send us the withholding receipt so we can record it against this invoice.</li>
  ${prof.email || prof.phone ? `<li>For any question about this invoice, contact us at ${[prof.email, prof.phone].filter(Boolean).map(esc).join(' or ')}.</li>` : ''}
</ol>
${p.notes ? `<div style="font-size:9.3pt;margin-top:6px">${escLines(p.notes)}</div>` : ''}
${renderBankAccounts('Please pay to')}
${renderSignoff({ signoff: p.signoff, verify: p.verify, receivedBy: true })}
${renderFooter(p.number ?? undefined, DOCUMENT_GRADIENTS.invoice.from)}
</body>
</html>`
}
