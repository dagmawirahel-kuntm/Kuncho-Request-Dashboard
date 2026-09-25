import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { DEFAULT_PLAN } from '@/lib/salesJourney'
import type { PaymentMilestone } from '@/types/database'
import { CheckCircle2, ExternalLink } from 'lucide-react'

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  pending:           { label: 'Not yet due', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
  progress_met:      { label: 'Due — to invoice', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  invoiced:          { label: 'Invoiced — awaiting payment', cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' },
  payment_confirmed: { label: 'Paid', cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
}

/**
 * A contract's payment plan — advance, progress, final (migration 330) —
 * and where each payment stands. The advance falls due on signing; progress
 * and final follow the work on the project, where they are invoiced and
 * their payment confirmed.
 */
export function ContractPaymentPlan({ contractId, projectId, status }: {
  contractId: string
  projectId: string | null
  status: string | undefined
}) {
  const { role } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const canPlan = role === 'admin' || role === 'finance'
  const [pct, setPct] = useState(DEFAULT_PLAN)
  const [busy, setBusy] = useState(false)

  const { data: milestones = [], isLoading } = useQuery({
    queryKey: ['contract-milestones', contractId],
    queryFn: async () => {
      const { data, error } = await supabase.from('payment_milestones').select('*').eq('contract_id', contractId).order('sequence_number')
      if (error) throw error
      return data as PaymentMilestone[]
    },
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['contract-milestones', contractId] })
    qc.invalidateQueries({ queryKey: ['payment-milestones'] })
  }

  async function createPlan() {
    setBusy(true)
    const { error } = await supabase.rpc('create_contract_payment_plan', {
      p_contract_id: contractId, p_advance_pct: pct.advance, p_progress_pct: pct.progress, p_final_pct: pct.final,
    })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    refresh()
    toast('Payment plan set', 'success')
  }

  async function markAdvanceDue(id: string) {
    setBusy(true)
    const { error } = await supabase.rpc('mark_milestone_progress_met', { p_milestone_id: id })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    refresh()
    toast('Advance is due — invoice it from the project', 'success')
  }

  const total = pct.advance + pct.progress + pct.final
  const signed = status === 'signed' || status === 'active' || status === 'completed'
  const inputCls = 'w-full rounded-md border px-2 py-1.5 text-sm tabular-nums outline-none focus:ring-2 focus:ring-brand dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100'
  const received = milestones.reduce((s, m) => s + Number(m.amount_received_etb ?? 0), 0)
  const net = milestones.reduce((s, m) => s + Number(m.net_payable_etb ?? 0), 0)

  if (!projectId) {
    return <p className="text-xs text-slate-400">Link the contract to its project, then set its payment plan here.</p>
  }
  if (isLoading) return <p className="text-xs text-slate-400">Loading…</p>

  if (milestones.length === 0) {
    return canPlan ? (
      <div className="space-y-2">
        <div className="grid grid-cols-3 gap-2">
          {(['advance', 'progress', 'final'] as const).map(k => (
            <label key={k} className="block">
              <span className="mb-1 block text-[11px] font-medium capitalize text-slate-500 dark:text-slate-400">{k} %</span>
              <input type="number" min="0" max="100" step="0.01" className={inputCls} value={pct[k]}
                onChange={e => setPct(p => ({ ...p, [k]: parseFloat(e.target.value) || 0 }))} />
            </label>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className={`text-[11px] ${total === 100 ? 'text-slate-400' : 'text-red-600 dark:text-red-400'}`}>
            {total === 100 ? 'Adds up to 100%. Save the contract value first — amounts are worked out from it.' : `Adds up to ${total}% — it has to be 100%`}
          </span>
          <button type="button" onClick={createPlan} disabled={busy || total !== 100}
            className="shrink-0 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-50">
            {busy ? 'Saving…' : 'Set payment plan'}
          </button>
        </div>
      </div>
    ) : <p className="text-xs text-slate-400">No payment plan yet — finance sets it.</p>
  }

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-lg border dark:border-slate-700">
        {milestones.map(m => {
          const st = STATUS_LABEL[m.status] ?? STATUS_LABEL.pending
          return (
            <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 last:border-0 dark:border-slate-700">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{m.title} <span className="text-slate-400">· {Number(m.percent_of_contract_value)}%</span></p>
                <p className="text-[11px] tabular-nums text-slate-400">
                  {formatCurrency(Number(m.gross_amount_etb))}
                  {Number(m.wht_withheld_etb) > 0 && ` · WHT −${formatCurrency(Number(m.wht_withheld_etb))}`}
                  {Number(m.retention_withheld_etb) > 0 && ` · retention −${formatCurrency(Number(m.retention_withheld_etb))}`}
                  {' · '}net {formatCurrency(Number(m.net_payable_etb))}
                  {m.payment_confirmed_at && ` · received ${formatCurrency(Number(m.amount_received_etb ?? 0))} on ${formatDate(m.payment_confirmed_at)}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.cls}`}>{st.label}</span>
                {canPlan && m.kind === 'advance' && m.status === 'pending' && (
                  <button type="button" onClick={() => markAdvanceDue(m.id)} disabled={busy || !signed}
                    title={signed ? undefined : 'The advance falls due when the contract is signed'}
                    className="flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                    <CheckCircle2 className="h-3 w-3" /> Advance due
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="tabular-nums">Received {formatCurrency(received)} of {formatCurrency(net)} net</span>
        <Link to={`/projects/${projectId}`} className="inline-flex items-center gap-1 text-brand hover:underline">
          Invoice and confirm payments on the project <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
    </div>
  )
}
