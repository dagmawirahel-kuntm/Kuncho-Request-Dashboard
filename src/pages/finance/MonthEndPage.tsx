import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Circle, CalendarCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { recentEcMonths } from '@/lib/ecMonths'
import { useLedgerTieout, type ChecklistItem } from '@/lib/cashControl'
import { LedgerTieoutCard } from '@/components/cash/LedgerTieout'

const STATE_ICON = {
  ok: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
  warn: <AlertTriangle className="h-4 w-4 text-amber-500" />,
  todo: <Circle className="h-4 w-4 text-slate-300 dark:text-slate-600" />,
}

/**
 * Month-end: everything left before a month's cash can be signed off,
 * account by account, and each bank tied out to the general ledger
 * (migration 350). Months are Ethiopian.
 */
export default function MonthEndPage() {
  const months = useMemo(() => recentEcMonths(), [])
  const [idx, setIdx] = useState(1) // the last month that has ended
  const period = months[idx]

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['month-end-checklist', period.from, period.to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('month_end_checklist', { p_from: period.from, p_to: period.to })
      if (error) throw error
      return (data ?? []) as ChecklistItem[]
    },
  })
  const { data: tieouts = [] } = useLedgerTieout()

  const groups = useMemo(() => {
    const m = new Map<string, { name: string; items: ChecklistItem[] }>()
    for (const it of items) {
      const key = it.account_id ?? 'general'
      const g = m.get(key) ?? { name: it.account_name ?? 'Across all accounts', items: [] }
      g.items.push(it)
      m.set(key, g)
    }
    return [...m.entries()]
  }, [items])

  const done = items.filter(i => i.state === 'ok').length
  const withStatements = tieouts.filter(t => t.statement_date != null)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800 dark:text-slate-100"><CalendarCheck className="h-5 w-5 text-brand" /> Month-end</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">What is left before the month's cash can be signed off, and each bank tied to the ledger.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={idx} onChange={e => setIdx(Number(e.target.value))}
            className="rounded-md border px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
            {months.map((m, i) => <option key={`${m.year}-${m.month}`} value={i}>{m.label}</option>)}
          </select>
          <span className="text-xs text-slate-500 dark:text-slate-400">{formatDate(period.from)} – {formatDate(period.to)}</span>
        </div>
      </div>

      {!isLoading && items.length > 0 && (
        <div className="rounded-xl border bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-slate-700 dark:text-slate-200">{done} of {items.length} done</span>
            <span className="text-xs text-slate-400">{items.filter(i => i.state === 'warn').length} to look at</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${(done / items.length) * 100}%` }} />
          </div>
        </div>
      )}

      {isLoading ? <p className="py-10 text-center text-sm text-slate-400">Loading…</p> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {groups.map(([key, g]) => (
            <div key={key} className="overflow-hidden rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800">
              <div className="flex items-center justify-between border-b px-4 py-2.5 dark:border-slate-700">
                {key === 'general'
                  ? <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{g.name}</h3>
                  : <Link to={`/accounts/${key}`} className="text-sm font-semibold text-slate-800 hover:text-brand dark:text-slate-100">{g.name}</Link>}
                <span className="text-xs text-slate-400">{g.items.filter(i => i.state === 'ok').length}/{g.items.length}</span>
              </div>
              <ul className="divide-y dark:divide-slate-700">
                {g.items.map(it => (
                  <li key={it.check_key} className="flex items-start gap-3 px-4 py-2.5">
                    <span className="mt-0.5">{STATE_ICON[it.state]}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-800 dark:text-slate-100">{it.title}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {it.detail}{it.amount != null && Number(it.amount) !== 0 ? ` · ${formatCurrency(it.amount)}` : ''}
                      </p>
                    </div>
                    {it.state !== 'ok' && it.link && <Link to={it.link} className="shrink-0 text-xs font-medium text-brand hover:underline">Go</Link>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">Bank and ledger</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Each bank's balance on its latest statement against the ledger's cash account on the same day, and what makes up the difference.
          </p>
        </div>
        {withStatements.length === 0
          ? <p className="text-sm text-slate-400">No statements imported yet.</p>
          : <div className="grid gap-3 xl:grid-cols-2">{withStatements.map(t => <LedgerTieoutCard key={t.account_id} row={t} />)}</div>}
      </div>
    </div>
  )
}
