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

interface ClauseSection {
  heading: string
  paragraphs: string[]
}

// The body of the actual signable agreement — shared between the
// Word document and the print view so the two never drift apart.
// Scope of Work / Deliverables & Timeline / Payment Schedule are
// drawn from the contract's own fields; everything else (Warranty,
// Termination, Confidentiality, Force Majeure, Dispute Resolution,
// Governing Law) is fixed standard boilerplate for a construction/
// fit-out services agreement — deliberately generic, with blanks
// (______) left for the notice/liability periods a human fills in,
// same convention as the signature lines below. This is still a
// straightforward template, not a legal-template engine or a
// replacement for legal review.
function buildClauseSections(contract: Contract, client: Client): ClauseSection[] {
  const signedDate = contract.signed_date ? formatDate(contract.signed_date) : 'the date of signing'

  const sections: ClauseSection[] = [
    {
      heading: 'Parties',
      paragraphs: [
        `This Service Contract ("Agreement") is entered into ${contract.signed_date ? `on ${formatDate(contract.signed_date)}` : 'as of the date of signing'} by and between ${COMPANY_NAME} ("Contractor") and ${client.client_name} ("Client"), together the "Parties".`,
      ],
    },
    {
      heading: 'Scope of Work',
      paragraphs: [
        contract.scope_of_work?.trim() ||
          'The Contractor shall provide the services described in the Scope of Work as agreed with the Client, including all labor, materials, and supervision necessary to complete the work described herein.',
      ],
    },
    {
      heading: 'Deliverables & Timeline',
      paragraphs: [
        contract.completion_date
          ? `Work under this Agreement shall commence on ${signedDate} and is targeted for completion by ${formatDate(contract.completion_date)}.`
          : `Work under this Agreement shall commence on ${signedDate}, with a completion date to be agreed in writing between the Parties.`,
      ],
    },
    {
      heading: 'Payment Schedule',
      paragraphs: [
        `Total Contract Value: ${contract.contract_value != null ? formatCurrency(contract.contract_value) : '—'}.`,
        contract.payment_terms?.trim()
          ? `Payment Terms: ${contract.payment_terms.trim()}`
          : 'Payment Terms: To be agreed in writing between the Parties.',
        ...(contract.wht_rate != null
          ? [`Withholding Tax (WHT) of ${contract.wht_rate}% will be withheld from each payment as required by applicable tax law, where applicable.`]
          : []),
        ...(contract.retention_percent != null
          ? [`Retention of ${contract.retention_percent}% of each payment will be withheld by the Client until practical completion or the end of the Defects Liability Period, where applicable.`]
          : []),
      ],
    },
    {
      heading: 'Warranty & Defects Liability',
      paragraphs: [
        'The Contractor warrants that all work performed under this Agreement will be free from material defects in workmanship and materials for a period of ______ from the date of completion (the "Defects Liability Period"). Any defect notified in writing by the Client within this period shall be remedied by the Contractor at no additional cost to the Client.',
      ],
    },
    {
      heading: 'Termination',
      paragraphs: [
        'Either Party may terminate this Agreement by giving ______ days\' written notice to the other Party in the event of a material breach that remains unremedied after written notice, or by mutual written agreement. Upon termination, the Client shall pay the Contractor for all work satisfactorily completed up to the date of termination.',
      ],
    },
    {
      heading: 'Confidentiality',
      paragraphs: [
        'Each Party agrees to keep confidential all non-public information disclosed by the other Party in connection with this Agreement, and not to disclose such information to any third party without the prior written consent of the disclosing Party, except as required by law.',
      ],
    },
    {
      heading: 'Force Majeure',
      paragraphs: [
        'Neither Party shall be liable for any failure or delay in performance under this Agreement to the extent such failure or delay is caused by circumstances beyond its reasonable control, including but not limited to acts of God, war, civil unrest, government action, or natural disaster.',
      ],
    },
    {
      heading: 'Dispute Resolution',
      paragraphs: [
        'The Parties shall first attempt to resolve any dispute arising from this Agreement through good-faith negotiation between authorized representatives. If a dispute remains unresolved within 30 days, it shall be referred to arbitration or the appropriate courts, as mutually agreed by the Parties.',
      ],
    },
    {
      heading: 'Governing Law',
      paragraphs: [
        'This Agreement shall be governed by and construed in accordance with the laws of the Federal Democratic Republic of Ethiopia.',
      ],
    },
  ]

  if (contract.notes?.trim()) {
    sections.push({ heading: 'Notes', paragraphs: [contract.notes.trim()] })
  }

  return sections
}

// Generates a formatted Word document from a contract + its client,
// so BD stops formatting these by hand. The Contract Details / Client
// Details tables cover the record's own fields (value, payment terms,
// WHT rate, client details); buildClauseSections() supplies the body
// of the actual agreement (scope, timeline, payment schedule, and the
// standard boilerplate clauses) so what gets signed is a real service
// contract, not just a details summary.
export async function buildContractDocx(contract: Contract, client: Client): Promise<Blob> {
  const clauseChildren = buildClauseSections(contract, client).flatMap(section => [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 300, after: 100 },
      children: [new TextRun(section.heading)],
    }),
    ...section.paragraphs.map(p => new Paragraph({ text: p, spacing: { after: 100 } })),
  ])

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
            row('Signed Date', formatDate(contract.signed_date)),
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
        ...clauseChildren,
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
  const clauseHtml = buildClauseSections(contract, client)
    .map(section => `<h3>${esc(section.heading)}</h3>${section.paragraphs.map(p => `<p>${esc(p)}</p>`).join('')}`)
    .join('')
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
        <tr><td class="label">Signed Date</td><td>${esc(formatDate(contract.signed_date))}</td></tr>
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
      ${clauseHtml}
      <h3>Signatures</h3>
      <p class="sig">For ${esc(COMPANY_NAME)}: ___________________________&nbsp;&nbsp;&nbsp;&nbsp;Date: _______________</p>
      <p class="sig">For ${esc(client.client_name)}: ___________________________&nbsp;&nbsp;&nbsp;&nbsp;Date: _______________</p>
    </body></html>`
  w.document.open()
  w.document.write(html)
  w.document.close()
  w.onload = () => w.print()
}
