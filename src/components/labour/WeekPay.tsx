import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { Pill, type Tone } from '@/components/record/Record'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { addDays, dayLabel, fmtMoney, isoDay } from '@/lib/labour'
import { projectLabel, useDayPeople, useLabourProjects } from '@/lib/labourDay'
import { CalendarDays, ChevronRight, Undo2 } from 'lucide-react'

type Stage = 'days' | 'prepare' | 'send' | 'finance' | 'paid' | 'nothing'
type WeekRow = {
  pm_staff_id: string; pm_name: string; week_of: string
  days_open: number; days_review: number; days_locked: number
  amount: number; to_prepare: number
  projects: { project_id: string; name: string; amount: number }[]
  requests: { id: string; code: string; status: string }[]
  run_from: string | null; run_to: string | null
  stage: Stage
  project_id: string; project_name: string
}

const card = 'rounded-2xl border bg-white dark:border-slate-700 dark:bg-slate-800'
const STAGE: Record<Stage, { label: string; tone: Tone }> = {
  days: { label: 'Days not locked', tone: 'amber' },
  prepare: { label: 'Ready to prepare', tone: 'blue' },
  send: { label: 'Waiting for the PM to send', tone: 'violet' },
  finance: { label: 'With finance', tone: 'brand' },
  paid: { label: 'Paid', tone: 'green' },
  nothing: { label: 'Nothing to pay', tone: 'slate' },
}
const mondayOf = (iso: string) => { const d = new Date(`${iso}T00:00:00`); return addDays(iso, -((d.getDay() + 6) % 7)) }
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

// Labour pay by the week (540): one line per PM per week, Monday to Sunday —
// what it costs, by site, where it is, and the one thing to do next.
export function WeekPay() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { me, approver } = useDayPeople()
  const { data: projects = [] } = useLabourProjects()
  const [project, setProject] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const from = addDays(mondayOf(isoDay(new Date())), -35)

  const { data: weeks = [], isLoading } = useQuery({
    queryKey: ['labour-pay-weeks', from, project],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('labour_pay_weeks', { p_from: from, p_project: project })
      if (error) throw error
      return (data ?? []) as WeekRow[]
    },
  })
  const refresh = () => ['labour-pay-weeks', 'labour-pay-pipeline', 'labour-pay-requests', 'labour-payable-drafts', 'labour-day', 'labour-day-board', 'labour-flags', 'labour-pay-sheets-recent']
    .forEach(k => qc.invalidateQueries({ queryKey: [k] }))
  const canRun = (w: WeekRow) => approver || (!!me && w.pm_staff_id === me.id)
  const key = (w: WeekRow) => `${w.project_id}|${w.week_of}`
  const weekLabel = (w: string) => `${dayLabel(w)} – ${dayLabel(addDays(w, 6))}`

  async function prepare(w: WeekRow) {
    setBusy(key(w))
    const { data, error } = await supabase.rpc('labour_week_pay_prepare', { p_project: w.project_id, p_week: w.week_of })
    setBusy(null)
    if (error) { toast(error.message, 'error'); return }
    const r = data as { request_id: string; code: string; total: number }
    toast(`${r.code}: ${fmtMoney(Number(r.total))} for the week of ${dayLabel(w.week_of)}. Attach the signed attendance sheet and send it.`, 'success')
    refresh()
    navigate(`/labour/requests/${r.request_id}`)
  }

  async function undo(w: WeekRow) {
    const wider = w.run_from && w.run_to && (w.run_from < w.week_of || w.run_to > addDays(w.week_of, 6))
    const reason = prompt(`Undo the pay for ${w.project_name}, week of ${dayLabel(w.week_of)}?${wider ? `\n\nThis pay was made together with ${dayLabel(w.run_from!)} – ${dayLabel(w.run_to!)}; all of it comes back.` : ''}\n\nWhy?`)
    if (!reason?.trim()) return
    const sendBack = confirm('Also send the days back to the PM to rewrite?\n\nOK — send them back.\nCancel — keep them locked (you can still change them).')
    setBusy(key(w))
    const { data, error } = await supabase.rpc('labour_week_pay_undo', { p_project: w.project_id, p_week: w.week_of, p_reason: reason.trim(), p_send_back: sendBack })
    setBusy(null)
    if (error) { toast(error.message, 'error'); return }
    const r = data as { from: string; to: string; total: number; requests: string | null; sent_back: number }
    toast(`Pay for ${dayLabel(r.from)} – ${dayLabel(r.to)} undone (${fmtMoney(Number(r.total))})${r.requests ? `, taken out of ${r.requests}` : ''}${r.sent_back ? `. ${plural(r.sent_back, 'day')} sent back to the PM` : ''}.`, 'success')
    refresh()
  }

  const byWeek = new Map<string, WeekRow[]>()
  for (const w of weeks) byWeek.set(w.week_of, [...(byWeek.get(w.week_of) ?? []), w])

  return (
    <section className={card}>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3 dark:border-slate-700">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-100"><CalendarDays className="h-4 w-4 text-brand" /> Pay by week</h2>
          <p className="text-xs text-slate-500">Each project's week, Monday to Sunday, is paid on its own request, signed by the project's PM.</p>
        </div>
        {projects.length > 1 && <SearchableSelect className="min-w-[12rem]" value={project} onChange={setProject} options={projects.map(p => ({ id: p.project_id, label: projectLabel(p) }))} placeholder="All projects" />}
      </div>
      {isLoading ? <p className="p-6 text-center text-sm text-slate-400">Loading…</p> : weeks.length === 0 ? (
        <p className="p-6 text-center text-sm text-slate-500">No day sheets in the last few weeks.</p>
      ) : (
        <div className="divide-y dark:divide-slate-700">
          {[...byWeek].map(([wk, rows]) => (
            <div key={wk}>
              <p className="bg-slate-50 px-4 py-1.5 text-xs font-semibold text-slate-500 dark:bg-slate-900/40">Week of {weekLabel(wk)}</p>
              <ul className="divide-y dark:divide-slate-700">
                {rows.map(w => {
                  const st = STAGE[w.stage]
                  const req = w.requests.find(r => r.status === 'draft' || r.status === 'returned') ?? w.requests[0]
                  const notLocked = w.days_open + w.days_review
                  const canUndo = approver && w.requests.length > 0 && (w.stage === 'send' || w.stage === 'prepare')
                  return (
                    <li key={key(w)} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                          {w.project_name} <span className="tabular-nums">· {fmtMoney(Number(w.amount))}</span>{w.pm_name && <span className="font-normal text-slate-500"> · {w.pm_name}</span>}
                        </p>
                        {w.projects.length > 1 && (
                          <p className="text-xs text-slate-500">{w.projects.map(p => `${p.name.trim()} ${fmtMoney(Number(p.amount))}`).join(' · ')}</p>
                        )}
                        <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
                          {w.stage === 'days' && <>{plural(notLocked, 'day')} not locked yet{w.days_review ? ` (${w.days_review} waiting for review)` : ''}</>}
                          {w.stage === 'prepare' && <>{fmtMoney(Number(w.to_prepare))} locked and not in a request yet</>}
                          {w.stage === 'send' && req && <>{req.code} — the PM attaches the signed attendance sheet and sends it</>}
                          {w.stage === 'finance' && <>{w.requests.map(r => r.code).join(', ')} with finance</>}
                          {w.stage === 'paid' && <>{w.requests.map(r => r.code).join(', ')} paid</>}
                        </p>
                      </div>
                      <Pill tone={st.tone}>{st.label}</Pill>
                      {w.stage === 'days' && (
                        <Link to={approver ? '/labour/days' : `/labour/week-sheet?week=${w.week_of}&project=${w.project_id}`} className="text-xs font-medium text-brand hover:underline">
                          {approver ? 'Review days' : 'Week sheet'}
                        </Link>
                      )}
                      {w.stage === 'prepare' && canRun(w) && (
                        <button onClick={() => prepare(w)} disabled={busy === key(w)} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                          {busy === key(w) ? 'Preparing…' : 'Prepare pay'}
                        </button>
                      )}
                      {req && w.stage !== 'prepare' && w.stage !== 'days' && (
                        <Link to={`/labour/requests/${req.id}`} className="flex items-center text-xs font-medium text-brand hover:underline">Open {req.code}<ChevronRight className="h-3.5 w-3.5" /></Link>
                      )}
                      {canUndo && (
                        <button onClick={() => undo(w)} disabled={busy === key(w)} title="Take this week's pay back to change its days"
                          className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-900/20">
                          <Undo2 className="h-3.5 w-3.5" /> Undo
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
