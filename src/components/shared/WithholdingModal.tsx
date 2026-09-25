import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import { WHT_RATES, proposeWht, whtBase, type WhtRateKey } from '@/lib/withholding'
import { AlertTriangle, X } from 'lucide-react'

export type WithholdingTarget = {
  id: string
  expense_code: string | null
  amount_etb: number | null
  credit_applied_etb?: number | null
  wht_amount: number | null
  verify_wht: boolean | null
  vendor_id: string | null
  vendor_name?: string | null
}

type Mode = WhtRateKey | 'custom'

// Records whether withholding is deducted from one payment, and how much.
//
// Replaces keeping two fields in step by hand — the Verify WHT tick and the
// WHT amount — which had drifted: 29 payments ticked with nothing actually
// withheld, 8 withheld without the tick. set_expense_withholding() sets both
// together, and only before the payment is sent, so the net that reaches the
// bank is always the net this dialog showed.
export function WithholdingModal({ expense, onClose, onSaved }: {
  expense: WithholdingTarget
  onClose: () => void
  onSaved: () => void
}) {
  const { data: vendor } = useQuery({
    queryKey: ['wht-vendor', expense.vendor_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('vendors').select('vendor_name, tin, wth_eligible').eq('id', expense.vendor_id!).single()
      if (error) throw error
      return data as { vendor_name: string; tin: string | null; wth_eligible: boolean }
    },
    enabled: !!expense.vendor_id,
  })
  const hasTin = !!vendor?.tin?.trim()

  const gross = Number(expense.amount_etb ?? 0)
  const credit = Number(expense.credit_applied_etb ?? 0)
  const alreadyWithheld = Number(expense.wht_amount ?? 0) > 0

  // Opening this is almost always to record a deduction, so that's the
  // starting choice; "No withholding" is one click away to remove one.
  const [withheld, setWithheld] = useState(true)
  const [mode, setMode] = useState<Mode>(alreadyWithheld ? 'custom' : 'standard')
  // null = not touched yet, so it follows the vendor's TIN once that loads.
  const [includesVatChoice, setIncludesVat] = useState<boolean | null>(null)
  const includesVat = includesVatChoice ?? hasTin
  const [custom, setCustom] = useState<string>(alreadyWithheld ? String(expense.wht_amount) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const wht = useMemo(() => {
    if (!withheld) return 0
    if (mode === 'custom') return Math.round(Number(custom || 0) * 100) / 100
    return proposeWht(gross, includesVat, WHT_RATES[mode].rate)
  }, [withheld, mode, custom, gross, includesVat])
  const cash = gross - credit - wht
  const invalid = withheld && (wht <= 0 || cash <= 0)

  async function save() {
    setError('')
    if (invalid) { setError(wht <= 0 ? 'Enter the withholding amount' : 'Withholding can’t take the whole payment'); return }
    setSaving(true)
    const { error: err } = await supabase.rpc('set_expense_withholding', {
      p_expense_id: expense.id,
      p_withheld: withheld,
      p_wht_amount: withheld ? wht : null,
      p_method: null,
    })
    setSaving(false)
    // The function is the authority on timing and limits — its message says
    // exactly why, e.g. that the payment has already been sent.
    if (err) { setError(err.message); return }
    onSaved()
  }

  const radio = 'flex items-start gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer dark:border-slate-600'
  const on = 'border-brand bg-brand/5 dark:bg-brand/10'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl max-w-md w-full overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b dark:border-slate-700 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-slate-800 dark:text-slate-100">Withholding tax</h2>
            <p className="text-xs text-slate-400">{expense.expense_code} · {vendor?.vendor_name ?? expense.vendor_name ?? 'payee'}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>

        <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-2">
            <label className={`${radio} ${withheld ? on : ''}`}>
              <input type="radio" checked={withheld} onChange={() => setWithheld(true)} className="mt-0.5" />
              <span>WHT deducted<span className="block text-[11px] text-slate-400">from this payment</span></span>
            </label>
            <label className={`${radio} ${!withheld ? on : ''}`}>
              <input type="radio" checked={!withheld} onChange={() => setWithheld(false)} className="mt-0.5" />
              <span>No withholding<span className="block text-[11px] text-slate-400">pay the full amount</span></span>
            </label>
          </div>

          {withheld && (
            <>
              {vendor && !hasTin && (
                <p className="flex gap-1.5 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                  No TIN on file for this vendor. If they didn’t provide one, the higher rate applies — record their TIN on the vendor if they have one.
                </p>
              )}
              {vendor && !vendor.wth_eligible && (
                <p className="flex gap-1.5 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
                  This vendor isn’t marked WHT-eligible. Withhold only if this payment qualifies.
                </p>
              )}

              <div className="space-y-1.5">
                {(Object.keys(WHT_RATES) as WhtRateKey[]).map(k => (
                  <label key={k} className={`${radio} ${mode === k ? on : ''}`}>
                    <input type="radio" checked={mode === k} onChange={() => setMode(k)} className="mt-0.5" />
                    <span className="flex-1">{WHT_RATES[k].label}</span>
                    <span className="tabular-nums text-slate-500">{formatCurrency(proposeWht(gross, includesVat, WHT_RATES[k].rate))}</span>
                  </label>
                ))}
                <label className={`${radio} ${mode === 'custom' ? on : ''}`}>
                  <input type="radio" checked={mode === 'custom'} onChange={() => setMode('custom')} className="mt-0.5" />
                  <span className="flex-1">Exact amount</span>
                  {mode === 'custom' && (
                    <input autoFocus inputMode="decimal" value={custom} onChange={e => setCustom(e.target.value.replace(/[^0-9.]/g, ''))}
                      className="w-32 rounded border px-2 py-0.5 text-right text-sm tabular-nums dark:border-slate-600 dark:bg-slate-900" placeholder="0.00" />
                  )}
                </label>
              </div>

              {mode !== 'custom' && (
                <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <input type="checkbox" checked={includesVat} onChange={e => setIncludesVat(e.target.checked)} />
                  Amount includes 15% VAT — withhold on {formatCurrency(whtBase(gross, includesVat))}
                </label>
              )}
            </>
          )}

          <dl className="rounded-lg border dark:border-slate-700 text-sm divide-y dark:divide-slate-700">
            <div className="flex justify-between px-3 py-1.5"><dt className="text-slate-500">Payment</dt><dd className="tabular-nums">{formatCurrency(gross)}</dd></div>
            {credit > 0 && <div className="flex justify-between px-3 py-1.5"><dt className="text-slate-500">Vendor credit applied</dt><dd className="tabular-nums">({formatCurrency(credit)})</dd></div>}
            <div className="flex justify-between px-3 py-1.5"><dt className="text-slate-500">Withheld — owed to the tax authority</dt><dd className="tabular-nums">({formatCurrency(wht)})</dd></div>
            <div className="flex justify-between px-3 py-2 font-semibold"><dt>Send to payee</dt><dd className="tabular-nums">{formatCurrency(cash)}</dd></div>
          </dl>

          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <div className="px-5 py-4 border-t dark:border-slate-700 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={save} disabled={saving || invalid} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
