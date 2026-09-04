// The labor Payment Request document.
//
// Replaces two hand-rolled print views that had drifted apart:
// ExpenseDetailPage rendered one for a single labor draft and
// BatchPaymentDetailPage rendered a near-copy for a batch, each as
// inline-styled React inside a `hidden print:block` div. Same document,
// two implementations, and each was missing something the other had —
// the single view had no bank details and dropped overtime entirely; the
// batch view printed blank signature lines even when finance had already
// approved.
//
// This builds both from one template, as an HTML string like every other
// document in the app (purchase order, proforma, contracts), which also
// makes it something you can freeze: the string is what gets stored in
// payment_requests.document_html and replayed later, so an issued PR
// stays the document that was actually authorised.
//
// What it adds over the print views it replaces:
//   · a disbursement schedule — who the bank actually pays, with account
//     numbers, deduplicated across drafts, which is the part finance was
//     previously assembling by hand
//   · the total in words, which Ethiopian banks expect on a voucher
//   · the real approval trail (names and dates) instead of empty rules
//   · overtime, gang composition and per-draft subtotals on both variants
//   · a status watermark, so a superseded or voided copy cannot be
//     mistaken for a live authorisation

import { formatCurrency, formatDateGC } from '@/lib/utils'
import { amountInWords } from '@/lib/amountInWords'
import {
  documentBaseCss, renderLetterhead, renderFooter,
  COMPANY_NAME, BRAND_NAVY,
} from '@/lib/documentTheme'

// ── Inputs ───────────────────────────────────────────────────────────────────

export type PrWorkerLine = {
  id: string
  expenseId: string
  staffId: string
  name: string
  /** What the line is for, when the payment isn't labor — a fuel purchase's
   *  "Fuel — IVECO (100 L)" rather than the fuel station's name. Without it
   *  a non-labor breakdown row only repeats the payee the disbursement
   *  schedule already named. Ignored for labor, where the person *is* the
   *  line. */
  description?: string | null
  bankAccount: string | null
  units: number | null
  unitLabel: string
  rate: number | null
  subtotal: number | null
  overtimeHours: number | null
  overtimeAmount: number | null
  gangSize: number | null
  gangMemberNames: string | null
  /** Gang work is contracted through a vendor, so the money goes there, not to the lead worker. */
  vendorName: string | null
  vendorBankAccount: string | null
}

export type PrDraft = {
  id: string
  code: string | null
  description: string | null
  amount: number | null
  projectName: string | null
  role: string | null
  periodStart: string | null
  periodEnd: string | null
  /** What the work actually was — from labor_requisitions.scope_of_work.
   *  Without it the document showed worker/days/rate with no description
   *  of the task itself. */
  scopeOfWork: string | null
  /** Where it happened, when it can differ from the project's own location. */
  siteLocation: string | null
}

export type PrApproval = { label: string; name: string | null; date: string | null }

export type PrStatus = 'draft' | 'issued' | 'superseded' | 'void'

/** A labeled block of extra fields for expense types this document's
 *  disbursement-schedule/worker-breakdown shape doesn't otherwise carry —
 *  e.g. a transport job's route, a lease's period, a CPO bond's ref. Kept
 *  generic (label + rows) rather than one variant per type so adding a
 *  new expense_type's detail doesn't require touching the renderer. */
export type PrTypeDetail = { label: string; rows: { label: string; value: string }[] }

export type LaborPaymentRequestInput = {
  kind: 'single' | 'batch'
  /** PRQ-… once issued; null while the document is still a preview. */
  documentCode: string | null
  /** The underlying expense_code or batch payment_code. */
  sourceCode: string | null
  issuedOn: string
  issuedByName: string | null
  status: PrStatus
  revision?: number
  drafts: PrDraft[]
  workers: PrWorkerLine[]
  approvals: PrApproval[]
  total: number
  notes?: string | null
  whtRequired?: boolean
  whtMethod?: string | null
  fundingAccount?: string | null
  paymentMethod?: string | null
  typeDetail?: PrTypeDetail | null
  /** Letterhead color — defaults to the labor navy/sky gradient when unset,
   *  so a rent/transport/bond document doesn't read as a labor payslip. */
  accentColor?: string | null
  /** Whether the breakdown table describes labor (people, days, day rates)
   *  or a non-labor payment (items billed by a vendor). Labor is the
   *  default because that's what this document was built for — but the
   *  other expense types were being printed as "Worker Breakdown — 1
   *  worker" with the vendor cast as the worker and "— pcs" standing in
   *  for a quantity, which is most of what made them read as payslips. */
  breakdownKind?: 'labor' | 'line_items'
  /** Names the kind of payment (Fuel, Purchase Order, …) in the meta strip,
   *  standing in for the labor-only Trade and Workers cells. */
  typeLabel?: string | null
}

// ── Disbursement schedule ────────────────────────────────────────────────────

export type PrPayeeLine = {
  key: string
  payee: string
  kind: 'worker' | 'vendor'
  bankAccount: string | null
  workerCount: number
  amount: number
}

/**
 * Collapses worker lines into what the bank is actually told to pay.
 *
 * Two things make this different from the worker table: a gang is paid to
 * its vendor rather than to the lead worker, and one person appearing on
 * three drafts in the same batch is one transfer, not three. Getting that
 * wrong is how a batch ends up over-disbursing, so the grouping lives here
 * with the document rather than being re-derived per call site.
 *
 * Routing is decided by whether the row carries a vendor at all
 * (`rollup_labor_timesheets_to_expense` only ever stamps one on when the
 * requisition's payment_model is 'gang_leader'), not by that row's own
 * gang_size — a gang whose rollup produced one labor_expense_workers row
 * per crew member (each with gang_size left null) still owes its whole
 * headcount to the vendor, not to four individual staff accounts, three of
 * which may have no bank account on file at all.
 */
export function buildPayeeLines(workers: PrWorkerLine[], opts?: { isLabor?: boolean }): PrPayeeLine[] {
  // Headcount only means something when the lines are people. A purchase
  // order's items all share one payee, and counting them would put
  // "2 workers" under a vendor being paid for two boxes of sockets.
  const countsHeads = opts?.isLabor !== false
  type DraftGroup = { key: string; payee: string; kind: 'worker' | 'vendor'; bankAccount: string | null; heads: number; amount: number }

  // First pass: collapse to one row per (payee, draft) — several rows for
  // the same payee within a single draft are different real heads (or an
  // OT line split out), so their headcounts and amounts add here.
  const byDraftPayee = new Map<string, DraftGroup>()
  for (const w of workers) {
    const useVendor = !!w.vendorName
    const kind: 'worker' | 'vendor' = useVendor ? 'vendor' : 'worker'
    const payee = useVendor ? w.vendorName! : w.name
    const bankAccount = useVendor ? w.vendorBankAccount : w.bankAccount
    const payeeKey = `${kind}:${useVendor ? w.vendorName : w.staffId}`
    const draftKey = `${payeeKey}|${w.expenseId}`

    const amount = (w.subtotal ?? 0) + (w.overtimeAmount ?? 0)
    const heads = countsHeads ? Math.max(w.gangSize ?? 1, 1) : 0

    const existing = byDraftPayee.get(draftKey)
    if (existing) {
      existing.amount += amount
      existing.heads += heads
      existing.bankAccount = existing.bankAccount ?? bankAccount
    } else {
      byDraftPayee.set(draftKey, { key: payeeKey, payee, kind, bankAccount, heads, amount })
    }
  }

  // Second pass: collapse across drafts. The amount is genuinely additional
  // money (another period's earnings), so it sums; the headcount is the
  // same crew showing up again, so it takes the largest single-draft
  // figure instead of multiplying by however many drafts got merged —
  // summing here is what turned "Kedir in 2 drafts" into "2 workers".
  const byPayee = new Map<string, PrPayeeLine>()
  for (const g of byDraftPayee.values()) {
    const existing = byPayee.get(g.key)
    if (existing) {
      existing.amount += g.amount
      existing.workerCount = Math.max(existing.workerCount, g.heads)
      existing.bankAccount = existing.bankAccount ?? g.bankAccount
    } else {
      byPayee.set(g.key, { key: g.key, payee: g.payee, kind: g.kind, bankAccount: g.bankAccount, workerCount: g.heads, amount: g.amount })
    }
  }

  return Array.from(byPayee.values()).sort((a, b) => b.amount - a.amount)
}

export function totalHeadcount(workers: PrWorkerLine[]): number {
  return workers.reduce((sum, w) => sum + Math.max(w.gangSize ?? 1, 1), 0)
}

// ── Rendering ────────────────────────────────────────────────────────────────

// Everything interpolated below is operator-entered text — worker names,
// vendor names, free-text notes and descriptions. The older print views
// dropped it straight into markup; here the string is also persisted and
// replayed in an iframe, so an unescaped apostrophe or angle bracket would
// corrupt an archived financial document.
function esc(v: unknown): string {
  if (v == null) return ''
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const money = (n: number | null | undefined) => (n == null ? '—' : esc(formatCurrency(n)))

const STATUS_BANNER: Record<PrStatus, { text: string; color: string } | null> = {
  // Kept to one short word: at stamp size a longer phrase runs wider
  // than the page and drags the whole layout out with it.
  draft:      { text: 'DRAFT', color: '#94a3b8' },
  issued:     null,
  superseded: { text: 'SUPERSEDED', color: '#b45309' },
  void:       { text: 'VOID', color: '#b91c1c' },
}

// Stored payment_method values are enum-ish. Printing "batch_wire" on a
// document that goes to a bank is the kind of small thing that makes a
// finance pack look machine-generated, so they get spelled out.
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  batch_wire: 'Bank transfer (batch wire)',
  wire: 'Bank transfer',
  transfer: 'Bank transfer',
  cash: 'Cash',
  cheque: 'Cheque',
  check: 'Cheque',
  cpo: 'CPO',
  vrf: 'Vendor receipt facilitation',
  vendor_credit: 'Vendor credit (no cash movement)',
  mobile_money: 'Mobile money',
}

function paymentMethodLabel(method: string | null | undefined): string {
  if (!method) return ''
  return PAYMENT_METHOD_LABELS[method] ?? method.replace(/_/g, ' ')
}

function renderWorkerRows(workers: PrWorkerLine[], showDraftCol: boolean, draftCodeById: Map<string, string>, isLabor: boolean): string {
  // Draft? + Who + Qty + Rate + Amount.
  const cols = showDraftCol ? 5 : 4
  if (workers.length === 0) {
    return `<tr><td colspan="${cols}" class="empty">No ${isLabor ? 'worker breakdown' : 'line items'} recorded for this request.</td></tr>`
  }
  return workers.map(w => {
    const isGang = (w.gangSize ?? 1) > 1
    const who = isLabor
      ? (isGang
        ? `<b>Gang of ${esc(w.gangSize)}</b> <span class="muted">via ${esc(w.name)}</span>${
            w.gangMemberNames ? `<div class="sub">${esc(w.gangMemberNames)}</div>` : ''}`
        : esc(w.name))
      : esc(w.description || w.name)
    const ot = (w.overtimeAmount ?? 0) > 0
      ? `<div class="ot">+ overtime ${w.overtimeHours ? `${esc(w.overtimeHours)}h · ` : ''}${money(w.overtimeAmount)}</div>`
      : ''
    const lineTotal = (w.subtotal ?? 0) + (w.overtimeAmount ?? 0)
    // A null quantity means "not recorded", so it prints as a bare dash.
    // Pairing it with the unit — "— pcs" — reads as a real measurement.
    const qty = w.units == null ? '—' : `${esc(w.units)} ${esc(w.unitLabel)}`
    return `<tr>
  ${showDraftCol ? `<td class="mono nowrap">${esc(draftCodeById.get(w.expenseId) ?? '—')}</td>` : ''}
  <td>${who}${ot}</td>
  <td class="r nowrap">${qty}</td>
  <td class="r nowrap">${money(w.rate)}</td>
  <td class="r nowrap b">${money(lineTotal)}</td>
</tr>`
  }).join('')
}

export function buildLaborPaymentRequestHtml(input: LaborPaymentRequestInput): string {
  const {
    kind, documentCode, sourceCode, issuedOn, issuedByName, status, revision,
    drafts, workers, approvals, total, notes, whtRequired, whtMethod,
    fundingAccount, paymentMethod, typeDetail, accentColor, breakdownKind, typeLabel,
  } = input

  const isBatch = kind === 'batch'
  const isLabor = breakdownKind !== 'line_items'
  const payees = buildPayeeLines(workers, { isLabor })
  const heads = totalHeadcount(workers)
  const words = amountInWords(total)
  const banner = STATUS_BANNER[status]
  const draftCodeById = new Map(drafts.map(d => [d.id, d.code ?? d.id.slice(0, 8)]))

  const projects = Array.from(new Set(drafts.map(d => d.projectName).filter(Boolean))) as string[]
  const roles = Array.from(new Set(drafts.map(d => d.role).filter(Boolean))) as string[]
  const starts = drafts.map(d => d.periodStart).filter(Boolean).sort() as string[]
  const ends = drafts.map(d => d.periodEnd).filter(Boolean).sort() as string[]
  const periodStart = starts[0]
  const periodEnd = ends[ends.length - 1]

  // Trade, Period Covered and Workers are labor's own vocabulary, all three
  // sourced from a labor requisition. On a fuel or purchase-order request
  // they have nothing behind them, and printing "—", "—" and "1" is what
  // left those documents looking like a payslip with the fields blanked.
  // Such a request names its payment type instead.
  const metaCells: { label: string; value: string }[] = [
    { label: 'Project', value: projects.length === 1 ? projects[0] : projects.length ? `${projects.length} projects` : '—' },
    ...(isLabor
      ? [{ label: 'Trade', value: roles.join(', ') || '—' }]
      : (typeLabel ? [{ label: 'Type', value: typeLabel }] : [])),
    ...(isLabor || periodStart
      ? [{
          label: 'Period Covered',
          value: periodStart && periodEnd
            ? `${formatDateGC(periodStart)} → ${formatDateGC(periodEnd)}`
            : (periodStart ? formatDateGC(periodStart) : '—'),
        }]
      : []),
    ...(isLabor ? [{ label: 'Workers', value: String(heads) }] : []),
    ...(isBatch ? [{ label: 'Drafts Covered', value: String(drafts.length) }] : []),
  ]

  // What the work was, not just who did it and for how much. Multiple
  // drafts (a batch) can each carry their own scope/site, so both are
  // deduplicated the same way projects/roles are above.
  const scopes = Array.from(new Set(drafts.map(d => d.scopeOfWork).filter(Boolean))) as string[]
  const sites = Array.from(new Set(drafts.map(d => d.siteLocation).filter(Boolean))) as string[]

  // The disbursement schedule is the operative half of the document, so
  // it comes before the evidence that justifies it rather than after.
  const payeeRows = payees.length
    ? payees.map(p => `<tr>
  <td>${esc(p.payee)}${p.kind === 'vendor' ? ' <span class="pill">vendor</span>' : ''}${
      p.workerCount > 1 ? `<div class="sub">${p.workerCount} workers</div>` : ''}</td>
  <td class="mono">${esc(p.bankAccount) || '<span class="warn">no account on file</span>'}</td>
  <td class="r b nowrap">${money(p.amount)}</td>
</tr>`).join('')
    : `<tr><td colspan="3" class="empty">No payees resolved — the worker breakdown is empty.</td></tr>`

  const payeeTotal = payees.reduce((s, p) => s + p.amount, 0)
  // A mismatch here means the request total and the sum of what the bank
  // is told to pay disagree. Printing it is far safer than reconciling
  // silently to whichever number happens to be handy.
  const payeeMismatch = payees.length > 0 && Math.abs(payeeTotal - total) > 0.005

  const draftRows = drafts.map(d => `<tr>
  <td class="mono nowrap">${esc(d.code ?? d.id.slice(0, 8))}</td>
  <td>${esc(d.description) || '—'}${d.projectName && projects.length > 1 ? `<div class="sub">${esc(d.projectName)}</div>` : ''}</td>
  <td class="r nowrap">${d.periodStart && d.periodEnd ? `${formatDateGC(d.periodStart)} → ${formatDateGC(d.periodEnd)}` : '—'}</td>
  <td class="r b nowrap">${money(d.amount)}</td>
</tr>`).join('')

  const approvalBlocks = approvals.map(a => `
<div class="sigblock">
  <div class="siglabel">${esc(a.label)}</div>
  <div class="sigrule">${a.name ? `<span class="signame">${esc(a.name)}</span>` : ''}</div>
  <div class="sighint">${a.date ? esc(formatDateGC(a.date)) : 'Name / Signature / Date'}</div>
</div>`).join('')

  const docTitle = isBatch ? 'PAYMENT REQUEST — BATCH' : 'PAYMENT REQUEST'
  const metaLines = [
    formatDateGC(issuedOn),
    sourceCode ? `Source: ${esc(sourceCode)}` : '',
    revision && revision > 1 ? `Revision ${revision}` : '',
  ].filter(Boolean)

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${esc(documentCode ?? docTitle)}</title>
<style>
${documentBaseCss}
body{padding:28px 34px;color:#1a1a1a;font-size:10pt;line-height:1.5;background:#fff}
/* overflow:hidden is the guard that stops the rotated stamp widening
   the page — every child here is width-constrained already. */
.wrap{max-width:820px;margin:0 auto;position:relative;overflow:hidden}
h2{font-size:10pt;font-weight:800;text-transform:uppercase;letter-spacing:.09em;color:${BRAND_NAVY};margin:20px 0 7px}
h2 .count{font-weight:600;color:#94a3b8;text-transform:none;letter-spacing:0}
.meta{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:6px}
.meta div{flex:1 1 130px;background:#f4f6f8;border-radius:5px;padding:8px 11px}
.meta .k{font-size:7.5pt;color:#9aa5b1;text-transform:uppercase;letter-spacing:.09em}
.meta .v{font-weight:700;font-size:9.5pt;margin-top:2px}
table{width:100%;border-collapse:collapse;font-size:9pt}
thead th{background:${BRAND_NAVY};color:#fff;padding:6px 9px;text-align:left;font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.07em}
thead th.r{text-align:right}
tbody td{padding:6px 9px;border-bottom:1px solid #e6eaf0;vertical-align:top}
tfoot td{padding:8px 9px;background:#f4f6f8;border-top:2px solid #d6dce6;font-weight:800}
td.r,tfoot td.r{text-align:right}
td.b{font-weight:700}
.mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:8.5pt}
.nowrap{white-space:nowrap}
.muted{color:#94a3b8}
.sub{font-size:7.5pt;color:#94a3b8;margin-top:1px}
.ot{font-size:7.5pt;color:#b45309;margin-top:1px}
.empty{color:#94a3b8;font-style:italic;text-align:center;padding:14px}
.warn{color:#b91c1c}
.pill{display:inline-block;padding:0 5px;border-radius:8px;background:#eef2ff;color:#3730a3;font-size:7pt;font-weight:700;vertical-align:1px}
.grand{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-top:12px;padding:11px 14px;border-radius:6px;background:${BRAND_NAVY};color:#fff}
.grand .w{font-size:8.5pt;color:rgba(255,255,255,.8);font-style:italic;max-width:62%}
.grand .n{font-size:16pt;font-weight:900;letter-spacing:-.5px;white-space:nowrap}
.note{margin-top:10px;background:#f8f9fb;border-radius:5px;padding:9px 12px;font-size:8.5pt;line-height:1.7}
.flag{margin-top:10px;border:1px solid #fbbf24;background:#fffbeb;border-radius:5px;padding:8px 12px;font-size:8.5pt;color:#92400e}
.alert{margin-top:10px;border:1px solid #fca5a5;background:#fef2f2;border-radius:5px;padding:8px 12px;font-size:8.5pt;color:#b91c1c}
.sigs{display:flex;gap:22px;margin-top:26px;padding-top:16px;border-top:2px solid #d6dce6}
.sigblock{flex:1}
.siglabel{font-size:7.5pt;color:#9aa5b1;text-transform:uppercase;letter-spacing:.09em;margin-bottom:2px}
.sigrule{border-bottom:1.5px solid #94a3b8;min-height:30px;display:flex;align-items:flex-end;padding-bottom:2px}
.signame{font-size:9pt;font-style:italic;font-weight:600;color:${BRAND_NAVY}}
.sighint{font-size:7.5pt;color:#c3cbd6;margin-top:3px}
/* The stamp reads across the whole page rather than sitting in a corner
   where a signed copy could still pass for live. It has to sit OVER the
   content: the tables have solid fills, so a stamp underneath them is
   invisible exactly where it matters. Low opacity keeps the figures
   legible through it, pointer-events:none keeps it out of selection,
   and print-color-adjust stops the browser dropping it on the way to
   the printer. */
.stamp{position:absolute;top:38%;left:50%;transform:translate(-50%,-50%) rotate(-22deg);
  font-size:62pt;font-weight:900;letter-spacing:6px;opacity:.17;pointer-events:none;
  white-space:nowrap;z-index:5;-webkit-print-color-adjust:exact;print-color-adjust:exact}
/* Long batches run to several pages: keep headers on every one and stop
   a table splitting a row or orphaning the signature block. */
@media print{
  body{padding:0}
  thead{display:table-header-group}
  tr{page-break-inside:avoid}
  h2{page-break-after:avoid}
  .sigs,.grand{page-break-inside:avoid}
  @page{size:A4;margin:14mm 12mm}
}
</style>
</head>
<body>
<div class="wrap">
${banner ? `<div class="stamp" style="color:${banner.color}">${esc(banner.text)}</div>` : ''}
${renderLetterhead({
    docTitle,
    docCode: documentCode ?? undefined,
    metaLines,
    gradient: accentColor ? { from: accentColor, to: accentColor } : 'laborPayment',
  })}

<div class="meta">
${metaCells.map(c => `  <div><div class="k">${esc(c.label)}</div><div class="v">${esc(c.value)}</div></div>`).join('\n')}
</div>

${(scopes.length > 0 || sites.length > 0) ? `
<div class="note">
  ${scopes.length > 0 ? `<p style="margin:0"><b>Work Done:</b> ${scopes.map(esc).join('; ')}</p>` : ''}
  ${sites.length > 0 ? `<p style="margin:0"><b>Site:</b> ${sites.map(esc).join('; ')}</p>` : ''}
</div>` : ''}

${typeDetail ? `
<div style="margin-bottom:10px;border:1px solid #dde2ea;border-radius:5px;overflow:hidden">
  <div style="background:${esc(accentColor ?? BRAND_NAVY)};color:#fff;padding:7px 12px;font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.09em">${esc(typeDetail.label)}</div>
  <div style="padding:9px 12px;font-size:9pt;line-height:1.7">
    ${typeDetail.rows.map(r => `<p style="margin:0"><b>${esc(r.label)}:</b> ${esc(r.value)}</p>`).join('')}
  </div>
</div>` : ''}

<h2>Disbursement Schedule <span class="count">— ${payees.length} payee${payees.length === 1 ? '' : 's'}</span></h2>
<table>
  <thead><tr><th>Pay To</th><th>Bank Account</th><th class="r">Amount</th></tr></thead>
  <tbody>${payeeRows}</tbody>
  <tfoot><tr><td colspan="2" class="r">Total to disburse</td><td class="r">${money(payeeTotal)}</td></tr></tfoot>
</table>
${payeeMismatch ? `<div class="alert"><b>Check required.</b> The disbursement schedule totals ${money(payeeTotal)} but the request total is ${money(total)}. Resolve the difference before releasing payment.</div>` : ''}

<h2>${isLabor
    ? `Worker Breakdown <span class="count">— ${heads} worker${heads === 1 ? '' : 's'}</span>`
    : `Payment Detail${workers.length > 1 ? ` <span class="count">— ${workers.length} line items</span>` : ''}`}</h2>
<table>
  <thead><tr>
    ${isBatch ? '<th>Draft</th>' : ''}
    <th>${isLabor ? 'Worker' : 'Description'}</th><th class="r">Qty</th><th class="r">${isLabor ? 'Rate' : 'Unit Price'}</th><th class="r">Amount</th>
  </tr></thead>
  <tbody>${renderWorkerRows(workers, isBatch, draftCodeById, isLabor)}</tbody>
</table>

${isBatch && drafts.length > 0 ? `
<h2>Underlying Drafts <span class="count">— ${drafts.length}</span></h2>
<table>
  <thead><tr><th>Code</th><th>Description</th><th class="r">Period</th><th class="r">Amount</th></tr></thead>
  <tbody>${draftRows}</tbody>
</table>` : ''}

<div class="grand">
  <div class="w">${words ? esc(words) : ''}</div>
  <div class="n">${money(total)}</div>
</div>

${(fundingAccount || paymentMethod) ? `<div class="note"><b>Funding:</b> ${esc(paymentMethodLabel(paymentMethod)) || '—'}${fundingAccount ? ` · ${esc(fundingAccount)}` : ''}</div>` : ''}
${whtRequired ? `<div class="flag"><b>Withholding Tax (WHT) required</b> — ${whtMethod ? esc(whtMethod) : 'deduct before disbursement'}.</div>` : ''}
${notes ? `<div class="note"><b>Notes:</b> ${esc(notes)}</div>` : ''}

<div class="sigs">${approvalBlocks}</div>

${renderFooter(documentCode ?? sourceCode ?? undefined)}
<div style="margin-top:4px;font-size:7.5pt;color:#c3cbd6">
  ${esc(COMPANY_NAME)} · Official payment request document${issuedByName ? ` · Prepared by ${esc(issuedByName)}` : ''} · ${esc(formatDateGC(issuedOn))}
</div>
</div>
</body>
</html>`
}

/**
 * The structured counterpart to the frozen HTML — stored alongside it so
 * the register can report on an issued PR without re-parsing markup or
 * re-reading tables that may since have changed.
 */
export function buildPaymentRequestSnapshot(input: LaborPaymentRequestInput) {
  return {
    kind: input.kind,
    source_code: input.sourceCode,
    issued_on: input.issuedOn,
    total: input.total,
    drafts: input.drafts,
    workers: input.workers,
    approvals: input.approvals,
    funding_account: input.fundingAccount ?? null,
    payment_method: input.paymentMethod ?? null,
    wht_required: input.whtRequired ?? false,
    wht_method: input.whtMethod ?? null,
    notes: input.notes ?? null,
    type_detail: input.typeDetail ?? null,
    // Recorded so the register can tell a labor request from a vendor one
    // without re-deriving it from the worker rows.
    breakdown_kind: input.breakdownKind ?? 'labor',
    type_label: input.typeLabel ?? null,
  }
}
