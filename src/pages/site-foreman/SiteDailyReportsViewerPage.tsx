import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import {
  BLOCKER_LABEL, NO_WORK_REASON_LABEL, PPE_LABEL, dayChip, dayLong, remindForeman, shiftDay, siteToday,
  useActivePauses, useSiteReportGaps, type Gap,
} from '@/lib/siteReports'
import type { SiteDailyReport, SiteReportWeather } from '@/types/database'
import {
  ClipboardCheck, ChevronDown, ChevronRight, CheckCircle2, Clock, Sun, Cloud, CloudRain, CloudDrizzle,
  Package, AlertTriangle, BellRing, PauseCircle, PlayCircle, CircleSlash, MessageSquare, Camera, Hammer, Users,
} from 'lucide-react'

type ReportRow = SiteDailyReport & {
  projects: { project_name: string } | null
  staff: { employee_name: string } | null
}

const WEATHER_ICON: Record<SiteReportWeather, typeof Sun> = {
  sunny: Sun, cloudy: Cloud, rain: CloudDrizzle, heavy_rain: CloudRain,
}

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'

// RLS is the real scope here (sdr_pm_read: the project's manager whatever
// their app role; sdr_exec_all: admin/exec). The follow-up panel comes from
// site_report_gaps(), which applies the same scope (migration 421).
export default function SiteDailyReportsViewerPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const projectFilter = searchParams.get('project')
  const setProjectFilter = (id: string | null) => {
    const p = new URLSearchParams(searchParams)
    if (id) p.set('project', id); else p.delete('project')
    setSearchParams(p, { replace: true })
  }
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
  const { data: gaps = [] } = useSiteReportGaps()
  const { data: pauses = [] } = useActivePauses()

  const projectOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const r of reports) if (r.projects?.project_name) seen.set(r.project_id, r.projects.project_name)
    for (const g of gaps) seen.set(g.project_id, g.project_name)
    return [...seen.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label))
  }, [reports, gaps])

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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800 dark:text-slate-100">
            <ClipboardCheck className="h-5 w-5 text-brand" /> Site Daily Reports
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            What each site foreman reported, and which working days are still missing.
          </p>
        </div>
        <div className="w-full max-w-xs">
          <SearchableSelect value={projectFilter} onChange={setProjectFilter} options={projectOptions} placeholder="All sites" />
        </div>
      </div>

      <FollowUp
        gaps={projectFilter ? gaps.filter(g => g.project_id === projectFilter) : gaps}
        reports={filtered}
        pauses={projectFilter ? pauses.filter(p => p.project_id === projectFilter) : pauses}
        projectNames={new Map(projectOptions.map(o => [o.id, o.label]))}
      />

      <h2 className="pt-2 text-sm font-semibold text-slate-700 dark:text-slate-200">Reports</h2>
      {isLoading ? (
        <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed py-12 text-center dark:border-slate-700">
          <ClipboardCheck className="mx-auto mb-2 h-8 w-8 text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {reports.length === 0 ? 'No site daily reports yet.' : 'No reports for this site yet.'}
          </p>
        </div>
      ) : (
        <div className="divide-y rounded-xl border bg-white shadow-sm dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800">
          {filtered.map(r => {
            const isOpen = expanded.has(r.id)
            const WeatherIcon = r.weather ? WEATHER_ICON[r.weather] : null
            return (
              <div key={r.id}>
                <button onClick={() => toggle(r.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/30">
                  {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{r.projects?.project_name ?? 'Unknown site'}</span>
                      <span className="text-xs text-slate-400">{dayLong(r.report_date)}</span>
                      {r.submitted_at ? (
                        <span className="flex items-center gap-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-3 w-3" />Sent</span>
                      ) : (
                        <span className="flex items-center gap-0.5 text-[10px] font-medium text-slate-400"><Clock className="h-3 w-3" />Draft</span>
                      )}
                      {r.site_status === 'no_work' && <Badge tone="slate">No work{r.no_work_reason ? ` · ${NO_WORK_REASON_LABEL[r.no_work_reason]}` : ''}</Badge>}
                      {r.site_status === 'partial' && <Badge tone="slate">Part day</Badge>}
                      {r.blocked && <Badge tone="red">Blocked{r.blocker_causes.length ? ` · ${r.blocker_causes.map(c => BLOCKER_LABEL[c] ?? c).join(', ')}` : ''}</Badge>}
                      {r.variation_instructed && <Badge tone="amber">Change requested</Badge>}
                      {!!r.office_needs && <Badge tone="blue">Needs the office</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {r.staff?.employee_name ?? 'Unknown foreman'}
                      {r.photos?.length ? ` · ${r.photos.length} photo${r.photos.length === 1 ? '' : 's'}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {WeatherIcon && <WeatherIcon className="h-4 w-4 text-slate-400" />}
                    {r.progress_percent_after != null && (
                      <span className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200">{r.progress_percent_after}%</span>
                    )}
                  </div>
                </button>
                {isOpen && <ReportDetail r={r} />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Follow-up: missing days per site ─────────────────────────────────────

type DayState = 'sent' | 'missing' | 'draft' | 'excused' | 'off' | 'today'

function FollowUp({ gaps, reports, pauses, projectNames }: {
  gaps: Gap[]
  reports: ReportRow[]
  pauses: { id: string; project_id: string; paused_from: string; reason: string }[]
  projectNames: Map<string, string>
}) {
  const today = siteToday()
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => shiftDay(today, i - 13)), [today])

  const { data: excused = [] } = useQuery({
    queryKey: ['site-report-excused', days[0]],
    queryFn: async () => {
      const { data } = await supabase.from('site_report_excused_days').select('project_id, report_date, reason').gte('report_date', days[0])
      return (data ?? []) as { project_id: string; report_date: string; reason: string }[]
    },
  })

  const sites = useMemo(() => {
    const ids = new Set<string>(gaps.map(g => g.project_id))
    for (const r of reports) if (r.report_date >= days[0] && r.submitted_at) ids.add(r.project_id)
    for (const p of pauses) ids.add(p.project_id)
    return [...ids].map(id => {
      const siteGaps = gaps.filter(g => g.project_id === id)
      const strip = days.map(d => {
        let state: DayState = 'off'
        if (reports.some(r => r.project_id === id && r.report_date === d && r.submitted_at)) state = 'sent'
        else if (d === today) state = 'today'
        else {
          const g = siteGaps.find(x => x.report_date === d)
          if (g) state = g.state
          else if (excused.some(x => x.project_id === id && x.report_date === d)) state = 'excused'
        }
        return { date: d, state }
      })
      return {
        id,
        name: siteGaps[0]?.project_name ?? projectNames.get(id) ?? 'Site',
        gaps: siteGaps,
        strip,
        pause: pauses.find(p => p.project_id === id) ?? null,
        foremen: siteGaps[0]?.foreman_names ?? [],
        pm: siteGaps[0]?.pm_name ?? null,
        lastReminded: siteGaps.reduce<string | null>((m, g) => (g.last_reminded_at && (!m || g.last_reminded_at > m) ? g.last_reminded_at : m), null),
      }
    }).sort((a, b) => b.gaps.length - a.gaps.length || a.name.localeCompare(b.name))
  }, [gaps, reports, pauses, excused, days, today, projectNames])

  if (sites.length === 0) return null
  const behind = sites.filter(s => s.gaps.length > 0)

  return (
    <section className="rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 dark:border-slate-700">
        <div>
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {behind.length ? `${behind.reduce((n, s) => n + s.gaps.length, 0)} working days without a report` : 'Every working day is reported'}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Last two weeks. Sundays, holidays and sites on hold are not counted.</p>
        </div>
        <Legend />
      </div>
      <ul className="divide-y dark:divide-slate-700">
        {sites.map(s => <SiteFollowUp key={s.id} site={s} />)}
      </ul>
    </section>
  )
}

function SiteFollowUp({ site }: {
  site: {
    id: string; name: string; gaps: Gap[]; strip: { date: string; state: DayState }[]
    pause: { id: string; paused_from: string; reason: string } | null
    foremen: string[]; pm: string | null; lastReminded: string | null
  }
}) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [mode, setMode] = useState<null | 'remind' | 'excuse' | 'pause'>(null)
  const [picked, setPicked] = useState<string[]>(() => site.gaps.map(g => g.report_date))
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const missingDates = site.gaps.map(g => g.report_date)
  const open = (m: 'remind' | 'excuse' | 'pause') => {
    setMode(cur => (cur === m ? null : m))
    setPicked(missingDates)
    setText('')
  }

  const refresh = () => {
    for (const k of ['site-report-gaps', 'site-report-summary', 'site-report-excused', 'site-report-pauses', 'ops-health-items'])
      qc.invalidateQueries({ queryKey: [k] })
  }

  async function run() {
    setBusy(true)
    try {
      if (mode === 'remind') {
        const n = await remindForeman({ project_id: site.id, dates: picked }, text)
        toast(n ? `Reminder sent to ${n === 1 ? (site.foremen[0] ?? 'the foreman') : `${n} foremen`}` : 'No other foreman on this site to remind', n ? 'success' : 'info')
      } else if (mode === 'excuse') {
        const { error } = await supabase.rpc('site_report_excuse', { p_project_id: site.id, p_dates: picked, p_reason: text })
        if (error) throw error
        toast(`${picked.length} day${picked.length === 1 ? '' : 's'} marked as no work`, 'success')
      } else if (mode === 'pause') {
        const { error } = await supabase.rpc('site_report_pause', {
          p_project_id: site.id, p_reason: text, p_from: missingDates[0] ?? siteToday(), p_until: null,
        })
        if (error) throw error
        toast('Site on hold — no reports expected until you resume it', 'success')
      }
      setMode(null); setText('')
      refresh()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function resume() {
    const { error } = await supabase.rpc('site_report_resume', { p_project_id: site.id })
    if (error) { toast(error.message, 'error'); return }
    toast('Reporting resumed from today', 'success')
    refresh()
  }

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-[12rem] flex-1">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{site.name}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {site.foremen.length ? `Foreman: ${site.foremen.join(', ')}` : 'Foreman'}
            {site.pm ? ` · PM: ${site.pm}` : ''}
            {site.lastReminded ? ` · reminded ${dayLong(site.lastReminded.slice(0, 10))}` : ''}
          </p>
        </div>
        <Strip strip={site.strip} />
      </div>

      {site.pause ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
          <PauseCircle className="h-3.5 w-3.5" /> On hold since {dayLong(site.pause.paused_from)}: {site.pause.reason}
          <button type="button" onClick={resume} className="ml-auto inline-flex items-center gap-1 font-medium text-brand hover:underline">
            <PlayCircle className="h-3.5 w-3.5" /> Resume reporting
          </button>
        </div>
      ) : site.gaps.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-red-600 dark:text-red-400">{site.gaps.length} missing:</span>
          {site.gaps.map(g => (
            <span key={g.report_date} title={g.had_activity ? 'Work was logged that day' : undefined}
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${g.state === 'draft'
                ? 'border border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300'
                : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'}`}>
              {dayChip(g.report_date)}{g.state === 'draft' ? ' · draft' : ''}{g.had_activity ? ' •' : ''}
            </span>
          ))}
          <div className="ml-auto flex flex-wrap gap-1.5">
            <ActionBtn active={mode === 'remind'} onClick={() => open('remind')} icon={BellRing} primary>Remind foreman</ActionBtn>
            <ActionBtn active={mode === 'excuse'} onClick={() => open('excuse')} icon={CircleSlash}>No work those days</ActionBtn>
            <ActionBtn active={mode === 'pause'} onClick={() => open('pause')} icon={PauseCircle}>Site on hold</ActionBtn>
          </div>
        </div>
      )}

      {mode && (
        <div className="mt-2 space-y-2 rounded-lg border bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40">
          {mode !== 'pause' && (
            <div className="flex flex-wrap gap-1.5">
              {missingDates.map(d => {
                const on = picked.includes(d)
                return (
                  <button key={d} type="button" aria-pressed={on}
                    onClick={() => setPicked(p => on ? p.filter(x => x !== d) : [...p, d].sort())}
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${on ? 'border-brand bg-brand/10 text-brand' : 'text-slate-500 dark:border-slate-600'}`}>
                    {dayChip(d)}
                  </button>
                )
              })}
            </div>
          )}
          <textarea rows={2} className={inputCls} value={text} onChange={e => setText(e.target.value)}
            placeholder={mode === 'remind'
              ? `Message to ${site.foremen.join(', ') || 'the foreman'} (optional) — e.g. "Send these before noon tomorrow"`
              : mode === 'excuse' ? 'Why was there no work? (e.g. client closed the building)'
              : `Why is the site on hold? Reports stop from ${missingDates[0] ? dayLong(missingDates[0]) : 'today'} until you resume.`} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setMode(null)} className="rounded-md px-3 py-1.5 text-xs text-slate-500 hover:bg-white dark:hover:bg-slate-800">Cancel</button>
            <button type="button" onClick={run}
              disabled={busy || (mode !== 'pause' && picked.length === 0) || (mode !== 'remind' && !text.trim())}
              className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-50">
              {busy ? 'Saving…' : mode === 'remind' ? 'Send reminder' : mode === 'excuse' ? `Mark ${picked.length} day${picked.length === 1 ? '' : 's'}` : 'Put on hold'}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

const STATE_STYLE: Record<DayState, { cls: string; label: string }> = {
  sent:    { cls: 'bg-emerald-500', label: 'Sent' },
  draft:   { cls: 'bg-amber-400', label: 'Draft only' },
  missing: { cls: 'bg-red-500', label: 'Missing' },
  excused: { cls: 'bg-slate-300 dark:bg-slate-600', label: 'No work' },
  off:     { cls: 'bg-slate-200/70 dark:bg-slate-700/60', label: 'Not expected' },
  today:   { cls: 'bg-white ring-1 ring-inset ring-slate-300 dark:bg-slate-800 dark:ring-slate-500', label: 'Today' },
}

function Strip({ strip }: { strip: { date: string; state: DayState }[] }) {
  return (
    <div className="flex items-end gap-0.5" aria-label="Last 14 days">
      {strip.map(d => (
        <div key={d.date} className="flex flex-col items-center gap-0.5">
          <span title={`${dayLong(d.date)} · ${STATE_STYLE[d.state].label}`} className={`h-5 w-3.5 rounded-sm ${STATE_STYLE[d.state].cls}`} />
          <span className="text-[9px] leading-none text-slate-400">{new Date(d.date + 'T00:00:00Z').getUTCDate()}</span>
        </div>
      ))}
    </div>
  )
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
      {(['sent', 'draft', 'missing', 'excused', 'off'] as DayState[]).map(s => (
        <span key={s} className="flex items-center gap-1"><span className={`h-2.5 w-2.5 rounded-sm ${STATE_STYLE[s].cls}`} />{STATE_STYLE[s].label}</span>
      ))}
    </div>
  )
}

function ActionBtn({ active, onClick, icon: Icon, primary, children }: { active: boolean; onClick: () => void; icon: typeof Sun; primary?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium ${primary
        ? 'bg-amber-600 text-white hover:bg-amber-700'
        : `border text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700 ${active ? 'bg-slate-100 dark:bg-slate-700' : ''}`}`}>
      <Icon className="h-3.5 w-3.5" /> {children}
    </button>
  )
}

// ── One report, opened ───────────────────────────────────────────────────

function ReportDetail({ r }: { r: ReportRow }) {
  const facts: { label: string; value: string }[] = []
  if (r.on_site_from || r.on_site_to) facts.push({ label: 'Hours', value: `${r.on_site_from?.slice(0, 5) ?? '?'}–${r.on_site_to?.slice(0, 5) ?? '?'}` })
  if (r.site_accessible && r.site_accessible !== 'yes') facts.push({ label: 'Site access', value: r.site_accessible === 'partial' ? 'Partly' : 'No access' })
  if (r.subcontractor_headcount) facts.push({ label: 'Subcontractor workers', value: String(r.subcontractor_headcount) })
  if (r.idle_hours) facts.push({ label: 'Idle hours', value: `${r.idle_hours}${r.idle_reason ? ` — ${r.idle_reason}` : ''}` })
  if (r.toolbox_talk != null) facts.push({ label: 'Toolbox talk', value: r.toolbox_talk ? 'Held' : 'Not held' })
  if (r.ppe_compliance) facts.push({ label: 'PPE worn by', value: PPE_LABEL[r.ppe_compliance] })
  if (r.delay_days) facts.push({ label: 'Possible delay', value: `${r.delay_days} day${Number(r.delay_days) === 1 ? '' : 's'}` })

  const notes: { label: string; value: string | null; icon?: typeof Sun; tone?: 'red' | 'amber' | 'blue' }[] = [
    { label: r.site_status === 'no_work' ? 'Notes' : 'What got done', value: r.progress_notes, icon: Hammer },
    { label: 'Blocking the work', value: r.blocked ? (r.blocker_notes || r.blocker_causes.map(c => BLOCKER_LABEL[c] ?? c).join(', ')) : null, icon: CircleSlash, tone: 'red' },
    { label: 'Change or extra work requested', value: r.variation_instructed ? (r.variation_notes || 'Yes') : null, icon: AlertTriangle, tone: 'amber' },
    { label: 'Client / consultant visit', value: r.client_visit ? (r.client_visit_notes || 'Yes') : null, icon: Users },
    { label: 'Needs from the office', value: r.office_needs, icon: MessageSquare, tone: 'blue' },
    { label: 'Materials — short or damaged', value: r.materials_notes, icon: Package },
    { label: 'Materials needed in the next 3 days', value: r.materials_needed_soon, icon: Package },
    { label: 'Near-misses', value: r.hse_near_miss_notes, icon: AlertTriangle },
    { label: 'Rework or defects', value: r.quality_issues },
    { label: 'Equipment problems', value: r.equipment_issues },
    { label: "Tomorrow's plan", value: r.tomorrow_plan },
  ]
  const shown = notes.filter(n => n.value)

  return (
    <div className="space-y-3 px-4 pb-4 pl-11">
      {facts.length > 0 && (
        <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
          {facts.map(f => (
            <div key={f.label}><dt className="inline text-slate-400">{f.label}: </dt><dd className="inline font-medium text-slate-700 dark:text-slate-200">{f.value}</dd></div>
          ))}
        </dl>
      )}
      {r.work_items?.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Work orders</p>
          {r.work_items.map(w => (
            <div key={w.work_order_id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">{w.label}</span>
              <span className="text-xs tabular-nums text-slate-500">{Number(w.progress_before ?? 0)}% → <b className="text-emerald-600 dark:text-emerald-400">{w.progress_after ?? '—'}%</b></span>
              {w.note && <span className="hidden max-w-[40%] truncate text-xs text-slate-400 sm:inline">{w.note}</span>}
            </div>
          ))}
        </div>
      )}
      {shown.map(n => <Field key={n.label} label={n.label} value={n.value!} icon={n.icon} tone={n.tone} />)}
      {r.photos?.length > 0 && (
        <div>
          <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"><Camera className="h-3 w-3" />Photos</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {r.photos.map(p => (
              <a key={p.url} href={p.url} target="_blank" rel="noreferrer" className="block h-20 w-20 overflow-hidden rounded-lg border dark:border-slate-700">
                <img src={p.url} alt={p.name ?? 'Site photo'} className="h-full w-full object-cover" />
              </a>
            ))}
          </div>
        </div>
      )}
      {shown.length === 0 && facts.length === 0 && !r.work_items?.length && (
        <p className="text-xs text-slate-400">No notes recorded on this report.</p>
      )}
    </div>
  )
}

function Badge({ tone, children }: { tone: 'red' | 'amber' | 'blue' | 'slate'; children: React.ReactNode }) {
  const cls = {
    red: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    slate: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  }[tone]
  return <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{children}</span>
}

function Field({ label, value, icon: Icon, tone }: { label: string; value: string; icon?: typeof Sun; tone?: 'red' | 'amber' | 'blue' }) {
  const box = tone === 'red' ? 'border-l-2 border-red-400 pl-2' : tone === 'amber' ? 'border-l-2 border-amber-400 pl-2' : tone === 'blue' ? 'border-l-2 border-blue-400 pl-2' : ''
  return (
    <div className={box}>
      <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {Icon && <Icon className="h-3 w-3" />}{label}
      </p>
      <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{value}</p>
    </div>
  )
}
