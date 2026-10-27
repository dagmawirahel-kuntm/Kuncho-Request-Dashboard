import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { addDays, dayLabel, fmtMoney, isoDay, overtimeAmount, overtimeRateLabel, useLabourSites, type OvertimeDayRates } from '@/lib/labour'
import { UpdateProgressSheet } from '@/pages/work-orders/WorkOrderParts'
import type { WorkOrder } from '@/types/database'
import { AlertTriangle, ChevronLeft, ChevronRight, ClipboardCheck, Lock, Plus, Save, HardHat, Timer, TrendingUp } from 'lucide-react'

type Row = {
  labor_requisition_id: string; role_needed: string; payment_basis: 'per_day' | 'per_volume' | 'fixed_price'; payment_model: string
  volume_unit: string | null; unit_rate: number | null; day_rate: number | null; fixed_price_amount: number | null; percent_so_far: number
  staff_id: string | null; worker_name: string; phone: string | null
  entry_id: string | null; hours: number | null; overtime_hours: number | null; quantity: number | null; percent_done: number | null; note: string | null; locked: boolean
}
type Draft = { hours: string; overtime_hours: string; night: string; agreed: string; quantity: string; percent_done: string; note: string }

const key = (r: Pick<Row, 'labor_requisition_id' | 'staff_id'>) => `${r.labor_requisition_id}:${r.staff_id ?? 'all'}`
const num = (s: string) => (s.trim() === '' ? null : Number(s))
const cell = 'w-full rounded-lg border px-2 py-2 text-center text-base sm:text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'

// One screen per site per day, grouped by the job (work order) the work is
// for: everyone on the site's approved requests, with the one number each
// needs — hours, quantity, or % of the task done — and, per job, how far it
// got today (migration 476).
export default function LabourRecordPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [params, setParams] = useSearchParams()
  const { sites, isLoading } = useLabourSites()
  const site = params.get('site') ?? (sites.length === 1 ? sites[0].id : null)
  const today = isoDay(new Date())
  const date = params.get('date') ?? today
  const setQ = (k: string, v: string | null) => setParams(p => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n }, { replace: true })

  const { data: rows = [], isLoading: loadingRows } = useQuery({
    queryKey: ['labour-day-sheet', site, date],
    enabled: !!site,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('labour_day_sheet', { p_project: site, p_date: date })
      if (error) throw error
      return (data ?? []) as Row[]
    },
  })

  // The job each request is for (migration 408): the screen is grouped by it.
  const reqIds = useMemo(() => [...new Set(rows.map(r => r.labor_requisition_id))].sort(), [rows])
  const { data: jobOf = {} } = useQuery({
    queryKey: ['labour-request-jobs', reqIds.join(',')],
    enabled: reqIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('labor_requisitions').select('id, work_orders(*)').in('id', reqIds)
      if (error) throw error
      const m: Record<string, WorkOrder> = {}
      for (const r of (data ?? []) as unknown as { id: string; work_orders: WorkOrder | null }[]) if (r.work_orders) m[r.id] = r.work_orders
      return m
    },
  })
  const woIds = useMemo(() => [...new Set(Object.values(jobOf).map(w => w.id))].sort(), [jobOf])
  // Which jobs had their progress updated that day.
  const { data: progressed = new Set<string>() } = useQuery({
    queryKey: ['labour-day-progress', woIds.join(','), date],
    enabled: woIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('wo_progress_updates').select('work_order_id')
        .in('work_order_id', woIds).gte('created_at', `${date}T00:00:00+03:00`).lt('created_at', `${addDays(date, 1)}T00:00:00+03:00`)
      if (error) throw error
      return new Set((data ?? []).map((u: { work_order_id: string }) => u.work_order_id))
    },
  })
  // Recorded somewhere else the same day — another site, another job, or over 12 hours (migration 475).
  type Clash = { staff_id: string; worker_name: string; total_hours: number; elsewhere: { project: string | null; what: string | null; hours: number }[] }
  const { data: clashes = {} } = useQuery({
    queryKey: ['labour-day-clashes', site, date],
    enabled: !!site,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('labour_day_clashes', { p_project: site, p_date: date })
      if (error) throw error
      return Object.fromEntries(((data ?? []) as Clash[]).map(c => [c.staff_id, c])) as Record<string, Clash>
    },
  })
  const [updatingWo, setUpdatingWo] = useState<WorkOrder | null>(null)

  // Overtime (migration 458): the rates in force on each request today, and
  // what each entry already holds beyond the day sheet's columns.
  const { data: otRates = {} } = useQuery({
    queryKey: ['labour-overtime-day-rates', site, date],
    enabled: !!site,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('labour_overtime_day_rates', { p_project: site, p_date: date })
      if (error) throw error
      return Object.fromEntries(((data ?? []) as OvertimeDayRates[]).map(r => [r.labor_requisition_id, r])) as Record<string, OvertimeDayRates>
    },
  })
  const entryIds = useMemo(() => rows.filter(r => r.entry_id && Number(r.overtime_hours) > 0).map(r => r.entry_id!).sort(), [rows])
  const { data: otExtra = {} } = useQuery({
    queryKey: ['labour-overtime-entries', entryIds.join(',')],
    enabled: entryIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('labour_work_entries').select('id, overtime_night_hours, overtime_agreed_amount').in('id', entryIds)
      if (error) throw error
      return Object.fromEntries(((data ?? []) as { id: string; overtime_night_hours: number; overtime_agreed_amount: number | null }[]).map(e => [e.id, e]))
    },
  })
  const dayKind = Object.values(otRates).find(r => r.day_kind !== 'working_day')

  const [drafts, setDrafts] = useState<Record<string, Record<string, Draft>>>({})
  const sheetKey = `${site}|${date}`
  const draftOf = (r: Row): Draft => drafts[sheetKey]?.[key(r)] ?? {
    hours: r.hours != null ? String(Number(r.hours)) : '',
    overtime_hours: r.overtime_hours ? String(Number(r.overtime_hours)) : '',
    night: r.entry_id && Number(otExtra[r.entry_id]?.overtime_night_hours) ? String(Number(otExtra[r.entry_id].overtime_night_hours)) : '',
    agreed: r.entry_id && otExtra[r.entry_id]?.overtime_agreed_amount != null ? String(Number(otExtra[r.entry_id].overtime_agreed_amount)) : '',
    quantity: r.quantity != null ? String(Number(r.quantity)) : '',
    percent_done: r.percent_done != null ? String(Number(r.percent_done)) : '',
    note: r.note ?? '',
  }
  const set = (r: Row, patch: Partial<Draft>) =>
    setDrafts(d => ({ ...d, [sheetKey]: { ...(d[sheetKey] ?? {}), [key(r)]: { ...draftOf(r), ...patch } } }))
  const changed = Object.keys(drafts[sheetKey] ?? {}).length
  const [saving, setSaving] = useState(false)

  // Job → its labour requests → their people. Requests not linked to a job come last.
  const groups = useMemo(() => {
    const m = new Map<string, { wo: WorkOrder | null; reqs: Map<string, Row[]> }>()
    for (const r of rows) {
      const wo = jobOf[r.labor_requisition_id] ?? null
      const k = wo?.id ?? 'none'
      if (!m.has(k)) m.set(k, { wo, reqs: new Map() })
      const g = m.get(k)!
      g.reqs.set(r.labor_requisition_id, [...(g.reqs.get(r.labor_requisition_id) ?? []), r])
    }
    return [...m.entries()].sort(([a], [b]) => (a === 'none' ? 1 : 0) - (b === 'none' ? 1 : 0)).map(([k, g]) => ({ key: k, wo: g.wo, reqs: [...g.reqs.values()] }))
  }, [rows, jobOf])
  const worked = (r: Row) => { const d = draftOf(r); return (num(d.hours) ?? 0) > 0 || (num(d.overtime_hours) ?? 0) > 0 || (num(d.quantity) ?? 0) > 0 || (num(d.percent_done) ?? 0) > 0 }
  // The same person on more than one job here today, or over 12 hours, as typed.
  const onSheet = new Map<string, { jobs: Set<string>; hours: number }>()
  for (const g of groups) for (const rs of g.reqs) for (const r of rs) {
    if (!r.staff_id || !worked(r)) continue
    const d = draftOf(r)
    const x = onSheet.get(r.staff_id) ?? { jobs: new Set<string>(), hours: 0 }
    x.jobs.add(g.key); x.hours += (num(d.hours) ?? 0) + (num(d.overtime_hours) ?? 0)
    onSheet.set(r.staff_id, x)
  }
  const doubled = (r: Row) => { const x = r.staff_id ? onSheet.get(r.staff_id) : null; return !!x && (x.jobs.size > 1 || x.hours > 12) }

  const dayCost = rows.reduce((sum, r) => {
    const d = draftOf(r)
    if (r.payment_basis === 'per_day') return sum + (num(d.hours) ?? 0) / 8 * (r.day_rate ?? 0) + otOf(r, d)
    if (r.payment_basis === 'per_volume') return sum + (num(d.quantity) ?? 0) * (r.unit_rate ?? 0)
    return sum + (num(d.percent_done) ?? 0) / 100 * (r.fixed_price_amount ?? 0)
  }, 0)
  function otOf(r: Row, d: Draft) {
    return overtimeAmount(otRates[r.labor_requisition_id], Number(r.day_rate ?? 0), num(d.overtime_hours) ?? 0, num(d.night) ?? 0, num(d.agreed))
  }
  const recorded = rows.filter(r => { const d = draftOf(r); return (num(d.hours) ?? 0) > 0 || (num(d.quantity) ?? 0) > 0 || (num(d.percent_done) ?? 0) > 0 }).length

  async function save() {
    const touched = rows.filter(r => drafts[sheetKey]?.[key(r)] && !r.locked)
    if (!touched.length) return
    const bad = touched.find(r => { const d = draftOf(r); const h = num(d.hours); return h != null && (h < 0 || h > 24) })
    if (bad) { toast(`Hours for ${bad.worker_name} must be between 0 and 24`, 'error'); return }
    const badNight = touched.find(r => { const d = draftOf(r); return (num(d.night) ?? 0) > (num(d.overtime_hours) ?? 0) })
    if (badNight) { toast(`${badNight.worker_name}: hours after 10 pm can't be more than the overtime hours`, 'error'); return }
    const twice = [...new Set(touched.filter(doubled).map(r => r.worker_name))]
    if (twice.length && !confirm(`${twice.join(', ')} ${twice.length === 1 ? 'is' : 'are'} recorded on more than one job today, or for more than 12 hours. Save anyway?`)) return
    setSaving(true)
    const { error } = await supabase.rpc('record_labour_day', {
      p_project: site, p_date: date,
      p_entries: touched.map(r => {
        const d = draftOf(r)
        return { req: r.labor_requisition_id, staff: r.staff_id, hours: num(d.hours), overtime_hours: num(d.overtime_hours) ?? 0,
          overtime_night_hours: num(d.night) ?? 0, overtime_amount: num(d.agreed),
          quantity: num(d.quantity), percent_done: num(d.percent_done), note: d.note }
      }),
    })
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    setDrafts(d => { const n = { ...d }; delete n[sheetKey]; return n })
    qc.invalidateQueries({ queryKey: ['labour-day-sheet', site, date] })
    qc.invalidateQueries({ queryKey: ['labour-unpaid'] })
    qc.invalidateQueries({ queryKey: ['labour-overtime-entries'] })
    qc.invalidateQueries({ queryKey: ['labour-day-clashes', site, date] })
    qc.invalidateQueries({ queryKey: ['labour-request-jobs'] })
    toast(`Saved ${dayLabel(date)}`, 'success')
  }

  return (
    <div className="mx-auto max-w-2xl pb-28">
      <div className="mb-4">
        <h1 className="flex items-center gap-2 text-lg font-bold text-slate-800 dark:text-slate-100"><ClipboardCheck className="h-5 w-5 text-brand" /> Record work</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Job by job: hours for day workers (8 is a full day), quantity for work by the unit, % done for fixed-price tasks — then how far the job got.</p>
        <Link to={`/labour/record/week${site ? `?site=${site}` : ''}`} className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-brand">Catching up from the paper sheet? Record the whole week →</Link>
      </div>

      <div className="mb-4 space-y-2 rounded-2xl border bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
        {isLoading ? <p className="text-sm text-slate-400">Loading…</p>
          : sites.length === 0 ? <p className="text-sm text-amber-600">You aren't the manager or foreman of any site yet.</p>
          : sites.length > 1 && <SearchableSelect value={site} onChange={v => setQ('site', v)} options={sites.map(s => ({ id: s.id, label: s.project_name }))} placeholder="Choose the site…" />}
        <div className="flex items-center gap-2">
          <button onClick={() => setQ('date', addDays(date, -1))} className="rounded-lg border p-2.5 dark:border-slate-600" aria-label="Day before"><ChevronLeft className="h-4 w-4" /></button>
          <label className="relative flex-1">
            <span className="block rounded-lg border px-3 py-2 text-center text-sm font-semibold dark:border-slate-600">{date === today ? `Today · ${dayLabel(date)}` : dayLabel(date)}</span>
            <input type="date" max={today} value={date} onChange={e => setQ('date', e.target.value || today)} className="absolute inset-0 opacity-0" aria-label="Pick a day" />
          </label>
          <button onClick={() => setQ('date', addDays(date, 1))} disabled={date >= today} className="rounded-lg border p-2.5 disabled:opacity-30 dark:border-slate-600" aria-label="Next day"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>

      {site && dayKind && (
        <p className="mb-3 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          <Timer className="h-4 w-4 shrink-0" />
          {dayKind.day_kind === 'holiday' ? `${dayKind.holiday_name ?? 'A public holiday'}` : 'The weekly rest day'} — overtime at the {dayKind.day_kind === 'holiday' ? 'holiday' : 'rest-day'} rate where the company rates apply.
        </p>
      )}

      {!site ? null : loadingRows ? <p className="py-10 text-center text-sm text-slate-400">Loading…</p> : groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-8 text-center dark:border-slate-600">
          <HardHat className="mx-auto mb-2 h-8 w-8 text-slate-300" />
          <p className="text-sm text-slate-500">No approved labour on this site for {dayLabel(date)}.</p>
          <Link to={`/labour/new?project=${site}`} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4" /> Ask for labour</Link>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(g => {
            const pct = Math.round(Number(g.wo?.current_progress_pct ?? 0))
            const workedHere = g.reqs.some(rs => rs.some(worked))
            const needsProgress = !!g.wo && workedHere && !progressed.has(g.wo.id) && g.wo.status !== 'completed' && g.wo.status !== 'cancelled'
            return (
              <section key={g.key} className="overflow-hidden rounded-2xl border bg-white dark:border-slate-700 dark:bg-slate-800">
                {g.wo ? (
                  <div className="border-b bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/40">
                    <div className="flex items-start justify-between gap-2">
                      <Link to={`/work-orders/${g.wo.id}`} className="min-w-0">
                        <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Work order</span>
                        <span className="block font-semibold text-slate-800 dark:text-slate-100">{g.wo.title || (g.wo.scope_of_work ?? 'Work order').slice(0, 60)}</span>
                      </Link>
                      <button type="button" onClick={() => setUpdatingWo(g.wo)}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg border bg-white px-2.5 py-1.5 text-xs font-medium dark:border-slate-600 dark:bg-slate-800">
                        <TrendingUp className="h-3.5 w-3.5" /> Update progress
                      </button>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(pct, 100)}%` }} /></div>
                      <span className="text-xs tabular-nums text-slate-500">{pct}% done</span>
                    </div>
                    {needsProgress && (
                      <button type="button" onClick={() => setUpdatingWo(g.wo)} className="mt-2 w-full rounded-lg bg-amber-50 px-3 py-2 text-left text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                        Worked on today — <b>how far did this job get?</b> Tap to update its progress.
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="border-b bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-slate-700 dark:bg-amber-900/10 dark:text-amber-200">
                    <b>Not linked to a work order</b>
                    <span className="block text-xs">Open each request and link it to its job, so this work counts where it was done.</span>
                  </div>
                )}
                {g.reqs.map(rs => {
                  const r0 = rs[0]
                  return (
                    <div key={r0.labor_requisition_id}>
                      <Link to={`/labour/${r0.labor_requisition_id}`} className="flex items-baseline justify-between gap-2 border-b px-4 py-2 text-xs dark:border-slate-700">
                        <span className="font-semibold text-slate-600 dark:text-slate-300">{r0.role_needed}</span>
                        <span className="text-slate-500">
                          {r0.payment_basis === 'per_day' ? 'hours · 8 = a day' : r0.payment_basis === 'per_volume' ? `${r0.volume_unit ?? 'units'} done today` : `${Number(r0.percent_so_far)}% done before today`}
                        </span>
                      </Link>
                      <ul className="divide-y border-b dark:divide-slate-700 dark:border-slate-700">
                        {rs.map(r => {
                    const d = draftOf(r)
                    const h = num(d.hours)
                    const clash = r.staff_id ? clashes[r.staff_id] : undefined
                    return (
                      <li key={key(r)} className={`px-4 py-3 ${r.locked ? 'opacity-60' : ''}`}>
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{r.worker_name}</p>
                          {r.locked && <span className="flex items-center gap-1 text-[11px] text-slate-500"><Lock className="h-3 w-3" /> on a pay sheet</span>}
                        </div>
                        {(doubled(r) || clash) && (
                          <p className="mb-2 flex items-start gap-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-300">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span>{clash
                              ? <>Also recorded today: {clash.elsewhere.map(e => `${e.what ?? 'labour'}${e.project ? ` (${e.project})` : ''} ${Number(e.hours)} h`).join(' · ')} — {Number(clash.total_hours)} h in all. Is this the same person?</>
                              : 'Also on another job here today, or over 12 hours. Check it is the right person.'}</span>
                          </p>
                        )}
                        {r.payment_basis === 'per_day' ? (
                          <div className="space-y-2">
                            <div className="grid grid-cols-4 gap-1.5">
                              {([['Absent', ''], ['Half', '4'], ['Full', '8']] as [string, string][]).map(([l, v]) => (
                                <button key={l} type="button" disabled={r.locked} onClick={() => set(r, { hours: v })}
                                  className={`rounded-lg border py-2 text-sm font-medium ${(v === '' ? !h : h === Number(v)) ? (v === '' ? 'border-slate-400 bg-slate-100 dark:bg-slate-700' : 'border-brand bg-brand text-white') : 'dark:border-slate-600'}`}>{l}</button>
                              ))}
                              <input className={cell} inputMode="decimal" disabled={r.locked} value={d.hours} onChange={e => set(r, { hours: e.target.value })} placeholder="hrs" aria-label="Hours" />
                            </div>
                            <details className="text-xs text-slate-500" open={!!num(d.overtime_hours)}>
                              <summary className="cursor-pointer select-none">Overtime{num(d.overtime_hours) ? `: ${d.overtime_hours} h · ${fmtMoney(otOf(r, d))}` : ''}</summary>
                              <div className="mt-1 grid grid-cols-3 gap-1.5">
                                <label>Hours
                                  <input className={cell} inputMode="decimal" disabled={r.locked} value={d.overtime_hours} onChange={e => set(r, { overtime_hours: e.target.value })} placeholder="0" /></label>
                                <label>After 10 pm
                                  <input className={cell} inputMode="decimal" disabled={r.locked || !num(d.overtime_hours)} value={d.night} onChange={e => set(r, { night: e.target.value })} placeholder="0" /></label>
                                <label>Agreed amount
                                  <input className={cell} inputMode="decimal" disabled={r.locked || !num(d.overtime_hours)} value={d.agreed} onChange={e => set(r, { agreed: e.target.value })} placeholder="—" /></label>
                              </div>
                              <p className="mt-1">{num(d.agreed) != null ? 'Agreed amount — replaces the rate for this day' : overtimeRateLabel(otRates[r.labor_requisition_id])}</p>
                            </details>
                          </div>
                        ) : r.payment_basis === 'per_volume' ? (
                          <div className="flex items-center gap-2">
                            <input className={`${cell} w-32`} inputMode="decimal" disabled={r.locked} value={d.quantity} onChange={e => set(r, { quantity: e.target.value })} placeholder="0" />
                            <span className="text-sm text-slate-500">{r.volume_unit ?? 'units'} × {fmtMoney(r.unit_rate)}</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <input className={`${cell} w-24`} inputMode="decimal" disabled={r.locked} value={d.percent_done} onChange={e => set(r, { percent_done: e.target.value })} placeholder="0" />
                            <span className="text-sm text-slate-500">% more done today (at most {Math.max(100 - Number(r.percent_so_far), 0)}%)</span>
                          </div>
                        )}
                        <input className="mt-2 w-full rounded-lg border-0 bg-transparent px-0 py-1 text-xs text-slate-500 outline-none placeholder:text-slate-300 dark:placeholder:text-slate-600" disabled={r.locked}
                          value={d.note} onChange={e => set(r, { note: e.target.value })} placeholder="Note (optional)" />
                      </li>
                    )
                  })}
                      </ul>
                    </div>
                  )
                })}
              </section>
            )
          })}
          <p className="text-center text-xs text-slate-400">Someone missing? Add them on the request, then record them here.</p>
        </div>
      )}

      {updatingWo && <UpdateProgressSheet wo={updatingWo} onClose={() => {
        setUpdatingWo(null)
        qc.invalidateQueries({ queryKey: ['labour-day-progress'] })
        qc.invalidateQueries({ queryKey: ['labour-request-jobs'] })
      }} />}

      {groups.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-white/95 p-3 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
          <div className="mx-auto flex max-w-2xl items-center gap-3">
            <div className="min-w-0 flex-1 text-xs text-slate-500">
              <b className="text-slate-700 dark:text-slate-200">{recorded}</b> recorded · about <b className="text-slate-700 dark:text-slate-200">{fmtMoney(dayCost)}</b>
              {changed > 0 && <span className="block text-amber-600">{changed} change{changed === 1 ? '' : 's'} not saved</span>}
            </div>
            <button onClick={save} disabled={!changed || saving} className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white shadow disabled:opacity-40">
              <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save day'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
