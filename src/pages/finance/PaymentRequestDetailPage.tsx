// A single archived Payment Request.
//
// This page deliberately does NOT rebuild the document from live tables.
// It replays payment_requests.document_html exactly as it was issued —
// that is the whole point of saving it. If a rate was corrected or a
// staff record merged after issue, this still shows what was authorised,
// and the correction lives in a later revision.

import { useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Printer, Download, Ban, Layers, Receipt, ExternalLink } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDateTime, formatDateGC } from '@/lib/utils'
import { StatusBadge } from '@/components/shared/StatusBadge'
import type { PaymentRequestRecord } from '@/types/database'

export default function PaymentRequestDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { role } = useAuth()
  const qc = useQueryClient()
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState('')

  const canVoid = role === 'admin' || role === 'finance'

  const { data: pr, isLoading } = useQuery({
    queryKey: ['payment-request', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('payment_requests').select('*').eq('id', id!).single()
      if (error) throw error
      return data as PaymentRequestRecord
    },
    enabled: !!id,
  })

  // Sibling revisions against the same source, so the trail is walkable
  // in both directions rather than only backwards via supersedes_id.
  const { data: siblings = [] } = useQuery({
    queryKey: ['payment-request-siblings', pr?.expense_id, pr?.batch_payment_id],
    queryFn: async () => {
      const col = pr!.source_type === 'expense' ? 'expense_id' : 'batch_payment_id'
      const val = pr!.source_type === 'expense' ? pr!.expense_id : pr!.batch_payment_id
      const { data, error } = await supabase
        .from('v_payment_requests')
        .select('id, request_code, revision, status, issued_at')
        .eq(col, val!)
        .order('revision', { ascending: false })
      if (error) throw error
      return (data ?? []) as { id: string; request_code: string | null; revision: number; status: string; issued_at: string }[]
    },
    enabled: !!pr,
  })

  const voidMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('void_payment_request', {
        p_payment_request_id: id!,
        p_reason: reason.trim(),
      })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      toast('Payment Request voided', 'success')
      setVoiding(false); setReason('')
      qc.invalidateQueries({ queryKey: ['payment-request', id] })
      qc.invalidateQueries({ queryKey: ['payment-requests'] })
    },
    onError: (e: Error) => toast(e.message, 'error'),
  })

  function printDoc() {
    const frame = window.document.getElementById('pr-archive-frame') as HTMLIFrameElement | null
    if (!frame?.contentWindow) { toast('Document is still loading', 'error'); return }
    frame.contentWindow.focus()
    frame.contentWindow.print()
  }

  function downloadDoc() {
    if (!pr) return
    const blob = new Blob([pr.document_html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = window.document.createElement('a')
    a.href = url
    a.download = `${pr.request_code ?? 'payment-request'}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><p className="text-slate-400 text-sm">Loading…</p></div>
  }
  if (!pr) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-slate-500">Payment Request not found.</p>
        <Link to="/finance/payment-requests" className="text-sm text-blue-600 hover:underline">← Back to the register</Link>
      </div>
    )
  }

  const sourceHref = pr.source_type === 'expense'
    ? `/expenses/${pr.expense_id}`
    : `/batch-payments/${pr.batch_payment_id}`

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-200">
          <ArrowLeft className="h-4 w-4" /> Payment Requests
        </button>
        <div className="flex items-center gap-2">
          <button onClick={printDoc} className="flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700">
            <Printer className="h-3.5 w-3.5" /> Print
          </button>
          <button onClick={downloadDoc} className="flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700">
            <Download className="h-3.5 w-3.5" /> Download
          </button>
          {canVoid && pr.status !== 'void' && !voiding && (
            <button onClick={() => setVoiding(true)} className="flex items-center gap-1.5 rounded-md border border-red-200 dark:border-red-800 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
              <Ban className="h-3.5 w-3.5" /> Void
            </button>
          )}
        </div>
      </div>

      {voiding && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 space-y-2">
          <p className="text-sm font-semibold text-red-700 dark:text-red-400">Void {pr.request_code}?</p>
          <p className="text-xs text-red-600 dark:text-red-400">
            The document stays in the register with the reason recorded — voiding never deletes it.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Reason (required)"
              className="flex-1 min-w-[220px] rounded-md border border-red-200 dark:border-red-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-red-400"
            />
            <button
              onClick={() => voidMutation.mutate()}
              disabled={!reason.trim() || voidMutation.isPending}
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              {voidMutation.isPending ? 'Voiding…' : 'Confirm void'}
            </button>
            <button onClick={() => { setVoiding(false); setReason('') }} className="rounded-md border dark:border-slate-600 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="rounded-2xl overflow-hidden" style={{ background: '#1B3A5C' }}>
        <div className="px-6 py-6">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-white/60 text-xs uppercase tracking-widest">
                {pr.source_type === 'batch_payment' ? 'Batch Payment Request' : 'Payment Request'}
              </p>
              <h1 className="text-white font-bold text-lg leading-tight font-mono">{pr.request_code}</h1>
              {pr.amount_in_words && <p className="text-white/70 text-xs italic mt-1">{pr.amount_in_words}</p>}
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={pr.status} />
              {pr.revision > 1 && (
                <span className="text-xs px-2 py-0.5 rounded-full text-white/85" style={{ background: 'rgba(255,255,255,0.14)' }}>
                  revision {pr.revision}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 text-center divide-x divide-white/10" style={{ background: 'rgba(0,0,0,0.22)' }}>
          <div className="py-3 px-2">
            <p className="text-white/50 text-xs uppercase tracking-wide">Amount</p>
            <p className="text-white font-black text-lg tabular-nums">{formatCurrency(pr.total_amount)}</p>
          </div>
          <div className="py-3 px-2">
            <p className="text-white/50 text-xs uppercase tracking-wide">Workers</p>
            <p className="text-white font-bold text-sm">{pr.worker_count}</p>
          </div>
          <div className="py-3 px-2">
            <p className="text-white/50 text-xs uppercase tracking-wide">Period</p>
            <p className="text-white font-bold text-xs">
              {pr.period_start && pr.period_end ? `${formatDateGC(pr.period_start)} → ${formatDateGC(pr.period_end)}` : '—'}
            </p>
          </div>
          <div className="py-3 px-2">
            <p className="text-white/50 text-xs uppercase tracking-wide">Issued</p>
            <p className="text-white font-bold text-xs">{formatDateTime(pr.issued_at)}</p>
          </div>
        </div>
      </div>

      {pr.status === 'void' && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3">
          <p className="text-sm font-semibold text-red-700 dark:text-red-400">This Payment Request is void</p>
          <p className="text-xs text-red-600 dark:text-red-400">
            {pr.void_reason} — voided {pr.voided_at ? formatDateTime(pr.voided_at) : ''}
          </p>
        </div>
      )}
      {pr.status === 'superseded' && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-900/20 px-4 py-3">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Superseded by a later revision</p>
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Kept for the record. Use the newest issued revision below as the live authorisation.
          </p>
        </div>
      )}

      {/* Links + revision trail */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Link to={sourceHref} className="flex items-center gap-1.5 rounded-full border dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1 text-slate-600 dark:text-slate-300 hover:border-brand">
          {pr.source_type === 'batch_payment' ? <Layers className="h-3 w-3" /> : <Receipt className="h-3 w-3" />}
          Open source
          <ExternalLink className="h-2.5 w-2.5 text-slate-400" />
        </Link>
        {siblings.filter(s => s.id !== pr.id).map(s => (
          <Link key={s.id} to={`/finance/payment-requests/${s.id}`} className="flex items-center gap-1.5 rounded-full border dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1 hover:border-brand">
            <span className="font-mono text-slate-600 dark:text-slate-300">{s.request_code}</span>
            <span className="text-slate-400">rev {s.revision}</span>
            <StatusBadge status={s.status} />
          </Link>
        ))}
        {pr.notes && <span className="text-slate-500 dark:text-slate-400 italic">“{pr.notes}”</span>}
      </div>

      {/* The archived document, exactly as issued. */}
      <div className="rounded-xl border dark:border-slate-700 bg-white overflow-hidden" style={{ height: '80vh' }}>
        <iframe
          id="pr-archive-frame"
          srcDoc={pr.document_html}
          title={`Payment Request ${pr.request_code ?? ''}`}
          className="w-full h-full border-0"
        />
      </div>
    </div>
  )
}
