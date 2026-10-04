import { useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { AlertTriangle, BadgeCheck, Printer, XCircle } from 'lucide-react'
import { DocumentFrame } from '@/components/documents/DocumentFrame'

interface Verified {
  doc_type: string; doc_number: string | null; version: number; latest_version: number | null
  title: string | null; party_name: string | null; total: number | null; currency: string
  status: 'issued' | 'superseded' | 'void'; issued_at: string; void_reason: string | null
  company_name: string | null; html: string | null
}

const TYPE_LABEL: Record<string, string> = {
  proforma: 'Proforma invoice', invoice: 'Invoice', client_payment_request: 'Payment request', purchase_order: 'Purchase order',
}

/**
 * The page behind a document's QR code and share link (migration 368). No
 * sign-in: it shows whether the document is genuine and current, and the
 * exact copy that was issued, ready to print or save as a PDF.
 */
export default function VerifyDocumentPage() {
  const { token } = useParams<{ token: string }>()
  const frame = useRef<HTMLIFrameElement>(null)
  const { data, isLoading, isError } = useQuery({
    queryKey: ['verify-document', token],
    enabled: !!token,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('verify_document', { p_token: token! })
      if (error) throw error
      return ((data ?? []) as Verified[])[0] ?? null
    },
  })

  const newer = data && data.latest_version != null && data.latest_version > data.version
  const tone = !data ? 'red' : data.status === 'void' ? 'red' : data.status === 'superseded' || newer ? 'amber' : 'green'
  const box = { green: 'border-emerald-200 bg-emerald-50 text-emerald-900', amber: 'border-amber-200 bg-amber-50 text-amber-900', red: 'border-red-200 bg-red-50 text-red-900' }[tone]
  const Icon = tone === 'green' ? BadgeCheck : tone === 'amber' ? AlertTriangle : XCircle

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-6 text-slate-800">
      <div className="mx-auto max-w-4xl space-y-4">
        {isLoading ? <p className="py-20 text-center text-sm text-slate-500">Checking the document…</p>
          : isError || !data ? (
            <div className={`flex items-start gap-3 rounded-xl border p-4 ${box}`}>
              <XCircle className="mt-0.5 h-6 w-6 shrink-0" />
              <div>
                <p className="font-bold">We couldn't find this document</p>
                <p className="text-sm">The link or QR code doesn't match anything we've issued. If someone sent you this document, check it with them directly before acting on it.</p>
              </div>
            </div>
          ) : (
            <>
              <div className={`flex flex-wrap items-start gap-3 rounded-xl border p-4 ${box}`}>
                <Icon className="mt-0.5 h-6 w-6 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-bold">
                    {data.status === 'void' ? 'This document has been cancelled'
                      : data.status === 'superseded' || newer ? `Genuine, but there is a newer version (version ${data.latest_version})`
                      : `Genuine ${TYPE_LABEL[data.doc_type]?.toLowerCase() ?? 'document'} from ${data.company_name ?? 'us'}`}
                  </p>
                  <p className="text-sm">
                    {TYPE_LABEL[data.doc_type] ?? 'Document'} {data.doc_number ?? ''}{data.version > 1 ? ` · version ${data.version}` : ''}
                    {data.party_name ? ` · for ${data.party_name}` : ''}
                    {data.total != null ? ` · ${data.currency} ${Number(data.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : ''}
                    {` · issued ${new Date(data.issued_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`}
                  </p>
                  {data.status === 'void' && data.void_reason && <p className="mt-1 text-sm">Reason: {data.void_reason}</p>}
                  {(data.status === 'superseded' || newer) && data.status !== 'void' && <p className="mt-1 text-sm">Ask {data.company_name ?? 'the sender'} for the latest version before acting on this one.</p>}
                </div>
                {data.html && (
                  <button onClick={() => { frame.current?.contentWindow?.focus(); frame.current?.contentWindow?.print() }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700">
                    <Printer className="h-4 w-4" /> Print / PDF
                  </button>
                )}
              </div>
              {data.html && (
                <div className="overflow-hidden rounded-xl border bg-white shadow">
                  <DocumentFrame ref={frame} html={data.html} title="Document" sandbox="allow-same-origin allow-modals" className="h-[80vh]" />
                </div>
              )}
            </>
          )}
      </div>
    </div>
  )
}
