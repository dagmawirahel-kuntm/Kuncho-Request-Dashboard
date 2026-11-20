import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, ClipboardPaste, Download, Hammer, Lock, Upload, UserPlus, X } from 'lucide-react'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { halfDays, tradeName, useTrades, WEEKDAYS } from '@/lib/labourDay'
import { addDays, dayLabel, fmtMoney } from '@/lib/labour'
import { isFixedUnit, matchTrade, matchWorker, mergePieces, parseNewWorkers, parsePieces, parseReport, type PasteNewWorker, type PasteCol, type PasteDay, type PasteJob, type PastePiece, type PasteRow, type PasteWorker } from '@/lib/labourPaste'
import { workbookToText } from '@/lib/labourWeekDraft'

export type PastedWorker = { staff_id: string; days: (PasteDay | null | undefined)[] }
/** What it takes to add someone new from the report (labour_day_new_worker). */
export type ReportNewWorker = { name: string; phone: string; trade: string; rate: number }
/** A piece job the report names that isn't one yet: its terms, to ask for it (a labour request). */
export type NewJobTerms = {
  what: string; project_id: string; basis: 'per_volume' | 'fixed_price'; unit: string | null
  price: number; total: number | null; crew: string[]; start: string
}
export type AskedJob = { id: string; approved: boolean; why: string | null }
export type PastedPiece = { job_id: string; days: (true | null | undefined)[]; measured: number | null }

const EXAMPLE = `Abebe Kebede: 1 1 1 ½ 1 1 - Solomon Apartment
Tesfanesh Alemu: 1 1 1 1 1 1 - Workshop
Mesfin Girma: 1 1 1+2 1 1 ½ - Bole Villa repair`

/**
 * Paste a PM's labour report — rows copied from the Excel template, or lines
 * typed on a phone — read it, check who and where, and fill the week sheet.
 * Nothing is saved here: the grid is filled, and Save / Send do the rest.
 */
export function PasteReportDialog({ week, cols, colTag, workers, jobs, onSheet, editable, defaultWhere, onClose, onFill, onDraft, onNewWorker, onNewJob }: {
  week: string
  cols: PasteCol[]
  colTag: (key: string) => string
  workers: PasteWorker[]
  /** This PM's open piece / fixed-price jobs this week. */
  jobs: PasteJob[]
  onSheet: Set<string>
  /** Per weekday (Mon–Sun): can this day still change? */
  editable: boolean[]
  defaultWhere: string | null
  onClose: () => void
  onFill: (rows: PastedWorker[], pieces: PastedPiece[]) => void
  /** Download this week's draft for the PM. */
  onDraft?: () => void
  /** Add a worker the report names who isn't on file; resolves to the new worker, or null. */
  onNewWorker?: (w: ReportNewWorker) => Promise<{ staff_id: string; name: string } | null>
  /** Ask for a piece job the report names with its terms; resolves to the request, or null. */
  onNewJob?: (t: NewJobTerms) => Promise<AskedJob | null>
}) {
  const projects = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of cols) if (c.project_id && c.project) m.set(c.project_id, c.project)
    return [...m].map(([id, name]) => ({ id, name }))
  }, [cols])
  const [asking, setAsking] = useState<{ line: number; t: NewJobTerms } | null>(null)
  const [asked, setAsked] = useState<Record<number, AskedJob>>({})
  const [busyJob, setBusyJob] = useState(false)
  const { data: trades = [] } = useTrades()
  const [newRows, setNewRows] = useState<PasteNewWorker[]>([])
  const [creating, setCreating] = useState<{ line: number; w: ReportNewWorker } | null>(null)
  const [busyNew, setBusyNew] = useState(false)
  const [made, setMade] = useState<Record<string, string>>({})
  const [text, setText] = useState('')
  const [rows, setRows] = useState<PasteRow[] | null>(null)
  const [pieces, setPieces] = useState<PastePiece[]>([])
  const [picked, setPicked] = useState<Record<number, string | null>>({})
  const [pickedJob, setPickedJob] = useState<Record<number, string | null>>({})
  const [fileErr, setFileErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const jobById = useMemo(() => new Map(jobs.map(j => [j.id, j])), [jobs])
  const byId = useMemo(() => new Map([...workers.map(w => [w.id, w.name] as const), ...Object.entries(made)]), [workers, made])

  const readText = (t: string) => {
    setRows(parseReport(t, workers, cols, defaultWhere, onSheet)); setPieces(parsePieces(t, jobs)); setNewRows(parseNewWorkers(t)); setPicked({}); setPickedJob({}); setCreating(null)
  }
  const read = () => readText(text)
  async function readFile(f: File) {
    setFileErr('')
    try {
      const t = await workbookToText(await f.arrayBuffer())
      setText(t); readText(t)
    } catch (e) { setFileErr(`Couldn't read ${f.name}: ${(e as Error).message}`) }
  }
  // The New workers block's details for a name, if the PM gave them.
  const detailsFor = (name: string): ReportNewWorker => {
    const n = name.toLowerCase().replace(/\s+/g, ' ').trim()
    const d = newRows.find(x => x.name.toLowerCase().replace(/\s+/g, ' ').trim() === n)
    return { name, phone: d?.phone ?? '', trade: d ? matchTrade(d.trade, trades) ?? '' : '', rate: d?.rate ?? 0 }
  }
  async function createNew() {
    if (!creating || !onNewWorker) return
    setBusyNew(true)
    const r = await onNewWorker(creating.w)
    setBusyNew(false)
    if (!r) return
    setMade(m => ({ ...m, [r.staff_id]: r.name }))
    setPicked(p => ({ ...p, [creating.line]: r.staff_id }))
    setCreating(null)
  }
  // Listed under New workers but given no days: nothing to add yet.
  const newWithoutDays = newRows.filter(n => !(rows ?? []).some(r => r.name.toLowerCase().trim() === n.name.toLowerCase().trim()))
  // A new job's terms, from its row: the project by name, fixed price when
  // the unit says so (or there's no total), the crew names matched to workers.
  function termsFor(p: PastePiece): NewJobTerms {
    const pr = p.project.toLowerCase().trim()
    const proj = projects.find(x => x.name.toLowerCase() === pr) ?? projects.find(x => pr && (x.name.toLowerCase().startsWith(pr) || pr.startsWith(x.name.toLowerCase())))
      ?? (projects.length === 1 ? projects[0] : undefined)
    const fixed = isFixedUnit(p.unit) || (!p.unit && p.total == null)
    const first = p.days.findIndex(d => d === true)
    return {
      what: p.name, project_id: proj?.id ?? '', basis: fixed ? 'fixed_price' : 'per_volume', unit: fixed ? null : (p.unit || 'm²'),
      price: p.price ?? 0, total: fixed ? null : p.total, start: addDays(week, Math.max(first, 0)),
      crew: p.crew.map(n => matchWorker(n, workers)).filter(m => m.length === 1).map(m => m[0].id),
    }
  }
  const crewMissing = (p: PastePiece) => p.crew.filter(n => matchWorker(n, workers).length !== 1)
  const termsOk = (t: NewJobTerms) => t.what.trim().length > 1 && !!t.project_id && t.price > 0 && (t.basis === 'fixed_price' || (!!t.unit && (t.total ?? 0) > 0))
  async function askJob() {
    if (!asking || !onNewJob) return
    setBusyJob(true)
    const r = await onNewJob(asking.t)
    setBusyJob(false)
    if (!r) return
    setAsked(a => ({ ...a, [asking.line]: r }))
    if (r.approved) setPickedJob(x => ({ ...x, [asking.line]: r.id }))
    setAsking(null)
  }
  const jobOf = (p: PastePiece) => (p.line in pickedJob ? pickedJob[p.line] : p.job_id)
  const readyPieces = pieces.filter(p => !p.problems.filter(x => !x.startsWith('Not one of')).length && jobOf(p))
  const who = (r: PasteRow) => (r.line in picked ? picked[r.line] : r.staff_id)
  const ready = (rows ?? []).filter(r => !r.problems.length && who(r))
  const dupes = (() => {
    const seen = new Map<string, number>()
    for (const r of ready) seen.set(who(r)!, (seen.get(who(r)!) ?? 0) + 1)
    return new Set([...seen].filter(([, n]) => n > 1).map(([id]) => id))
  })()
  const fillable = ready.filter(r => !dupes.has(who(r)!))
  const dayCount = fillable.reduce((s, r) => s + r.days.reduce((t, d, i) => t + (d && editable[i] ? d.paid : 0), 0), 0)
  const lockedHit = fillable.some(r => r.days.some((d, i) => d !== undefined && !editable[i]))

  function fill() {
    onFill(
      fillable.map(r => ({ staff_id: who(r)!, days: r.days.map((d, i) => (editable[i] ? d : undefined)) })),
      mergePieces(readyPieces.map(p => ({ job_id: jobOf(p)!, days: p.days.map((d, i) => (editable[i] ? d : undefined)), measured: p.measured }))),
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Paste a labour report"
        className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl dark:bg-slate-800" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 border-b px-5 py-4 dark:border-slate-700">
          <ClipboardPaste className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">Paste a labour report</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">Week of {dayLabel(week)}. Copy the rows from the template, or paste the PM's message. You check it here; nothing is saved until you press Save or Send.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {!rows ? (
            <>
              <textarea value={text} onChange={e => setText(e.target.value)} rows={10} autoFocus spellCheck={false}
                placeholder={EXAMPLE}
                className="w-full rounded-lg border px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
              <div className="grid gap-2 text-xs text-slate-500 sm:grid-cols-2 dark:text-slate-400">
                <p><b className="text-slate-700 dark:text-slate-200">From Excel:</b> select the rows (header too) and copy. Columns: Worker, Mon … Sun, Where, Overtime.</p>
                <p><b className="text-slate-700 dark:text-slate-200">From a phone:</b> one worker a line — <span className="font-mono">Name: Mon … Sun Where</span>. 1 full, ½ half, - off, <span className="font-mono">1+2</span> = 2 h overtime, <span className="font-mono">1 Workshop</span> = that day elsewhere.</p>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <input ref={fileRef} type="file" accept=".xlsx" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = '' }} />
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-brand dark:border-slate-600 dark:text-slate-200">
                  <Upload className="h-3.5 w-3.5" /> Upload the PM's filled sheet (.xlsx)
                </button>
                {onDraft && (
                  <button type="button" onClick={onDraft} className="inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline">
                    <Download className="h-3.5 w-3.5" /> This week's draft for the PM — workers and piece work filled in
                  </button>
                )}
              </div>
              {fileErr && <p className="text-xs text-red-600">{fileErr}</p>}
            </>
          ) : rows.length === 0 && pieces.length === 0 ? (
            <p className="rounded-lg bg-amber-50 px-3 py-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">No worker rows found. Paste rows from the template, or lines like <span className="font-mono">Abebe Kebede: 1 1 1 ½ 1 1 -</span>.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border dark:border-slate-700">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900/40">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">In the report</th>
                    <th className="px-3 py-2 text-left font-medium">Worker</th>
                    {WEEKDAYS.map((d, i) => <th key={d} className="px-1 py-2 text-center font-medium">{d}{!editable[i] && <Lock className="ml-0.5 inline h-3 w-3" aria-label="can't change" />}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-slate-700">
                  {rows.map(r => {
                    const id = who(r)
                    const bad = r.problems.length > 0
                    return (
                      <tr key={r.line} className={bad ? 'bg-red-50/60 dark:bg-red-900/10' : ''}>
                        <td className="px-3 py-1.5 align-top">
                          <p className="font-medium text-slate-700 dark:text-slate-200">{r.name}</p>
                          {r.problems.map(p => <p key={p} className="text-[11px] text-red-600 dark:text-red-400">{p}</p>)}
                          {id && dupes.has(id) && <p className="text-[11px] text-red-600">On the report twice — keep one line</p>}
                        </td>
                        <td className="min-w-[12rem] px-3 py-1.5 align-top">
                          {r.staff_id && !(r.line in picked) ? (
                            <span className="text-emerald-700 dark:text-emerald-400">{byId.get(r.staff_id)}</span>
                          ) : (
                            picked[r.line] && made[picked[r.line]!] ? (
                              <span className="text-emerald-700 dark:text-emerald-400">{made[picked[r.line]!]} <span className="text-[10px] text-slate-500">· new, HR verifies</span></span>
                            ) : (
                            <>
                              <SearchableSelect value={picked[r.line] ?? null} onChange={v => setPicked(p => ({ ...p, [r.line]: v }))}
                                placeholder={r.candidates.length ? 'Which one?' : 'Not found — pick'}
                                options={(r.candidates.length ? r.candidates : workers).map(w => ({ id: w.id, label: w.name }))} />
                              {onNewWorker && !picked[r.line] && creating?.line !== r.line && (
                                <button type="button" onClick={() => setCreating({ line: r.line, w: detailsFor(r.name) })}
                                  className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-brand hover:underline">
                                  <UserPlus className="h-3 w-3" /> Add {r.name} as a new worker{newRows.some(n => n.name.toLowerCase().trim() === r.name.toLowerCase().trim()) ? ' (details in the sheet)' : ''}
                                </button>
                              )}
                              {creating?.line === r.line && (
                                <div className="mt-1.5 space-y-1.5 rounded-lg border border-brand/30 bg-brand/5 p-2">
                                  <input value={creating.w.name} onChange={e => setCreating({ ...creating, w: { ...creating.w, name: e.target.value } })} aria-label="Full name"
                                    className="w-full rounded border px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-900" />
                                  <SearchableSelect value={creating.w.trade || null} onChange={v => setCreating({ ...creating, w: { ...creating.w, trade: v ?? '' } })} placeholder="Trade…"
                                    options={trades.map(t => ({ id: t.trade_tag, label: tradeName(t.trade_tag), sub: t.codename_amharic ?? undefined }))} />
                                  <div className="flex gap-1.5">
                                    <input value={creating.w.rate || ''} onChange={e => setCreating({ ...creating, w: { ...creating.w, rate: Number(e.target.value) || 0 } })} inputMode="decimal" placeholder="Day rate"
                                      aria-label="Day rate" className="w-24 rounded border px-2 py-1 text-right text-xs dark:border-slate-600 dark:bg-slate-900" />
                                    <input value={creating.w.phone} onChange={e => setCreating({ ...creating, w: { ...creating.w, phone: e.target.value } })} inputMode="tel" placeholder="Phone (optional)"
                                      aria-label="Phone" className="min-w-0 flex-1 rounded border px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-900" />
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button type="button" onClick={createNew} disabled={busyNew || creating.w.name.trim().length < 2 || !creating.w.trade || !(creating.w.rate > 0)}
                                      className="rounded bg-brand px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-40">{busyNew ? 'Adding…' : 'Add worker'}</button>
                                    <button type="button" onClick={() => setCreating(null)} className="text-[11px] text-slate-500">Cancel</button>
                                    <span className="text-[10px] text-slate-500">The rate is a proposal; HR verifies before pay.</span>
                                  </div>
                                </div>
                              )}
                            </>
                            )
                          )}
                        </td>
                        {r.days.map((d, i) => (
                          <td key={i} className="px-1 py-1.5 text-center align-top">
                            {d === undefined ? <span className="text-slate-300">~</span>
                              : d === null ? <span className="text-slate-400">·</span>
                              : (
                                <span className={`inline-block min-w-[3.5rem] rounded px-1 py-0.5 ${!editable[i] ? 'bg-slate-100 text-slate-400 line-through dark:bg-slate-700' : d.where ? 'bg-brand/10 text-slate-800 dark:text-slate-100' : 'bg-amber-50 text-amber-800'}`}>
                                  <b>{halfDays(d.paid)}</b>{d.ot ? ` +${d.ot}h` : ''}
                                  <span className="block truncate text-[10px] text-slate-500">{d.where ? colTag(d.where) : 'where?'}</span>
                                </span>
                              )}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {rows && newWithoutDays.length > 0 && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
              Under New workers but with no days in the worker rows: {newWithoutDays.map(n => n.name).join(', ')}. Add their days to a worker row and read it again to bring them in.
            </p>
          )}
          {rows && pieces.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-sky-200 dark:border-sky-900/50">
              <p className="flex items-center gap-1.5 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-800 dark:bg-sky-900/20 dark:text-sky-200"><Hammer className="h-3.5 w-3.5" /> Piece work · the crew on each ticked day; measured goes on the last day worked</p>
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900/40">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">In the report</th>
                    <th className="px-3 py-2 text-left font-medium">Job</th>
                    {WEEKDAYS.map((d, i) => <th key={d} className="px-1 py-2 text-center font-medium">{d}{!editable[i] && <Lock className="ml-0.5 inline h-3 w-3" aria-label="can't change" />}</th>)}
                    <th className="px-2 py-2 text-right font-medium">Measured</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-slate-700">
                  {pieces.map(p => {
                    const id = jobOf(p)
                    const job = id ? jobById.get(id) : undefined
                    const bad = p.problems.some(x => !x.startsWith('Not one of'))
                    return (
                      <tr key={p.line} className={bad || (!id && p.price == null) ? 'bg-red-50/60 dark:bg-red-900/10' : !id ? 'bg-amber-50/50 dark:bg-amber-900/10' : ''}>
                        <td className="px-3 py-1.5 align-top">
                          <p className="font-medium text-slate-700 dark:text-slate-200">{p.text}</p>
                          {p.problems.filter(x => !x.startsWith('Not one of') || (!id && p.price == null)).map(x => <p key={x} className="text-[11px] text-red-600 dark:text-red-400">{x}</p>)}
                          {!id && p.price != null && !asked[p.line] && <p className="text-[11px] text-amber-700 dark:text-amber-300">A new job on the sheet, with its price</p>}
                        </td>
                        <td className="min-w-[12rem] px-3 py-1.5 align-top">
                          {p.warning && <p className="mb-0.5 text-[11px] text-amber-700 dark:text-amber-300">{p.warning}</p>}
                          {asked[p.line] && !asked[p.line].approved ? (
                            <p className="text-[11px] text-amber-700 dark:text-amber-300">Asked for — waiting for approval{asked[p.line].why ? `, because ${asked[p.line].why}` : ''}. Read the sheet again once it's approved to fill its days.</p>
                          ) : p.job_id && !(p.line in pickedJob) ? (
                            <span className="text-emerald-700 dark:text-emerald-400">{job?.what} · {job?.project}
                              {job && <span className="block text-[10px] text-slate-500">{job.basis === 'per_volume' ? `${fmtMoney(job.unit_rate ?? 0)} a ${job.unit ?? 'unit'}${job.planned_volume ? ` · ${Number(job.planned_volume).toLocaleString()} ${job.unit ?? ''} in all` : ''}` : `${fmtMoney(job.fixed_price ?? 0)} for the job`}</span>}
                            </span>
                          ) : asked[p.line]?.approved ? (
                            <span className="text-emerald-700 dark:text-emerald-400">{job ? `${job.what} · ${job.project}` : p.name} <span className="text-[10px] text-slate-500">· new, approved</span></span>
                          ) : asking?.line === p.line ? (
                            <div className="space-y-1.5 rounded-lg border border-brand/30 bg-brand/5 p-2">
                              <input value={asking.t.what} onChange={e => setAsking({ ...asking, t: { ...asking.t, what: e.target.value } })} aria-label="The work"
                                className="w-full rounded border px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-900" />
                              <SearchableSelect value={asking.t.project_id || null} onChange={v => setAsking({ ...asking, t: { ...asking.t, project_id: v ?? '' } })} placeholder="Project…"
                                options={projects.map(x => ({ id: x.id, label: x.name }))} />
                              <div className="flex gap-1 text-[11px]">
                                {(['per_volume', 'fixed_price'] as const).map(b => (
                                  <button key={b} type="button" onClick={() => setAsking({ ...asking, t: { ...asking.t, basis: b, unit: b === 'fixed_price' ? null : (asking.t.unit || 'm²') } })}
                                    className={`rounded px-2 py-0.5 ${asking.t.basis === b ? 'bg-brand text-white' : 'border dark:border-slate-600'}`}>{b === 'per_volume' ? 'Price per unit' : 'One price for the job'}</button>
                                ))}
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                <input value={asking.t.price || ''} onChange={e => setAsking({ ...asking, t: { ...asking.t, price: Number(e.target.value) || 0 } })} inputMode="decimal"
                                  placeholder={asking.t.basis === 'per_volume' ? 'Price a unit' : 'Agreed price'} aria-label="Agreed price" className="w-24 rounded border px-2 py-1 text-right text-xs dark:border-slate-600 dark:bg-slate-900" />
                                {asking.t.basis === 'per_volume' && (
                                  <>
                                    <input value={asking.t.unit ?? ''} onChange={e => setAsking({ ...asking, t: { ...asking.t, unit: e.target.value } })} placeholder="Unit" aria-label="Unit"
                                      className="w-14 rounded border px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-900" />
                                    <input value={asking.t.total ?? ''} onChange={e => setAsking({ ...asking, t: { ...asking.t, total: Number(e.target.value) || null } })} inputMode="decimal" placeholder="Total work"
                                      aria-label="Total work" className="w-20 rounded border px-2 py-1 text-right text-xs dark:border-slate-600 dark:bg-slate-900" />
                                  </>
                                )}
                              </div>
                              <p className="text-[10px] text-slate-500">
                                {asking.t.price > 0 && (asking.t.basis === 'fixed_price' ? `${fmtMoney(asking.t.price)} for the whole job` : asking.t.total ? `${fmtMoney(asking.t.price)} × ${asking.t.total} ${asking.t.unit ?? ''} = ${fmtMoney(asking.t.price * asking.t.total)} in all` : '')}
                                {' · '}Crew: {asking.t.crew.length ? asking.t.crew.map(id => byId.get(id)).join(', ') : 'none named'}
                                {crewMissing(p).length ? ` · not found: ${crewMissing(p).join(', ')} (add them as new workers first)` : ''}
                              </p>
                              <div className="flex items-center gap-2">
                                <button type="button" onClick={askJob} disabled={busyJob || !termsOk(asking.t)}
                                  className="rounded bg-brand px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-40">{busyJob ? 'Asking…' : 'Ask for this job'}</button>
                                <button type="button" onClick={() => setAsking(null)} className="text-[11px] text-slate-500">Cancel</button>
                                <span className="text-[10px] text-slate-500">Approved by itself only within agreed terms; otherwise a person decides.</span>
                              </div>
                            </div>
                          ) : (
                            <>
                              <SearchableSelect value={pickedJob[p.line] ?? null} onChange={v => setPickedJob(x => ({ ...x, [p.line]: v }))}
                                placeholder={p.candidates.length ? 'Which job?' : 'Pick the job'}
                                options={(p.candidates.length ? p.candidates : jobs).map(j => ({ id: j.id, label: `${j.what} · ${j.project}` }))} />
                              {onNewJob && !p.candidates.length && !pickedJob[p.line] && (
                                <button type="button" onClick={() => setAsking({ line: p.line, t: termsFor(p) })}
                                  className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-brand hover:underline">
                                  <Hammer className="h-3 w-3" /> A new job — ask for it{p.price ? ` at ${fmtMoney(p.price)}${p.unit && !isFixedUnit(p.unit) ? ` a ${p.unit}` : ''}` : ''}
                                </button>
                              )}
                            </>
                          )}
                        </td>
                        {p.days.map((d, i) => (
                          <td key={i} className="px-1 py-1.5 text-center align-top">
                            {d === undefined ? <span className="text-slate-300">~</span> : d === null ? <span className="text-slate-400">·</span>
                              : <span className={`inline-block rounded px-1.5 py-0.5 ${editable[i] ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200' : 'bg-slate-100 text-slate-400 line-through dark:bg-slate-700'}`}>✓ crew</span>}
                          </td>
                        ))}
                        <td className="px-2 py-1.5 text-right align-top tabular-nums">
                          {p.measured == null ? '—' : job?.basis === 'fixed_price' ? `${p.measured}%` : `${p.measured} ${job?.unit ?? ''}`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {rows && (rows.length > 0 || pieces.length > 0) && (
            <div className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
              <p>Each worker's days in the report replace what the grid has for them; a blank day means they didn't work. ~ means the report doesn't cover that day, so it's left as it is.</p>
              {rows.some(r => r.problems.length) && <p className="flex items-center gap-1 text-red-600 dark:text-red-400"><AlertTriangle className="h-3.5 w-3.5" /> Lines in red aren't filled. Fix them in the text and read it again.</p>}
              {lockedHit && <p className="flex items-center gap-1"><Lock className="h-3.5 w-3.5" /> Locked, paid or future days are left as they are.</p>}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3 dark:border-slate-700">
          {rows ? (
            <>
              <button onClick={() => setRows(null)} className="rounded-lg border px-3 py-2 text-sm text-slate-600 dark:border-slate-600 dark:text-slate-300">Back to the text</button>
              <span className="ml-auto text-xs text-slate-500">{fillable.length} worker{fillable.length === 1 ? '' : 's'} · {halfDays(dayCount)} days{readyPieces.length ? ` · ${readyPieces.length} piece job${readyPieces.length === 1 ? '' : 's'}` : ''}</span>
              <button onClick={fill} disabled={!fillable.length && !readyPieces.length}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Fill the week</button>
            </>
          ) : (
            <>
              <button onClick={onClose} className="rounded-lg border px-3 py-2 text-sm text-slate-600 dark:border-slate-600 dark:text-slate-300">Cancel</button>
              <button onClick={read} disabled={!text.trim()} className="ml-auto rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Read it</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
