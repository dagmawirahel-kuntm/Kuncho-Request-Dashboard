import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { Pill } from '@/components/record/Record'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { WorkerAvatar } from '@/components/labour/WorkerPhoto'
import { NewWorkerForm, type NewWorker } from '@/components/labour/NewWorkerForm'
import { addDays, dayLabel, fmtMoney, isoDay } from '@/lib/labour'
import {
  BUCKET_LABEL, BUCKET_SHORT, DAY_STATUS, OTHER_BUCKETS, PROJECT_BUCKETS, WEEKDAYS, halfDays, tradeName, useDayPeople, useDaySettings,
  type Bucket, type DaySheet, type DayStatus, type PieceJob,
} from '@/lib/labourDay'
import { CalendarRange, ChevronLeft, ChevronRight, Copy, Plus, Save, Send, UserPlus, X } from 'lucide-react'

type Col = { key: string; bucket: Bucket; project_id: string | null; label: string; tag: string }
type Cell = { paid: number; alloc: Record<string, number>; ot: number; night: number; note: string | null }
type WRow = { staff_id: string; name: string; trade: string | null; day_rate: number | null; photo_url: string | null; verified: boolean }
type JobDay = { present: string[]; measured: number | null }

const card = 'rounded-2xl border bg-white dark:border-slate-700 dark:bg-slate-800'
const cellKey = (bucket: Bucket, project: string | null) => (project ? `${project}:${bucket}` : bucket)
const mondayOf = (iso: string) => { const d = new Date(`${iso}T00:00:00`); return addDays(iso, -((d.getDay() + 6) % 7)) }
// "Solomon · Build": the project's first word and the column, to fit a cell.
const firstWord = (s: string) => s.trim().split(/\s+/)[0]

// A PM's week on one grid (494): workers down the side, Monday to Sunday
// across. Each cell is the day they were paid (½ or 1) and where it went.
// The week is saved and sent in one go; each day is still its own day sheet,
// so a day split across projects opens on the day sheet.
export default function LabourWeekSheetPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [params, setParams] = useSearchParams()
  const { me, approver, seeAll, pms } = useDayPeople()
  const { data: settings } = useDaySettings()
  const today = isoDay(new Date())
  const week = mondayOf(params.get('week') ?? today)
  const pm = params.get('pm') ?? me?.id ?? null
  const setQ = (k: string, v: string | null) => setParams(p => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n }, { replace: true })
  const dates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week])
  const startsOn = settings?.starts_on ?? null
  const inRange = (d: string) => !!startsOn && d >= startsOn && d <= today

  const results = useQueries({
    queries: dates.map(d => ({
      queryKey: ['labour-day', pm, d],
      enabled: !!pm && inRange(d),
      queryFn: async () => {
        const { data, error } = await supabase.rpc('labour_day_get', { p_pm: pm, p_date: d })
        if (error) throw error
        return data as DaySheet
      },
    })),
  })
  const sheets = results.map(r => r.data ?? null)
  const loading = results.some(r => r.isLoading)
  const { data: casual = [] } = useQuery({
    queryKey: ['labour-casual-workers'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('staff').select('id, employee_name, trade_tag, day_rate, photo_url, verified_at')
        .eq('employment_type', 'tier_2_casual').or('status.is.null,status.eq.active').order('employee_name')
      if (error) throw error
      return (data ?? []) as { id: string; employee_name: string; trade_tag: string | null; day_rate: number | null; photo_url: string | null; verified_at: string | null }[]
    },
  })

  // What's saved, per day. A day not saved yet starts empty here (the day
  // sheet's copy of yesterday is a suggestion; on a week, "Same as the day
  // before" does that on purpose).
  const saved = (s: DaySheet | null) => !!s?.day?.saved_at && !s.prefilled_from
  const [cells, setCells] = useState<Record<string, Record<string, Cell>>>({})
  const [jobDays, setJobDays] = useState<Record<string, Record<string, JobDay>>>({})
  const [extraWorkers, setExtraWorkers] = useState<WRow[]>([])
  const [dirtyDays, setDirtyDays] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ staff: string; date: string } | null>(null)
  const [adding, setAdding] = useState(false)
  const [newWorker, setNewWorker] = useState<NewWorker | null>(null)

  // Load the grid whenever what the server holds for the week changes.
  const loadKey = `${pm}|${week}|` + sheets.map(s => `${s?.day?.id ?? ''}:${s?.day?.saved_at ?? ''}:${s?.day?.status ?? ''}`).join(',')
  const [loadedKey, setLoadedKey] = useState('')
  if (!loading && loadedKey !== loadKey) {
    setLoadedKey(loadKey)
    const c: Record<string, Record<string, Cell>> = {}
    const j: Record<string, Record<string, JobDay>> = {}
    dates.forEach((d, i) => {
      const s = sheets[i]
      if (s && saved(s)) {
        for (const w of s.workers) {
          c[w.staff_id] = { ...(c[w.staff_id] ?? {}) }
          c[w.staff_id][d] = {
            paid: Number(w.paid_days), ot: Number(w.overtime_hours) || 0, night: Number(w.overtime_night_hours) || 0, note: w.note,
            alloc: Object.fromEntries(w.alloc.map(a => [PROJECT_BUCKETS.includes(a.bucket) ? cellKey(a.bucket, a.project_id) : a.bucket, Number(a.days)])),
          }
        }
      }
      for (const job of s?.jobs ?? []) {
        j[job.id] = { ...(j[job.id] ?? {}) }
        j[job.id][d] = {
          present: saved(s) ? job.crew.filter(x => x.present).map(x => x.staff_id) : [],
          measured: job.today == null ? null : job.basis === 'per_volume' ? Number(job.today) : Number(job.done_before) + Number(job.today),
        }
      }
    })
    setCells(c); setJobDays(j); setExtraWorkers([]); setDirtyDays(new Set()); setEditing(null)
  }

  // Columns: every project any day offers, then workshop, stock, idle.
  const cols: Col[] = useMemo(() => {
    const projects = new Map<string, string>()
    for (const s of sheets) for (const p of s?.projects ?? []) projects.set(p.id, p.name)
    const buckets = sheets.find(s => s)?.buckets
    return [
      ...[...projects].flatMap(([id, name]) => PROJECT_BUCKETS.map(b => ({ key: cellKey(b, id), bucket: b, project_id: id, label: `${name} · ${BUCKET_SHORT[b]}`, tag: `${firstWord(name)} · ${BUCKET_SHORT[b]}` }))),
      ...OTHER_BUCKETS.filter(b => buckets?.[b as 'workshop']).map(b => ({ key: b, bucket: b, project_id: null, label: BUCKET_LABEL[b], tag: BUCKET_SHORT[b] })),
    ]
  }, [sheets])
  const colTag = (key: string) => cols.find(c => c.key === key)?.tag ?? '?'

  // Workers: anyone on a saved day this week, plus anyone added here.
  const workers: WRow[] = useMemo(() => {
    const m = new Map<string, WRow>()
    for (const s of sheets) if (s && saved(s)) for (const w of s.workers) m.set(w.staff_id, { staff_id: w.staff_id, name: w.name, trade: w.trade, day_rate: w.day_rate, photo_url: w.photo_url, verified: w.verified })
    for (const w of extraWorkers) m.set(w.staff_id, w)
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [sheets, extraWorkers])
  const jobs: PieceJob[] = useMemo(() => {
    const m = new Map<string, PieceJob>()
    for (const s of sheets) for (const job of s?.jobs ?? []) if (!m.has(job.id)) m.set(job.id, job)
    return [...m.values()]
  }, [sheets])

  const dayInfo = (i: number) => {
    const s = sheets[i]
    const status: DayStatus = s?.day?.status ?? 'none'
    const editable = inRange(dates[i]) && !!s?.can_edit && !s.day?.paid && status !== 'locked'
    return { s, status, editable }
  }
  const markDirty = (d: string) => setDirtyDays(x => new Set(x).add(d))
  const setCell = (staff: string, d: string, cell: Cell | null) => {
    setCells(c => {
      const row = { ...(c[staff] ?? {}) }
      if (cell && cell.paid > 0) row[d] = cell; else delete row[d]
      return { ...c, [staff]: row }
    })
    markDirty(d)
  }
  function sameAsDayBefore(i: number) {
    const from = dates[i - 1], to = dates[i]
    setCells(c => {
      const next: typeof c = {}
      for (const [staff, row] of Object.entries(c)) {
        next[staff] = { ...row }
        if (row[from]) next[staff][to] = { ...row[from], ot: 0, night: 0, note: null }
      }
      return next
    })
    setJobDays(j => {
      const next: typeof j = {}
      for (const [id, row] of Object.entries(j)) next[id] = { ...row, [to]: { present: row[from]?.present ?? [], measured: row[to]?.measured ?? null } }
      return next
    })
    markDirty(to)
  }

  // Piece work: crew there per day; the week's measurement goes on the last
  // day it was measured, or the last day the crew worked.
  const measureDay = (job: PieceJob) => {
    const row = jobDays[job.id] ?? {}
    const editable = dates.filter((_, i) => dayInfo(i).editable)
    const withMeasure = editable.filter(d => row[d]?.measured != null)
    if (withMeasure.length) return withMeasure[withMeasure.length - 1]
    const worked = editable.filter(d => (row[d]?.present.length ?? 0) > 0)
    return worked[worked.length - 1] ?? editable[editable.length - 1] ?? null
  }
  const toggleCrew = (job: PieceJob, d: string) => {
    setJobDays(j => {
      const row = { ...(j[job.id] ?? {}) }
      const cur = row[d] ?? { present: [], measured: null }
      row[d] = { ...cur, present: cur.present.length ? [] : job.crew.map(c => c.staff_id) }
      return { ...j, [job.id]: row }
    })
    markDirty(d)
  }
  const setMeasure = (job: PieceJob, value: string) => {
    const d = measureDay(job)
    if (!d) return
    setJobDays(j => {
      const row = { ...(j[job.id] ?? {}) }
      row[d] = { present: row[d]?.present ?? [], measured: value === '' ? null : Number(value) }
      return { ...j, [job.id]: row }
    })
    markDirty(d)
  }

  const dayPayload = (d: string) => ({
    date: d,
    workers: Object.entries(cells).filter(([, row]) => row[d]?.paid).map(([staff, row]) => ({
      staff_id: staff, paid_days: row[d].paid, overtime_hours: row[d].ot, overtime_night_hours: Math.min(row[d].night, row[d].ot), note: row[d].note,
      alloc: Object.entries(row[d].alloc).filter(([, v]) => v > 0).map(([k, v]) => {
        const c = cols.find(x => x.key === k)
        return { bucket: c?.bucket ?? k, project_id: c?.project_id ?? null, days: v }
      }),
    })),
    jobs: jobs.map(job => ({ job, jd: jobDays[job.id]?.[d] })).filter(x => x.jd && (x.jd.present.length || x.jd.measured != null)).map(({ job, jd }) => ({
      id: job.id, present: jd!.present,
      ...(job.basis === 'per_volume' ? { quantity: jd!.measured } : { percent_total: jd!.measured }),
    })),
  })
  const hasContent = (d: string) => { const p = dayPayload(d); return p.workers.length > 0 || p.jobs.length > 0 }
  const adds = (staff: string, d: string) => { const c = cells[staff]?.[d]; return !c || Object.values(c.alloc).reduce((s, n) => s + n, 0) === c.paid }
  const mismatches = dates.flatMap(d => workers.filter(w => !adds(w.staff_id, d)).map(w => `${w.name} (${WEEKDAYS[dates.indexOf(d)]})`))

  async function save(submit: boolean) {
    // Save sends what changed; Send also sends every day with something on it that isn't sent yet.
    const days = dates.filter((d, i) => dayInfo(i).editable
      && (dirtyDays.has(d) || (submit && hasContent(d) && dayInfo(i).status !== 'submitted')))
    if (!days.length) { toast(submit ? 'Nothing new to send' : 'Nothing changed', 'info'); return }
    setBusy(submit ? 'send' : 'save')
    const { data, error } = await supabase.rpc('labour_week_save', { p_pm: pm, p_days: days.map(dayPayload), p_submit: submit })
    setBusy(null)
    if (error) { toast(error.message, 'error'); return }
    const r = data as { mismatches: number }
    toast(submit ? `${days.length} day${days.length === 1 ? '' : 's'} sent for review` : r.mismatches ? 'Saved — some rows still don\'t add up' : 'Saved', 'success')
    for (const k of ['labour-day', 'labour-day-board', 'labour-flags', 'labour-day-unpaid', 'labour-day-todo']) qc.invalidateQueries({ queryKey: [k] })
  }

  async function createWorker(w: NewWorker) {
    setBusy('new')
    const { data, error } = await supabase.rpc('labour_day_new_worker', {
      p_pm: pm, p_name: w.name.trim(), p_trade: w.trade, p_day_rate: Number(w.rate), p_phone: w.phone.trim() || null, p_photo: w.photo,
    })
    setBusy(null)
    if (error) { toast(error.message, 'error'); return }
    const r = data as { staff_id: string; name: string; existing: boolean; day_rate: number; trade: string }
    setNewWorker(null)
    qc.invalidateQueries({ queryKey: ['labour-casual-workers'] })
    qc.invalidateQueries({ queryKey: ['my-workers-details'] })
    setExtraWorkers(x => [...x, { staff_id: r.staff_id, name: r.name, trade: r.trade, day_rate: r.day_rate, photo_url: w.photo, verified: false }])
    toast(r.existing ? `${r.name} is already on file under that phone — added` : `${r.name} added. Fill in their ID and bank on Worker details; HR verifies before they're paid.`, 'success')
  }
  function addWorker(id: string | null) {
    setAdding(false)
    const w = casual.find(x => x.id === id)
    if (!w || workers.some(x => x.staff_id === w.id)) return
    setExtraWorkers(x => [...x, { staff_id: w.id, name: w.employee_name, trade: w.trade_tag, day_rate: w.day_rate, photo_url: w.photo_url, verified: !!w.verified_at }])
  }

  const anyEditable = dates.some((_, i) => dayInfo(i).editable)
  const weekCost = workers.reduce((s, w) => s + dates.reduce((t, d) => t + (cells[w.staff_id]?.[d]?.paid ?? 0) * Number(w.day_rate ?? 0), 0), 0)
  const due = (() => { const dow = settings?.week_due_dow ?? 6; return addDays(week, dow - 1) })()
  const editingCell = editing ? cells[editing.staff]?.[editing.date] ?? null : null

  return (
    <div className="mx-auto max-w-6xl space-y-4 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-slate-800 dark:text-slate-100"><CalendarRange className="h-5 w-5 text-brand" /> Week sheet</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Your week on one grid. Send it by {dayLabel(due)}.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/labour/day${pm && seeAll ? `?pm=${pm}` : ''}`} className="rounded-lg border px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300">One day</Link>
          <Link to="/labour/day-requests" className="rounded-lg border px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300">Crew request</Link>
          {approver && <Link to="/labour/days" className="rounded-lg border px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300">Review days</Link>}
        </div>
      </div>

      <div className={`${card} flex flex-wrap items-center gap-2 p-3`}>
        <button onClick={() => setQ('week', addDays(week, -7))} className="rounded-lg border p-2 dark:border-slate-600" aria-label="Week before"><ChevronLeft className="h-4 w-4" /></button>
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{dayLabel(week)} – {dayLabel(addDays(week, 6))}</span>
        <button onClick={() => setQ('week', addDays(week, 7))} disabled={addDays(week, 7) > today} className="rounded-lg border p-2 disabled:opacity-40 dark:border-slate-600" aria-label="Next week"><ChevronRight className="h-4 w-4" /></button>
        {seeAll && <SearchableSelect className="min-w-[14rem] flex-1 sm:flex-none" value={pm} onChange={v => setQ('pm', v)} options={pms.map(p => ({ id: p.id, label: p.name }))} placeholder="Whose week?" />}
        <span className="ml-auto text-xs text-slate-500">{fmtMoney(weekCost)} day workers this week</span>
      </div>

      {!startsOn && <p className={`${card} p-4 text-sm text-amber-800 dark:text-amber-200`}>Day sheets haven't started yet. Admin or operations set the start date in Review days → Settings.</p>}
      {loading && <p className="p-6 text-center text-sm text-slate-400">Loading…</p>}

      {!loading && startsOn && (
        <>
          <div className={`${card} overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/40">
                    <th className="sticky left-0 z-10 min-w-[10rem] bg-slate-50 px-3 py-2 text-left font-medium dark:bg-slate-900">Worker</th>
                    {dates.map((d, i) => {
                      const { status, editable } = dayInfo(i)
                      return (
                        <th key={d} className="min-w-[6.5rem] border-l px-1 py-1.5 font-medium dark:border-slate-700">
                          <div className="flex flex-col items-center gap-1">
                            <Link to={`/labour/day?date=${d}${seeAll && pm ? `&pm=${pm}` : ''}`} className="hover:text-brand">{WEEKDAYS[i]} {new Date(`${d}T00:00:00`).getDate()}</Link>
                            {inRange(d) ? <Pill tone={DAY_STATUS[status].tone}>{status === 'none' ? 'Empty' : DAY_STATUS[status].label}</Pill> : <span className="text-[10px] text-slate-400">{d > today ? 'Not yet' : 'Before start'}</span>}
                            {editable && i > 0 && inRange(dates[i - 1]) && (
                              <button onClick={() => sameAsDayBefore(i)} title="Same as the day before" className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-brand"><Copy className="h-3 w-3" /> as {WEEKDAYS[i - 1]}</button>
                            )}
                          </div>
                        </th>
                      )
                    })}
                    <th className="border-l px-2 py-2 font-medium dark:border-slate-700">Days</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-slate-700">
                  {workers.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-sm text-slate-400">Nobody this week yet — add who worked.</td></tr>}
                  {workers.map(w => (
                    <tr key={w.staff_id}>
                      <td className="sticky left-0 z-10 bg-white px-3 py-2 dark:bg-slate-800">
                        <div className="flex items-center gap-2">
                          <WorkerAvatar url={w.photo_url} name={w.name} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-800 dark:text-slate-100">{w.name}</p>
                            <p className="truncate text-[11px] text-slate-500">{tradeName(w.trade)} · {w.day_rate ? `${Number(w.day_rate).toLocaleString()}/day` : <span className="text-red-600">no day rate</span>}{!w.verified && <span className="text-amber-600"> · not verified</span>}</p>
                          </div>
                        </div>
                      </td>
                      {dates.map((d, i) => {
                        const c = cells[w.staff_id]?.[d]
                        const { editable } = dayInfo(i)
                        const keys = c ? Object.keys(c.alloc).filter(k => c.alloc[k] > 0) : []
                        const ok = adds(w.staff_id, d)
                        return (
                          <td key={d} className="border-l px-1 py-1.5 text-center dark:border-slate-700">
                            <button disabled={!editable && !c} onClick={() => setEditing({ staff: w.staff_id, date: d })}
                              className={`h-12 w-full min-w-[6rem] rounded-lg border px-1 text-[11px] leading-tight ${c ? (ok ? 'border-brand/40 bg-brand/10 text-slate-800 dark:text-slate-100' : 'border-red-300 bg-red-50 text-red-700 dark:bg-red-900/20') : 'border-dashed text-slate-300 dark:border-slate-600 dark:text-slate-600'} disabled:cursor-default`}>
                              {c ? (
                                <>
                                  <span className="block text-sm font-semibold">{halfDays(c.paid)}{c.ot ? <span className="text-[10px] font-normal text-slate-500"> +{c.ot}h</span> : null}</span>
                                  <span className="block truncate text-slate-500">{keys.length === 1 ? colTag(keys[0]) : keys.length > 1 ? 'split' : 'where?'}</span>
                                </>
                              ) : editable ? '+' : '·'}
                            </button>
                          </td>
                        )
                      })}
                      <td className="border-l px-2 py-2 text-center text-sm font-semibold tabular-nums dark:border-slate-700">{halfDays(dates.reduce((s, d) => s + (cells[w.staff_id]?.[d]?.paid ?? 0), 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {anyEditable && (
              <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2.5 dark:border-slate-700">
                {adding ? (
                  <div className="flex w-full items-center gap-2 sm:w-80">
                    <SearchableSelect className="flex-1" value={null} onChange={addWorker} placeholder="Find a worker…"
                      options={casual.filter(x => !workers.some(w => w.staff_id === x.id)).map(x => ({ id: x.id, label: x.employee_name, sub: tradeName(x.trade_tag) }))} />
                    <button onClick={() => setAdding(false)} className="rounded p-1.5 text-slate-400"><X className="h-4 w-4" /></button>
                  </div>
                ) : (
                  <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-brand dark:border-slate-600 dark:text-slate-200"><Plus className="h-3.5 w-3.5" /> Add a worker</button>
                )}
                {!newWorker && (
                  <button onClick={() => setNewWorker({ name: '', phone: '', trade: '', rate: '', photo: null })} className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-brand dark:border-slate-600 dark:text-slate-200"><UserPlus className="h-3.5 w-3.5" /> New worker</button>
                )}
                <p className="ml-auto text-[11px] text-slate-500">Tap a box to set the day. A day split across projects is set on that day's sheet.</p>
              </div>
            )}
            {anyEditable && newWorker && <NewWorkerForm value={newWorker} onChange={setNewWorker} busy={busy === 'new'} onCancel={() => setNewWorker(null)} onSave={() => createWorker(newWorker)} />}
          </div>

          {jobs.length > 0 && (
            <div className={`${card} overflow-hidden`}>
              <h2 className="border-b px-4 py-3 text-sm font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100">Piece work <span className="font-normal text-slate-500">· tick the days the crew worked; enter the amount when measured</span></h2>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <tbody className="divide-y dark:divide-slate-700">
                    {jobs.map(job => {
                      const vol = job.basis === 'per_volume'
                      const md = measureDay(job)
                      const row = jobDays[job.id] ?? {}
                      return (
                        <tr key={job.id}>
                          <td className="sticky left-0 z-10 min-w-[10rem] bg-white px-3 py-2 dark:bg-slate-800">
                            <p className="truncate font-medium text-slate-800 dark:text-slate-100">{job.what}</p>
                            <p className="truncate text-[11px] text-slate-500">{job.project} · {vol ? `${Number(job.unit_rate ?? 0).toLocaleString()}/${job.unit ?? 'unit'}` : fmtMoney(job.fixed_price ?? 0)}</p>
                          </td>
                          {dates.map((d, i) => {
                            const on = (row[d]?.present.length ?? 0) > 0
                            const { editable } = dayInfo(i)
                            return (
                              <td key={d} className="min-w-[6.5rem] border-l px-1 py-1.5 text-center dark:border-slate-700">
                                <button disabled={!editable} onClick={() => toggleCrew(job, d)} aria-pressed={on}
                                  className={`h-9 w-full rounded-lg border text-xs ${on ? 'border-emerald-300 bg-emerald-50 font-semibold text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200' : 'border-dashed text-slate-300 dark:border-slate-600'} disabled:cursor-default`}>
                                  {on ? `✓ ${row[d]!.present.length}` : '·'}
                                </button>
                                {row[d]?.measured != null && <span className="block text-[10px] text-slate-500">{vol ? `${row[d]!.measured} ${job.unit ?? ''}` : `at ${row[d]!.measured}%`}</span>}
                              </td>
                            )
                          })}
                          <td className="border-l px-2 py-2 dark:border-slate-700">
                            <label className="flex items-center gap-1 whitespace-nowrap text-[11px] text-slate-500">
                              {vol ? 'Measured' : 'Done now'}
                              <input type="number" inputMode="decimal" step="any" disabled={!md} value={md ? (row[md]?.measured ?? '') : ''}
                                onChange={e => setMeasure(job, e.target.value)} placeholder={vol ? '—' : String(Number(job.done_before) || 0)}
                                className="w-20 rounded-lg border px-2 py-1 text-right text-base sm:text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                              {vol ? job.unit ?? '' : '%'}
                            </label>
                            {md && <span className="block text-[10px] text-slate-400">on {WEEKDAYS[dates.indexOf(md)]}</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {mismatches.length > 0 && <p className="text-sm text-red-600 dark:text-red-400">Don't add up: {mismatches.join(', ')}. Open that day's sheet to fix a split.</p>}

          {anyEditable && (
            <div className="sticky bottom-3 z-20">
              <div className={`${card} flex flex-wrap items-center gap-2 p-3 shadow-lg`}>
                <span className="text-xs text-slate-500">{dirtyDays.size ? `${dirtyDays.size} day${dirtyDays.size === 1 ? '' : 's'} changed, not saved` : 'Saved'}</span>
                <div className="ml-auto flex gap-2">
                  <button onClick={() => save(false)} disabled={!!busy || dirtyDays.size === 0}
                    className="flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200">
                    <Save className="h-4 w-4" /> {busy === 'save' ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => save(true)} disabled={!!busy || mismatches.length > 0}
                    className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                    <Send className="h-4 w-4" /> {busy === 'send' ? 'Sending…' : 'Send week for review'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {editing && (
        <CellEditor
          name={workers.find(w => w.staff_id === editing.staff)?.name ?? ''} date={editing.date} cols={cols}
          cell={editingCell} editable={dayInfo(dates.indexOf(editing.date)).editable}
          dayLink={`/labour/day?date=${editing.date}${seeAll && pm ? `&pm=${pm}` : ''}`}
          onClose={() => setEditing(null)}
          onSave={c => { setCell(editing.staff, editing.date, c); setEditing(null) }}
        />
      )}
    </div>
  )
}

// One worker's day: paid ½ or 1, where it went, overtime. A day already split
// across columns is kept as it is here and changed on the day sheet.
function CellEditor({ name, date, cols, cell, editable, dayLink, onClose, onSave }: {
  name: string; date: string; cols: Col[]; cell: Cell | null; editable: boolean; dayLink: string
  onClose: () => void; onSave: (c: Cell | null) => void
}) {
  const keys = cell ? Object.keys(cell.alloc).filter(k => cell.alloc[k] > 0) : []
  const split = keys.length > 1
  const [paid, setPaid] = useState(cell?.paid ?? 1)
  const [where, setWhere] = useState<string | null>(keys.length === 1 ? keys[0] : null)
  const [ot, setOt] = useState(cell?.ot ?? 0)
  const save = (p: number) => onSave(p === 0 ? null : {
    paid: p, ot, night: cell?.night ?? 0, note: cell?.note ?? null,
    alloc: split && cell ? cell.alloc : where ? { [where]: p } : {},
  })
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl sm:rounded-2xl dark:bg-slate-800" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2">
          <p className="flex-1 text-sm font-semibold text-slate-800 dark:text-slate-100">{name} · {dayLabel(date)}</p>
          <button onClick={onClose} className="rounded p-1 text-slate-400" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        {!editable ? (
          <p className="text-sm text-slate-500">This day is locked or already paid. <Link to={dayLink} className="text-brand underline">Open the day</Link> to see it.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
              {[0.5, 1].map(n => (
                <button key={n} onClick={() => setPaid(n)} className={`flex-1 rounded-lg border py-2 text-sm font-semibold ${paid === n ? 'border-brand bg-brand text-white' : 'text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>{n === 1 ? 'Full day' : 'Half day'}</button>
              ))}
            </div>
            {split ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">Split across {keys.length} columns. <Link to={dayLink} className="font-semibold underline">Change the split on the day sheet</Link>.</p>
            ) : (
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {cols.map(c => (
                  <button key={c.key} onClick={() => setWhere(c.key)}
                    className={`block w-full rounded-lg border px-3 py-2 text-left text-sm ${where === c.key ? 'border-brand bg-brand/10 font-semibold text-slate-800 dark:text-slate-100' : 'text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>{c.label}</button>
                ))}
                <p className="pt-1 text-[11px] text-slate-500">Split across two projects? <Link to={dayLink} className="underline">Use the day sheet</Link>.</p>
              </div>
            )}
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">Overtime hours
              <input type="number" min={0} max={16} step={0.5} value={ot || ''} placeholder="0" onChange={e => setOt(Number(e.target.value) || 0)}
                className="w-20 rounded-lg border px-2 py-1.5 text-center text-base sm:text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </label>
            <div className="flex gap-2 pt-1">
              {cell && <button onClick={() => onSave(null)} className="rounded-lg px-3 py-2 text-sm text-red-600">Didn't work</button>}
              <button onClick={() => save(paid)} disabled={!split && !where} className="ml-auto rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
