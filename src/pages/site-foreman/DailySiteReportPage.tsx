import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useMySiteForemanProjects, useMyStaffId } from '@/hooks/useMyStaff'
import { useToast } from '@/contexts/ToastContext'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { FileUpload } from '@/components/shared/FileUpload'
import { SiteReportNudge } from './YesterdayNudge'
import {
  BLOCKER_CAUSES, NO_WORK_REASON_LABEL, PPE_LABEL, SITE_STATUS_LABEL, coversDay, dayChip, dayLong, reportDays, shiftDay, siteToday,
  useSiteReportSummary, type NoWorkReason, type PpeCompliance, type SiteStatus, type WorkItem,
} from '@/lib/siteReports'
import {
  CheckCircle2, Cloud, CloudRain, Sun, CloudDrizzle, AlertTriangle, Camera, X, Clock, Hammer, Users,
  Package, ShieldCheck, MessageSquare, CalendarClock, Wrench, CircleSlash,
} from 'lucide-react'
import type { SiteDailyReport, SiteReportWeather, SiteAccessible } from '@/types/database'

const WEATHER_OPTIONS: { value: SiteReportWeather; label: string; icon: typeof Sun }[] = [
  { value: 'sunny', label: 'Sunny', icon: Sun },
  { value: 'cloudy', label: 'Cloudy', icon: Cloud },
  { value: 'rain', label: 'Rain', icon: CloudDrizzle },
  { value: 'heavy_rain', label: 'Heavy rain', icon: CloudRain },
]

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 disabled:opacity-60'
const labelCls = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300'

type OpenWo = { id: string; title: string | null; work_type: string | null; scope_of_work: string | null; status: string; current_progress_pct: number | null }

export default function DailySiteReportPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const draftId = searchParams.get('draft')
  const { data: staff } = useMyStaffId()
  const { projects } = useMySiteForemanProjects()
  const projectOptions = useMemo(() => projects.map(p => ({ id: p.id, label: p.project_name })), [projects])
  const today = siteToday()

  // A draft link carries its own project and date.
  const { data: draft } = useQuery({
    queryKey: ['site-daily-report-draft', draftId],
    enabled: !!draftId,
    queryFn: async () => {
      const { data } = await supabase.from('site_daily_reports').select('project_id, report_date').eq('id', draftId!).maybeSingle()
      return data as { project_id: string; report_date: string } | null
    },
  })

  const projectId = draft?.project_id ?? searchParams.get('project') ?? (projects.length === 1 ? projects[0].id : null)
  const reportDate = draft?.report_date ?? searchParams.get('date') ?? today

  // How many days this report covers, ending on reportDate (migration 427).
  const askedSpan = Math.min(3, Math.max(1, Number(searchParams.get('days')) || 1))

  function pick(next: { project?: string | null; date?: string; days?: number }) {
    const p = new URLSearchParams()
    const proj = next.project !== undefined ? next.project : projectId
    if (proj) p.set('project', proj)
    p.set('date', next.date ?? reportDate)
    const days = next.days ?? askedSpan
    if (days > 1) p.set('days', String(days))
    setSearchParams(p, { replace: true })
  }

  const { data: summary } = useSiteReportSummary()
  const missingHere = summary?.as_foreman.find(s => s.project_id === projectId)?.days ?? []

  // This day's report: a sent one that covers it (a summary may end up to two
  // days later), else this day's own draft unless a summary replaced it.
  const { data: existing, isFetched } = useQuery({
    queryKey: ['site-daily-report', projectId, reportDate, staff?.id],
    enabled: !!projectId && !!staff?.id,
    queryFn: async () => {
      const { data } = await supabase.from('site_daily_reports').select('*')
        .eq('project_id', projectId!).eq('foreman_staff_id', staff!.id)
        .gte('report_date', reportDate).lte('report_date', shiftDay(reportDate, 2))
      const rows = (data ?? []) as SiteDailyReport[]
      return rows.find(r => r.submitted_at && coversDay(r, reportDate))
        ?? rows.find(r => r.report_date === reportDate && !r.submitted_at && !r.superseded_by) ?? null
    },
  })
  const endDate = existing?.report_date ?? reportDate
  const span = existing
    ? Math.round((Date.parse(existing.report_date) - Date.parse(existing.covers_from ?? existing.report_date)) / 86_400_000) + 1
    : askedSpan
  const coversFrom = shiftDay(endDate, -(span - 1))
  const owedHere = missingHere.length

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <SiteReportNudge />
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Daily Site Report</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          One report per site per working day, or one summary for up to 3 days when you could not send each evening. Headcount, materials, safety and work orders fill in from what was logged; the rest takes a few taps.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-xl border bg-white p-4 dark:border-slate-700 dark:bg-slate-800 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Site</label>
          <SearchableSelect value={projectId} onChange={v => pick({ project: v })} options={projectOptions} placeholder="Pick one of your sites…" />
        </div>
        <div>
          <label className={labelCls}>Day</label>
          <input type="date" className={inputCls} value={reportDate} max={today} onChange={e => e.target.value && pick({ date: e.target.value })} />
          <div className="mt-1.5 flex flex-wrap gap-1">
            <DayChip active={reportDate === today} onClick={() => pick({ date: today })}>Today</DayChip>
            <DayChip active={reportDate === shiftDay(today, -1)} onClick={() => pick({ date: shiftDay(today, -1) })}>Yesterday</DayChip>
            {missingHere.filter(d => d.date !== shiftDay(today, -1)).map(d => (
              <DayChip key={d.date} active={reportDate === d.date} tone="amber" onClick={() => pick({ date: d.date })}>{dayChip(d.date)}</DayChip>
            ))}
          </div>
          {missingHere.length > 0 && (
            <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">Amber days are still owed for this site.</p>
          )}
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>This report covers</label>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-lg border dark:border-slate-600" role="radiogroup" aria-label="Days this report covers">
              {[1, 2, 3].map(n => (
                <button key={n} type="button" role="radio" aria-checked={span === n} disabled={!!existing?.submitted_at}
                  onClick={() => pick({ date: endDate, days: n })}
                  className={`px-3.5 py-1.5 text-sm font-medium transition-colors disabled:cursor-default ${span === n
                    ? 'bg-brand text-white dark:text-brand-foreground'
                    : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700'}`}>
                  {n === 1 ? '1 day' : `${n} days`}
                </button>
              ))}
            </div>
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{reportDays({ report_date: endDate, covers_from: span > 1 ? coversFrom : null })}</span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {span > 1
              ? `One summary for ${dayChip(coversFrom)} to ${dayChip(endDate)}: each of these days counts as reported. Drafts you started for them are replaced when you send.`
              : owedHere > 1
                ? 'Owe a few days? Pick the last one and choose 2 or 3 days to send one summary.'
                : 'Could not report for a day or two? Pick the last day and choose 2 or 3 days.'}
          </p>
        </div>
      </div>

      {projectId && staff?.id && isFetched && (
        <ReportForm
          key={`${projectId}|${endDate}|${span}|${existing?.id ?? 'new'}`}
          projectId={projectId}
          reportDate={endDate}
          coversFrom={span > 1 ? coversFrom : null}
          staffId={staff.id}
          existing={existing ?? null}
        />
      )}
    </div>
  )
}

// A summary's site status speaks of the days, not the day.
const MULTI_STATUS_LABEL: Record<SiteStatus, string> = { working: 'Worked every day', partial: 'Some days or part days', no_work: 'No work' }

function ReportForm({ projectId, reportDate, coversFrom, staffId, existing }: {
  projectId: string; reportDate: string
  /** First day of a 2–3 day summary; null for one day. */
  coversFrom: string | null
  staffId: string; existing: SiteDailyReport | null
}) {
  const from = coversFrom ?? reportDate
  const multi = !!coversFrom
  const days = multi ? Math.round((Date.parse(reportDate) - Date.parse(from)) / 86_400_000) + 1 : 1
  const { toast } = useToast()
  const qc = useQueryClient()
  const locked = !!existing?.submitted_at
  const e = existing

  const [siteStatus, setSiteStatus] = useState<SiteStatus>(e?.site_status ?? 'working')
  const [noWorkReason, setNoWorkReason] = useState<NoWorkReason | null>(e?.no_work_reason ?? null)
  const [weather, setWeather] = useState<SiteReportWeather | null>(e?.weather ?? null)
  const [siteAccessible, setSiteAccessible] = useState<SiteAccessible>(e?.site_accessible ?? 'yes')
  const [onSiteFrom, setOnSiteFrom] = useState(e?.on_site_from?.slice(0, 5) ?? '')
  const [onSiteTo, setOnSiteTo] = useState(e?.on_site_to?.slice(0, 5) ?? '')
  const [progressPct, setProgressPct] = useState(e?.progress_percent_after != null ? String(e.progress_percent_after) : '')
  const [progressNotes, setProgressNotes] = useState(e?.progress_notes ?? '')
  const [items, setItems] = useState<Record<string, WorkItem>>(() =>
    Object.fromEntries((e?.work_items ?? []).map(w => [w.work_order_id, w])))
  const [subCrew, setSubCrew] = useState(e?.subcontractor_headcount != null ? String(e.subcontractor_headcount) : '')
  const [idleHours, setIdleHours] = useState(e?.idle_hours != null ? String(e.idle_hours) : '')
  const [idleReason, setIdleReason] = useState(e?.idle_reason ?? '')
  const [blocked, setBlocked] = useState<boolean | null>(e?.blocked ?? null)
  const [causes, setCauses] = useState<string[]>(e?.blocker_causes ?? [])
  const [blockerNotes, setBlockerNotes] = useState(e?.blocker_notes ?? '')
  const [delayDays, setDelayDays] = useState(e?.delay_days != null ? String(e.delay_days) : '')
  const [materialsNotes, setMaterialsNotes] = useState(e?.materials_notes ?? '')
  const [materialsSoon, setMaterialsSoon] = useState(e?.materials_needed_soon ?? '')
  const [clientVisit, setClientVisit] = useState<boolean | null>(e?.client_visit ?? null)
  const [clientNotes, setClientNotes] = useState(e?.client_visit_notes ?? '')
  const [variation, setVariation] = useState<boolean | null>(e?.variation_instructed ?? null)
  const [variationNotes, setVariationNotes] = useState(e?.variation_notes ?? '')
  const [toolbox, setToolbox] = useState<boolean | null>(e?.toolbox_talk ?? null)
  const [ppe, setPpe] = useState<PpeCompliance | null>(e?.ppe_compliance ?? null)
  const [nearMiss, setNearMiss] = useState(e?.hse_near_miss_notes ?? '')
  const [quality, setQuality] = useState(e?.quality_issues ?? '')
  const [equipment, setEquipment] = useState(e?.equipment_issues ?? '')
  const [tomorrowPlan, setTomorrowPlan] = useState(e?.tomorrow_plan ?? '')
  const [officeNeeds, setOfficeNeeds] = useState(e?.office_needs ?? '')
  const [photos, setPhotos] = useState<{ url: string; name?: string }[]>(e?.photos ?? [])
  const [saving, setSaving] = useState(false)

  const noWork = siteStatus === 'no_work'

  const { data: openWos = [] } = useQuery({
    queryKey: ['sdr-open-wos', projectId],
    queryFn: async () => {
      const { data } = await supabase.from('work_orders')
        .select('id, title, work_type, scope_of_work, status, current_progress_pct')
        .eq('project_id', projectId).not('status', 'in', '(completed,cancelled)').order('created_at')
      return (data ?? []) as OpenWo[]
    },
  })
  // What was logged on site, over every day the report covers.
  const { data: hcDays = [] } = useQuery({
    queryKey: ['sdr-headcount', projectId, from, reportDate],
    queryFn: async () => {
      const { data } = await supabase.from('v_site_report_headcount').select('*').eq('project_id', projectId).gte('report_date', from).lte('report_date', reportDate)
      return (data ?? []) as { tier1_headcount: number; tier2_headcount: number; total_headcount: number }[]
    },
  })
  const hc = hcDays.length ? {
    tier1_headcount: hcDays.reduce((s, d) => s + (d.tier1_headcount ?? 0), 0),
    tier2_headcount: hcDays.reduce((s, d) => s + (d.tier2_headcount ?? 0), 0),
    total_headcount: hcDays.reduce((s, d) => s + (d.total_headcount ?? 0), 0),
  } : null
  const { data: mats = [] } = useQuery({
    queryKey: ['sdr-materials', projectId, from, reportDate],
    queryFn: async () => {
      const { data } = await supabase.from('v_site_report_materials').select('*').eq('project_id', projectId).gte('report_date', from).lte('report_date', reportDate)
      return (data ?? []) as { item_name: string | null; quantity: number; uom: string | null; notes: string | null }[]
    },
  })
  const { data: hse = [] } = useQuery({
    queryKey: ['sdr-hse', projectId, from, reportDate],
    queryFn: async () => {
      const { data } = await supabase.from('v_site_report_hse').select('*').eq('project_id', projectId).gte('report_date', from).lte('report_date', reportDate)
      return (data ?? []) as { incident_type: string | null; severity: string | null; description: string | null }[]
    },
  })
  const { data: prev } = useQuery({
    queryKey: ['sdr-prev', projectId, from],
    queryFn: async () => {
      const { data } = await supabase.from('site_daily_reports')
        .select('progress_percent_after, report_date, tomorrow_plan')
        .eq('project_id', projectId).lt('report_date', from).not('submitted_at', 'is', null)
        .order('report_date', { ascending: false }).limit(1).maybeSingle()
      return data as { progress_percent_after: number | null; report_date: string; tomorrow_plan: string | null } | null
    },
  })

  // Work orders to report on: those open now, plus any already in this report.
  const woRows = useMemo(() => {
    const rows = openWos.map(w => items[w.id] ?? {
      work_order_id: w.id,
      label: w.title || w.scope_of_work || w.work_type || 'Work order',
      progress_before: w.current_progress_pct,
      progress_after: null,
      note: '',
    })
    for (const it of Object.values(items)) if (!openWos.some(w => w.id === it.work_order_id)) rows.push(it)
    return rows
  }, [openWos, items])

  const setItem = (id: string, patch: Partial<WorkItem>) => {
    const base = woRows.find(r => r.work_order_id === id)!
    setItems(s => ({ ...s, [id]: { ...base, ...s[id], ...patch } }))
  }

  // What still needs an answer before submitting.
  const checks: { label: string; done: boolean }[] = noWork
    ? [
        { label: 'Why there was no work', done: !!noWorkReason },
        { label: 'Weather', done: !!weather },
        { label: "Tomorrow's plan", done: !!tomorrowPlan.trim() },
      ]
    : [
        { label: 'Weather', done: !!weather },
        { label: 'What got done', done: !!progressNotes.trim() || woRows.some(r => r.progress_after != null) },
        { label: 'Anything blocking work', done: blocked !== null && (!blocked || causes.length > 0) },
        { label: 'Client visit', done: clientVisit !== null },
        { label: 'Change requested', done: variation !== null },
        { label: 'Toolbox talk', done: toolbox !== null },
        { label: 'PPE', done: !!ppe },
        { label: "Tomorrow's plan", done: !!tomorrowPlan.trim() },
      ]
  const answered = checks.filter(c => c.done).length
  const canSubmit = answered === checks.length

  async function save(submit: boolean) {
    if (submit && !canSubmit) { toast('Answer the questions marked in the checklist first', 'error'); return }
    setSaving(true)
    const num = (v: string) => (v.trim() === '' ? null : Number(v))
    const workItems = woRows.filter(r => r.progress_after != null || r.note.trim())
    const payload = {
      project_id: projectId,
      foreman_staff_id: staffId,
      report_date: reportDate,
      covers_from: coversFrom,
      site_status: siteStatus,
      no_work_reason: noWork ? noWorkReason : null,
      weather,
      site_accessible: siteAccessible,
      on_site_from: onSiteFrom || null,
      on_site_to: onSiteTo || null,
      progress_percent_after: noWork ? null : num(progressPct),
      progress_notes: progressNotes.trim() || null,
      work_items: noWork ? [] : workItems,
      headcount_override: null,
      subcontractor_headcount: noWork ? null : num(subCrew),
      idle_hours: noWork ? null : num(idleHours),
      idle_reason: noWork ? null : idleReason.trim() || null,
      blocked: noWork ? null : blocked,
      blocker_causes: noWork || !blocked ? [] : causes,
      blocker_notes: noWork || !blocked ? null : blockerNotes.trim() || null,
      delay_days: noWork || !blocked ? null : num(delayDays),
      materials_notes: materialsNotes.trim() || null,
      materials_needed_soon: materialsSoon.trim() || null,
      client_visit: noWork ? null : clientVisit,
      client_visit_notes: noWork || !clientVisit ? null : clientNotes.trim() || null,
      variation_instructed: noWork ? null : variation,
      variation_notes: noWork || !variation ? null : variationNotes.trim() || null,
      toolbox_talk: noWork ? null : toolbox,
      ppe_compliance: noWork ? null : ppe,
      hse_near_miss_notes: nearMiss.trim() || null,
      quality_issues: quality.trim() || null,
      equipment_issues: equipment.trim() || null,
      tomorrow_plan: tomorrowPlan.trim() || null,
      office_needs: officeNeeds.trim() || null,
      photos,
      submitted_at: submit ? new Date().toISOString() : null,
    }
    const { error } = await supabase.from('site_daily_reports')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .upsert([payload as any], { onConflict: 'project_id,foreman_staff_id,report_date' })
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    for (const k of ['site-daily-report', 'site-report-summary', 'site-report-gaps', 'sdr-open-wos', 'foreman-latest-report', 'site-daily-reports-viewer'])
      qc.invalidateQueries({ queryKey: [k] })
    toast(submit ? (multi ? `${days}-day summary sent to your project manager` : 'Report sent to your project manager') : 'Draft saved', 'success')
  }

  return (
    <fieldset disabled={locked || saving} className="min-w-0 space-y-4">
      {locked && (
        <p className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" /> {multi ? `Summary for ${reportDays({ report_date: reportDate, covers_from: from })}` : 'Report'} sent {new Date(existing!.submitted_at!).toLocaleString()}. It can no longer be changed.
        </p>
      )}

      {prev?.tomorrow_plan && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm dark:border-blue-800/40 dark:bg-blue-900/15">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">Planned on {dayLong(prev.report_date)}</p>
          <p className="mt-0.5 whitespace-pre-wrap text-blue-900 dark:text-blue-100">{prev.tomorrow_plan}</p>
        </div>
      )}

      <Section icon={CalendarClock} title={multi ? `The ${days} days on site` : 'The day on site'}>
        <p className={labelCls}>{multi ? "Was the site working these days?" : "Was the site working?"}</p>
        <Segmented
          value={siteStatus}
          onChange={v => setSiteStatus(v as SiteStatus)}
          options={(Object.keys(SITE_STATUS_LABEL) as SiteStatus[]).map(v => ({ value: v, label: multi ? MULTI_STATUS_LABEL[v] : SITE_STATUS_LABEL[v] }))}
        />
        {noWork && (
          <div className="mt-3">
            <p className={labelCls}>Why was there no work?</p>
            <Chips
              value={noWorkReason ? [noWorkReason] : []}
              onToggle={v => setNoWorkReason(v as NoWorkReason)}
              options={(Object.keys(NO_WORK_REASON_LABEL) as NoWorkReason[]).map(v => ({ value: v, label: NO_WORK_REASON_LABEL[v] }))}
            />
          </div>
        )}
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <p className={labelCls}>Weather</p>
            <div className="flex flex-wrap gap-1">
              {WEATHER_OPTIONS.map(w => {
                const Icon = w.icon
                return (
                  <button key={w.value} type="button" onClick={() => setWeather(w.value)}
                    className={`flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs ${weather === w.value ? 'border-brand bg-brand/10 text-brand' : 'text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>
                    <Icon className="h-3.5 w-3.5" /> {w.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <p className={labelCls}>Could the team get onto the site?</p>
            <Segmented value={siteAccessible} onChange={v => setSiteAccessible(v as SiteAccessible)}
              options={[{ value: 'yes', label: 'Yes' }, { value: 'partial', label: 'Partly' }, { value: 'no', label: 'No' }]} />
          </div>
        </div>
        {!noWork && (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:w-1/2">
            <div>
              <label className={labelCls}>Work started</label>
              <input type="time" className={inputCls} value={onSiteFrom} onChange={ev => setOnSiteFrom(ev.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Work stopped</label>
              <input type="time" className={inputCls} value={onSiteTo} onChange={ev => setOnSiteTo(ev.target.value)} />
            </div>
          </div>
        )}
        {noWork && (
          <div className="mt-3">
            <label className={labelCls}>Anything to add?</label>
            <textarea rows={2} className={inputCls} value={progressNotes} onChange={ev => setProgressNotes(ev.target.value)} />
          </div>
        )}
      </Section>

      {!noWork && (
        <>
          <Section icon={Hammer} title="Work done">
            {woRows.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs text-slate-500 dark:text-slate-400">Where is each work order now? Leave blank if nothing moved. Sending the report updates the work order.</p>
                {woRows.map(r => (
                  <div key={r.work_order_id} className="rounded-lg border p-3 dark:border-slate-700">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 dark:text-slate-100">{r.label}</p>
                      <span className="text-xs text-slate-400">was {Number(r.progress_before ?? 0)}%</span>
                      <div className="flex items-center gap-1">
                        {[5, 10, 25].map(step => (
                          <button key={step} type="button"
                            onClick={() => setItem(r.work_order_id, { progress_after: Math.min(100, Number(r.progress_after ?? r.progress_before ?? 0) + step) })}
                            className="rounded border px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
                            +{step}
                          </button>
                        ))}
                        <input type="number" min={Number(r.progress_before ?? 0)} max={100} placeholder="%"
                          aria-label={`${r.label} progress now`}
                          className="w-16 rounded-md border px-2 py-1 text-sm tabular-nums outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                          value={r.progress_after ?? ''}
                          onChange={ev => setItem(r.work_order_id, { progress_after: ev.target.value === '' ? null : Math.min(100, Number(ev.target.value)) })} />
                      </div>
                    </div>
                    {r.progress_after != null && (
                      <>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                          <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, Number(r.progress_after))}%` }} />
                        </div>
                        <input className={`${inputCls} mt-2`} placeholder={multi ? 'What was done on it?' : 'What was done on it today?'} value={r.note}
                          onChange={ev => setItem(r.work_order_id, { note: ev.target.value })} />
                      </>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400">No open work orders on this site.</p>
            )}
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_9rem]">
              <div>
                <label className={labelCls}>{multi ? `What got done over these ${days} days?` : 'What got done today?'}</label>
                <textarea rows={3} className={inputCls} value={progressNotes} onChange={ev => setProgressNotes(ev.target.value)}
                  placeholder="e.g. Gypsum ceiling closed in rooms 3–4; first coat of paint in the corridor" />
              </div>
              <div>
                <label className={labelCls}>Whole site done (%)</label>
                <input type="number" step="0.5" min="0" max="100" className={inputCls} value={progressPct} onChange={ev => setProgressPct(ev.target.value)} />
                {prev?.progress_percent_after != null && <p className="mt-1 text-[11px] text-slate-400">Last report: {prev.progress_percent_after}%</p>}
              </div>
            </div>
          </Section>

          <Section icon={Users} title="People">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Logged on site{multi ? ` over ${days} days` : ''}: <b>{hc?.tier2_headcount ?? 0}</b> casual and <b>{hc?.tier1_headcount ?? 0}</b> staff · <b>{hc?.total_headcount ?? 0}</b> in all{multi && hc ? ` (about ${Math.round(hc.total_headcount / days)} a day)` : ''}.
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400">From the attendance recorded under Record Labour.</p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className={labelCls}>Subcontractor workers on site</label>
                <input type="number" min={0} className={inputCls} value={subCrew} onChange={ev => setSubCrew(ev.target.value)} placeholder="0" />
              </div>
              <div>
                <label className={labelCls}>Hours crews stood idle</label>
                <input type="number" min={0} step="0.5" className={inputCls} value={idleHours} onChange={ev => setIdleHours(ev.target.value)} placeholder="0" />
              </div>
              {Number(idleHours) > 0 && (
                <div>
                  <label className={labelCls}>Why were they idle?</label>
                  <input className={inputCls} value={idleReason} onChange={ev => setIdleReason(ev.target.value)} />
                </div>
              )}
            </div>
          </Section>

          <Section icon={CircleSlash} title="Blockers">
            <p className={labelCls}>Is anything stopping or slowing the work?</p>
            <YesNo value={blocked} onChange={setBlocked} />
            {blocked && (
              <div className="mt-3 space-y-3">
                <div>
                  <p className={labelCls}>What is it? (pick all that apply)</p>
                  <Chips value={causes} multi
                    onToggle={v => setCauses(c => c.includes(v) ? c.filter(x => x !== v) : [...c, v])}
                    options={BLOCKER_CAUSES.map(c => ({ value: c.value, label: c.label }))} />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_9rem]">
                  <div>
                    <label className={labelCls}>What exactly, and who can clear it?</label>
                    <textarea rows={2} className={inputCls} value={blockerNotes} onChange={ev => setBlockerNotes(ev.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls}>Days it could delay us</label>
                    <input type="number" min={0} step="0.5" className={inputCls} value={delayDays} onChange={ev => setDelayDays(ev.target.value)} />
                  </div>
                </div>
              </div>
            )}
          </Section>
        </>
      )}

      <Section icon={Package} title="Materials">
        {mats.length === 0 ? (
          <p className="text-xs text-slate-400">No materials requested for this day.</p>
        ) : (
          <ul className="mb-2 space-y-1 text-sm text-slate-700 dark:text-slate-200">
            {mats.map((m, i) => <li key={i}>• {m.item_name ?? '—'} · {m.quantity} {m.uom ?? ''}{m.notes ? ` · ${m.notes}` : ''}</li>)}
          </ul>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>{multi ? 'Short, wrong or damaged in these days' : 'Short, wrong or damaged today'}</label>
            <textarea rows={2} className={inputCls} value={materialsNotes} onChange={ev => setMaterialsNotes(ev.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Needed on site in the next 3 days</label>
            <textarea rows={2} className={inputCls} value={materialsSoon} onChange={ev => setMaterialsSoon(ev.target.value)}
              placeholder="So it can be bought before it holds the work up" />
          </div>
        </div>
      </Section>

      {!noWork && (
        <Section icon={MessageSquare} title="Client and instructions">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className={labelCls}>Did the client or consultant visit?</p>
              <YesNo value={clientVisit} onChange={setClientVisit} />
              {clientVisit && (
                <textarea rows={2} className={`${inputCls} mt-2`} value={clientNotes} onChange={ev => setClientNotes(ev.target.value)}
                  placeholder="Who came, and what did they say?" />
              )}
            </div>
            <div>
              <p className={labelCls}>Did anyone ask for a change or extra work?</p>
              <YesNo value={variation} onChange={setVariation} />
              {variation && (
                <>
                  <textarea rows={2} className={`${inputCls} mt-2`} value={variationNotes} onChange={ev => setVariationNotes(ev.target.value)}
                    placeholder="What was asked, by whom" />
                  <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">Your project manager will see this as a possible variation to price.</p>
                </>
              )}
            </div>
          </div>
        </Section>
      )}

      {!noWork && (
        <Section icon={ShieldCheck} title="Safety">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className={labelCls}>Was a toolbox talk held this morning?</p>
              <YesNo value={toolbox} onChange={setToolbox} />
            </div>
            <div>
              <p className={labelCls}>Who wore the right PPE?</p>
              <Segmented value={ppe ?? ''} onChange={v => setPpe(v as PpeCompliance)}
                options={(Object.keys(PPE_LABEL) as PpeCompliance[]).map(v => ({ value: v, label: PPE_LABEL[v] }))} />
            </div>
          </div>
          <div className="mt-3">
            {hse.length === 0 ? (
              <p className="text-xs text-slate-400">No incidents logged for this day.</p>
            ) : (
              <ul className="mb-2 space-y-1 text-sm text-slate-700 dark:text-slate-200">
                {hse.map((h, i) => <li key={i}>• {h.incident_type ?? '—'} ({h.severity ?? '—'}) — {h.description ?? ''}</li>)}
              </ul>
            )}
            <label className={labelCls}>Near-misses or unsafe things seen (not logged)</label>
            <textarea rows={2} className={inputCls} value={nearMiss} onChange={ev => setNearMiss(ev.target.value)} />
            <Link to="/site-foreman/hse" className="mt-1 inline-block text-[11px] text-brand hover:underline">Log an incident →</Link>
          </div>
        </Section>
      )}

      {!noWork && (
        <Section icon={Wrench} title="Quality and equipment">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Rework or defects found</label>
              <textarea rows={2} className={inputCls} value={quality} onChange={ev => setQuality(ev.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Tools or equipment broken or missing</label>
              <textarea rows={2} className={inputCls} value={equipment} onChange={ev => setEquipment(ev.target.value)} />
            </div>
          </div>
        </Section>
      )}

      <Section icon={Clock} title={multi ? 'Next' : 'Tomorrow'}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>{multi ? 'What is the plan for the next working day?' : 'What is the plan for tomorrow?'}</label>
            <textarea rows={3} className={inputCls} value={tomorrowPlan} onChange={ev => setTomorrowPlan(ev.target.value)} />
          </div>
          <div>
            <label className={labelCls}>What do you need from the office?</label>
            <textarea rows={3} className={inputCls} value={officeNeeds} onChange={ev => setOfficeNeeds(ev.target.value)}
              placeholder="Decisions, drawings, money, transport, people…" />
          </div>
        </div>
      </Section>

      <Section icon={Camera} title="Photos">
        <div className="flex flex-wrap gap-2">
          {photos.map((p, i) => (
            <div key={p.url} className="relative h-20 w-20 overflow-hidden rounded-lg border dark:border-slate-700">
              <img src={p.url} alt={p.name ?? `Photo ${i + 1}`} className="h-full w-full object-cover" />
              {!locked && (
                <button type="button" onClick={() => setPhotos(ps => ps.filter(x => x.url !== p.url))} aria-label="Remove photo"
                  className="absolute right-0.5 top-0.5 rounded-full bg-black/50 p-0.5 text-white hover:bg-black/70">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
        {!locked && photos.length < 8 && (
          <div className="mt-2">
            <FileUpload key={photos.length} bucket="documents" folder="site-report-photos" fileUrl={null} fileName={null}
              accept="image/*" label={multi ? 'Add photos of the work' : "Add a photo of today's work"}
              onUpload={(url, name) => setPhotos(ps => [...ps, { url, name }])} onClear={() => {}} />
          </div>
        )}
      </Section>

      {!locked && (
        <div className="sticky bottom-2 z-10 rounded-xl border bg-white/95 p-3 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-800/95">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
              <p className="text-xs font-medium text-slate-600 dark:text-slate-300">{answered} of {checks.length} answered</p>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                <div className={`h-full ${canSubmit ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${(answered / checks.length) * 100}%` }} />
              </div>
              {!canSubmit && (
                <p className="mt-1 truncate text-[11px] text-slate-400">Still to answer: {checks.filter(c => !c.done).map(c => c.label).join(', ')}</p>
              )}
            </div>
            <button type="button" onClick={() => save(false)}
              className="ml-auto rounded-md border px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
              Save draft
            </button>
            <button type="button" onClick={() => save(true)} disabled={!canSubmit}
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50">
              {multi ? `Send ${days}-day summary` : 'Send report'}
            </button>
          </div>
        </div>
      )}
      {!locked && blocked && causes.length === 0 && (
        <p className="flex items-center gap-1 text-xs text-amber-600"><AlertTriangle className="h-3.5 w-3.5" /> Pick what is blocking the work.</p>
      )}
    </fieldset>
  )
}

function Section({ title, icon: Icon, children }: { title: string; icon: typeof Sun; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand/10 text-brand"><Icon className="h-3.5 w-3.5" /></span>
        {title}
      </h2>
      {children}
    </section>
  )
}

function DayChip({ active, tone, onClick, children }: { active: boolean; tone?: 'amber'; onClick: () => void; children: React.ReactNode }) {
  const idle = tone === 'amber'
    ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300'
    : 'text-slate-600 dark:border-slate-600 dark:text-slate-300'
  return (
    <button type="button" onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${active ? 'border-brand bg-brand text-white' : idle}`}>
      {children}
    </button>
  )
}

function Segmented({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div role="radiogroup" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      className="grid w-full rounded-lg border bg-slate-50 p-0.5 dark:border-slate-600 dark:bg-slate-900/40 sm:inline-grid sm:w-auto">
      {options.map(o => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1.5 text-center text-xs font-medium leading-tight ${value === o.value ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function YesNo({ value, onChange }: { value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <Segmented value={value == null ? '' : value ? 'yes' : 'no'} onChange={v => onChange(v === 'yes')}
      options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
  )
}

function Chips({ value, onToggle, options, multi }: { value: string[]; onToggle: (v: string) => void; options: { value: string; label: string }[]; multi?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5" role={multi ? 'group' : 'radiogroup'}>
      {options.map(o => {
        const on = value.includes(o.value)
        return (
          <button key={o.value} type="button" onClick={() => onToggle(o.value)}
            {...(multi ? { 'aria-pressed': on } : { role: 'radio', 'aria-checked': on })}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${on ? 'border-brand bg-brand/10 text-brand' : 'text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700'}`}>
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
