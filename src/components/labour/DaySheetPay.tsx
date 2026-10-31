import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { Pill } from '@/components/record/Record'
import { dayLabel, fmtMoney, isoDay } from '@/lib/labour'
import { halfDays, useDayPeople } from '@/lib/labourDay'
import { ChevronRight, Sheet, Undo2, X } from 'lucide-react'

type Unpaid = { pm_staff_id: string; pm_name: string; locked_days: number; first_day: string | null; last_day: string | null; workers: number; amount: number; waiting_review: number; open_days: number }
type Preview = {
  from: string | null; last: string | null; total: number; days: number; not_locked: number
  workers: { staff_id: string; name: string; days: number; rate: number; overtime_hours: number; overtime: number; amount: number; verified: boolean; held: boolean; no_rate: boolean }[]
  projects: { project_id: string; name: string; internal: boolean; amount: number; build_days: number | null; repair_days: number | null; other_days: number | null }[]
  jobs: { id: string; what: string; project: string; basis: 'per_volume' | 'fixed_price'; unit: string | null; quantity: number | null; percent: number | null; rate: number; amount: number; paid_to: string }[]
}
type Run = { id: string; code: string; pm_staff_id: string; period_start: string; period_end: string; total: number; confirmed_by_name: string | null; confirmed_at: string; staff: { employee_name: string } | null }
const card = 'rounded-2xl border bg-white dark:border-slate-700 dark:bg-slate-800'

// Pay from the day sheets (490, 492): the PM confirms their locked days up
// to a date — each worker's own day rate, overtime at company rates, and
// the piece work measured on those days — as one payable per project for
// the day workers and one per piece job, ready for a payment request.
export function DaySheetPay() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { me, approver } = useDayPeople()
  const [open, setOpen] = useState<string | null>(null)
  const [to, setTo] = useState(isoDay(new Date()))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const { data: unpaid = [] } = useQuery({
    queryKey: ['labour-day-unpaid'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('labour_day_unpaid')
      if (error) throw error
      return (data ?? []) as Unpaid[]
    },
  })
  const { data: runs = [] } = useQuery({
    queryKey: ['labour-day-pay-runs'],
    queryFn: async () => {
      const { data, error } = await supabase.from('labour_day_pay_runs')
        .select('id, code, pm_staff_id, period_start, period_end, total, confirmed_by_name, confirmed_at, staff:pm_staff_id(employee_name)')
        .order('confirmed_at', { ascending: false }).limit(10)
      if (error) throw error
      return (data ?? []) as unknown as Run[]
    },
  })
  const { data: preview } = useQuery({
    queryKey: ['labour-day-pay-preview', open, to],
    enabled: !!open,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('labour_day_pay_preview', { p_pm: open, p_to: to })
      if (error) throw error
      return data as Preview
    },
  })
  const refresh = () => ['labour-day-unpaid', 'labour-day-pay-runs', 'labour-day-pay-preview', 'labour-payable-drafts', 'labour-day', 'labour-flags']
    .forEach(k => qc.invalidateQueries({ queryKey: [k] }))
  const canRun = (pm: string) => approver || pm === me?.id

  async function confirmPay() {
    if (!open) return
    setBusy('confirm')
    const { data, error } = await supabase.rpc('confirm_labour_day_pay', { p_pm: open, p_to: to, p_note: note.trim() || null })
    setBusy(null)
    if (error) { toast(error.message, 'error'); return }
    toast('Pay confirmed — now send it to finance in a payment request', 'success')
    setOpen(null); setNote('')
    refresh()
    void data
  }
  async function reopen(r: Run) {
    if (!confirm(`Reopen ${r.code}? Its payables are taken back and the days can be changed and confirmed again.`)) return
    setBusy(r.id)
    const { error } = await supabase.rpc('reopen_labour_day_pay', { p_run: r.id })
    setBusy(null)
    if (error) { toast(error.message, 'error'); return }
    toast(`${r.code} reopened`, 'success')
    refresh()
  }

  const shown = unpaid.filter(u => u.locked_days > 0 || u.waiting_review > 0 || u.open_days > 0)
  if (!shown.length && !runs.length) return null
  const current = shown.find(u => u.pm_staff_id === open)

  return (
    <section className={card}>
      <h2 className="flex items-center gap-2 border-b px-4 py-3 font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100"><Sheet className="h-4 w-4 text-brand" /> Day sheets to pay</h2>
      {open && current ? (
        <div className="space-y-3 p-4">
          <div className="flex items-center gap-2">
            <p className="flex-1 text-sm font-semibold text-slate-800 dark:text-slate-100">{current.pm_name}</p>
            <button onClick={() => setOpen(null)} className="rounded p-1 text-slate-400"><X className="h-4 w-4" /></button>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">Locked days up to
            <input type="date" value={to} max={isoDay(new Date())} onChange={e => setTo(e.target.value || isoDay(new Date()))}
              className="rounded-lg border px-2 py-1 text-base sm:text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
          </label>
          {preview && (
            <>
              {preview.not_locked > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-300">{preview.not_locked} day{preview.not_locked === 1 ? ' isn\'t' : 's aren\'t'} locked yet and won't be paid now — <Link to="/labour/days" className="underline">review them</Link>.</p>
              )}
              {preview.workers.length === 0 && (preview.jobs ?? []).length === 0 ? <p className="text-sm text-slate-500">Nothing locked to pay up to {dayLabel(to)}.</p> : (
                <>
                  {preview.workers.length > 0 && <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">Worker</th><th className="py-1 pl-3 text-right">Days</th><th className="py-1 pl-3 text-right">Rate</th><th className="py-1 pl-3 text-right">Overtime</th><th className="py-1 pl-3 text-right">Pay</th></tr></thead>
                    <tbody className="divide-y dark:divide-slate-700">
                      {preview.workers.map(w => (
                        <tr key={w.staff_id}>
                          <td className="py-1.5">
                            <span className="text-slate-800 dark:text-slate-100">{w.name}</span>
                            {w.no_rate && <Pill tone="red">No day rate</Pill>}
                            {w.held && <Pill tone="amber">Held: not verified</Pill>}
                          </td>
                          <td className="whitespace-nowrap py-1.5 pl-3 text-right tabular-nums">{halfDays(Number(w.days))}</td>
                          <td className="whitespace-nowrap py-1.5 pl-3 text-right tabular-nums">{Number(w.rate).toLocaleString()}</td>
                          <td className="whitespace-nowrap py-1.5 pl-3 text-right tabular-nums">{Number(w.overtime) ? `${Number(w.overtime_hours)}h · ${Number(w.overtime).toLocaleString()}` : '—'}</td>
                          <td className="whitespace-nowrap py-1.5 pl-3 text-right font-medium tabular-nums">{fmtMoney(w.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>}
                  {(preview.jobs ?? []).length > 0 && (
                    <table className="w-full text-sm">
                      <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">Piece work</th><th className="py-1 pl-3 text-right">Done</th><th className="py-1 pl-3 text-right">Rate</th><th className="py-1 pl-3 text-right">Pay</th></tr></thead>
                      <tbody className="divide-y dark:divide-slate-700">
                        {preview.jobs.map(j => (
                          <tr key={j.id}>
                            <td className="py-1.5"><span className="text-slate-800 dark:text-slate-100">{j.what}</span> <span className="text-xs text-slate-500">· {j.project} · paid to {j.paid_to}</span></td>
                            <td className="whitespace-nowrap py-1.5 pl-3 text-right tabular-nums">{j.basis === 'per_volume' ? `${Number(j.quantity)} ${j.unit ?? ''}` : `${Number(j.percent)}%`}</td>
                            <td className="whitespace-nowrap py-1.5 pl-3 text-right tabular-nums">{Number(j.rate).toLocaleString()}</td>
                            <td className="whitespace-nowrap py-1.5 pl-3 text-right font-medium tabular-nums">{fmtMoney(j.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {preview.projects.length > 0 && <div className="rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-900/40">
                    <p className="mb-1 font-semibold text-slate-600 dark:text-slate-300">Day workers costed to</p>
                    <ul className="space-y-0.5">
                      {preview.projects.map(p => (
                        <li key={p.project_id} className="flex justify-between gap-3">
                          <span className="text-slate-700 dark:text-slate-200">{p.name}{p.internal ? ' (internal)' : ''}
                            <span className="text-slate-500"> · {[p.build_days && `${halfDays(Number(p.build_days))} build`, p.repair_days && `${halfDays(Number(p.repair_days))} repair`, p.other_days && `${halfDays(Number(p.other_days))} days`].filter(Boolean).join(', ')}</span>
                          </span>
                          <span className="tabular-nums">{fmtMoney(p.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>}
                  <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)"
                    className="w-full rounded-lg border px-3 py-2 text-base sm:text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm text-slate-600 dark:text-slate-300">{preview.days} day{preview.days === 1 ? '' : 's'} · {dayLabel(preview.from!)} – {dayLabel(preview.last!)} · <b>{fmtMoney(preview.total)}</b></p>
                    <button onClick={confirmPay} disabled={!canRun(open) || !!busy || preview.workers.some(w => w.no_rate)}
                      className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy === 'confirm' ? 'Confirming…' : 'Confirm pay'}</button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      ) : (
        <ul className="divide-y dark:divide-slate-700">
          {shown.map(u => (
            <li key={u.pm_staff_id}>
              <button onClick={() => setOpen(u.pm_staff_id)} disabled={!u.locked_days} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 disabled:cursor-default dark:hover:bg-slate-700/40">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{u.pm_name}</p>
                  <p className="truncate text-xs text-slate-500">
                    {u.locked_days ? `${u.locked_days} locked day${u.locked_days === 1 ? '' : 's'} · ${u.workers} worker${u.workers === 1 ? '' : 's'} · ${dayLabel(u.first_day!)} – ${dayLabel(u.last_day!)}` : 'Nothing locked yet'}
                    {u.waiting_review ? ` · ${u.waiting_review} waiting for review` : ''}{u.open_days ? ` · ${u.open_days} still with the PM` : ''}
                  </p>
                </div>
                {u.locked_days > 0 && <span className="text-sm font-semibold tabular-nums">{fmtMoney(u.amount)}</span>}
                {u.locked_days > 0 && <ChevronRight className="h-4 w-4 text-slate-300" />}
              </button>
            </li>
          ))}
          {runs.length > 0 && <li className="bg-slate-50 px-4 py-1.5 text-xs font-semibold text-slate-500 dark:bg-slate-900/40">Recently confirmed from day sheets</li>}
          {runs.map(r => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-slate-800 dark:text-slate-100">{r.code} · {r.staff?.employee_name}</p>
                <p className="truncate text-xs text-slate-500">{dayLabel(r.period_start)} – {dayLabel(r.period_end)} · confirmed by {r.confirmed_by_name ?? '—'}</p>
              </div>
              <span className="text-sm font-semibold tabular-nums">{fmtMoney(r.total)}</span>
              {canRun(r.pm_staff_id) && (
                <button onClick={() => reopen(r)} disabled={busy === r.id} title="Take it back to change the days"
                  className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700"><Undo2 className="h-4 w-4" /></button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
