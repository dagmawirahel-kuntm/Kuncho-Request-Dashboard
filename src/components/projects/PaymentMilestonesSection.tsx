import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useMyStaffId } from '@/hooks/useMyStaff'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { MilestoneFormModal } from './MilestoneFormModal'
import { LinkMilestoneBoqItemsModal } from './LinkMilestoneBoqItemsModal'
import type { PaymentMilestone, ContractMilestonePlanTotals } from '@/types/database'
import type { ContractTerms } from '@/lib/milestoneAmounts'
import {
  Banknote, Plus, Link2, AlertTriangle, CheckCircle2, FileText, Pencil, Trash2, X, Send,
} from 'lucide-react'

const inputCls = 'w-full rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'

interface Props {
  projectId: string
  projectManagerId: string | null
}

type ContractRow = ContractTerms & {
  id: string
  client_id: string | null
  contract_no: string | null
  status: string | null
  wht_deduction_mode: string
}

export function PaymentMilestonesSection({ projectId, projectManagerId }: Props) {
  const { role } = useAuth()
  const { toast } = useToast()
  const { data: myStaff } = useMyStaffId()
  const qc = useQueryClient()

  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<PaymentMilestone | null>(null)
  const [linking, setLinking] = useState<PaymentMilestone | null>(null)
  const [invoicing, setInvoicing] = useState<PaymentMilestone | null>(null)
  const [confirming, setConfirming] = useState<PaymentMilestone | null>(null)
  const [busy, setBusy] = useState(false)

  const { data: contract } = useQuery({
    queryKey: ['project-contract', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contracts')
        .select('id, client_id, contract_no, contract_value, contract_value_includes_vat, wht_rate, retention_percent, wht_deduction_mode, status')
        .eq('project_id', projectId)
        .order('signed_date', { ascending: false, nullsFirst: false })
      if (error) throw error
      const rows = (data ?? []) as ContractRow[]
      // A project can carry more than one contract row; the signed one is the
      // one milestones should hang off.
      return rows.find(c => c.status === 'signed') ?? rows[0] ?? null
    },
  })

  const { data: approvedBoq } = useQuery({
    queryKey: ['project-approved-boq', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from('boqs').select('id, title').eq('project_id', projectId).eq('status', 'approved').maybeSingle()
      if (error) throw error
      return data as { id: string; title: string } | null
    },
  })

  const { data: milestones = [] } = useQuery({
    queryKey: ['payment-milestones', contract?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payment_milestones')
        .select('*')
        .eq('contract_id', contract!.id)
        .order('sequence_number')
      if (error) throw error
      return (data ?? []) as PaymentMilestone[]
    },
    enabled: !!contract?.id,
  })

  const { data: planTotals } = useQuery({
    queryKey: ['milestone-plan-totals', contract?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_contract_milestone_plan_totals')
        .select('*')
        .eq('contract_id', contract!.id)
        .maybeSingle()
      if (error) throw error
      return data as ContractMilestonePlanTotals | null
    },
    enabled: !!contract?.id,
  })

  const milestoneIds = milestones.map(m => m.id)

  const { data: links = [] } = useQuery({
    queryKey: ['milestone-boq-links', contract?.id, milestoneIds.length],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payment_milestone_boq_items')
        .select('id, payment_milestone_id, boq_item_id')
        .in('payment_milestone_id', milestoneIds)
      if (error) throw error
      return (data ?? []) as { id: string; payment_milestone_id: string; boq_item_id: string }[]
    },
    enabled: milestoneIds.length > 0,
  })

  // Names come from the progress view rather than a join on boq_items — it
  // already carries both, so this is one query instead of two. An item whose
  // BOQ version has been superseded drops out of the view, which surfaces as
  // "no data" rather than a stale name.
  const { data: progress = [] } = useQuery({
    queryKey: ['boq-item-progress', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_boq_item_physical_progress')
        .select('item_id, name, progress_pct')
        .eq('project_id', projectId)
      if (error) throw error
      return (data ?? []) as { item_id: string; name: string; progress_pct: number | null }[]
    },
  })

  const itemById = useMemo(() => {
    const m = new Map<string, { name: string; progress_pct: number | null }>()
    for (const p of progress) m.set(p.item_id, { name: p.name, progress_pct: p.progress_pct })
    return m
  }, [progress])

  const isPm = !!myStaff?.id && myStaff.id === projectManagerId
  const canEditPlan = role === 'admin' || role === 'project_manager' || role === 'finance'
  const canMarkProgress = role === 'admin' || isPm
  const canInvoice = role === 'admin' || role === 'finance' || isPm
  const canConfirm = role === 'admin' || role === 'finance'

  const nextSequence = milestones.length > 0 ? Math.max(...milestones.map(m => m.sequence_number)) + 1 : 1

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ['payment-milestones', contract?.id] })
    qc.invalidateQueries({ queryKey: ['milestone-plan-totals', contract?.id] })
    qc.invalidateQueries({ queryKey: ['milestone-boq-links', contract?.id] })
  }

  async function handleMarkProgressMet(m: PaymentMilestone) {
    setBusy(true)
    const { error } = await supabase.rpc('mark_milestone_progress_met', { p_milestone_id: m.id })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    invalidateAll()
    toast('Progress confirmed against the BOQ', 'success')
  }

  async function handleUnlink(linkId: string) {
    const { error } = await supabase.from('payment_milestone_boq_items').delete().eq('id', linkId)
    if (error) { toast(error.message, 'error'); return }
    invalidateAll()
  }

  async function handleDelete(m: PaymentMilestone) {
    const { error } = await supabase.from('payment_milestones').delete().eq('id', m.id)
    if (error) { toast(error.message, 'error'); return }
    invalidateAll()
    toast('Milestone removed', 'success')
  }

  // No contract, or no contract value — milestones are meaningless here, and
  // this is the majority of projects. Render nothing rather than an empty
  // shell that implies something is missing.
  if (!contract || contract.contract_value == null) return null

  return (
    <div id="payment-milestones" className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm space-y-4 scroll-mt-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
            <Banknote className="h-4 w-4" /> Payment Milestones
          </h2>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
            {contract.contract_no ?? 'Contract'} · {formatCurrency(contract.contract_value)}
            {contract.contract_value_includes_vat ? ' (VAT inclusive)' : ' (VAT exclusive)'}
          </p>
        </div>
        {canEditPlan && (
          <button onClick={() => setAdding(true)}
            className="flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90">
            <Plus className="h-3.5 w-3.5" /> Add Milestone
          </button>
        )}
      </div>

      {planTotals && !planTotals.is_balanced && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-700 dark:text-amber-300">
            This plan covers {planTotals.sum_percent_of_contract_value}% of the contract value, not 100%.
            That may be intentional — nothing is blocked — but double-check the percentages.
          </p>
        </div>
      )}

      {milestones.length === 0 ? (
        <p className="text-sm text-slate-400 dark:text-slate-500 py-4 text-center">
          No milestones defined yet. Add the payment stages agreed in this contract.
        </p>
      ) : (
        <div className="space-y-2">
          {milestones.map(m => {
            const myLinks = links.filter(l => l.payment_milestone_id === m.id)
            const allComplete = myLinks.length > 0 &&
              myLinks.every(l => (itemById.get(l.boq_item_id)?.progress_pct ?? -1) >= 100)
            const isPending = m.status === 'pending'
            // An advance is paid before the work starts: it is requested and
            // received, with no progress to meet (migration 338). It is open
            // while pending or due (due = contract signed, migration 330).
            const isAdvance = m.kind === 'advance'
            const advanceOpen = isAdvance && (m.status === 'pending' || m.status === 'progress_met')

            return (
              <div key={m.id} className="rounded-lg border dark:border-slate-700 p-3 space-y-2">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                      <span className="text-slate-400 mr-1.5">{m.sequence_number}.</span>{m.title}
                      {isAdvance && (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                          Advance
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                      {m.percent_of_contract_value}% · gross {formatCurrency(m.gross_amount_etb)}
                      {Number(m.retention_withheld_etb) > 0 && ` · retention −${formatCurrency(m.retention_withheld_etb)}`}
                      {Number(m.wht_withheld_etb) > 0 && ` · WHT −${formatCurrency(m.wht_withheld_etb)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                      {formatCurrency(m.net_payable_etb)}
                    </span>
                    {/* For an advance, "invoiced" means the payment request went out. */}
                    <StatusBadge status={!isAdvance ? m.status
                      : m.status === 'invoiced' ? 'requested'
                      : m.status === 'progress_met' ? 'due' : m.status} />
                  </div>
                </div>

                {/* Completion condition */}
                <div className="text-xs space-y-1">
                  {isAdvance ? (
                    <p className="text-slate-500 dark:text-slate-400">
                      Paid before work starts — there is no progress to meet.
                      {m.status !== 'payment_confirmed' && ' Work on the next milestone waits until this is received.'}
                      {m.status === 'invoiced' && m.invoiced_at && ` Requested ${formatDate(m.invoiced_at)}.`}
                    </p>
                  ) : myLinks.length === 0 ? (
                    <p className="text-slate-400 dark:text-slate-500 italic">
                      No BOQ items linked — link the scope that defines completion.
                    </p>
                  ) : (
                    myLinks.map(l => {
                      const item = itemById.get(l.boq_item_id)
                      const pct = item?.progress_pct
                      const done = (pct ?? -1) >= 100
                      return (
                        <div key={l.id} className="flex items-center gap-2">
                          <span className={done ? 'text-green-600 dark:text-green-400' : 'text-slate-400 dark:text-slate-500'}>
                            {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className="inline-block h-3.5 w-3.5 rounded-full border border-current" />}
                          </span>
                          <span className="flex-1 truncate text-slate-600 dark:text-slate-300">{item?.name ?? 'Unknown item'}</span>
                          <span className="tabular-nums text-slate-400 dark:text-slate-500">
                            {pct == null ? 'no data' : `${Number(pct).toFixed(0)}%`}
                          </span>
                          {isPending && canEditPlan && (
                            <button onClick={() => handleUnlink(l.id)} className="text-slate-300 hover:text-red-500" title="Unlink">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>

                {m.status === 'payment_confirmed' && (
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    Received {formatCurrency(m.amount_received_etb ?? 0)}
                    {m.payment_confirmed_at && ` on ${formatDate(m.payment_confirmed_at)}`}
                    {m.payment_note && ` — ${m.payment_note}`}
                  </p>
                )}

                {/* Stage actions */}
                <div className="flex items-center gap-2 flex-wrap pt-1">
                  {isPending && canEditPlan && (
                    <>
                      {!isAdvance && (
                        <button onClick={() => setLinking(m)} disabled={!approvedBoq}
                          title={approvedBoq ? undefined : 'No approved BOQ for this project yet'}
                          className="flex items-center gap-1 rounded-md border dark:border-slate-600 px-2.5 py-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50">
                          <Link2 className="h-3.5 w-3.5" /> Link BOQ items
                        </button>
                      )}
                      <button onClick={() => setEditing(m)}
                        className="flex items-center gap-1 rounded-md border dark:border-slate-600 px-2.5 py-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </button>
                      <button onClick={() => handleDelete(m)}
                        className="flex items-center gap-1 rounded-md border dark:border-slate-600 px-2.5 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20">
                        <Trash2 className="h-3.5 w-3.5" /> Remove
                      </button>
                    </>
                  )}

                  {/* Advance: the request letter, then recording that it went
                      out, then the payment — no progress stage. */}
                  {advanceOpen && canInvoice && contract.client_id && (
                    <Link
                      to={`/clients/${contract.client_id}/payment-request?type=new&contract_id=${contract.id}&milestone_id=${m.id}`}
                      className="flex items-center gap-1 rounded-md border dark:border-slate-600 px-2.5 py-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
                      <FileText className="h-3.5 w-3.5" /> Payment request letter
                    </Link>
                  )}
                  {advanceOpen && canInvoice && (
                    <button onClick={() => setInvoicing(m)}
                      className="flex items-center gap-1 rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white hover:bg-brand/90">
                      <Send className="h-3.5 w-3.5" /> Record request sent
                    </button>
                  )}
                  {advanceOpen && canConfirm && (
                    <button onClick={() => setConfirming(m)}
                      title="Received without a request logged here"
                      className="rounded-md bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700">
                      Confirm Payment
                    </button>
                  )}

                  {!isAdvance && isPending && canMarkProgress && (
                    <button onClick={() => handleMarkProgressMet(m)} disabled={busy || !allComplete}
                      title={allComplete ? undefined : 'All linked BOQ items must reach 100% first'}
                      className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                      Mark Progress Met
                    </button>
                  )}

                  {!isAdvance && m.status === 'progress_met' && canInvoice && (
                    <button onClick={() => setInvoicing(m)}
                      className="flex items-center gap-1 rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white hover:bg-brand/90">
                      <FileText className="h-3.5 w-3.5" /> Mark Invoiced
                    </button>
                  )}

                  {m.status === 'invoiced' && canConfirm && (
                    <button onClick={() => setConfirming(m)}
                      className="rounded-md bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700">
                      Confirm Payment
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {(adding || editing) && (
        <MilestoneFormModal
          contractId={contract.id}
          projectId={projectId}
          terms={contract}
          milestone={editing}
          nextSequence={nextSequence}
          myStaffId={myStaff?.id ?? null}
          onClose={() => { setAdding(false); setEditing(null) }}
          onSaved={invalidateAll}
        />
      )}

      {linking && approvedBoq && (
        <LinkMilestoneBoqItemsModal
          milestoneId={linking.id}
          boqId={approvedBoq.id}
          alreadyLinkedIds={links.filter(l => l.payment_milestone_id === linking.id).map(l => l.boq_item_id)}
          onClose={() => setLinking(null)}
          onSaved={invalidateAll}
        />
      )}

      {invoicing && (
        <InvoiceModal milestone={invoicing} onClose={() => setInvoicing(null)} onDone={invalidateAll} />
      )}

      {confirming && (
        <ConfirmPaymentModal milestone={confirming} onClose={() => setConfirming(null)} onDone={invalidateAll} />
      )}
    </div>
  )
}

function InvoiceModal({ milestone, onClose, onDone }: { milestone: PaymentMilestone; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast()
  const [url, setUrl] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  // For an advance the bill is the payment request letter, sent before any
  // proforma or invoice exists.
  const isAdvance = milestone.kind === 'advance'

  async function submit() {
    setSaving(true)
    const { error } = await supabase.rpc('mark_milestone_invoiced', {
      p_milestone_id: milestone.id,
      p_document_url: url.trim() || null,
      p_invoiced_date: date,
    })
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast(isAdvance ? 'Payment request recorded' : 'Marked as invoiced', 'success')
    onDone(); onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded-xl bg-white dark:bg-slate-800 p-5 shadow-xl space-y-3">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
          {isAdvance ? 'Record Payment Request' : 'Mark Invoiced'} — {milestone.title}
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {isAdvance
            ? 'Records that the advance payment request went to the client. Confirm the payment when it arrives.'
            : 'Records a reference to an invoice you raised elsewhere; no document is generated here.'}
        </p>
        <div>
          <label className="text-xs text-slate-500 dark:text-slate-400">{isAdvance ? 'Date sent' : 'Invoice date'}</label>
          <input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-slate-500 dark:text-slate-400">{isAdvance ? 'Request letter link (optional)' : 'Invoice document link (optional)'}</label>
          <input className={inputCls} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" />
        </div>
        <div className="flex items-center justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-md px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-60">
            {saving ? 'Saving…' : isAdvance ? 'Record Request' : 'Mark Invoiced'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ConfirmPaymentModal({ milestone, onClose, onDone }: { milestone: PaymentMilestone; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast()
  const [amount, setAmount] = useState(String(milestone.net_payable_etb))
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const parsed = parseFloat(amount)
  // Mirrors confirm_milestone_payment's 1 ETB tolerance, so the note field is
  // flagged as required before the round-trip rather than after it.
  const mismatched = !isNaN(parsed) && Math.abs(parsed - Number(milestone.net_payable_etb)) > 1

  async function submit() {
    if (isNaN(parsed)) { toast('Enter the amount received', 'error'); return }
    setSaving(true)
    const { error } = await supabase.rpc('confirm_milestone_payment', {
      p_milestone_id: milestone.id,
      p_amount_received_etb: parsed,
      p_received_date: date,
      p_note: note.trim() || null,
    })
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Payment confirmed', 'success')
    onDone(); onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded-xl bg-white dark:bg-slate-800 p-5 shadow-xl space-y-3">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Confirm Payment — {milestone.title}</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Net payable is {formatCurrency(milestone.net_payable_etb)}.
        </p>
        <div>
          <label className="text-xs text-slate-500 dark:text-slate-400">Amount received (ETB)</label>
          <input type="number" step="0.01" className={inputCls} value={amount} onChange={e => setAmount(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-slate-500 dark:text-slate-400">Date received</label>
          <input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-slate-500 dark:text-slate-400">
            Note {mismatched && <span className="text-amber-600 dark:text-amber-400">(required — amount differs from net payable)</span>}
          </label>
          <textarea className={inputCls} rows={2} value={note} onChange={e => setNote(e.target.value)}
            placeholder={mismatched ? 'Explain the difference…' : 'Optional'} />
        </div>
        <div className="flex items-center justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-md px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={submit} disabled={saving || (mismatched && !note.trim())}
            className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60">
            {saving ? 'Saving…' : 'Confirm Payment'}
          </button>
        </div>
      </div>
    </div>
  )
}
