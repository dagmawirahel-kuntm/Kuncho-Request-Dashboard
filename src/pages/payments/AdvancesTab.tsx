import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Pill } from '@/components/record/Record'
import type { OpenVendorAdvanceRow } from '@/types/database'
import { ageLabel, ageTone, useAdvanceGrns, useRefreshPayments } from '@/lib/payments'
import { RecordVendorCreditModal } from './PaymentModals'
import { CheckCircle2, Clock, Tag } from 'lucide-react'

// Vendor advances: money already paid, goods not yet in. What can be closed
// now (its GRN is recorded) comes first; the rest wait on delivery, oldest
// first, so a stuck advance is the first thing seen.

type Filter = 'all' | 'ready' | 'waiting'

export default function AdvancesTab({ advances, canAct }: { advances: OpenVendorAdvanceRow[]; canAct: boolean }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const refresh = useRefreshPayments()
  const { data: grnByBundle = {} } = useAdvanceGrns(advances)
  const [filter, setFilter] = useState<Filter>('all')
  const [closing, setClosing] = useState<string | null>(null)
  const [crediting, setCrediting] = useState<OpenVendorAdvanceRow | null>(null)

  const grnOf = (a: OpenVendorAdvanceRow) => a.sourcing_bundle_id ? grnByBundle[a.sourcing_bundle_id] : undefined
  const ready = advances.filter(a => grnOf(a))
  const waiting = advances.filter(a => !grnOf(a)).sort((a, b) => (b.days_open ?? 0) - (a.days_open ?? 0))
  const total = advances.reduce((s, a) => s + Number(a.amount_etb ?? 0), 0)
  const sum = (l: OpenVendorAdvanceRow[]) => l.reduce((s, a) => s + Number(a.amount_etb ?? 0), 0)
  const old = waiting.filter(a => (a.days_open ?? 0) >= 14)
  const byVendor = new Map<string, number>()
  for (const a of advances) byVendor.set(a.vendor_name ?? '—', (byVendor.get(a.vendor_name ?? '—') ?? 0) + Number(a.amount_etb ?? 0))
  const [topVendor, topAmount] = [...byVendor.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['—', 0]

  async function close(id: string) {
    setClosing(id)
    const { error } = await supabase.rpc('close_vendor_advance', { p_expense_id: id })
    setClosing(null)
    if (error) { toast(error.message, 'error'); return }
    toast('Advance closed — the goods are in and it counts as paid', 'success'); refresh()
  }

  if (!advances.length) return <p className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> No money is out ahead of delivery.</p>

  const shown = filter === 'ready' ? ready : filter === 'waiting' ? waiting : [...ready, ...waiting]

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Fact label="Paid, goods not in" value={formatCurrency(total)} sub={`${advances.length} advances`} />
        <Fact label="Ready to close" value={String(ready.length)} sub={ready.length ? `${formatCurrency(sum(ready))} — GRN recorded` : 'none have a GRN yet'} tone={ready.length ? 'green' : undefined} />
        <Fact label="Waiting 2+ weeks" value={String(old.length)} sub={old.length ? `${formatCurrency(sum(old))} — chase delivery` : 'none'} tone={old.length ? 'red' : undefined} />
      </div>
      {total > 0 && (
        <p className="text-xs text-slate-500">Most with one vendor: <b className="text-slate-700 dark:text-slate-200">{topVendor}</b> — {formatCurrency(topAmount)} ({Math.round(topAmount / total * 100)}%).</p>
      )}

      <div className="flex gap-1">
        {([['all', `All · ${advances.length}`], ['ready', `Ready to close · ${ready.length}`], ['waiting', `Waiting on delivery · ${waiting.length}`]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${filter === k ? 'border-brand bg-brand/10 text-brand' : 'text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>{l}</button>
        ))}
      </div>

      <ul className="divide-y overflow-hidden rounded-xl border bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800">
        {shown.map(a => {
          const grn = grnOf(a)
          return (
            <li key={a.id} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <Link to={`/expenses/${a.id}`} className="block truncate font-medium text-slate-800 hover:text-brand hover:underline dark:text-slate-100">
                  {a.vendor_name ?? a.item_service_description ?? a.expense_code}
                </Link>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                  <span>{a.bundle_code ?? '—'}</span>
                  {grn
                    ? <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-3 w-3" />{grn.grn_code ?? 'GRN'}{grn.received_at ? ` · ${formatDate(grn.received_at)}` : ''}</span>
                    : <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400"><Clock className="h-3 w-3" />waiting on delivery</span>}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(a.amount_etb ?? 0)}</p>
                <div className="mt-1 flex items-center justify-end gap-1.5">
                  <Pill tone={grn ? 'green' : ageTone(a.days_open)} title="Days since it was paid">{ageLabel(a.days_open)}</Pill>
                  {canAct && (
                    <button onClick={() => setCrediting(a)} title="The vendor agreed a discount after ordering — the difference stays as a credit with them"
                      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-slate-600 dark:border-slate-600 dark:text-slate-300"><Tag className="h-3 w-3" /> Credit</button>
                  )}
                  {canAct && grn && (
                    <button onClick={() => close(a.id)} disabled={closing === a.id}
                      className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">{closing === a.id ? 'Closing…' : 'Close'}</button>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      {crediting && (
        <RecordVendorCreditModal advance={crediting} onClose={() => setCrediting(null)}
          onRecorded={() => { setCrediting(null); toast('Vendor credit recorded', 'success'); refresh(); qc.invalidateQueries({ queryKey: ['v-vendor-credits'] }) }}
          onError={msg => toast(msg, 'error')} />
      )}
    </div>
  )
}

function Fact({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'green' | 'red' }) {
  return (
    <div className="rounded-xl border bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${tone === 'green' ? 'text-emerald-600' : tone === 'red' ? 'text-red-600' : 'text-slate-800 dark:text-slate-100'}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
    </div>
  )
}
