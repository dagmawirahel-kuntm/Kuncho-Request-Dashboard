// Shared branding for every printable/exportable document in the app
// (purchase orders, proformas, invoices, payment requests, contracts).
// Single source of truth: the company's identity comes from the
// company_profile row (migration 368), loaded once and kept here so the
// synchronous HTML builders can read it.

import { formatEthiopian } from '@/lib/ethiopianCalendar'

export const COMPANY_NAME = 'KUNCHO TRADING PLC'
export const COMPANY_ADDRESS = 'Addis Ababa, Ethiopia'
export const BRAND_NAVY = '#1B3A5C'
export const DOC_FONT = 'Arial, Helvetica, "Noto Sans Ethiopic", "Nyala", sans-serif'

export interface BankAccountLine {
  bank: string
  account_name?: string | null
  account_number: string
  branch?: string | null
  swift?: string | null
  on_documents?: boolean
}

export interface CompanyProfile {
  legal_name: string
  legal_name_am: string | null
  address: string | null
  po_box: string | null
  phone: string | null
  email: string | null
  website: string | null
  tin: string | null
  vat_reg_no: string | null
  vat_reg_date: string | null
  logo_data_url: string | null
  print_style: 'color' | 'plain'
  show_ethiopian_dates: boolean
  footer_note: string | null
  proforma_terms: string | null
  bank_accounts: BankAccountLine[]
}

export interface CompanySignoff {
  signatory_name: string | null
  signatory_title: string | null
  signature_data_url: string | null
  stamp_data_url: string | null
}

export const DEFAULT_PROFILE: CompanyProfile = {
  legal_name: COMPANY_NAME, legal_name_am: null, address: COMPANY_ADDRESS, po_box: null, phone: null, email: null,
  website: null, tin: null, vat_reg_no: null, vat_reg_date: null, logo_data_url: null, print_style: 'color',
  show_ethiopian_dates: true, footer_note: null, proforma_terms: null, bank_accounts: [],
}

let current: CompanyProfile = DEFAULT_PROFILE
/** Set by useCompanyProfile once the row loads. */
export function setDocumentProfile(p: CompanyProfile | null | undefined) { current = p ? { ...DEFAULT_PROFILE, ...p, bank_accounts: p.bank_accounts ?? [] } : DEFAULT_PROFILE }
export function docProfile(): CompanyProfile { return current }
export function companyName() { return current.legal_name || COMPANY_NAME }
export function companyAddress() { return current.address || COMPANY_ADDRESS }

/** Everything typed by a person goes through this before it lands in a document. */
export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
/** Escaped, with line breaks kept. */
export function escLines(v: unknown): string { return esc(v).replace(/\r?\n/g, '<br/>') }

/** "28 Sep 2026 · 18 Mes 2019" — both calendars unless the profile turns it off. */
export function docDate(d: string | Date | null | undefined): string {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d.length === 10 ? `${d}T00:00:00` : d) : d
  if (isNaN(date.getTime())) return ''
  const g = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  return current.show_ethiopian_dates ? `${g} · ${formatEthiopian(date, true)} E.C.` : g
}

export function docMoney(n: number | null | undefined, currency = 'ETB'): string {
  return `${currency} ${Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// One gradient per document type, so the letterhead band is a quick
// visual "what kind of document is this" cue at a glance, while every
// document still shares the same layout/font/company identity.
export type DocumentGradientKey =
  | 'purchaseOrder' | 'proforma' | 'paymentRequestLetter' | 'laborPayment'
  | 'vendorContract' | 'bdContract' | 'payroll' | 'invoice'

export const DOCUMENT_GRADIENTS: Record<DocumentGradientKey, { from: string; to: string }> = {
  purchaseOrder:       { from: '#1D4E89', to: '#0EA5A5' }, // blue -> teal: procurement/materials
  proforma:            { from: '#3730A3', to: '#7C3AED' }, // indigo -> violet: sales quote
  paymentRequestLetter:{ from: '#0F766E', to: '#10B981' }, // teal -> emerald: money owed to us
  laborPayment:        { from: '#1B3A5C', to: '#0EA5E9' }, // navy -> sky: money we pay out
  vendorContract:      { from: '#334155', to: '#7E22CE' }, // slate -> purple: procurement-side legal
  bdContract:          { from: '#92400E', to: '#D97706' }, // amber -> gold: sales-side legal
  // Berry -> rose: salaries. Deliberately the one warm red in the set — a
  // payroll run is the document most often confused with a labor payment at a
  // glance, and the two sat at opposite ends of the same navy/sky family.
  payroll:             { from: '#831843', to: '#E11D48' },
  invoice:             { from: '#1B3A5C', to: '#2563EB' }, // navy -> blue: the tax invoice
}

export function gradientCss(key: DocumentGradientKey | { from: string; to: string }, angle = 135): string {
  const { from, to } = typeof key === 'string' ? DOCUMENT_GRADIENTS[key] : key
  return `linear-gradient(${angle}deg, ${from}, ${to})`
}
const accentOf = (key: DocumentGradientKey | { from: string; to: string }) => (typeof key === 'string' ? DOCUMENT_GRADIENTS[key] : key).from

// Shared CSS for the HTML-string documents (built via template literals
// and printed through an iframe or a new window). Each document's own
// <style> block should include this alongside its document-specific
// rules (tables, line items, clause layout, etc).
//
// Print rules live here so every document gets them: colours are kept
// (browsers drop backgrounds by default, which left the white letterhead
// text on white paper), table headers repeat on each page, rows don't split
// across a page, and pages are numbered where the browser supports it.
export const documentBaseCss = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:${DOC_FONT}}
.doc-letterhead{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:18px 22px;border-radius:10px;margin-bottom:18px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.doc-brand{display:flex;align-items:center;gap:12px;min-width:0}
.doc-logo{width:36px;height:36px;background:rgba(255,255,255,0.22);border-radius:6px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:14px;flex-shrink:0}
.doc-logo-img{height:46px;max-width:120px;object-fit:contain;flex-shrink:0;background:#fff;border-radius:6px;padding:3px}
.doc-company{font-weight:900;font-size:15pt;color:#fff;letter-spacing:-0.3px}
.doc-company-am{font-size:10pt;color:rgba(255,255,255,0.9);font-weight:700;margin-top:1px}
.doc-address{font-size:8.5pt;color:rgba(255,255,255,0.8);margin-top:2px;line-height:1.45}
.doc-meta{text-align:right;font-size:9.5pt;color:rgba(255,255,255,0.85);line-height:1.6;flex-shrink:0}
.doc-meta b{font-weight:700}
.doc-title{font-size:16pt;font-weight:900;color:#fff;letter-spacing:-0.5px}
.doc-hr{border:none;border-top:1.5px solid ${BRAND_NAVY};margin:10px 0 16px}
.doc-footer{margin-top:40px;font-size:8.5pt;color:#888;border-top:1px solid #ddd;padding-top:10px;display:flex;justify-content:space-between;gap:12px}
.doc-letterhead-centered{text-align:center;padding:18px 22px;border-radius:10px;margin-bottom:18px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.doc-letterhead-centered .doc-logo,.doc-letterhead-centered .doc-logo-img{margin:0 auto 6px}
.doc-letterhead-centered .doc-company{font-size:16pt}
/* Plain letterhead: white paper, the document colour as a rule. */
.doc-plain{background:#fff !important;border-radius:0;padding:4px 0 14px;border-bottom:3px solid var(--doc-accent)}
.doc-plain .doc-company{color:#111}
.doc-plain .doc-company-am{color:#333}
.doc-plain .doc-address,.doc-plain .doc-meta{color:#555}
.doc-plain .doc-title{color:var(--doc-accent)}
.doc-plain .doc-logo{background:var(--doc-accent)}
.doc-plain .doc-logo-img{padding:0}
.doc-party{display:flex;gap:24px;justify-content:space-between;margin-bottom:18px;font-size:10pt;line-height:1.5}
.doc-party .lbl{color:#888;font-size:8.5pt;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px}
.doc-party b{font-size:11pt}
.doc-banks{margin-top:14px;font-size:9.5pt;border:1px solid #ddd;border-radius:6px;padding:8px 12px;break-inside:avoid}
.doc-banks .lbl{color:#888;font-size:8.5pt;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}
.doc-banks table{width:100%;border-collapse:collapse;margin:0}
.doc-banks td{padding:2px 6px 2px 0;border:none;background:none !important;font-size:9.5pt}
.doc-signoff{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;margin-top:34px;break-inside:avoid}
.doc-sign{min-width:220px;position:relative}
.doc-sign .line{border-top:1px solid #333;padding-top:5px;font-size:9.5pt;margin-top:6px}
.doc-sign .sig-img{height:54px;max-width:200px;object-fit:contain;display:block}
.doc-sign .stamp-img{position:absolute;left:120px;top:-22px;height:86px;opacity:.85}
.doc-sign .muted{color:#777;font-size:8.5pt}
.doc-verify{display:flex;align-items:center;gap:10px;font-size:8pt;color:#666;max-width:280px;break-inside:avoid}
.doc-verify img{width:74px;height:74px;flex-shrink:0}
.doc-watermark{position:fixed;top:42%;left:0;right:0;text-align:center;font-size:88pt;font-weight:900;color:rgba(0,0,0,0.05);transform:rotate(-24deg);pointer-events:none;z-index:0}
table{page-break-inside:auto}
thead{display:table-header-group}
tfoot{display:table-footer-group}
tr,td,th{break-inside:avoid;page-break-inside:avoid}
@page{size:A4;@bottom-right{content:"Page " counter(page) " of " counter(pages);font:8pt Arial,sans-serif;color:#999}}
`

function logoHtml(): string {
  return current.logo_data_url
    ? `<img class="doc-logo-img" src="${esc(current.logo_data_url)}" alt=""/>`
    : `<div class="doc-logo">${esc(companyName().trim().charAt(0) || 'K')}</div>`
}

/** Address, phone and email on one line; TIN and VAT registration on the next. */
function identityLines(): string {
  const p = current
  const contact = [p.address || COMPANY_ADDRESS, p.po_box ? `P.O. Box ${p.po_box}` : null, p.phone, p.email, p.website].filter(Boolean).map(esc).join(' · ')
  const tax = [p.tin ? `TIN ${p.tin}` : null, p.vat_reg_no ? `VAT Reg. No. ${p.vat_reg_no}` : null].filter(Boolean).map(esc).join(' · ')
  return `${contact}${tax ? `<br/>${tax}` : ''}`
}

// Left logo+company, right doc title/meta — the "invoice" letterhead
// used by Purchase Order, Proforma Invoice, Invoice, and the client Payment
// Request letter. docTitle/docCode/metaLines are trusted markup built by the
// caller; anything user-typed in them must already be escaped.
export function renderLetterhead(p: { docTitle: string; docCode?: string; metaLines?: string[]; gradient: DocumentGradientKey | { from: string; to: string } }): string {
  const plain = current.print_style === 'plain'
  return `
<div class="doc-letterhead${plain ? ' doc-plain' : ''}" style="${plain ? `--doc-accent:${accentOf(p.gradient)}` : `background:${gradientCss(p.gradient)}`}">
  <div class="doc-brand">
    ${logoHtml()}
    <div>
      <div class="doc-company">${esc(companyName())}</div>
      ${current.legal_name_am ? `<div class="doc-company-am">${esc(current.legal_name_am)}</div>` : ''}
      <div class="doc-address">${identityLines()}</div>
    </div>
  </div>
  <div class="doc-meta">
    <div class="doc-title">${p.docTitle}</div>
    ${p.docCode ? `<div><b>${esc(p.docCode)}</b></div>` : ''}
    ${(p.metaLines ?? []).map(l => `<div>${l}</div>`).join('')}
  </div>
</div>`
}

// Centered letterhead for formal/legal documents — Vendor Contract and
// the BD contract print view.
export function renderCenteredLetterhead(p: { subtitle?: string; gradient: DocumentGradientKey }): string {
  const plain = current.print_style === 'plain'
  return `
<div class="doc-letterhead-centered${plain ? ' doc-plain' : ''}" style="${plain ? `--doc-accent:${accentOf(p.gradient)}` : `background:${gradientCss(p.gradient)}`}">
  ${logoHtml()}
  <div class="doc-company">${esc(companyName())}</div>
  ${current.legal_name_am ? `<div class="doc-company-am">${esc(current.legal_name_am)}</div>` : ''}
  <div class="doc-address">${identityLines()}${p.subtitle ? ` &nbsp;|&nbsp; ${esc(p.subtitle)}` : ''}</div>
</div>`
}

export function renderFooter(refCode?: string): string {
  const p = current
  return `
<div class="doc-footer">
  <span>${esc(companyName())} &middot; ${esc(companyAddress())}${p.tin ? ` &middot; TIN ${esc(p.tin)}` : ''}${p.footer_note ? `<br/>${esc(p.footer_note)}` : ''}</span>
  <span>${refCode ? `Ref: ${esc(refCode)}` : ''}</span>
</div>`
}

/** "Bill to" block with the client's TIN, and our own details alongside. */
export function renderParty(p: { label: string; name: string; tin?: string | null; lines?: (string | null | undefined)[]; right?: string }): string {
  return `
<div class="doc-party">
  <div>
    <div class="lbl">${esc(p.label)}</div>
    <b>${esc(p.name)}</b>
    ${(p.lines ?? []).filter(Boolean).map(l => `<div>${esc(l)}</div>`).join('')}
    ${p.tin ? `<div>TIN: ${esc(p.tin)}</div>` : ''}
  </div>
  ${p.right ? `<div style="text-align:right">${p.right}</div>` : ''}
</div>`
}

/** The accounts marked "on documents" in the company profile. */
export function renderBankAccounts(title = 'Please pay to'): string {
  const accts = current.bank_accounts.filter(a => a.on_documents !== false && a.account_number)
  if (!accts.length) return ''
  return `
<div class="doc-banks">
  <div class="lbl">${esc(title)}</div>
  <table>${accts.map(a => `<tr><td><b>${esc(a.bank)}</b>${a.branch ? `, ${esc(a.branch)}` : ''}</td><td>${esc(a.account_name || companyName())}</td><td style="text-align:right;font-family:monospace">${esc(a.account_number)}</td>${a.swift ? `<td>SWIFT ${esc(a.swift)}</td>` : ''}</tr>`).join('')}</table>
</div>`
}

export interface VerifyInfo { url: string; qrDataUrl: string; version?: number }

/**
 * The signature block, with the signature and stamp when the person
 * printing may use them, and the verification QR on the right.
 */
export function renderSignoff(p: { forLabel?: string; signoff?: CompanySignoff | null; preparedBy?: string | null; verify?: VerifyInfo | null; receivedBy?: boolean }): string {
  const s = p.signoff
  const sign = `
  <div class="doc-sign">
    ${s?.signature_data_url ? `<img class="sig-img" src="${esc(s.signature_data_url)}" alt=""/>` : '<div style="height:54px"></div>'}
    ${s?.stamp_data_url ? `<img class="stamp-img" src="${esc(s.stamp_data_url)}" alt=""/>` : ''}
    <div class="line"><b>${esc(s?.signatory_name || 'Authorised signatory')}</b>${s?.signatory_title ? `, ${esc(s.signatory_title)}` : ''}<br/><span class="muted">For ${esc(p.forLabel ?? companyName())}</span></div>
    ${p.preparedBy ? `<div class="muted" style="margin-top:4px">Prepared by ${esc(p.preparedBy)}</div>` : ''}
  </div>`
  const received = p.receivedBy ? `
  <div class="doc-sign"><div style="height:54px"></div><div class="line">Received by (name, signature, date)</div></div>` : ''
  return `<div class="doc-signoff">${sign}${received}${p.verify ? renderVerify(p.verify) : ''}</div>`
}

export function renderVerify(v: VerifyInfo): string {
  return `
<div class="doc-verify">
  <img src="${v.qrDataUrl}" alt="QR"/>
  <div>Scan to check this document is genuine${v.version && v.version > 1 ? ` (version ${v.version})` : ''}.<br/><span style="word-break:break-all;color:#999">${esc(v.url)}</span></div>
</div>`
}
