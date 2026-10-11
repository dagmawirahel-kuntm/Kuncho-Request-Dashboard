import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { HandCoins, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { btn } from '@/lib/ui/button'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { BankProofFields } from '@/components/payments/BankProofFields'
import { PAYMENT_METHODS, emptyProof, isBankMethod, type PayResult, type ProofValue } from '@/lib/payments'
import type { ExpensePaymentMethod } from '@/types/database'

// Pays one approved bill (pay_expense, migration 442). By bank with the FT
// reference from the slip it is paid there and then — paid ahead, for a
// pay-in-advance order — and the books post on that day; the statement
// checks it when it comes in. Without the reference it is sent and waits on
// To confirm. Cash is confirmed once it is handed over, as before.

export interface PayBillTarget {
  id: string
  title: string
  code: string | null
  approverId: string | null
  /** A pay-in-advance order: paid ahead, closed by its GRN. */
  advance: boolean
  gross: number | null
  wht: number | null
  credit: number | null
}

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const labelCls = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300'

export function PayBillModal({ target, defaultPayerId, defaultMethod, payerOptions, accountOptions, onClose, onDone }: {
  target: PayBillTarget
  defaultPayerId: string | null
  defaultMethod: ExpensePaymentMethod
  payerOptions: { id: string; label: string }[]
  accountOptions: { id: string; label: string; sub?: string }[]
  onClose: () => void
  onDone: (result: PayResult, method: ExpensePaymentMethod) => void
}) {
  // Fresh from the bill: the account and method it carries, any reference
  // already typed, and the amount after a credit applied moments ago.
  const { data: exp } = useQuery({
    queryKey: ['pay-bill-prefill', target.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('expenses')
        .select('account_id, payment_method, amount_etb, wht_amount, credit_applied_etb, bank_ref')
        .eq('id', target.id).single()
      if (error) throw error
      return data as { account_id: string | null; payment_method: ExpensePaymentMethod | null; amount_etb: number | null
        wht_amount: number | null; credit_applied_etb: number | null; bank_ref: string | null }
    },
  })

  const [payerId, setPayerId] = useState<string | null>(defaultPayerId && defaultPayerId !== target.approverId ? defaultPayerId : null)
  // undefined = not picked yet: the bill's own values show through.
  const [pickedMethod, setMethod] = useState<ExpensePaymentMethod | undefined>(undefined)
  const [pickedAccount, setAccountId] = useState<string | null | undefined>(undefined)
  const [pickedProof, setProof] = useState<ProofValue | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const methods = PAYMENT_METHODS.filter(m => !(target.advance && m.value === 'vrf'))
  const ownMethod = exp?.payment_method && methods.some(m => m.value === exp.payment_method) ? exp.payment_method : null
  const method = pickedMethod ?? ownMethod ?? (methods.some(m => m.value === defaultMethod) ? defaultMethod : 'transfer')
  const accountId = pickedAccount === undefined ? exp?.account_id ?? null : pickedAccount
  const proof = pickedProof ?? emptyProof(exp?.bank_ref)

  const gross = Number(exp?.amount_etb ?? target.gross ?? 0)
  const wht = Number(exp?.wht_amount ?? target.wht ?? 0)
  const credit = Number(exp?.credit_applied_etb ?? target.credit ?? 0)
  const toSend = gross - wht - credit

  const bank = isBankMethod(method)
  const hasRef = proof.ref.trim().length > 0
  const selfPay = !!payerId && payerId === target.approverId
  const valid = !!payerId && !selfPay && (!bank || !!accountId) && !!proof.date

  const outcome = bank
    ? hasRef
      ? `${target.advance ? 'Paid ahead' : 'Paid'} on ${formatDate(proof.date)} — the books post now and the statement checks it when it comes in.`
      : 'No reference yet: it is marked sent and waits on To confirm for the FT number.'
    : method === 'vrf'
      ? 'Marked sent — the VRF manager pays it from a settled fund.'
      : target.advance
        ? `Recorded as paid ahead on ${formatDate(proof.date)}.`
        : 'Marked sent — confirm it on To confirm once the cash is handed over.'
  const action = bank && hasRef ? (target.advance ? 'Mark paid ahead' : 'Mark paid')
    : target.advance && method !== 'vrf' && !bank ? 'Record advance' : 'Mark as sent'

  async function submit() {
    if (!valid) return
    setSaving(true); setError(null)
    const { data, error: e } = await supabase.rpc('pay_expense', {
      p_expense_id: target.id, p_disbursed_by: payerId, p_method: method, p_account_id: accountId,
      p_bank_ref: bank && hasRef ? proof.ref.trim() : null, p_paid_date: proof.date,
      p_proof_url: proof.proofUrl, p_proof_name: proof.proofName,
    })
    setSaving(false)
    if (e) { setError(e.message); return }
    onDone(data as PayResult, method)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-xl dark:bg-slate-800" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b px-5 py-3 dark:border-slate-700">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-100">
              <HandCoins className={`h-4 w-4 ${target.advance ? 'text-amber-600' : 'text-brand'}`} /> {target.advance ? 'Pay in advance' : 'Pay this bill'}
            </h2>
            <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{target.title}{target.code ? ` · ${target.code}` : ''}</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-3 overflow-y-auto px-5 py-4">
          <div className="rounded-lg border bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/40">
            <p className="text-xs text-slate-500 dark:text-slate-400">Send</p>
            <p className="text-lg font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(toSend)}</p>
            {(wht > 0 || credit > 0) && (
              <p className="text-[11px] tabular-nums text-slate-400">
                {formatCurrency(gross)}{wht > 0 ? ` less WHT ${formatCurrency(wht)}` : ''}{credit > 0 ? ` less credit ${formatCurrency(credit)}` : ''}
              </p>
            )}
          </div>

          <div>
            <label className={labelCls}>Who is paying</label>
            <SearchableSelect value={payerId} onChange={setPayerId} options={payerOptions} placeholder="Select payer…" />
            {selfPay && <p className="mt-1 text-[11px] text-red-600">They approved this bill — someone else has to pay it.</p>}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Method</label>
              <select value={method} onChange={e => setMethod(e.target.value as ExpensePaymentMethod)} className={inputCls}>
                {methods.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Paid from{bank ? <span className="text-brand"> *</span> : ' (optional)'}</label>
              <SearchableSelect value={accountId} onChange={setAccountId} options={accountOptions} placeholder="Select account…" />
            </div>
          </div>

          {/* Cash on delivery is only sent here; its day is when it is confirmed. */}
          {(bank || (target.advance && method !== 'vrf')) && (
            <BankProofFields value={proof} onChange={setProof} bank={bank}
              refNote={bank ? 'With the reference it is paid now. Leave it empty if the slip isn’t to hand — it waits on To confirm.' : undefined} />
          )}

          <p className="rounded-md bg-slate-50 px-3 py-2 text-[11px] text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">{outcome}</p>
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-300">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t px-5 py-3 dark:border-slate-700">
          <button onClick={onClose} className={btn('secondary')}>Cancel</button>
          <button onClick={submit} disabled={!valid || saving} className={btn(target.advance ? 'warning' : 'primary')}>{saving ? 'Saving…' : action}</button>
        </div>
      </div>
    </div>
  )
}
