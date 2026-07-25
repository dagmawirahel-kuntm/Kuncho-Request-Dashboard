import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ExternalLink } from 'lucide-react'

/**
 * Opens a file held in a PRIVATE storage bucket.
 *
 * Tax receipt images live in the private 'tax-documents' bucket, so what
 * is stored on the row is the storage PATH, not a URL — a public URL
 * would 403. This mints a short-lived signed URL at click time instead.
 *
 * Tolerates rows that still hold a full URL (e.g. one pasted in by hand
 * via the upload widget's "paste URL" escape hatch) by opening those
 * directly rather than trying to sign them.
 */
export function PrivateDocLink({
  path,
  bucket = 'tax-documents',
  title = 'View document',
  className = 'text-slate-400 hover:text-brand',
}: {
  path: string
  bucket?: string
  title?: string
  className?: string
}) {
  const [busy, setBusy] = useState(false)

  async function open() {
    if (/^https?:\/\//i.test(path)) {
      window.open(path, '_blank', 'noopener,noreferrer')
      return
    }
    setBusy(true)
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60)
    setBusy(false)
    if (error || !data) return
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <button type="button" onClick={open} disabled={busy} title={title} className={`${className} disabled:opacity-50`}>
      <ExternalLink className="h-3.5 w-3.5" />
    </button>
  )
}
