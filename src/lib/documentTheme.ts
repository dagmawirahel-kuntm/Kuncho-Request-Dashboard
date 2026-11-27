// Shared branding for every printable/exportable document in the app
// (purchase orders, proformas, invoices, payment requests, contracts).
// Single source of truth: the company's identity comes from the
// company_profile row (migrations 368, 369), loaded once and kept here so
// the synchronous HTML builders can read it.
//
// The look is Ethiopian heritage: a woven tibeb band frames each page,
// headings are set in a classical serif with their Amharic beneath, dates
// carry the Ethiopian calendar in Ge'ez script, and the palette is antique
// gold on white with one deep colour per kind of document. It is white
// paper throughout, so it prints well on an office printer.

import { formatEthiopian, toEthiopian } from '@/lib/ethiopianCalendar'
import { docSeasonPhase, type DocSeasonPhase } from '@/lib/seasons'

export const COMPANY_NAME = 'KUNCHO TRADING PLC'
export const COMPANY_ADDRESS = 'Addis Ababa, Ethiopia'
export const BRAND_NAVY = '#1B3A5C'
export const GOLD = '#A8832E'
export const INK = '#17150F'
export const DOC_FONT = '"Inter", "Helvetica Neue", Arial, "Noto Sans Ethiopic", "Nyala", sans-serif'
export const DOC_SERIF = '"Cormorant Garamond", "Noto Serif Ethiopic", Georgia, "Times New Roman", serif'
export const DOC_ETHIOPIC = '"Noto Serif Ethiopic", "Noto Sans Ethiopic", "Nyala", "Abyssinica SIL", serif'

/** A way to pay us: a bank account, or a telebirr merchant wallet, which has
 *  a short code and an operator ID instead of an account number. Rows saved
 *  before wallets existed have no `kind` and are bank accounts. */
export interface BankAccountLine {
  kind?: 'bank' | 'telebirr'
  bank: string
  account_name?: string | null
  account_number: string
  branch?: string | null
  swift?: string | null
  /** telebirr only */
  short_code?: string | null
  operator_id?: string | null
  on_documents?: boolean
}

export const isWallet = (a: BankAccountLine) => a.kind === 'telebirr'
/** A row complete enough to print: a bank with its number, or a wallet with its short code. */
export const isPayableLine = (a: BankAccountLine) =>
  isWallet(a) ? !!a.short_code?.trim() : !!(a.bank?.trim() && a.account_number?.trim())

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
  /** Migration 369 */
  tagline?: string | null
  bilingual_labels?: boolean
  /** Migration 390: discounts above this percentage need a second person's approval. */
  discount_approval_percent?: number | null
  /** Migration 540: documents dated in a festive season carry its mark (default on). */
  festive_documents?: boolean | null
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
  show_ethiopian_dates: true, footer_note: null, proforma_terms: null, bank_accounts: [], tagline: null, bilingual_labels: true,
}

let current: CompanyProfile = DEFAULT_PROFILE
/** Set by useCompanyProfile once the row loads. */
export function setDocumentProfile(p: CompanyProfile | null | undefined) { current = p ? { ...DEFAULT_PROFILE, ...p, bank_accounts: p.bank_accounts ?? [] } : DEFAULT_PROFILE }
export function docProfile(): CompanyProfile { return current }
export function companyName() { return current.legal_name || COMPANY_NAME }
export function companyAddress() { return current.address || COMPANY_ADDRESS }
const bilingual = () => current.bilingual_labels !== false

/** Everything typed by a person goes through this before it lands in a document. */
export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
/** Escaped, with line breaks kept. */
export function escLines(v: unknown): string { return esc(v).replace(/\r?\n/g, '<br/>') }

// ── Amharic ─────────────────────────────────────────────────────────────
// The labels a document uses, in Amharic. Shown under the English when the
// profile's bilingual labels are on.
const AM: Record<string, string> = {
  'No.': 'ቁጥር', 'Date': 'ቀን', 'Valid until': 'የሚያበቃበት ቀን', 'Due': 'የመክፈያ ቀን', 'Reference': 'ማጣቀሻ', 'Page': 'ገጽ',
  '#': 'ተ.ቁ', 'Description': 'መግለጫ', 'Qty': 'ብዛት', 'Unit': 'መለኪያ', 'Unit price': 'ነጠላ ዋጋ', 'Amount': 'ጠቅላላ ዋጋ',
  'Subtotal': 'ድምር', 'VAT': 'ተ.እ.ታ', 'Grand total': 'ጠቅላላ ድምር', 'Total due': 'የሚከፈል ጠቅላላ', 'Amount excl. VAT': 'ዋጋ ያለ ተ.እ.ታ',
  'Prepared for': 'ደንበኛ', 'Bill to': 'ደንበኛ', 'To': 'ለ', 'Vendor': 'አቅራቢ', 'Project': 'ፕሮጀክት',
  'Scope of work': 'የሥራ ወሰን', 'Not included': 'ያልተካተቱ', 'Notes': 'ማስታወሻ', 'Terms': 'ሁኔታዎች',
  'Payments to': 'የባንክ ሒሳብ', 'Please pay to': 'የባንክ ሒሳብ', 'In words': 'በፊደል',
  'Authorised signatory': 'የተፈቀደለት ፈራሚ', 'Received by': 'የተረከበው', 'Accepted by the client': 'የደንበኛ ማረጋገጫ',
  'Name': 'ስም', 'Signature': 'ፊርማ', 'Stamp': 'ማህተም', 'Thank you': 'እናመሰግናለን',
  'Procurement officer': 'የግዢ ባለሙያ', 'Approved by': 'ያጸደቀው', 'Expected delivery': 'የሚረከብበት ቀን',
  'Net payable': 'የሚከፈል የተጣራ',
  'Requested by': 'የጠየቀው', 'Needed by': 'የሚፈለግበት ቀን', 'Priority': 'አስቸኳይነት', 'Status': 'ሁኔታ', 'Estimated total': 'የተገመተ ጠቅላላ', 'Est. price': 'የተገመተ ዋጋ',
  'Sent': 'የተላከ', 'Received': 'የደረሰ', 'Damaged': 'የተበላሸ', 'Refused': 'ያልተቀበልነው', 'Accepted': 'የተቀበልነው',
  'Delivered to': 'የተረከበው ሳይት', 'Delivery': 'ርክክብ', 'Purchase order': 'የግዢ ትዕዛዝ',
}
/** An English label with its Amharic beneath, when bilingual labels are on. */
export function bi(en: string, am?: string): string {
  const a = am ?? AM[en]
  return bilingual() && a ? `${esc(en)}<span class="am">${esc(a)}</span>` : esc(en)
}
/** Just the Amharic, for inline use ("Grand total · ጠቅላላ ድምር"). */
export function amOf(en: string): string { return bilingual() ? (AM[en] ?? '') : '' }

const AM_MONTHS = ['መስከረም', 'ጥቅምት', 'ኅዳር', 'ታኅሣሥ', 'ጥር', 'የካቲት', 'መጋቢት', 'ሚያዝያ', 'ግንቦት', 'ሰኔ', 'ሐምሌ', 'ነሐሴ', 'ጳጉሜ']

/** "መስከረም 16 ቀን 2019 ዓ.ም." */
export function amharicDate(date: Date): string {
  const { year, month, day } = toEthiopian(date)
  return `${AM_MONTHS[month - 1]} ${day} ቀን ${year} ዓ.ም.`
}

/**
 * "26 Sep 2026 · መስከረም 16 ቀን 2019 ዓ.ም." — both calendars unless the
 * profile turns the Ethiopian one off; in Ge'ez script when labels are
 * bilingual, transliterated otherwise.
 */
export function docDate(d: string | Date | null | undefined): string {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d.length === 10 ? `${d}T00:00:00` : d) : d
  if (isNaN(date.getTime())) return ''
  const g = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  if (!current.show_ethiopian_dates) return g
  return bilingual() ? `${g} · ${amharicDate(date)}` : `${g} · ${formatEthiopian(date, true)} E.C.`
}

export function docMoney(n: number | null | undefined, currency = 'ETB'): string {
  const v = Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return currency ? `${currency} ${v}` : v
}

// ── Colour per kind of document ─────────────────────────────────────────
// One deep colour per document type, so it's clear at a glance what a page
// is, while every document shares the same frame, type and gold.
export type DocumentGradientKey =
  | 'purchaseOrder' | 'proforma' | 'paymentRequestLetter' | 'laborPayment'
  | 'vendorContract' | 'bdContract' | 'payroll' | 'invoice' | 'delivery' | 'purchaseRequest'

export const DOCUMENT_GRADIENTS: Record<DocumentGradientKey, { from: string; to: string }> = {
  purchaseOrder:       { from: '#7A3417', to: '#A6522B' }, // terracotta: materials bought
  proforma:            { from: '#23285E', to: '#3B3F8C' }, // lapis indigo: the quote
  paymentRequestLetter:{ from: '#0E5057', to: '#177580' }, // deep teal: money owed to us
  laborPayment:        { from: '#1B3A5C', to: '#2C5D8A' }, // navy: money we pay out
  vendorContract:      { from: '#3B2A55', to: '#5B437F' }, // aubergine: procurement-side legal
  bdContract:          { from: '#6B4210', to: '#8E5B1C' }, // coffee: sales-side legal
  payroll:             { from: '#6E1631', to: '#932346' }, // berry: salaries
  invoice:             { from: '#154734', to: '#1F6A4D' }, // forest green: the tax invoice
  delivery:            { from: '#4A4A12', to: '#6E6C22' }, // olive: goods received and delivered
  purchaseRequest:     { from: '#37474F', to: '#55707D' }, // slate: what a site or office asks to be bought
}

export function gradientCss(key: DocumentGradientKey | { from: string; to: string }, angle = 135): string {
  const { from, to } = typeof key === 'string' ? DOCUMENT_GRADIENTS[key] : key
  return `linear-gradient(${angle}deg, ${from}, ${to})`
}
const accentOf = (key: DocumentGradientKey | { from: string; to: string }) => (typeof key === 'string' ? DOCUMENT_GRADIENTS[key] : key).from

/**
 * A woven tibeb band: lozenges in the document's colour and gold between
 * gold rules, the border of a habesha kemis or netela. Greyscale when the
 * profile asks for the plain (toner-saving) style.
 */
export function tibeb(accent: string, height = 20): string {
  const plain = current.print_style === 'plain'
  const a = plain ? '#2a2a2a' : accent
  const g = plain ? '#9a9a9a' : GOLD
  const h = height, m = h / 2
  const big = Math.max(3, m - 3.2), small = big * 0.55, w = Math.round(big * 4 + 6)
  const id = `tb${h}${a.replace('#', '')}${plain ? 'p' : ''}`
  // One repeat: a lozenge in the document colour with a gold heart, a small
  // gold lozenge, between a gold rule and a hairline in the document colour.
  return `<svg class="doc-tibeb" width="100%" height="${h}" preserveAspectRatio="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<defs><pattern id="${id}" x="0" y="0" width="${w}" height="${h}" patternUnits="userSpaceOnUse">
<rect width="${w}" height="${h}" fill="#fff"/>
<rect y="0" width="${w}" height="1.6" fill="${g}"/><rect y="${h - 1.6}" width="${w}" height="1.6" fill="${g}"/>
<rect y="2.6" width="${w}" height="0.6" fill="${a}"/><rect y="${h - 3.2}" width="${w}" height="0.6" fill="${a}"/>
<path d="M1.5 ${m} L${1.5 + big} ${m - big} L${1.5 + 2 * big} ${m} L${1.5 + big} ${m + big}Z" fill="${a}"/>
<path d="M${1.5 + big - 1.6} ${m} L${1.5 + big} ${m - 1.6} L${1.5 + big + 1.6} ${m} L${1.5 + big} ${m + 1.6}Z" fill="${g}"/>
<path d="M${2 * big + 3.5} ${m} L${2 * big + 3.5 + small} ${m - small} L${2 * big + 3.5 + 2 * small} ${m} L${2 * big + 3.5 + small} ${m + small}Z" fill="${g}"/>
<circle cx="${w - 1.2}" cy="${m}" r="0.8" fill="${a}"/>
</pattern></defs><rect width="100%" height="${h}" fill="url(#${id})"/></svg>`
}

// ── The festive season on documents (lib/seasons.ts, docSeasonPhase) ──────
// A document dated in the season keeps a small mark of it for good: the
// tibeb band in Christmas red, green and gold with stars woven in, an
// ornament beside the title — a tree, the tree with the New Year, or the
// tree with the Ethiopian cross and a taper for Gena — and a dated greeting
// in the footer. The document's own date decides; Company & Documents
// can turn it off. The body of the document is never touched.

/** Which festive mark a document dated `date` carries, if any. */
export function festiveFor(date: string | Date | null | undefined): DocSeasonPhase | null {
  if (current.festive_documents === false) return null
  return docSeasonPhase(date ?? new Date())
}

/** The festive tibeb: red and green lozenges with gold hearts, a gold star
 *  between, gold rules. Greyscale in the monochrome print style. */
export function festiveTibeb(height = 20): string {
  const plain = current.print_style === 'plain'
  const r = plain ? '#2a2a2a' : '#C62828', gr = plain ? '#5a5a5a' : '#1E7A3C', g = plain ? '#9a9a9a' : GOLD
  const h = height, m = h / 2
  const big = Math.max(3, m - 3.2), sr = big * 0.85
  // lozenge · star · lozenge · star, 2 apart
  const l1 = 1.5, s1 = l1 + 2 * big + 2 + sr, l2 = s1 + sr + 2, s2 = l2 + 2 * big + 2 + sr
  const w = Math.round(s2 + sr + 1.5)
  const id = `ftb${h}${plain ? 'p' : ''}`
  const loz = (x: number, c: string) => `<path d="M${x} ${m} L${x + big} ${m - big} L${x + 2 * big} ${m} L${x + big} ${m + big}Z" fill="${c}"/><path d="M${x + big - 1.5} ${m} L${x + big} ${m - 1.5} L${x + big + 1.5} ${m} L${x + big} ${m + 1.5}Z" fill="${g}"/>`
  const star = (cx: number, rr: number) => {
    const pts = Array.from({ length: 10 }, (_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, q = i % 2 ? rr * 0.42 : rr
      return `${(cx + Math.cos(a) * q).toFixed(2)},${(m + Math.sin(a) * q).toFixed(2)}`
    })
    return `<path d="M${pts.join('L')}Z" fill="${g}"/>`
  }
  return `<svg class="doc-tibeb" width="100%" height="${h}" preserveAspectRatio="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<defs><pattern id="${id}" x="0" y="0" width="${w}" height="${h}" patternUnits="userSpaceOnUse">
<rect width="${w}" height="${h}" fill="#fff"/>
<rect y="0" width="${w}" height="1.6" fill="${g}"/><rect y="${h - 1.6}" width="${w}" height="1.6" fill="${g}"/>
<rect y="2.6" width="${w}" height="0.6" fill="${gr}"/><rect y="${h - 3.2}" width="${w}" height="0.6" fill="${r}"/>
${loz(l1, r)}${star(s1, sr)}${loz(l2, gr)}${star(s2, sr)}
</pattern></defs><rect width="100%" height="${h}" fill="url(#${id})"/></svg>`
}

/** The tree, in a document's colours (or greys). */
function treeSvg(plain: boolean): string {
  const green = plain ? '#555' : '#1E7A3C', red = plain ? '#222' : '#C62828', gold = plain ? '#999' : '#C9A227', trunk = plain ? '#777' : '#7a4a22'
  const baubles = [[44, 42, red], [57, 50, gold], [38, 64, gold], [55, 68, red], [33, 86, red], [48, 90, gold], [64, 86, red]]
  return `<rect x="45" y="98" width="10" height="13" rx="1.5" fill="${trunk}"/>`
    + `<path d="M50 18 L78 54 L62 54 L84 80 L66 80 L90 102 L10 102 L34 80 L16 80 L38 54 L22 54 Z" fill="${green}"/>`
    + `<path d="M30 56 Q50 66 70 54 M24 80 Q50 94 78 80" fill="none" stroke="${gold}" stroke-width="1.6"/>`
    + baubles.map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="3.8" fill="${c}"/>`).join('')
    + `<path d="M50 4 L52.6 11.4 L60.4 11.4 L54.1 16 L56.5 23.4 L50 18.8 L43.5 23.4 L45.9 16 L39.6 11.4 L47.4 11.4Z" fill="${gold}"/>`
}

/** The ornament beside the title for a festive phase. */
function festiveMark(phase: DocSeasonPhase): string {
  const plain = current.print_style === 'plain'
  const gold = plain ? '#999' : '#A8832E', wax = plain ? '#ddd' : '#e6d29a', flame = plain ? '#888' : '#F59E0B'
  if (phase === 'christmas') {
    return `<svg class="doc-festive-mark" viewBox="0 0 100 114" width="44" height="50" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">${treeSvg(plain)}</svg>`
  }
  if (phase === 'newyear') {
    return `<svg class="doc-festive-mark" viewBox="0 0 150 114" width="58" height="44" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">${treeSvg(plain)}`
      + `<text x="122" y="70" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="26" font-weight="800" fill="${gold}">2027</text>`
      + [[98, 46], [146, 46], [104, 84], [140, 84], [122, 34]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.4" fill="${gold}"/>`).join('')
      + `</svg>`
  }
  // Gena: the tree, the Ethiopian cross and a lit taper, together.
  const cross = `<g transform="translate(104 30)"><path d="M18 0v36M0 18h36" stroke="${gold}" stroke-width="3.4" stroke-linecap="round"/>`
    + [[18, -3], [-3, 18], [39, 18], [18, 39]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" fill="${gold}"/>`).join('')
    + `<rect x="13.5" y="13.5" width="9" height="9" transform="rotate(45 18 18)" fill="#fff" stroke="${gold}" stroke-width="1.8"/></g>`
  const taper = `<rect x="160" y="60" width="7" height="44" rx="2" fill="${wax}"/><path d="M163.5 38 C169 45 169.5 50 168 53 C167 55 165.4 56 163.5 56 C161.6 56 160 55 159 53 C157.5 50 158 45 163.5 38Z" fill="${flame}"/>`
  return `<svg class="doc-festive-mark" viewBox="0 0 172 114" width="66" height="44" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">${treeSvg(plain)}${cross}${taper}</svg>`
}

/** The dated greeting kept in the footer of a festive document. */
function keepsakeLine(phase: DocSeasonPhase): string {
  const am = bilingual() ? ' &middot; <span class="am">እንኳን ለብርሃነ ልደቱ በሰላም አደረሳችሁ</span>' : ''
  const lead = phase === 'christmas' ? 'Season’s greetings &middot; Merry Christmas'
    : phase === 'newyear' ? 'Happy New Year 2027 &middot; Season’s greetings'
    : 'Melkam Gena'
  return `<div class="doc-keepsake">★ ${lead} &middot; Christmas 2026 &middot; Gena ${bilingual() ? '፳፻፲፱ ዓ.ም.' : '2019 E.C.'}${am}</div>`
}

// Shared CSS for the HTML-string documents (built via template literals
// and printed through an iframe or a new window). Include it in each
// document's <style> block, then the document's own rules. The fonts are
// declared directly (Google's woff2 files, latin and Ethiopic only) rather
// than through a stylesheet import, so a slow network never holds up the
// page: it draws at once in the fallback fonts and swaps when they arrive.
//
// Print rules live here so every document gets them: colours are kept,
// table headers repeat on each page, rows don't split across a page, and
// pages are numbered where the browser supports it.
export const documentBaseCss = `
@font-face{font-family:'Cormorant Garamond';font-style:normal;font-weight:500 700;font-display:swap;src:url(https://fonts.gstatic.com/s/cormorantgaramond/v21/co3bmX5slCNuHLi8bLeY9MK7whWMhyjYqXtK.woff2) format('woff2');unicode-range:U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD}
@font-face{font-family:'Inter';font-style:normal;font-weight:400 700;font-display:swap;src:url(https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2) format('woff2');unicode-range:U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD}
@font-face{font-family:'Noto Serif Ethiopic';font-style:normal;font-weight:400 700;font-display:swap;src:url(https://fonts.gstatic.com/s/notoserifethiopic/v32/V8muoR7-XjwJ8_Au3Ti5tXj5Rd83frpWLK4d-taxqWw2HMWjDzpdq2VXTQ.woff2) format('woff2');unicode-range:U+030E, U+1200-1399, U+2D80-2DDE, U+AB01-AB2E, U+1E7E0-1E7E6, U+1E7E8-1E7EB, U+1E7ED-1E7EE, U+1E7F0-1E7FE}
*{box-sizing:border-box;margin:0;padding:0}
html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:${DOC_FONT};color:${INK};font-variant-numeric:tabular-nums}
.am{display:block;font-family:${DOC_ETHIOPIC};font-size:.82em;font-weight:500;letter-spacing:0;text-transform:none;opacity:.8;margin-top:1px}
.serif{font-family:${DOC_SERIF}}
.doc-tibeb{display:block;width:100%}
.doc-bg-logo{position:fixed;top:50%;left:50%;width:62%;max-width:420px;transform:translate(-50%,-50%);opacity:.035;z-index:0;pointer-events:none}
.doc-head{position:relative;margin-bottom:16px}
.doc-head-row{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;padding:14px 2px 10px}
.doc-brand{display:flex;align-items:center;gap:14px;min-width:0}
.doc-logo{width:54px;height:54px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-family:${DOC_SERIF};font-weight:700;font-size:26px;flex-shrink:0;border:2px solid ${GOLD}}
.doc-logo-img{height:62px;max-width:120px;object-fit:contain;flex-shrink:0}
.doc-company{font-family:${DOC_SERIF};font-weight:700;font-size:21pt;line-height:1.05;letter-spacing:.06em;color:${INK}}
.doc-company-am{font-family:${DOC_ETHIOPIC};font-size:11.5pt;font-weight:600;color:${GOLD};margin-top:3px;letter-spacing:.02em}
.doc-tagline{font-size:8pt;letter-spacing:.22em;text-transform:uppercase;color:#6b6453;margin-top:4px}
.doc-titleblock{text-align:right;flex-shrink:0;min-width:220px}
.doc-title{font-family:${DOC_SERIF};font-size:19pt;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--acc);line-height:1.05}
.doc-title-am{font-family:${DOC_ETHIOPIC};font-size:11pt;font-weight:600;color:${GOLD};margin-top:2px}
.doc-metatable{margin:8px 0 0 auto;border-collapse:collapse;font-size:8.8pt}
.doc-metatable td{padding:2px 0 2px 12px;border:none !important;background:none !important;vertical-align:top}
.doc-metatable td.k{color:#7a735f;text-align:right;font-size:7.8pt;text-transform:uppercase;letter-spacing:.08em}
.doc-metatable td.k .am{font-size:.95em;text-transform:none;letter-spacing:0}
.doc-metatable td.v{text-align:right;font-weight:600;color:${INK}}
.doc-meta-line{font-size:8.8pt;color:#4a4536;text-align:right;margin-top:2px}
.doc-identity{display:flex;justify-content:space-between;gap:14px;font-size:8pt;color:#5b5545;padding:6px 2px 8px;border-top:1px solid ${GOLD};border-bottom:3px double ${GOLD}}
.doc-identity b{color:${INK};font-weight:600}
.doc-letterhead-centered{text-align:center;margin-bottom:18px}
.doc-letterhead-centered .doc-center{padding:14px 0 10px}
.doc-letterhead-centered .doc-logo,.doc-letterhead-centered .doc-logo-img{margin:0 auto 8px}
.doc-h{font-family:${DOC_SERIF};font-size:12.5pt;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--acc);margin:14px 0 6px;display:flex;align-items:baseline;gap:8px}
.doc-h::before{content:"";width:7px;height:7px;background:${GOLD};transform:rotate(45deg);flex-shrink:0;align-self:center}
.doc-h .am{display:inline;font-size:.78em;color:${GOLD};opacity:1;margin:0 0 0 4px}
.doc-salute{font-size:10pt;line-height:1.65;margin:4px 0 12px;color:#2b281f}
.doc-party{display:flex;gap:24px;justify-content:space-between;margin:4px 0 14px;font-size:9.8pt;line-height:1.5}
.doc-party .box{border-left:3px solid ${GOLD};padding:2px 0 2px 10px}
.doc-party .lbl{color:#7a735f;font-size:7.8pt;text-transform:uppercase;letter-spacing:.12em;margin-bottom:3px}
.doc-party .lbl .am{display:inline;margin-left:6px;letter-spacing:0;text-transform:none}
.doc-party b{font-weight:600;color:${INK}}
.doc-party .name{display:block;font-family:${DOC_SERIF};font-size:13pt;font-weight:700;color:${INK};font-variant-numeric:lining-nums}
.doc-table{width:100%;border-collapse:collapse;margin:6px 0 14px;font-size:9.3pt}
.doc-table thead th{background:var(--acc);color:#fff;padding:7px 8px 6px;text-align:left;font-weight:600;font-size:8pt;letter-spacing:.06em;text-transform:uppercase;border-bottom:2px solid ${GOLD};vertical-align:bottom}
.doc-table thead th .am{color:#f3e7c8;opacity:.95;text-transform:none;letter-spacing:0;font-size:.95em}
.doc-table td{padding:6px 8px;border-bottom:1px solid #e9e3d3;vertical-align:top}
.doc-table tbody tr:nth-child(even) td{background:#fbf9f3}
.doc-table .r{text-align:right;white-space:nowrap}.doc-table .c{text-align:center}
.doc-table tr.sec td{background:#f5efe0 !important;font-family:${DOC_SERIF};font-weight:700;font-size:11pt;color:var(--acc);border-bottom:1px solid #dccfa9;letter-spacing:.03em}
.doc-table tr.sec td.c{color:${GOLD}}
.doc-table tr.secsub td{font-weight:600;color:var(--acc);background:#fff !important;border-bottom:1.5px solid #dccfa9;font-size:8.8pt}
.doc-totals{margin:0 0 0 auto;width:370px;border-collapse:collapse;font-size:9.6pt;break-inside:avoid}
.doc-totals td{padding:5px 10px;border:none}
.doc-totals td:last-child{font-family:${DOC_FONT};white-space:nowrap;font-variant-numeric:lining-nums tabular-nums}
.doc-totals td .am{display:inline;margin-left:6px;font-size:.85em}
.doc-totals tr.grand td{background:var(--acc);color:#fff;font-family:${DOC_SERIF};font-weight:700;font-size:14pt;padding:8px 10px;border-top:2px solid ${GOLD}}
.doc-totals tr.grand td:last-child{font-family:${DOC_FONT};font-size:12pt;letter-spacing:.01em}
.doc-totals tr.grand td .am{color:#f3e7c8;opacity:1}
.doc-words{margin:8px 0 12px auto;max-width:520px;text-align:right;font-family:${DOC_SERIF};font-style:italic;font-size:11pt;color:#3b3628;border-right:3px solid ${GOLD};padding:2px 10px 2px 0}
.doc-words .lbl{font-family:${DOC_FONT};font-style:normal;font-size:7.6pt;letter-spacing:.12em;text-transform:uppercase;color:#7a735f}
.doc-blocks{display:grid;grid-template-columns:1fr 1fr;gap:10px 22px;font-size:9.3pt;line-height:1.55}
.doc-terms{font-size:9pt;line-height:1.6;color:#2b281f;padding-left:18px}
.doc-terms li{margin-bottom:2px}
.doc-banks{margin-top:14px;font-size:9.2pt;border:1px solid #dccfa9;background:#fdfbf6;padding:9px 12px;break-inside:avoid}
.doc-banks .lbl{color:#7a735f;font-size:7.8pt;text-transform:uppercase;letter-spacing:.12em;margin-bottom:5px}
.doc-banks .lbl .am{display:inline;margin-left:6px;letter-spacing:0;text-transform:none}
.doc-banks table{width:100%;border-collapse:collapse;margin:0}
.doc-banks td{padding:2px 8px 2px 0;border:none;background:none !important;font-size:9.2pt}
.doc-banks td.acct{text-align:right;font-family:"Inter",monospace;font-weight:600;letter-spacing:.04em;white-space:nowrap}
.doc-banks td.aux{white-space:nowrap}
.doc-signoff{display:flex;justify-content:space-between;align-items:flex-end;gap:22px;margin-top:30px;break-inside:avoid}
.doc-sign{min-width:210px;position:relative}
.doc-sign .line{border-top:1px solid ${INK};padding-top:5px;font-size:9.2pt;margin-top:6px}
.doc-sign .line .am{display:inline;margin-left:4px}
.doc-sign .sig-img{height:54px;max-width:200px;object-fit:contain;display:block}
.doc-sign .stamp-img{position:absolute;left:120px;top:-22px;height:86px;opacity:.85}
.doc-sign .muted{color:#7a735f;font-size:8.2pt}
.doc-accept{border:1px dashed #cdbd8e;padding:10px 12px;font-size:8.8pt;color:#4a4536;min-width:250px}
.doc-accept .t{font-family:${DOC_SERIF};font-weight:700;font-size:11pt;color:var(--acc);margin-bottom:6px}
.doc-accept .t .am{display:inline;margin-left:6px;color:${GOLD}}
.doc-accept .row{display:flex;gap:8px;margin-top:10px}
.doc-accept .row span{flex:1;border-top:1px solid #9a927c;padding-top:2px;font-size:7.8pt;color:#7a735f}
.doc-verify{display:flex;align-items:center;gap:10px;font-size:7.8pt;color:#6b6453;max-width:260px;break-inside:avoid}
.doc-verify img{width:72px;height:72px;flex-shrink:0;border:1px solid #e9e3d3;padding:3px;background:#fff}
.doc-verify-internal{display:block;margin-bottom:2px;font-size:7.4pt;letter-spacing:.1em;text-transform:uppercase;color:#8a2d1a}
.doc-verify-internal .am{letter-spacing:0;text-transform:none}
.doc-festive-wrap{display:flex;align-items:flex-start;gap:12px;flex-shrink:0}
.doc-festive-mark{flex:none;display:block;margin-top:2px}
.doc-letterhead-centered{position:relative}
.doc-letterhead-centered .doc-festive-mark{position:absolute;right:4px;top:28px}
.doc-keepsake{font-size:8pt;color:#8a6d1f;margin:2px 0 6px;letter-spacing:.02em}
.doc-keepsake .am{font-family:${DOC_ETHIOPIC};color:#8a6d1f}
.doc-footer{margin-top:26px;font-size:7.8pt;color:#7a735f;break-inside:avoid}
.doc-footer .row{display:flex;justify-content:space-between;gap:12px;padding-top:6px}
.doc-footer .thanks{font-family:${DOC_SERIF};font-style:italic;font-size:10pt;color:var(--acc)}
.doc-footer .thanks .am{display:inline;margin-left:6px;font-style:normal;color:${GOLD}}
.doc-watermark{position:fixed;top:42%;left:0;right:0;text-align:center;font-family:${DOC_SERIF};font-size:92pt;font-weight:700;letter-spacing:.1em;color:rgba(0,0,0,0.045);transform:rotate(-24deg);pointer-events:none;z-index:0}
.doc-hr{border:none;border-top:1px solid ${GOLD};margin:10px 0 14px}
table{page-break-inside:auto}
thead{display:table-header-group}
tfoot{display:table-footer-group}
tr,td,th{break-inside:avoid;page-break-inside:avoid}
@page{size:A4;@bottom-right{content:"Page " counter(page) " of " counter(pages);font:7.5pt Inter,Arial,sans-serif;color:#9a927c}}
/* Opened as a file or a link on a screen: a page-width sheet with margins,
   and on a phone the blocks stack and wide tables scroll sideways. */
@media screen{html{background:#efece4}body{max-width:210mm;margin:0 auto;padding:14mm 12mm !important;background:#fff;min-height:100vh}}
@media screen and (max-width:720px){
  body{padding:16px 12px !important;font-size:10pt}
  .doc-head-row,.doc-party,.doc-signoff,.doc-identity,.doc-footer .row{flex-direction:column;align-items:stretch;gap:10px}
  .doc-titleblock{text-align:left;min-width:0}.doc-metatable{margin-left:0}.doc-metatable td.k,.doc-metatable td.v{text-align:left}
  .doc-party > div[style]{text-align:left !important}
  .doc-company{font-size:17pt}.doc-title{font-size:15pt}
  .doc-table{display:block;overflow-x:auto;-webkit-overflow-scrolling:touch;white-space:nowrap}
  .doc-table td{white-space:normal;min-width:64px}
  .doc-totals{width:100%}.doc-words{max-width:none}
  .doc-blocks{grid-template-columns:1fr}
  .doc-sign .stamp-img{left:auto;right:0}
  .doc-verify{max-width:none}
}
`

function logoHtml(accent: string): string {
  return current.logo_data_url
    ? `<img class="doc-logo-img" src="${esc(current.logo_data_url)}" alt=""/>`
    : `<div class="doc-logo" style="background:${current.print_style === 'plain' ? INK : accent}">${esc(companyName().trim().charAt(0) || 'K')}</div>`
}
function bgLogo(): string {
  return current.logo_data_url ? `<img class="doc-bg-logo" src="${esc(current.logo_data_url)}" alt=""/>` : ''
}

/** Address and contacts on the left, TIN and VAT registration on the right. */
function identityRow(): string {
  const p = current
  const contact = [p.address || COMPANY_ADDRESS, p.po_box ? `P.O. Box ${p.po_box}` : null, p.phone, p.email, p.website].filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ')
  const tax = [p.tin ? `TIN <b>${esc(p.tin)}</b>` : null, p.vat_reg_no ? `VAT Reg. No. <b>${esc(p.vat_reg_no)}</b>` : null].filter(Boolean).join(' &nbsp;·&nbsp; ')
  return `<div class="doc-identity"><span>${contact}</span><span>${tax}</span></div>`
}

/** Amharic titles for the documents we send, by their English title. */
const TITLE_AM: Record<string, string> = {
  'PROFORMA INVOICE': 'የዋጋ ማቅረቢያ', 'TAX INVOICE': 'የታክስ ደረሰኝ', 'INVOICE': 'የሽያጭ ደረሰኝ',
  'PURCHASE ORDER': 'የግዢ ትዕዛዝ', 'PAYMENT REQUEST': 'የክፍያ ጥያቄ', 'PURCHASE REQUEST': 'የግዢ ጥያቄ',
  'GOODS RECEIVED NOTE': 'የንብረት መረከቢያ', 'SITE DELIVERY NOTE': 'የሳይት ርክክብ ማስታወሻ',
}

// Brand on the left, the document's title (with its Amharic) and its
// number / dates on the right, all framed by the tibeb band and a double
// gold rule. docTitle/metaLines are trusted markup built by the caller;
// anything user-typed in them must already be escaped. `meta` is the tidy
// form: [English label, value] pairs, the label getting its Amharic.
export function renderLetterhead(p: {
  docTitle: string; docTitleAm?: string; docCode?: string; metaLines?: string[]
  meta?: [string, string][]
  gradient: DocumentGradientKey | { from: string; to: string }
  /** The document's own date: in a festive season it carries the season's mark. */
  date?: string | Date | null
}): string {
  const festive = festiveFor(p.date)
  const acc = accentOf(p.gradient)
  const accent = current.print_style === 'plain' ? INK : acc
  const titleAm = bilingual() ? (p.docTitleAm ?? TITLE_AM[p.docTitle.replace(/<[^>]+>/g, '').trim()] ?? '') : ''
  const rows: [string, string][] = [...(p.docCode ? [['No.', esc(p.docCode)] as [string, string]] : []), ...(p.meta ?? [])]
  return `
<style>:root{--acc:${accent}}</style>
${bgLogo()}
<header class="doc-head">
  ${festive ? festiveTibeb() : tibeb(acc)}
  <div class="doc-head-row">
    <div class="doc-brand">
      ${logoHtml(acc)}
      <div>
        <div class="doc-company">${esc(companyName())}</div>
        ${current.legal_name_am ? `<div class="doc-company-am">${esc(current.legal_name_am)}</div>` : ''}
        ${current.tagline ? `<div class="doc-tagline">${esc(current.tagline)}</div>` : ''}
      </div>
    </div>
    ${festive ? `<div class="doc-festive-wrap">${festiveMark(festive)}` : ''}<div class="doc-titleblock">
      <div class="doc-title">${p.docTitle}</div>
      ${titleAm ? `<div class="doc-title-am">${esc(titleAm)}</div>` : ''}
      ${rows.length ? `<table class="doc-metatable">${rows.map(([k, v]) => `<tr><td class="k">${bi(k)}</td><td class="v">${v}</td></tr>`).join('')}</table>` : ''}
      ${(p.metaLines ?? []).map(l => `<div class="doc-meta-line">${l}</div>`).join('')}
    </div>${festive ? '</div>' : ''}
  </div>
  ${identityRow()}
</header>`
}

// Centered letterhead for formal/legal documents — Vendor Contract and
// the BD contract print view.
export function renderCenteredLetterhead(p: { subtitle?: string; gradient: DocumentGradientKey; date?: string | Date | null }): string {
  const festive = festiveFor(p.date)
  const acc = accentOf(p.gradient)
  const accent = current.print_style === 'plain' ? INK : acc
  return `
<style>:root{--acc:${accent}}</style>
${bgLogo()}
<header class="doc-letterhead-centered">
  ${festive ? festiveTibeb() + festiveMark(festive) : tibeb(acc)}
  <div class="doc-center">
    ${logoHtml(acc)}
    <div class="doc-company">${esc(companyName())}</div>
    ${current.legal_name_am ? `<div class="doc-company-am">${esc(current.legal_name_am)}</div>` : ''}
    ${current.tagline ? `<div class="doc-tagline">${esc(current.tagline)}</div>` : ''}
    ${p.subtitle ? `<div class="doc-tagline" style="margin-top:6px">${esc(p.subtitle)}</div>` : ''}
  </div>
  ${identityRow()}
</header>`
}

/** A section heading with its Amharic: ◆ SCOPE OF WORK የሥራ ወሰን */
export function renderHeading(en: string, am?: string): string {
  const a = am ?? amOf(en)
  return `<div class="doc-h">${esc(en)}${a && bilingual() ? `<span class="am">${esc(a)}</span>` : ''}</div>`
}

export function renderFooter(refCode?: string, accent?: string, date?: string | Date | null): string {
  const p = current
  const festive = festiveFor(date)
  return `
<footer class="doc-footer">
  <div class="thanks">Thank you for your trust${bilingual() ? '<span class="am">እናመሰግናለን</span>' : ''}</div>
  ${festive ? keepsakeLine(festive) + festiveTibeb(14) : tibeb(accent ?? BRAND_NAVY, 14)}
  <div class="row">
    <span>${esc(companyName())} &middot; ${esc(companyAddress())}${p.tin ? ` &middot; TIN ${esc(p.tin)}` : ''}${p.footer_note ? `<br/>${esc(p.footer_note)}` : ''}</span>
    <span>${refCode ? `Ref: ${esc(refCode)}` : ''}</span>
  </div>
</footer>`
}

/** "Prepared for" block with the client's TIN, and anything to show alongside. */
export function renderParty(p: { label: string; name: string; tin?: string | null; lines?: (string | null | undefined)[]; right?: string }): string {
  return `
<div class="doc-party">
  <div class="box">
    <div class="lbl">${esc(p.label)}${amOf(p.label) ? `<span class="am">${esc(amOf(p.label))}</span>` : ''}</div>
    <b class="name">${esc(p.name)}</b>
    ${(p.lines ?? []).filter(Boolean).map(l => `<div>${esc(l)}</div>`).join('')}
    ${p.tin ? `<div>TIN: <b>${esc(p.tin)}</b></div>` : ''}
  </div>
  ${p.right ? `<div style="text-align:right">${p.right}</div>` : ''}
</div>`
}

/** The accounts and telebirr wallets marked "on documents" in the company
 *  profile. `only` limits it to one of the two. */
export function renderBankAccounts(title = 'Please pay to', only?: 'bank' | 'telebirr'): string {
  const accts = current.bank_accounts.filter(a => a.on_documents !== false && isPayableLine(a)
    && (!only || (only === 'telebirr') === isWallet(a)))
  if (!accts.length) return ''
  const am = !accts.some(isWallet) ? amOf(title)
    : bilingual() ? (accts.every(isWallet) ? 'ቴሌብር' : 'የባንክ ሒሳብ እና ቴሌብር') : ''
  const row = (a: BankAccountLine) => isWallet(a)
    ? `<tr><td><b>telebirr</b> merchant</td><td>${esc(a.account_name || companyName())}</td><td class="acct">Short code ${esc(a.short_code)}</td>${a.operator_id ? `<td class="aux">Operator ID ${esc(a.operator_id)}</td>` : ''}</tr>`
    : `<tr><td><b>${esc(a.bank)}</b>${a.branch ? `, ${esc(a.branch)}` : ''}</td><td>${esc(a.account_name || companyName())}</td><td class="acct">${esc(a.account_number)}</td>${a.swift ? `<td class="aux">SWIFT ${esc(a.swift)}</td>` : ''}</tr>`
  return `
<div class="doc-banks">
  <div class="lbl">${esc(title)}${am ? `<span class="am">${esc(am)}</span>` : ''}</div>
  <table>${accts.map(row).join('')}</table>
</div>`
}

/** The total in words, framed with a gold rule. */
export function renderWords(words: string): string {
  if (!words) return ''
  return `<div class="doc-words"><div class="lbl">${bilingual() ? 'In words · በፊደል' : 'In words'}</div>${esc(words)}</div>`
}

export interface VerifyInfo { url: string; qrDataUrl: string; version?: number }

/**
 * The signature block, with the signature and stamp when the person
 * printing may use them; a received-by or client-acceptance block beside
 * it; and the verification QR on the right.
 */
export function renderSignoff(p: { forLabel?: string; signoff?: CompanySignoff | null; preparedBy?: string | null; verify?: VerifyInfo | null; receivedBy?: boolean; acceptance?: string | null; acceptanceWhat?: string }): string {
  const s = p.signoff
  const sign = `
  <div class="doc-sign">
    ${s?.signature_data_url ? `<img class="sig-img" src="${esc(s.signature_data_url)}" alt=""/>` : '<div style="height:54px"></div>'}
    ${s?.stamp_data_url ? `<img class="stamp-img" src="${esc(s.stamp_data_url)}" alt=""/>` : ''}
    <div class="line"><b>${esc(s?.signatory_name || 'Authorised signatory')}</b>${s?.signatory_title ? `, ${esc(s.signatory_title)}` : ''}${!s?.signatory_name && bilingual() ? '<span class="am">የተፈቀደለት ፈራሚ</span>' : ''}<br/><span class="muted">For ${esc(p.forLabel ?? companyName())}</span></div>
    ${p.preparedBy ? `<div class="muted" style="margin-top:4px">Prepared by ${esc(p.preparedBy)}</div>` : ''}
  </div>`
  const received = p.receivedBy ? `
  <div class="doc-sign"><div style="height:54px"></div><div class="line">Received by (name, signature, date)${bilingual() ? '<span class="am">የተረከበው</span>' : ''}</div></div>` : ''
  const accept = p.acceptance ? `
  <div class="doc-accept">
    <div class="t">Accepted by the client${bilingual() ? '<span class="am">የደንበኛ ማረጋገጫ</span>' : ''}</div>
    <div>We accept ${esc(p.acceptanceWhat ?? 'this offer')} on behalf of <b>${esc(p.acceptance)}</b>.</div>
    <div class="row"><span>Name${bilingual() ? ' · ስም' : ''}</span><span>Signature${bilingual() ? ' · ፊርማ' : ''}</span></div>
    <div class="row"><span>Date${bilingual() ? ' · ቀን' : ''}</span><span>Stamp${bilingual() ? ' · ማህተም' : ''}</span></div>
  </div>` : ''
  return `<div class="doc-signoff">${sign}${received}${accept}${p.verify ? renderVerify(p.verify) : ''}</div>`
}

export function renderVerify(v: VerifyInfo): string {
  return `
<div class="doc-verify">
  <img src="${v.qrDataUrl}" alt="QR"/>
  <div><b class="doc-verify-internal">QR code for internal use only${bilingual() ? '<span class="am">ለውስጥ አገልግሎት ብቻ</span>' : ''}</b>Scan to check this document is genuine${v.version && v.version > 1 ? ` (version ${v.version})` : ''}.<br/><span style="word-break:break-all;color:#9a927c">${esc(v.url)}</span></div>
</div>`
}
