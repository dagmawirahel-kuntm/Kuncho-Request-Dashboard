import { Link } from 'react-router-dom'
import { AlertTriangle, MessageSquareQuote } from 'lucide-react'
import { dayChip, reportLink, siteToday, useSiteReportSummary } from '@/lib/siteReports'

// Shown above every Site Ops page: the working days on the foreman's sites
// that still have no report (migration 421), the project manager's latest
// reminder about them, and today's report if it is not in yet. Never blocks.
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
