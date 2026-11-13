import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { dayLabel, fmtMoney, isoDay } from '@/lib/labour'
import {
  DAYS, payWeekFor, payWeekLine, useSitePulse, useSiteSlips, useWorkerHistory, usePayWeek,
  type PayWeek, type WorkerSlip,
} from '@/lib/labourGives'
import { CalendarClock, Check, Copy, MessageCircle, Send, Share2, TrendingDown, TrendingUp, X } from 'lucide-react'

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

const sheet = 'fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center'
const panel = 'flex max-h-[88vh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl dark:bg-slate-800 sm:rounded-2xl'

/**
 * The pay-day promise for the day being recorded: in time for which pay
 * day and how long is left, or that its cut-off has passed and when it is
 * paid now. Nothing while the promise is off.
 */
export function PayWeekBanner({ date }: { date: string }) {
  const { data: week } = usePayWeek()
  const p = payWeekFor(week, date)
  if (!p) return null
  return (
    <p className={`mb-3 flex items-start gap-2 rounded-xl px-3 py-2 text-sm ${p.onTime
      ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300'
      : 'bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300'}`}>
      <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" />
      {p.onTime
        ? <span>Record by <b>{p.cutoffLabel}</b> and it's paid <b>{p.payDayLabel}</b>. <span className="opacity-80">{p.left}.</span></span>
        : <span>The cut-off for {dayLabel(date)} has passed. Recorded now, it's paid <b>{p.payDayLabel}</b>, a week later than it could have been.</span>}
    </p>
  )
}

/** The pay week in one line; admin and operations can set it. */
export function PayWeekSettings({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { data: week } = usePayWeek()
  const [draft, setDraft] = useState<PayWeek | null>(null)
  const [busy, setBusy] = useState(false)
  if (!week || (!week.enabled && !canEdit)) return null
  const select = 'rounded-lg border px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800'

  async function save() {
    if (!draft) return
    setBusy(true)
    const { error } = await supabase.rpc('set_labour_pay_week', {
      p_enabled: draft.enabled, p_cutoff_dow: draft.cutoff_dow, p_cutoff_hour: draft.cutoff_hour, p_pay_dow: draft.pay_dow,
    })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['labour-pay-week'] })
    setDraft(null)
    toast(draft.enabled ? `Pay week set: ${lowerFirst(payWeekLine(draft))}` : 'Pay-day promise turned off', 'success')
  }

  if (!draft) {
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
        <CalendarClock className="h-3.5 w-3.5 shrink-0" />
        {week.enabled ? <span><b className="text-slate-700 dark:text-slate-200">Pay week:</b> {lowerFirst(payWeekLine(week))}.</span>
          : <span>No pay-day promise yet: people record without knowing when it's paid.</span>}
        {canEdit && <button onClick={() => setDraft(week)} className="font-medium text-brand">{week.enabled ? 'Change' : 'Set one'}</button>}
      </p>
    )
  }
  return (
    <div className="space-y-2 rounded-2xl border bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-800">
      <label className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-100">
        <input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} className="h-4 w-4 accent-brand" />
        Promise a pay day
      </label>
      <div className="flex flex-wrap items-center gap-2 text-slate-600 dark:text-slate-300">
        Recorded by
        <select className={select} value={draft.cutoff_dow} onChange={e => setDraft({ ...draft, cutoff_dow: Number(e.target.value) })}>
          {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
        </select>
        <select className={select} value={draft.cutoff_hour} onChange={e => setDraft({ ...draft, cutoff_hour: Number(e.target.value) })}>
          {[12, 14, 16, 17, 18, 19, 20].map(h => <option key={h} value={h}>{h === 12 ? '12 noon' : `${h - 12} pm`}</option>)}
        </select>
        is paid on
        <select className={select} value={draft.pay_dow} onChange={e => setDraft({ ...draft, pay_dow: Number(e.target.value) })}>
          {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
        </select>
      </div>
      <p className="text-xs text-slate-500">Everyone recording sees the countdown, and a day recorded late shows the later pay day. Finance has to keep the promise for it to mean anything.</p>
      <div className="flex gap-2">
        <button onClick={save} disabled={busy} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
        <button onClick={() => setDraft(null)} className="rounded-lg px-3 py-1.5 text-sm text-slate-500">Cancel</button>
      </div>
    </div>
  )
}

/**
 * What recording gives the site manager back: this week's labour on the
 * site against last week's, the total against the labour budget, and what
 * the volume work produced. Nothing for people who don't see costs.
 */
export function SitePulseCard({ projectId, title }: { projectId: string; title?: string }) {
  const { data: p } = useSitePulse(projectId)
  if (!p || (Number(p.total_cost) === 0 && Number(p.week_cost) === 0)) return null
  const week = Number(p.week_cost), last = Number(p.last_week_cost), total = Number(p.total_cost)
  const budget = p.budget != null && Number(p.budget) > 0 ? Number(p.budget) : null
  const used = budget ? Math.round((total / budget) * 100) : null
  const up = week > last
  return (
    <section className="mt-4 rounded-2xl border bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title ? `${title}, this week` : 'This site, this week'}</h2>
      <div className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          <p className="text-xl font-bold text-slate-800 dark:text-slate-100">{fmtMoney(week)}</p>
          <p className="text-xs text-slate-500">
            {[`${Number(p.week_workers)} worker${Number(p.week_workers) === 1 ? '' : 's'}`,
              Number(p.week_days) > 0 ? `${Number(p.week_days)} day${Number(p.week_days) === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')} recorded since {dayLabel(p.week_start)}
          </p>
        </div>
        {last > 0 && (
          <p className="flex items-center gap-1 text-xs text-slate-500">
            {up ? <TrendingUp className="h-3.5 w-3.5 text-amber-500" /> : <TrendingDown className="h-3.5 w-3.5 text-emerald-500" />}
            last week {fmtMoney(last)}
          </p>
        )}
      </div>
      {budget ? (
        <div className="mt-3">
          <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
            <div className={`h-full rounded-full ${used! > 100 ? 'bg-red-500' : used! > 85 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(used!, 100)}%` }} />
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Labour so far <b className="text-slate-700 dark:text-slate-200">{fmtMoney(total)}</b> of a {fmtMoney(budget)} budget ({used}%)
            {used! > 100 ? <span className="font-medium text-red-600"> · {fmtMoney(total - budget)} over</span> : <span> · {fmtMoney(budget - total)} left</span>}
          </p>
        </div>
      ) : (
        <p className="mt-2 text-xs text-slate-500">Labour on this site so far: <b className="text-slate-700 dark:text-slate-200">{fmtMoney(total)}</b>. No labour budget is set for it.</p>
      )}
      {p.output.length > 0 && (
        <ul className="mt-3 space-y-1 border-t pt-2 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">
          {p.output.map((o, i) => (
            <li key={`${o.role}-${i}`} className="flex flex-wrap justify-between gap-x-3">
              <span className="font-medium">{o.role}</span>
              {o.basis === 'fixed_price' ? (
                <span>
                  {Number(o.week) > 0 ? `${Number(o.week)}% more this week` : 'nothing more this week'}{Number(o.last_week) > 0 ? ` (last week ${Number(o.last_week)}%)` : ''}
                  {' · '}{Number(o.total) >= 100 ? 'the task is done' : `${Number(o.total)}% done`}
                </span>
              ) : (
                <span>
                  {Number(o.week)} {o.unit ?? 'units'} this week{Number(o.last_week) > 0 ? ` (last week ${Number(o.last_week)})` : ''}
                  {o.planned ? ` · ${Number(o.total)} of ${Number(o.planned)} done` : ''}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * Each worker's week on the site, to tell them: a message ready to share
 * from this phone (WhatsApp, Telegram, SMS), or copied. Workers linked to
 * the bot are told by it each evening.
 */
export function WorkerSlipsSheet({ projectIds, date, onClose }: { projectIds: string[]; date: string; onClose: () => void }) {
  const { toast } = useToast()
  const { data: slips = [], isLoading } = useSiteSlips(projectIds, date)
  const idOf = (s: WorkerSlip) => s.staff_id ?? `job:${s.name}`
  const [open, setOpen] = useState<string | null>(null)
  const [done, setDone] = useState<Set<string>>(new Set())

  async function tell(s: WorkerSlip) {
    try {
      if (navigator.share) await navigator.share({ text: s.message })
      else { await navigator.clipboard.writeText(s.message); toast('Copied. Paste it in a message to them.', 'success') }
      setDone(d => new Set(d).add(idOf(s)))
    } catch { /* closed the share sheet: nothing sent */ }
  }
  async function copy(s: WorkerSlip) {
    try { await navigator.clipboard.writeText(s.message); toast('Copied', 'success'); setDone(d => new Set(d).add(idOf(s))) }
    catch { toast('Could not copy on this phone', 'error') }
  }
  const total = slips.reduce((n, s) => n + Number(s.amount), 0)

  return (
    <div className={sheet} onClick={onClose}>
      <div className={panel} onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3 dark:border-slate-700">
          <div>
            <h3 className="font-semibold text-slate-800 dark:text-slate-100">Tell the workers</h3>
            <p className="text-xs text-slate-500">What is recorded for each of them in the week of {dayLabel(date)}: days, piece work measured, or how far a task has got. A worker who sees it asks for what's missing.</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? <p className="p-6 text-center text-sm text-slate-400">Loading…</p> : slips.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-500">Nothing is recorded for that week yet.</p>
          ) : (
            <ul className="divide-y dark:divide-slate-700">
              {slips.map(s => (
                <li key={idOf(s)} className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <button onClick={() => setOpen(open === idOf(s) ? null : idOf(s))} className="min-w-0 flex-1 text-left">
                      <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{s.name}</p>
                      <p className="text-xs text-slate-500">
                        {s.summary ? `${s.summary} · ` : ''}{fmtMoney(Number(s.amount))}
                        {Number(s.crew) > 1 && ` · for a crew of ${Number(s.crew)}`}
                        {!s.staff_id ? <span className="text-amber-600"> · no one is named on this job</span>
                          : s.linked ? <span className="text-emerald-600"> · told by the bot each evening</span> : s.phone ? ` · ${s.phone}` : <span className="text-amber-600"> · no phone on record</span>}
                      </p>
                    </button>
                    {done.has(idOf(s)) && <Check className="h-4 w-4 shrink-0 text-emerald-500" />}
                    <button onClick={() => copy(s)} className="shrink-0 rounded-lg border p-2 text-slate-500 dark:border-slate-600" aria-label={`Copy ${s.name}'s slip`}><Copy className="h-4 w-4" /></button>
                    <button onClick={() => tell(s)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white">
                      <Share2 className="h-3.5 w-3.5" /> Send
                    </button>
                  </div>
                  {open === idOf(s) && (
                    <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-2.5 font-sans text-xs text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">{s.message}</pre>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        {slips.length > 0 && (
          <p className="border-t px-4 py-2.5 text-xs text-slate-500 dark:border-slate-700">
            {(() => { const w = slips.filter(s => s.staff_id).length, j = slips.length - w
              return [w ? `${w} worker${w === 1 ? '' : 's'}` : null, j ? `${j} job${j === 1 ? '' : 's'} with no one named` : null].filter(Boolean).join(' and ') })()} · {fmtMoney(total)} recorded that week.
            {' '}HR can link a worker to the Telegram bot on their staff page; then they are told without anyone sending anything.
          </p>
        )}
      </div>
    </div>
  )
}

/** A worker's record: how much they have worked, where, at what, and when last. */
export function WorkerHistorySheet({ staffId, onClose }: { staffId: string; onClose: () => void }) {
  const { data: h, isLoading } = useWorkerHistory(staffId)
  const today = isoDay(new Date())
  const daysAgo = h?.last_day ? Math.round((new Date(`${today}T12:00:00`).getTime() - new Date(`${h.last_day}T12:00:00`).getTime()) / 86_400_000) : null
  return (
    <div className={sheet} onClick={onClose}>
      <div className={panel} onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3 dark:border-slate-700">
          <div className="min-w-0">
            <h3 className="truncate font-semibold text-slate-800 dark:text-slate-100">{h?.name ?? 'Worker'}</h3>
            <p className="text-xs text-slate-500">
              {[h?.trade, h?.phone, h ? (h.verified ? 'verified by HR' : 'not verified by HR yet') : null].filter(Boolean).join(' · ')}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {isLoading ? <p className="py-6 text-center text-sm text-slate-400">Loading…</p> : !h ? (
            <p className="py-6 text-center text-sm text-slate-500">No record to show.</p>
          ) : Number(h.days_recorded) === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">No work is recorded for them yet. Their record builds from the first day someone records.</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-900/40">
                  <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{Number(h.days) > 0 ? Number(h.days) : Number(h.days_recorded)}</p>
                  <p className="text-[11px] text-slate-500">{Number(h.days) > 0 ? 'days worked' : 'days with work recorded'}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-900/40">
                  <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{h.sites.length}</p>
                  <p className="text-[11px] text-slate-500">site{h.sites.length === 1 ? '' : 's'}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-900/40">
                  <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{daysAgo === 0 ? 'today' : daysAgo === 1 ? '1 day' : `${daysAgo} days`}</p>
                  <p className="text-[11px] text-slate-500">{daysAgo === 0 ? 'last worked' : 'since last worked'}</p>
                </div>
              </div>
              <p className="text-xs text-slate-500">
                With us since {h.first_day ? dayLabel(h.first_day) : '—'}
                {h.on_site_now ? <> · on <b className="text-slate-700 dark:text-slate-200">{h.on_site_now}</b> now</> : ' · not on a site now'}
                {h.day_rate != null && <> · {fmtMoney(Number(h.day_rate))} a day</>}
                {(h.piece ?? []).length > 0 && <> · by the piece: {h.piece.map(x => `${Number(x.qty).toLocaleString()} ${x.unit}`).join(', ')}</>}
                {Number(h.tasks) > 0 && <> · {Number(h.tasks)} fixed-price task{Number(h.tasks) === 1 ? '' : 's'}</>}
                {h.earned != null && <> · earned {fmtMoney(Number(h.earned))} in all</>}
              </p>
              <ul className="divide-y rounded-xl border dark:divide-slate-700 dark:border-slate-700">
                {h.sites.map(s => (
                  <li key={s.project} className="px-3 py-2">
                    <p className="flex justify-between gap-2 text-sm text-slate-800 dark:text-slate-100"><span className="truncate font-medium">{s.project}</span><span className="shrink-0 text-slate-500">{Number(s.days)} day{Number(s.days) === 1 ? '' : 's'}</span></p>
                    <p className="truncate text-xs text-slate-500">{s.work ?? 'Labour'} · last {dayLabel(s.last_day)}</p>
                  </li>
                ))}
              </ul>
              <p className="flex items-center gap-1.5 text-xs text-slate-500">
                {h.linked ? <><Send className="h-3.5 w-3.5 text-emerald-500" /> Told by the bot each evening what was recorded for them.</>
                  : <><MessageCircle className="h-3.5 w-3.5" /> Not linked to the Telegram bot: tell them from "Tell the workers".</>}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
