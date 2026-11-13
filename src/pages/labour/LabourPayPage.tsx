import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { Pill } from '@/components/record/Record'
import type { PayLine } from '@/lib/documents/labourPay'
import { BASIS_LABEL, dayLabel, financeStatus, financeTone, fmtMoney, isoDay, useLabourSites, type PayBasis } from '@/lib/labour'
import { DaySheetPay } from '@/components/labour/DaySheetPay'
import { PayWeekSettings } from '@/components/labour/LabourGives'
import { payWeekFor, sendWeekPay, usePayWeek, useWeekPaySites, type WeekPaySite } from '@/lib/labourGives'
import { ArrowLeft, CheckCircle2, ChevronRight, Send, Wallet } from 'lucide-react'

type Unpaid = {
  labor_requisition_id: string; project_id: string; project_name: string | null; role_needed: string
  payment_basis: PayBasis; payment_model: string; pay_cycle: string; end_date: string | null
  first_day: string; last_day: string; days_recorded: number; workers: number; ready: boolean; suggested_to: string
}
type Sheet = {
  id: string; code: string; labor_requisition_id: string | null; day_pay_run_id: string | null; period_start: string; period_end: string; total: number; confirmed_at: string
  labor_requisitions: { role_needed: string; projects: { project_name: string } | null } | null
  projects: { project_name: string } | null
  expenses: { approval_status: string; payment_state: string } | null
}

const input = 'w-full rounded-lg border px-3 py-2.5 text-base sm:text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const card = 'rounded-2xl border bg-white dark:border-slate-700 dark:bg-slate-800'

// The project manager's weekly job: look at what was recorded, confirm it,
// and it goes to finance as one payable per request.
export default function LabourPayPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { hasRole } = useAuth()
  const { managedIds } = useLabourSites()
  const [params, setParams] = useSearchParams()
  const selected = params.get('req')
  const select = (id: string | null) => setParams(p => { const n = new URLSearchParams(p); if (id) n.set('req', id); else n.delete('req'); return n }, { replace: true })

  const { data: unpaid = [], isLoading } = useQuery({
    queryKey: ['labour-unpaid'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_labour_unpaid').select('*').order('first_day')
      if (error) throw error
      return (data ?? []) as Unpaid[]
    },
  })
  const { data: sheets = [] } = useQuery({
    queryKey: ['labour-pay-sheets-recent'],
    queryFn: async () => {
      const { data, error } = await supabase.from('labour_pay_sheets')
        .select('id, code, labor_requisition_id, day_pay_run_id, period_start, period_end, total, confirmed_at, labor_requisitions(role_needed, projects(project_name)), projects(project_name), expenses(approval_status, payment_state)')
        .order('confirmed_at', { ascending: false }).limit(20)
      if (error) throw error
      return (data ?? []) as unknown as Sheet[]
    },
  })

  const current = unpaid.find(u => u.labor_requisition_id === selected) ?? null
  const canConfirm = (u: Unpaid) => hasRole('admin', 'operations_manager') || managedIds.has(u.project_id)

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-10">
      <Link to="/labour" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand"><ArrowLeft className="h-4 w-4" /> Labour</Link>
      <div>
        <h1 className="flex items-center gap-2 text-lg font-bold text-slate-800 dark:text-slate-100"><Wallet className="h-5 w-5 text-brand" /> Pay</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">What the days recorded come to, site by site. One tap puts a site's pay in a request; you check it, add the signed attendance sheet, and send it to finance.</p>
      </div>
      <PayWeekSettings canEdit={hasRole('admin', 'operations_manager')} />

      {current ? (
        <Confirm key={current.labor_requisition_id} u={current} allowed={canConfirm(current)} onBack={() => select(null)}
          onDone={() => { select(null); qc.invalidateQueries({ queryKey: ['labour-unpaid'] }); qc.invalidateQueries({ queryKey: ['labour-pay-sheets-recent'] }); qc.invalidateQueries({ queryKey: ['labour-request-sheets', current.labor_requisition_id] }); qc.invalidateQueries({ queryKey: ['labour-request-events', current.labor_requisition_id] }) }}
          toast={toast} />
      ) : (
        <>
        <SendWeekPay />
        <DaySheetPay />
        <section className={card}>
          <h2 className="border-b px-4 py-3 font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100">One request at a time<span className="block text-xs font-normal text-slate-500">To check or change the lines before confirming.</span></h2>
          {isLoading ? <p className="p-6 text-center text-sm text-slate-400">Loading…</p> : unpaid.length === 0 ? (
            <p className="flex items-center justify-center gap-2 p-6 text-sm text-slate-500"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Nothing waiting — all recorded work is confirmed.</p>
          ) : (
            <ul className="divide-y dark:divide-slate-700">
              {unpaid.map(u => (
                <li key={u.labor_requisition_id}>
                  <button onClick={() => select(u.labor_requisition_id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{u.role_needed} <span className="font-normal text-slate-500">· {u.project_name}</span></p>
                      <p className="text-xs text-slate-500">{u.days_recorded} day{u.days_recorded === 1 ? '' : 's'} · {dayLabel(u.first_day)} – {dayLabel(u.last_day)} · {BASIS_LABEL[u.payment_basis]}</p>
                    </div>
                    {u.ready ? <Pill tone="amber">Due</Pill> : <Pill>This week</Pill>}
                    <ChevronRight className="h-4 w-4 text-slate-300" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        </>
      )}

      <section className={card}>
        <h2 className="border-b px-4 py-3 font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100">Recently confirmed</h2>
        {sheets.length === 0 ? <p className="p-6 text-center text-sm text-slate-400">None yet.</p> : (
          <ul className="divide-y dark:divide-slate-700">
            {sheets.map(s => {
              const fs = financeStatus(s.expenses)
              return (
                <li key={s.id}>
                  {/* Day-sheet pay sheets belong to a pay run, not a request. */}
                  <Link to={s.labor_requisition_id ? `/labour/${s.labor_requisition_id}` : '/labour/requests?view=mine'} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{s.code} · {s.labor_requisitions?.role_needed ?? 'Day sheets'}</p>
                      <p className="truncate text-xs text-slate-500">{s.labor_requisitions?.projects?.project_name ?? s.projects?.project_name} · {dayLabel(s.period_start)} – {dayLabel(s.period_end)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">{fmtMoney(s.total)}</p>
                      <Pill tone={financeTone(fs)}>{fs}</Pill>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

function Confirm({ u, allowed, onBack, onDone, toast }: {
  u: Unpaid; allowed: boolean; onBack: () => void; onDone: () => void; toast: ReturnType<typeof useToast>['toast']
}) {
  const today = isoDay(new Date())
  const [to, setTo] = useState(u.ready ? u.suggested_to : u.last_day)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const { data: lines = [], isLoading } = useQuery({
    queryKey: ['labour-pay-lines', u.labor_requisition_id, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('labour_pay_lines', { p_req: u.labor_requisition_id, p_to: to })
      if (error) throw error
      return (data ?? []) as PayLine[]
    },
  })
  const total = lines.reduce((s, l) => s + Number(l.amount || 0), 0)
  // How each worker's overtime was priced, day by day (migration 458).
  const { data: otByStaff = {} } = useQuery({
    queryKey: ['labour-pay-lines', u.labor_requisition_id, to, 'overtime'],
    enabled: u.payment_basis === 'per_day',
    queryFn: async () => {
      const { data, error } = await supabase.rpc('labour_overtime_lines', { p_req: u.labor_requisition_id, p_to: to })
      if (error) throw error
      const m: Record<string, { work_date: string; basis: string; amount: number }[]> = {}
      for (const o of (data ?? []) as { staff_id: string; work_date: string; basis: string; amount: number }[]) (m[o.staff_id] ??= []).push(o)
      return m
    },
  })

  async function confirm() {
    setBusy(true)
    const { error } = await supabase.rpc('confirm_labour_pay', { p_req: u.labor_requisition_id, p_to: to, p_note: note.trim() || null })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`${fmtMoney(total)} confirmed — put it in a payment request for finance`, 'success')
    onDone()
  }

  return (
    <section className={card}>
      <div className="border-b px-4 py-3 dark:border-slate-700">
        <button onClick={onBack} className="mb-1 text-xs text-slate-500 hover:text-brand">← All waiting</button>
        <p className="font-semibold text-slate-800 dark:text-slate-100">{u.role_needed} · {u.project_name}</p>
        <Link to={`/labour/${u.labor_requisition_id}`} className="text-xs text-brand">Open the request</Link>
      </div>
      <div className="flex items-center gap-2 px-4 py-3 text-sm">
        <span className="text-slate-500">Pay work up to</span>
        <input type="date" className={`${input} w-auto`} value={to} min={u.first_day} max={today} onChange={e => setTo(e.target.value || u.last_day)} />
      </div>
      {isLoading ? <p className="p-6 text-center text-sm text-slate-400">Working it out…</p> : lines.length === 0 ? (
        <p className="p-6 text-center text-sm text-slate-500">Nothing recorded up to {dayLabel(to)}.</p>
      ) : (
        <ul className="divide-y border-y dark:divide-slate-700 dark:border-slate-700">
          {lines.map((l, i) => (
            <li key={l.staff_id ?? `crew-${i}`} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{l.worker_name}</p>
                <p className="text-xs text-slate-500">
                  {u.payment_basis === 'per_day' ? `${Number(l.days ?? 0).toLocaleString()} day${Number(l.days) === 1 ? '' : 's'} (${Number(l.hours ?? 0)} h)${l.overtime_hours ? ` + ${Number(l.overtime_hours)} h overtime` : ''} × ${fmtMoney(l.rate)}`
                    : u.payment_basis === 'per_volume' ? `${Number(l.quantity ?? 0).toLocaleString()} × ${fmtMoney(l.rate)}`
                    : `${Number(l.percent_done ?? 0)}% of ${fmtMoney(l.rate)}`}
                </p>
                {(otByStaff[l.staff_id ?? ''] ?? []).map(o => (
                  <p key={o.work_date} className="text-[11px] text-slate-400">Overtime {dayLabel(o.work_date)} · {o.basis} · {fmtMoney(o.amount)}</p>
                ))}
              </div>
              <p className="text-sm font-semibold">{fmtMoney(l.amount)}</p>
            </li>
          ))}
          <li className="flex items-center justify-between px-4 py-3 font-bold"><span>Total</span><span>{fmtMoney(total)}</span></li>
        </ul>
      )}
      <div className="space-y-3 p-4">
        {!allowed ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">The project manager of {u.project_name} confirms this.</p>
        ) : lines.length > 0 && <>
          <textarea className={input} rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Note for finance (optional)" />
          <button onClick={confirm} disabled={busy || total <= 0} className="w-full rounded-xl bg-brand py-3 text-sm font-semibold text-white disabled:opacity-40">
            {busy ? 'Confirming…' : `Confirm ${fmtMoney(total)}`}
          </button>
          <p className="text-center text-xs text-slate-400">You can take it back until finance acts on it.</p>
        </>}
      </div>
    </section>
  )
}

/**
 * One tap per site (515): confirms what is recorded on it and puts
 * everything payable into one draft payment request, opened to check,
 * sign and send. The three screens this used to take are still below.
 */
function SendWeekPay() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { data: sites = [], isLoading } = useWeekPaySites()
  const { data: week } = usePayWeek()
  const promise = payWeekFor(week, isoDay(new Date()))
  const [busy, setBusy] = useState<string | null>(null)

  async function send(s: WeekPaySite) {
    setBusy(s.project_id)
    try {
      const r = await sendWeekPay(s.project_id)
      for (const k of ['labour-week-pay-sites', 'labour-unpaid', 'labour-pay-sheets-recent', 'labour-payable-drafts', 'labour-pay-requests']) qc.invalidateQueries({ queryKey: [k] })
      toast(`${r.code}: ${fmtMoney(Number(r.total))} ready to check and send${r.skipped.length ? `. Left out: ${r.skipped.join('; ')}` : ''}`, r.skipped.length ? 'info' : 'success')
      navigate(`/labour/requests/${r.request_id}`)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  if (isLoading || sites.length === 0) return null
  return (
    <section className={card}>
      <h2 className="border-b px-4 py-3 font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100">
        Send the pay
        <span className="block text-xs font-normal text-slate-500">
          {promise ? `Sent by ${promise.cutoffLabel}, it's paid ${promise.payDayLabel} (${promise.left}).` : 'Everything recorded on a site and not yet with finance, in one request.'}
        </span>
      </h2>
      <ul className="divide-y dark:divide-slate-700">
        {sites.map(s => {
          const total = Number(s.to_confirm_amount) + Number(s.confirmed_amount)
          return (
            <li key={s.project_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{s.project_name}</p>
                <p className="text-xs text-slate-500">
                  <b className="text-slate-700 dark:text-slate-200">{s.workers} worker{s.workers === 1 ? '' : 's'}</b> waiting for <b className="text-slate-700 dark:text-slate-200">{fmtMoney(total)}</b>
                  {s.first_day && s.last_day ? ` · ${dayLabel(s.first_day)} – ${dayLabel(s.last_day)}` : ''}
                </p>
                <p className="text-[11px] text-slate-400">
                  {[s.to_confirm ? `${fmtMoney(Number(s.to_confirm_amount))} recorded, not confirmed` : null,
                    s.confirmed ? `${fmtMoney(Number(s.confirmed_amount))} confirmed, in no request` : null].filter(Boolean).join(' · ')}
                  {s.unverified > 0 && <span className="text-amber-600"> · {s.unverified} not verified by HR</span>}
                </p>
              </div>
              <button onClick={() => send(s)} disabled={!!busy}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
                <Send className="h-4 w-4" /> {busy === s.project_id ? 'Putting it together…' : 'Send the pay'}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
