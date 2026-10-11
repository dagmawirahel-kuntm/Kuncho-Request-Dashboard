import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Pill } from '@/components/record/Record'
import type { AwaitingBankConfirmationRow, ExpensePaymentPart, RecentPaymentRow, SentBatchRow } from '@/types/database'
import { PAYMENT_METHOD_LABEL, ageLabel, ageTone, payResultText, usePayerAndAccountOptions, useRefreshPayments, type PayResult } from '@/lib/payments'
import { useRefreshParts, useSentCashParts } from '@/lib/expensePayments'
import { MarkPaidModal, type MarkPaidTarget } from '@/components/payments/MarkPaidModal'
import { VrfPayModal } from './PaymentModals'
import { CheckCircle2, Landmark, Layers, Receipt } from 'lucide-react'

// To confirm: money marked as sent that is not paid yet. One list, one action
// per row, by how it was sent:
//   bank (transfer, CPO, cheque) → add the FT reference from the slip: that
//     makes it paid (migration 442); the statement checks it later, on the
//     bank audit;
//   a batch wire → one reference for the whole batch;
//   cash or other → confirm it was handed over;
//   VRF → the VRF manager pays it from a settled VRF fund.
// A part of a bill paid in parts (migration 430) is its own row.

type Item =
  | { kind: 'bank'; row: AwaitingBankConfirmationRow; days: number | null }
  | { kind: 'batch'; row: SentBatchRow; days: number | null }
  | { kind: 'cash' | 'vrf'; row: RecentPaymentRow; days: number | null }
  | { kind: 'cash_part'; row: ExpensePaymentPart; days: number | null }

const daysSince = (ts: string | null) => ts ? (Date.now() - new Date(ts).getTime()) / 86_400_000 : null

export default function ToConfirmTab({ awaitingBank, sentBatches, recent, canAct, isVrfManager }: {
  awaitingBank: AwaitingBankConfirmationRow[]; sentBatches: SentBatchRow[]; recent: RecentPaymentRow[]; canAct: boolean; isVrfManager: boolean
}) {
  const { toast } = useToast()
  const refreshPayments = useRefreshPayments()
  const refreshParts = useRefreshParts()
  const refresh = () => { refreshPayments(); refreshParts() }
  const { accountOptions } = usePayerAndAccountOptions()
  const { data: cashParts = [] } = useSentCashParts()
  const [marking, setMarking] = useState<MarkPaidTarget | null>(null)
  const [vrfRow, setVrfRow] = useState<RecentPaymentRow | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  // A bill in a batch is paid with its batch; it shows here only if its batch
  // isn't waiting as a whole (some of its bills already moved on).
  const waitingBatchIds = new Set(sentBatches.map(b => b.id))
  const items: Item[] = [
    ...awaitingBank.filter(r => !r.batch_payment_id || !waitingBatchIds.has(r.batch_payment_id))
      .map(r => ({ kind: 'bank' as const, row: r, days: r.days_waiting })),
    ...sentBatches.map(b => ({ kind: 'batch' as const, row: b, days: b.days_waiting })),
    ...recent.filter(r => r.payment_state === 'sent' && (r.payment_method === 'cash' || r.payment_method === 'other') && !r.batch_payment_id)
      .map(r => ({ kind: 'cash' as const, row: r, days: daysSince(r.payment_state_changed_at) })),
    ...recent.filter(r => r.payment_state === 'sent' && r.payment_method === 'vrf').map(r => ({ kind: 'vrf' as const, row: r, days: daysSince(r.payment_state_changed_at) })),
    ...cashParts.map(p => ({ kind: 'cash_part' as const, row: p, days: daysSince(p.sent_at) })),
  ].sort((a, b) => (b.days ?? 0) - (a.days ?? 0))

  // Cash: handed over today, one click (mark_payment_paid without a reference).
  async function confirmCash(id: string, part = false) {
    setConfirming(id)
    const { data, error } = await supabase.rpc('mark_payment_paid', { p_kind: part ? 'part' : 'expense', p_id: id })
    setConfirming(null)
    if (error) { toast(error.message, 'error'); return }
    toast(payResultText(data as PayResult, 'cash'), 'success'); refresh()
  }

  function done(res: PayResult, method: string | null) {
    setMarking(null)
    toast(payResultText(res, method), 'success')
    refresh()
  }

  if (!items.length) return <p className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Every sent payment is marked paid.</p>

  const bankCount = items.filter(i => i.kind === 'bank' || i.kind === 'batch').length
  return (
    <div className="space-y-3">
      {bankCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-800 dark:border-sky-800/50 dark:bg-sky-900/20 dark:text-sky-200">
          <Landmark className="h-4 w-4 shrink-0" />
          <span>{bankCount} bank payment{bankCount === 1 ? '' : 's'} wait{bankCount === 1 ? 's' : ''} for the reference on the transfer slip — that marks it paid. The statement checks each one later.</span>
          <Link to="/bank-statement-import?tab=audit" className="ml-auto font-semibold hover:underline">Bank audit →</Link>
        </div>
      )}
      <ul className="divide-y overflow-hidden rounded-xl border bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800">
        {items.map(i => {
          if (i.kind === 'batch') {
            const b = i.row
            return (
              <li key={`batch-${b.id}`} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <Link to={`/batch-payments/${b.id}`} className="flex items-center gap-1.5 truncate font-medium text-slate-800 hover:text-brand hover:underline dark:text-slate-100">
                    <Layers className="h-3.5 w-3.5 shrink-0 text-slate-400" /> {b.payment_code ?? 'Batch payment'}
                  </Link>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {b.bills} bill{b.bills === 1 ? '' : 's'} in one {b.payment_method === 'cash' ? 'cash run' : 'wire'}
                    {b.account_name ? ` · ${b.account_name}` : ''}{b.assignee_name ? ` · by ${b.assignee_name}` : ''} · sent {formatDate(b.sent_at)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(b.amount)}</p>
                  <div className="mt-1 flex items-center justify-end gap-1.5">
                    <Pill tone={ageTone(i.days, 7, 14)} title="Days since it was sent">{ageLabel(i.days)}</Pill>
                    {canAct && (
                      <button onClick={() => setMarking({ kind: 'batch', id: b.id, title: b.payment_code ?? 'Batch payment',
                        subtitle: `${b.bills} bills`, amount: Number(b.amount), method: b.payment_method, accountId: b.account_id, bankRef: b.bank_ref })}
                        className="inline-flex items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-700">
                        <Landmark className="h-3 w-3" /> Mark paid
                      </button>
                    )}
                  </div>
                </div>
              </li>
            )
          }
          if (i.kind === 'cash_part') {
            const p = i.row
            return (
              <li key={`part-${p.id}`} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <Link to={`/expenses/${p.expense_id}`} className="block truncate font-medium text-slate-800 hover:text-brand hover:underline dark:text-slate-100">
                    {p.vendor_name ?? p.item_service_description ?? p.expense_code}
                  </Link>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    <span className="font-semibold text-brand">Part {p.part_no} of {p.part_count}</span> · {p.payment_method ? (PAYMENT_METHOD_LABEL[p.payment_method] ?? p.payment_method) : '—'}
                    {p.disbursed_by_name ? ` · by ${p.disbursed_by_name}` : ''} · sent {formatDate(p.sent_at)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(p.cash_etb)}</p>
                  <div className="mt-1 flex items-center justify-end gap-1.5">
                    <Pill tone={ageTone(i.days, 7, 14)} title="Days since it was sent">{ageLabel(i.days)}</Pill>
                    {canAct && (
                      <button onClick={() => confirmCash(p.id, true)} disabled={confirming === p.id}
                        className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">
                        <Receipt className="h-3 w-3" /> {confirming === p.id ? 'Confirming…' : 'Confirm paid'}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            )
          }
          const r = i.row
          const method = r.payment_method ? (PAYMENT_METHOD_LABEL[r.payment_method] ?? r.payment_method) : '—'
          const bankRow = i.kind === 'bank' ? i.row : null
          const part = bankRow?.part_id ? bankRow : null
          return (
            <li key={part ? `part-${part.part_id}` : r.id} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <Link to={`/expenses/${r.id}`} className="block truncate font-medium text-slate-800 hover:text-brand hover:underline dark:text-slate-100">
                  {r.vendor_name ?? r.item_service_description ?? r.expense_code}
                </Link>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {part && <><span className="font-semibold text-brand">Part {part.part_no} of {part.part_count}</span> · </>}
                  {method}{bankRow?.account_name ? ` · ${bankRow.account_name}` : ''}
                  {bankRow?.bank_ref ? <> · <span className="font-mono">{bankRow.bank_ref}</span></> : ''} · sent {formatDate(r.payment_state_changed_at)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(r.net_payable ?? r.amount_etb ?? 0)}</p>
                <div className="mt-1 flex items-center justify-end gap-1.5">
                  <Pill tone={ageTone(i.days, 7, 14)} title="Days since it was sent">{ageLabel(i.days)}</Pill>
                  {bankRow && canAct && (bankRow.batch_payment_id
                    ? <Link to={`/batch-payments/${bankRow.batch_payment_id}`} className="text-[11px] font-medium text-sky-600 hover:underline">Paid with its batch →</Link>
                    : (
                      <button onClick={() => setMarking({
                        kind: part ? 'part' : 'expense', id: part?.part_id ?? bankRow.id,
                        title: `${bankRow.vendor_name ?? bankRow.item_service_description ?? bankRow.expense_code ?? 'Bill'}${part ? ` · part ${part.part_no} of ${part.part_count}` : ''}`,
                        subtitle: bankRow.account_name, amount: Number(bankRow.net_payable ?? bankRow.amount_etb ?? 0),
                        method: bankRow.payment_method, accountId: bankRow.account_id, bankRef: bankRow.bank_ref ?? null })}
                        className="inline-flex items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-700">
                        <Landmark className="h-3 w-3" /> Mark paid
                      </button>
                    ))}
                  {i.kind === 'cash' && canAct && (
                    <button onClick={() => confirmCash(r.id)} disabled={confirming === r.id}
                      className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">
                      <Receipt className="h-3 w-3" /> {confirming === r.id ? 'Confirming…' : r.payment_method === 'cash' ? 'Confirm cash' : 'Confirm paid'}
                    </button>
                  )}
                  {i.kind === 'vrf' && (isVrfManager
                    ? <button onClick={() => setVrfRow(i.row)} className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white">Pay via VRF</button>
                    : <span className="text-[11px] text-amber-600">VRF manager pays it</span>)}
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      {marking && (
        <MarkPaidModal target={marking} accountOptions={accountOptions}
          onClose={() => setMarking(null)} onDone={res => done(res, marking.method)} />
      )}
      {vrfRow && (
        <VrfPayModal row={vrfRow} onClose={() => setVrfRow(null)}
          onLinked={() => { setVrfRow(null); toast('Paid via VRF — fund drawn down', 'success'); refresh() }}
          onError={msg => toast(msg, 'error')} />
      )}
    </div>
  )
}
