import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { formatCurrency } from '@/lib/utils'
import { TaxTag, TaxTagLegend } from '@/components/tax/TaxTag'
import { TaxImpactCountdown, TaxImpactEscalations } from '@/components/tax/TaxImpactBanners'
import { QUEUE_LABEL, nextStep, pctText, useRefreshTaxImpact, useTaxImpact, type ImpactItem, type ImpactQueue } from '@/lib/taxImpact'
import { Landmark, RefreshCw, Search, Target, ArrowUpRight } from 'lucide-react'

type Filter = 'all' | ImpactQueue | 'ask'
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'approve', label: 'Waiting for approval' },
  { key: 'pay', label: 'Approved, not paid' },
  { key: 'raise', label: 'PO not raised' },
  { key: 'ask', label: 'Ask for VAT receipt' },
]

const etb = (n: number) => formatCurrency(Math.round(n)).replace(/\.00$/, '')

// Every open item that brings VAT this month, by tax impact, as one table.
// The T-tag in the first column is the same one the queues, the PO list and
// the expense page show, so a row here can be found anywhere else.
export default function TaxImpactPage() {
  const { data, isLoading, error } = useTaxImpact()
  const refresh = useRefreshTaxImpact()
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [highOnly, setHighOnly] = useState(false)
  const [q, setQ] = useState('')
  const { hash } = useLocation()
  const target = hash.replace('#', '')

  const items = useMemo(() => data?.items ?? [], [data])
  const counts = useMemo(() => ({
    all: items.length,
    approve: items.filter(i => i.cls === 'vat' && i.queue === 'approve').length,
    pay: items.filter(i => i.cls === 'vat' && i.queue === 'pay').length,
    raise: items.filter(i => i.cls === 'vat' && i.queue === 'raise').length,
    ask: items.filter(i => i.cls === 'unknown').length,
  }), [items])

  const needle = q.trim().toLowerCase()
  const shown = items.filter(i =>
    (filter === 'all' || (filter === 'ask' ? i.cls === 'unknown' : i.cls === 'vat' && i.queue === filter))
    && (!highOnly || i.high)
    && (!needle || `${i.code ?? ''} ${i.po_code ?? ''} ${i.vendor ?? ''} ${i.label ?? ''} T${i.rank ?? ''}`.toLowerCase().includes(needle)))

  // A tag clicked elsewhere lands on its row.
  useEffect(() => {
    if (!target || !data) return
    const el = document.getElementById(`row-${target}`)
    el?.scrollIntoView({ block: 'center' })
  }, [target, data])

  const ranked = items.filter(i => i.cls === 'vat')
  const high = ranked.filter(i => i.high)
  const reachIdx = ranked.findIndex(i => i.reaches_goal)
  const totalVat = ranked.reduce((s, i) => s + i.vat, 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800 dark:text-slate-100">
            <Landmark className="h-5 w-5 text-brand" /> Tax impact{data ? ` · ${data.period.label}` : ''}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Every open expense and purchase order that brings VAT this month, biggest first. The tag follows each one to the queues and the PO list.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data && <span className="text-[11px] text-slate-400">Worked out {new Date(data.computed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
          <button type="button" disabled={refreshing}
            onClick={async () => { setRefreshing(true); await refresh(); setRefreshing(false) }}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <Link to="/tax-plan?tab=forecast" className="inline-flex items-center gap-1 rounded-md border px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
            <Target className="h-3.5 w-3.5" /> Tax plan
          </Link>
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{(error as Error).message}</p>
      ) : isLoading || !data ? (
        <p className="py-12 text-center text-sm text-slate-400">Working out the tax impact…</p>
      ) : (
        <>
          <TaxImpactCountdown data={data} />
          <TaxImpactEscalations data={data} />

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Fact label="VAT goal" value={data.goal == null ? 'None saved' : etb(data.goal)} sub={`heading to ${etb(data.course)}`} />
            <Fact label={data.basis === 'goal' ? 'Gap to close' : 'VAT waiting'} value={etb(data.basis === 'goal' ? (data.need ?? 0) : totalVat)}
              sub={data.basis === 'goal' ? 'input VAT needed' : 'no goal gap — shares are of all VAT waiting'} tone={data.basis === 'goal' ? 'amber' : undefined} />
            <Fact label="High impact" value={String(high.length)} sub={`${pctText(data.settings.high_share)}+ of the gap each`} />
            <Fact label="Reaches the goal" value={reachIdx >= 0 ? `T1–T${reachIdx + 1}` : data.basis === 'goal' ? 'Not with these' : '—'}
              sub={reachIdx >= 0 ? `the ${reachIdx + 1} biggest items` : `${ranked.length} items, ${etb(totalVat)} VAT`} tone={reachIdx >= 0 ? 'green' : undefined} />
          </div>

          <TaxTagLegend />

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
              {FILTERS.map(f => (
                <button key={f.key} type="button" onClick={() => setFilter(f.key)}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${filter === f.key ? 'bg-brand text-white' : 'border bg-white text-slate-600 hover:border-brand dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>
                  {f.label}
                  <span className={`rounded-full px-1.5 text-[10px] ${filter === f.key ? 'bg-white/20' : 'bg-slate-100 dark:bg-slate-700'}`}>{counts[f.key]}</span>
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={highOnly} onChange={e => setHighOnly(e.target.checked)} /> High impact only
            </label>
            <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="T3, code, PO or vendor…"
                className="w-full rounded-lg border bg-white py-1.5 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800" />
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                  <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 dark:bg-slate-900">Tag</th>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2">PO</th>
                  <th className="px-3 py-2">Stage</th>
                  <th className="px-3 py-2 text-right">VAT</th>
                  <th className="px-3 py-2">Share of {data.basis === 'goal' ? 'gap' : 'VAT waiting'}</th>
                  <th className="px-3 py-2">Running</th>
                  <th className="px-3 py-2">Escalation</th>
                  <th className="px-3 py-2">Next step</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-700">
                {shown.map(it => <Row key={it.id} it={it} period={data.period.label} target={it.id === target} />)}
                {shown.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-10 text-center text-sm text-slate-400">Nothing matches.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-400">
            Only VAT from suppliers who give VAT receipts is ranked. Escalation changes the order of the queues, not who approves.
            Paying early only moves VAT between months — use this to time what is needed anyway.
          </p>
        </>
      )}
    </div>
  )
}

function Row({ it, period, target }: { it: ImpactItem; period: string; target: boolean }) {
  const href = it.kind === 'expense' ? `/expenses/${it.id}` : `/sourcing/${it.id}`
  const share = it.share ?? 0
  return (
    <tr id={`row-${it.id}`} className={`align-top ${target ? 'bg-amber-50 dark:bg-amber-900/20' : it.high ? 'bg-[#1e3a5f]/[0.03] dark:bg-sky-400/[0.04]' : ''}`}>
      <td className={`sticky left-0 z-10 px-3 py-2.5 ${target ? 'bg-amber-50 dark:bg-amber-900/20' : 'bg-white dark:bg-slate-800'}`}>
        <TaxTag item={it} periodLabel={period} size="md" link={false} />
      </td>
      <td className="max-w-[260px] px-3 py-2.5">
        <Link to={href} className="font-mono text-xs font-semibold text-brand hover:underline">{it.code ?? (it.kind === 'po' ? 'PO' : 'Expense')}</Link>
        <p className="truncate text-slate-700 dark:text-slate-200">{it.vendor ?? it.label ?? '—'}</p>
        {it.label && it.label !== it.vendor && it.label !== it.code && <p className="truncate text-[11px] text-slate-400">{it.label}</p>}
      </td>
      <td className="px-3 py-2.5">
        {it.po_id ? <Link to={`/sourcing/${it.po_id}`} className="whitespace-nowrap font-mono text-xs text-brand hover:underline">{it.po_code}</Link> : <span className="text-slate-300 dark:text-slate-600">—</span>}
      </td>
      <td className="min-w-[120px] px-3 py-2.5 text-xs">
        <p className="text-slate-700 dark:text-slate-200">{QUEUE_LABEL[it.queue]}</p>
        <p className={it.overdue ? 'font-semibold text-red-600 dark:text-red-400' : 'text-slate-400'}>
          {it.age_days} day{it.age_days === 1 ? '' : 's'}{it.overdue ? ' · overdue' : ''}
        </p>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-slate-800 dark:text-slate-100">
        {etb(it.vat)}
        <p className="text-[11px] font-normal text-slate-400">of {etb(it.amount)}</p>
      </td>
      <td className="px-3 py-2.5">
        {it.cls === 'vat' ? (
          <div className="w-28">
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
              <div className="h-full rounded-full bg-[#2a78d6] dark:bg-[#3987e5]" style={{ width: `${Math.min(100, share * 100)}%` }} />
            </div>
            <p className="mt-0.5 text-xs tabular-nums text-slate-600 dark:text-slate-300">{pctText(it.share)}</p>
          </div>
        ) : <span className="text-xs text-slate-400">not counted</span>}
      </td>
      <td className="px-3 py-2.5 text-xs tabular-nums">
        {it.cum_share != null ? (
          <>
            <span className={it.cum_share >= 1 ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-300'}>{pctText(Math.min(it.cum_share, 9.99))}</span>
            {it.reaches_goal && <p className="font-semibold text-emerald-600 dark:text-emerald-400">Goal reached here</p>}
          </>
        ) : <span className="text-slate-300 dark:text-slate-600">—</span>}
      </td>
      <td className="min-w-[170px] px-3 py-2.5 text-xs">
        {it.escalated && it.overtook ? (
          <span className="inline-flex items-start gap-1 text-[#8a6316] dark:text-amber-300">
            <ArrowUpRight className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>Went ahead of {it.jumped} smaller item{it.jumped === 1 ? '' : 's'}; biggest:{' '}
              <Link to={`/expenses/${it.overtook.id}`} className="whitespace-nowrap font-mono underline">{it.overtook.code}</Link></span>
          </span>
        ) : <span className="text-slate-300 dark:text-slate-600">—</span>}
      </td>
      <td className="min-w-[150px] max-w-[220px] px-3 py-2.5 text-xs text-slate-600 dark:text-slate-300">{nextStep(it, period)}</td>
    </tr>
  )
}

function Fact({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'amber' | 'green' }) {
  return (
    <div className="rounded-xl border bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${tone === 'amber' ? 'text-amber-600 dark:text-amber-400' : tone === 'green' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-800 dark:text-slate-100'}`}>{value}</p>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">{sub}</p>
    </div>
  )
}
