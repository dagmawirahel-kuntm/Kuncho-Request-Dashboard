import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle } from 'docx'
import type { Contract, Client } from '@/types/database'
import { formatCurrency, formatDate } from '@/lib/utils'

const COMPANY_NAME = 'Kuncho'

function row(label: string, value: string) {
  const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  return new TableRow({
    children: [
      new TableCell({
        width: { size: 30, type: WidthType.PERCENTAGE },
        borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder },
        children: [new Paragraph({ children: [new TextRun({ text: label, bold: true })] })],
      }),
      new TableCell({
        width: { size: 70, type: WidthType.PERCENTAGE },
        borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder },
        children: [new Paragraph(value || '—')],
      }),
    ],
  })
}

// Generates a formatted Word document from a contract + its client,
// so BD stops formatting these by hand — the fields covered (value,
// payment terms, WHT rate, client details) match the spec exactly.
// This is deliberately a straightforward business-letter layout, not
// a legal-template engine — the goal is formalizing what a human
// already typed by hand for the 30 real KUN/CON contracts, not
// replacing legal review.
export async function buildContractDocx(contract: Contract, client: Client): Promise<Blob> {
  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: COMPANY_NAME, bold: true, size: 32 })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 300 },
          children: [new TextRun({ text: 'SERVICE CONTRACT', bold: true, size: 26 })],
        }),
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 100 },
          children: [new TextRun('Contract Details')],
        }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            row('Contract No.', contract.contract_no ?? '—'),
            row('Client', client.client_name),
            row('Signed Date', formatDate(contract.signed_date) ?? '—'),
            row('Status', contract.status),
            row('Contract Value', contract.contract_value != null ? formatCurrency(contract.contract_value) : '—'),
            row('WHT Rate', contract.wht_rate != null ? `${contract.wht_rate}%` : 'N/A'),
            row('Retention', contract.retention_percent != null ? `${contract.retention_percent}%` : 'N/A'),
          ],
        }),
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 300, after: 100 },
          children: [new TextRun('Client Details')],
        }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            row('Company / Client Name', client.client_name),
            row('Address', client.address ?? '—'),
            row('Phone', client.phone_number ?? '—'),
            row('Email', client.email ?? '—'),
          ],
        }),
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 300, after: 100 },
          children: [new TextRun('Payment Terms')],
        }),
        new Paragraph({ text: contract.payment_terms || 'Not specified.' }),
        ...(contract.notes ? [
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 300, after: 100 },
            children: [new TextRun('Notes')],
          }),
          new Paragraph({ text: contract.notes }),
        ] : []),
        new Paragraph({
          spacing: { before: 600, after: 100 },
          children: [new TextRun({ text: 'Signatures', bold: true })],
        }),
        new Paragraph({ spacing: { before: 400 }, text: `For ${COMPANY_NAME}: ___________________________     Date: _______________` }),
        new Paragraph({ spacing: { before: 400 }, text: `For ${client.client_name}: ___________________________     Date: _______________` }),
      ],
    }],
  })

  return Packer.toBlob(doc)
}

export function contractDocumentFileName(contract: Contract): string {
  const safeNo = (contract.contract_no ?? 'contract').replace(/[^a-zA-Z0-9-_]/g, '_')
  return `${safeNo}.docx`
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// "Support printing the generated document for physical signature/
// filing" — rather than adding a second dependency purely to produce
// a PDF, this opens a print-formatted view and lets the browser's own
// print dialog handle it: print to paper, or "Save as PDF" — no new
// library needed for that half of the ask, only for the Word file.
export function printContract(contract: Contract, client: Client) {
  const w = window.open('', '_blank', 'width=800,height=900')
  if (!w) return
  const html = `<!doctype html><html><head><title>${esc(contract.contract_no ?? 'Contract')}</title>
    <style>
      body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; max-width: 720px; margin: 40px auto; line-height: 1.5; }
      h1 { text-align: center; font-size: 22px; margin-bottom: 2px; }
      h2 { text-align: center; font-size: 16px; margin-top: 0; color: #444; }
      h3 { font-size: 14px; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin-top: 28px; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; }
      td { padding: 4px 0; vertical-align: top; }
      td.label { font-weight: bold; width: 32%; }
      .sig { margin-top: 20px; }
      @media print { body { margin: 0.5in; } }
    </style></head>
    <body>
      <h1>${esc(COMPANY_NAME)}</h1>
      <h2>Service Contract</h2>
      <h3>Contract Details</h3>
      <table>
        <tr><td class="label">Contract No.</td><td>${esc(contract.contract_no ?? '—')}</td></tr>
        <tr><td class="label">Client</td><td>${esc(client.client_name)}</td></tr>
        <tr><td class="label">Signed Date</td><td>${esc(formatDate(contract.signed_date) ?? '—')}</td></tr>
        <tr><td class="label">Status</td><td>${esc(contract.status)}</td></tr>
        <tr><td class="label">Contract Value</td><td>${esc(contract.contract_value != null ? formatCurrency(contract.contract_value) : '—')}</td></tr>
        <tr><td class="label">WHT Rate</td><td>${esc(contract.wht_rate != null ? `${contract.wht_rate}%` : 'N/A')}</td></tr>
        <tr><td class="label">Retention</td><td>${esc(contract.retention_percent != null ? `${contract.retention_percent}%` : 'N/A')}</td></tr>
      </table>
      <h3>Client Details</h3>
      <table>
        <tr><td class="label">Company / Client Name</td><td>${esc(client.client_name)}</td></tr>
        <tr><td class="label">Address</td><td>${esc(client.address ?? '—')}</td></tr>
        <tr><td class="label">Phone</td><td>${esc(client.phone_number ?? '—')}</td></tr>
        <tr><td class="label">Email</td><td>${esc(client.email ?? '—')}</td></tr>
      </table>
      <h3>Payment Terms</h3>
      <p>${esc(contract.payment_terms || 'Not specified.')}</p>
      ${contract.notes ? `<h3>Notes</h3><p>${esc(contract.notes)}</p>` : ''}
      <h3>Signatures</h3>
      <p class="sig">For ${esc(COMPANY_NAME)}: ___________________________&nbsp;&nbsp;&nbsp;&nbsp;Date: _______________</p>
      <p class="sig">For ${esc(client.client_name)}: ___________________________&nbsp;&nbsp;&nbsp;&nbsp;Date: _______________</p>
    </body></html>`
  w.document.open()
  w.document.write(html)
  w.document.close()
  w.onload = () => w.print()
}
