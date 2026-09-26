import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { ForecastDay, ForecastItem, Certainty } from '@/lib/cashControl'

const CERTAINTY: Record<Certainty, { label: string; cls: string }> = {
  committed: { label: 'Committed', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
  expected: { label: 'Expected', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' },
  possible: { label: 'Possible', cls: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' },
}

function signed(n: number) {
  return `${n < 0 ? '−' : '+'}${formatCurrency(Math.abs(n))}`
}

// Day-by-day cash: today's balance, then what is due to go out and come in
// (cash_forecast / v_cash_forecast_items, migration 349). Overdue items land
// on today — that is the day finance has to deal with them.
export function CashForecast({ accountId, defaultDays = 14 }: { accountId?: string; defaultDays?: number }) {
  const [days, setDays] = useState(defaultDays)
  const [withPossible, setWithPossible] = useState(false)
  // undefined = not touched: today (the first row, the server's date) is open.
  const [openDayChoice, setOpenDay] = useState<string | null | undefined>(undefined)

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['cash-forecast', accountId ?? 'all', days, withPossible],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('cash_forecast', {
        p_days: days, p_account_id: accountId ?? null, p_include_possible: withPossible,
      })
      if (error) throw error
      return (data ?? []) as ForecastDay[]
    },
  })

  const { data: items = [] } = useQuery({
    queryKey: ['cash-forecast-items', accountId ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('v_cash_forecast_items').select('*').order('expected_date').order('amount')
      if (accountId) q = q.eq('account_id', accountId)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as ForecastItem[]
    },
  })

  const byDay = useMemo(() => {
    const m = new Map<string, ForecastItem[]>()
    for (const it of items) {
      if (!withPossible && it.certainty === 'possible') continue
      const list = m.get(it.expected_date) ?? []
      list.push(it)
      m.set(it.expected_date, list)
    }
    return m
  }, [items, withPossible])

  const openDay = openDayChoice === undefined ? rows[0]?.day ?? null : openDayChoice
  const opening = rows[0]?.opening ?? 0
  const lowest = rows.reduce<ForecastDay | null>((lo, r) => (lo == null || r.closing < lo.closing ? r : lo), null)
  const totalOut = rows.reduce((s, r) => s + Number(r.money_out), 0)
  const totalIn = rows.reduce((s, r) => s + Number(r.money_in), 0)
  const overdue = items.filter(i => i.overdue && (withPossible || i.certainty !== 'possible'))
  const possibleCount = items.filter(i => i.certainty === 'possible').length

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Balance now" value={formatCurrency(opening)} />
        <Stat label={`Going out · ${days} days`} value={formatCurrency(totalOut)} tone="out" />
        <Stat label={`Coming in · ${days} days`} value={formatCurrency(totalIn)} tone="in" />
        <Stat label={lowest ? `Lowest · ${formatDate(lowest.day)}` : 'Lowest'} value={formatCurrency(lowest?.closing ?? opening)}
          tone={(lowest?.closing ?? 0) < 0 ? 'bad' : undefined} />
      </div>

      {overdue.length > 0 && (
        <p className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5" />
          {overdue.length} item{overdue.length === 1 ? ' is' : 's are'} past {overdue.length === 1 ? 'its' : 'their'} date and counted today.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-md border text-xs dark:border-slate-600">
          {[7, 14, 30, 60].map(d => (
            <button key={d} onClick={() => setDays(d)}
              className={`px-3 py-1.5 ${days === d ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700'}`}>
              {d} days
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={withPossible} onChange={e => setWithPossible(e.target.checked)} />
          Include milestones not requested yet{possibleCount ? ` (${possibleCount})` : ''}
        </label>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Day</th>
              <th className="px-3 py-2 text-right font-medium">Opening</th>
              <th className="px-3 py-2 text-right font-medium">In</th>
              <th className="px-3 py-2 text-right font-medium">Out</th>
              <th className="px-3 py-2 text-right font-medium">Closing</th>
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-slate-700">
            {isLoading && <tr><td colSpan={5} className="py-8 text-center text-slate-400">Loading…</td></tr>}
            {rows.filter((r, i) => i === 0 || r.item_count > 0).map(r => {
              const dayItems = byDay.get(r.day) ?? []
              const open = openDay === r.day
              return (
                <Fragment key={r.day}>
                  <tr className={`${dayItems.length ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40' : ''}`}
                    onClick={() => dayItems.length && setOpenDay(open ? null : r.day)}>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
                        {dayItems.length ? (open ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />) : <span className="w-3.5" />}
                        {formatDate(r.day)}
                        {r.day === rows[0]?.day && <span className="rounded bg-brand/10 px-1.5 text-[10px] font-semibold text-brand">Today</span>}
                        {r.item_count > 0 && <span className="text-[11px] text-slate-400">{r.item_count}</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{formatCurrency(r.opening)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{r.money_in ? `+${formatCurrency(r.money_in)}` : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-red-600 dark:text-red-400">{r.money_out ? `−${formatCurrency(r.money_out)}` : '—'}</td>
                    <td className={`px-3 py-2 text-right font-semibold tabular-nums ${r.closing < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-slate-100'}`}>{formatCurrency(r.closing)}</td>
                  </tr>
                  {open && dayItems.map(it => (
                    <tr key={`${it.kind}-${it.source_id}`} className="bg-slate-50/60 text-xs dark:bg-slate-900/30">
                      <td colSpan={3} className="py-1.5 pl-10 pr-3">
                        <span className="flex items-center gap-2">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${CERTAINTY[it.certainty].cls}`}>{CERTAINTY[it.certainty].label}</span>
                          {it.link ? <Link to={it.link} className="font-medium text-brand hover:underline" onClick={e => e.stopPropagation()}>{it.label}</Link> : <span className="font-medium">{it.label}</span>}
                          <span className="truncate text-slate-500 dark:text-slate-400">{it.detail}</span>
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right text-slate-500 dark:text-slate-400">
                        {it.stage}{it.overdue ? ` · due ${formatDate(it.due_date)}` : ''}{!accountId && it.account_name ? ` · ${it.account_name}` : ''}
                      </td>
                      <td className={`px-3 py-1.5 text-right tabular-nums ${it.amount < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{signed(it.amount)}</td>
                    </tr>
                  ))}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-400">
        Starts from the app's balance today. Out: payments approved to pay (today), payments sent but not yet on a statement, vendor requests approved, payroll not paid.
        In: invoices not paid (their due date, or 30 days), payment requests issued (14 days){withPossible ? ', and milestones due but not requested (14 days)' : ''}.
      </p>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'in' | 'out' | 'bad' }) {
  const cls = tone === 'in' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'out' ? 'text-red-600 dark:text-red-400'
    : tone === 'bad' ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-slate-100'
  return (
    <div className="rounded-xl border bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${cls}`}>{value}</p>
    </div>
  )
}
