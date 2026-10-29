import { useState } from 'react'
import { Link } from 'react-router-dom'
import { dayLabel, fmtMoney } from '@/lib/labour'
import { useLabourFlags } from '@/lib/labourDay'
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'

const card = 'rounded-2xl border bg-white dark:border-slate-700 dark:bg-slate-800'

// The four flags (491): days that don't add up or weren't recorded,
// projects over their labour budget, projects delivered but not closed,
// returns waiting for inspection. Each one opens where it's fixed.
export function LabourFlagsPanel({ compact = false }: { compact?: boolean }) {
  const { data: f } = useLabourFlags()
  const [open, setOpen] = useState<string | null>(compact ? null : 'days')
  if (!f) return null
  const groups = [
    {
      key: 'days', title: 'Days that don\'t add up', hint: 'Allocated labour isn\'t the same as the paid day, nothing was recorded, or it\'s waiting for review.',
      items: f.day_mismatches.map(d => ({ key: `${d.pm_staff_id}-${d.date}`, to: `/labour/day?date=${d.date}&pm=${d.pm_staff_id}`, text: `${d.pm} · ${dayLabel(d.date)}`, sub: d.why })),
    },
    {
      key: 'budget', title: 'Over their labour budget', hint: 'Labour so far, every way it was recorded, against the project\'s Labor budget.',
      items: f.over_budget.map(p => ({ key: p.project_id, to: `/projects/${p.project_id}?tab=budget`, text: p.project, sub: `${fmtMoney(p.cost)} of ${fmtMoney(p.budget)} · ${fmtMoney(p.over)} over` })),
    },
    {
      key: 'open', title: `Delivered, costing still open after ${f.costing_open_days} days`, hint: 'Fixtures back, inspected and repaired? Finance closes costing.',
      items: f.costing_open.map(p => ({ key: p.project_id, to: `/projects/${p.project_id}?tab=closing`, text: p.project, sub: `Delivered ${p.days} days ago` })),
    },
    {
      key: 'inspect', title: 'Returned fixtures waiting for inspection', hint: 'Received back from the event, not checked yet.',
      items: f.awaiting_inspection.map(c => ({ key: c.check_id, to: `/projects/${c.project_id}?tab=closing`, text: `${c.project} · ${c.code}`, sub: `${Number(c.items)} item${Number(c.items) === 1 ? '' : 's'} · back ${new Date(c.received_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` })),
    },
  ]
  const n = groups.reduce((s, g) => s + g.items.length, 0)
  if (compact && n === 0) return null

  return (
    <section className={card}>
      <h2 className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100">
        <AlertTriangle className={`h-4 w-4 ${n ? 'text-amber-500' : 'text-slate-300'}`} /> Flags
        <span className="text-slate-400">{n}</span>
      </h2>
      <ul className="divide-y dark:divide-slate-700">
        {groups.map(g => (
          <li key={g.key}>
            <button onClick={() => setOpen(o => (o === g.key ? null : g.key))} disabled={!g.items.length}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left disabled:cursor-default">
              <span className={`min-w-[1.75rem] rounded-full px-2 py-0.5 text-center text-xs font-bold ${g.items.length ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-400 dark:bg-slate-700'}`}>{g.items.length}</span>
              <span className="flex-1 text-sm text-slate-700 dark:text-slate-200">{g.title}</span>
              {g.items.length > 0 && (open === g.key ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />)}
            </button>
            {open === g.key && g.items.length > 0 && (
              <div className="pb-2">
                <p className="px-4 pb-1 text-xs text-slate-500">{g.hint}</p>
                <ul>
                  {g.items.map(i => (
                    <li key={i.key}>
                      <Link to={i.to} className="flex items-baseline gap-2 px-4 py-1.5 pl-14 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/40">
                        <span className="text-slate-800 dark:text-slate-100">{i.text}</span>
                        <span className="text-xs text-slate-500">{i.sub}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
