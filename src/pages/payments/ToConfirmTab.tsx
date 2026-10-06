import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Pill } from '@/components/record/Record'
import type { AwaitingBankConfirmationRow, ExpensePaymentPart, MatchableRow, RecentPaymentRow } from '@/types/database'
import { PAYMENT_METHOD_LABEL, ageLabel, ageTone, useRefreshPayments } from '@/lib/payments'
import { useRefreshParts, useSentCashParts } from '@/lib/expensePayments'
import { MatchTransferModal, VrfPayModal } from './PaymentModals'
import { CheckCircle2, Landmark, Receipt } from 'lucide-react'

// To confirm: money marked as sent that the books can't yet call paid.
// One list, one action per row, by how it was sent:
//   bank (transfer, CPO, cheque, batch) → match it to a statement line;
//   cash → confirm it was handed over;
//   VRF → the VRF manager pays it from a settled VRF fund.
// A part of a bill paid in parts (migration 430) is its own row: matched to
// its own bank line, or its cash confirmed on its own.

type Item =
  | { kind: 'bank'; row: AwaitingBankConfirmationRow; days: number | null }
  | { kind: 'cash' | 'vrf'; row: RecentPaymentRow; days: number | null }
  | { kind: 'cash_part'; row: ExpensePaymentPart; days: number | null }

const daysSince = (ts: string | null) => ts ? (Date.now() - new Date(ts).getTime()) / 86_400_000 : null

export default function ToConfirmTab({ awaitingBank, recent, canAct, isVrfManager }: {
  awaitingBank: AwaitingBankConfirmationRow[]; recent: RecentPaymentRow[]; canAct: boolean; isVrfManager: boolean
}) {
  const { toast } = useToast()
  const refreshPayments = useRefreshPayments()
  const refreshParts = useRefreshParts()
  const refresh = () => { refreshPayments(); refreshParts() }
  const { data: cashParts = [] } = useSentCashParts()
  const [matching, setMatching] = useState<MatchableRow | null>(null)
  const [vrfRow, setVrfRow] = useState<RecentPaymentRow | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  const items: Item[] = [
    ...awaitingBank.map(r => ({ kind: 'bank' as const, row: r, days: r.days_waiting })),
    ...recent.filter(r => r.payment_state === 'sent' && r.payment_method === 'cash').map(r => ({ kind: 'cash' as const, row: r, days: daysSince(r.payment_state_changed_at) })),
    ...recent.filter(r => r.payment_state === 'sent' && r.payment_method === 'vrf').map(r => ({ kind: 'vrf' as const, row: r, days: daysSince(r.payment_state_changed_at) })),
    ...cashParts.map(p => ({ kind: 'cash_part' as const, row: p, days: daysSince(p.sent_at) })),
  ].sort((a, b) => (b.days ?? 0) - (a.days ?? 0))

  async function confirmCash(id: string, part = false) {
    setConfirming(id)
    const { error } = part
      ? await supabase.rpc('confirm_expense_part_cash', { p_payment_id: id })
      : await supabase.rpc('confirm_expense_cash_payment', { p_expense_id: id })
    setConfirming(null)
    if (error) { toast(error.message, 'error'); return }
    toast('Cash payment confirmed', 'success'); refresh()
  }

  if (!items.length) return <p className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Every sent payment is confirmed.</p>

  const bankCount = items.filter(i => i.kind === 'bank').length
  return (
    <div className="space-y-3">
      {bankCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-800 dark:border-sky-800/50 dark:bg-sky-900/20 dark:text-sky-200">
          <Landmark className="h-4 w-4 shrink-0" />
          <span>{bankCount} bank payment{bankCount === 1 ? '' : 's'} confirm when matched to a line on an imported statement.</span>
          <Link to="/bank-statement-import" className="ml-auto font-semibold hover:underline">Import a statement →</Link>
        </div>
      )}
      <ul className="divide-y overflow-hidden rounded-xl border bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800">
        {items.map(i => {
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
          const part = i.kind === 'bank' && i.row.part_id ? i.row : null
          return (
            <li key={part ? `part-${part.part_id}` : r.id} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <Link to={`/expenses/${r.id}`} className="block truncate font-medium text-slate-800 hover:text-brand hover:underline dark:text-slate-100">
                  {r.vendor_name ?? r.item_service_description ?? r.expense_code}
                </Link>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {part && <><span className="font-semibold text-brand">Part {part.part_no} of {part.part_count}</span> · </>}
                  {method}{i.kind === 'bank' && i.row.account_name ? ` · ${i.row.account_name}` : ''}
                  {r.batch_payment_id ? ' · in a batch' : ''} · sent {formatDate(r.payment_state_changed_at)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(r.net_payable ?? r.amount_etb ?? 0)}</p>
                <div className="mt-1 flex items-center justify-end gap-1.5">
                  <Pill tone={ageTone(i.days, 7, 14)} title="Days since it was sent">{ageLabel(i.days)}</Pill>
                  {i.kind === 'bank' && canAct && (
                    <button onClick={() => setMatching(part ? { ...i.row, amount_etb: i.row.net_payable } : i.row)} className="inline-flex items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-700">
                      <Landmark className="h-3 w-3" /> Match
                    </button>
                  )}
                  {i.kind === 'cash' && canAct && (
                    <button onClick={() => confirmCash(r.id)} disabled={confirming === r.id}
                      className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">
                      <Receipt className="h-3 w-3" /> {confirming === r.id ? 'Confirming…' : 'Confirm cash'}
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

      {matching && (
        <MatchTransferModal row={matching} onClose={() => setMatching(null)}
          onMatched={() => { setMatching(null); toast('Matched to the bank line — paid', 'success'); refresh() }}
          onError={msg => toast(msg, 'error')} />
      )}
      {vrfRow && (
        <VrfPayModal row={vrfRow} onClose={() => setVrfRow(null)}
          onLinked={() => { setVrfRow(null); toast('Paid via VRF — fund drawn down', 'success'); refresh() }}
          onError={msg => toast(msg, 'error')} />
      )}
    </div>
  )
}
