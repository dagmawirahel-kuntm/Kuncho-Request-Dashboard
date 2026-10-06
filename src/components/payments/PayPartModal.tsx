import { useState } from 'react'
import { HandCoins, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import { btn } from '@/lib/ui/button'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { FormattedNumberInput } from '@/components/shared/FormattedNumberInput'
import { PAYMENT_METHODS } from '@/lib/payments'
import { PART_KIND_LABEL, WHT_MODE_LABEL } from '@/lib/expensePayments'
import type { ExpensePartKind, ExpensePaymentMethod, ExpenseWhtMode } from '@/types/database'

// Sends money against a bill: one planned part (all of it, or less — the
// rest stays planned right after it), or, for a bill still paid in one go,
// a first part now with the rest left as the final part. Either way the
// payment is "sent" until the bank line is matched or the cash confirmed.

export type PayTarget =
  | { kind: 'part'; partId: string; partNo: number; partCount: number; partKind: ExpensePartKind; label: string | null
      amount: number; wht: number; whtMode: ExpenseWhtMode }
  | { kind: 'start'; expenseId: string; payable: number; wht: number }

interface Props {
  target: PayTarget
  title: string
  subtitle?: string | null
  approverId: string | null
  defaultPayerId: string | null
  defaultAccountId: string | null
  defaultMethod?: ExpensePaymentMethod | null
  payerOptions: { id: string; label: string }[]
  accountOptions: { id: string; label: string; sub?: string }[]
  onClose: () => void
  onDone: () => void
}

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const METHODS = PAYMENT_METHODS.filter(m => m.value !== 'vrf')

export function PayPartModal({
  target, title, subtitle, approverId, defaultPayerId, defaultAccountId, defaultMethod,
  payerOptions, accountOptions, onClose, onDone,
}: Props) {
  const full = target.kind === 'part' ? target.amount : target.payable
  const [payerId, setPayerId] = useState<string | null>(defaultPayerId && defaultPayerId !== approverId ? defaultPayerId : null)
  const [method, setMethod] = useState<ExpensePaymentMethod>(defaultMethod && defaultMethod !== 'vrf' ? defaultMethod : 'transfer')
  const [accountId, setAccountId] = useState<string | null>(defaultAccountId)
  const [amount, setAmount] = useState<number | null>(target.kind === 'part' ? target.amount : null)
  const [bankRef, setBankRef] = useState('')
  const [note, setNote] = useState('')
  const [whtMode, setWhtMode] = useState<ExpenseWhtMode>('last')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const amt = Number(amount ?? 0)
  const short = target.kind === 'part' ? amt > 0 && amt < target.amount - 0.005 : true
  // The withholding this payment carries, the way the database will place it.
  const wht = target.kind === 'part'
    ? (target.whtMode === 'each'
        ? (short ? Math.round(target.wht * amt / (target.amount || 1) * 100) / 100 : target.wht)
        : (short ? 0 : target.wht))
    : (whtMode === 'each' ? Math.round(target.wht * amt / (target.payable || 1) * 100) / 100 : 0)
  const cash = Math.max(0, amt - wht)
  const tooMuch = target.kind === 'part' ? amt > target.amount + 0.005 : amt >= target.payable - 0.005
  const selfPay = !!payerId && payerId === approverId
  const needsAccount = ['transfer', 'cpo', 'cheque'].includes(method)
  const valid = amt > 0 && !tooMuch && !!payerId && !selfPay && (!needsAccount || !!accountId)

  async function submit() {
    if (!valid) return
    setSaving(true); setError(null)
    const { error: e } = target.kind === 'part'
      ? await supabase.rpc('pay_expense_part', {
          p_payment_id: target.partId, p_disbursed_by: payerId, p_method: method, p_account_id: accountId,
          p_amount: amt, p_bank_ref: bankRef.trim() || null, p_note: note.trim() || null,
        })
      : await supabase.rpc('pay_expense_amount', {
          p_expense_id: target.expenseId, p_amount: amt, p_disbursed_by: payerId, p_method: method,
          p_account_id: accountId, p_bank_ref: bankRef.trim() || null, p_note: note.trim() || null, p_wht_mode: whtMode,
        })
    setSaving(false)
    if (e) { setError(e.message); return }
    onDone()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-xl dark:bg-slate-800" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b px-5 py-3 dark:border-slate-700">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-100"><HandCoins className="h-4 w-4 text-brand" /> {title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-3 px-5 py-4">
          {target.kind === 'part' && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Part {target.partNo} of {target.partCount} · {target.label || PART_KIND_LABEL[target.partKind]} · {formatCurrency(target.amount)}
              {target.wht > 0 && <> · WHT {formatCurrency(target.wht)}</>}
            </p>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
              {target.kind === 'part' ? 'Pay now' : 'Pay now — the rest stays in the queue as the final part'}
            </label>
            <FormattedNumberInput value={amount} onChange={n => setAmount(n ?? null)} className={inputCls} placeholder={target.kind === 'part' ? undefined : `Less than ${formatCurrency(full)}`} />
            {tooMuch && <p className="mt-1 text-[11px] text-red-600">{target.kind === 'part' ? 'More than this part — change the plan to pay more now.' : 'That is the whole bill — pay it the usual way.'}</p>}
            {target.kind === 'part' && short && amt > 0 && (
              <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">Paying less: {formatCurrency(target.amount - amt)} stays planned as the next part.</p>
            )}
          </div>

          {target.kind === 'start' && target.wht > 0 && (
            <div className="grid gap-1.5">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Withholding ({formatCurrency(target.wht)})</span>
              {(['last', 'each'] as ExpenseWhtMode[]).map(m => (
                <label key={m} className={`flex cursor-pointer gap-2 rounded-md border p-2 text-xs ${whtMode === m ? 'border-brand bg-brand/5' : 'dark:border-slate-600'}`}>
                  <input type="radio" checked={whtMode === m} onChange={() => setWhtMode(m)} className="mt-0.5" />
                  <span><b className="text-slate-700 dark:text-slate-200">{WHT_MODE_LABEL[m].short}</b> <span className="text-slate-500">— {WHT_MODE_LABEL[m].long}</span></span>
                </label>
              ))}
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Who is paying</label>
            <SearchableSelect value={payerId} onChange={setPayerId} options={payerOptions} placeholder="Select payer…" />
            {selfPay && <p className="mt-1 text-[11px] text-red-600">They approved this bill — someone else has to pay it.</p>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Method</label>
              <select value={method} onChange={e => setMethod(e.target.value as ExpensePaymentMethod)} className={inputCls}>
                {METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Bank reference</label>
              <input value={bankRef} onChange={e => setBankRef(e.target.value)} placeholder="Optional" className={inputCls} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Paid from{needsAccount ? '' : ' (optional)'}</label>
            <SearchableSelect value={accountId} onChange={setAccountId} options={accountOptions} placeholder="Select account…" />
          </div>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" className={inputCls} />

          <div className="rounded-lg border bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/40">
            <p className="text-xs text-slate-500 dark:text-slate-400">Send</p>
            <p className="text-lg font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(cash)}</p>
            {wht > 0 && <p className="text-[11px] tabular-nums text-slate-400">{formatCurrency(amt)} less WHT {formatCurrency(wht)}</p>}
            <p className="mt-1 text-[11px] text-slate-400">It stays “sent” until the bank line is matched{method === 'cash' ? ' or the cash is confirmed' : ''}.</p>
          </div>
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-300">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t px-5 py-3 dark:border-slate-700">
          <button onClick={onClose} className={btn('secondary')}>Cancel</button>
          <button onClick={submit} disabled={!valid || saving} className={btn('primary')}>{saving ? 'Sending…' : 'Mark as sent'}</button>
        </div>
      </div>
    </div>
  )
}
