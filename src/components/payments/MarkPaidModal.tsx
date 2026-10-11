import { useState } from 'react'
import { CheckCircle2, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import { btn } from '@/lib/ui/button'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { BankProofFields } from '@/components/payments/BankProofFields'
import { PAYMENT_METHOD_LABEL, emptyProof, isBankMethod, type PayResult } from '@/lib/payments'

// Something sent gets what makes it paid (mark_payment_paid, migration 442):
// by bank, its FT reference — the statement checks it later on the bank
// audit; in cash, the day it was handed over.

export interface MarkPaidTarget {
  kind: 'expense' | 'part' | 'batch'
  id: string
  title: string
  subtitle?: string | null
  amount: number
  method: string | null
  accountId: string | null
  /** A reference typed when it was sent, if any. */
  bankRef: string | null
}

export function MarkPaidModal({ target, accountOptions, onClose, onDone }: {
  target: MarkPaidTarget
  accountOptions: { id: string; label: string; sub?: string }[]
  onClose: () => void
  onDone: (result: PayResult) => void
}) {
  // A batch wire is paid through a bank unless the batch went out in cash.
  const bank = target.kind === 'batch' ? target.method !== 'cash' : isBankMethod(target.method)
  const [proof, setProof] = useState(() => emptyProof(target.bankRef))
  const [accountId, setAccountId] = useState<string | null>(target.accountId)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const needsAccount = bank && !target.accountId
  const valid = (!bank || proof.ref.trim().length > 0) && (!needsAccount || !!accountId) && !!proof.date

  async function submit() {
    if (!valid) return
    setSaving(true); setError(null)
    const { data, error: e } = await supabase.rpc('mark_payment_paid', {
      p_kind: target.kind, p_id: target.id, p_bank_ref: bank ? proof.ref.trim() : null, p_paid_date: proof.date,
      p_proof_url: proof.proofUrl, p_proof_name: proof.proofName, p_account_id: needsAccount ? accountId : null,
    })
    setSaving(false)
    if (e) { setError(e.message); return }
    onDone(data as PayResult)
  }

  const method = target.method ? (PAYMENT_METHOD_LABEL[target.method] ?? target.method) : null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-xl dark:bg-slate-800" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b px-5 py-3 dark:border-slate-700">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-100">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" /> {bank ? 'Mark paid' : 'Confirm paid'}
            </h2>
            <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{target.title}</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-3 overflow-y-auto px-5 py-4">
          <div className="flex items-baseline justify-between gap-3 rounded-lg border bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/40">
            <p className="min-w-0 truncate text-xs text-slate-500 dark:text-slate-400">{[method, target.subtitle].filter(Boolean).join(' · ') || 'Sent'}</p>
            <p className="shrink-0 text-lg font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(target.amount)}</p>
          </div>
          {needsAccount && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Paid from <span className="text-brand">*</span></label>
              <SearchableSelect value={accountId} onChange={setAccountId} options={accountOptions} placeholder="Select account…" />
            </div>
          )}
          <BankProofFields value={proof} onChange={setProof} bank={bank} refRequired={bank}
            refNote={bank ? 'The FT number on the transfer slip. If the statement is already in, the line is linked at once.' : undefined} />
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-300">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t px-5 py-3 dark:border-slate-700">
          <button onClick={onClose} className={btn('secondary')}>Cancel</button>
          <button onClick={submit} disabled={!valid || saving} className={btn('success')}>{saving ? 'Saving…' : bank ? 'Mark paid' : 'Confirm paid'}</button>
        </div>
      </div>
    </div>
  )
}
