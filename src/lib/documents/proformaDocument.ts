import { amountInWords } from '@/lib/amountInWords'
import {
  documentBaseCss, renderLetterhead, renderFooter, renderParty, renderBankAccounts, renderSignoff,
  esc, escLines, docDate, docMoney, docProfile, type CompanySignoff, type VerifyInfo,
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
 * The proforma as it goes to the client: our identity and TIN, theirs,
 * the lines grouped by section with subtotals, VAT, the total in words,
 * scope and exclusions, terms, bank details, signature and the QR check.
 */
export function buildProformaHtml(p: ProformaDocInput): string {
  const prof = docProfile()
  const groups = groupBySection(p.lines)
  const sectioned = groups.some(g => g.section)
  let n = 0
  const body = groups.map((g, gi) => {
    const letter = String.fromCharCode(65 + (gi % 26))
    const sub = g.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0)
    const rows = g.lines.map(l => {
      n++
      return `<tr>
        <td class="c">${sectioned && g.section ? `${letter}.${g.lines.indexOf(l) + 1}` : n}</td>
        <td>${escLines(l.description || '—')}</td>
        <td class="r">${esc(Number(l.qty).toLocaleString('en-US', { maximumFractionDigits: 3 }))}</td>
        <td class="c">${esc(l.unit)}</td>
        <td class="r">${docMoney(l.unitPrice)}</td>
        <td class="r">${docMoney(l.qty * l.unitPrice)}</td>
      </tr>`
    }).join('')
    if (!sectioned || !g.section) return rows
    return `<tr class="sec"><td class="c">${letter}</td><td colspan="5">${esc(g.section)}</td></tr>${rows}
      <tr class="secsub"><td></td><td colspan="4">Subtotal — ${esc(g.section)}</td><td class="r">${docMoney(sub)}</td></tr>`
  }).join('')

  const validUntil = addDays(p.date, p.validityDays || 0)
  const words = amountInWords(p.total)
  const terms = [p.paymentTerms ? `<p><b>Payment terms:</b> ${escLines(p.paymentTerms)}</p>` : '', prof.proforma_terms ? `<p>${escLines(prof.proforma_terms)}</p>` : ''].join('')
  const prepared = p.preparedBy ? [p.preparedBy.name, p.preparedBy.phone, p.preparedBy.email].filter(Boolean).join(' · ') : null

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${esc(p.number ?? 'Proforma')} - ${esc(prof.legal_name)}</title>
<style>
${documentBaseCss}
${p.preview ? 'html{zoom:0.58}' : ''}
@media print{html{zoom:1}}
@page{margin:14mm 12mm 16mm}
body{padding:${p.preview ? '40px 52px' : '0'};color:#111;font-size:10.5pt;line-height:1.5}
.lines{width:100%;border-collapse:collapse;margin:6px 0 16px;font-size:9.5pt}
.lines thead tr{background:#1B3A5C;color:#fff}
.lines th{padding:7px 8px;text-align:left;font-weight:600;font-size:8.5pt;letter-spacing:.4px}
.lines td{padding:6px 8px;border-bottom:1px solid #e3e3e3;vertical-align:top}
.lines .r{text-align:right;white-space:nowrap}.lines .c{text-align:center}
.lines tbody tr:nth-child(even) td{background:#fafbfc}
.lines tr.sec td{background:#eef2f7 !important;font-weight:700;color:#1B3A5C;border-bottom:1px solid #cfd8e3}
.lines tr.secsub td{font-weight:600;color:#1B3A5C;background:#fff !important;border-bottom:2px solid #cfd8e3}
.totals{margin-left:auto;width:320px;font-size:10pt;break-inside:avoid}
.totals td{padding:4px 8px}
.totals .grand td{border-top:2px solid #1B3A5C;font-weight:800;font-size:11.5pt;color:#1B3A5C;padding-top:6px}
.words{margin:6px 0 14px;font-size:9.5pt;font-style:italic;color:#333;text-align:right}
.blocks{display:grid;grid-template-columns:1fr 1fr;gap:10px 18px;font-size:9.5pt;margin-top:8px}
.blocks h4{font-size:8.5pt;text-transform:uppercase;letter-spacing:.5px;color:#888;margin-bottom:3px}
.terms{font-size:9.5pt;margin-top:12px;line-height:1.55}
.terms p{margin-bottom:4px}
.notice{font-size:8.5pt;color:#888;margin-top:14px;font-style:italic}
</style>
</head>
<body>
${p.draft ? '<div class="doc-watermark">DRAFT</div>' : ''}
${renderLetterhead({
  docTitle: 'PROFORMA INVOICE',
  docCode: p.number ? `${p.number}${p.version && p.version > 1 ? ` · v${p.version}` : ''}` : undefined,
  metaLines: [esc(docDate(p.date)), `Valid until ${esc(docDate(validUntil))}`],
  gradient: 'proforma',
})}
${p.client ? renderParty({
  label: 'Prepared for', name: p.client.client_name, tin: p.client.tin,
  lines: [p.client.address, p.client.phone_number, p.client.email],
  right: p.projectName ? `<div class="lbl" style="color:#888;font-size:8.5pt;text-transform:uppercase;letter-spacing:.5px">Project</div><b>${esc(p.projectName)}</b>` : '',
}) : ''}
${p.scope ? `<div class="blocks" style="grid-template-columns:1fr;margin-bottom:10px"><div><h4>Scope of work</h4>${escLines(p.scope)}</div></div>` : ''}
<table class="lines">
  <thead><tr>
    <th class="c" style="width:44px">#</th><th>Description</th><th class="r" style="width:64px">Qty</th>
    <th class="c" style="width:56px">Unit</th><th class="r" style="width:120px">Unit price</th><th class="r" style="width:130px">Amount</th>
  </tr></thead>
  <tbody>${body || '<tr><td colspan="6" class="c" style="color:#999;padding:18px">No lines yet</td></tr>'}</tbody>
</table>
<table class="totals">
  <tr><td>Subtotal</td><td class="r" style="text-align:right">${docMoney(p.subtotal)}</td></tr>
  <tr><td>VAT (${Math.round(p.vatRate * 1000) / 10}%)</td><td style="text-align:right">${docMoney(p.vat)}</td></tr>
  <tr class="grand"><td>Grand total</td><td style="text-align:right">${docMoney(p.total)}</td></tr>
</table>
${words ? `<div class="words">${esc(words)}</div>` : ''}
${p.exclusions || p.notes ? `<div class="blocks">
  ${p.exclusions ? `<div><h4>Not included</h4>${escLines(p.exclusions)}</div>` : '<div></div>'}
  ${p.notes ? `<div><h4>Notes</h4>${escLines(p.notes)}</div>` : ''}
</div>` : ''}
${terms ? `<div class="terms">${terms}</div>` : ''}
${renderBankAccounts('Payments to')}
${renderSignoff({ signoff: p.signoff, preparedBy: prepared, verify: p.verify })}
<div class="notice">This proforma invoice is a quotation, not a tax invoice. Prices are valid until ${esc(docDate(validUntil))}</div>
${renderFooter(p.number ?? undefined)}
</body>
</html>`
}

/** Draft or sent past its valid-until date reads as expired, whatever is stored. */
export function effectiveStatus<S extends string>(p: { status: S; date: string; validity_days: number | null; valid_until?: string | null }): S | 'expired' {
  const until = p.valid_until ?? addDays(p.date, p.validity_days ?? 30)
  return (p.status === 'draft' || p.status === 'sent') && until < new Date().toISOString().slice(0, 10) ? 'expired' : p.status
}
