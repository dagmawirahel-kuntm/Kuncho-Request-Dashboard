import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { VrfPaymentsSection } from '@/pages/vendor-receipts/VrfPaymentStep'
import { useRefreshPayments, type WhtToPrepareRow } from '@/lib/payments'
import { CheckCircle2, Receipt } from 'lucide-react'

// Paperwork after the money moved: the withholding receipts owed to vendors
// (grouped by vendor — one receipt run per vendor), and VRF payments that
// move through their own approve-and-send step.

export default function PaperworkTab({ wht, canAct }: { wht: WhtToPrepareRow[]; canAct: boolean }) {
  const { toast } = useToast()
  const refresh = useRefreshPayments()
  const [busy, setBusy] = useState<string | null>(null)
  const groups = useMemo(() => {
    const m = new Map<string, { vendor: string; tin: string | null; rows: WhtToPrepareRow[] }>()
    for (const w of wht) {
      const k = w.vendor_name ?? '—'
      const g = m.get(k) ?? { vendor: k, tin: w.vendor_tin, rows: [] }
      g.rows.push(w); m.set(k, g)
    }
    return [...m.values()].sort((a, b) => b.rows.length - a.rows.length)
  }, [wht])

  async function mark(ids: string[], key: string) {
    setBusy(key)
    for (const id of ids) {
      const { error } = await supabase.rpc('mark_wht_receipt_prepared', { p_expense_id: id, p_receipt_url: null, p_receipt_name: null })
      if (error) { setBusy(null); toast(error.message, 'error'); return }
    }
    setBusy(null)
    toast(`${ids.length} withholding receipt${ids.length === 1 ? '' : 's'} marked prepared`, 'success'); refresh()
  }

  const totalWht = wht.reduce((s, w) => s + Number(w.wht_amount ?? 0), 0)
  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800">
        <div className="border-b px-4 py-3 dark:border-slate-700">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Withholding receipts to give vendors <span className="font-normal text-slate-400">· {wht.length} · {formatCurrency(totalWht)} withheld</span></h3>
          <p className="text-[11px] text-slate-500">Paid payments where WHT was withheld. Issue the receipt, then mark it prepared.</p>
        </div>
        {!wht.length ? (
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> All issued.</p>
        ) : (
          <ul className="divide-y dark:divide-slate-700">
            {groups.map(g => (
              <li key={g.vendor} className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-800 dark:text-slate-100">{g.vendor}</p>
                    <p className="text-xs text-slate-500">{g.tin ? `TIN ${g.tin}` : <span className="text-amber-600">No TIN on file</span>} · {g.rows.length} payment{g.rows.length === 1 ? '' : 's'} · WHT {formatCurrency(g.rows.reduce((s, r) => s + Number(r.wht_amount ?? 0), 0))}</p>
                  </div>
                  {canAct && (
                    <button onClick={() => mark(g.rows.map(r => r.expense_id), g.vendor)} disabled={busy === g.vendor}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">
                      <Receipt className="h-3 w-3" /> {busy === g.vendor ? 'Saving…' : g.rows.length > 1 ? `Mark all ${g.rows.length} prepared` : 'Mark prepared'}
                    </button>
                  )}
                </div>
                {g.rows.length > 1 && (
                  <ul className="mt-1.5 space-y-0.5 pl-3 text-xs text-slate-500">
                    {g.rows.map(r => (
                      <li key={r.expense_id}>
                        <Link to={`/expenses/${r.expense_id}`} className="font-mono text-brand hover:underline">{r.expense_code ?? 'Payment'}</Link>
                        {' '}· WHT {formatCurrency(r.wht_amount ?? 0)} of {formatCurrency(r.amount_etb ?? 0)}{r.paid_date ? ` · paid ${formatDate(r.paid_date)}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <VrfPaymentsSection />
    </div>
  )
}
