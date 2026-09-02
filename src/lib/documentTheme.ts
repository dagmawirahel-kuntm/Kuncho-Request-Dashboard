// Shared branding for every printable/exportable document in the app
// (purchase orders, invoices, payment requests, contracts). Single
// source of truth so a rebrand or address change happens in one place
// instead of drifting across half a dozen hand-rolled HTML templates.

export const COMPANY_NAME = 'KUNCHO TRADING PLC'
export const COMPANY_ADDRESS = 'Addis Ababa, Ethiopia'
export const BRAND_NAVY = '#1B3A5C'
export const DOC_FONT = 'Arial, Helvetica, sans-serif'

// One gradient per document type, so the letterhead band is a quick
// visual "what kind of document is this" cue at a glance, while every
// document still shares the same layout/font/company identity.
export type DocumentGradientKey =
  | 'purchaseOrder' | 'proforma' | 'paymentRequestLetter' | 'laborPayment'
  | 'vendorContract' | 'bdContract'

export const DOCUMENT_GRADIENTS: Record<DocumentGradientKey, { from: string; to: string }> = {
  purchaseOrder:       { from: '#1D4E89', to: '#0EA5A5' }, // blue -> teal: procurement/materials
  proforma:            { from: '#3730A3', to: '#7C3AED' }, // indigo -> violet: sales quote
  paymentRequestLetter:{ from: '#0F766E', to: '#10B981' }, // teal -> emerald: money owed to us
  laborPayment:        { from: '#1B3A5C', to: '#0EA5E9' }, // navy -> sky: money we pay out
  vendorContract:      { from: '#334155', to: '#7E22CE' }, // slate -> purple: procurement-side legal
  bdContract:          { from: '#92400E', to: '#D97706' }, // amber -> gold: sales-side legal
}

export function gradientCss(key: DocumentGradientKey | { from: string; to: string }, angle = 135): string {
  const { from, to } = typeof key === 'string' ? DOCUMENT_GRADIENTS[key] : key
  return `linear-gradient(${angle}deg, ${from}, ${to})`
}

// Shared CSS for the HTML-string documents (built via template literals
// and printed through an iframe or a new window). Each document's own
// <style> block should include this alongside its document-specific
// rules (tables, line items, clause layout, etc).
export const documentBaseCss = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:${DOC_FONT}}
.doc-letterhead{display:flex;justify-content:space-between;align-items:flex-start;padding:18px 22px;border-radius:10px;margin-bottom:18px}
.doc-brand{display:flex;align-items:center;gap:10px}
.doc-logo{width:36px;height:36px;background:rgba(255,255,255,0.22);border-radius:6px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:14px;flex-shrink:0}
.doc-company{font-weight:900;font-size:15pt;color:#fff;letter-spacing:-0.3px}
.doc-address{font-size:8.5pt;color:rgba(255,255,255,0.78);margin-top:2px}
.doc-meta{text-align:right;font-size:9.5pt;color:rgba(255,255,255,0.85);line-height:1.6}
.doc-meta b{font-weight:700}
.doc-title{font-size:16pt;font-weight:900;color:#fff;letter-spacing:-0.5px}
.doc-hr{border:none;border-top:1.5px solid ${BRAND_NAVY};margin:10px 0 16px}
.doc-footer{margin-top:40px;font-size:9pt;color:#888;border-top:1px solid #ddd;padding-top:10px;display:flex;justify-content:space-between}
.doc-letterhead-centered{text-align:center;padding:18px 22px;border-radius:10px;margin-bottom:18px}
.doc-letterhead-centered .doc-logo{margin:0 auto 6px}
.doc-letterhead-centered .doc-company{font-size:16pt}
`

// Left logo+company, right doc title/meta — the "invoice" letterhead
// used by Purchase Order, Proforma Invoice, and the client Payment
// Request letter (mirrors ExpenseDetailPage's PrintInvoice header).
export function renderLetterhead(p: { docTitle: string; docCode?: string; metaLines?: string[]; gradient: DocumentGradientKey | { from: string; to: string } }): string {
  return `
<div class="doc-letterhead" style="background:${gradientCss(p.gradient)}">
  <div class="doc-brand">
    <div class="doc-logo">K</div>
    <div>
      <div class="doc-company">${COMPANY_NAME}</div>
      <div class="doc-address">${COMPANY_ADDRESS}</div>
    </div>
  </div>
  <div class="doc-meta">
    <div class="doc-title">${p.docTitle}</div>
    ${p.docCode ? `<div><b>${p.docCode}</b></div>` : ''}
    ${(p.metaLines ?? []).map(l => `<div>${l}</div>`).join('')}
  </div>
</div>`
}

// Centered letterhead for formal/legal documents — Vendor Contract and
// the BD contract print view.
export function renderCenteredLetterhead(p: { subtitle?: string; gradient: DocumentGradientKey }): string {
  return `
<div class="doc-letterhead-centered" style="background:${gradientCss(p.gradient)}">
  <div class="doc-logo">K</div>
  <div class="doc-company">${COMPANY_NAME}</div>
  <div class="doc-address">${COMPANY_ADDRESS}${p.subtitle ? ` &nbsp;|&nbsp; ${p.subtitle}` : ''}</div>
</div>`
}

export function renderFooter(refCode?: string): string {
  return `
<div class="doc-footer">
  <span>${COMPANY_NAME} &middot; ${COMPANY_ADDRESS}</span>
  <span>${refCode ? `Ref: ${refCode}` : ''}</span>
</div>`
}
