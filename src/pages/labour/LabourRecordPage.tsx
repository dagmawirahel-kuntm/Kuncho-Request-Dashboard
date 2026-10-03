import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { addDays, dayLabel, fmtMoney, isoDay, useLabourSites } from '@/lib/labour'
import { ChevronLeft, ChevronRight, ClipboardCheck, Lock, Plus, Save, HardHat } from 'lucide-react'

type Row = {
  labor_requisition_id: string; role_needed: string; payment_basis: 'per_day' | 'per_volume' | 'fixed_price'; payment_model: string
  volume_unit: string | null; unit_rate: number | null; day_rate: number | null; fixed_price_amount: number | null; percent_so_far: number
  staff_id: string | null; worker_name: string; phone: string | null
  entry_id: string | null; hours: number | null; overtime_hours: number | null; quantity: number | null; percent_done: number | null; note: string | null; locked: boolean
}
type Draft = { hours: string; overtime_hours: string; quantity: string; percent_done: string; note: string }

const key = (r: Pick<Row, 'labor_requisition_id' | 'staff_id'>) => `${r.labor_requisition_id}:${r.staff_id ?? 'all'}`
const num = (s: string) => (s.trim() === '' ? null : Number(s))
const cell = 'w-full rounded-lg border px-2 py-2 text-center text-base sm:text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'

// One screen per site per day: everyone on the site's approved requests,
// with the one number each needs — hours, quantity, or % of the task done.
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

  // Which job each request is for, shown on its group (migration 408).
  const reqIds = useMemo(() => [...new Set(rows.map(r => r.labor_requisition_id))].sort(), [rows])
  const { data: jobOf = {} } = useQuery({
    queryKey: ['labour-request-jobs', reqIds.join(',')],
    enabled: reqIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('labor_requisitions').select('id, work_orders(id, title, scope_of_work)').in('id', reqIds)
      if (error) throw error
      const m: Record<string, { id: string; label: string }> = {}
      for (const r of (data ?? []) as unknown as { id: string; work_orders: { id: string; title: string | null; scope_of_work: string | null } | null }[]) {
        if (r.work_orders) m[r.id] = { id: r.work_orders.id, label: r.work_orders.title || (r.work_orders.scope_of_work ?? 'Work order').slice(0, 50) }
      }
      return m
    },
  })

  const [drafts, setDrafts] = useState<Record<string, Record<string, Draft>>>({})
  const sheetKey = `${site}|${date}`
  const draftOf = (r: Row): Draft => drafts[sheetKey]?.[key(r)] ?? {
    hours: r.hours != null ? String(Number(r.hours)) : '',
    overtime_hours: r.overtime_hours ? String(Number(r.overtime_hours)) : '',
    quantity: r.quantity != null ? String(Number(r.quantity)) : '',
    percent_done: r.percent_done != null ? String(Number(r.percent_done)) : '',
    note: r.note ?? '',
  }
  const set = (r: Row, patch: Partial<Draft>) =>
    setDrafts(d => ({ ...d, [sheetKey]: { ...(d[sheetKey] ?? {}), [key(r)]: { ...draftOf(r), ...patch } } }))
  const changed = Object.keys(drafts[sheetKey] ?? {}).length
  const [saving, setSaving] = useState(false)

  const groups = useMemo(() => {
    const m = new Map<string, Row[]>()
    for (const r of rows) m.set(r.labor_requisition_id, [...(m.get(r.labor_requisition_id) ?? []), r])
    return [...m.values()]
  }, [rows])

  const dayCost = rows.reduce((sum, r) => {
    const d = draftOf(r)
    if (r.payment_basis === 'per_day') return sum + ((num(d.hours) ?? 0) / 8 + (num(d.overtime_hours) ?? 0) / 8 * 1.5) * (r.day_rate ?? 0)
    if (r.payment_basis === 'per_volume') return sum + (num(d.quantity) ?? 0) * (r.unit_rate ?? 0)
    return sum + (num(d.percent_done) ?? 0) / 100 * (r.fixed_price_amount ?? 0)
  }, 0)
  const recorded = rows.filter(r => { const d = draftOf(r); return (num(d.hours) ?? 0) > 0 || (num(d.quantity) ?? 0) > 0 || (num(d.percent_done) ?? 0) > 0 }).length

  async function save() {
    const touched = rows.filter(r => drafts[sheetKey]?.[key(r)] && !r.locked)
    if (!touched.length) return
    const bad = touched.find(r => { const d = draftOf(r); const h = num(d.hours); return h != null && (h < 0 || h > 24) })
    if (bad) { toast(`Hours for ${bad.worker_name} must be between 0 and 24`, 'error'); return }
    setSaving(true)
    const { error } = await supabase.rpc('record_labour_day', {
      p_project: site, p_date: date,
      p_entries: touched.map(r => {
        const d = draftOf(r)
        return { req: r.labor_requisition_id, staff: r.staff_id, hours: num(d.hours), overtime_hours: num(d.overtime_hours) ?? 0,
          quantity: num(d.quantity), percent_done: num(d.percent_done), note: d.note }
      }),
    })
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    setDrafts(d => { const n = { ...d }; delete n[sheetKey]; return n })
    qc.invalidateQueries({ queryKey: ['labour-day-sheet', site, date] })
    qc.invalidateQueries({ queryKey: ['labour-unpaid'] })
    toast(`Saved ${dayLabel(date)}`, 'success')
  }

  return (
    <div className="mx-auto max-w-2xl pb-28">
      <div className="mb-4">
        <h1 className="flex items-center gap-2 text-lg font-bold text-slate-800 dark:text-slate-100"><ClipboardCheck className="h-5 w-5 text-brand" /> Record work</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Hours for day workers (8 is a full day), quantity for work by the unit, % done for fixed-price tasks.</p>
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

      {!site ? null : loadingRows ? <p className="py-10 text-center text-sm text-slate-400">Loading…</p> : groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-8 text-center dark:border-slate-600">
          <HardHat className="mx-auto mb-2 h-8 w-8 text-slate-300" />
          <p className="text-sm text-slate-500">No approved labour on this site for {dayLabel(date)}.</p>
          <Link to={`/labour/new?project=${site}`} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4" /> Ask for labour</Link>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(g => {
            const r0 = g[0]
            return (
              <section key={r0.labor_requisition_id} className="overflow-hidden rounded-2xl border bg-white dark:border-slate-700 dark:bg-slate-800">
                <Link to={`/labour/${r0.labor_requisition_id}`} className="flex items-baseline justify-between gap-2 border-b bg-slate-50 px-4 py-2.5 dark:border-slate-700 dark:bg-slate-900/40">
                  <span className="min-w-0">
                    <span className="font-semibold text-slate-800 dark:text-slate-100">{r0.role_needed}</span>
                    {jobOf[r0.labor_requisition_id] && <span className="block truncate text-xs font-normal text-slate-500">for {jobOf[r0.labor_requisition_id].label}</span>}
                  </span>
                  <span className="text-xs text-slate-500">
                    {r0.payment_basis === 'per_day' ? 'hours · 8 = a day' : r0.payment_basis === 'per_volume' ? `${r0.volume_unit ?? 'units'} done today` : `${Number(r0.percent_so_far)}% done before today`}
                  </span>
                </Link>
                <ul className="divide-y dark:divide-slate-700">
                  {g.map(r => {
                    const d = draftOf(r)
                    const h = num(d.hours)
                    return (
                      <li key={key(r)} className={`px-4 py-3 ${r.locked ? 'opacity-60' : ''}`}>
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{r.worker_name}</p>
                          {r.locked && <span className="flex items-center gap-1 text-[11px] text-slate-500"><Lock className="h-3 w-3" /> on a pay sheet</span>}
                        </div>
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
                              <summary className="cursor-pointer select-none">Overtime{num(d.overtime_hours) ? `: ${d.overtime_hours} h` : ''}</summary>
                              <input className={`${cell} mt-1 w-28`} inputMode="decimal" disabled={r.locked} value={d.overtime_hours} onChange={e => set(r, { overtime_hours: e.target.value })} placeholder="hours" />
                              <span className="ml-2">paid at 1.5×</span>
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
              </section>
            )
          })}
          <p className="text-center text-xs text-slate-400">Someone missing? Add them on the request, then record them here.</p>
        </div>
      )}

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
