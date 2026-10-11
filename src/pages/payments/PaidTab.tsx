import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatCurrency, formatDate } from '@/lib/utils'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Pill, type Tone } from '@/components/record/Record'
import type { BankCheckProblem, BankCheckStatus, RecentPaymentRow } from '@/types/database'
import { PAYMENT_METHOD_LABEL, isBankMethod, usePaymentBankChecks } from '@/lib/payments'

// What moved this week, newest first — and, for money paid by bank, whether
// the statement shows it yet (v_payment_bank_check, migration 440).

const CHECK: Record<BankCheckStatus, { label: string; tone: Tone; title: string }> = {
  confirmed: { label: 'On the statement', tone: 'green', title: 'The bank statement shows this payment, at its amount' },
  not_checked: { label: 'Statement not in yet', tone: 'slate', title: 'No imported statement covers this date yet' },
  before_statements: { label: 'Before the statements', tone: 'slate', title: 'Paid before the first imported statement' },
  problem: { label: 'Check it', tone: 'red', title: 'The statement does not agree — see the bank audit' },
}
const PROBLEM: Record<BankCheckProblem, string> = {
  amount: 'Amount doesn’t tie',
  duplicate_ref: 'Reference used twice',
  not_in_bank: 'Not on the statement',
}

export default function PaidTab({ recent }: { recent: RecentPaymentRow[] }) {
  const [method, setMethod] = useState('all')
  const methods = [...new Set(recent.map(r => r.payment_method ?? 'unset'))]
  const shown = method === 'all' ? recent : recent.filter(r => (r.payment_method ?? 'unset') === method)
  const total = shown.reduce((s, r) => s + Number(r.net_payable ?? r.amount_etb ?? 0), 0)

  const banked = useMemo(() => recent.filter(r => r.payment_state !== 'sent' && isBankMethod(r.payment_method)), [recent])
  const { data: checks } = usePaymentBankChecks(
    banked.filter(r => !r.batch_payment_id).map(r => r.id),
    [...new Set(banked.map(r => r.batch_payment_id).filter((x): x is string => !!x))],
  )
  const checkOf = (r: RecentPaymentRow) => !checks || !isBankMethod(r.payment_method) || r.payment_state === 'sent' ? undefined
    : r.batch_payment_id ? checks.batches.get(r.batch_payment_id) : checks.expenses.get(r.id)

  if (!recent.length) return <p className="py-12 text-center text-sm text-slate-500">Nothing sent or paid this week yet.</p>
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1">
        {['all', ...methods].map(m => (
          <button key={m} onClick={() => setMethod(m)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${method === m ? 'border-brand bg-brand/10 text-brand' : 'text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>
            {m === 'all' ? 'All' : m === 'unset' ? 'No method' : PAYMENT_METHOD_LABEL[m] ?? m}
          </button>
        ))}
        <span className="ml-auto text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(total)}</span>
      </div>
      <ul className="divide-y overflow-hidden rounded-xl border bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800">
        {shown.map(r => {
          const c = checkOf(r)
          const meta = c ? CHECK[c.status] : null
          return (
            <li key={r.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <Link to={`/expenses/${r.id}`} className="block truncate font-medium text-slate-800 hover:text-brand hover:underline dark:text-slate-100">{r.vendor_name ?? r.item_service_description ?? r.expense_code}</Link>
                <p className="truncate text-xs text-slate-500">
                  {formatDate(r.payment_state_changed_at)} · {r.payment_method ? (PAYMENT_METHOD_LABEL[r.payment_method] ?? r.payment_method) : '—'}
                  {r.transfer_id_code ? ` · ${r.transfer_id_code}` : c?.bank_ref ? ` · ${c.bank_ref}` : ''}{r.vrf_record_name ? ` · ${r.vrf_record_name}` : ''}{r.batch_payment_id && !r.transfer_id_code ? ' · in a batch' : ''}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                <p className="font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(r.net_payable ?? r.amount_etb ?? 0)}</p>
                <div className="flex flex-wrap items-center justify-end gap-1">
                  {meta && c && (
                    c.status === 'problem'
                      ? <Link to="/bank-statement-import?tab=audit"><Pill tone={meta.tone} title={meta.title}>{c.problem ? PROBLEM[c.problem] : meta.label}</Pill></Link>
                      : <Pill tone={meta.tone} title={c.line_date ? `${meta.title} (${formatDate(c.line_date)})` : meta.title}>{meta.label}</Pill>
                  )}
                  <StatusBadge status={r.payment_state} />
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
