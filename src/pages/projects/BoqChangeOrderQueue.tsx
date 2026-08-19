import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { StatusBadge } from '@/components/shared/StatusBadge'
import type { BoqChangeOrder, BoqChangeOrderItem } from '@/types/database'
import { CheckCircle2, XCircle, FileEdit, ChevronDown, ChevronRight } from 'lucide-react'

type Stage = 'pm' | 'finance' | 'exec'

type CoRow = BoqChangeOrder & { boqs: { title: string; project_id: string; projects: { project_name: string } | null } | null }

const APPROVE_RPC: Record<Stage, string> = {
  pm: 'pm_approve_change_order', finance: 'finance_approve_change_order', exec: 'exec_approve_change_order',
}

// Reused for all three approval stages by passing the target status
// filter, same pattern as SitePettyCashQueue — RLS already scopes what
// each role can act on; the filter here is just for UX. The PM queue
// additionally covers pending_client_signoff since record_client_signoff
// is a PM/admin action too, not a separate role.
export function BoqChangeOrderQueue({ stage }: { stage: Stage }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [signoffId, setSignoffId] = useState<string | null>(null)
  const [evidence, setEvidence] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const statuses = stage === 'pm' ? ['pending_pm', 'pending_client_signoff'] : stage === 'finance' ? ['pending_finance'] : ['pending_exec']

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['boq-change-order-queue', stage],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('boq_change_orders')
        .select('*, boqs(title, project_id, projects(project_name))')
        .in('status', statuses)
        .order('created_at')
      if (error) throw error
      return data as CoRow[]
    },
  })

  const { data: items = [] } = useQuery({
    queryKey: ['boq-change-order-items', expandedId],
    queryFn: async () => {
      const { data, error } = await supabase.from('boq_change_order_items').select('*').eq('change_order_id', expandedId!)
      if (error) throw error
      return (data ?? []) as BoqChangeOrderItem[]
    },
    enabled: !!expandedId,
  })

  function invalidate() { qc.invalidateQueries({ queryKey: ['boq-change-order-queue'] }) }

  async function approve(id: string) {
    setBusy(id)
    const { error } = await supabase.rpc(APPROVE_RPC[stage], { p_change_order_id: id })
    setBusy(null)
    if (error) { toast(error.message, 'error'); return }
    invalidate()
    toast('Change order advanced', 'success')
  }

  async function reject(id: string) {
    if (!reason.trim()) { toast('Enter a rejection reason', 'error'); return }
    setBusy(id)
    const { error } = await supabase.rpc('reject_change_order', { p_change_order_id: id, p_reason: reason.trim() })
    setBusy(null); setRejectingId(null); setReason('')
    if (error) { toast(error.message, 'error'); return }
    invalidate()
    toast('Change order rejected', 'success')
  }

  async function signoff(id: string) {
    if (!evidence.trim()) { toast('Enter sign-off evidence (how it was captured)', 'error'); return }
    setBusy(id)
    const { error } = await supabase.rpc('record_client_signoff', { p_change_order_id: id, p_evidence: evidence.trim() })
    setBusy(null); setSignoffId(null); setEvidence('')
    if (error) { toast(error.message, 'error'); return }
    invalidate()
    toast('Client sign-off recorded — change order finalized', 'success')
  }

  const title = stage === 'pm' ? 'PM' : stage === 'finance' ? 'Finance' : 'Executive'

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <FileEdit className="h-5 w-5 text-brand" /> BOQ Change Orders — {title} Queue
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {stage === 'pm' ? 'PM-only changes finalize immediately; larger ones advance to Finance. Client sign-off is also recorded here.' : `Change orders whose cost delta requires ${title} approval.`}
        </p>
      </div>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">Nothing waiting.</p>
      ) : (
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm divide-y dark:divide-slate-700">
          {rows.map(co => (
            <div key={co.id} className="p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <button onClick={() => setExpandedId(expandedId === co.id ? null : co.id)}
                    className="flex items-center gap-1 text-sm font-semibold text-slate-800 dark:text-slate-100 hover:text-brand">
                    {expandedId === co.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    {co.title}
                  </button>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    <Link to={`/projects/${co.boqs?.project_id}#boq`} className="hover:text-brand hover:underline">
                      {co.boqs?.projects?.project_name ?? '—'}
                    </Link>
                    {' · '}{co.boqs?.title} · {formatDate(co.created_at)}
                    {co.requested_by_client && ' · client-initiated'}
                  </p>
                  {co.description && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{co.description}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusBadge status={co.status} />
                  <span className={`text-sm font-semibold ${co.cost_delta_etb > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                    {co.cost_delta_etb >= 0 ? '+' : ''}{formatCurrency(co.cost_delta_etb)}
                  </span>
                </div>
              </div>

              {expandedId === co.id && (
                <div className="mt-2 rounded-md bg-slate-50 dark:bg-slate-700/30 p-2.5 text-xs space-y-1">
                  {items.length === 0 ? <p className="text-slate-400">No item changes recorded.</p> : items.map(i => (
                    <p key={i.id} className="text-slate-600 dark:text-slate-300">
                      <span className="font-medium uppercase text-[10px] text-slate-400 mr-1.5">{i.action}</span>
                      {i.new_name ?? '(existing item)'}
                      {i.new_quantity != null && i.new_unit_rate_etb != null && ` — ${i.new_quantity} ${i.new_unit ?? ''} @ ${formatCurrency(i.new_unit_rate_etb)}`}
                    </p>
                  ))}
                </div>
              )}

              <div className="mt-3 flex items-center gap-2">
                {co.status === 'pending_client_signoff' ? (
                  <button onClick={() => setSignoffId(signoffId === co.id ? null : co.id)}
                    className="flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Record Client Sign-off
                  </button>
                ) : (
                  <button onClick={() => approve(co.id)} disabled={busy === co.id}
                    className="flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                  </button>
                )}
                <button onClick={() => setRejectingId(rejectingId === co.id ? null : co.id)}
                  className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 dark:border-slate-600 hover:bg-red-50 dark:hover:bg-red-900/20">
                  <XCircle className="h-3.5 w-3.5" /> Reject
                </button>
              </div>

              {rejectingId === co.id && (
                <div className="mt-2 flex gap-2">
                  <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason for rejection"
                    className="flex-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600" />
                  <button onClick={() => reject(co.id)} disabled={busy === co.id}
                    className="rounded-md bg-red-600 px-3 py-2 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50">
                    Confirm Reject
                  </button>
                </div>
              )}
              {signoffId === co.id && (
                <div className="mt-2 flex gap-2">
                  <input value={evidence} onChange={e => setEvidence(e.target.value)} placeholder="How sign-off was captured (email, signed doc, etc.)"
                    className="flex-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600" />
                  <button onClick={() => signoff(co.id)} disabled={busy === co.id}
                    className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                    Confirm
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function PmBoqChangeOrderQueuePage() { return <BoqChangeOrderQueue stage="pm" /> }
export function FinanceBoqChangeOrderQueuePage() { return <BoqChangeOrderQueue stage="finance" /> }
export function ExecBoqChangeOrderQueuePage() { return <BoqChangeOrderQueue stage="exec" /> }
