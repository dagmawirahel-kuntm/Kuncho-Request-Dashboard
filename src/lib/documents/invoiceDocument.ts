import { amountInWords } from '@/lib/amountInWords'
import {
  documentBaseCss, renderLetterhead, renderFooter, renderParty, renderBankAccounts, renderSignoff,
  esc, escLines, docDate, docMoney, docProfile, type CompanySignoff, type VerifyInfo,
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
 * The invoice the client pays against: both TINs and our VAT number, the
 * VAT broken out of the billed amount, what it's a share of, the total in
 * words, where to pay, signature and the QR check.
 */
export function buildInvoiceHtml(p: InvoiceDocInput): string {
  const prof = docProfile()
  const rate = p.vatExempt ? 0 : p.vatRate
  const net = Math.round((p.amount / (1 + rate)) * 100) / 100
  const vat = Math.round((p.amount - net) * 100) / 100
  const tax = !!prof.vat_reg_no && !p.vatExempt
  const refs = [
    p.reference?.proforma ? `Proforma ${esc(p.reference.proforma)}` : null,
    p.reference?.contract ? `Contract ${esc(p.reference.contract)}` : null,
    p.reference?.request ? `Payment request ${esc(p.reference.request)}` : null,
  ].filter(Boolean).join('<br/>')
  const words = amountInWords(p.amount)

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${esc(p.number ?? 'Invoice')} - ${esc(prof.legal_name)}</title>
<style>
${documentBaseCss}
${p.preview ? 'html{zoom:0.62}' : ''}
@media print{html{zoom:1}}
@page{margin:14mm 12mm 16mm}
body{padding:${p.preview ? '40px 52px' : '0'};color:#111;font-size:10.5pt;line-height:1.5}
.lines{width:100%;border-collapse:collapse;margin:8px 0 14px;font-size:10pt}
.lines thead tr{background:#1B3A5C;color:#fff}
.lines th{padding:7px 8px;text-align:left;font-weight:600;font-size:8.5pt;letter-spacing:.4px}
.lines td{padding:8px;border-bottom:1px solid #e3e3e3;vertical-align:top}
.r{text-align:right;white-space:nowrap}
.basis{font-size:9pt;color:#555;margin-top:3px}
.totals{margin-left:auto;width:340px;font-size:10pt;break-inside:avoid}
.totals td{padding:4px 8px}
.totals .grand td{border-top:2px solid #1B3A5C;font-weight:800;font-size:12pt;color:#1B3A5C;padding-top:6px}
.words{margin:6px 0 12px;font-size:9.5pt;font-style:italic;color:#333;text-align:right}
.due{display:inline-block;margin-top:4px;padding:2px 8px;border-radius:4px;background:#fef3c7;color:#92400e;font-size:9pt;font-weight:700}
.notes{font-size:9.5pt;margin-top:8px}
</style>
</head>
<body>
${renderLetterhead({
  docTitle: tax ? 'TAX INVOICE' : 'INVOICE',
  docCode: p.number ?? undefined,
  metaLines: [esc(docDate(p.date)), ...(p.dueDate ? [`Due ${esc(docDate(p.dueDate))}`] : [])],
  gradient: 'invoice',
})}
${p.client ? renderParty({
  label: 'Bill to', name: p.client.client_name, tin: p.client.tin,
  lines: [p.client.address, p.client.phone_number, p.client.email],
  right: `${refs ? `<div style="color:#888;font-size:8.5pt;text-transform:uppercase;letter-spacing:.5px">Reference</div><div>${refs}</div>` : ''}${p.reference?.projectName ? `<div style="margin-top:4px">Project: <b>${esc(p.reference.projectName)}</b></div>` : ''}${p.dueDate ? `<div class="due">Please pay by ${esc(docDate(p.dueDate))}</div>` : ''}`,
}) : ''}
<table class="lines">
  <thead><tr><th style="width:36px">#</th><th>Description</th><th class="r" style="width:150px">Amount (excl. VAT)</th></tr></thead>
  <tbody>
    <tr><td>1</td><td>${escLines(p.description || '—')}
      ${p.basis ? `<div class="basis">${p.basis.percent != null ? `${Number(p.basis.percent)}% of ` : 'Part of '}${esc(p.basis.label)} (${docMoney(p.basis.total)} incl. VAT)${p.basis.previouslyInvoiced > 0 ? ` · invoiced before this: ${docMoney(p.basis.previouslyInvoiced)} · still to invoice after this: ${docMoney(Math.max(0, p.basis.total - p.basis.previouslyInvoiced - p.amount))}` : ''}</div>` : ''}
    </td><td class="r">${docMoney(net)}</td></tr>
  </tbody>
</table>
<table class="totals">
  <tr><td>Amount excl. VAT</td><td class="r">${docMoney(net)}</td></tr>
  <tr><td>${p.vatExempt ? 'VAT (exempt)' : `VAT (${Math.round(rate * 1000) / 10}%)`}</td><td class="r">${docMoney(vat)}</td></tr>
  <tr class="grand"><td>Total due</td><td class="r">${docMoney(p.amount)}</td></tr>
</table>
${words ? `<div class="words">${esc(words)}</div>` : ''}
${p.notes ? `<div class="notes">${escLines(p.notes)}</div>` : ''}
${renderBankAccounts('Please pay to')}
${renderSignoff({ signoff: p.signoff, verify: p.verify, receivedBy: true })}
${renderFooter(p.number ?? undefined)}
</body>
</html>`
}
