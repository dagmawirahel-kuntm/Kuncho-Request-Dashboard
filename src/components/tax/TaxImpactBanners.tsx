import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AlarmClock, ArrowUpRight, Check, ChevronRight, X } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/utils'
import { TaxTag } from '@/components/tax/TaxTag'
import { markImpactSeen, nextStep, pctText, useTaxImpact, type ImpactQueue, type TaxImpact } from '@/lib/taxImpact'

const etb = (n: number) => formatCurrency(Math.round(n)).replace(/\.00$/, '')

/** In the month's last days: the VAT still waiting, and the last day to pay it. */
export function TaxImpactCountdown({ data, queue }: { data: TaxImpact; queue?: ImpactQueue }) {
  const { period, settings, items } = data
  if (period.days_left < 0 || period.days_left > settings.countdown_days) return null
  const vat = (q: ImpactQueue) => items.filter(i => i.cls === 'vat' && i.queue === q).reduce((s, i) => s + i.vat, 0)
  const pay = vat('pay'), approve = vat('approve')
  if (pay + approve < 1) return null
  const when = period.days_left === 0 ? 'today' : period.days_left === 1 ? 'tomorrow' : `in ${period.days_left} days`
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700/50 dark:bg-amber-900/15 dark:text-amber-200">
      <AlarmClock className="h-4 w-4 shrink-0" />
      <p className="flex-1">
        <b>{period.label} closes {when}</b> ({formatDate(period.end)}).{' '}
        {(!queue || queue === 'pay') && pay > 0 && <><b>{etb(pay)}</b> of VAT is approved but not paid. </>}
        {(!queue || queue === 'approve') && approve > 0 && <><b>{etb(approve)}</b> more is waiting for approval. </>}
        VAT counts in the month a bill is paid.
      </p>
      {queue == null && <Link to="/finance/payments" className="inline-flex items-center text-xs font-semibold hover:underline">To pay <ChevronRight className="h-3.5 w-3.5" /></Link>}
    </div>
  )
}

/** New high-impact requests that went ahead of items already waiting. */
export function TaxImpactEscalations({ data, queue, compact = false }: { data: TaxImpact; queue?: ImpactQueue; compact?: boolean }) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const seen = new Set(data.seen)
  const list = data.items.filter(i => i.escalated && (!queue || i.queue === queue) && !seen.has(i.id))
  if (!list.length) return null
  async function done() {
    setBusy(true)
    await markImpactSeen(list.map(i => i.id))
    qc.setQueryData<TaxImpact>(['tax-impact'], d => d ? { ...d, seen: [...d.seen, ...list.map(i => i.id)] } : d)
    setBusy(false)
  }
  return (
    <div className="rounded-xl border border-[#b8892b]/50 bg-[#fbf6ea] p-3 text-sm text-[#5c4210] dark:border-amber-700/50 dark:bg-amber-900/15 dark:text-amber-200">
      <div className="flex items-start gap-2">
        <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="flex-1 font-semibold">
          {list.length === 1 ? 'A new request went to the front' : `${list.length} new requests went to the front`} — bigger tax impact than what was already waiting.
        </p>
        <button type="button" disabled={busy} onClick={done}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-current/20 px-2 py-0.5 text-xs font-medium hover:bg-white/60 disabled:opacity-50 dark:hover:bg-black/20">
          <Check className="h-3 w-3" /> Seen
        </button>
      </div>
      <ul className="mt-2 space-y-1.5">
        {list.slice(0, compact ? 3 : 8).map(i => (
          <li key={i.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-white/70 px-2.5 py-1.5 dark:bg-black/20">
            <TaxTag item={i} periodLabel={data.period.label} />
            <Link to={i.kind === 'expense' ? `/expenses/${i.id}` : `/sourcing/${i.id}`} className="font-mono text-xs font-semibold hover:underline">{i.code}</Link>
            <span className="min-w-0 flex-1 truncate text-xs">{i.vendor ?? i.label}</span>
            <span className="text-xs">
              <b>{etb(i.vat)}</b> VAT · {pctText(i.share)} of the gap
              {i.overtook && <> · went ahead of {i.jumped} smaller (biggest <span className="font-mono">{i.overtook.code}</span>)</>}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[11px] opacity-80">Order only — it still needs the same approval.</p>
    </div>
  )
}

const DISMISS_KEY = 'tax-impact-nudge-dismissed'

/** Landing pages, for finance, admins, executives and the tax officer. */
export function TaxImpactNudge() {
  const { data, allowed } = useTaxImpact()
  const day = new Date().toISOString().slice(0, 10)
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem(DISMISS_KEY) === day } catch { return false } })
  if (!allowed || !data || dismissed) return null
  const seen = new Set(data.seen)
  const fresh = data.items.filter(i => i.escalated && !seen.has(i.id))
  const overdue = data.items.filter(i => i.overdue)
  const closing = data.period.days_left <= data.settings.countdown_days
  const payVat = data.items.filter(i => i.cls === 'vat' && i.queue === 'pay').reduce((s, i) => s + i.vat, 0)
  if (!fresh.length && !overdue.length && !(closing && payVat > 0)) return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-white px-4 py-3 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="flex gap-1">
        {[...fresh, ...overdue].slice(0, 3).map(i => <TaxTag key={i.id} item={i} periodLabel={data.period.label} />)}
      </div>
      <p className="min-w-0 flex-1 text-slate-700 dark:text-slate-200">
        <b>Tax impact · {data.period.label}:</b>{' '}
        {[
          fresh.length ? `${fresh.length} new high-impact request${fresh.length === 1 ? '' : 's'} went to the front` : null,
          overdue.length ? `${overdue.length} high-impact item${overdue.length === 1 ? ' is' : 's are'} overdue` : null,
          closing && payVat > 0 ? `${etb(payVat)} of VAT approved but unpaid, ${data.period.days_left} day${data.period.days_left === 1 ? '' : 's'} left` : null,
        ].filter(Boolean).join(' · ')}
      </p>
      <Link to="/tax-impact" className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90">
        Open the table <ChevronRight className="h-3.5 w-3.5" />
      </Link>
      <button type="button" aria-label="Hide until tomorrow" title="Hide until tomorrow"
        onClick={() => { try { localStorage.setItem(DISMISS_KEY, day) } catch { /* private mode */ } setDismissed(true) }}
        className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
    </div>
  )
}

/** On an expense or PO page: its tag, what it does for the month, and the next step. */
export function TaxImpactNote({ id, po = false }: { id: string; po?: boolean }) {
  const { data, byId, byPo } = useTaxImpact()
  const it = po ? byPo.get(id) : byId.get(id)
  if (!data || !it) return null
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border px-4 py-2.5 text-sm ${it.high
      ? 'border-[#1e3a5f]/30 bg-[#1e3a5f]/[0.04] dark:border-sky-400/30 dark:bg-sky-400/[0.06]'
      : 'bg-white dark:border-slate-700 dark:bg-slate-800'}`}>
      <TaxTag item={it} periodLabel={data.period.label} size="md" />
      <p className="min-w-0 flex-1 text-slate-700 dark:text-slate-200">
        {it.cls === 'vat'
          ? <><b>#{it.rank}</b> by tax impact in {data.period.label} · <b>{etb(it.vat)}</b> VAT · {pctText(it.share)} of the {data.basis === 'goal' ? 'VAT gap' : 'VAT waiting'}</>
          : <><b>{etb(it.vat)}</b> of VAT if the vendor gives a VAT receipt</>}
        <span className="text-slate-500 dark:text-slate-400">
          {' · '}{QUEUE_LABEL_SHORT[it.queue]} {it.age_days} day{it.age_days === 1 ? '' : 's'}
          {it.overdue ? ' · overdue' : ''}
          {it.escalated && it.overtook ? ` · moved ahead of ${it.overtook.code}` : ''}
        </span>
      </p>
      <span className="text-xs font-medium text-[#1e3a5f] dark:text-sky-300">{nextStep(it, data.period.label)}</span>
      <Link to={`/tax-impact#${it.id}`} className="inline-flex items-center text-xs font-medium text-brand hover:underline">Table <ChevronRight className="h-3.5 w-3.5" /></Link>
    </div>
  )
}

const QUEUE_LABEL_SHORT: Record<ImpactQueue, string> = { approve: 'waiting for approval', pay: 'approved, not paid', raise: 'not raised' }
