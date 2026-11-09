import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Check, CircleDashed, Landmark, Receipt, Undo2 } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import { useAccounts } from '@/hooks/useLookups'
import {
  PAID_TO, TAX_LONG, TONE_PILL, billFits, declareReturn, etb, etb2, longDate, payReturn, returnAmount, stateLabel, undoReturn, useTaxRefresh,
  whenText, type GovBill, type TaxReturn,
} from '@/lib/taxes'

const input = 'w-full rounded-md border bg-white px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
const btn = 'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50'
const primary = `${btn} bg-brand text-white hover:bg-brand/90`
const ghost = `${btn} border text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700`

/**
 * One return: what the books say, what was declared, what was paid — and
 * the one or two clicks that record it. Declaring takes the books' figure
 * unless told otherwise; paying picks the government bill that paid it.
 */
export function ReturnCard({ r, today, canRecord, bills, breakdown, children }: {
  r: TaxReturn
  today: string
  canRecord: boolean
  bills: GovBill[]
  breakdown?: ReactNode
  children?: ReactNode
}) {
  const { toast } = useToast()
  const refresh = useTaxRefresh()
  const [open, setOpen] = useState<'declare' | 'pay' | null>(null)
  const [busy, setBusy] = useState(false)
  const st = stateLabel(r, today)
  const books = r.books
  const declared = r.declared != null
  const paidFull = r.state === 'done'
  const recordable = canRecord && r.state !== 'future'

  async function run(fn: () => Promise<void>, ok: string) {
    setBusy(true)
    try { await fn(); toast(ok, 'success'); setOpen(null); refresh() } catch (e) { toast((e as Error).message, 'error') }
    setBusy(false)
  }

  return (
    <section className="rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800" aria-label={TAX_LONG[r.code]}>
      <header className="flex flex-wrap items-start justify-between gap-2 border-b px-4 py-3 dark:border-slate-700">
        <div className="min-w-0">
          <h3 className="font-semibold text-slate-800 dark:text-slate-100">{TAX_LONG[r.code]}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {r.code === 'SCH_C' ? `For the year · ` : ''}{r.due ? <>Due {longDate(r.due)}{r.state !== 'done' && r.state !== 'future' ? ` (${whenText(r.due, today)})` : ''}</> : 'No due date'} · Paid to {PAID_TO[r.code]}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE_PILL[st.tone]}`}>{st.text}</span>
      </header>

      <ol className="grid grid-cols-1 divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0 dark:divide-slate-700">
        <Step n={1} done={books != null} title="The books say"
          value={books == null ? 'From the year’s accounts' : r.state === 'running' ? `${etb(books)} so far` : etb(books)}>
          {breakdown}
        </Step>
        <Step n={2} done={declared} title="Declared"
          value={declared ? etb(r.declared) : '—'}
          note={declared ? [r.declared === 0 ? 'Nil return' : null, r.reference ? `Ref ${r.reference}` : null, r.declared_on ? longDate(r.declared_on) : null].filter(Boolean).join(' · ') : null}
          warn={declared && books != null && Math.abs(Number(r.declared) - books) > 1 ? `The books now say ${etb(books)}` : null}
          undo={recordable && declared && !r.paid ? () => { if (window.confirm('Undo this declaration?')) run(() => undoReturn(r.id, 'declaration'), 'Declaration undone') } : undefined} />
        <Step n={3} done={paidFull && !!r.paid} title="Paid"
          value={r.paid ? etb(r.paid) : declared && r.declared === 0 ? 'Nothing to pay' : '—'}
          note={r.paid ? [r.paid_on ? longDate(r.paid_on) : null, r.paid_by_code ? `by ${r.paid_by_code}` : r.paid_from_name ? `from ${r.paid_from_name}` : null].filter(Boolean).join(' · ') : null}
          link={r.paid_by_expense ? `/expenses/${r.paid_by_expense}` : undefined}
          warn={r.paid && declared && Number(r.paid) < Number(r.declared) - 1 ? `${etb(Number(r.declared) - Number(r.paid))} still to pay` : null}
          undo={recordable && r.paid ? () => { if (window.confirm('Undo this payment?')) run(() => undoReturn(r.id, 'payment'), 'Payment undone') } : undefined} />
      </ol>

      {recordable && r.state !== 'done' && (
        <div className="space-y-3 border-t px-4 py-3 dark:border-slate-700">
          {!open && (
            <div className="flex flex-wrap items-center gap-2">
              {!declared && books != null && (
                <button type="button" disabled={busy} className={primary}
                  onClick={() => run(() => declareReturn(r.id, Math.round(books * 100) / 100, null, null), books === 0 ? 'Declared nil' : `Declared ${etb(books)}`)}>
                  <Check className="h-4 w-4" />{books === 0 ? 'Mark declared: nil' : `Mark declared: ${etb(books)}`}
                </button>
              )}
              {!declared && <button type="button" className={ghost} onClick={() => setOpen('declare')}>{books == null ? 'Record the declaration' : 'Another amount or a reference'}</button>}
              {(declared ? Number(r.declared) > 0 : true) && (
                <button type="button" className={declared ? primary : ghost} onClick={() => setOpen('pay')}>
                  <Receipt className="h-4 w-4" /> {declared ? 'Record the payment' : 'Already paid'}
                </button>
              )}
            </div>
          )}
          {open === 'declare' && <DeclareForm r={r} today={today} busy={busy} onCancel={() => setOpen(null)}
            onSave={(amount, ref, on) => run(() => declareReturn(r.id, amount, ref, on), 'Declaration saved')} />}
          {open === 'pay' && <PayForm r={r} bills={bills} busy={busy} onCancel={() => setOpen(null)}
            onSave={(amount, on, by) => run(() => payReturn(r.id, amount, on, by), 'Payment recorded')} />}
        </div>
      )}
      {children && <div className="border-t px-4 py-3 dark:border-slate-700">{children}</div>}
    </section>
  )
}

function Step({ n, done, title, value, note, warn, link, undo, children }: {
  n: number; done: boolean; title: string; value: string; note?: string | null; warn?: string | null
  link?: string; undo?: () => void; children?: ReactNode
}) {
  return (
    <li className="min-w-0 px-4 py-3">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {done ? <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden /> : <CircleDashed className="h-3.5 w-3.5 text-slate-300" aria-hidden />}
        <span className="sr-only">Step {n}: </span>{title}
      </p>
      <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900 dark:text-slate-50">{value}</p>
      {note && (link ? <Link to={link} className="block truncate text-xs text-brand hover:underline">{note}</Link>
        : <p className="truncate text-xs text-slate-500 dark:text-slate-400">{note}</p>)}
      {warn && <p className="text-xs font-medium text-amber-700 dark:text-amber-300">{warn}</p>}
      {undo && (
        <button type="button" onClick={undo} className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
          <Undo2 className="h-3 w-3" /> Undo
        </button>
      )}
      {children && <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">{children}</div>}
    </li>
  )
}

function DeclareForm({ r, today, busy, onCancel, onSave }: {
  r: TaxReturn; today: string; busy: boolean; onCancel: () => void; onSave: (amount: number, ref: string | null, on: string) => void
}) {
  const [amount, setAmount] = useState(r.books != null ? String(Math.round(r.books * 100) / 100) : '')
  const [ref, setRef] = useState(r.reference ?? '')
  const [on, setOn] = useState(today)
  const n = Number(amount)
  return (
    <form className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end" onSubmit={e => { e.preventDefault(); if (amount !== '' && n >= 0) onSave(n, ref.trim() || null, on) }}>
      <label className="text-xs text-slate-600 dark:text-slate-300">Declared (ETB)
        <input className={input} type="number" min={0} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} required autoFocus />
      </label>
      <label className="text-xs text-slate-600 dark:text-slate-300">Reference from the portal <span className="text-slate-400">(if any)</span>
        <input className={input} value={ref} onChange={e => setRef(e.target.value)} placeholder="e.g. 2019-01-VAT-…" />
      </label>
      <label className="text-xs text-slate-600 dark:text-slate-300">On
        <input className={input} type="date" value={on} onChange={e => setOn(e.target.value)} max={today} />
      </label>
      <div className="flex gap-2">
        <button type="button" className={ghost} onClick={onCancel}>Cancel</button>
        <button type="submit" className={primary} disabled={busy || amount === '' || n < 0}>Save</button>
      </div>
    </form>
  )
}

function PayForm({ r, bills, busy, onCancel, onSave }: {
  r: TaxReturn; bills: GovBill[]; busy: boolean; onCancel: () => void
  onSave: (amount: number, on: string | null, by: { expense?: string; account?: string }) => void
}) {
  const fits = billFits(r, bills)
  const best = fits.find(f => f.score >= 3)
  const { data: accounts = [] } = useAccounts()
  const owed = Number(r.declared ?? r.books ?? 0)
  const [by, setBy] = useState<string>(best ? `bill:${best.bill.id}` : fits[0] ? `bill:${fits[0].bill.id}` : 'bank')
  const bill = by.startsWith('bill:') ? bills.find(b => b.id === by.slice(5)) : undefined
  const [account, setAccount] = useState('')
  const [amount, setAmount] = useState(String(Math.round((owed || returnAmount(r)) * 100) / 100))
  const [on, setOn] = useState('')
  const n = Number(amount)
  const tooBig = bill && n > bill.left + 1

  return (
    <form className="space-y-3" onSubmit={e => {
      e.preventDefault()
      if (!(n > 0) || tooBig) return
      if (bill) onSave(n, on || null, { expense: bill.id })
      else if (account) onSave(n, on || null, { account })
    }}>
      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-300">What paid it? The Government Expense bill for the e-money payment</legend>
        {fits.length === 0 && <p className="text-xs text-slate-500">No Government Expense bill around this month has anything left to tie. Record the e-money payment as a Government Expense first, or pick a bank account below.</p>}
        {fits.slice(0, 6).map(({ bill: b, score, reasons }) => (
          <label key={b.id} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm ${by === `bill:${b.id}` ? 'border-brand bg-brand/5' : 'dark:border-slate-600'}`}>
            <input type="radio" name={`by-${r.id}`} className="mt-1" checked={by === `bill:${b.id}`} onChange={() => { setBy(`bill:${b.id}`); setAmount(String(Math.min(b.left, owed || b.left))) }} />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-xs font-semibold text-brand">{b.code ?? 'Bill'}</span>
                <span className="truncate text-slate-700 dark:text-slate-200">{b.description?.trim() || '—'}</span>
              </span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                {longDate(b.date)}{b.payee ? ` · ${b.payee}` : ''} · {etb2(b.amount)}{b.left < b.amount - 0.5 ? ` · ${etb2(b.left)} left` : ''}
                {b.payment_state && b.payment_state !== 'paid' ? ' · not paid yet' : ''}
              </span>
              {score > 0 && <span className="mt-0.5 inline-block rounded bg-emerald-50 px-1.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">Fits: {reasons.join(', ')}</span>}
            </span>
          </label>
        ))}
        <label className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm ${by === 'bank' ? 'border-brand bg-brand/5' : 'dark:border-slate-600'}`}>
          <input type="radio" name={`by-${r.id}`} className="mt-1" checked={by === 'bank'} onChange={() => setBy('bank')} />
          <span className="flex-1">
            <span className="flex items-center gap-1.5 text-slate-700 dark:text-slate-200"><Landmark className="h-3.5 w-3.5" /> Straight from a bank account, with no bill</span>
            {by === 'bank' && (
              <select className={`${input} mt-1.5`} value={account} onChange={e => setAccount(e.target.value)} required aria-label="Bank account">
                <option value="">Pick the account…</option>
                {(accounts as { id: string; account_name: string }[]).map(a => <option key={a.id} value={a.id}>{a.account_name}</option>)}
              </select>
            )}
          </span>
        </label>
      </fieldset>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="text-xs text-slate-600 dark:text-slate-300">Paid (ETB)
          <input className={input} type="number" min={0} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} required />
        </label>
        <label className="text-xs text-slate-600 dark:text-slate-300">On <span className="text-slate-400">({bill ? 'the bill’s date if blank' : 'today if blank'})</span>
          <input className={input} type="date" value={on} onChange={e => setOn(e.target.value)} />
        </label>
        <div className="flex gap-2">
          <button type="button" className={ghost} onClick={onCancel}>Cancel</button>
          <button type="submit" className={primary} disabled={busy || !(n > 0) || !!tooBig || (by === 'bank' && !account)}>Save</button>
        </div>
      </div>
      {tooBig && <p className="text-xs text-red-600">That bill has only {etb2(bill!.left)} left.</p>}
      {!r.declared && <p className="text-xs text-slate-500">Paying it declares it at the amount paid; change the declaration after if it differs.</p>}
    </form>
  )
}
