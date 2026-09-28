import QRCode from 'qrcode'
import { supabase } from '@/lib/supabase'
import type { VerifyInfo } from '@/lib/documentTheme'

export type IssuedDocType = 'proforma' | 'invoice' | 'client_payment_request' | 'purchase_order'

export interface IssuedDocument {
  id: string
  doc_type: IssuedDocType
  source_id: string
  doc_number: string | null
  version: number
  title: string | null
  party_name: string | null
  total: number | null
  currency: string
  content_hash: string
  html: string | null
  verify_token: string
  status: 'issued' | 'superseded' | 'void'
  issued_by: string | null
  issued_at: string
  sent_to: string | null
  sent_via: string | null
  sent_at: string | null
  void_reason: string | null
}

/** Roles that can file each kind of document (can_issue_document, migration 368). */
export function canIssue(type: IssuedDocType, role: string | null | undefined) {
  const r = role ?? ''
  return type === 'purchase_order' ? ['admin', 'executive', 'finance', 'procurement_officer'].includes(r) : ['admin', 'executive', 'finance'].includes(r)
}

export const verifyUrl = (token: string) => `${window.location.origin}/verify/${token}`

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function verifyInfoFor(token: string, version?: number): Promise<VerifyInfo> {
  const url = verifyUrl(token)
  const qrDataUrl = await QRCode.toDataURL(url, { margin: 0, width: 220, errorCorrectionLevel: 'M' })
  return { url, qrDataUrl, version }
}

/**
 * File a document in the register and get back the exact copy to print or
 * share. `build(null)` is the content without the QR — its hash decides
 * whether this is the same document as last time (the stored copy is
 * returned) or a new version. `build(verify)` is the page that is kept.
 */
export async function issueDocument(p: {
  type: IssuedDocType
  sourceId: string
  number: string | null
  title: string
  party: string | null
  total: number | null
  build: (verify: VerifyInfo | null) => string
}): Promise<{ doc: IssuedDocument; html: string; url: string; isNew: boolean }> {
  const hash = await sha256(p.build(null))
  const { data, error } = await supabase.rpc('issue_document', {
    p_doc_type: p.type, p_source_id: p.sourceId, p_doc_number: p.number, p_title: p.title,
    p_party_name: p.party, p_total: p.total, p_content_hash: hash,
  })
  if (error) throw error
  const doc = data as IssuedDocument
  if (doc.html) return { doc, html: doc.html, url: verifyUrl(doc.verify_token), isNew: false }
  const verify = await verifyInfoFor(doc.verify_token, doc.version)
  const html = p.build(verify)
  const { error: e2 } = await supabase.rpc('store_issued_document_html', { p_id: doc.id, p_html: html })
  if (e2) throw e2
  return { doc: { ...doc, html }, html, url: verify.url, isNew: true }
}

/** Print a finished page through a hidden frame; the title becomes the PDF's file name. */
export function printHtml(html: string, fileName: string) {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' })
  const titled = /<title>/i.test(html) ? html.replace(/<title>[^<]*<\/title>/i, `<title>${fileName.replace(/[<>&]/g, '')}</title>`)
    : html.replace(/<head>/i, `<head><title>${fileName.replace(/[<>&]/g, '')}</title>`)
  frame.srcdoc = titled
  frame.onload = () => {
    const w = frame.contentWindow
    if (!w) return
    // Chrome names the PDF after the top document's title, not the frame's.
    const before = document.title
    document.title = fileName
    w.focus()
    w.print()
    setTimeout(() => { document.title = before; frame.remove() }, 1000)
  }
  document.body.appendChild(frame)
}
