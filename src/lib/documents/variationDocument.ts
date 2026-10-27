import { amountInWords } from '@/lib/amountInWords'
import {
  documentBaseCss, renderLetterhead, renderFooter, renderParty, renderSignoff, renderHeading, renderWords,
  bi, esc, escLines, docDate, docMoney, type CompanySignoff,
} from '@/lib/documentTheme'

// The variation order as it goes to the client: an addendum to the original
// agreement (migration 459). It names the agreement it amends, prices the
// change, shows the contract sum before and after, and has a block for the
// client to sign. The original is never replaced — each addendum adds to it.

export interface VariationDocInput {
  code: string
  date: string
  projectName: string
  client: { client_name: string; tin?: string | null; address?: string | null; phone_number?: string | null; email?: string | null } | null
  agreementRef: string | null
  title: string
  description: string | null
  instructedBy: string | null
  instructedOn: string
  lines: { description: string; quantity: number; unit: string; rate: number }[]
  amount: number
  vatRate: number
  total: number
  timeExtensionDays: number
  /** The contract sum before this VO: the original plus VOs agreed before it. */
  sumBefore: number | null
  original: number | null
  signoff?: CompanySignoff | null
  draft?: boolean
  preview?: boolean
}

const head = (title: string, preview?: boolean) => `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
<style>
${documentBaseCss}
${preview ? 'html{zoom:0.58}' : ''}
@media print{html{zoom:1}}
@page{margin:12mm 12mm 15mm}
body{padding:${preview ? '34px 46px' : '0'};font-size:10pt;line-height:1.5;position:relative}
.vo-sum td{padding:4px 8px}
.vo-sum tr.total td{font-weight:700;border-top:1.5px solid #17150F}
.neg{color:#8a1c1c}
</style>
</head>
<body>`

const money = (n: number) => (n < 0 ? `<span class="neg">−${docMoney(-n, '')}</span>` : docMoney(n, ''))

export function buildVariationAddendumHtml(p: VariationDocInput): string {
  const vatPct = Math.round(p.vatRate * 1000) / 10
  const vat = Math.round((p.total - p.amount) * 100) / 100
  const rows = p.lines.map((l, i) => `<tr>
    <td class="c">${i + 1}</td><td>${escLines(l.description)}</td>
    <td class="r">${esc(Number(l.quantity).toLocaleString('en-US', { maximumFractionDigits: 3 }))}</td><td class="c">${esc(l.unit)}</td>
    <td class="r">${money(l.rate)}</td><td class="r">${money(l.quantity * l.rate)}</td></tr>`).join('')
  const after = p.sumBefore != null ? p.sumBefore + p.total : null
  const agreement = p.agreementRef ? `<b>${esc(p.agreementRef)}</b>` : 'the agreement between us'

  return `${head(`${p.code} - ${p.projectName}`, p.preview)}
${p.draft ? '<div class="doc-watermark">DRAFT</div>' : ''}
${renderLetterhead({
  docTitle: 'VARIATION ORDER', docTitleAm: 'የሥራ ለውጥ ትዕዛዝ',
  docCode: p.code,
  meta: [['Date', esc(docDate(p.date))], ['Addendum to', p.agreementRef ? esc(p.agreementRef) : 'Original agreement']],
  gradient: 'bdContract',
})}
${p.client ? renderParty({
  label: 'Prepared for', name: p.client.client_name, tin: p.client.tin,
  lines: [p.client.address, p.client.phone_number, p.client.email],
  right: `<div class="lbl">Project</div><b class="name">${esc(p.projectName)}</b>`,
}) : renderParty({ label: 'Project', name: p.projectName })}
<p class="doc-salute">This variation order is an addendum to ${agreement} for <b>${esc(p.projectName)}</b>.
It changes only what is set out below; every other term of the agreement stays as it is.</p>
${renderHeading('The change', 'ለውጡ')}
<p style="font-size:10.5pt"><b>${esc(p.title)}</b></p>
${p.description ? `<div style="font-size:9.8pt;line-height:1.6">${escLines(p.description)}</div>` : ''}
<p style="font-size:9pt;color:#6b6656">Instructed${p.instructedBy ? ` by ${esc(p.instructedBy)}` : ''} on ${esc(docDate(p.instructedOn))}</p>
${renderHeading('Price of the change', 'የለውጡ ዋጋ')}
<table class="doc-table">
  <thead><tr>
    <th class="c" style="width:36px">${bi('#')}</th><th>${bi('Description')}</th><th class="r" style="width:62px">${bi('Qty')}</th>
    <th class="c" style="width:58px">${bi('Unit')}</th><th class="r" style="width:110px">${bi('Unit price')} <span style="font-weight:400;opacity:.8">(ETB)</span></th><th class="r" style="width:120px">${bi('Amount')} <span style="font-weight:400;opacity:.8">(ETB)</span></th>
  </tr></thead>
  <tbody>${rows || '<tr><td colspan="6" class="c" style="color:#9a927c;padding:18px">Not priced yet</td></tr>'}</tbody>
</table>
<table class="doc-totals">
  <tr><td>Subtotal</td><td style="text-align:right">${money(p.amount)}</td></tr>
  ${vat !== 0 ? `<tr><td>VAT ${vatPct}%</td><td style="text-align:right">${money(vat)}</td></tr>` : ''}
  <tr class="grand"><td>${p.total < 0 ? 'Reduction to the contract sum' : 'Addition to the contract sum'}</td><td style="text-align:right">${money(p.total)}</td></tr>
</table>
${renderWords(amountInWords(Math.abs(p.total)))}
${p.timeExtensionDays > 0 ? `<p style="font-size:10pt"><b>Time:</b> the completion date moves by <b>${p.timeExtensionDays} day${p.timeExtensionDays === 1 ? '' : 's'}</b>.</p>` : '<p style="font-size:10pt"><b>Time:</b> no change to the completion date.</p>'}
${p.sumBefore != null ? `${renderHeading('Contract sum', 'የውል ዋጋ')}
<table class="vo-sum" style="margin-left:auto;font-size:10pt">
  ${p.original != null ? `<tr><td>Original agreement</td><td style="text-align:right">${money(p.original)}</td></tr>` : ''}
  ${p.original != null && p.sumBefore !== p.original ? `<tr><td>Variations agreed before this one</td><td style="text-align:right">${money(p.sumBefore - p.original)}</td></tr>` : ''}
  <tr><td>This variation (${esc(p.code)})</td><td style="text-align:right">${money(p.total)}</td></tr>
  <tr class="total"><td>Revised contract sum</td><td style="text-align:right">${money(after!)}</td></tr>
</table>` : ''}
${renderSignoff({ signoff: p.signoff, acceptance: p.client?.client_name ?? 'the client', acceptanceWhat: 'this variation order' })}
${renderFooter(p.code)}
</body></html>`
}

export interface StatementInput {
  projectName: string
  client: { client_name: string } | null
  agreementRef: string | null
  original: number | null
  date: string
  variations: { code: string; title: string; agreedOn: string | null; total: number; days: number }[]
  pending: { code: string; title: string; status: string; total: number }[]
  preview?: boolean
}

/** The agreement as it stands today: the original plus every agreed VO. */
export function buildContractStatementHtml(p: StatementInput): string {
  let running = p.original ?? 0
  const rows = p.variations.map(v => {
    running += v.total
    return `<tr><td>${esc(v.code)}</td><td>${esc(v.title)}</td><td class="c">${v.agreedOn ? esc(docDate(v.agreedOn)) : ''}</td>
      <td class="c">${v.days ? `+${v.days}d` : ''}</td><td class="r">${money(v.total)}</td><td class="r">${money(running)}</td></tr>`
  }).join('')
  const days = p.variations.reduce((s, v) => s + v.days, 0)
  return `${head(`Contract statement - ${p.projectName}`, p.preview)}
${renderLetterhead({ docTitle: 'CONTRACT STATEMENT', docTitleAm: 'የውል ሁኔታ መግለጫ', meta: [['Date', esc(docDate(p.date))]], gradient: 'bdContract' })}
${renderParty({ label: 'Project', name: p.projectName, lines: [p.client?.client_name ?? null, p.agreementRef ? `Agreement: ${p.agreementRef}` : null] })}
<p class="doc-salute">The agreement for <b>${esc(p.projectName)}</b> as it stands today: the original agreement and every variation order agreed since, each signed as an addendum.</p>
<table class="doc-table">
  <thead><tr><th style="width:70px">${bi('No.')}</th><th>${bi('Description')}</th><th class="c" style="width:96px">Agreed</th><th class="c" style="width:56px">Time</th>
    <th class="r" style="width:120px">${bi('Amount')} (ETB)</th><th class="r" style="width:130px">Contract sum (ETB)</th></tr></thead>
  <tbody>
    <tr><td>—</td><td><b>Original agreement</b>${p.agreementRef ? ` · ${esc(p.agreementRef)}` : ''}</td><td></td><td></td><td class="r">${p.original != null ? money(p.original) : '—'}</td><td class="r">${p.original != null ? money(p.original) : '—'}</td></tr>
    ${rows}
  </tbody>
</table>
<table class="doc-totals">
  <tr class="grand"><td>Revised contract sum</td><td style="text-align:right">${money(running)}</td></tr>
</table>
${days > 0 ? `<p style="font-size:10pt">Time added by agreed variations: <b>${days} day${days === 1 ? '' : 's'}</b>.</p>` : ''}
${p.pending.length ? `${renderHeading('Not yet agreed')}
<table class="doc-table"><tbody>${p.pending.map(v => `<tr><td style="width:70px">${esc(v.code)}</td><td>${esc(v.title)}</td><td style="width:140px">${esc(v.status)}</td><td class="r" style="width:120px">${money(v.total)}</td></tr>`).join('')}</tbody></table>
<p style="font-size:9pt;color:#6b6656">These are not part of the contract sum until the client signs them.</p>` : ''}
${renderFooter()}
</body></html>`
}
