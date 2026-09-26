import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { FormattedNumberInput } from '@/components/shared/FormattedNumberInput'
import { formatCurrency } from '@/lib/utils'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'

// Records money moved from a collection bank on to the main account. It is
// recorded as its two sides (record_internal_transfer), so each bank's
// statement line takes its side's place when imported.
export function MoveMoneyModal({ from, to, suggested, onClose }: {
  from: { id: string; name: string }
  to: { id: string; name: string }
  suggested: number
  onClose: () => void
}) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [amount, setAmount] = useState<number | null>(suggested > 0 ? suggested : null)
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (!amount || amount <= 0) { setError('Enter the amount moved'); return }
    setSaving(true); setError('')
    const { error: err } = await supabase.rpc('record_internal_transfer', {
      p_from_account_id: from.id, p_to_account_id: to.id, p_amount: amount, p_date: date, p_note: note.trim() || null,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    for (const key of ['account-control', 'account-balances', 'bank-alerts', 'transfers', 'cash-forecast', 'cash-forecast-items']) {
      qc.invalidateQueries({ queryKey: [key] })
    }
    toast(`Recorded ${formatCurrency(amount)} moved to ${to.name}`, 'success')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-slate-800" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-4 dark:border-slate-700">
          <div>
            <h2 className="font-bold text-slate-800 dark:text-slate-100">Move money</h2>
            <p className="flex items-center gap-1 text-xs text-slate-400">{from.name} <ArrowRight className="h-3 w-3" /> {to.name}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Amount (ETB)</label>
            <FormattedNumberInput className={inputCls} value={amount} onChange={n => setAmount(n ?? null)} />
            {suggested > 0 && <p className="mt-1 text-[11px] text-slate-400">{formatCurrency(suggested)} is waiting in {from.name}.</p>}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Date</label>
            <input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Note</label>
            <input type="text" className={inputCls} value={note} placeholder="Cheque number, reference…" onChange={e => setNote(e.target.value)} />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t px-5 py-3 dark:border-slate-700">
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={save} disabled={saving} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
            {saving ? 'Recording…' : 'Record move'}
          </button>
        </div>
      </div>
    </div>
  )
}
