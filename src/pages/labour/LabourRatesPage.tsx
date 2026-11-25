import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { Pill } from '@/components/record/Record'
import { formatDate } from '@/lib/utils'
import { fmtMoney } from '@/lib/labour'
import { tradeName, useTrades } from '@/lib/labourDay'
import { RATE_QUERY_KEYS, useOpenRaises, useTradeRates } from '@/lib/labourRates'
import { ArrowLeft, Check, Tags, X } from 'lucide-react'

const card = 'rounded-2xl border bg-white dark:border-slate-700 dark:bg-slate-800'

// Trades and their standard day rate (545), and the raises asked for above it.
// Admin and operations set the standards and decide the raises.
export default function LabourRatesPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { hasRole } = useAuth()
  const canDecide = hasRole('admin', 'operations_manager')
  const { data: trades = [] } = useTrades()
  const { data: rates = [] } = useTradeRates()
  const { data: raises = [], isLoading } = useOpenRaises()
  const [editing, setEditing] = useState<string | null>(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const refresh = () => RATE_QUERY_KEYS.forEach(k => qc.invalidateQueries({ queryKey: [k] }))

  const rateOf = (t: string) => rates.find(r => r.trade_tag === t)
  const pending = raises.filter(r => r.status === 'pending')
  const approved = raises.filter(r => r.status === 'approved')

  async function saveStandard(trade: string) {
    const n = value.trim() === '' ? null : Number(value.replace(/[^\d.]/g, ''))
    if (n !== null && !(n > 0)) { toast('A day rate is more than 0', 'error'); return }
    const before = rateOf(trade)?.day_rate
    if (n !== null && before && n < Number(before)
        && !confirm(`Lower the ${tradeName(trade)} standard from ${Number(before).toLocaleString()} to ${n.toLocaleString()}? Every ${tradeName(trade).toLowerCase()} without a raise is paid the new rate for days not paid yet.`)) return
    setBusy(trade)
    const { error } = await supabase.rpc('labour_trade_set_rate', { p_trade: trade, p_rate: n })
    setBusy(null)
    if (error) { toast(error.message, 'error'); return }
    toast(n ? `${tradeName(trade)}: ${n.toLocaleString()} a day on every project` : `${tradeName(trade)} has no standard now — workers keep their own rate`, 'success')
    setEditing(null)
    refresh()
  }
  async function decide(id: string, approve: boolean, name: string) {
    const note = approve ? null : prompt(`Why refuse the raise for ${name}?`)
    if (!approve && !note?.trim()) return
    setBusy(id)
    const { error } = await supabase.rpc('labour_rate_raise_decide', { p_id: id, p_approve: approve, p_note: note?.trim() || null })
    setBusy(null)
    if (error) { toast(error.message, 'error'); return }
    toast(approve ? `Raise approved for ${name}` : `Raise refused for ${name}`, 'success')
    refresh()
  }
  async function end(id: string, name: string) {
    if (!confirm(`End ${name}'s raise? They go back to the standard rate for days not paid yet.`)) return
    setBusy(id)
    const { error } = await supabase.rpc('labour_rate_raise_end', { p_id: id, p_note: null })
    setBusy(null)
    if (error) { toast(error.message, 'error'); return }
    toast(`${name} is back on the standard rate`, 'success')
    refresh()
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-10">
      <Link to="/labour/crew" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand"><ArrowLeft className="h-4 w-4" /> Crew</Link>
      <div>
        <h1 className="flex items-center gap-2 text-lg font-bold text-slate-800 dark:text-slate-100"><Tags className="h-5 w-5 text-brand" /> Trades &amp; rates</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Each trade is paid its standard day rate on every project. A worker gets more only through a raise approved by admin or operations.</p>
      </div>

      {pending.length > 0 && (
        <section className={`${card} border-brand/40`}>
          <h2 className="border-b px-4 py-3 font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100">Raises asked for <span className="text-sm font-normal text-slate-400">{pending.length}</span></h2>
          <ul className="divide-y dark:divide-slate-700">
            {pending.map(r => {
              const name = r.staff?.employee_name ?? 'Worker'
              const std = rateOf(r.staff?.trade_tag ?? '')?.day_rate
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{name} <span className="font-normal text-slate-500">· {tradeName(r.staff?.trade_tag)}</span></p>
                    <p className="text-xs text-slate-500">
                      {fmtMoney(Number(r.rate))} a day{std ? ` (standard ${fmtMoney(Number(std))})` : ''} · asked by {r.requested_by_name ?? '—'} · {formatDate(r.requested_at)}
                      {r.reason ? ` · “${r.reason}”` : ''}
                    </p>
                  </div>
                  {canDecide && <>
                    <button onClick={() => decide(r.id, false, name)} disabled={busy === r.id} className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium text-slate-600 dark:border-slate-600 dark:text-slate-300"><X className="h-3.5 w-3.5" /> Refuse</button>
                    <button onClick={() => decide(r.id, true, name)} disabled={busy === r.id} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"><Check className="h-3.5 w-3.5" /> Approve</button>
                  </>}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section className={card}>
        <h2 className="border-b px-4 py-3 font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100">Standard day rate by trade</h2>
        <ul className="divide-y dark:divide-slate-700">
          {trades.map(t => {
            const r = rateOf(t.trade_tag)
            return (
              <li key={t.trade_tag} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{t.icon_emoji} {tradeName(t.trade_tag)} <span className="font-normal text-slate-400">{t.codename_amharic}</span></p>
                  {r?.rate_set_by_name && <p className="text-[11px] text-slate-400">Set by {r.rate_set_by_name}{r.rate_set_at ? ` · ${formatDate(r.rate_set_at)}` : ''}</p>}
                </div>
                {editing === t.trade_tag ? (
                  <div className="flex items-center gap-2">
                    <input autoFocus inputMode="decimal" value={value} onChange={e => setValue(e.target.value)} placeholder="no standard"
                      onKeyDown={e => { if (e.key === 'Enter') void saveStandard(t.trade_tag) }}
                      className="w-28 rounded-lg border px-2 py-1 text-right text-base sm:text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                    <button onClick={() => saveStandard(t.trade_tag)} disabled={busy === t.trade_tag} className="text-xs font-semibold text-brand">Save</button>
                    <button onClick={() => setEditing(null)} className="text-xs text-slate-500">Cancel</button>
                  </div>
                ) : (
                  <>
                    {r?.day_rate ? <span className="text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{fmtMoney(Number(r.day_rate))}<span className="text-xs font-normal text-slate-400"> /day</span></span>
                      : <Pill tone="amber">No standard yet</Pill>}
                    {canDecide && <button onClick={() => { setEditing(t.trade_tag); setValue(r?.day_rate ? String(r.day_rate) : '') }} className="text-xs font-medium text-brand hover:underline">{r?.day_rate ? 'Change' : 'Set'}</button>}
                  </>
                )}
              </li>
            )
          })}
        </ul>
        <p className="border-t px-4 py-2 text-[11px] text-slate-500 dark:border-slate-700">A trade with no standard yet keeps each worker's own rate, set by HR.</p>
      </section>

      <section className={card}>
        <h2 className="border-b px-4 py-3 font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100">Workers with a raise <span className="text-sm font-normal text-slate-400">{approved.length}</span></h2>
        {isLoading ? <p className="p-6 text-center text-sm text-slate-400">Loading…</p> : approved.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-500">Nobody is paid above their trade's standard.</p>
        ) : (
          <ul className="divide-y dark:divide-slate-700">
            {approved.map(r => {
              const name = r.staff?.employee_name ?? 'Worker'
              const std = rateOf(r.staff?.trade_tag ?? '')?.day_rate
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-slate-800 dark:text-slate-100">{name} <span className="text-slate-500">· {tradeName(r.staff?.trade_tag)}</span></p>
                    <p className="truncate text-xs text-slate-500">
                      {fmtMoney(Number(r.rate))} a day{std ? ` · standard ${fmtMoney(Number(std))}` : ''} · {r.decided_by_name ?? '—'}{r.reason ? ` · ${r.reason}` : ''}
                    </p>
                  </div>
                  {canDecide && <button onClick={() => end(r.id, name)} disabled={busy === r.id} className="text-xs font-medium text-slate-500 hover:text-red-600">End raise</button>}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
