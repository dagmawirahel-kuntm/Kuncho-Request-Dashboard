import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useMySiteForemanProjects, useMyStaffId } from '@/hooks/useMyStaff'
import { useToast } from '@/contexts/ToastContext'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { YesterdayNudge } from './YesterdayNudge'
import { CheckCircle2, Cloud, CloudRain, Sun, CloudDrizzle } from 'lucide-react'
import type { SiteDailyReport, SiteReportWeather, SiteAccessible } from '@/types/database'

const WEATHER_OPTIONS: { value: SiteReportWeather; label: string; icon: typeof Sun }[] = [
  { value: 'sunny', label: 'Sunny', icon: Sun },
  { value: 'cloudy', label: 'Cloudy', icon: Cloud },
  { value: 'rain', label: 'Rain', icon: CloudDrizzle },
  { value: 'heavy_rain', label: 'Heavy Rain', icon: CloudRain },
]

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'

export default function DailySiteReportPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [searchParams] = useSearchParams()
  const draftId = searchParams.get('draft')
  const { data: staff } = useMyStaffId()
  const { projects } = useMySiteForemanProjects()
  const projectOptions = useMemo(() => projects.map(p => ({ id: p.id, label: p.project_name })), [projects])

  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)

  const [projectId, setProjectId] = useState<string | null>(null)
  const [reportDate, setReportDate] = useState<string>(today)

  // Load an existing draft or today's report for the picked project.
  const { data: existing } = useQuery({
    queryKey: ['site-daily-report', draftId, projectId, reportDate, staff?.id],
    queryFn: async () => {
      if (draftId) {
        const { data } = await supabase.from('site_daily_reports').select('*').eq('id', draftId).maybeSingle()
        return data as SiteDailyReport | null
      }
      if (!projectId || !staff?.id) return null
      const { data } = await supabase.from('site_daily_reports').select('*')
        .eq('project_id', projectId).eq('foreman_staff_id', staff.id).eq('report_date', reportDate).maybeSingle()
      return data as SiteDailyReport | null
    },
    enabled: !!draftId || (!!projectId && !!staff?.id),
  })

  // Sync draft into local state so if draftId is set we pick up its project/date
  if (existing && draftId && projectId !== existing.project_id) {
    setProjectId(existing.project_id)
    setReportDate(existing.report_date)
  }

  const [progressPct, setProgressPct] = useState<string>('')
  const [weather, setWeather] = useState<SiteReportWeather | ''>('')
  const [siteAccessible, setSiteAccessible] = useState<SiteAccessible | ''>('yes')
  const [progressNotes, setProgressNotes] = useState('')
  const [headcountOverride, setHeadcountOverride] = useState<string>('')
  const [materialsNotes, setMaterialsNotes] = useState('')
  const [hseNearMiss, setHseNearMiss] = useState('')
  const [tomorrowPlan, setTomorrowPlan] = useState('')

  // Auto-populate views: only fetched once we have project+date.
  const { data: hc } = useQuery({
    queryKey: ['sdr-headcount', projectId, reportDate],
    queryFn: async () => {
      const { data } = await supabase.from('v_site_report_headcount').select('*').eq('project_id', projectId!).eq('report_date', reportDate).maybeSingle()
      return data as { tier1_headcount: number; tier2_headcount: number; total_headcount: number } | null
    },
    enabled: !!projectId,
  })
  const { data: mats = [] } = useQuery({
    queryKey: ['sdr-materials', projectId, reportDate],
    queryFn: async () => {
      const { data } = await supabase.from('v_site_report_materials').select('*').eq('project_id', projectId!).eq('report_date', reportDate)
      return (data ?? []) as { item_name: string | null; quantity: number; uom: string | null; notes: string | null }[]
    },
    enabled: !!projectId,
  })
  const { data: hse = [] } = useQuery({
    queryKey: ['sdr-hse', projectId, reportDate],
    queryFn: async () => {
      const { data } = await supabase.from('v_site_report_hse').select('*').eq('project_id', projectId!).eq('report_date', reportDate)
      return (data ?? []) as { incident_type: string | null; severity: string | null; description: string | null }[]
    },
    enabled: !!projectId,
  })
  const { data: wos = [] } = useQuery({
    queryKey: ['sdr-wos', projectId, reportDate],
    queryFn: async () => {
      const { data } = await supabase.from('v_site_report_workorders').select('*').eq('project_id', projectId!).eq('report_date', reportDate)
      return (data ?? []) as { work_type: string | null; scope_of_work: string | null; status: string | null }[]
    },
    enabled: !!projectId,
  })

  // Previous progress % for context
  const { data: prevReport } = useQuery({
    queryKey: ['sdr-prev', projectId, reportDate],
    queryFn: async () => {
      const { data } = await supabase.from('site_daily_reports')
        .select('progress_percent_after, report_date')
        .eq('project_id', projectId!).lt('report_date', reportDate)
        .order('report_date', { ascending: false }).limit(1).maybeSingle()
      return data as { progress_percent_after: number | null; report_date: string } | null
    },
    enabled: !!projectId,
  })

  const isSubmitted = !!existing?.submitted_at
  const woProgressed = wos.filter(w => w.status && !['open','cancelled','completed'].includes(w.status)).length
  const woCompleted = wos.filter(w => w.status === 'completed').length

  async function saveDraft(submit: boolean) {
    if (!projectId || !staff?.id) { toast('Pick a project first', 'error'); return }
    const payload = {
      project_id: projectId,
      foreman_staff_id: staff.id,
      report_date: reportDate,
      progress_percent_after: progressPct ? parseFloat(progressPct) : null,
      weather: weather || null,
      site_accessible: siteAccessible || null,
      progress_notes: progressNotes || null,
      headcount_override: headcountOverride ? parseInt(headcountOverride, 10) : null,
      materials_notes: materialsNotes || null,
      hse_near_miss_notes: hseNearMiss || null,
      tomorrow_plan: tomorrowPlan || null,
      submitted_at: submit ? new Date().toISOString() : null,
    }
    const { error } = existing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? await supabase.from('site_daily_reports').update(payload as any).eq('id', existing.id)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : await supabase.from('site_daily_reports').insert([payload as any])
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['site-daily-report'] })
    qc.invalidateQueries({ queryKey: ['foreman-latest-report'] })
    toast(submit ? 'Report submitted — locked' : 'Draft saved', 'success')
  }

  return (
    <div className="space-y-4">
      <YesterdayNudge />
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Daily Site Report</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          One report per site per day. Auto-pulls headcount, materials, HSE, and work-order activity from today's system entries.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Project</label>
          <SearchableSelect value={projectId} onChange={setProjectId} options={projectOptions} placeholder="Pick one of your sites…" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Date</label>
          <input type="date" className={inputCls} value={reportDate} onChange={e => setReportDate(e.target.value)} />
          <p className="mt-1 text-[11px] text-slate-400">Yesterday: {yesterday} · Today: {today}</p>
        </div>
      </div>

      {projectId && (
        <>
          {/* 1. Progress & site condition */}
          <Section title="Progress & Site Condition" step={1}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Complete (%)</label>
                <input type="number" step="0.5" min="0" max="100" className={inputCls} value={progressPct} onChange={e => setProgressPct(e.target.value)} disabled={isSubmitted} />
                {prevReport?.progress_percent_after != null && (
                  <p className="mt-1 text-[11px] text-slate-400">Previous: {prevReport.progress_percent_after}% ({prevReport.report_date})</p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Weather</label>
                <div className="flex gap-1 flex-wrap">
                  {WEATHER_OPTIONS.map(w => {
                    const Icon = w.icon
                    return (
                      <button key={w.value} type="button" onClick={() => !isSubmitted && setWeather(w.value)}
                        className={`flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs ${weather === w.value ? 'border-brand bg-brand/10 text-brand' : 'text-slate-600 dark:text-slate-300 dark:border-slate-600'} disabled:opacity-50`}
                        disabled={isSubmitted}>
                        <Icon className="h-3.5 w-3.5" /> {w.label}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Site Accessible</label>
                <select className={inputCls} value={siteAccessible} onChange={e => setSiteAccessible(e.target.value as SiteAccessible)} disabled={isSubmitted}>
                  <option value="yes">Yes</option>
                  <option value="partial">Partial</option>
                  <option value="no">No</option>
                </select>
              </div>
            </div>
            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Progress notes</label>
              <textarea rows={3} className={inputCls} value={progressNotes} onChange={e => setProgressNotes(e.target.value)} disabled={isSubmitted} />
            </div>
          </Section>

          {/* 2. Headcount */}
          <Section title="Headcount" step={2}>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              You logged <span className="font-semibold">{hc?.tier2_headcount ?? 0} Tier 2</span> and{' '}
              <span className="font-semibold">{hc?.tier1_headcount ?? 0} Tier 1</span> staff today.{' '}
              Total: <span className="font-semibold">{hc?.total_headcount ?? 0}</span>.
            </p>
            <div className="mt-2">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Override (optional)</label>
              <input type="number" min="0" className={inputCls} value={headcountOverride} onChange={e => setHeadcountOverride(e.target.value)} disabled={isSubmitted} />
            </div>
          </Section>

          {/* 3. Materials */}
          <Section title="Materials" step={3}>
            {mats.length === 0 ? (
              <p className="text-xs text-slate-400">No stock requests logged today.</p>
            ) : (
              <ul className="mb-2 text-sm text-slate-700 dark:text-slate-200 space-y-1">
                {mats.map((m, i) => (
                  <li key={i}>• {m.item_name ?? '—'} · {m.quantity} {m.uom ?? ''}{m.notes ? ` · ${m.notes}` : ''}</li>
                ))}
              </ul>
            )}
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Shortages / issues</label>
            <textarea rows={2} className={inputCls} value={materialsNotes} onChange={e => setMaterialsNotes(e.target.value)} disabled={isSubmitted} />
          </Section>

          {/* 4. HSE */}
          <Section title="HSE" step={4}>
            {hse.length === 0 ? (
              <p className="text-xs text-slate-400">No HSE incidents logged today.</p>
            ) : (
              <ul className="mb-2 text-sm text-slate-700 dark:text-slate-200 space-y-1">
                {hse.map((h, i) => <li key={i}>• {h.incident_type ?? '—'} ({h.severity ?? '—'}) — {h.description ?? ''}</li>)}
              </ul>
            )}
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Near-misses not formally logged</label>
            <textarea rows={2} className={inputCls} value={hseNearMiss} onChange={e => setHseNearMiss(e.target.value)} disabled={isSubmitted} />
          </Section>

          {/* 5. Work orders */}
          <Section title="Work Orders" step={5}>
            <p className="text-sm text-slate-700 dark:text-slate-200">
              <span className="font-semibold">{woProgressed}</span> progressed, <span className="font-semibold">{woCompleted}</span> completed today.
            </p>
          </Section>

          {/* 6. Tomorrow */}
          <Section title="Tomorrow's Plan" step={6}>
            <textarea rows={3} className={inputCls} value={tomorrowPlan} onChange={e => setTomorrowPlan(e.target.value)} disabled={isSubmitted} />
          </Section>

          {/* 7. Submit */}
          <Section title="Submit" step={7}>
            {isSubmitted ? (
              <p className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" /> Submitted at {new Date(existing!.submitted_at!).toLocaleString()}. Locked from further edits.
              </p>
            ) : (
              <div className="flex justify-end gap-2">
                <button onClick={() => saveDraft(false)} className="rounded-md border px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700">
                  Save Draft
                </button>
                <button onClick={() => saveDraft(true)} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
                  Submit Report
                </button>
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  )
}

function Section({ title, step, children }: { title: string; step: number; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="h-5 w-5 rounded-full bg-brand text-white text-[10px] font-bold flex items-center justify-center">{step}</span>
        <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">{title}</h2>
      </div>
      {children}
    </div>
  )
}
