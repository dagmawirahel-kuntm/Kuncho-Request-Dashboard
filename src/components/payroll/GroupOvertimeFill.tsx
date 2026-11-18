// Fill overtime hours for many people at once on an Overtime run (532).
// Two ways: the same hours on the same dates for everyone picked (a crew
// that stayed late together), or a timesheet pasted from Excel — one row per
// person per date. Either way the dates land on each person's hours sheet,
// replacing a date already there, and the database prices them as usual.
import { useMemo, useState } from 'react'
import { ClipboardPaste, Users, X } from 'lucide-react'
import { nice, parseTimesheet, type GroupFill, type Person } from '@/lib/overtimeFill'

const box = 'rounded border px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-brand dark:border-slate-600 dark:bg-slate-800'

export function GroupOvertimeFill({
  people, staff, minDate, maxDate, onApply, onClose,
}: {
  /** People already on the run. */
  people: Person[]
  /** Everyone on the staff list — a pasted name not yet on the run is added. */
  staff: Person[]
  minDate: string
  maxDate: string
  onApply: (fill: GroupFill) => void
  onClose: () => void
}) {
  const [mode, setMode] = useState<'same' | 'paste'>('same')
  const [picked, setPicked] = useState<Set<string>>(() => new Set(people.map(p => p.id)))
  const [dates, setDates] = useState<string[]>([])
  const [dateInput, setDateInput] = useState('')
  const [hours, setHours] = useState('2')
  const [night, setNight] = useState('0')
  const [text, setText] = useState('')

  const parsed = useMemo(() => (text.trim() ? parseTimesheet(text, staff, minDate, maxDate) : null), [text, staff, minDate, maxDate])
  const h = Number(hours), n = Number(night) || 0
  const sameOk = picked.size > 0 && dates.length > 0 && h > 0 && h <= 24 && n >= 0 && n <= h

  function addDate(v: string) {
    if (!v || v < minDate || v > maxDate || dates.includes(v)) return
    setDates(d => [...d, v].sort())
    setDateInput('')
  }
  function applySame() {
    const fill: GroupFill = new Map()
    for (const id of picked) fill.set(id, dates.map(d => ({ work_date: d, hours: h, night_hours: n })))
    onApply(fill)
  }

  const tab = (on: boolean) => `inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold ${on
    ? 'bg-brand text-brand-foreground' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700'}`

  return (
    <div className="rounded-lg border border-blue-300 bg-white dark:border-blue-800 dark:bg-slate-900/40" role="region" aria-label="Fill overtime for a group">
      <div className="flex flex-wrap items-center gap-2 border-b bg-blue-50 px-3 py-2 dark:border-slate-700 dark:bg-blue-950/40">
        <p className="mr-auto text-sm font-semibold text-slate-800 dark:text-slate-100">Fill hours for a group</p>
        <button type="button" className={tab(mode === 'same')} onClick={() => setMode('same')}><Users className="h-3.5 w-3.5" /> Same hours for several people</button>
        <button type="button" className={tab(mode === 'paste')} onClick={() => setMode('paste')}><ClipboardPaste className="h-3.5 w-3.5" /> Paste a timesheet</button>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700 dark:hover:bg-slate-800"><X className="h-4 w-4" /></button>
      </div>

      {mode === 'same' ? (
        <div className="grid gap-4 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-xs font-medium text-slate-600 dark:text-slate-300">Who ({picked.size} of {people.length})</p>
              <button type="button" className="text-[11px] text-blue-600 underline decoration-dotted dark:text-blue-300"
                onClick={() => setPicked(picked.size === people.length ? new Set() : new Set(people.map(p => p.id)))}>
                {picked.size === people.length ? 'Clear' : 'Everyone on the run'}
              </button>
            </div>
            {people.length === 0 ? (
              <p className="text-xs text-slate-500">Pick people for the run first, or paste a timesheet — it adds them.</p>
            ) : (
              <div className="max-h-48 space-y-0.5 overflow-y-auto rounded border p-1 dark:border-slate-700">
                {people.map(p => (
                  <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
                    <input type="checkbox" checked={picked.has(p.id)}
                      onChange={e => setPicked(s => { const x = new Set(s); if (e.target.checked) x.add(p.id); else x.delete(p.id); return x })} />
                    <span className="truncate text-slate-700 dark:text-slate-200">{p.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-300">Dates worked</p>
              <div className="flex gap-2">
                <input type="date" className={`${box} min-w-0 flex-1`} min={minDate} max={maxDate} value={dateInput}
                  onChange={e => { setDateInput(e.target.value); addDate(e.target.value) }} aria-label="Add a date" />
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {dates.length === 0 && <span className="text-[11px] text-slate-400">Pick each date; they collect here.</span>}
                {dates.map(d => (
                  <span key={d} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-2 pr-1 text-xs text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                    {nice(d)}
                    <button type="button" onClick={() => setDates(x => x.filter(y => y !== d))} aria-label={`Remove ${nice(d)}`} className="rounded-full p-0.5 hover:bg-slate-200 dark:hover:bg-slate-600"><X className="h-3 w-3" /></button>
                  </span>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-slate-600 dark:text-slate-300">Hours each date
                <input type="number" min={0.5} max={24} step={0.5} className={`${box} mt-1 w-full text-right`} value={hours} onChange={e => setHours(e.target.value)} />
              </label>
              <label className="text-xs text-slate-600 dark:text-slate-300">Of them at night
                <input type="number" min={0} max={24} step={0.5} className={`${box} mt-1 w-full text-right`} value={night} onChange={e => setNight(e.target.value)} />
              </label>
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-slate-500">
                {sameOk ? `${picked.size} ${picked.size === 1 ? 'person' : 'people'} × ${dates.length} date${dates.length === 1 ? '' : 's'} × ${h} h` : 'Pick people, dates and hours'}
              </p>
              <button type="button" disabled={!sameOk} onClick={applySame}
                className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground disabled:opacity-40">Fill their sheets</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-2 p-3">
          <p className="text-xs text-slate-500">
            Copy the columns from Excel — <b>Name · Date · Hours · Night hours</b> (night is optional) — one row per person per date, and paste below.
            Dates like 16/09/2026 or 2026-09-16. Someone not yet on the run is added.
          </p>
          <textarea className={`${box} h-36 w-full font-mono text-xs`} value={text} onChange={e => setText(e.target.value)}
            placeholder={'Name\tDate\tHours\tNight\nAbebe Kebede\t16/09/2026\t3\t1\nAbebe Kebede\t20/09/2026\t4\nSara Alemu\t16/09/2026\t3'}
            aria-label="Pasted timesheet" />
          {parsed && (
            <div className="space-y-1 text-xs">
              <p className="text-slate-600 dark:text-slate-300">
                {parsed.rows} row{parsed.rows === 1 ? '' : 's'} for {parsed.fill.size} {parsed.fill.size === 1 ? 'person' : 'people'} ready
                {parsed.problems.length ? `, ${parsed.problems.length} skipped` : ''}.
              </p>
              {parsed.problems.length > 0 && (
                <ul className="max-h-24 list-disc overflow-y-auto rounded border border-amber-300 bg-amber-50 py-1 pl-6 pr-2 text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
                  {parsed.problems.map(p => <li key={p}>{p}</li>)}
                </ul>
              )}
            </div>
          )}
          <div className="flex justify-end">
            <button type="button" disabled={!parsed || parsed.rows === 0} onClick={() => parsed && onApply(parsed.fill)}
              className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground disabled:opacity-40">Fill their sheets</button>
          </div>
        </div>
      )}
    </div>
  )
}
