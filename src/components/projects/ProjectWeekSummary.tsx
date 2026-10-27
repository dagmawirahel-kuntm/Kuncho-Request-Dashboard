import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { Pill } from '@/components/record/Record'
import { dayLabel, fmtMoney } from '@/lib/labour'
import { progressText, thisMonday, useProjectWeek, weekAsText, type ProjectWeek } from '@/lib/weekSummary'
import { DayBars, WeekNav } from './WeekParts'
import { AlertTriangle, CheckCircle2, Copy, MessageCircle, Send } from 'lucide-react'

const card = 'rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800'

// The project's week on one screen (480): people and days, each work order
// worked with its progress, what finished or is late, where pay stands and
// what needs a hand. The same week goes to the site's Telegram group.
export function ProjectWeekSummary({ projectId }: { projectId: string }) {
  const { toast } = useToast()
  const [from, setFrom] = useState(thisMonday())
  const { data: w, isLoading } = useProjectWeek(projectId, from)

  async function copy() {
    if (!w) return
    try { await navigator.clipboard.writeText(weekAsText(w)); toast('Summary copied — paste it anywhere', 'success') }
    catch { toast('Could not copy', 'error') }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex-1"><WeekNav from={from} onChange={setFrom} /></div>
        {w && <button onClick={copy} className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300"><Copy className="h-3.5 w-3.5" /> Copy</button>}
      </div>
      {isLoading || !w ? <p className="py-10 text-center text-sm text-slate-400">{isLoading ? 'Loading…' : 'Nothing to show.'}</p> : <Week w={w} />}
      {w && <TelegramGroups projectId={projectId} w={w} />}
    </div>
  )
}

function Week({ w }: { w: ProjectWeek }) {
  const l = w.labour
  const delta = l.prev_person_days ? l.person_days - l.prev_person_days : null
  const attention = [
    ...(w.pay.returned ? [{ text: `${w.pay.returned} payment request sent back by finance`, to: '/labour/requests?view=mine' }] : []),
    ...(w.pay.to_request ? [{ text: `${w.pay.to_request} confirmed pay sheet${w.pay.to_request === 1 ? '' : 's'} not yet sent to finance${w.costs && w.pay.to_request_amount ? ` (${fmtMoney(w.pay.to_request_amount)})` : ''}`, to: '/labour/requests?view=mine' }] : []),
    ...(w.unverified ? [{ text: `${w.unverified} worker${w.unverified === 1 ? '' : 's'} on site not verified by HR`, to: '/hr/worker-register' }] : []),
    ...(w.quiet_requests ? [{ text: `${w.quiet_requests} labour request${w.quiet_requests === 1 ? '' : 's'} with no work for 3 weeks`, to: '/labour' }] : []),
    ...(l.no_work_order_days ? [{ text: `${l.no_work_order_days} person-days recorded without a work order`, to: '/labour/record' }] : []),
  ]
  const noUpdate = w.orders.filter(o => o.flags.includes('no_update')).length

  return <>
    <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
      <div className={`${card} p-4`}>
        <p className="text-xs uppercase tracking-wide text-slate-400">On site</p>
        <p className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">{l.person_days} <span className="text-sm font-medium text-slate-500">person-days</span></p>
        <p className="text-xs text-slate-500">
          {l.workers} worker{l.workers === 1 ? '' : 's'} · {l.days_on_site} day{l.days_on_site === 1 ? '' : 's'} on site
          {delta != null && <> · <span className={delta < 0 ? 'text-amber-600' : 'text-emerald-600'}>{delta >= 0 ? '+' : ''}{delta} vs last week</span></>}
          {l.overtime_hours > 0 && ` · ${l.overtime_hours} h overtime`}
        </p>
        {w.costs && l.cost != null && <p className="mt-1 text-xs text-slate-500">Labour {fmtMoney(l.cost)}{l.prev_cost ? ` · last week ${fmtMoney(l.prev_cost)}` : ''}</p>}
      </div>
      <div className={`${card} p-4`}>
        <p className="mb-2 text-xs uppercase tracking-wide text-slate-400">People each day</p>
        <DayBars days={l.by_day} />
      </div>
    </div>

    <section className={card}>
      <h3 className="flex items-center justify-between border-b px-4 py-3 text-sm font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100">
        Work orders this week
        {noUpdate > 0 && <span className="text-xs font-normal text-amber-600">{noUpdate} worked with no progress update</span>}
      </h3>
      {w.orders.length === 0 ? <p className="p-5 text-center text-sm text-slate-400">No work order was worked or updated this week.</p> : (
        <ul className="divide-y dark:divide-slate-700">
          {w.orders.map(o => (
            <li key={o.id}>
              <Link to={`/work-orders/${o.id}`} className="block px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/40">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{o.title}</p>
                    <p className="text-xs text-slate-500">
                      {o.person_days > 0 ? `${o.person_days} person-day${o.person_days === 1 ? '' : 's'} · ${o.workers} worker${o.workers === 1 ? '' : 's'}` : 'No labour this week'}
                      {w.costs && o.cost ? ` · ${fmtMoney(o.cost)}` : ''}
                      {o.due ? ` · due ${dayLabel(o.due)}` : ''}
                    </p>
                    {o.note && <p className="mt-0.5 truncate text-xs italic text-slate-500">“{o.note}”</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`text-sm font-semibold ${o.updated ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400'}`}>{progressText(o)}</p>
                    <div className="mt-0.5 flex justify-end gap-1">
                      {o.status === 'completed' && <Pill tone="green">Done</Pill>}
                      {o.flags.includes('no_update') && <Pill tone="amber">No update</Pill>}
                      {o.flags.includes('overdue') && <Pill tone="red">Overdue</Pill>}
                    </div>
                  </div>
                </div>
                {o.now != null && (
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700" aria-hidden>
                    <div className="relative h-full rounded-full bg-brand/70" style={{ width: `${Math.min(100, o.now)}%` }}>
                      {o.updated && o.before != null && o.before < o.now && (
                        <div className="absolute inset-y-0 left-0 rounded-full bg-brand/30" style={{ width: `${(o.before / o.now) * 100}%` }} />
                      )}
                    </div>
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>

    {(w.finished.length > 0 || w.overdue.length > 0) && (
      <div className="grid gap-3 sm:grid-cols-2">
        {w.finished.length > 0 && (
          <div className={`${card} p-4 text-sm`}>
            <p className="mb-1 flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4" /> Finished</p>
            <ul className="space-y-0.5 text-slate-700 dark:text-slate-300">{w.finished.map(t => <li key={t} className="truncate">{t}</li>)}</ul>
          </div>
        )}
        {w.overdue.length > 0 && (
          <div className={`${card} p-4 text-sm`}>
            <p className="mb-1 flex items-center gap-1.5 font-semibold text-red-700 dark:text-red-400"><AlertTriangle className="h-4 w-4" /> {w.overdue.length} overdue</p>
            <ul className="space-y-0.5 text-slate-700 dark:text-slate-300">
              {w.overdue.slice(0, 5).map(o => <li key={o.title + o.due} className="flex justify-between gap-2"><span className="truncate">{o.title}</span><span className="shrink-0 text-xs text-slate-400">{dayLabel(o.due)}</span></li>)}
              {w.overdue.length > 5 && <li className="text-xs text-slate-400">and {w.overdue.length - 5} more</li>}
            </ul>
          </div>
        )}
      </div>
    )}

    {attention.length > 0 && (
      <section className={`${card} border-amber-200 dark:border-amber-900/40`}>
        <h3 className="border-b px-4 py-3 text-sm font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100">Needs a hand</h3>
        <ul className="divide-y text-sm dark:divide-slate-700">
          {attention.map(a => (
            <li key={a.text}><Link to={a.to} className="flex items-center justify-between gap-2 px-4 py-2.5 text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/40">{a.text}<span className="text-xs text-brand">Open</span></Link></li>
          ))}
        </ul>
      </section>
    )}
    {w.pay.with_finance > 0 && <p className="text-xs text-slate-500">{w.pay.with_finance} payment request{w.pay.with_finance === 1 ? ' is' : 's are'} with finance.{w.costs && w.pay.paid_week ? ` Paid this week: ${fmtMoney(w.pay.paid_week)}.` : ''}</p>}
  </>
}

function TelegramGroups({ projectId, w }: { projectId: string; w: ProjectWeek }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [code, setCode] = useState<{ code: string; bot: string | null } | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['project-week', projectId] })

  async function makeCode() {
    const { data, error } = await supabase.rpc('project_telegram_link_code', { p_project: projectId })
    if (error) { toast(error.message, 'error'); return }
    setCode(data as { code: string; bot: string | null })
  }
  async function set(chat: number, patch: { p_show_costs?: boolean; p_unlink?: boolean }) {
    const { error } = await supabase.rpc('project_telegram_group_set', { p_project: projectId, p_chat: chat, ...patch })
    if (error) { toast(error.message, 'error'); return }
    refresh()
  }

  if (!w.can_link && w.groups.length === 0) return null
  return (
    <section className={`${card} p-4 text-sm`}>
      <p className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-100"><MessageCircle className="h-4 w-4 text-sky-500" /> Telegram site group</p>
      <p className="mt-0.5 text-xs text-slate-500">This summary is posted to the group every Saturday evening. Anyone in the group can send /week for the week so far.</p>
      {w.groups.length > 0 && (
        <ul className="mt-3 space-y-2">
          {w.groups.map(g => (
            <li key={g.chat_id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-900/30">
              <span className="w-full truncate font-medium sm:w-auto sm:min-w-0 sm:flex-1">{g.title ?? 'Telegram group'}</span>
              <span className="mr-auto text-xs text-slate-400 sm:mr-0">{g.last_posted_at ? `last posted ${dayLabel(g.last_posted_at.slice(0, 10))}` : 'not posted yet'}</span>
              {w.can_link && <>
                <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
                  <input type="checkbox" checked={g.show_costs} onChange={e => set(g.chat_id, { p_show_costs: e.target.checked })} className="accent-brand" /> Show money
                </label>
                <button onClick={() => { if (confirm('Stop posting to this group?')) set(g.chat_id, { p_unlink: true }) }} className="text-xs text-slate-400 hover:text-red-600">Unlink</button>
              </>}
            </li>
          ))}
        </ul>
      )}
      {w.can_link && (code ? (
        <ol className="mt-3 list-decimal space-y-1 rounded-lg border border-sky-200 bg-sky-50 py-3 pl-8 pr-3 text-sm text-sky-900 dark:border-sky-900/40 dark:bg-sky-900/10 dark:text-sky-200">
          <li>Add <b>@{code.bot ?? 'the Kuncho bot'}</b> to the site's Telegram group.</li>
          <li>Send this in the group: <code className="rounded bg-white px-1.5 py-0.5 font-mono font-bold dark:bg-slate-800">/link {code.code}</code></li>
          <li>The code works once, for 2 days.</li>
        </ol>
      ) : (
        <button onClick={makeCode} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200">
          <Send className="h-3.5 w-3.5" /> {w.groups.length ? 'Link another group' : 'Link a Telegram group'}
        </button>
      ))}
    </section>
  )
}
