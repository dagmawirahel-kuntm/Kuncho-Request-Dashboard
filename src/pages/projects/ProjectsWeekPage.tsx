import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Pill } from '@/components/record/Record'
import { DayBars, WeekNav } from '@/components/projects/WeekParts'
import { fmtMoney } from '@/lib/labour'
import { thisMonday, useWeekOverview } from '@/lib/weekSummary'
import { CalendarRange, ChevronRight } from 'lucide-react'

const card = 'rounded-2xl border bg-white dark:border-slate-700 dark:bg-slate-800'

// Every site's week on one page (480): one row a project, busiest first.
// Open a row for the full summary — the same one its Telegram group gets.
export default function ProjectsWeekPage() {
  const [from, setFrom] = useState(thisMonday())
  const { data, isLoading } = useWeekOverview(from)
  const rows = data?.projects ?? []
  const total = rows.reduce((s, r) => s + r.labour.person_days, 0)
  const cost = rows.some(r => r.costs) ? rows.reduce((s, r) => s + Number(r.labour.cost ?? 0), 0) : null

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-10">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-bold text-slate-800 dark:text-slate-100"><CalendarRange className="h-5 w-5 text-brand" /> This week on site</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Each site's week in one line: people, work orders moved, what's late and what's waiting.</p>
      </div>
      <WeekNav from={from} onChange={setFrom} />
      {rows.length > 0 && (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          <b>{total}</b> person-days across <b>{rows.length}</b> site{rows.length === 1 ? '' : 's'}{cost != null ? ` · ${fmtMoney(cost)} labour` : ''}
        </p>
      )}
      {isLoading ? <p className="py-10 text-center text-sm text-slate-400">Loading…</p> : rows.length === 0 ? (
        <p className={`${card} p-8 text-center text-sm text-slate-500`}>No labour or progress recorded on any site this week.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map(r => {
            const l = r.labour
            const delta = l.prev_person_days ? l.person_days - l.prev_person_days : null
            return (
              <li key={r.project.id}>
                <Link to={`/projects/${r.project.id}?tab=summary`} className={`${card} flex items-center gap-4 p-4 hover:border-brand`}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-800 dark:text-slate-100">{r.project.name}</p>
                    <p className="truncate text-xs text-slate-500">{r.project.pm ?? 'No project manager'}</p>
                    <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
                      <b>{l.person_days}</b> person-days · {l.workers} worker{l.workers === 1 ? '' : 's'}
                      {delta != null && <span className={`ml-1 text-xs ${delta < 0 ? 'text-amber-600' : 'text-emerald-600'}`}>({delta >= 0 ? '+' : ''}{delta})</span>}
                      {r.costs && l.cost ? <span className="text-slate-500"> · {fmtMoney(l.cost)}</span> : null}
                    </p>
                    <p className="text-xs text-slate-500">
                      {r.orders_worked} work order{r.orders_worked === 1 ? '' : 's'} worked
                      {r.gain != null ? ` · +${r.gain}% average progress` : ''}
                      {r.finished ? ` · ${r.finished} finished` : ''}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {r.no_update > 0 && <Pill tone="amber">{r.no_update} no progress update</Pill>}
                      {r.overdue > 0 && <Pill tone="red">{r.overdue} overdue</Pill>}
                      {r.pay.to_request > 0 && <Pill tone="blue">{r.pay.to_request} pay sheet{r.pay.to_request === 1 ? '' : 's'} to request</Pill>}
                      {r.pay.returned > 0 && <Pill tone="red">Pay request sent back</Pill>}
                      {r.unverified > 0 && <Pill>{r.unverified} not verified</Pill>}
                    </div>
                  </div>
                  <div className="hidden w-28 shrink-0 sm:block"><DayBars days={r.by_day} height={44} /></div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
