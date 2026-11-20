import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, ClipboardPaste, Download, Hammer, Lock, Upload, UserPlus, X } from 'lucide-react'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { halfDays, tradeName, useTrades, WEEKDAYS } from '@/lib/labourDay'
import { dayLabel } from '@/lib/labour'
import { matchTrade, mergePieces, parseNewWorkers, parsePieces, parseReport, type PasteNewWorker, type PasteCol, type PasteDay, type PasteJob, type PastePiece, type PasteRow, type PasteWorker } from '@/lib/labourPaste'
import { workbookToText } from '@/lib/labourWeekDraft'

export type PastedWorker = { staff_id: string; days: (PasteDay | null | undefined)[] }
/** What it takes to add someone new from the report (labour_day_new_worker). */
export type ReportNewWorker = { name: string; phone: string; trade: string; rate: number }
export type PastedPiece = { job_id: string; days: (true | null | undefined)[]; measured: number | null }

const EXAMPLE = `Abebe Kebede: 1 1 1 ½ 1 1 - Solomon Apartment
Tesfanesh Alemu: 1 1 1 1 1 1 - Workshop
Mesfin Girma: 1 1 1+2 1 1 ½ - Bole Villa repair`

/**
 * Paste a PM's labour report — rows copied from the Excel template, or lines
 * typed on a phone — read it, check who and where, and fill the week sheet.
 * Nothing is saved here: the grid is filled, and Save / Send do the rest.
 */
export function PasteReportDialog({ week, cols, colTag, workers, jobs, onSheet, editable, defaultWhere, onClose, onFill, onDraft, onNewWorker }: {
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
}) {
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
                      <tr key={p.line} className={bad || !id ? 'bg-red-50/60 dark:bg-red-900/10' : ''}>
                        <td className="px-3 py-1.5 align-top">
                          <p className="font-medium text-slate-700 dark:text-slate-200">{p.text}</p>
                          {p.problems.filter(x => id ? !x.startsWith('Not one of') : true).map(x => <p key={x} className="text-[11px] text-red-600 dark:text-red-400">{x}</p>)}
                        </td>
                        <td className="min-w-[12rem] px-3 py-1.5 align-top">
                          {p.job_id && !(p.line in pickedJob) ? (
                            <span className="text-emerald-700 dark:text-emerald-400">{job?.what} · {job?.project}</span>
                          ) : (
                            <SearchableSelect value={pickedJob[p.line] ?? null} onChange={v => setPickedJob(x => ({ ...x, [p.line]: v }))}
                              placeholder={p.candidates.length ? 'Which job?' : 'Pick the job'}
                              options={(p.candidates.length ? p.candidates : jobs).map(j => ({ id: j.id, label: `${j.what} · ${j.project}` }))} />
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
