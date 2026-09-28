import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, FileClock, Mail, MessageCircle, Printer, Share2, ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { formatDateTime } from '@/lib/utils'
import { ActionDialog } from '@/components/shared/ActionDialog'
import { Pill } from '@/components/record/Record'
import type { VerifyInfo } from '@/lib/documentTheme'
import { canIssue, issueDocument, printHtml, verifyUrl, type IssuedDocType, type IssuedDocument } from '@/lib/documents/issue'

const btn = 'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700'
const field = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'

/**
 * Print / share / issued copies for one outgoing document. Printing or
 * sharing files the document in the register (migration 368) with a QR
 * code that proves it's ours; printing the same content again reuses the
 * stored copy, and changed content becomes the next version.
 */
export function DocumentActions({ type, sourceId, number, title, party, partyEmail, partyPhone, total, build, disabled, compact }: {
  type: IssuedDocType
  sourceId: string
  number: string | null
  title: string
  party: string | null
  partyEmail?: string | null
  partyPhone?: string | null
  total: number | null
  build: (verify: VerifyInfo | null) => string
  disabled?: boolean
  compact?: boolean
}) {
  const { role } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const allowed = canIssue(type, role)
  const [busy, setBusy] = useState<null | 'print' | 'share'>(null)
  const [shared, setShared] = useState<{ doc: IssuedDocument; url: string } | null>(null)
  const [copiesOpen, setCopiesOpen] = useState(false)
  const fileName = [number, title, party].filter(Boolean).join(' - ')

  const { data: copies = [] } = useQuery({
    queryKey: ['issued-documents', type, sourceId],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase.from('issued_documents')
        .select('id, doc_type, source_id, doc_number, version, title, party_name, total, currency, content_hash, verify_token, status, issued_by, issued_at, sent_to, sent_via, sent_at, void_reason')
        .eq('doc_type', type).eq('source_id', sourceId).order('version', { ascending: false })
      if (error) throw error
      return (data ?? []) as IssuedDocument[]
    },
  })

  async function issue() {
    const r = await issueDocument({ type, sourceId, number, title, party, total, build })
    qc.invalidateQueries({ queryKey: ['issued-documents', type, sourceId] })
    if (r.isNew && r.doc.version > 1) toast(`Filed as version ${r.doc.version}; the earlier copy is marked superseded`, 'info')
    return r
  }

  async function print() {
    setBusy('print')
    try {
      if (!allowed) { printHtml(build(null), fileName); return }
      const r = await issue()
      printHtml(r.html, fileName)
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(null) }
  }
  async function share() {
    setBusy('share')
    try { const r = await issue(); setShared({ doc: r.doc, url: r.url }) } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(null) }
  }

  return (
    <>
      <button onClick={print} disabled={disabled || !!busy} className={btn} title="Print, or choose Save as PDF in the print dialog">
        <Printer className="h-4 w-4" /> {busy === 'print' ? 'Preparing…' : compact ? 'Print' : 'Print / PDF'}
      </button>
      {allowed && (
        <button onClick={share} disabled={disabled || !!busy} className={btn}>
          <Share2 className="h-4 w-4" /> {busy === 'share' ? 'Preparing…' : 'Share'}
        </button>
      )}
      {allowed && copies.length > 0 && (
        <button onClick={() => setCopiesOpen(true)} className={btn} title="Every copy issued">
          <FileClock className="h-4 w-4" /> {compact ? copies.length : `Issued (${copies.length})`}
        </button>
      )}
      {shared && (
        <ShareDialog doc={shared.doc} url={shared.url} title={`${title}${number ? ` ${number}` : ''}`} party={party} email={partyEmail} phone={partyPhone}
          onClose={() => setShared(null)} onSent={() => qc.invalidateQueries({ queryKey: ['issued-documents', type, sourceId] })} />
      )}
      {copiesOpen && <CopiesDialog copies={copies} onClose={() => setCopiesOpen(false)} onChanged={() => qc.invalidateQueries({ queryKey: ['issued-documents', type, sourceId] })} />}
    </>
  )
}

function ShareDialog({ doc, url, title, party, email, phone, onClose, onSent }: {
  doc: IssuedDocument; url: string; title: string; party: string | null; email?: string | null; phone?: string | null
  onClose: () => void; onSent: () => void
}) {
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)
  const [to, setTo] = useState(email ?? phone ?? '')
  const [via, setVia] = useState<'email' | 'whatsapp' | 'telegram' | 'by hand'>(email ? 'email' : 'whatsapp')
  const [busy, setBusy] = useState(false)
  const message = `Dear ${party ?? 'Sir / Madam'},\n\nPlease find our ${title} at the link below. You can view, print or save it as a PDF, and check it is genuine.\n\n${url}\n\nKind regards`
  const waNumber = (phone ?? '').replace(/[^\d]/g, '').replace(/^0/, '251')

  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { toast('Copy failed — select the link and copy it', 'error') }
  }
  async function markSent() {
    setBusy(true)
    const { error } = await supabase.rpc('mark_document_sent', { p_id: doc.id, p_sent_to: to.trim() || null, p_via: via })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Marked as sent', 'success')
    onSent(); onClose()
  }

  return (
    <ActionDialog title={`Share ${title}`} confirmLabel="Mark as sent" busy={busy} onClose={onClose} onConfirm={markSent}
      description={`Version ${doc.version} · anyone with the link can view it and check it's genuine.`}>
      <div className="flex gap-2">
        <input readOnly value={url} onFocus={e => e.target.select()} className={`${field} font-mono text-xs`} aria-label="Share link" />
        <button onClick={copy} className={btn}>{copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}</button>
      </div>
      <div className="flex flex-wrap gap-2">
        <a href={`https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer" onClick={() => setVia('whatsapp')} className={btn}>
          <MessageCircle className="h-4 w-4 text-emerald-600" /> WhatsApp
        </a>
        <a href={`mailto:${encodeURIComponent(email ?? '')}?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(message)}`} onClick={() => setVia('email')} className={btn}>
          <Mail className="h-4 w-4 text-brand" /> Email
        </a>
        <a href={url} target="_blank" rel="noreferrer" className={btn}><ShieldCheck className="h-4 w-4" /> Open</a>
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2 border-t pt-3 dark:border-slate-700">
        <input value={to} onChange={e => setTo(e.target.value)} placeholder="Sent to (email, phone or name)" className={field} aria-label="Sent to" />
        <select value={via} onChange={e => setVia(e.target.value as typeof via)} className={field} aria-label="Sent by">
          <option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="telegram">Telegram</option><option value="by hand">By hand</option>
        </select>
      </div>
    </ActionDialog>
  )
}

function CopiesDialog({ copies, onClose, onChanged }: { copies: IssuedDocument[]; onClose: () => void; onChanged: () => void }) {
  const { toast } = useToast()
  const [voiding, setVoiding] = useState<IssuedDocument | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function open(c: IssuedDocument) {
    window.open(verifyUrl(c.verify_token), '_blank', 'noreferrer')
  }
  async function doVoid() {
    if (!voiding) return
    setBusy(true)
    const { error } = await supabase.rpc('void_issued_document', { p_id: voiding.id, p_reason: reason })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`Version ${voiding.version} is void — its QR code now says so`, 'success')
    setVoiding(null); setReason(''); onChanged()
  }

  if (voiding) {
    return (
      <ActionDialog title={`Void version ${voiding.version}`} confirmLabel="Void it" danger busy={busy} canConfirm={!!reason.trim()}
        onClose={() => setVoiding(null)} onConfirm={doVoid}
        description="Anyone who scans its QR code or opens its link will be told it's no longer valid.">
        <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Why, e.g. sent with the wrong price" autoFocus className={field} />
      </ActionDialog>
    )
  }
  return (
    <ActionDialog title="Issued copies" confirmLabel="Close" onClose={onClose} onConfirm={onClose}
      description="Every version that was printed or shared, exactly as it went out.">
      <ul className="max-h-80 divide-y overflow-y-auto text-sm dark:divide-slate-700">
        {copies.map(c => (
          <li key={c.id} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-slate-800 dark:text-slate-100">Version {c.version} <span className="ml-1"><Pill tone={c.status === 'issued' ? 'green' : c.status === 'void' ? 'red' : 'slate'}>{c.status}</Pill></span></p>
              <p className="text-xs text-slate-500">
                {formatDateTime(c.issued_at)}{c.sent_at ? ` · sent ${c.sent_via ? `by ${c.sent_via} ` : ''}${c.sent_to ? `to ${c.sent_to}` : ''}` : ''}{c.void_reason ? ` · ${c.void_reason}` : ''}
              </p>
            </div>
            <button onClick={() => open(c)} className="text-xs text-brand hover:underline">View</button>
            {c.status !== 'void' && <button onClick={() => setVoiding(c)} className="text-xs text-slate-500 hover:text-red-600">Void</button>}
          </li>
        ))}
      </ul>
    </ActionDialog>
  )
}
