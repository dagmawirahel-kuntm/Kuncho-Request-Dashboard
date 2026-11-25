import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { dayLabel, isoDay } from '@/lib/labour'
import { tradeName, type CrewRequest, type DaySheet } from '@/lib/labourDay'

// Who is actually on the project's crew, against what is approved, by trade.
// The approved crew is only a count per trade ("31 workers"); the names come
// from the latest day sheet — today's if saved, else the last one before.
export function CrewRoster({ project, crew }: { project: string; crew: Pick<CrewRequest, 'labour_day_request_lines'> }) {
  const today = isoDay(new Date())
  const { data: sheet, isLoading } = useQuery({
    queryKey: ['labour-day', project, today],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('labour_day_get', { p_project: project, p_date: today })
      if (error) throw error
      return data as DaySheet
    },
  })
  if (isLoading) return <p className="text-xs text-slate-400">Loading who is on the crew…</p>
  const workers = sheet?.workers ?? []
  const asOf = sheet?.prefilled_from ?? (sheet?.day?.saved_at ? today : null)
  if (!workers.length) return <p className="text-xs text-slate-500">No day sheet yet, so there are no names to show against the crew.</p>

  const m = new Map<string, { asked: number; names: string[] }>()
  for (const l of crew.labour_day_request_lines) if (l.headcount > 0) m.set(l.trade_tag, { asked: l.headcount, names: [] })
  for (const w of workers) {
    const t = w.trade ?? 'none'
    const v = m.get(t) ?? { asked: 0, names: [] }
    v.names.push(w.name)
    m.set(t, v)
  }
  const rows = [...m].sort((a, b) => tradeName(a[0]).localeCompare(tradeName(b[0])))
  const asked = rows.reduce((s, [, v]) => s + v.asked, 0)
  const off = rows.filter(([, v]) => v.names.length !== v.asked).length

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-slate-500">
        On the day sheet{asOf ? ` of ${dayLabel(asOf)}` : ''}: <b className="text-slate-700 dark:text-slate-200">{workers.length}</b> of {asked} approved
        {off > 0 && <span className="ml-1 font-medium text-amber-700 dark:text-amber-300">· {off} trade{off === 1 ? '' : 's'} don't match</span>}
      </p>
      <ul className="divide-y rounded-xl border text-sm dark:divide-slate-700 dark:border-slate-700">
        {rows.map(([t, v]) => {
          const n = v.names.length
          const tone = n === v.asked ? '' : n > v.asked ? 'bg-red-50 dark:bg-red-900/15' : 'bg-amber-50 dark:bg-amber-900/15'
          const tag = n === v.asked ? null
            : v.asked === 0 ? { text: 'not in the approved crew', cls: 'text-red-700 dark:text-red-300' }
            : n > v.asked ? { text: `${n - v.asked} over`, cls: 'text-red-700 dark:text-red-300' }
            : { text: `${v.asked - n} short`, cls: 'text-amber-700 dark:text-amber-300' }
          return (
            <li key={t} className={`px-3 py-2 ${tone}`}>
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium text-slate-800 dark:text-slate-100">{tradeName(t === 'none' ? null : t)}</span>
                <span className="tabular-nums text-xs text-slate-500">{n} of {v.asked}</span>
                {tag && <span className={`text-xs font-semibold ${tag.cls}`}>{tag.text}</span>}
              </p>
              {n > 0 && <p className="text-xs text-slate-600 dark:text-slate-300">{v.names.sort((a, b) => a.localeCompare(b)).join(', ')}</p>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
