// Bring in the monthly overtime workbook as it has always been kept (533):
// names as the site writes them, one column per Ethiopian date and kind of
// hours. Each name is matched to the staff list — from a match confirmed
// before, the same name, or one that sounds alike — and finance confirms the
// rest once; confirmed matches are remembered for next month.
import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileSpreadsheet, Upload } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { mergeHours, type GroupFill } from '@/lib/overtimeFill'
import {
  matchStaff, readOtWorkbook, toHourRows, type MatchHow, type OtWorkbook, type StaffForMatch,
} from '@/lib/otWorkbook'

const HOW: Record<MatchHow | 'picked', { label: string; cls: string }> = {
  remembered: { label: 'Remembered', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  exact: { label: 'Same name', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  sounds: { label: 'Sounds like', cls: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' },
  check: { label: 'Check', cls: 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
  none: { label: 'Not found', cls: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  picked: { label: 'Picked', cls: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200' },
}
const KIND_AM = { evening: 'ምሽት', sunday: 'እሁድ', overnight: 'አዳር' } as const

export function OvertimeWorkbookImport({ staff, minDate, maxDate, onApply }: {
  staff: StaffForMatch[]
  minDate: string
  maxDate: string
  onApply: (fill: GroupFill) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [wb, setWb] = useState<OtWorkbook | null>(null)
  const [fileName, setFileName] = useState('')
  const [err, setErr] = useState('')
  const [reading, setReading] = useState(false)
  const [picked, setPicked] = useState<Record<string, string | null>>({})
  const [busy, setBusy] = useState(false)

  const { data: aliases = [] } = useQuery({
    queryKey: ['staff-name-aliases'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('staff_name_aliases').select('alias_key, staff_id')
      if (error) throw error
      return (data ?? []) as { alias_key: string; staff_id: string }[]
    },
  })
  const remembered = useMemo(() => new Map(aliases.map(a => [a.alias_key, a.staff_id])), [aliases])
  const byId = useMemo(() => new Map(staff.map(s => [s.id, s])), [staff])
  const options = useMemo(() => staff.map(s => ({ id: s.id, label: s.name, sub: s.salaried ? undefined : 'not on monthly salary' })), [staff])

  const rows = useMemo(() => (wb?.people ?? []).map(p => {
    const m = matchStaff(p.name, staff, remembered)
    const chosen = p.name in picked ? picked[p.name] : m.staffId
    const inRun = p.cells.filter(c => c.iso >= minDate && c.iso <= maxDate)
    const outside = p.cells.length - inRun.length
    const hours = inRun.reduce((s, c) => s + c.hours, 0)
    const all = p.cells.reduce((s, c) => s + c.hours, 0)
    const who = chosen ? byId.get(chosen) : undefined
    const how: MatchHow | 'picked' = p.name in picked ? 'picked' : m.how
    const problem = !chosen ? 'Pick who this is'
      : !who?.salaried ? `${who?.name ?? 'This person'} is not on monthly salary — pay through labour`
      : !inRun.length ? 'No dates in this run' : null
    return { p, m, chosen, how, inRun, outside, hours, all, problem }
  }), [wb, staff, remembered, picked, byId, minDate, maxDate])

  const ready = rows.filter(r => !r.problem)
  const dupes = useMemo(() => {
    const seen = new Map<string, string[]>()
    for (const r of ready) seen.set(r.chosen!, [...(seen.get(r.chosen!) ?? []), r.p.name])
    return Array.from(seen.values()).filter(v => v.length > 1)
  }, [ready])
  const outsideTotal = rows.reduce((n, r) => n + r.outside, 0)

  async function read(file: File) {
    setErr(''); setReading(true); setPicked({})
    try {
      const w = await readOtWorkbook(await file.arrayBuffer())
      setWb(w); setFileName(file.name)
    } catch (e) {
      setWb(null); setErr((e as Error).message)
    } finally { setReading(false) }
  }

  async function apply() {
    const fill: GroupFill = new Map()
    for (const r of ready) fill.set(r.chosen!, mergeHours(fill.get(r.chosen!) ?? null, toHourRows(r.inRun)))
    // Two names for one person (a nickname and the full name): add their hours on a shared date.
    for (const names of dupes) {
      const id = ready.find(r => r.p.name === names[0])!.chosen!
      const all = ready.filter(r => r.chosen === id).flatMap(r => r.inRun)
      fill.set(id, toHourRows(all))
    }
    setBusy(true)
    const pairs = ready.filter(r => r.how !== 'remembered').map(r => ({ alias: r.p.name, staff_id: r.chosen }))
    if (pairs.length) {
      const { error } = await supabase.rpc('remember_staff_aliases', { p_pairs: pairs })
      if (error) { setBusy(false); setErr(error.message); return }
    }
    setBusy(false)
    onApply(fill)
  }

  return (
    <div className="space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept=".xlsx" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) read(f); e.target.value = '' }} />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={reading}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800">
          <Upload className="h-3.5 w-3.5" /> {reading ? 'Reading…' : wb ? 'Choose another workbook' : 'Choose the OT workbook (.xlsx)'}
        </button>
        {wb && <span className="inline-flex items-center gap-1 text-xs text-slate-500"><FileSpreadsheet className="h-3.5 w-3.5" />{fileName} · sheet “{wb.sheet}” · {wb.columns} date columns · {wb.people.length} people</span>}
      </div>
      {!wb && !err && (
        <p className="text-xs text-slate-500">
          The workbook as it is kept: names down the first column, then a column per date and kind — <b>02/02/2019 ምሽት</b>, <b>08/02/2019 እሁድ</b>, <b>16/02/2019 አዳር</b> — in the Ethiopian calendar.
          Overnight hours count as night up to 8 a date (10 pm – 6 am). Names you confirm are remembered for next month.
        </p>
      )}
      {err && <p className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">{err}</p>}

      {wb && (
        <>
          <div className="overflow-x-auto rounded border dark:border-slate-700">
            <div className="min-w-[46rem]">
              <div className="grid grid-cols-[minmax(7rem,1fr)_8rem_minmax(12rem,1.4fr)_6rem] gap-2 bg-slate-50 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:bg-slate-900/40">
                <span>On the sheet</span><span>Hours</span><span>Staff member</span><span>Match</span>
              </div>
              {rows.map(r => (
                <div key={r.p.row} className="grid grid-cols-[minmax(7rem,1fr)_8rem_minmax(12rem,1.4fr)_6rem] items-start gap-2 border-t px-2 py-1.5 dark:border-slate-700">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{r.p.name}</p>
                    <p className="text-[10px] text-slate-400">
                      {(['evening', 'sunday', 'overnight'] as const).map(k => {
                        const h = r.p.cells.filter(c => c.kind === k).reduce((s, c) => s + c.hours, 0)
                        return h ? `${KIND_AM[k]} ${h}` : null
                      }).filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="text-xs tabular-nums text-slate-600 dark:text-slate-300">
                    <b className="text-slate-800 dark:text-slate-100">{r.hours} h</b> · {new Set(r.inRun.map(c => c.iso)).size} dates
                    {r.outside > 0 && <p className="text-[10px] text-amber-600">{r.outside} outside this run</p>}
                    {r.p.sheetTotal != null && r.p.sheetTotal !== r.all && <p className="text-[10px] text-amber-600">sheet total says {r.p.sheetTotal}</p>}
                  </div>
                  <div>
                    <SearchableSelect value={r.chosen} options={options} placeholder="Who is this?"
                      onChange={id => setPicked(x => ({ ...x, [r.p.name]: id }))} />
                    {r.how === 'check' && r.m.candidates.length > 1 && (
                      <p className="mt-0.5 text-[10px] text-amber-700 dark:text-amber-300">Could be {r.m.candidates.map(c => byId.get(c)?.name).filter(Boolean).join(', ')}</p>
                    )}
                    {r.problem && r.chosen && <p className="mt-0.5 text-[10px] text-red-600">{r.problem}</p>}
                  </div>
                  <span className={`justify-self-start rounded-full px-2 py-0.5 text-[10px] font-semibold ${HOW[r.how].cls}`}>{HOW[r.how].label}</span>
                </div>
              ))}
            </div>
          </div>
          {(dupes.length > 0 || outsideTotal > 0) && (
            <ul className="list-disc space-y-0.5 pl-5 text-[11px] text-slate-500">
              {dupes.map(d => <li key={d.join()}>{d.join(' and ')} are the same person here; their hours are added together.</li>)}
              {outsideTotal > 0 && <li>{outsideTotal} entr{outsideTotal === 1 ? 'y falls' : 'ies fall'} outside this run’s dates and {outsideTotal === 1 ? 'is' : 'are'} left out.</li>}
            </ul>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-slate-500">
              {ready.length} of {rows.length} ready · {ready.reduce((s, r) => s + r.hours, 0)} h
              {rows.length - ready.length > 0 ? ` · ${rows.length - ready.length} need a look` : ''}
            </p>
            <button type="button" disabled={!ready.length || busy} onClick={apply}
              className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground disabled:opacity-40">
              {busy ? 'Saving the names…' : `Fill ${ready.length} sheet${ready.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
