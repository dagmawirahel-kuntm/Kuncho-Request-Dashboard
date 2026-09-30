// A statement of account for one vendor, client or staff member: every line
// on their sub-ledger with the running balance (v_subledger_lines, 381).
import {
  documentBaseCss, renderLetterhead, renderFooter, renderParty, bi, esc, docDate, docMoney,
  companyName, DOCUMENT_GRADIENTS,
} from '@/lib/documentTheme'

export interface StatementLine {
  entry_date: string; description: string | null; notes: string | null; debit: number; credit: number; running_balance: number
}
export interface StatementPrint {
  code: string; party_name: string; party_kind: 'vendor' | 'client' | 'staff' | null
  ledger: string; account_code: string; liability: boolean
  from: string | null; to: string; lines: StatementLine[]
}

export function buildStatementHtml(s: StatementPrint): string {
  // A payable reads as what we owe (credit-positive); anything else as what is owed to us.
  const sign = s.liability ? -1 : 1
  const closing = s.lines.length ? sign * Number(s.lines[s.lines.length - 1].running_balance) : 0
  const gradient = s.party_kind === 'client' ? 'paymentRequestLetter' : 'laborPayment'
  const rows = s.lines.map(l => `<tr>
    <td class="c" style="white-space:nowrap">${esc(docDate(l.entry_date))}</td>
    <td><div>${esc(l.description ?? '')}</div>${l.notes ? `<div style="font-size:8.4pt;color:#6b6453">${esc(l.notes)}</div>` : ''}</td>
    <td class="r">${Number(l.debit) ? esc(docMoney(l.debit)) : ''}</td>
    <td class="r">${Number(l.credit) ? esc(docMoney(l.credit)) : ''}</td>
    <td class="r" style="font-weight:600">${esc(docMoney(sign * Number(l.running_balance)))}</td>
  </tr>`).join('')

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${esc(s.code)} - ${esc(companyName())}</title>
<style>
${documentBaseCss}
@page{margin:12mm 12mm 15mm}
body{padding:0;font-size:10pt;line-height:1.5;position:relative}
.total td{border-top:2px solid var(--acc);font-weight:700}
</style></head><body>
${renderLetterhead({
  docTitle: 'STATEMENT OF ACCOUNT', docCode: s.code, gradient,
  meta: [['Date', esc(docDate(s.to))], ['Ledger', `${esc(s.account_code)} ${esc(s.ledger)}`]],
})}
${renderParty({
  label: s.party_kind === 'client' ? 'Client' : s.party_kind === 'staff' ? 'Staff member' : 'Vendor',
  name: s.party_name,
  lines: [s.from ? `Activity ${docDate(s.from)} – ${docDate(s.to)}` : null],
  right: `${s.liability ? 'We owe' : 'Owed to us'}: <b>${esc(docMoney(closing))}</b>`,
})}
<table class="doc-table">
  <thead><tr>
    <th class="c" style="width:84px">${bi('Date')}</th><th>${bi('Description')}</th>
    <th class="r" style="width:100px">Debit</th><th class="r" style="width:100px">Credit</th>
    <th class="r" style="width:110px">${bi('Balance')}</th>
  </tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr class="total"><td></td><td colspan="3">${s.liability ? 'Balance we owe' : 'Balance owed to us'}</td><td class="r">${esc(docMoney(closing))}</td></tr></tfoot>
</table>
<div style="font-size:8.6pt;color:#6b6453;margin-top:10px">Please tell us within 14 days if anything on this statement does not agree with your records.</div>
${renderFooter(s.code, DOCUMENT_GRADIENTS[gradient].from)}
</body></html>`
}
