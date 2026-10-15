import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency } from '@/lib/utils'
import type { Sale } from '@/types/database'

const inputCls = 'w-full rounded-md border px-2 py-1.5 text-sm tabular-nums outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800'

// The payment matched to a sale, and what the client kept back from it
// (migration 455): income tax, VAT withheld, a transfer charge, and anything
// still owed. Worked out from the client's withholding profile; finance can
// correct it (for example withholding taken on the whole contract at the
// final payment).
export function SaleWithholdingPanel({ sale, canAdjust }: { sale: Sale; canAdjust: boolean }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [it, setIt] = useState(String(sale.income_tax_withheld ?? 0))
  const [vw, setVw] = useState(String(sale.vat_withheld ?? 0))
  const [ch, setCh] = useState(String(sale.receipt_charge ?? 0))
  const [note, setNote] = useState(sale.withholding_note ?? '')

  if (sale.amount_received == null) return null
  const amount = Number(sale.amount ?? 0)
  const received = Number(sale.amount_received)
  const short = Math.max(0, Math.round((amount - received) * 100) / 100)
  const typed = (Number(it) || 0) + (Number(vw) || 0) + (Number(ch) || 0)
  const owed = Math.max(0, Math.round((short - typed) * 100) / 100)

  async function save(auto: boolean) {
    setBusy(true)
    const { error } = await supabase.rpc('set_sale_withholding', auto
      ? { p_sale_id: sale.id, p_income_tax: null }
      : { p_sale_id: sale.id, p_income_tax: Number(it) || 0, p_vat_withheld: Number(vw) || 0, p_charge: Number(ch) || 0, p_note: note.trim() || null })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast(auto ? 'Back to the worked-out split' : 'Split saved; the ledger follows', 'success')
    setEditing(false)
    qc.invalidateQueries({ queryKey: ['sale-detail', sale.id] })
    qc.invalidateQueries({ queryKey: ['sales'] })
  }

  const rows: { label: string; value: number | null | undefined; hint: string; tone?: string }[] = [
    { label: 'Income tax withheld', value: sale.income_tax_withheld, hint: 'A credit against profit tax — collect the withholding certificate' },
    { label: 'VAT withheld', value: sale.vat_withheld, hint: 'Kept by a government payer and paid to the revenue office; comes off this month\'s VAT' },
    { label: 'Transfer charge', value: sale.receipt_charge, hint: 'Taken by the payer\'s bank (RTGS); a bank charge' },
    { label: 'Still owed', value: sale.receipt_shortfall, hint: 'More than the client is expected to keep back — follow up', tone: 'text-red-600 dark:text-red-400' },
  ]

  return (
    <div className="rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3.5 dark:border-slate-700">
        <div>
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Payment received</h2>
          <p className="text-[11px] text-slate-400">
            {sale.withholding_set_by ? 'Split set by finance' : 'Split worked out from the client\'s withholding setting'}
            {sale.withholding_note ? ` · ${sale.withholding_note}` : ''}
          </p>
        </div>
        {canAdjust && !editing && (
          <div className="flex gap-1.5">
            {sale.withholding_set_by && (
              <button type="button" disabled={busy} onClick={() => save(true)}
                className="rounded-md border px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
                Work it out again
              </button>
            )}
            <button type="button" onClick={() => setEditing(true)}
              className="rounded-md border px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
              Correct the split
            </button>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-px bg-slate-100 text-sm dark:bg-slate-700 sm:grid-cols-3">
        <Cell label="Invoice" value={formatCurrency(amount)} />
        <Cell label="Received" value={formatCurrency(received)} />
        <Cell label="Kept back" value={formatCurrency(short)} />
      </div>
      {!editing ? (
        <div className="divide-y dark:divide-slate-700">
          {rows.filter(r => Number(r.value ?? 0) > 0).map(r => (
            <div key={r.label} className="flex items-start gap-3 px-5 py-2.5">
              <div className="w-40 shrink-0 text-xs text-slate-500 dark:text-slate-400">{r.label}</div>
              <div className="flex-1">
                <p className={`text-sm font-semibold tabular-nums ${r.tone ?? 'text-slate-800 dark:text-slate-100'}`}>{formatCurrency(Number(r.value))}</p>
                <p className="text-[11px] text-slate-400">{r.hint}</p>
              </div>
            </div>
          ))}
          {short <= 1 && <p className="px-5 py-2.5 text-xs text-slate-500 dark:text-slate-400">Paid in full.</p>}
        </div>
      ) : (
        <div className="space-y-3 px-5 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="text-xs text-slate-600 dark:text-slate-300">Income tax withheld
              <input className={inputCls} inputMode="decimal" value={it} onChange={e => setIt(e.target.value)} /></label>
            <label className="text-xs text-slate-600 dark:text-slate-300">VAT withheld
              <input className={inputCls} inputMode="decimal" value={vw} onChange={e => setVw(e.target.value)} /></label>
            <label className="text-xs text-slate-600 dark:text-slate-300">Transfer charge
              <input className={inputCls} inputMode="decimal" value={ch} onChange={e => setCh(e.target.value)} /></label>
          </div>
          <input className={inputCls} placeholder="Why (e.g. 3% on the whole contract, taken at the final payment)" value={note} onChange={e => setNote(e.target.value)} />
          <p className={`text-xs ${typed > short + 0.01 ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`}>
            {typed > short + 0.01
              ? `That is ${formatCurrency(typed)}, more than the ${formatCurrency(short)} kept back.`
              : `Leaves ${formatCurrency(owed)} still owed by the client.`}
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)} className="rounded-md border px-3 py-1.5 text-xs dark:border-slate-600">Cancel</button>
            <button type="button" disabled={busy || typed > short + 0.01} onClick={() => save(false)}
              className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-50">Save split</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white px-5 py-2.5 dark:bg-slate-800">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{value}</p>
    </div>
  )
}
