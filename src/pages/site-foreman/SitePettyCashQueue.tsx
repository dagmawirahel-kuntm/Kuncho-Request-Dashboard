import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { CheckCircle2, XCircle, Wallet, AlertTriangle } from 'lucide-react'
import type { SitePettyCashRequestContext } from '@/types/database'

// Reused for both Finance and PM queues by passing the target status filter.
// The RLS on site_petty_cash_float_requests already limits what each role
// sees; the filter is just for UX (a Finance user's read policy is scoped to
// pending_finance, a PM's to pending_pm on their projects).
export function SitePettyCashQueue({ role }: { role: 'finance' | 'pm' }) {
  const status = role === 'finance' ? 'pending_finance' : 'pending_pm'
  const { toast } = useToast()
  const qc = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['site-petty-cash-queue', status],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_site_petty_cash_request_context')
        .select('*').eq('status', status).order('created_at')
      if (error) throw error
      return data as SitePettyCashRequestContext[]
    },
  })

  async function approve(id: string) {
    setBusy(id)
    const { error: err1 } = await supabase.rpc('approve_site_petty_cash_request', { p_request_id: id })
    if (err1) { setBusy(null); toast(err1.message, 'error'); return }
    // Open the float immediately after approval — the approver is authorised.
    const { error: err2 } = await supabase.rpc('open_float_from_request', { p_request_id: id })
    setBusy(null)
    if (err2) { toast('Approved but float open failed: ' + err2.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['site-petty-cash-queue'] })
    toast('Approved and float opened', 'success')
  }

  async function reject(id: string) {
    if (!reason.trim()) { toast('Enter a rejection reason', 'error'); return }
    setBusy(id)
    const { error } = await supabase.rpc('reject_site_petty_cash_request', { p_request_id: id, p_reason: reason.trim() })
    setBusy(null); setRejectingId(null); setReason('')
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['site-petty-cash-queue'] })
    toast('Request rejected', 'success')
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <Wallet className="h-5 w-5 text-brand" /> Site Petty Cash — {role === 'finance' ? 'Finance Queue' : 'PM Queue'}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {role === 'finance'
            ? '≤ 5,000 ETB requests. Approving opens the float on the existing petty cash system.'
            : '5,001–10,000 ETB requests on projects you manage. Approving opens the float.'}
        </p>
      </div>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">Nothing waiting.</p>
      ) : (
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm divide-y dark:divide-slate-700">
          {rows.map(r => {
            const headroom = Number(r.budget_headroom ?? 0)
            const wouldExceed = headroom < Number(r.requested_amount)
            return (
              <div key={r.request_id} className="p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {formatCurrency(r.requested_amount)} · {r.project_name}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {r.requested_by_name ?? '—'} · {formatDate(r.created_at)}{r.purpose ? ` · ${r.purpose}` : ''}
                    </p>
                    <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      {(wouldExceed || r.any_group_over_budget) && <AlertTriangle className="h-3 w-3 text-amber-500" />}
                      Budget: {r.total_budget != null ? formatCurrency(r.total_budget) : '—'} ·
                      Committed: {r.total_committed_with_labor != null ? formatCurrency(r.total_committed_with_labor) : '—'} ·
                      Actual: {r.total_actual_with_labor != null ? formatCurrency(r.total_actual_with_labor) : '—'} ·
                      <span className={wouldExceed ? 'text-amber-600 dark:text-amber-400 font-medium' : ''}>
                        Headroom: {formatCurrency(headroom)}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => approve(r.request_id)} disabled={busy === r.request_id}
                      className="flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                    </button>
                    <button onClick={() => setRejectingId(r.request_id === rejectingId ? null : r.request_id)}
                      className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 dark:border-slate-600 hover:bg-red-50 dark:hover:bg-red-900/20">
                      <XCircle className="h-3.5 w-3.5" /> Reject
                    </button>
                  </div>
                </div>
                {rejectingId === r.request_id && (
                  <div className="mt-3 flex gap-2">
                    <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason for rejection"
                      className="flex-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600" />
                    <button onClick={() => reject(r.request_id)} disabled={busy === r.request_id}
                      className="rounded-md bg-red-600 px-3 py-2 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50">
                      Confirm Reject
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function FinanceSitePettyCashQueuePage() { return <SitePettyCashQueue role="finance" /> }
export function PMSitePettyCashQueuePage() { return <SitePettyCashQueue role="pm" /> }
