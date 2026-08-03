import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { PackageCheck, MapPin, Receipt, Info } from 'lucide-react'

interface PickupRow {
  kind: 'vendor' | 'client'
  id: string
  receipt_no: string | null
  receipt_date: string | null
  vat_amount: number | null
  counterparty: string | null
  pickup_hint: string | null
  captured_at: string | null
  workflow_status: string
}

// #4: receipts photographed but not yet physically delivered to the
// office — a pickup run for the e-bike driver. Confirming a pickup sets
// the receipt's physical custody (confirm_receipt_pickup), the same
// field finance would otherwise confirm.
export default function ReceiptPickupQueuePage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['receipt-pickup-queue'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_receipt_pickup_queue').select('*').order('captured_at')
      if (error) throw error
      return data as PickupRow[]
    },
  })

  async function pickUp(r: PickupRow) {
    setBusy(r.id)
    const note = window.prompt('Any note on this pickup? (optional)') ?? null
    const { error } = await supabase.rpc('confirm_receipt_pickup', { p_kind: r.kind, p_id: r.id, p_note: note })
    setBusy(null)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['receipt-pickup-queue'] })
    toast('Marked collected — paper now with the office', 'success')
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Receipt Pickup Queue</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Receipts photographed in the field, waiting to be physically collected and brought to the office</p>
      </div>

      <div className="flex items-start gap-2 rounded-lg border dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>Each row is a receipt already captured as a photo but whose paper hasn't reached the office. Collect the paper, then mark it here — that confirms physical custody for the tax record.</span>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="py-12 text-center text-sm text-slate-400">Nothing to collect — every captured receipt's paper is accounted for.</div>
      ) : (
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm divide-y dark:divide-slate-700">
          {rows.map(r => (
            <div key={`${r.kind}-${r.id}`} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate flex items-center gap-1.5">
                  <Receipt className="h-3.5 w-3.5 text-brand shrink-0" />
                  {r.counterparty ?? 'Unknown'} · {r.receipt_no ?? 'no ref'}
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${r.kind === 'vendor' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'}`}>
                    {r.kind}
                  </span>
                </p>
                <p className="text-xs text-slate-400 flex items-center gap-1 truncate">
                  {r.pickup_hint && <><MapPin className="h-3 w-3 shrink-0" />{r.pickup_hint} · </>}
                  {r.receipt_date ? formatDate(r.receipt_date) : 'no date'}
                  {r.vat_amount != null ? ` · VAT ${formatCurrency(r.vat_amount)}` : ''}
                </p>
              </div>
              <button onClick={() => pickUp(r)} disabled={busy === r.id}
                className="flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50 shrink-0">
                <PackageCheck className="h-3.5 w-3.5" /> {busy === r.id ? '…' : 'Collected'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
