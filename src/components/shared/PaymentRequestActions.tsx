// Payment Request toolbar — preview, print, download, and issue.
//
// Shared by ExpenseDetailPage (a single labor draft) and
// BatchPaymentDetailPage (a batch), which previously each carried their
// own `hidden print:block` copy of the document plus a bare
// `window.print()` button. That approach printed whatever the page state
// happened to be, kept no record, and pulled the surrounding dashboard
// chrome into the browser's print stylesheet.
//
// Printing now goes through an iframe holding only the document, so what
// comes out of the printer is exactly what is previewed — and exactly
// what gets frozen into payment_requests.document_html when it is issued.

import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Printer, Download, Save, X, ExternalLink, History } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import { amountInWords } from '@/lib/amountInWords'
import {
  buildLaborPaymentRequestHtml, buildPaymentRequestSnapshot, buildPayeeLines, totalHeadcount,
  type LaborPaymentRequestInput,
} from '@/lib/laborPaymentRequestDocument'
import { StatusBadge } from '@/components/shared/StatusBadge'

type SavedPr = {
  id: string
  request_code: string | null
  revision: number
  status: string
  issued_at: string
  issued_by_name: string | null
  total_amount: number | null
}

interface Props {
  sourceType: 'expense' | 'batch_payment'
  sourceId: string
  /** Everything the document needs, minus the fields only issuing can fill in. */
  document: Omit<LaborPaymentRequestInput, 'documentCode' | 'status' | 'revision'>
  /** Rendered inline in the page's action row; the preview opens in a modal. */
  compact?: boolean
}

export function PaymentRequestActions({ sourceType, sourceId, document: doc, compact }: Props) {
  const { toast } = useToast()
  const { role } = useAuth()
  const qc = useQueryClient()
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState('')

  const canIssue = role === 'admin' || role === 'executive' || role === 'finance'

  const { data: saved = [] } = useQuery({
    queryKey: ['payment-requests-for-source', sourceType, sourceId],
    queryFn: async () => {
      const col = sourceType === 'expense' ? 'expense_id' : 'batch_payment_id'
      const { data, error } = await supabase
        .from('v_payment_requests')
        .select('id, request_code, revision, status, issued_at, issued_by_name, total_amount')
        .eq(col, sourceId)
        .order('revision', { ascending: false })
      if (error) throw error
      return (data ?? []) as SavedPr[]
    },
    enabled: !!sourceId,
  })

  const live = saved.find(p => p.status === 'issued') ?? null

  // The preview always renders from current data. Once issued, the stored
  // copy is the authority — so a live PR is shown at its own code and
  // revision, and re-issuing after an edit produces revision + 1 rather
  // than quietly redefining what that code meant.
  const input: LaborPaymentRequestInput = useMemo(() => ({
    ...doc,
    documentCode: live?.request_code ?? null,
    status: live ? 'issued' : 'draft',
    revision: live?.revision,
  }), [doc, live])

  const html = useMemo(() => buildLaborPaymentRequestHtml(input), [input])
  const payees = useMemo(() => buildPayeeLines(doc.workers), [doc.workers])
  const heads = useMemo(() => totalHeadcount(doc.workers), [doc.workers])

  const issue = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('save_payment_request', {
        p_source_type: sourceType,
        p_source_id: sourceId,
        p_document_html: html,
        p_snapshot: buildPaymentRequestSnapshot(input),
        p_payee_lines: payees,
        // The register row is titled after what the request actually is: a
        // fuel or rent request filed as a "Labor Payment Request" is the
        // same mislabelling as the worker-shaped document it came from.
        p_title: doc.kind === 'batch'
          ? 'Batch Labor Payment Request'
          : doc.breakdownKind === 'line_items'
            ? `${doc.typeLabel ?? 'Expense'} Payment Request`
            : 'Labor Payment Request',
        p_total_amount: doc.total,
        p_amount_in_words: amountInWords(doc.total),
        // A vendor billing line items has no workers behind it; the stand-in
        // payee line would otherwise register as a headcount of 1.
        p_worker_count: doc.breakdownKind === 'line_items' ? 0 : heads,
        p_draft_count: doc.drafts.length || 1,
        p_period_start: doc.drafts.map(d => d.periodStart).filter(Boolean).sort()[0] ?? null,
        p_period_end: doc.drafts.map(d => d.periodEnd).filter(Boolean).sort().slice(-1)[0] ?? null,
        p_project_names: Array.from(new Set(doc.drafts.map(d => d.projectName).filter(Boolean))),
        p_notes: notes.trim() || null,
      })
      if (error) throw new Error(error.message)
      return data as { request_code: string; revision: number }
    },
    onSuccess: (row) => {
      toast(
        row.revision > 1
          ? `Issued ${row.request_code} (revision ${row.revision}) — the previous version was superseded`
          : `Payment Request ${row.request_code} saved`,
        'success',
      )
      setNotes('')
      qc.invalidateQueries({ queryKey: ['payment-requests-for-source', sourceType, sourceId] })
      qc.invalidateQueries({ queryKey: ['payment-requests'] })
    },
    onError: (e: Error) => toast(e.message, 'error'),
  })

  // Print the iframe, not the page: the document carries its own @page
  // rules and none of the dashboard's layout.
  function handlePrint() {
    const win = frameRef.current?.contentWindow
    if (!win) { toast('Preview is still loading', 'error'); return }
    win.focus()
    win.print()
  }

  function handleDownload() {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = window.document.createElement('a')
    a.href = url
    a.download = `${live?.request_code ?? doc.sourceCode ?? 'payment-request'}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
      >
        <FileText className="h-3.5 w-3.5" />
        {compact ? 'Payment Request' : 'Payment Request'}
        {live?.request_code && (
          <span className="font-mono text-[11px] text-slate-400">{live.request_code}</span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-5xl h-[92vh] flex flex-col rounded-xl bg-white dark:bg-slate-800 shadow-xl border dark:border-slate-700 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-3 px-5 py-3 border-b dark:border-slate-700 flex-shrink-0">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  Payment Request
                  {live
                    ? <span className="font-mono text-xs text-brand">{live.request_code} · rev {live.revision}</span>
                    : <span className="text-[11px] uppercase tracking-wide text-slate-400">not yet issued</span>}
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {formatCurrency(doc.total)} · {heads} worker{heads === 1 ? '' : 's'} · {payees.length} payee{payees.length === 1 ? '' : 's'}
                </p>
              </div>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Preview */}
            <div className="flex-1 min-h-0 bg-slate-100 dark:bg-slate-900">
              <iframe
                ref={frameRef}
                srcDoc={html}
                title="Payment Request preview"
                className="w-full h-full border-0 bg-white"
              />
            </div>

            {/* Prior versions — a re-issue supersedes rather than replaces,
                so the trail belongs where someone is about to re-issue. */}
            {saved.length > 0 && (
              <div className="flex-shrink-0 px-5 py-2 border-t dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40">
                <div className="flex items-center gap-2 flex-wrap text-[11px]">
                  <History className="h-3 w-3 text-slate-400" />
                  <span className="text-slate-500 dark:text-slate-400">Issued:</span>
                  {saved.map(p => (
                    <Link
                      key={p.id}
                      to={`/finance/payment-requests/${p.id}`}
                      className="flex items-center gap-1 rounded-full border dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-0.5 hover:border-brand"
                      title={`${p.issued_by_name ?? 'Unknown'} · ${formatDateTime(p.issued_at)}`}
                    >
                      <span className="font-mono text-slate-600 dark:text-slate-300">{p.request_code}</span>
                      <span className="text-slate-400">rev {p.revision}</span>
                      <StatusBadge status={p.status} />
                      <ExternalLink className="h-2.5 w-2.5 text-slate-300" />
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex-shrink-0 flex items-center justify-between gap-3 flex-wrap px-5 py-3 border-t dark:border-slate-700">
              <div className="flex items-center gap-2">
                <button onClick={handlePrint} className="flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700">
                  <Printer className="h-3.5 w-3.5" /> Print
                </button>
                <button onClick={handleDownload} className="flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700">
                  <Download className="h-3.5 w-3.5" /> Download
                </button>
              </div>

              {canIssue && (
                <div className="flex items-center gap-2">
                  <input
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder={live ? 'Why is this being re-issued?' : 'Note (optional)'}
                    className="w-56 rounded-md border px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                  <button
                    onClick={() => issue.mutate()}
                    disabled={issue.isPending}
                    className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-60"
                  >
                    <Save className="h-3.5 w-3.5" />
                    {issue.isPending ? 'Saving…' : live ? 'Re-issue (new revision)' : 'Save Payment Request'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
