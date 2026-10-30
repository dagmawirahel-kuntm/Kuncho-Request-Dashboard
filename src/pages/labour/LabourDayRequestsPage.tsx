import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { Pill } from '@/components/record/Record'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { addDays, dayLabel, isoDay } from '@/lib/labour'
import { REQUEST_STATUS, WEEKDAYS, crewInEffect, crewSpan, tradeName, useDayPeople, useDaySettings, useTrades, type CrewRequest } from '@/lib/labourDay'
import { Check, ClipboardList, Minus, Plus, Send, Square, Trash2, Users, X } from 'lucide-react'

type Line = { trade: string; headcount: number }
type Span = 'until_changed' | 'one_day' | 'until_date'
const card = 'rounded-2xl border bg-white dark:border-slate-700 dark:bg-slate-800'
const SELECT = 'id, code, pm_staff_id, work_date, ends_on, weekdays, status, note, created_by_name, submitted_at, decided_by_name, decided_at, decision_note, staff:pm_staff_id(employee_name), labour_day_request_lines(trade_tag, headcount)'

// The PM's standing crew (492): how many of each trade, on which days, until
// they change it. Each change is approved by operations before it starts. No
// project here — where each day goes is recorded on the day sheet.
export default function LabourDayRequestsPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [params, setParams] = useSearchParams()
  const { me, approver, seeAll, pms } = useDayPeople()
  const { data: settings } = useDaySettings()
  const { data: trades = [] } = useTrades()
  const today = isoDay(new Date())
  const tomorrow = addDays(today, 1)
  const date = params.get('date') ?? (settings?.starts_on && settings.starts_on > tomorrow ? settings.starts_on : tomorrow)
  const pm = params.get('pm') ?? me?.id ?? null
  const setQ = (k: string, v: string | null) => setParams(p => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n }, { replace: true })

  const { data: list = [], isLoading } = useQuery({
    queryKey: ['labour-day-requests'],
    queryFn: async () => {
      const { data, error } = await supabase.from('labour_day_requests').select(SELECT)
        .order('work_date', { ascending: false }).limit(300)
      if (error) throw error
      return (data ?? []) as unknown as CrewRequest[]
    },
  })
  const mineAll = list.filter(r => r.pm_staff_id === pm)
  const current = mineAll.find(r => r.work_date === date) ?? null
  const nowDate = settings?.starts_on && settings.starts_on > today ? settings.starts_on : today
  const now = crewInEffect(mineAll, nowDate)
  const before = crewInEffect(mineAll, addDays(date, -1))
  const upcoming = mineAll.filter(r => r.work_date > nowDate && (r.status === 'submitted' || r.status === 'approved'))
    .sort((a, b) => a.work_date.localeCompare(b.work_date))

  const [lines, setLines] = useState<Line[]>([])
  const [note, setNote] = useState('')
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6])
  const [span, setSpan] = useState<Span>('until_changed')
  const [endsOn, setEndsOn] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  // Load the form from the request starting that day, or else the crew
  // that would be in effect, so a change starts from what's there.
  const base = current ?? before
  const formKey = `${pm}|${date}|${current?.id ?? ''}|${current?.status ?? ''}|${before?.id ?? ''}`
  const [loadedKey, setLoadedKey] = useState('')
  if (loadedKey !== formKey) {
    setLoadedKey(formKey)
    setLines(base ? base.labour_day_request_lines.map(l => ({ trade: l.trade_tag, headcount: l.headcount })) : [])
    setNote(current?.note ?? '')
    setDays(base?.weekdays ?? [1, 2, 3, 4, 5, 6])
    setSpan(current?.ends_on ? (current.ends_on === current.work_date ? 'one_day' : 'until_date') : 'until_changed')
    setEndsOn(current?.ends_on && current.ends_on !== current.work_date ? current.ends_on : '')
  }

  const started = !!settings?.starts_on
  const tooLate = date <= today
  const canAsk = !!pm && started && !tooLate && date >= (settings?.starts_on ?? '9999') && (!!me && pm === me.id || approver)
  const headcount = lines.reduce((s, l) => s + (l.headcount || 0), 0)
  const ends = span === 'one_day' ? date : span === 'until_date' ? endsOn || null : null

  const setLine = (i: number, f: (l: Line) => Line) => setLines(ls => ls.map((l, j) => (j === i ? f(l) : l)))
  const refresh = () => ['labour-day-requests', 'labour-day', 'labour-day-board', 'labour-flags', 'labour-day-todo'].forEach(k => qc.invalidateQueries({ queryKey: [k] }))

  async function save(submit: boolean, stop = false) {
    if (current?.status === 'approved' && !stop && !confirm('This change is already approved. Changing it sends it back for approval. Go ahead?')) return
    if (stop && !confirm(`Stop your crew from ${dayLabel(date)}? Nobody is expected from that day until you send a new crew.`)) return
    if (span === 'until_date' && !endsOn) { toast('Pick the last day', 'error'); return }
    setBusy(stop ? 'stop' : submit ? 'send' : 'save')
    const { error } = await supabase.rpc('labour_day_request_save', {
      p_pm: pm, p_date: date,
      p_lines: stop ? [] : lines.filter(l => l.trade && l.headcount > 0).map(l => ({ trade: l.trade, headcount: l.headcount })),
      p_note: note.trim() || null, p_submit: submit || stop,
      p_ends_on: stop ? null : ends, p_weekdays: stop ? [1, 2, 3, 4, 5, 6, 7] : days,
    })
    setBusy(null)
    if (error) { toast(error.message, 'error'); return }
    toast(stop ? `No crew from ${dayLabel(date)}` : submit ? 'Sent to operations' : 'Saved as a draft', 'success')
    refresh()
  }
  async function decide(r: CrewRequest, approve: boolean) {
    const why = approve ? null : prompt(`Why reject ${r.code}?`)
    if (!approve && !why?.trim()) return
    setBusy(r.id)
    const { error } = await supabase.rpc('labour_day_request_decide', { p_id: r.id, p_approve: approve, p_note: why?.trim() || null })
    setBusy(null)
    if (error) { toast(error.message, 'error'); return }
    toast(approve ? `${r.code} approved` : `${r.code} rejected`, 'success')
    refresh()
  }

  const toApprove = approver ? list.filter(r => r.status === 'submitted' && r.work_date > today).sort((a, b) => a.work_date.localeCompare(b.work_date)) : []
  const history = list.filter(r => (seeAll ? !params.get('pm') || r.pm_staff_id === pm : r.pm_staff_id === me?.id)).slice(0, 40)
  const tradeOptions = trades.map(t => ({ id: t.trade_tag, label: tradeName(t.trade_tag), sub: t.codename_amharic ?? undefined }))
  const crewText = (r: CrewRequest) => r.labour_day_request_lines.length
    ? r.labour_day_request_lines.map(l => `${l.headcount} ${tradeName(l.trade_tag).toLowerCase()}`).join(', ')
    : 'No crew'

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-slate-800 dark:text-slate-100"><ClipboardList className="h-5 w-5 text-brand" /> Labour request</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Your standing crew: how many of each trade, on which days, until you change it. Operations approves each change before it starts.</p>
        </div>
        <Link to="/labour/day" className="rounded-lg border px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300">Day sheet</Link>
      </div>

      {!started && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-800/40 dark:bg-amber-900/10 dark:text-amber-200">
          The labour request hasn't started yet — admin or operations set its start date in <Link to="/labour/days" className="underline">Review days → Settings</Link>.
        </p>
      )}

      {toApprove.length > 0 && (
        <section className={card}>
          <h2 className="border-b px-4 py-3 text-sm font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100">To approve <span className="text-slate-400">{toApprove.length}</span></h2>
          <ul className="divide-y dark:divide-slate-700">
            {toApprove.map(r => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{r.staff?.employee_name ?? '—'} · {crewSpan(r)}</p>
                  <p className="text-xs text-slate-500">{r.code} · {crewText(r)}{r.note ? ` · “${r.note}”` : ''}</p>
                </div>
                <button onClick={() => decide(r, false)} disabled={busy === r.id} className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium text-slate-600 dark:border-slate-600 dark:text-slate-300"><X className="h-3.5 w-3.5" /> Reject</button>
                <button onClick={() => decide(r, true)} disabled={busy === r.id} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"><Check className="h-3.5 w-3.5" /> Approve</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* The crew in effect */}
      {pm && started && (
        <section className={`${card} space-y-2 p-4`}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="flex flex-1 items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100"><Users className="h-4 w-4 text-slate-400" /> Crew now{seeAll && pms.find(p => p.id === pm) ? ` · ${pms.find(p => p.id === pm)!.name}` : ''}</h2>
            {seeAll && <SearchableSelect className="min-w-[13rem]" value={pm} onChange={v => setQ('pm', v)} options={pms.map(p => ({ id: p.id, label: p.name }))} placeholder="For which PM?" />}
          </div>
          {now ? (
            <p className="text-sm text-slate-700 dark:text-slate-200"><b>{crewText(now)}</b> <span className="text-slate-500">· {crewSpan(now)} · {now.code}</span></p>
          ) : <p className="text-sm text-slate-500">No crew approved yet. Set one below.</p>}
          {upcoming.map(r => (
            <p key={r.id} className={`text-xs ${r.status === 'approved' ? 'text-emerald-700 dark:text-emerald-300' : 'text-blue-700 dark:text-blue-300'}`}>
              {r.status === 'approved' ? 'Approved change' : 'Waiting for approval'}: {crewText(r)} · {crewSpan(r)}
            </p>
          ))}
        </section>
      )}

      {/* Set or change */}
      <section className={`${card} space-y-3 p-4`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{now || before ? 'Change from' : 'Starting'}</span>
          <input type="date" value={date} min={tomorrow} onChange={e => setQ('date', e.target.value || null)}
            className="rounded-lg border px-3 py-1.5 text-base sm:text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
          <span className="text-sm text-slate-600 dark:text-slate-300">{dayLabel(date)}</span>
          {current && <Pill tone={REQUEST_STATUS[current.status].tone}>{REQUEST_STATUS[current.status].label}</Pill>}
          {current && <span className="text-xs text-slate-400">{current.code}</span>}
        </div>
        {current?.status === 'rejected' && current.decision_note && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">Rejected by {current.decided_by_name}: {current.decision_note}. Change it and send it again.</p>
        )}
        {tooLate && <p className="text-sm text-slate-500">A change is approved before its first day — pick tomorrow or later.</p>}

        <ul className="space-y-2">
          {lines.map((l, i) => (
            <li key={i} className="flex items-center gap-2">
              <SearchableSelect className="flex-1" value={l.trade || null} onChange={v => setLine(i, x => ({ ...x, trade: v ?? '' }))}
                options={tradeOptions.filter(t => t.id === l.trade || !lines.some(o => o.trade === t.id))} placeholder="Trade…" disabled={!canAsk} />
              <div className="inline-flex items-center overflow-hidden rounded-lg border dark:border-slate-600">
                <button disabled={!canAsk || l.headcount <= 1} onClick={() => setLine(i, x => ({ ...x, headcount: x.headcount - 1 }))} className="px-2.5 py-2 disabled:opacity-40" aria-label="One fewer"><Minus className="h-3.5 w-3.5" /></button>
                <input type="number" min={1} value={l.headcount} disabled={!canAsk} onChange={e => setLine(i, x => ({ ...x, headcount: Math.max(1, Number(e.target.value) || 1) }))}
                  className="w-12 bg-transparent text-center text-base outline-none sm:text-sm dark:text-slate-100" />
                <button disabled={!canAsk} onClick={() => setLine(i, x => ({ ...x, headcount: x.headcount + 1 }))} className="px-2.5 py-2 disabled:opacity-40" aria-label="One more"><Plus className="h-3.5 w-3.5" /></button>
              </div>
              {canAsk && <button onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} className="rounded p-1.5 text-slate-400 hover:text-red-600" aria-label="Remove"><Trash2 className="h-4 w-4" /></button>}
            </li>
          ))}
        </ul>
        {canAsk && (
          <button onClick={() => setLines(ls => [...ls, { trade: '', headcount: 1 }])} className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-600 dark:text-slate-200"><Plus className="h-3.5 w-3.5" /> Add a trade</button>
        )}

        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-600 dark:text-slate-300">Working days</p>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((w, i) => {
              const d = i + 1
              const on = days.includes(d)
              return (
                <button key={w} type="button" disabled={!canAsk || span === 'one_day'} aria-pressed={on}
                  onClick={() => setDays(ds => (on ? (ds.length > 1 ? ds.filter(x => x !== d) : ds) : [...ds, d].sort()))}
                  className={`min-w-[2.75rem] rounded-lg border px-2 py-1.5 text-xs font-semibold disabled:opacity-60 ${on ? 'border-brand bg-brand text-white' : 'text-slate-500 dark:border-slate-600'}`}>{w}</button>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-700 dark:text-slate-200">
            {([['until_changed', 'Until I change it'], ['one_day', 'Only this day'], ['until_date', 'Until']] as [Span, string][]).map(([v, l]) => (
              <label key={v} className="flex items-center gap-1.5">
                <input type="radio" name="span" checked={span === v} disabled={!canAsk} onChange={() => setSpan(v)} /> {l}
              </label>
            ))}
            {span === 'until_date' && (
              <input type="date" value={endsOn} min={date} disabled={!canAsk} onChange={e => setEndsOn(e.target.value)}
                className="rounded-lg border px-2 py-1 text-base sm:text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            )}
          </div>
          {span === 'one_day' && (now || before) && <p className="text-xs text-slate-500">After {dayLabel(date)} your usual crew carries on.</p>}
        </div>

        <textarea value={note} onChange={e => setNote(e.target.value)} disabled={!canAsk} rows={2} placeholder="Note for operations (optional) — what's the work?"
          className="w-full rounded-lg border px-3 py-2 text-base sm:text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        {canAsk && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="mr-auto text-xs text-slate-500">{headcount} worker{headcount === 1 ? '' : 's'} a day</span>
            {(now || before) && (
              <button onClick={() => save(true, true)} disabled={!!busy} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-900/20">
                <Square className="h-3.5 w-3.5" /> {busy === 'stop' ? 'Stopping…' : 'Stop crew from this day'}
              </button>
            )}
            <button onClick={() => save(false)} disabled={!!busy} className="rounded-lg border px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200">{busy === 'save' ? 'Saving…' : 'Save draft'}</button>
            <button onClick={() => save(true)} disabled={!!busy || headcount === 0 || lines.some(l => !l.trade)}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              <Send className="h-4 w-4" /> {busy === 'send' ? 'Sending…' : current?.status === 'submitted' ? 'Send again' : 'Send for approval'}
            </button>
          </div>
        )}
      </section>

      {/* History */}
      <section className={card}>
        <h2 className="border-b px-4 py-3 text-sm font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100">Crew changes</h2>
        {isLoading ? <p className="p-6 text-center text-sm text-slate-400">Loading…</p> : history.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-400">No labour requests yet.</p>
        ) : (
          <ul className="divide-y dark:divide-slate-700">
            {history.map(r => (
              <li key={r.id}>
                <button onClick={() => { setQ('date', r.work_date); if (seeAll) setQ('pm', r.pm_staff_id) }} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/40">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-slate-800 dark:text-slate-100">{crewSpan(r)}{seeAll ? ` · ${r.staff?.employee_name ?? ''}` : ''}</p>
                    <p className="truncate text-xs text-slate-500">{r.code} · {crewText(r)}</p>
                  </div>
                  <Pill tone={REQUEST_STATUS[r.status].tone}>{REQUEST_STATUS[r.status].label}</Pill>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
