import { useMemo, useState } from 'react'
import { tradesFor, useLabourCandidates, type Candidate } from '@/lib/labourCandidates'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useTradeRoster } from '@/hooks/useTier2Workers'
import { BadgeCheck, Check, Search, Star } from 'lucide-react'

/** Who can do this job (migration 478): the casual workers, best fits first —
 *  the right trade, verified by HR, free today, worked on this site before,
 *  well rated. Tap to pick; busy or unverified people can still be picked,
 *  with the reason shown. */
export function WorkerPicker({ projectId, workOrderId, work, picked, onToggle, exclude, max = 60 }: {
  projectId: string | null; workOrderId?: string | null; work?: string
  picked: string[]; onToggle: (c: Candidate) => void; exclude?: Set<string>; max?: number
}) {
  const { data: all = [], isLoading } = useLabourCandidates(projectId, workOrderId)
  const { data: roster = [] } = useTradeRoster()
  const suggested = useMemo(() => tradesFor(work ?? ''), [work])
  const [trade, setTrade] = useState<string | null | undefined>(undefined)
  const activeTrades = useMemo(() => trade === undefined ? suggested : trade ? [trade] : [], [trade, suggested])
  const [q, setQ] = useState('')
  const [onlyFree, setOnlyFree] = useState(false)

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const fit = (c: Candidate) =>
      (activeTrades.length && c.trade && activeTrades.includes(c.trade) ? 40 : 0) + (c.verified ? 15 : 0)
      + (c.busy_today ? -30 : 0) + (c.open_elsewhere ? -10 : 0) + Math.min(c.days_here, 20) + (c.score ?? 50) / 5
    return all
      .filter(c => !exclude?.has(c.staff_id))
      .filter(c => !needle || `${c.name} ${c.phone ?? ''} ${c.trade ?? ''}`.toLowerCase().includes(needle))
      .filter(c => !activeTrades.length || needle || (c.trade && activeTrades.includes(c.trade)))
      .filter(c => !onlyFree || (!c.busy_today && !c.open_elsewhere))
      .sort((a, b) => Number(picked.includes(b.staff_id)) - Number(picked.includes(a.staff_id)) || fit(b) - fit(a) || a.name.localeCompare(b.name))
      .slice(0, max)
  }, [all, exclude, q, activeTrades, onlyFree, picked, max])

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setTrade(null)} className={`rounded-full border px-2.5 py-1 text-xs ${!activeTrades.length ? 'border-brand bg-brand text-white' : 'text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>All trades</button>
        {roster.map(t => (
          <button key={t.trade_tag} type="button" onClick={() => setTrade(activeTrades.length === 1 && activeTrades[0] === t.trade_tag ? null : t.trade_tag)}
            className={`rounded-full border px-2.5 py-1 text-xs ${activeTrades.includes(t.trade_tag) ? 'border-brand bg-brand text-white' : 'text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>
            {t.icon_emoji} {t.trade_tag.replace(/_/g, ' ')}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Name or phone…"
            className="w-full rounded-lg border py-2 pl-8 pr-3 text-base outline-none focus:ring-2 focus:ring-brand sm:text-sm dark:border-slate-600 dark:bg-slate-800" />
        </div>
        <label className="flex shrink-0 items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
          <input type="checkbox" className="accent-brand" checked={onlyFree} onChange={e => setOnlyFree(e.target.checked)} /> Free only
        </label>
      </div>
      <ul className="max-h-80 divide-y overflow-y-auto rounded-lg border dark:divide-slate-700 dark:border-slate-700">
        {isLoading ? <li className="p-4 text-center text-sm text-slate-400">Loading…</li>
          : rows.length === 0 ? <li className="p-4 text-center text-sm text-slate-400">Nobody matches{activeTrades.length ? ' in that trade' : ''}.</li>
          : rows.map(c => {
            const on = picked.includes(c.staff_id)
            return (
              <li key={c.staff_id}>
                <button type="button" onClick={() => onToggle(c)} disabled={c.on_this_job}
                  className={`flex w-full items-start gap-3 px-3 py-2.5 text-left disabled:opacity-50 ${on ? 'bg-brand/5' : 'hover:bg-slate-50 dark:hover:bg-slate-700/40'}`}>
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${on ? 'border-brand bg-brand text-white' : 'dark:border-slate-600'}`}>{on && <Check className="h-3.5 w-3.5" />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-800 dark:text-slate-100">
                      {c.name}
                      {c.verified ? <BadgeCheck className="h-3.5 w-3.5 text-emerald-600" aria-label="Verified by HR" /> : <span className="text-[10px] font-normal text-amber-600">not verified</span>}
                      {c.score != null && <span className="inline-flex items-center gap-0.5 text-[11px] font-normal text-slate-500"><Star className="h-3 w-3 fill-amber-400 text-amber-400" />{Math.round(c.score)}</span>}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {[c.trade?.replace(/_/g, ' '), c.day_rate ? `${formatCurrency(c.day_rate)}/day` : null,
                        c.days_here ? `${c.days_here} day${c.days_here === 1 ? '' : 's'} on this site` : 'new to this site'].filter(Boolean).join(' · ')}
                    </span>
                    <span className="block text-[11px]">
                      {c.on_this_job ? <span className="text-slate-500">Already on this job</span>
                        : c.busy_today ? <span className="text-red-600">Working today on {c.busy_today.what}{c.busy_today.project ? ` (${c.busy_today.project})` : ''}</span>
                        : c.open_elsewhere ? <span className="text-amber-600">On {c.open_elsewhere} open request{c.open_elsewhere === 1 ? '' : 's'} on another site</span>
                        : <span className="text-emerald-600">Free{c.last_worked ? ` · last worked ${formatDate(c.last_worked)}${c.last_site ? ` at ${c.last_site}` : ''}` : ''}</span>}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
      </ul>
    </div>
  )
}
