import { Link } from 'react-router-dom'
import { AlertTriangle, Layers, MessageSquareQuote } from 'lucide-react'
import { dayChip, reportLink, shiftDay, siteToday, useSiteReportSummary } from '@/lib/siteReports'

// Shown above every Site Ops page: the working days on the foreman's sites
// that still have no report (migration 421), the project manager's latest
// reminder about them, and today's report if it is not in yet. Never blocks.
// When two or more owed days fall within three days, it offers one summary
// for them (migration 427).

/** The latest owed days one summary (up to 3 calendar days) can cover: consecutive
 *  owed days, stepping over a Sunday only — any other day in between may already
 *  be reported, and a summary may not cover a day twice. */
function summaryRun(dates: string[]): { from: string; to: string; days: number; owed: number } | null {
  if (dates.length < 2) return null
  const owedSet = new Set(dates)
  const to = [...dates].sort()[dates.length - 1]
  let from = to, owed = 1
  for (let back = 1; back <= 2; back++) {
    const d = shiftDay(to, -back)
    if (owedSet.has(d)) { from = d; owed++; continue }
    if (new Date(`${d}T00:00:00Z`).getUTCDay() === 0) continue
    break
  }
  if (owed < 2) return null
  return { from, to, days: Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1, owed }
}
export function SiteReportNudge() {
  const { data } = useSiteReportSummary()
  const owed = data?.as_foreman ?? []
  const dueToday = (data?.due_today ?? []).filter(d => !owed.some(o => o.project_id === d.project_id))
  if (owed.length === 0 && dueToday.length === 0) return null

  return (
    <div className="space-y-2">
      {owed.map(s => (
        <div key={s.project_id} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/10 dark:text-amber-300">
          <p className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              <b>{s.project_name}</b> has {s.days.length} working day{s.days.length === 1 ? '' : 's'} without a report.
              {s.pm_name ? ` ${s.pm_name} is waiting for ${s.days.length === 1 ? 'it' : 'them'}.` : ''}
            </span>
          </p>
          {s.reminder && (
            <p className="mt-1.5 ml-5 flex items-start gap-1.5 rounded-md bg-white/70 px-2 py-1 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <MessageSquareQuote className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span><b>{s.reminder.from}</b>: {s.reminder.message || 'Please send the missing daily reports.'}</span>
            </p>
          )}
          <div className="mt-1.5 ml-5 flex flex-wrap gap-1">
            {(() => {
              const run = summaryRun(s.days.map(d => d.date))
              return run && (
                <Link to={`${reportLink(s.project_id, run.to)}&days=${run.days}`}
                  title={`One report for ${dayChip(run.from)} to ${dayChip(run.to)}`}
                  className="inline-flex items-center gap-1 rounded-full border border-amber-600 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-100 dark:bg-transparent dark:text-amber-200 dark:hover:bg-amber-900/30">
                  <Layers className="h-3 w-3" /> One summary for {dayChip(run.from)}–{dayChip(run.to)}
                </Link>
              )
            })()}
            {s.days.map(d => (
              <Link key={d.date} to={reportLink(s.project_id, d.date)}
                className="rounded-full bg-amber-600 px-2.5 py-0.5 text-[11px] font-medium text-white hover:bg-amber-700">
                {dayChip(d.date)}{d.draft_id ? ' · draft' : ''}
              </Link>
            ))}
          </div>
        </div>
      ))}
      {dueToday.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:border-blue-800/40 dark:bg-blue-900/10 dark:text-blue-300">
          <span>Today's report is not in yet for</span>
          {dueToday.map(d => (
            <Link key={d.project_id} to={reportLink(d.project_id, siteToday())}
              className="rounded-full bg-blue-600 px-2.5 py-0.5 text-[11px] font-medium text-white hover:bg-blue-700">
              {d.project_name}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

/** Old name, still used by the other Site Ops pages. */
export const YesterdayNudge = SiteReportNudge
