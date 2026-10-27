import { useState, type KeyboardEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { WeekNav } from '@/components/projects/WeekParts'
import { addDays, fmtMoney, isoDay, useLabourSites } from '@/lib/labour'
import { mondayOf, thisMonday } from '@/lib/weekSummary'
import { CalendarDays, ClipboardCheck, Copy, Lock, Save, Timer } from 'lucide-react'

type Basis = 'per_day' | 'per_volume' | 'fixed_price'
type SheetRow = {
  labor_requisition_id: string; role_needed: string; payment_basis: Basis; volume_unit: string | null
  unit_rate: number | null; day_rate: number | null; fixed_price_amount: number | null
  staff_id: string | null; worker_name: string
  entry_id: string | null; hours: number | null; overtime_hours: number | null; quantity: number | null; percent_done: number | null; note: string | null; locked: boolean
}
type Extra = { labor_requisition_id: string; staff_id: string | null; work_date: string; overtime_night_hours: number | null; overtime_agreed_amount: number | null }
type Line = { key: string; req: string; staff: string | null; name: string; role: string; basis: Basis; unit: string | null; rate: number; days: Record<string, SheetRow> }

const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const lineKey = (r: Pick<SheetRow, 'labor_requisition_id' | 'staff_id'>) => `${r.labor_requisition_id}:${r.staff_id ?? 'all'}`
const valueOf = (r: SheetRow) => {
  const v = r.payment_basis === 'per_day' ? r.hours : r.payment_basis === 'per_volume' ? r.quantity : r.percent_done
  return v != null && Number(v) !== 0 ? String(Number(v)) : ''
}
const num = (s: string) => (s.trim() === '' ? null : Number(s))

// Recording from the paper attendance sheet, a week at a time (480): one
// site, its workers down the side, the days across, one number a cell —
// hours for day workers, quantity for unit work, % for a fixed-price task.
// Most of the work is the same as the day before, so filling is one tap:
// a worker's whole week, a whole day, or a copy of the day before.
// Overtime and notes already recorded are kept as they are; change them
// on the day page.
export default function LabourWeekPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [params, setParams] = useSearchParams()
  const { sites, isLoading: loadingSites } = useLabourSites()
  const today = isoDay(new Date())
  const from = mondayOf(params.get('week') ?? thisMonday())
  const setQ = (k: string, v: string | null) => setParams(p => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n }, { replace: true })

  // Sites with approved labour, and how many days of this week each has recorded.
  const { data: busy } = useQuery({
    queryKey: ['labour-week-sites', from],
    enabled: sites.length > 0,
    queryFn: async () => {
      const [{ data: reqs, error: e1 }, { data: done, error: e2 }] = await Promise.all([
        supabase.from('labor_requisitions').select('project_id').eq('status', 'approved').is('closed_at', null),
        supabase.from('labour_work_entries').select('project_id, work_date').gte('work_date', from).lte('work_date', addDays(from, 6)),
      ])
      if (e1 || e2) throw e1 ?? e2
      const days: Record<string, Set<string>> = {}
      for (const d of (done ?? []) as { project_id: string; work_date: string }[]) (days[d.project_id] ??= new Set()).add(d.work_date)
      return { open: new Set((reqs ?? []).map((r: { project_id: string }) => r.project_id)), days }
    },
  })
  const activeSites = sites.filter(s => busy?.open.has(s.id))
  const site = params.get('site') ?? (activeSites.length === 1 ? activeSites[0].id : sites.length === 1 ? sites[0].id : null)

  const dates = Array.from({ length: 7 }, (_, i) => addDays(from, i))
  const shown = dates.filter(d => d <= today)
  // The Saturday before too, so Monday can copy it (Sunday is the rest day).
  const loadDates = [addDays(from, -2), ...shown]
  const sheets = useQueries({
    queries: loadDates.map(d => ({
      queryKey: ['labour-day-sheet', site, d],
      enabled: !!site,
      queryFn: async () => {
        const { data, error } = await supabase.rpc('labour_day_sheet', { p_project: site, p_date: d })
        if (error) throw error
        return (data ?? []) as SheetRow[]
      },
    })),
  })
  const loading = sheets.some(s => s.isLoading)
  const { data: extras = {} } = useQuery({
    queryKey: ['labour-week-extras', site, from],
    enabled: !!site,
    queryFn: async () => {
      const { data, error } = await supabase.from('labour_work_entries')
        .select('labor_requisition_id, staff_id, work_date, overtime_night_hours, overtime_agreed_amount')
        .eq('project_id', site).gte('work_date', from).lte('work_date', addDays(from, 6))
      if (error) throw error
      return Object.fromEntries(((data ?? []) as Extra[]).map(x => [`${lineKey(x)}|${x.work_date}`, x])) as Record<string, Extra>
    },
  })

  // One line per worker per request, with that day's row where they were on the sheet.
  const m = new Map<string, Line>()
  const before: Record<string, string> = {}
  loadDates.forEach((d, i) => {
    for (const r of sheets[i]?.data ?? []) {
      if (i === 0) { before[lineKey(r)] = valueOf(r); continue }
      const k = lineKey(r)
      if (!m.has(k)) m.set(k, {
        key: k, req: r.labor_requisition_id, staff: r.staff_id, name: r.worker_name, role: r.role_needed, basis: r.payment_basis, unit: r.volume_unit,
        rate: Number(r.payment_basis === 'per_day' ? r.day_rate : r.payment_basis === 'per_volume' ? r.unit_rate : r.fixed_price_amount) || 0, days: {},
      })
      m.get(k)!.days[d] = r
    }
  })
  const lines = [...m.values()].sort((a, b) => a.role.localeCompare(b.role) || a.req.localeCompare(b.req) || a.name.localeCompare(b.name))

  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const sheetKey = `${site}|${from}`
  const cellKey = (l: Line, d: string) => `${sheetKey}|${l.key}|${d}`
  const saved = (l: Line, d: string) => (l.days[d] ? valueOf(l.days[d]) : '')
  const val = (l: Line, d: string) => drafts[cellKey(l, d)] ?? saved(l, d)
  const open = (l: Line, d: string) => !!l.days[d] && !l.days[d].locked
  const setCell = (l: Line, d: string, v: string) => setDrafts(x => {
    const n = { ...x }
    if (v === saved(l, d)) delete n[cellKey(l, d)]; else n[cellKey(l, d)] = v
    return n
  })
  const fill = (cells: [Line, string, string][]) => setDrafts(x => {
    const n = { ...x }
    for (const [l, d, v] of cells) { if (v === saved(l, d)) delete n[cellKey(l, d)]; else n[cellKey(l, d)] = v }
    return n
  })
  const changes = Object.keys(drafts).filter(k => k.startsWith(`${sheetKey}|`))

  // Quick fills — only into open, empty cells, so nothing typed is overwritten.
  const fullWeek = (l: Line) => fill(shown.filter(d => d !== addDays(from, 6) && open(l, d) && !val(l, d)).map(d => [l, d, '8']))
  const fullDay = (d: string) => fill(lines.filter(l => l.basis === 'per_day' && open(l, d) && !val(l, d)).map(l => [l, d, '8']))
  const copyDay = (d: string) => {
    // The working day before: Monday copies Saturday.
    const p = addDays(d, d === from ? -2 : -1)
    fill(lines.filter(l => l.basis === 'per_day' && open(l, d) && !val(l, d)).map(l => [l, d, p < from ? (before[l.key] ?? '') : val(l, p)] as [Line, string, string]).filter(c => c[2]))
  }

  // Arrow keys and Enter move between cells, like a spreadsheet.
  function move(e: KeyboardEvent<HTMLInputElement>, row: number, col: number) {
    const step: Record<string, [number, number]> = { ArrowDown: [1, 0], Enter: [1, 0], ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowLeft: [0, -1] }
    const s = step[e.key]
    if (!s) return
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && e.currentTarget.value && e.currentTarget.selectionStart !== (e.key === 'ArrowRight' ? e.currentTarget.value.length : 0)) return
    e.preventDefault()
    for (let r = row + s[0], c = col + s[1]; r >= 0 && r < lines.length && c >= 0 && c < dates.length; r += s[0], c += s[1]) {
      const next = document.querySelector<HTMLInputElement>(`input[data-cell="${r}-${c}"]:not(:disabled)`)
      if (next) { next.focus(); next.select(); return }
    }
  }

  const [saving, setSaving] = useState(false)
  async function save() {
    const byDate = new Map<string, object[]>()
    for (const l of lines) for (const d of shown) {
      const k = cellKey(l, d)
      if (!(k in drafts) || !open(l, d)) continue
      const v = num(drafts[k])
      if (v != null && (Number.isNaN(v) || v < 0 || (l.basis === 'per_day' && v > 24) || (l.basis === 'fixed_price' && v > 100))) {
        toast(`${l.name}, ${DAY[dates.indexOf(d)]}: “${drafts[k]}” isn't a valid ${l.basis === 'per_day' ? 'number of hours' : l.basis === 'per_volume' ? 'quantity' : 'percentage'}`, 'error'); return
      }
      const r = l.days[d]
      const x = extras[`${l.key}|${d}`]
      // Overtime, night hours, an agreed amount and the note stay as recorded.
      byDate.set(d, [...(byDate.get(d) ?? []), {
        req: l.req, staff: l.staff,
        hours: l.basis === 'per_day' ? v : null, quantity: l.basis === 'per_volume' ? v : null, percent_done: l.basis === 'fixed_price' ? v : null,
        overtime_hours: Number(r.overtime_hours ?? 0), overtime_night_hours: Number(x?.overtime_night_hours ?? 0),
        overtime_amount: x?.overtime_agreed_amount ?? null, note: r.note ?? '',
      }])
    }
    if (byDate.size === 0) return
    setSaving(true)
    const failed: string[] = []
    for (const [d, entries] of byDate) {
      const { error } = await supabase.rpc('record_labour_day', { p_project: site, p_date: d, p_entries: entries })
      if (error) failed.push(`${DAY[dates.indexOf(d)]}: ${error.message}`)
      else setDrafts(x => Object.fromEntries(Object.entries(x).filter(([k]) => !(k.startsWith(`${sheetKey}|`) && k.endsWith(`|${d}`)))))
      qc.invalidateQueries({ queryKey: ['labour-day-sheet', site, d] })
    }
    setSaving(false)
    qc.invalidateQueries({ queryKey: ['labour-week-extras', site, from] })
    qc.invalidateQueries({ queryKey: ['labour-week-sites', from] })
    qc.invalidateQueries({ queryKey: ['labour-unpaid'] })
    if (failed.length) toast(failed.join(' · '), 'error')
    else toast(`Saved ${byDate.size} day${byDate.size === 1 ? '' : 's'}`, 'success')
  }

  const dayTotal = (d: string) => lines.filter(l => l.basis === 'per_day' && (num(val(l, d)) ?? 0) > 0).length
  const weekCost = lines.reduce((s, l) => s + shown.reduce((t, d) => {
    const v = num(val(l, d)) ?? 0
    return t + (l.basis === 'per_day' ? v / 8 * l.rate : l.basis === 'per_volume' ? v * l.rate : v / 100 * l.rate)
  }, 0), 0)
  const hasOt = lines.some(l => shown.some(d => Number(l.days[d]?.overtime_hours ?? 0) > 0))

  return (
    <div className="mx-auto max-w-5xl pb-28">
      <div className="mb-4">
        <h1 className="flex items-center gap-2 text-lg font-bold text-slate-800 dark:text-slate-100"><CalendarDays className="h-5 w-5 text-brand" /> Record the week</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Copy the paper attendance sheet in one go: one row per worker, one box per day. Hours for day workers (8 is a full day), quantity for unit work, % for fixed-price tasks.
          {' '}<Link to={`/labour/record${site ? `?site=${site}` : ''}`} className="text-brand">One day at a time, with overtime →</Link>
        </p>
      </div>

      <div className="mb-3 space-y-2 rounded-2xl border bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
        {loadingSites ? <p className="text-sm text-slate-400">Loading…</p>
          : sites.length === 0 ? <p className="text-sm text-amber-600">You aren't the manager or foreman of any site yet.</p>
          : sites.length > 1 && <SearchableSelect value={site} onChange={v => setQ('site', v)} options={sites.map(s => ({ id: s.id, label: s.project_name }))} placeholder="Choose the site…" />}
        <WeekNav from={from} onChange={w => setQ('week', w === thisMonday() ? null : w)} />
        {activeSites.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {activeSites.map(s => {
              const n = busy?.days[s.id]?.size ?? 0
              const want = shown.filter(d => d !== addDays(from, 6)).length
              return (
                <button key={s.id} onClick={() => setQ('site', s.id)}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium ${s.id === site ? 'border-brand bg-brand text-white' : n >= want ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-300' : 'dark:border-slate-600'}`}>
                  {s.project_name} · {n}/{want}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {!site ? null : loading ? <p className="py-10 text-center text-sm text-slate-400">Loading…</p> : lines.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-slate-500 dark:border-slate-600">No approved labour on this site this week.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-white dark:border-slate-700 dark:bg-slate-800">
          <table className="w-full min-w-[600px] border-collapse text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/40">
                <th className="sticky left-0 z-10 w-32 bg-slate-50 px-3 py-2 text-left sm:w-44 font-semibold dark:bg-slate-900">Worker</th>
                {dates.map((d, i) => (
                  <th key={d} className={`w-[11%] px-1 py-2 text-center font-semibold ${d === today ? 'text-brand' : d > today ? 'text-slate-300 dark:text-slate-600' : ''}`}>
                    <div>{DAY[i]} {Number(d.slice(8))}</div>
                    {d <= today && <div className="mt-1 flex justify-center gap-0.5">
                      <button onClick={() => fullDay(d)} title="Everyone 8 hours this day" className="rounded border px-1 text-[10px] font-medium hover:bg-white dark:border-slate-600 dark:hover:bg-slate-800">8</button>
                      <button onClick={() => copyDay(d)} title="Same as the day before" className="rounded border px-1 hover:bg-white dark:border-slate-600 dark:hover:bg-slate-800"><Copy className="h-3 w-3" /></button>
                    </div>}
                    <div className="mt-0.5 text-[10px] font-normal text-slate-400">{dayTotal(d) || ''}</div>
                  </th>
                ))}
                <th className="px-2 py-2 text-right font-semibold">Week</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, row) => {
                const firstOfReq = row === 0 || lines[row - 1].req !== l.req
                const total = shown.reduce((s, d) => s + (num(val(l, d)) ?? 0), 0)
                return [
                  firstOfReq && (
                    <tr key={`${l.req}-h`} className="border-b bg-slate-50/60 dark:border-slate-700 dark:bg-slate-900/20">
                      <td colSpan={dates.length + 2} className="sticky left-0 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        <Link to={`/labour/${l.req}`} className="hover:text-brand">{l.role}</Link>
                        <span className="ml-1 font-normal normal-case tracking-normal text-slate-400">· {l.basis === 'per_day' ? 'hours' : l.basis === 'per_volume' ? (l.unit ?? 'units') : '% done'}</span>
                      </td>
                    </tr>
                  ),
                  <tr key={l.key} className="border-b last:border-b-0 dark:border-slate-700">
                    <td className="sticky left-0 z-10 bg-white px-3 py-1 dark:bg-slate-800">
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate font-medium text-slate-800 dark:text-slate-100" title={l.name}>{l.name}</span>
                        {l.basis === 'per_day' && <button onClick={() => fullWeek(l)} title="8 hours every working day" className="shrink-0 rounded border px-1 text-[10px] text-slate-500 hover:bg-slate-50 dark:border-slate-600">Wk</button>}
                      </div>
                    </td>
                    {dates.map((d, col) => {
                      const r = l.days[d]
                      if (d > today) return <td key={d} className="bg-slate-50/60 dark:bg-slate-900/20" />
                      const k = cellKey(l, d)
                      const ot = Number(r?.overtime_hours ?? 0)
                      return (
                        <td key={d} className="px-0.5 py-1 text-center">
                          {!r ? <span className="text-slate-300 dark:text-slate-600" title="Not on this request that day">·</span> : (
                            <div className="relative mx-auto max-w-[4.5rem]">
                              <input data-cell={`${row}-${col}`} inputMode="decimal" disabled={r.locked} value={val(l, d)}
                                onChange={e => setCell(l, d, e.target.value)} onKeyDown={e => move(e, row, col)} onFocus={e => e.target.select()}
                                aria-label={`${l.name} ${DAY[col]}`}
                                className={`w-full min-w-[3rem] rounded-md border px-1 py-1.5 text-center text-base tabular-nums outline-none focus:ring-2 focus:ring-brand sm:text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 ${k in drafts ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/20' : ''} ${r.locked ? 'bg-slate-100 text-slate-400 dark:bg-slate-900' : ''}`} />
                              {r.locked && <Lock className="absolute right-1 top-1 h-2.5 w-2.5 text-slate-400" />}
                              {ot > 0 && <span className="absolute -top-1 right-0 rounded bg-sky-100 px-0.5 text-[9px] font-semibold text-sky-700 dark:bg-sky-900/40 dark:text-sky-300" title={`${ot} h overtime — kept as recorded`}>+{ot}</span>}
                            </div>
                          )}
                        </td>
                      )
                    })}
                    <td className="px-2 py-1 text-right text-xs tabular-nums text-slate-500">
                      {total ? (l.basis === 'per_day' ? `${+(total / 8).toFixed(2)} d` : l.basis === 'per_volume' ? total : `${total}%`) : ''}
                    </td>
                  </tr>,
                ]
              })}
            </tbody>
          </table>
        </div>
      )}
      {site && lines.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
          <span><b>8</b> on a day: everyone a full day · <Copy className="inline h-3 w-3" /> same as the day before · <b>Wk</b> on a worker: full days Mon–Sat. Only empty boxes are filled.</span>
          <span><Lock className="inline h-3 w-3" /> already on a pay sheet</span>
          {hasOt && <span className="inline-flex items-center gap-1"><Timer className="h-3 w-3" /> +n is overtime, kept as recorded</span>}
        </p>
      )}

      {site && lines.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-white/95 p-3 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
          <div className="mx-auto flex max-w-5xl items-center gap-3">
            <div className="min-w-0 flex-1 text-xs text-slate-500">
              <ClipboardCheck className="mr-1 inline h-3.5 w-3.5" />About <b className="text-slate-700 dark:text-slate-200">{fmtMoney(weekCost)}</b> this week
              {changes.length > 0 && <span className="block text-amber-600">{changes.length} box{changes.length === 1 ? '' : 'es'} changed, not saved</span>}
            </div>
            <button onClick={save} disabled={!changes.length || saving} className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white shadow disabled:opacity-40">
              <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save week'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
