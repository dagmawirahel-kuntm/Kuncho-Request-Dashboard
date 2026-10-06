import { useState } from 'react'
import { CheckCircle2, HandCoins, Landmark, Layers, Receipt, RotateCcw, Undo2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { btn } from '@/lib/ui/button'
import { Pill, type Tone } from '@/components/record/Record'
import { PaymentRequestActions } from '@/components/shared/PaymentRequestActions'
import { MatchTransferModal } from '@/pages/payments/PaymentModals'
import { PaymentPlanEditor } from '@/components/payments/PaymentPlanEditor'
import { PayPartModal } from '@/components/payments/PayPartModal'
import { usePayerAndAccountOptions, PAYMENT_METHOD_LABEL } from '@/lib/payments'
import {
  PART_KIND_LABEL, PART_STATE_LABEL, WHT_MODE_LABEL, newRowKey, partDueText, savePlan, useExpenseParts, useRefreshParts,
  type PlanRow,
} from '@/lib/expensePayments'
import type { LaborPaymentRequestInput } from '@/lib/laborPaymentRequestDocument'
import type { ExpensePaymentMethod, ExpensePaymentPart, ExpenseWhtMode } from '@/types/database'

// How a bill is being paid, part by part: what went out, what is waiting on
// the bank, what is still planned and when it falls due — with the actions
// for each part and its own Payment Request. A bill still paid in one go
// shows a single "Pay in parts" entry point.

export interface PanelExpense {
  id: string
  expense_code: string | null
  amount_etb: number | null
  credit_applied_etb: number | null
  wht_amount: number | null
  wht_mode?: ExpenseWhtMode | null
  in_parts?: boolean | null
  payment_state: string | null
  approval_status: string | null
  finance_approved_by: string | null
  account_id: string | null
  payment_method: string | null
  sourcing_bundle_id: string | null
  expense_type: string | null
}

const STATE_TONE: Record<string, Tone> = { paid: 'green', sent: 'blue', planned: 'slate', cancelled: 'slate' }

export function ExpensePaymentsPanel({ expense, baseDocument, canAct, isAdmin, canIssue }: {
  expense: PanelExpense
  /** The expense's own Payment Request input; each part's request is built from it. */
  baseDocument: Omit<LaborPaymentRequestInput, 'documentCode' | 'status' | 'revision'> | null
  canAct: boolean
  isAdmin: boolean
  canIssue: boolean
}) {
  const { toast } = useToast()
  const refresh = useRefreshParts()
  const { payerOptions, accountOptions } = usePayerAndAccountOptions()
  const { data: allParts = [] } = useExpenseParts(expense.id)
  const [showReplaced, setShowReplaced] = useState(false)
  const [planning, setPlanning] = useState(false)
  const [paying, setPaying] = useState<ExpensePaymentPart | 'start' | null>(null)
  const [matching, setMatching] = useState<ExpensePaymentPart | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const parts = allParts.filter(p => p.state !== 'cancelled')
  const replaced = allParts.filter(p => p.state === 'cancelled')
  const payable = Number(expense.amount_etb ?? 0) - Number(expense.credit_applied_etb ?? 0)
  const paid = parts.filter(p => p.state === 'paid').reduce((s, p) => s + Number(p.amount_etb), 0)
  const sent = parts.filter(p => p.state === 'sent').reduce((s, p) => s + Number(p.amount_etb), 0)
  const planned = parts.filter(p => p.state === 'planned').reduce((s, p) => s + Number(p.amount_etb), 0)
  const whtMode: ExpenseWhtMode = (expense.wht_mode ?? parts[0]?.expense_wht_mode ?? 'last') as ExpenseWhtMode
  const approved = expense.approval_status === 'finance_approved' && !!expense.finance_approved_by
  const isVrf = expense.expense_type === 'vrf' || expense.payment_method === 'vrf'
  const canStart = canAct && !expense.in_parts && !isVrf && ['unpaid', 'approved_to_pay'].includes(expense.payment_state ?? '')
  const isPo = !!expense.sourcing_bundle_id
  const nextPlanned = parts.find(p => p.state === 'planned')

  // Each part's Payment Request: the bill's document, narrowed to the part,
  // carrying every part and the balance left after this one.
  const partDocument = (p: ExpensePaymentPart) => {
    if (!baseDocument) return null
    const settledBefore = parts.filter(q => q.id !== p.id && (q.state === 'paid' || q.state === 'sent'))
      .reduce((s, q) => s + Number(q.amount_etb), 0)
    return {
      ...baseDocument,
      total: Number(p.amount_etb),
      whtAmount: Number(p.wht_etb) > 0 ? Number(p.wht_etb) : null,
      creditApplied: null,
      creditNote: null,
      installment: {
        partNo: p.part_no, partCount: p.part_count,
        label: p.label || PART_KIND_LABEL[p.kind],
        billTotal: payable, settledBefore, thisAmount: Number(p.amount_etb),
        balanceAfter: Math.max(0, payable - settledBefore - Number(p.amount_etb)),
        whtMode,
        parts: parts.map(q => ({
          no: q.part_no, label: q.label || PART_KIND_LABEL[q.kind],
          due: q.state === 'paid' ? (q.paid_date ? `Paid ${formatDate(q.paid_date)}` : 'Paid')
            : q.state === 'sent' ? (q.sent_at ? `Sent ${formatDate(q.sent_at)}` : 'Sent')
            : partDueText(q, formatDate),
          amount: Number(q.amount_etb), wht: Number(q.wht_etb), state: q.state,
          code: q.prq?.code ?? null, current: q.id === p.id,
        })),
      },
    }
  }

  async function run(id: string, fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) {
    setBusy(id)
    const { error } = await fn()
    setBusy(null)
    if (error) { toast(error.message, 'error'); return }
    toast(ok, 'success'); refresh(expense.id)
  }

  const planRows: PlanRow[] = parts.filter(p => p.state === 'planned').map(p => ({
    key: newRowKey(), value: Number(p.amount_etb), kind: p.kind, due_on: p.due_on, due_date: p.due_date, days: p.due_days, label: p.label ?? '',
  }))
  const kept = parts.filter(p => p.state !== 'planned')

  if (!expense.in_parts && parts.length === 0) {
    if (!canStart) return null
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
        <Layers className="h-4 w-4 text-brand" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold text-slate-800 dark:text-slate-100">Paid in one go</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Split it into an advance, installments or a retention — approved once, each part paid and tracked on its own.</p>
        </div>
        {approved && <button onClick={() => setPaying('start')} className={btn('secondary', 'sm')}><HandCoins className="h-3.5 w-3.5" /> Pay part now</button>}
        <button onClick={() => setPlanning(true)} className={btn('primary', 'sm')}><Layers className="h-3.5 w-3.5" /> Pay in parts</button>
        {planning && (
          <PaymentPlanEditor mode="expense" title={`Pay ${expense.expense_code ?? 'this bill'} in parts`} total={payable}
            wht={Number(expense.wht_amount ?? 0)} allowDelivery={isPo} initialWhtMode={whtMode}
            onSave={async (rows, mode) => { await savePlan(expense.id, rows, mode); setPlanning(false); toast('Payment plan saved', 'success'); refresh(expense.id) }}
            onClose={() => setPlanning(false)} />
        )}
        {paying === 'start' && (
          <PayPartModal target={{ kind: 'start', expenseId: expense.id, payable, wht: Number(expense.wht_amount ?? 0) }}
            title="Pay part of this bill" subtitle={`${expense.expense_code ?? ''} · bill ${formatCurrency(payable)}`}
            approverId={expense.finance_approved_by} defaultPayerId={null} defaultAccountId={expense.account_id}
            defaultMethod={expense.payment_method as ExpensePaymentMethod | null}
            payerOptions={payerOptions} accountOptions={accountOptions}
            onClose={() => setPaying(null)} onDone={() => { setPaying(null); toast('Part sent — the rest stays in the queue', 'success'); refresh(expense.id) }} />
        )}
      </div>
    )
  }

  const pct = (n: number) => `${payable > 0 ? Math.min(100, (n / payable) * 100) : 0}%`

  return (
    <div className="overflow-hidden rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800">
      <div className="space-y-2 border-b px-4 py-3 dark:border-slate-700">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-800 dark:text-slate-100"><Layers className="h-4 w-4 text-brand" /> Paid in parts</h2>
          <Pill tone="violet" title={WHT_MODE_LABEL[whtMode].long}>WHT {WHT_MODE_LABEL[whtMode].short.toLowerCase()}</Pill>
          {canAct && (
            <button onClick={() => setPlanning(true)} className={btn('ghost', 'sm', 'ml-auto')}>{planned > 0 ? 'Change plan' : 'Plan'}</button>
          )}
        </div>
        <div className="flex h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700" role="img"
          aria-label={`Paid ${formatCurrency(paid)}, sent ${formatCurrency(sent)}, planned ${formatCurrency(planned)} of ${formatCurrency(payable)}`}>
          <div className="bg-emerald-500" style={{ width: pct(paid) }} />
          <div className="bg-sky-500" style={{ width: pct(sent) }} />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
          <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500" />Paid <b className="tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(paid)}</b></span>
          {sent > 0 && <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-sky-500" />Sent <b className="tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(sent)}</b></span>}
          <span>Balance <b className="tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(payable - paid)}</b> of {formatCurrency(payable)}</span>
        </div>
      </div>

      <ol className="divide-y dark:divide-slate-700">
        {parts.map(p => {
          const doc = partDocument(p)
          const bankMethod = ['transfer', 'cpo', 'cheque'].includes(p.payment_method ?? '')
          return (
            <li key={p.id} className={`flex gap-3 px-4 py-3 ${p.id === nextPlanned?.id ? 'bg-brand/5' : ''}`}>
              <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                p.state === 'paid' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                : p.state === 'sent' ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'
                : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300'}`}>
                {p.state === 'paid' ? <CheckCircle2 className="h-3.5 w-3.5" /> : p.part_no}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium text-slate-800 dark:text-slate-100">{p.label || PART_KIND_LABEL[p.kind]}</span>
                  {p.label && p.label !== PART_KIND_LABEL[p.kind] && <span className="text-xs text-slate-400">{PART_KIND_LABEL[p.kind]}</span>}
                  <Pill tone={STATE_TONE[p.state]}>{PART_STATE_LABEL[p.state]}</Pill>
                  {p.state === 'planned' && <span className={`text-xs ${p.is_due ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-slate-500'}`}>{partDueText(p, formatDate)}</span>}
                </div>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {p.state !== 'planned' && [
                    p.payment_method ? (PAYMENT_METHOD_LABEL[p.payment_method] ?? p.payment_method) : null,
                    p.account_name, p.disbursed_by_name ? `by ${p.disbursed_by_name}` : null,
                    p.sent_at ? `sent ${formatDate(p.sent_at)}` : null,
                    p.paid_date ? `paid ${formatDate(p.paid_date)}` : null,
                    p.transfer_id_code ?? p.bank_ref,
                  ].filter(Boolean).join(' · ')}
                  {p.legacy_entry && ' · paid before parts existed'}
                </p>
                {p.note && <p className="mt-0.5 whitespace-pre-line text-[11px] text-slate-400">{p.note}</p>}
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {canAct && p.state === 'planned' && approved && (
                    <button onClick={() => setPaying(p)} className={btn('primary', 'sm')}><HandCoins className="h-3 w-3" /> Pay part {p.part_no}</button>
                  )}
                  {canAct && p.state === 'planned' && !approved && <span className="text-[11px] text-slate-400">Waits for finance approval of the bill</span>}
                  {canAct && p.state === 'sent' && bankMethod && (
                    <button onClick={() => setMatching(p)} className={btn('info', 'sm')}><Landmark className="h-3 w-3" /> Match bank line</button>
                  )}
                  {canAct && p.state === 'sent' && !bankMethod && (
                    <button disabled={busy === p.id} onClick={() => run(p.id, () => supabase.rpc('confirm_expense_part_cash', { p_payment_id: p.id }), `Part ${p.part_no} confirmed paid`)}
                      className={btn('success', 'sm')}><Receipt className="h-3 w-3" /> Confirm paid</button>
                  )}
                  {canAct && p.state === 'sent' && !p.transfer_id && (
                    <button disabled={busy === p.id} onClick={() => run(p.id, () => supabase.rpc('unsend_expense_part', { p_payment_id: p.id }), `Part ${p.part_no} taken back`)}
                      className={btn('ghost', 'sm')}><Undo2 className="h-3 w-3" /> Take back</button>
                  )}
                  {isAdmin && p.state === 'paid' && !p.transfer_id && !p.legacy_entry && (
                    <button disabled={busy === p.id} onClick={() => {
                      const reason = window.prompt(`Why reverse part ${p.part_no}? The books get a reversing entry.`)
                      if (reason?.trim()) void run(p.id, () => supabase.rpc('reverse_expense_part', { p_payment_id: p.id, p_reason: reason.trim() }), `Part ${p.part_no} reversed`)
                    }} className={btn('ghost', 'sm', 'text-red-600')}><RotateCcw className="h-3 w-3" /> Reverse</button>
                  )}
                  {canIssue && doc && !p.legacy_entry && (
                    <PaymentRequestActions compact sourceType="expense" sourceId={expense.id} partId={p.id} document={doc}
                      label={`PRQ part ${p.part_no}`} />
                  )}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(Number(p.cash_etb))}</p>
                {Number(p.wht_etb) > 0 && <p className="text-[10px] tabular-nums text-slate-400">{formatCurrency(Number(p.amount_etb))} − WHT {formatCurrency(Number(p.wht_etb))}</p>}
              </div>
            </li>
          )
        })}
      </ol>

      {replaced.length > 0 && (
        <div className="border-t px-4 py-2 text-xs dark:border-slate-700">
          <button onClick={() => setShowReplaced(v => !v)} className="text-slate-500 hover:text-brand">
            {showReplaced ? 'Hide' : 'Show'} {replaced.length} replaced part{replaced.length === 1 ? '' : 's'}
          </button>
          {showReplaced && (
            <ul className="mt-1 space-y-0.5 text-slate-400">
              {replaced.map(p => <li key={p.id} className="line-through">{p.label || PART_KIND_LABEL[p.kind]} · {formatCurrency(Number(p.amount_etb))}{p.prq?.code ? ` · ${p.prq.code}` : ''}</li>)}
            </ul>
          )}
        </div>
      )}

      {planning && (
        <PaymentPlanEditor mode="expense" title={`Payment plan · ${expense.expense_code ?? ''}`} total={payable}
          wht={Number(expense.wht_amount ?? 0)} allowDelivery={isPo} initialWhtMode={whtMode}
          kept={{ amount: kept.reduce((s, p) => s + Number(p.amount_etb), 0), wht: kept.reduce((s, p) => s + Number(p.wht_etb), 0), count: kept.length }}
          initialRows={planRows.length ? planRows : undefined}
          canClear={kept.length === 0}
          onSave={async (rows, mode) => { await savePlan(expense.id, rows, mode); setPlanning(false); toast('Payment plan saved', 'success'); refresh(expense.id) }}
          onClear={async () => { await savePlan(expense.id, [], whtMode); setPlanning(false); toast('Back to paying in one go', 'success'); refresh(expense.id) }}
          onClose={() => setPlanning(false)} />
      )}
      {paying && paying !== 'start' && (
        <PayPartModal
          target={{ kind: 'part', partId: paying.id, partNo: paying.part_no, partCount: paying.part_count, partKind: paying.kind,
            label: paying.label, amount: Number(paying.amount_etb), wht: Number(paying.wht_etb), whtMode }}
          title={`Pay part ${paying.part_no} of ${paying.part_count}`} subtitle={expense.expense_code}
          approverId={expense.finance_approved_by} defaultPayerId={null} defaultAccountId={expense.account_id}
          defaultMethod={expense.payment_method as ExpensePaymentMethod | null}
          payerOptions={payerOptions} accountOptions={accountOptions}
          onClose={() => setPaying(null)}
          onDone={() => { setPaying(null); toast('Part sent — confirm it against the bank statement', 'success'); refresh(expense.id) }} />
      )}
      {matching && (
        <MatchTransferModal
          row={{ id: expense.id, amount_etb: Number(matching.cash_etb), batch_payment_id: null, part_id: matching.id, part_no: matching.part_no, part_count: matching.part_count }}
          onClose={() => setMatching(null)}
          onMatched={() => { setMatching(null); toast('Matched to the bank line — part paid', 'success'); refresh(expense.id) }}
          onError={msg => toast(msg, 'error')} />
      )}
    </div>
  )
}
