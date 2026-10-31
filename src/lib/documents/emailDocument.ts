import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Emailing a document from the app (migration 460, edge function
// send-document): it goes as an .html attachment under a short note, from
// the address set up in Settings → Notifications, with replies to the sender.

export interface DocumentEmail {
  id: string
  recipients: string[]
  cc: string[]
  status: 'queued' | 'sent' | 'failed'
  error: string | null
  created_at: string
  sent_at: string | null
}

export interface EmailDocumentRequest {
  kind: string
  sourceId: string | null
  /** An issued copy is sent exactly as filed; otherwise `html` is sent. */
  issuedId?: string | null
  html?: string
  title: string
  fileName: string
  to: string[]
  cc: string[]
  subject: string
  message: string
}

/** Split "a@x.com, b@y.com; c@z.com" into addresses. */
export const splitAddresses = (s: string) => s.split(/[\s,;]+/).map(x => x.trim()).filter(Boolean)
export const isEmail = (s: string) => /^[^@\s<>,;"]+@[^@\s<>,;"]+\.[^@\s<>,;"]{2,}$/.test(s)

export async function emailDocument(r: EmailDocumentRequest): Promise<{ to: string[]; cc: string[] }> {
  const { data, error } = await supabase.functions.invoke('send-document', {
    body: {
      kind: r.kind, source_id: r.sourceId, issued_id: r.issuedId ?? null, html: r.issuedId ? undefined : r.html,
      title: r.title, file_name: r.fileName, to: r.to, cc: r.cc, subject: r.subject, message: r.message,
    },
  })
  const out = (data ?? {}) as { ok?: boolean; error?: string; to?: string[]; cc?: string[] }
  if (error || !out.ok) {
    let msg = out.error ?? error?.message ?? 'The email did not go'
    try { const body = await (error as { context?: Response })?.context?.json?.(); if (body?.error) msg = body.error } catch { /* keep msg */ }
    throw new Error(msg)
  }
  return { to: out.to ?? r.to, cc: out.cc ?? r.cc }
}

/** Whether an admin has set up email (a Resend key and a sender). */
export function useEmailReady() {
  return useQuery({
    queryKey: ['document-email-ready'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('document_email_ready')
      if (error) throw error
      return !!data
    },
  })
}

/** The last few times this document was emailed. */
export function useDocumentEmails(kind: string, sourceId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['document-emails', kind, sourceId],
    enabled: enabled && !!sourceId,
    queryFn: async () => {
      const { data, error } = await supabase.from('document_emails')
        .select('id, recipients, cc, status, error, created_at, sent_at')
        .eq('doc_kind', kind).eq('source_id', sourceId!).order('created_at', { ascending: false }).limit(5)
      if (error) throw error
      return (data ?? []) as DocumentEmail[]
    },
  })
}
