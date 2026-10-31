import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { Pill } from '@/components/record/Record'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { PhotoButton, WorkerAvatar } from '@/components/labour/WorkerPhoto'
import { addDays, dayLabel, fmtMoney, isoDay } from '@/lib/labour'
import {
  BUCKET_LABEL, BUCKET_SHORT, DAY_STATUS, OTHER_BUCKETS, PROJECT_BUCKETS, REQUEST_STATUS, halfDays, tradeName, useDayPeople, useTrades, weekdaysLabel,
  type Alloc, type Bucket, type DaySheet, type PieceJob, type SheetWorker,
} from '@/lib/labourDay'
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Hammer, Lock, Plus, Ruler, Save, Send, Sheet, Tag, Trash2, Undo2, UserPlus, X } from 'lucide-react'

type Row = Omit<SheetWorker, 'alloc'> & { cells: Record<string, number> }
type Col = { key: string; bucket: Bucket; project_id: string | null; project: string; group: string }
type NewWorker = { name: string; phone: string; trade: string; rate: string; photo: string | null }
/** A piece job as edited: who of its crew was there, and what was measured (volume) or how far along it is now (fixed price). */
type JobRow = PieceJob & { present: string[]; measured: string }

const cellKey = (bucket: Bucket, project: string | null) => (project ? `${project}:${bucket}` : bucket)
const card = 'rounded-2xl border bg-white dark:border-slate-700 dark:bg-slate-800'

// One sheet per PM per day: who was paid for the day (a half or a whole),
// and where that day went — a project's build or post-event repair, the
// workshop, stock production, or idle time. Each row must add up before it
// can be sent; operations locks it after review (migration 489). Volume and
// fixed-price jobs sit under it: who of the crew was there, and how much was
// done when it's measured (492).
export default function LabourDaySheetPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [params, setParams] = useSearchParams()
  const { me, approver, seeAll, pms, isLoading: loadingPeople } = useDayPeople()
  const today = isoDay(new Date())
  const date = params.get('date') ?? today
  const pm = params.get('pm') ?? me?.id ?? null
  const setQ = (k: string, v: string | null) => setParams(p => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n }, { replace: true })

  const { data: sheet, isLoading, error } = useQuery({
    queryKey: ['labour-day', pm, date],
    enabled: !!pm,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('labour_day_get', { p_pm: pm, p_date: date })
      if (error) throw error
      return data as DaySheet
    },
  })

  // Casual workers to add, and projects to add as columns.
  const { data: workers = [] } = useQuery({
    queryKey: ['labour-casual-workers'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('staff').select('id, employee_name, trade_tag, day_rate, photo_url, verified_at')
        .eq('employment_type', 'tier_2_casual').or('status.is.null,status.eq.active').order('employee_name')
      if (error) throw error
      return (data ?? []) as { id: string; employee_name: string; trade_tag: string | null; day_rate: number | null; photo_url: string | null; verified_at: string | null }[]
    },
  })
  const { data: allProjects = [] } = useQuery({
    queryKey: ['labour-day-all-projects'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('id, project_name, is_internal, costing_closed_at, active_for_year')
        .eq('active_for_year', true).order('project_name')
      if (error) throw error
      return ((data ?? []) as { id: string; project_name: string; is_internal: boolean | null; costing_closed_at: string | null }[])
        .filter(p => !p.is_internal && !p.costing_closed_at)
    },
  })

  // The draft being edited.
  const [rows, setRows] = useState<Row[]>([])
  const [extra, setExtra] = useState<{ id: string; name: string }[]>([])
  const [dirty, setDirty] = useState(false)
  const [reason, setReason] = useState('')
  const [returnNote, setReturnNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [addingProject, setAddingProject] = useState<string | null>(null)
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [newWorker, setNewWorker] = useState<NewWorker | null>(null)

  // Seed the grid from each sheet the server sends back.
  const [seeded, setSeeded] = useState<typeof sheet>(undefined)
  if (sheet && seeded !== sheet) {
    setSeeded(sheet)
    setRows(sheet.workers.map(w => ({
      ...w,
      paid_days: Number(w.paid_days),
      overtime_hours: Number(w.overtime_hours) || 0,
      overtime_night_hours: Number(w.overtime_night_hours) || 0,
      cells: Object.fromEntries(w.alloc.map((a: Alloc) => [PROJECT_BUCKETS.includes(a.bucket) ? cellKey(a.bucket, a.project_id) : a.bucket, Number(a.days)])),
    })))
    setJobs((sheet.jobs ?? []).map(j => ({
      ...j,
      present: j.crew.filter(c => c.present).map(c => c.staff_id),
      measured: j.today == null ? '' : String(j.basis === 'per_volume' ? Number(j.today) : Number(j.done_before) + Number(j.today)),
    })))
    setExtra([])
    setDirty(false)
    setReason('')
  }

  const status = sheet?.day?.status ?? 'none'
  const locked = status === 'locked'
  const started = !!sheet?.starts_on && date >= sheet.starts_on
  const canEdit = !!sheet?.can_edit && started && !sheet.day?.paid && date <= today

  const projectCols = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of sheet?.projects ?? []) m.set(p.id, p.name)
    for (const p of extra) m.set(p.id, p.name)
    return [...m].map(([id, name]) => ({ id, name }))
  }, [sheet, extra])
  const cols: Col[] = [
    ...projectCols.flatMap(p => PROJECT_BUCKETS.map(b => ({ key: cellKey(b, p.id), bucket: b, project_id: p.id, project: p.name, group: p.id }))),
    ...OTHER_BUCKETS.filter(b => sheet?.buckets?.[b as 'workshop']).map(b => ({ key: b, bucket: b, project_id: null, project: BUCKET_LABEL[b], group: b })),
  ]

  const total = (r: Row) => Object.values(r.cells).reduce((s, n) => s + n, 0)
  const mismatched = rows.filter(r => total(r) !== r.paid_days)
  const update = (staff: string, f: (r: Row) => Row) => { setRows(rs => rs.map(r => (r.staff_id === staff ? f(r) : r))); setDirty(true) }

  // Tap a cell: empty → the rest of the day (or ½) → ½ → empty.
  function tap(r: Row, key: string) {
    const cur = r.cells[key] ?? 0
    const rest = r.paid_days - (total(r) - cur)
    let next: number
    if (cur === 0) next = rest >= 1 ? 1 : 0.5
    else if (cur === 1) next = 0.5
    else next = 0
    update(r.staff_id, x => ({ ...x, cells: { ...x.cells, [key]: next } }))
  }
  function addWorker(id: string | null) {
    setAdding(null)
    if (!id || rows.some(r => r.staff_id === id)) return
    const w = workers.find(x => x.id === id)
    if (!w) return
    setRows(rs => [...rs, {
      staff_id: w.id, name: w.employee_name, trade: w.trade_tag, day_rate: w.day_rate, photo_url: w.photo_url, verified: !!w.verified_at,
      paid_days: 1, overtime_hours: 0, overtime_night_hours: 0, note: null, paid: false, elsewhere: 0, cells: {},
    }].sort((a, b) => a.name.localeCompare(b.name)))
    setDirty(true)
  }
  // A brand-new person (493): into the register with the PM's proposed day
  // rate, and straight onto today's grid. HR verifies before they're paid.
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
    if (!rows.some(x => x.staff_id === r.staff_id)) {
      setRows(rs => [...rs, {
        staff_id: r.staff_id, name: r.name, trade: r.trade, day_rate: r.day_rate, photo_url: w.photo, verified: false,
        paid_days: 1, overtime_hours: 0, overtime_night_hours: 0, note: null, paid: false, elsewhere: 0, cells: {},
      }].sort((a, b) => a.name.localeCompare(b.name)))
      setDirty(true)
    }
    toast(r.existing ? `${r.name} is already on file under that phone — added to the sheet` : `${r.name} added. Fill in their ID and bank on Worker details; HR verifies before they're paid.`, 'success')
  }
  function addProject(id: string | null) {
    setAddingProject(null)
    const p = allProjects.find(x => x.id === id)
    if (p && !projectCols.some(c => c.id === p.id)) setExtra(e => [...e, { id: p.id, name: p.project_name }])
  }

  const payload = () => rows.map(r => ({
    staff_id: r.staff_id, paid_days: r.paid_days, overtime_hours: r.overtime_hours || 0, overtime_night_hours: r.overtime_night_hours || 0, note: r.note,
    alloc: cols.filter(c => (r.cells[c.key] ?? 0) > 0).map(c => ({ bucket: c.bucket, project_id: c.project_id, days: r.cells[c.key] })),
  }))
  const updateJob = (id: string, f: (j: JobRow) => JobRow) => { setJobs(js => js.map(j => (j.id === id ? f(j) : j))); setDirty(true) }
  const jobPayload = () => jobs.filter(j => j.present.length || j.measured !== '').map(j => ({
    id: j.id, present: j.present,
    ...(j.basis === 'per_volume' ? { quantity: j.measured === '' ? null : Number(j.measured) } : { percent_total: j.measured === '' ? null : Number(j.measured) }),
  }))
  const jobsActive = jobs.some(j => j.present.length || j.measured !== '')
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['labour-day', pm, date] })
    qc.invalidateQueries({ queryKey: ['labour-day-board'] })
    qc.invalidateQueries({ queryKey: ['labour-flags'] })
    qc.invalidateQueries({ queryKey: ['labour-day-unpaid'] })
  }
  async function save(submit: boolean) {
    setBusy(submit ? 'send' : 'save')
    const { data, error } = await supabase.rpc('labour_day_save', {
      p_pm: pm, p_date: date, p_workers: payload(), p_submit: submit, p_reason: locked ? reason.trim() || null : null, p_jobs: jobPayload(),
    })
    setBusy(null)
    if (error) { toast(error.message, 'error'); return }
    const r = data as { status: string; mismatches: number }
    toast(submit ? 'Sent to operations for review' : locked ? 'Change saved and logged' : r.mismatches ? `Saved — ${r.mismatches} row${r.mismatches === 1 ? '' : 's'} still ${r.mismatches === 1 ? "doesn't" : "don't"} add up` : 'Saved', submit || !r.mismatches ? 'success' : 'info')
    refresh()
  }
  async function review(action: 'lock' | 'return') {
    if (!sheet?.day) return
    setBusy(action)
    const { error } = action === 'lock'
      ? await supabase.rpc('labour_day_lock', { p_day: sheet.day.id, p_note: null })
      : await supabase.rpc('labour_day_return', { p_day: sheet.day.id, p_reason: returnNote.trim() })
    setBusy(null)
    if (error) { toast(error.message, 'error'); return }
    toast(action === 'lock' ? 'Day locked' : 'Sent back to the PM', 'success')
    setReturnNote('')
    refresh()
  }

  // What was asked for, against who came, by trade.
  const askedVsCame = useMemo(() => {
    const m = new Map<string, { asked: number; came: number }>()
    for (const l of sheet?.request?.status === 'approved' ? sheet.request.lines : []) m.set(l.trade, { asked: l.headcount, came: 0 })
    for (const r of rows) { const t = r.trade ?? 'none'; const v = m.get(t) ?? { asked: 0, came: 0 }; v.came += 1; m.set(t, v) }
    return [...m]
  }, [sheet, rows])
  const dayCost = rows.reduce((s, r) => s + r.paid_days * Number(r.day_rate ?? 0), 0)

  const pmOptions = pms.map(p => ({ id: p.id, label: p.name }))
  const workerOptions = workers.filter(w => !rows.some(r => r.staff_id === w.id))
    .map(w => ({ id: w.id, label: w.employee_name, sub: [tradeName(w.trade_tag), w.day_rate ? `${Number(w.day_rate).toLocaleString()} ETB/day` : 'no day rate'].join(' · ') }))
  const projectOptions = allProjects.filter(p => !projectCols.some(c => c.id === p.id)).map(p => ({ id: p.id, label: p.project_name }))
  const cellCls = 'h-9 w-12 rounded-lg border text-sm font-semibold tabular-nums transition'

  return (
    <div className="mx-auto max-w-6xl space-y-4 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-slate-800 dark:text-slate-100"><Sheet className="h-5 w-5 text-brand" /> Day sheet</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Who was paid for the day, and where the day went.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/labour/day-requests" className="rounded-lg border px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300">Crew request</Link>
          {approver && <Link to="/labour/days" className="rounded-lg border px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300">Review days</Link>}
        </div>
      </div>

      <div className={`${card} flex flex-wrap items-center gap-2 p-3`}>
        <button onClick={() => setQ('date', addDays(date, -1))} className="rounded-lg border p-2 dark:border-slate-600" aria-label="Day before"><ChevronLeft className="h-4 w-4" /></button>
        <label className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm dark:border-slate-600">
          <CalendarDays className="h-4 w-4 text-slate-400" />
          <input type="date" value={date} max={today} onChange={e => setQ('date', e.target.value || null)} className="bg-transparent text-base outline-none sm:text-sm dark:text-slate-100" />
        </label>
        <button onClick={() => setQ('date', addDays(date, 1))} disabled={date >= today} className="rounded-lg border p-2 disabled:opacity-40 dark:border-slate-600" aria-label="Next day"><ChevronRight className="h-4 w-4" /></button>
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{dayLabel(date)}</span>
        {seeAll && (
          <SearchableSelect className="min-w-[14rem] flex-1 sm:flex-none" value={pm} onChange={v => setQ('pm', v)} options={pmOptions} placeholder="Whose sheet?" />
        )}
        {sheet && <Pill tone={DAY_STATUS[status].tone}>{DAY_STATUS[status].label}</Pill>}
        {sheet?.day?.paid && <Pill tone="green">Pay confirmed</Pill>}
      </div>

      {!pm && !loadingPeople && (
        <p className={`${card} p-6 text-center text-sm text-slate-500`}>{seeAll ? 'Pick whose sheet to open.' : 'Your login isn\'t linked to a staff record, so there is no sheet to open. Ask HR to link it.'}</p>
      )}
      {error && <p className={`${card} p-4 text-sm text-red-600`}>{(error as Error).message}</p>}
      {pm && isLoading && <p className="p-6 text-center text-sm text-slate-400">Loading…</p>}

      {sheet && (
        <>
          {!sheet.starts_on && (
            <Banner tone="amber">The day sheet hasn't started yet. Admin or operations set its start date in <Link to="/labour/days" className="underline">Review days → Settings</Link>.</Banner>
          )}
          {sheet.starts_on && date < sheet.starts_on && (
            <Banner tone="amber">Day sheets start on {dayLabel(sheet.starts_on)}. Days before that are recorded on their labour requests (<Link to="/labour/record" className="underline">Record today</Link>).</Banner>
          )}
          {sheet.day?.review_note && status === 'open' && <Banner tone="red">Sent back by operations: {sheet.day.review_note}</Banner>}
          {sheet.prefilled_from && !sheet.day?.saved_at && rows.length > 0 && (
            <Banner tone="blue">Started from {dayLabel(sheet.prefilled_from)}'s sheet — change only what changed, then save.</Banner>
          )}
          {locked && (
            <Banner tone="green">
              Locked by {sheet.day?.locked_by_name ?? 'operations'}{sheet.day?.changes ? ` · ${sheet.day.changes} change${sheet.day.changes === 1 ? '' : 's'} logged` : ''}.
              {approver && !sheet.day?.paid ? ' You can still change it — say why below.' : ' Ask operations to change it.'}
            </Banner>
          )}

          {/* What was asked for */}
          <div className={`${card} flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm`}>
            {sheet.request ? (
              <span className="text-slate-600 dark:text-slate-300">
                Crew {sheet.request.code} <Pill tone={REQUEST_STATUS[sheet.request.status].tone}>{REQUEST_STATUS[sheet.request.status].label}</Pill>
                <span className="text-xs text-slate-500"> · {weekdaysLabel(sheet.request.weekdays)}</span>
                {!sheet.request.works_today && <span className="text-xs text-amber-700 dark:text-amber-300"> · not one of the crew's working days</span>}
              </span>
            ) : <span className="text-slate-500">No approved crew for this day.</span>}
            {askedVsCame.map(([t, v]) => (
              <span key={t} className={`rounded-full px-2 py-0.5 text-xs ${v.came > v.asked ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                {tradeName(t === 'none' ? null : t)}: {v.came}{v.asked ? ` of ${v.asked}` : ''}
              </span>
            ))}
            <span className="ml-auto text-xs text-slate-500">{rows.length} worker{rows.length === 1 ? '' : 's'} · {halfDays(rows.reduce((s, r) => s + r.paid_days, 0))} days · {fmtMoney(dayCost)}</span>
          </div>

          {/* The grid */}
          <div className={`${card} overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/40">
                    <th rowSpan={2} className="sticky left-0 z-10 min-w-[11rem] bg-slate-50 px-3 py-2 text-left font-medium dark:bg-slate-900">Worker</th>
                    <th rowSpan={2} className="px-2 py-2 font-medium">Paid</th>
                    {projectCols.map(p => <th key={p.id} colSpan={2} className="max-w-[10rem] truncate border-l px-2 py-1.5 font-medium dark:border-slate-700" title={p.name}>{p.name}</th>)}
                    {OTHER_BUCKETS.some(b => sheet.buckets[b as 'workshop']) && <th colSpan={3} className="border-l px-2 py-1.5 font-medium dark:border-slate-700">Not a project</th>}
                    <th rowSpan={2} className="border-l px-2 py-2 font-medium dark:border-slate-700">Adds up</th>
                    <th rowSpan={2} className="px-2 py-2 font-medium">Overtime h</th>
                    <th rowSpan={2} />
                  </tr>
                  <tr className="border-b text-[11px] text-slate-400 dark:border-slate-700">
                    {cols.map((c, i) => (
                      <th key={c.key} className={`px-1 py-1 font-medium ${i === 0 || cols[i - 1].group !== c.group && c.bucket !== 'repair' ? 'border-l dark:border-slate-700' : ''}`} title={BUCKET_LABEL[c.bucket]}>
                        {BUCKET_SHORT[c.bucket]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-slate-700">
                  {rows.length === 0 && (
                    <tr><td colSpan={cols.length + 5} className="p-6 text-center text-sm text-slate-400">Nobody on the sheet yet — add who was present.</td></tr>
                  )}
                  {rows.map(r => {
                    const t = total(r)
                    const ok = t === r.paid_days
                    return (
                      <tr key={r.staff_id} className={ok ? '' : 'bg-red-50/60 dark:bg-red-900/10'}>
                        <td className="sticky left-0 z-10 bg-white px-3 py-2 dark:bg-slate-800">
                          <div className="flex items-center gap-2">
                            <WorkerAvatar url={r.photo_url} name={r.name} size="sm" />
                            <div className="min-w-0">
                              <p className="truncate font-medium text-slate-800 dark:text-slate-100">{r.name}</p>
                              <p className="truncate text-[11px] text-slate-500">
                                {tradeName(r.trade)} · {r.day_rate ? `${Number(r.day_rate).toLocaleString()}/day` : <span className="text-red-600">no day rate</span>}
                                {!r.verified && <span className="text-amber-600"> · not verified</span>}
                                {r.elsewhere > 0 && <span className="text-blue-600"> · {halfDays(r.elsewhere)} on another sheet</span>}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-2 text-center">
                          <div className="inline-flex overflow-hidden rounded-lg border dark:border-slate-600">
                            {[0.5, 1].map(n => (
                              <button key={n} disabled={!canEdit || (n + r.elsewhere > 1)} onClick={() => update(r.staff_id, x => ({ ...x, paid_days: n }))}
                                className={`px-2.5 py-1.5 text-xs font-semibold ${r.paid_days === n ? 'bg-brand text-white' : 'text-slate-600 dark:text-slate-300'} disabled:opacity-40`}>
                                {halfDays(n)}
                              </button>
                            ))}
                          </div>
                        </td>
                        {cols.map((c, i) => {
                          const v = r.cells[c.key] ?? 0
                          return (
                            <td key={c.key} className={`px-1 py-2 text-center ${i === 0 || cols[i - 1].group !== c.group && c.bucket !== 'repair' ? 'border-l dark:border-slate-700' : ''}`}>
                              <button disabled={!canEdit} onClick={() => tap(r, c.key)} title={`${c.project} · ${BUCKET_LABEL[c.bucket]}`}
                                className={`${cellCls} ${v ? (c.bucket === 'repair' ? 'border-violet-300 bg-violet-100 text-violet-800 dark:border-violet-700 dark:bg-violet-900/40 dark:text-violet-200' : 'border-brand/40 bg-brand/10 text-brand') : 'border-dashed text-slate-300 hover:border-brand dark:border-slate-600 dark:text-slate-600'} disabled:cursor-default`}>
                                {v ? halfDays(v) : '·'}
                              </button>
                            </td>
                          )
                        })}
                        <td className="border-l px-2 py-2 text-center text-xs dark:border-slate-700">
                          {ok ? <span className="font-semibold text-emerald-600">✓</span>
                              : <span className="font-semibold text-red-600" title="Each worker's columns must add up to the day they're paid">{halfDays(t)} of {halfDays(r.paid_days)}</span>}
                        </td>
                        <td className="px-2 py-2">
                          <input type="number" min={0} max={16} step={0.5} disabled={!canEdit} value={r.overtime_hours || ''} placeholder="0"
                            onChange={e => update(r.staff_id, x => ({ ...x, overtime_hours: Number(e.target.value) || 0 }))}
                            className="w-16 rounded-lg border px-2 py-1.5 text-center text-base sm:text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                        </td>
                        <td className="px-2 py-2">
                          {canEdit && (
                            <button onClick={() => { setRows(rs => rs.filter(x => x.staff_id !== r.staff_id)); setDirty(true) }} aria-label={`Remove ${r.name}`}
                              className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"><Trash2 className="h-4 w-4" /></button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {canEdit && (
              <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2.5 dark:border-slate-700">
                {adding !== null ? (
                  <div className="flex w-full items-center gap-2 sm:w-80">
                    <SearchableSelect className="flex-1" value={null} onChange={addWorker} options={workerOptions} placeholder="Find a worker…" />
                    <button onClick={() => setAdding(null)} className="rounded p-1.5 text-slate-400"><X className="h-4 w-4" /></button>
                  </div>
                ) : (
                  <button onClick={() => setAdding('')} className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-brand dark:border-slate-600 dark:text-slate-200">
                    <Plus className="h-3.5 w-3.5" /> Add a worker
                  </button>
                )}
                {newWorker === null && (
                  <button onClick={() => { setNewWorker({ name: '', phone: '', trade: '', rate: '', photo: null }); setAdding(null) }}
                    className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-brand dark:border-slate-600 dark:text-slate-200">
                    <UserPlus className="h-3.5 w-3.5" /> New worker
                  </button>
                )}
                {addingProject !== null ? (
                  <div className="flex w-full items-center gap-2 sm:w-80">
                    <SearchableSelect className="flex-1" value={null} onChange={addProject} options={projectOptions} placeholder="Find a project…" />
                    <button onClick={() => setAddingProject(null)} className="rounded p-1.5 text-slate-400"><X className="h-4 w-4" /></button>
                  </div>
                ) : (
                  <button onClick={() => setAddingProject('')} className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-brand dark:border-slate-600 dark:text-slate-200">
                    <Plus className="h-3.5 w-3.5" /> Add a project column
                  </button>
                )}
                <p className="ml-auto text-[11px] text-slate-500">Tap a box: the rest of the day → ½ → empty.</p>
              </div>
            )}
            {canEdit && newWorker && (
              <NewWorkerForm value={newWorker} onChange={setNewWorker} busy={busy === 'new'} onCancel={() => setNewWorker(null)} onSave={() => createWorker(newWorker)} />
            )}
          </div>

          <PieceWork jobs={jobs} canEdit={canEdit} update={updateJob} />

          {mismatched.length > 0 && (
            <p className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {mismatched.length === 1 ? "1 worker doesn't" : `${mismatched.length} workers don't`} add up: {mismatched.map(r => r.name).join(', ')}. Each row's boxes must come to their paid day.
            </p>
          )}

          {/* Actions */}
          {canEdit && (
            <div className="sticky bottom-3 z-20">
              <div className={`${card} flex flex-wrap items-center gap-2 p-3 shadow-lg`}>
                {locked ? (
                  <>
                    <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Why is this locked day changing? (required)"
                      className="min-w-[14rem] flex-1 rounded-lg border px-3 py-2 text-base sm:text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                    <button onClick={() => save(false)} disabled={!dirty || !reason.trim() || mismatched.length > 0 || !!busy}
                      className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                      <Save className="h-4 w-4" /> {busy === 'save' ? 'Saving…' : 'Save the change'}
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-xs text-slate-500">{dirty ? 'Not saved yet' : sheet.day?.saved_at ? `Saved by ${sheet.day.saved_by_name ?? '—'}` : ''}</span>
                    <div className="ml-auto flex gap-2">
                      <button onClick={() => save(false)} disabled={!!busy || (!dirty && !!sheet.day?.saved_at)}
                        className="flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200">
                        <Save className="h-4 w-4" /> {busy === 'save' ? 'Saving…' : 'Save'}
                      </button>
                      <button onClick={() => save(true)} disabled={!!busy || (rows.length === 0 && !jobsActive) || mismatched.length > 0 || (status === 'submitted' && !dirty)}
                        className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                        <Send className="h-4 w-4" /> {busy === 'send' ? 'Sending…' : status === 'submitted' && !dirty ? 'Sent' : 'Send for review'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Operations' review */}
          {approver && status === 'submitted' && !dirty && (
            <div className={`${card} flex flex-wrap items-center gap-2 p-3`}>
              <p className="flex-1 text-sm text-slate-600 dark:text-slate-300">{mismatched.length ? 'Review: the rows above don\'t add up — send it back for the PM to fix.' : 'Review: the sheet adds up. Lock it, or send it back.'}</p>
              <input value={returnNote} onChange={e => setReturnNote(e.target.value)} placeholder="What should the PM fix?"
                className="min-w-[12rem] rounded-lg border px-3 py-2 text-base sm:text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
              <button onClick={() => review('return')} disabled={!returnNote.trim() || !!busy}
                className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200">
                <Undo2 className="h-4 w-4" /> Send back
              </button>
              <button onClick={() => review('lock')} disabled={mismatched.length > 0 || !!busy}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                <Lock className="h-4 w-4" /> {busy === 'lock' ? 'Locking…' : 'Lock the day'}
              </button>
            </div>
          )}
          {approver && locked && !sheet.day?.paid && (
            <div className="flex justify-end">
              <button onClick={() => { const why = prompt('Why unlock this day and send it back to the PM?'); if (why?.trim()) { setReturnNote(why); void supabase.rpc('labour_day_return', { p_day: sheet.day!.id, p_reason: why.trim() }).then(({ error }) => { if (error) toast(error.message, 'error'); else { toast('Unlocked and sent back', 'success'); refresh() } }) } }}
                className="text-xs text-slate-500 underline-offset-2 hover:underline">Unlock and send back to the PM</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Banner({ tone, children }: { tone: 'amber' | 'red' | 'blue' | 'green'; children: React.ReactNode }) {
  const cls = {
    amber: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/40 dark:bg-amber-900/10 dark:text-amber-200',
    red: 'border-red-200 bg-red-50 text-red-800 dark:border-red-800/40 dark:bg-red-900/10 dark:text-red-200',
    blue: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800/40 dark:bg-blue-900/10 dark:text-blue-200',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800/40 dark:bg-emerald-900/10 dark:text-emerald-200',
  }[tone]
  return <p className={`rounded-xl border px-4 py-2.5 text-sm ${cls}`}>{children}</p>
}

// Volume and fixed-price jobs on the PM's projects: tick who of the crew was
// there, and enter the amount only when it's measured.
function PieceWork({ jobs, canEdit, update }: { jobs: JobRow[]; canEdit: boolean; update: (id: string, f: (j: JobRow) => JobRow) => void }) {
  return (
    <section className={card}>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3 dark:border-slate-700">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100"><Hammer className="h-4 w-4 text-slate-400" /> Piece work</h2>
        <p className="flex-1 text-xs text-slate-500">By volume or a fixed price. Tick who was there; enter the amount only on the day it's measured.</p>
        {canEdit && <Link to="/labour/new" className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-brand dark:border-slate-600 dark:text-slate-200"><Plus className="h-3.5 w-3.5" /> New piece job</Link>}
      </div>
      {jobs.length === 0 ? (
        <p className="p-5 text-center text-sm text-slate-400">No open piece jobs on your projects.</p>
      ) : (
        <ul className="divide-y dark:divide-slate-700">
          {jobs.map(j => {
            const vol = j.basis === 'per_volume'
            const before = Number(j.done_before) || 0
            const m = j.measured === '' ? null : Number(j.measured)
            const amount = m == null ? 0 : vol ? m * Number(j.unit_rate ?? 0) : Math.max(0, m - before) / 100 * Number(j.fixed_price ?? 0)
            const bad = m != null && (vol ? m < 0 : m < before || m > 100)
            return (
              <li key={j.id} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {vol ? <Ruler className="h-3.5 w-3.5 text-slate-400" /> : <Tag className="h-3.5 w-3.5 text-slate-400" />}
                      {j.what} <span className="font-normal text-slate-500">· {j.project}{j.work_order ? ` · ${j.work_order}` : ''}</span>
                    </p>
                    <p className="text-xs text-slate-500">
                      {vol ? `${Number(j.unit_rate ?? 0).toLocaleString()} ETB per ${j.unit ?? 'unit'}` : `Fixed price ${fmtMoney(j.fixed_price ?? 0)}`}
                      {j.crew_leader ? ` · paid to ${j.crew_leader}` : ''}
                      {' · '}{vol ? `${trim(before)} ${j.unit ?? ''} measured so far${j.planned_volume ? ` of about ${trim(Number(j.planned_volume))}` : ''}` : `${trim(before)}% done so far`}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                    {vol ? 'Measured today' : 'Done now'}
                    <input type="number" inputMode="decimal" min={vol ? 0 : before} max={vol ? undefined : 100} step="any" disabled={!canEdit || j.today_paid}
                      value={j.measured} placeholder={vol ? '—' : String(trim(before))}
                      onChange={e => update(j.id, x => ({ ...x, measured: e.target.value }))}
                      className={`w-24 rounded-lg border px-2 py-1.5 text-right text-base sm:text-sm dark:bg-slate-800 dark:text-slate-100 ${bad ? 'border-red-400' : 'dark:border-slate-600'}`} />
                    <span className="w-8">{vol ? j.unit ?? '' : '%'}</span>
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {j.crew.length === 0 && <span className="text-xs text-slate-400">No crew named on this job.</span>}
                  {j.crew.map(c => {
                    const on = j.present.includes(c.staff_id)
                    return (
                      <button key={c.staff_id} type="button" disabled={!canEdit} aria-pressed={on}
                        onClick={() => update(j.id, x => ({ ...x, present: on ? x.present.filter(s => s !== c.staff_id) : [...x.present, c.staff_id] }))}
                        className={`rounded-full border px-2.5 py-1 text-xs ${on ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200' : 'text-slate-500 dark:border-slate-600'} disabled:cursor-default`}>
                        {on ? '✓ ' : ''}{c.name}
                      </button>
                    )
                  })}
                  {amount > 0 && !bad && <span className="ml-auto text-xs font-medium text-slate-600 dark:text-slate-300">{fmtMoney(amount)} today</span>}
                  {bad && <span className="ml-auto text-xs text-red-600">{vol ? 'Can\'t be negative' : `Between ${trim(before)} and 100%`}</span>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
const trim = (n: number) => Math.round(n * 100) / 100

// Someone working for the first time: the essentials to put them on the
// sheet. The rest (ID, bank) can follow on Worker details.
function NewWorkerForm({ value: w, onChange, onSave, onCancel, busy }: {
  value: NewWorker; onChange: (w: NewWorker) => void; onSave: () => void; onCancel: () => void; busy: boolean
}) {
  const { data: trades = [] } = useTrades()
  const set = (patch: Partial<NewWorker>) => onChange({ ...w, ...patch })
  const ok = w.name.trim().length > 1 && !!w.trade && Number(w.rate) > 0
  const input = 'rounded-lg border px-3 py-2 text-base sm:text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
  return (
    <div className="space-y-3 border-t bg-slate-50 px-3 py-3 dark:border-slate-700 dark:bg-slate-900/40">
      <p className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100"><UserPlus className="h-4 w-4 text-brand" /> New worker</p>
      <div className="flex flex-wrap items-center gap-2">
        <PhotoButton url={w.photo} name={w.name || 'New worker'} onPhoto={url => set({ photo: url })} />
        <input value={w.name} onChange={e => set({ name: e.target.value })} placeholder="Full name" className={`${input} min-w-[12rem] flex-1`} />
        <input value={w.phone} onChange={e => set({ phone: e.target.value })} inputMode="tel" placeholder="Phone (if they have one)" className={`${input} w-full sm:w-44`} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SearchableSelect className="min-w-[12rem] flex-1" value={w.trade || null} onChange={v => set({ trade: v ?? '' })}
          options={trades.map(t => ({ id: t.trade_tag, label: tradeName(t.trade_tag), sub: t.codename_amharic ?? undefined }))} placeholder="Trade…" />
        <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">Day rate
          <input value={w.rate} onChange={e => set({ rate: e.target.value })} inputMode="decimal" placeholder="e.g. 900" className={`${input} w-28 text-right`} />
          ETB
        </label>
      </div>
      <p className="text-[11px] text-slate-500">The day rate is your proposal: HR confirms or corrects it when they verify the worker, and their pay waits until then. A phone already on file brings back that person instead of making a new one.</p>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500">Cancel</button>
        <button onClick={onSave} disabled={!ok || busy} className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
          <Plus className="h-3.5 w-3.5" /> {busy ? 'Adding…' : 'Add to the sheet'}
        </button>
      </div>
    </div>
  )
}
