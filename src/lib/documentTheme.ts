// Shared branding for every printable/exportable document in the app
// (purchase orders, invoices, payment requests, contracts). Single
// source of truth so a rebrand or address change happens in one place
// instead of drifting across half a dozen hand-rolled HTML templates.

export const COMPANY_NAME = 'KUNCHO TRADING PLC'
export const COMPANY_ADDRESS = 'Addis Ababa, Ethiopia'
export const BRAND_NAVY = '#1B3A5C'
export const DOC_FONT = 'Arial, Helvetica, sans-serif'

// Shared CSS for the HTML-string documents (built via template literals
// and printed through an iframe or a new window). Each document's own
// <style> block should include this alongside its document-specific
// rules (tables, line items, clause layout, etc).
export const documentBaseCss = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:${DOC_FONT}}
.doc-letterhead{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px}
.doc-brand{display:flex;align-items:center;gap:10px}
.doc-logo{width:36px;height:36px;background:${BRAND_NAVY};border-radius:6px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:14px;flex-shrink:0}
.doc-company{font-weight:900;font-size:15pt;color:${BRAND_NAVY};letter-spacing:-0.3px}
.doc-address{font-size:8.5pt;color:#999;margin-top:2px}
.doc-meta{text-align:right;font-size:9.5pt;color:#555;line-height:1.6}
.doc-meta b{font-weight:700}
.doc-title{font-size:16pt;font-weight:900;color:${BRAND_NAVY};letter-spacing:-0.5px}
.doc-hr{border:none;border-top:1.5px solid ${BRAND_NAVY};margin:10px 0 16px}
.doc-footer{margin-top:40px;font-size:9pt;color:#888;border-top:1px solid #ddd;padding-top:10px;display:flex;justify-content:space-between}
.doc-letterhead-centered{text-align:center;padding-bottom:4mm;margin-bottom:5mm;border-bottom:2.5px double ${BRAND_NAVY}}
.doc-letterhead-centered .doc-logo{margin:0 auto 6px}
.doc-letterhead-centered .doc-company{font-size:16pt}
`

// Left logo+company, right doc title/meta — the "invoice" letterhead
// used by Purchase Order, Proforma Invoice, and the client Payment
// Request letter (mirrors ExpenseDetailPage's PrintInvoice header).
export function renderLetterhead(p: { docTitle: string; docCode?: string; metaLines?: string[] }): string {
  return `
<div class="doc-letterhead">
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
</div>
<hr class="doc-hr"/>`
}

// Centered letterhead for formal/legal documents — Vendor Contract and
// the BD contract print view.
export function renderCenteredLetterhead(subtitle?: string): string {
  return `
<div class="doc-letterhead-centered">
  <div class="doc-logo">K</div>
  <div class="doc-company">${COMPANY_NAME}</div>
  <div class="doc-address">${COMPANY_ADDRESS}${subtitle ? ` &nbsp;|&nbsp; ${subtitle}` : ''}</div>
</div>`
}

export function renderFooter(refCode?: string): string {
  return `
<div class="doc-footer">
  <span>${COMPANY_NAME} &middot; ${COMPANY_ADDRESS}</span>
  <span>${refCode ? `Ref: ${refCode}` : ''}</span>
</div>`
}
