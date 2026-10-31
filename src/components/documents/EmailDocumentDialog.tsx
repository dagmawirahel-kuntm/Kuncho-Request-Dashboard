import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Mail, Paperclip } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useCompanyProfile } from '@/lib/companyProfile'
import { formatDateTime } from '@/lib/utils'
import { ActionDialog } from '@/components/shared/ActionDialog'
import { emailDocument, isEmail, splitAddresses, useDocumentEmails, useEmailReady } from '@/lib/documents/emailDocument'

const field = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const label = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300'
export const emailBtn = 'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700'

// "Proforma PF-01" → "proforma PF-01" mid-sentence; "VAT…" and "PO…" stay.
const inSentence = (t: string) => (/^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t)
const asSubject = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

export interface EmailDocumentProps {
  /** What it is, for the log: 'proforma', 'variation', 'ledger_statement'… */
  kind: string
  sourceId: string | null
  /** "Variation order VO-03" — used in the subject and the note. */
  title: string
  fileName: string
  party?: string | null
  defaultTo?: string | null
  /** The page to send, built when Send is pressed: an issued copy's id, or the html. */
  prepare: () => Promise<{ issuedId?: string; html?: string }> | { issuedId?: string; html?: string }
  onSent?: (to: string[]) => void
}

/**
 * Email a document from the app: to whom, a subject and a short note; the
 * document goes attached as an .html file (migration 460).
 */
export function EmailDocumentDialog({ kind, sourceId, title, fileName, party, defaultTo, prepare, onSent, onClose }: EmailDocumentProps & { onClose: () => void }) {
  const { profile, role } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: company } = useCompanyProfile()
  const { data: ready, isLoading } = useEmailReady()
  const { data: history = [] } = useDocumentEmails(kind, sourceId)
  const companyName = company?.legal_name ?? ''
  const [to, setTo] = useState(defaultTo ?? '')
  const [copyMe, setCopyMe] = useState(!!profile?.email)
  const [subject, setSubject] = useState(`${asSubject(title)}${companyName ? ` — ${companyName}` : ''}`)
  const [message, setMessage] = useState(
    `Dear ${party?.trim() || 'Sir / Madam'},\n\nPlease find attached our ${inSentence(title)}.\n\nKind regards,\n${profile?.full_name ?? ''}${companyName ? `\n${companyName}` : ''}`)
  const [busy, setBusy] = useState(false)

  const addresses = splitAddresses(to)
  const bad = addresses.filter(a => !isEmail(a))
  const cc = copyMe && profile?.email && !addresses.some(a => a.toLowerCase() === profile.email!.toLowerCase()) ? [profile.email] : []
  const canSend = !!ready && addresses.length > 0 && bad.length === 0 && addresses.length + cc.length <= 6 && !!subject.trim()

  async function send() {
    setBusy(true)
    try {
      const page = await prepare()
      const r = await emailDocument({ kind, sourceId, issuedId: page.issuedId, html: page.html, title, fileName, to: addresses, cc, subject: subject.trim(), message })
      toast(`Emailed to ${r.to.join(', ')}`, 'success')
      qc.invalidateQueries({ queryKey: ['document-emails', kind, sourceId] })
      onSent?.(r.to)
      onClose()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally { setBusy(false) }
  }

  return (
    <ActionDialog title={`Email ${title}`} confirmLabel="Send email" busy={busy} canConfirm={canSend} onClose={onClose} onConfirm={send}
      description="It goes attached as a file that opens in any browser. Replies come to you.">
      {!isLoading && !ready && (
        <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Email isn't set up yet. An admin adds the sending address in{' '}
            {role === 'admin' ? <Link to="/settings/notifications" className="font-semibold underline">Settings → Notifications</Link> : <b>Settings → Notifications</b>}.
          </span>
        </div>
      )}
      <div>
        <label className={label} htmlFor="email-to">To</label>
        <input id="email-to" inputMode="email" autoComplete="email" autoFocus value={to} onChange={e => setTo(e.target.value)} placeholder="client@example.com" className={field} />
        <p className={`mt-1 text-[11px] ${bad.length ? 'text-red-600' : 'text-slate-400'}`}>
          {bad.length ? `Not an email address: ${bad.join(', ')}` : addresses.length + cc.length > 6 ? 'Six addresses at most' : 'Several? Separate them with commas.'}
        </p>
      </div>
      {profile?.email && (
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={copyMe} onChange={e => setCopyMe(e.target.checked)} /> Send me a copy <span className="text-xs text-slate-400">({profile.email})</span>
        </label>
      )}
      <div>
        <label className={label} htmlFor="email-subject">Subject</label>
        <input id="email-subject" value={subject} onChange={e => setSubject(e.target.value)} maxLength={200} className={field} />
      </div>
      <div>
        <label className={label} htmlFor="email-message">Message</label>
        <textarea id="email-message" rows={8} value={message} onChange={e => setMessage(e.target.value)} maxLength={4000} className={field} />
      </div>
      <p className="flex items-center gap-1.5 rounded-md bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
        <Paperclip className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{fileName}.html</span>
      </p>
      {history.length > 0 && (
        <ul className="space-y-0.5 border-t pt-2 text-[11px] text-slate-500 dark:border-slate-700">
          {history.map(h => (
            <li key={h.id} className={h.status === 'failed' ? 'text-red-600' : ''}>
              {h.status === 'failed' ? 'Did not go' : h.status === 'queued' ? 'Sending' : 'Emailed'} {formatDateTime(h.created_at)} to {h.recipients.join(', ')}
              {h.status === 'failed' && h.error ? ` — ${h.error}` : ''}
            </li>
          ))}
        </ul>
      )}
    </ActionDialog>
  )
}

/** An Email button that opens the dialog. */
export function EmailDocumentButton({ disabled, className = emailBtn, ...props }: EmailDocumentProps & { disabled?: boolean; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} disabled={disabled} className={className} title="Email the document from the app">
        <Mail className="h-4 w-4" /> Email
      </button>
      {open && <EmailDocumentDialog {...props} onClose={() => setOpen(false)} />}
    </>
  )
}
