import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ClipboardX, BellRing, X, ChevronRight } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import { dayChip, remindForeman, siteToday, useSiteReportSummary, type PmSite } from '@/lib/siteReports'
import { SiteReportNudge } from '@/pages/site-foreman/YesterdayNudge'

const DISMISS_KEY = 'pm-site-report-nudge-dismissed'

function ago(iso: string) {
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3600000)
  if (h < 1) return 'just now'
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

// For project managers: working days on their sites with no report from the
// foreman (migration 421). Dismissing hides it until tomorrow.
export function PmSiteReportNudge({ compact = false }: { compact?: boolean }) {
  const { data } = useSiteReportSummary()
  const { toast } = useToast()
  const qc = useQueryClient()
  const today = siteToday()
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === today } catch { return false }
  })
  const [busy, setBusy] = useState<string | null>(null)
  const sites = data?.as_pm ?? []
  if (sites.length === 0 || (dismissed && !compact)) return null

  const totalDays = sites.reduce((n, s) => n + s.dates.length, 0)

  async function remind(s: PmSite) {
    setBusy(s.project_id)
    try {
      const n = await remindForeman(s)
      toast(n ? `Reminder sent to ${n === 1 ? (s.foremen?.[0] ?? 'the foreman') : `${n} foremen`}` : 'No other foreman on this site to remind', n ? 'success' : 'info')
      qc.invalidateQueries({ queryKey: ['site-report-summary'] })
      qc.invalidateQueries({ queryKey: ['site-report-gaps'] })
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800/40 dark:bg-amber-900/10 dark:text-amber-200">
      <div className="flex items-start gap-2">
        <ClipboardX className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="flex-1">
          <b>{totalDays} daily site report{totalDays === 1 ? '' : 's'} not in</b> on {sites.length === 1 ? 'your site' : `${sites.length} of your sites`}.
          <span className="text-amber-800/80 dark:text-amber-300/80"> Remind the foreman, or mark days with no work.</span>
        </p>
        {!compact && (
          <button type="button" aria-label="Hide until tomorrow" title="Hide until tomorrow"
            onClick={() => { try { localStorage.setItem(DISMISS_KEY, today) } catch { /* private mode */ } setDismissed(true) }}
            className="rounded p-0.5 text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/40">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <ul className="mt-2 space-y-1.5">
        {sites.map(s => (
          <li key={s.project_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-white/70 px-2.5 py-2 dark:bg-amber-950/20">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{s.project_name}</p>
              <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80">
                {s.dates.length} day{s.dates.length === 1 ? '' : 's'} · {s.dates.slice(0, 6).map(dayChip).join(', ')}{s.dates.length > 6 ? '…' : ''}
                {s.foremen?.length ? ` · ${s.foremen.join(', ')}` : ''}
                {s.drafts ? ` · ${s.drafts} saved as draft` : ''}
              </p>
            </div>
            <span className="text-[11px] text-amber-700/80 dark:text-amber-300/70">
              {s.last_reminded_at ? `Reminded ${ago(s.last_reminded_at)}` : 'Not reminded yet'}
            </span>
            <button type="button" disabled={busy === s.project_id} onClick={() => remind(s)}
              className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50">
              <BellRing className="h-3.5 w-3.5" /> {busy === s.project_id ? 'Sending…' : 'Remind foreman'}
            </button>
            <Link to={`/site-foreman/reports?project=${s.project_id}`} className="inline-flex items-center text-xs font-medium text-amber-800 hover:underline dark:text-amber-200">
              Review <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Both nudges, for landing pages: the PM's sites, then the foreman's own. */
export function SiteReportNudges() {
  return (
    <div className="mb-4 space-y-2 print:hidden empty:hidden">
      <PmSiteReportNudge />
      <SiteReportNudge />
    </div>
  )
}
