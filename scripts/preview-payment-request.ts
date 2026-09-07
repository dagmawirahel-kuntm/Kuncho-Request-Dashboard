// One-off: render a Payment Request to HTML outside the browser, so the
// letterhead, headings and per-bank schedule can be checked without a deploy.
//
//   npx tsx scripts/preview-payment-request.ts [out.html]

import { writeFileSync } from 'node:fs'
import { buildLaborPaymentRequestHtml, type LaborPaymentRequestInput } from '../src/lib/laborPaymentRequestDocument'

const worker = (
  name: string, acct: string, bank: string | null, gross: number, net: number, holder?: string,
) => ({
  id: name, expenseId: 'run', staffId: name, name,
  subNote: [
    gross > net ? `less ${(gross - net).toLocaleString()} deductions` : null,
    holder ? `account held by ${holder}` : null,
  ].filter(Boolean).join(' · ') || null,
  bankAccount: acct, bankName: bank,
  units: null, unitLabel: '', rate: gross, subtotal: net,
  overtimeHours: null, overtimeAmount: null, gangSize: null, gangMemberNames: null,
  vendorName: null, vendorBankAccount: null,
})

const input: LaborPaymentRequestInput = {
  kind: 'single',
  documentCode: 'PRQ-2026-0099',
  sourceCode: 'PR-2026-221',
  issuedOn: '2026-09-07',
  issuedByName: 'Finance',
  status: 'issued',
  revision: 1,
  typeLabel: 'Payroll',
  accentGradient: 'payroll',
  accentColor: '#831843',
  breakdownNoun: 'employee',
  drafts: [{
    id: 'run', code: 'PR-2026-221', description: 'Regular — Monthly', amount: 311000,
    projectName: null, role: null, periodStart: '2026-08-01', periodEnd: '2026-08-30',
    scopeOfWork: null, siteLocation: null,
  }],
  workers: [
    worker('Dawit Abiy', '1611411247165018', 'ZMNBNK', 25000, 25000),
    worker('Hayat Seid', '1611411247169019', 'ZMNBNK', 20000, 18000),
    worker('Yonatan Bekele', '1000399902529', 'Commercial Bank of Ethiopia', 20000, 20000),
    worker('Aragaw Welde', '1000070442648', 'Commercial Bank of Ethiopia', 15000, 15000, 'Mesfin Bekele'),
    worker('Someone Unbanked', '', null, 10000, 10000),
  ],
  approvals: [
    { label: 'Prepared By', name: 'Finance', date: null },
    { label: 'Manager Approved', name: 'Manager', date: '2026-09-06' },
    { label: 'Finance Approved', name: 'Finance Lead', date: '2026-09-07' },
  ],
  total: 88000,
  fundingAccount: 'ZMNBNK',
  paymentMethod: 'transfer',
  typeDetail: {
    label: 'Payroll Run',
    rows: [
      { label: 'Pay period', value: 'Monthly · 01 Aug 2026 → 30 Aug 2026' },
      { label: 'Employees', value: '5' },
      { label: 'Banks to instruct', value: 'ZMNBNK (2) · Commercial Bank of Ethiopia (2) · no bank recorded (1)' },
    ],
  },
}

const html = buildLaborPaymentRequestHtml(input)
const out = process.argv[2] ?? 'payment-request-preview.html'
writeFileSync(out, html)

const checks: [string, boolean][] = [
  ['payroll gradient on letterhead', html.includes('#831843') && html.includes('#E11D48')],
  ['does NOT use the labor navy/sky band', !html.includes('linear-gradient(135deg, #1B3A5C, #0EA5E9)')],
  ['breakdown says Employee, not Worker', html.includes('Employee Breakdown') && !html.includes('Worker Breakdown')],
  ['per-bank sections present', html.includes('bankhead') && html.includes('Subtotal —')],
  ['unbanked payee flagged', html.includes('No bank recorded') || html.includes('no account on file')],
  ['account holder surfaced', html.includes('Mesfin Bekele')],
  ['type detail block tinted with the accent', html.includes('background:#831843')],
]
let bad = 0
for (const [label, ok] of checks) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}`)
  if (!ok) bad++
}
console.log(`\nwritten ${out} (${html.length} bytes)`)
process.exit(bad ? 1 : 0)
