import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { SiteDailyReport, SiteReportWeather } from '@/types/database'
import {
  ClipboardCheck, ChevronDown, ChevronRight, CheckCircle2, Clock,
  Sun, Cloud, CloudRain, CloudDrizzle, Package, AlertTriangle,
} from 'lucide-react'

type ReportRow = SiteDailyReport & {
  projects: { project_name: string } | null
  staff: { employee_name: string } | null
}

const WEATHER_ICON: Record<SiteReportWeather, typeof Sun> = {
  sunny: Sun, cloudy: Cloud, rain: CloudDrizzle, heavy_rain: CloudRain,
}

// RLS is the real scope here (sdr_pm_read limits a PM to their own
// managed projects, sdr_exec_all gives admin/exec everything) — this
// page just renders whatever comes back. Was previously unreachable:
// no page anywhere read this table besides the foreman's own write
// form, even though the read policies were built for exactly this.
export default function SiteDailyReportsViewerPage() {
  const [projectFilter, setProjectFilter] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const { data: reports = [], isLoading } = useQuery({
    queryKey: ['site-daily-reports-viewer'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('site_daily_reports')
        .select('*, projects(project_name), staff:foreman_staff_id(employee_name)')
        .order('report_date', { ascending: false })
        .limit(300)
      if (error) throw error
      return data as unknown as ReportRow[]
    },
  })

  const projectOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const r of reports) {
      if (r.projects?.project_name) seen.set(r.project_id, r.projects.project_name)
    }
    return [...seen.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label))
  }, [reports])

  const filtered = useMemo(() =>
    projectFilter ? reports.filter(r => r.project_id === projectFilter) : reports
  , [reports, projectFilter])

  function toggle(id: string) {
    setExpanded(s => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5 text-brand" /> Site Daily Reports
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          What every site foreman has actually reported — progress, materials, HSE, and tomorrow's plan.
        </p>
      </div>

      <div className="max-w-xs">
        <SearchableSelect value={projectFilter} onChange={setProjectFilter} options={projectOptions} placeholder="All projects" />
      </div>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed dark:border-slate-700 py-12 text-center">
          <ClipboardCheck className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600 mb-2" />
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {reports.length === 0 ? 'No site daily reports yet.' : 'No reports for this project.'}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm divide-y dark:divide-slate-700">
          {filtered.map(r => {
            const isOpen = expanded.has(r.id)
            const WeatherIcon = r.weather ? WEATHER_ICON[r.weather] : null
            return (
              <div key={r.id}>
                <button onClick={() => toggle(r.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                  {isOpen ? <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" /> : <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{r.projects?.project_name ?? 'Unknown site'}</span>
                      <span className="text-xs text-slate-400">{formatDate(r.report_date)}</span>
                      {r.submitted_at ? (
                        <span className="flex items-center gap-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" />Submitted
                        </span>
                      ) : (
                        <span className="flex items-center gap-0.5 text-[10px] font-medium text-slate-400">
                          <Clock className="h-3 w-3" />Draft
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">{r.staff?.employee_name ?? 'Unknown foreman'}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {WeatherIcon && <WeatherIcon className="h-4 w-4 text-slate-400" />}
                    {r.progress_percent_after != null && (
                      <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 tabular-nums">{r.progress_percent_after}%</span>
                    )}
                  </div>
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 pl-11 space-y-3">
                    {r.site_accessible && r.site_accessible !== 'yes' && (
                      <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Site access: {r.site_accessible === 'partial' ? 'Partial' : 'No access'}
                      </p>
                    )}
                    {r.progress_notes && (
                      <Field label="Progress notes" value={r.progress_notes} />
                    )}
                    {r.materials_notes && (
                      <Field label="Materials — shortages / issues" value={r.materials_notes} icon={Package} />
                    )}
                    {r.hse_near_miss_notes && (
                      <Field label="HSE near-misses" value={r.hse_near_miss_notes} icon={AlertTriangle} />
                    )}
                    {r.tomorrow_plan && (
                      <Field label="Tomorrow's plan" value={r.tomorrow_plan} />
                    )}
                    {!r.progress_notes && !r.materials_notes && !r.hse_near_miss_notes && !r.tomorrow_plan && (
                      <p className="text-xs text-slate-400">No notes recorded on this report.</p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Field({ label, value, icon: Icon }: { label: string; value: string; icon?: typeof Package }) {
  return (
    <div>
      <p className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
        {Icon && <Icon className="h-3 w-3" />}{label}
      </p>
      <p className="mt-0.5 text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{value}</p>
    </div>
  )
}
