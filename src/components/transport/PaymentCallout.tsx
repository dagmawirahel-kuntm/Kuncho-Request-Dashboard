import { Link } from 'react-router-dom'
import { formatCurrency } from '@/lib/utils'
import { PAY_STAGE, payStageOf } from '@/lib/transport'
import { Check, FileText, Receipt, Send } from 'lucide-react'

// A hired or ride-hailing trip is paid through a payment request — an
// expense that finance approves, with its printable request document. This
// card sits at the top of the job so the request isn't forgotten: a loud
// call to raise it while there is none, then where it stands and the
// document one click away.

interface LinkedExpense { id: string; expense_code: string | null; amount_etb: number | null; payment_state: string | null }

const STEPS = [
  { key: 'waiting', label: 'Requested' },
  { key: 'approved', label: 'Approved' },
  { key: 'sent', label: 'Sent' },
  { key: 'paid', label: 'Paid' },
] as const

export function PaymentCallout({ jobId, mode, jobStatus, amount, expense }: {
  jobId: string
  mode: string
  jobStatus: string
  amount: number | null | undefined
  expense: LinkedExpense | null | undefined
}) {
  if (mode === 'own_fleet' || (jobStatus === 'cancelled' && !expense)) return null

  if (!expense) {
    const done = jobStatus === 'completed'
    return (
      <div className="relative overflow-hidden rounded-xl border-2 border-amber-400 bg-gradient-to-r from-amber-50 to-orange-50 p-4 shadow-sm dark:border-amber-600 dark:from-amber-900/20 dark:to-orange-900/10">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white shadow"><Receipt className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold text-amber-950 dark:text-amber-100">{done ? 'This trip still needs a payment request' : 'Raise the payment request for this trip'}</p>
            <p className="text-sm text-amber-900/80 dark:text-amber-200/80">
              {done ? 'It is delivered but nobody asked for the money yet — the driver is waiting.' : 'Do it now and it is approved by the time the trip is done.'}
              {amount ? <> Estimated <b>{formatCurrency(amount)}</b>.</> : null}
            </p>
          </div>
          <Link to={`/transportation/${jobId}/pay`} className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-amber-600 px-5 py-2.5 text-sm font-bold text-white shadow hover:bg-amber-700">
            <Send className="h-4 w-4" /> Request payment
          </Link>
        </div>
      </div>
    )
  }

  const stage = payStageOf(mode, expense)
  const at = STEPS.findIndex(s => s.key === stage)
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"><Receipt className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Payment request <span className="font-mono text-brand">{expense.expense_code ?? ''}</span>
            {expense.amount_etb != null && <> · {formatCurrency(expense.amount_etb)}</>}
          </p>
          <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${PAY_STAGE[stage].cls}`}>{PAY_STAGE[stage].label}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/expenses/${expense.id}?prq=open`} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand/90">
            <FileText className="h-4 w-4" /> Payment request document
          </Link>
          <Link to={`/expenses/${expense.id}`} className="inline-flex items-center rounded-lg border px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">Open expense</Link>
        </div>
      </div>
      <ol className="mt-3 flex items-center gap-1">
        {STEPS.map((s, i) => (
          <li key={s.key} className="flex flex-1 items-center gap-1">
            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${i <= at ? 'bg-emerald-500 text-white' : 'border border-slate-300 text-slate-400 dark:border-slate-600'}`}>
              {i <= at ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            <span className={`text-[11px] ${i <= at ? 'font-medium text-slate-700 dark:text-slate-200' : 'text-slate-400'}`}>{s.label}</span>
            {i < STEPS.length - 1 && <span className={`mx-1 h-0.5 flex-1 ${i < at ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}`} />}
          </li>
        ))}
      </ol>
    </div>
  )
}
