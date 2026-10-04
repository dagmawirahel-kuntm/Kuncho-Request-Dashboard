import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  CalendarRange, Plus, Trash2, Target, CheckCircle2, XCircle, AlertTriangle, ArrowRight, Ban, Info, Landmark, Milestone, X,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { FormattedNumberInput } from '@/components/shared/FormattedNumberInput'
import {
  useTaxForecast, useVatGoal, TIER_LABEL,
  type ForecastMonth, type TaxForecast as Forecast, type VatGoal, type GoalLever,
} from '@/lib/taxPlan'

// Forecast and goals (migration 419): every tax for this month and the next
// five, with what management expects added in; and working back from a VAT
// goal — the ways to get there in order of effort, whether it can be
// reached, and when it can't, what it would take.

const etb = (n: number | null | undefined) => n == null ? '—' : Math.round(n).toLocaleString('en-US')
const vatWord = (n: number) => n < 0 ? `${etb(-n)} credit` : `${etb(n)} to pay`
const card = 'rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800'
const short = (label: string) => label.replace(/ \d+$/, '')
const field = 'w-full rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'

export function TaxForecast() {
  const { data: f, isLoading, error } = useTaxForecast()
  if (error) return <p className="text-sm text-red-600">{(error as Error).message}</p>
  if (isLoading || !f) return <div className={`${card} h-48 animate-pulse`} />
  return (
    <div className="space-y-5">
      <ForecastTable f={f} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <VatGoalPanel f={f} />
        <div className="space-y-5">
          <Coming f={f} />
          <Expectations f={f} />
        </div>
      </div>
    </div>
  )
}

// ── The six months ─────────────────────────────────────────────────────
function ForecastTable({ f }: { f: Forecast }) {
  const data = f.months.map(m => ({ ...m, short: short(m.label), v: m.vat.with_steps, goal: m.goals.VAT ?? null }))
  const rows: { key: string; label: string; get: (m: ForecastMonth) => number; note?: (m: ForecastMonth) => string | null; goal?: (m: ForecastMonth) => number | null }[] = [
    { key: 'vat', label: 'VAT', get: m => m.vat.with_steps, note: m => m.vat.course !== m.vat.with_steps ? `${vatWord(m.vat.course)} if nothing more is done` : null, goal: m => m.goals.VAT ?? null },
    { key: 'wht', label: 'Withholding', get: m => m.wht, goal: m => m.goals.WHT ?? null },
    { key: 'sch_a', label: 'Employment tax', get: m => m.sch_a, note: m => m.payroll_projected ? 'from the last payroll' : null, goal: m => m.goals.SCH_A ?? null },
    { key: 'pension', label: 'Pension', get: m => m.pension, note: m => m.payroll_projected ? 'from the last payroll' : null, goal: m => m.goals.PENSION ?? null },
  ]
  const anyExpect = f.months.some(m => m.expectations.length > 0)
  return (
    <section className={`${card} p-4 [--s1:#2a78d6] [--s2:#eb6834] [--goal:#0b0b0b] dark:[--s1:#3987e5] dark:[--s2:#d95926] dark:[--goal:#f1f5f9]`}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100"><CalendarRange className="h-4 w-4 text-brand" /> The next six months</h2>
        <div className="flex gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--s1)]" /> VAT to pay</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--s2)]" /> VAT credit</span>
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 bg-[var(--goal)]" /> Goal</span>
        </div>
      </div>
      <p className="mb-2 text-xs text-slate-500">
        What is in the books and on its way, plus what you expect.{!anyExpect && ' Nothing is expected yet — later months only show what is already booked, so add the sales and purchases you know are coming.'}
      </p>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="currentColor" className="text-slate-100 dark:text-slate-700" />
            <XAxis dataKey="short" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={48}
              tickFormatter={v => Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${Math.round(v / 1e3)}K` : String(v)} />
            <ReferenceLine y={0} stroke="#94a3b8" />
            <Tooltip cursor={{ fill: 'rgba(148,163,184,0.12)' }} content={<VatTip />} />
            <Bar dataKey="v" radius={[4, 4, 4, 4]} maxBarSize={30}>
              {data.map(d => <Cell key={d.label} fill={d.v < 0 ? 'var(--s2)' : 'var(--s1)'} />)}
            </Bar>
            <Line dataKey="goal" stroke="none" isAnimationActive={false} legendType="none"
              dot={(p: { cx?: number; cy?: number; index?: number }) => p.cx == null || p.cy == null || !Number.isFinite(p.cy)
                ? <g key={p.index} />
                : <line key={p.index} x1={p.cx - 18} x2={p.cx + 18} y1={p.cy} y2={p.cy} stroke="var(--goal)" strokeWidth={2} strokeLinecap="round" />}
              activeDot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
              <th className="py-1.5 pr-3 font-medium">Tax</th>
              {f.months.map(m => <th key={m.label} className={`px-2 py-1.5 text-right font-medium ${m.is_current ? 'text-slate-700 dark:text-slate-200' : ''}`}>{short(m.label)}{m.is_current ? ' · now' : ''}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-slate-700">
            {rows.map(r => (
              <tr key={r.key}>
                <td className="py-2 pr-3 font-medium text-slate-700 dark:text-slate-200">{r.label}</td>
                {f.months.map(m => {
                  const v = r.get(m); const g = r.goal?.(m) ?? null; const note = r.note?.(m) ?? null
                  return (
                    <td key={m.label} className="px-2 py-2 text-right align-top tabular-nums" title={note ?? undefined}>
                      <span className={r.key === 'vat' && v < 0 ? 'font-semibold text-[#c2410c] dark:text-[#fb923c]' : 'text-slate-800 dark:text-slate-100'}>
                        {r.key === 'vat' && v < 0 ? `−${etb(-v)}` : etb(v)}
                      </span>
                      {g != null && <span className={`block text-[10px] ${v > g ? 'text-amber-600' : 'text-emerald-600'}`}>goal {etb(g)}</span>}
                      {r.key === 'vat' && m.vat.credit_in > 0 && <span className="block text-[10px] text-slate-400">{etb(m.vat.credit_in)} credit in</span>}
                    </td>
                  )
                })}
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="py-2 pr-3 text-slate-700 dark:text-slate-200">To pay</td>
              {f.months.map(m => <td key={m.label} className="px-2 py-2 text-right tabular-nums text-slate-900 dark:text-white">{etb(m.vat.payable + m.wht + m.sch_a + m.pension)}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-slate-400">
        VAT assumes this month's receipts are captured and the approved bills to VAT suppliers are paid. A VAT credit is carried into the next month's return. Withholding includes 3% on expected purchases over the threshold.
      </p>
    </section>
  )
}

function VatTip({ active, payload }: { active?: boolean; payload?: { payload: ForecastMonth & { v: number } }[] }) {
  if (!active || !payload?.length) return null
  const m = payload[0].payload
  const row = (label: string, v: number) => v ? <p className="flex justify-between gap-4 text-slate-500">{label}<span className="tabular-nums text-slate-800 dark:text-slate-100">{etb(v)}</span></p> : null
  return (
    <div className="rounded-lg border bg-white px-3 py-2 text-xs shadow-md dark:border-slate-700 dark:bg-slate-800">
      <p className="mb-1 font-semibold text-slate-800 dark:text-slate-100">{m.label}</p>
      {row('VAT on sales invoiced', m.vat.sales_invoiced)}
      {row('On payment requests to invoice', m.vat.sales_to_invoice)}
      {row('On sales expected', m.vat.sales_expected)}
      {row('Less: VAT claimed', -m.vat.input_claimed)}
      {row('Less: on purchases expected', -m.vat.input_expected)}
      {row('Less: receipts to capture', -m.vat.input_waiting_receipts)}
      {row('Less: approved bills to pay', -m.vat.input_approved_bills)}
      <p className="mt-1 border-t pt-1 font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100">{vatWord(m.vat.with_steps)}</p>
    </div>
  )
}

// ── Coming, not placed in a month ──────────────────────────────────────
function Coming({ f }: { f: Forecast }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const ms = f.unscheduled.milestones
  if (ms.length === 0 && !f.unscheduled.open_orders.count) return null

  async function place(id: string, title: string, gross: number, at: string) {
    const m = f.months.find(x => `${x.ec_year}-${x.ec_month}` === at)
    if (!m) return
    setBusy(id)
    const { error } = await supabase.from('tax_forecast_expectations').insert([{
      ec_year: m.ec_year, ec_month: m.ec_month, kind: 'sale', label: title, amount: gross, amount_includes_vat: true, vat_applies: true, milestone_id: id,
    }])
    setBusy(null)
    if (error) { toast(error.message, 'error'); return }
    toast(`Expected in ${m.label}`, 'success')
    qc.invalidateQueries({ queryKey: ['tax-forecast'] }); qc.invalidateQueries({ queryKey: ['vat-goal'] })
  }

  return (
    <section className={`${card} p-4`}>
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100"><Milestone className="h-4 w-4 text-brand" /> Coming, but not in a month yet</h2>
      <p className="mt-0.5 text-xs text-slate-500">Contract milestones still to bill. Say when each will be invoiced and its VAT goes into that month.</p>
      <ul className="mt-2 space-y-2">
        {ms.map(x => (
          <li key={x.id} className="rounded-lg border p-2.5 text-sm dark:border-slate-700">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-slate-800 dark:text-slate-100">{x.title}</p>
                <p className="text-xs text-slate-500">{x.project ?? '—'}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{etb(x.gross)}</p>
                <p className="text-[11px] text-slate-400">{etb(x.vat)} VAT</p>
              </div>
            </div>
            {f.can_manage && (
              <select disabled={busy === x.id} defaultValue="" onChange={e => e.target.value && place(x.id, `${x.title} — ${x.project ?? ''}`.trim(), x.gross, e.target.value)}
                className="mt-2 w-full rounded-md border px-2 py-1 text-xs text-slate-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300" aria-label="Expected invoice month">
                <option value="">Expect it in…</option>
                {f.months.map(m => <option key={m.label} value={`${m.ec_year}-${m.ec_month}`}>{m.label}</option>)}
              </select>
            )}
          </li>
        ))}
      </ul>
      {f.unscheduled.open_orders.count > 0 && (
        <p className="mt-3 text-xs text-slate-500">
          Also {f.unscheduled.open_orders.count} open order{f.unscheduled.open_orders.count === 1 ? '' : 's'} worth {etb(f.unscheduled.open_orders.value)} with no payment request yet —
          about {etb(f.unscheduled.open_orders.vat)} VAT to claim in the month each is paid.
        </p>
      )}
    </section>
  )
}

// ── What you expect ────────────────────────────────────────────────────
function Expectations({ f }: { f: Forecast }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState(`${f.months[0].ec_year}-${f.months[0].ec_month}`)
  const [kind, setKind] = useState<'sale' | 'purchase'>('sale')
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState<number | undefined>()
  const [incl, setIncl] = useState(true)
  const [vatApplies, setVatApplies] = useState(true)
  const [busy, setBusy] = useState(false)
  const all = f.months.flatMap(m => m.expectations.map(e => ({ ...e, month: m.label })))
  const refresh = () => { qc.invalidateQueries({ queryKey: ['tax-forecast'] }); qc.invalidateQueries({ queryKey: ['vat-goal'] }) }

  async function add() {
    const m = f.months.find(x => `${x.ec_year}-${x.ec_month}` === at)
    if (!m || !label.trim() || !(amount && amount > 0)) { toast('Say what it is and how much', 'error'); return }
    setBusy(true)
    const { error } = await supabase.from('tax_forecast_expectations').insert([{
      ec_year: m.ec_year, ec_month: m.ec_month, kind, label: label.trim(), amount, amount_includes_vat: incl, vat_applies: vatApplies,
    }])
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    setLabel(''); setAmount(undefined); setOpen(false); refresh()
  }
  async function remove(id: string) {
    const { error } = await supabase.from('tax_forecast_expectations').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    refresh()
  }

  return (
    <section className={`${card} p-4`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100"><Landmark className="h-4 w-4 text-brand" /> What you expect</h2>
        {f.can_manage && !open && <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"><Plus className="h-3.5 w-3.5" /> Add</button>}
      </div>
      <p className="mt-0.5 text-xs text-slate-500">Sales you will invoice and purchases you will make that the books don't show yet.</p>
      {open && (
        <div className="mt-2 space-y-2 rounded-lg border bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-900/30">
          <div className="flex items-center justify-between">
            <div className="flex gap-1">
              {(['sale', 'purchase'] as const).map(k => (
                <button key={k} onClick={() => setKind(k)} className={`rounded-full border px-3 py-1 text-xs font-medium ${kind === k ? 'border-brand bg-brand/10 text-brand' : 'text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>{k === 'sale' ? 'A sale' : 'A purchase'}</button>
              ))}
            </div>
            <button onClick={() => setOpen(false)} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700" aria-label="Close"><X className="h-4 w-4" /></button>
          </div>
          <input className={field} value={label} onChange={e => setLabel(e.target.value)} placeholder={kind === 'sale' ? 'e.g. Zemen Bank booth — final payment' : 'e.g. Laser cutting machine'} />
          <div className="grid grid-cols-2 gap-2">
            <FormattedNumberInput value={amount} onChange={setAmount} placeholder="Amount (ETB)" className={field} />
            <select className={field} value={at} onChange={e => setAt(e.target.value)} aria-label="Month">
              {f.months.map(m => <option key={m.label} value={`${m.ec_year}-${m.ec_month}`}>{m.label}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={vatApplies} onChange={e => setVatApplies(e.target.checked)} />
            {kind === 'sale' ? 'Carries VAT' : 'From a supplier who gives a VAT receipt'}
          </label>
          {vatApplies && (
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={incl} onChange={e => setIncl(e.target.checked)} /> The amount includes VAT
            </label>
          )}
          <div className="flex justify-end"><button onClick={add} disabled={busy} className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{busy ? 'Adding…' : 'Add'}</button></div>
        </div>
      )}
      {all.length === 0
        ? <p className="mt-2 text-xs text-slate-400">Nothing yet.</p>
        : (
          <ul className="mt-2 divide-y text-sm dark:divide-slate-700">
            {all.map(e => (
              <li key={e.id} className="flex items-center gap-2 py-2">
                <span className={`w-14 shrink-0 rounded-full px-1.5 py-0.5 text-center text-[10px] font-semibold ${e.kind === 'sale' ? 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' : 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'}`}>{e.kind === 'sale' ? 'Sale' : 'Purchase'}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-slate-700 dark:text-slate-200">{e.label}</p>
                  <p className="text-[11px] text-slate-400">{short(e.month)} · {etb(e.amount)}{e.vat_applies ? ` · ${etb(e.vat)} VAT ${e.kind === 'sale' ? 'due' : 'to claim'}` : ' · no VAT'}</p>
                </div>
                {f.can_manage && <button onClick={() => remove(e.id)} className="rounded p-1 text-slate-400 hover:text-red-600" aria-label={`Remove ${e.label}`}><Trash2 className="h-3.5 w-3.5" /></button>}
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}

// ── Working back from a VAT goal ───────────────────────────────────────
const VERDICT: Record<string, { tone: 'good' | 'ok' | 'warn' | 'bad'; title: (g: VatGoal) => string }> = {
  already: { tone: 'good', title: g => `${g.period.label} is already at or under ${vatWord(g.target)}` },
  paperwork: { tone: 'good', title: () => 'Reachable with paperwork alone' },
  timing: { tone: 'ok', title: () => 'Reachable — but only by moving the timing of payments' },
  procurement: { tone: 'ok', title: () => 'Reachable by changing who you buy from' },
  sales_timing: { tone: 'warn', title: () => 'Only by invoicing later — a last resort' },
  none: { tone: 'bad', title: g => `Not reachable in ${g.period.label}` },
}
const TONE = {
  good: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800/50 dark:bg-emerald-900/15 dark:text-emerald-200',
  ok: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-800/50 dark:bg-sky-900/15 dark:text-sky-200',
  warn: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/50 dark:bg-amber-900/15 dark:text-amber-200',
  bad: 'border-red-200 bg-red-50 text-red-900 dark:border-red-800/50 dark:bg-red-900/15 dark:text-red-200',
}
const TIER_TONE: Record<string, string> = {
  paperwork: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  timing: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  procurement: 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  sales_timing: 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
}

function VatGoalPanel({ f }: { f: Forecast }) {
  const [at, setAt] = useState(`${f.months[0].ec_year}-${f.months[0].ec_month}`)
  const [mode, setMode] = useState<'credit' | 'pay'>('credit')
  const [amount, setAmount] = useState<number | undefined>(500000)
  const [asked, setAsked] = useState<{ y: number; m: number; t: number } | null>(null)
  const sel = f.months.find(x => `${x.ec_year}-${x.ec_month}` === at) ?? f.months[0]
  const target = amount == null ? null : mode === 'credit' ? -Math.abs(amount) : Math.abs(amount)
  const { data: g, isFetching, error } = useVatGoal(asked?.y ?? null, asked?.m ?? null, asked?.t ?? null)

  return (
    <section className={`${card} p-4`}>
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100"><Target className="h-4 w-4 text-brand" /> Work back from a VAT goal</h2>
      <p className="mt-0.5 text-xs text-slate-500">Say where you want a month's VAT to land — a credit (a VAT return) or no more than an amount to pay — and see the ways there, easiest first, and honestly whether it can be done.</p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-500">Month
          <select className={`${field} mt-1 w-40`} value={at} onChange={e => setAt(e.target.value)}>
            {f.months.map(m => <option key={m.label} value={`${m.ec_year}-${m.ec_month}`}>{m.label} · {vatWord(m.vat.course)}</option>)}
          </select>
        </label>
        <div className="flex rounded-md border p-0.5 text-xs dark:border-slate-600">
          {(['credit', 'pay'] as const).map(k => (
            <button key={k} onClick={() => setMode(k)} className={`rounded px-2.5 py-1.5 font-medium ${mode === k ? 'bg-brand text-white' : 'text-slate-600 dark:text-slate-300'}`}>{k === 'credit' ? 'Get a credit of' : 'Pay no more than'}</button>
          ))}
        </div>
        <label className="text-xs text-slate-500">ETB
          <FormattedNumberInput value={amount} onChange={setAmount} className={`${field} mt-1 w-36`} placeholder="0" />
        </label>
        <button onClick={() => target != null && setAsked({ y: sel.ec_year, m: sel.ec_month, t: target })} disabled={target == null}
          className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
          Show the way <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{(error as Error).message}</p>}
      {g && <GoalResult g={g} busy={isFetching} />}
    </section>
  )
}

function GoalResult({ g, busy }: { g: VatGoal; busy: boolean }) {
  const v = VERDICT[g.reached_with ?? 'none']
  const usedLevers = g.levers.filter(l => l.used > 0.5)
  const spare = g.levers.filter(l => l.used <= 0.5)
  const ok = g.reached_with != null
  return (
    <div className={`mt-4 space-y-3 ${busy ? 'opacity-60' : ''}`}>
      <div className={`rounded-lg border px-3 py-2.5 ${TONE[v.tone]}`}>
        <p className="flex items-center gap-1.5 text-sm font-semibold">{ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />} {v.title(g)}</p>
        <p className="mt-0.5 text-xs opacity-90">
          On its current course {g.period.label} comes to <b>{vatWord(g.course)}</b>. The goal is <b>{vatWord(g.target)}</b>
          {g.need > 0 ? <> — {etb(g.need)} of VAT to take off.</> : '.'}
          {!ok && <> Everything below together gets it to <b>{vatWord(g.closest)}</b>, {etb(g.remaining)} short.</>}
        </p>
      </div>

      {g.need > 0 && <GoalMeter g={g} />}

      {g.levers.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{ok ? 'The way there, in order' : 'Everything that could help this month'}</p>
          <ol className="space-y-2">
            {[...usedLevers, ...(ok ? [] : spare)].map((l, i) => <LeverRow key={l.code} l={l} n={i + 1} />)}
          </ol>
          {ok && spare.length > 0 && (
            <details className="mt-2 text-xs text-slate-500">
              <summary className="cursor-pointer">Not needed for this goal ({spare.length})</summary>
              <ol className="mt-2 space-y-2">{spare.map((l, i) => <LeverRow key={l.code} l={l} n={usedLevers.length + i + 1} />)}</ol>
            </details>
          )}
        </div>
      )}

      {!ok && g.would_take && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/40">
          <p className="font-semibold text-slate-800 dark:text-slate-100">What closing the last {etb(g.remaining)} would take</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs text-slate-600 dark:text-slate-300">
            <li>About <b>{etb(g.would_take.purchases_incl_vat)}</b> more bought from VAT suppliers in {g.period.label} (VAT included). That is <b>{etb(g.would_take.cash_cost)}</b> of cash for {etb(g.remaining)} of VAT back — worth it only for things you need anyway, never to make the VAT.</li>
            <li>Or set a goal the month can reach: <b>{vatWord(g.closest)}</b> with everything above done.</li>
          </ul>
        </div>
      )}

      {g.credit && <CreditNote g={g} />}

      <div className="flex items-start gap-2 rounded-lg border border-dashed px-3 py-2.5 text-xs text-slate-500 dark:border-slate-700">
        <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p><b className="text-slate-700 dark:text-slate-200">Never part of the plan:</b> buying what you don't need for its VAT (1.15 out for 0.15 back), receipts for purchases that didn't happen or from other businesses, or claiming one receipt twice. The tracker only counts reviewed receipts, one claim each.</p>
      </div>
    </div>
  )
}

function GoalMeter({ g }: { g: VatGoal }) {
  // How the need is covered, tier by tier, against the need.
  const total = Math.max(g.need, g.levers.reduce((s, l) => s + l.used, 0), 1)
  const tiers = ['paperwork', 'timing', 'procurement', 'sales_timing'] as const
  const byTier = tiers.map(t => ({ t, v: g.levers.filter(l => l.tier === t).reduce((s, l) => s + l.used, 0) })).filter(x => x.v > 0)
  const gap = Math.max(g.need - byTier.reduce((s, x) => s + x.v, 0), 0)
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700" role="img" aria-label="How the VAT to take off is covered">
        {byTier.map(x => <div key={x.t} className={`h-full ${x.t === 'paperwork' ? 'bg-emerald-500' : x.t === 'timing' ? 'bg-sky-500' : x.t === 'procurement' ? 'bg-violet-500' : 'bg-amber-500'}`} style={{ width: `${(x.v / total) * 100}%` }} title={`${TIER_LABEL[x.t]}: ${etb(x.v)}`} />)}
        {gap > 0 && <div className="h-full bg-[repeating-linear-gradient(45deg,#fecaca_0_4px,#fff_4px_8px)] dark:bg-[repeating-linear-gradient(45deg,#7f1d1d_0_4px,#1e293b_4px_8px)]" style={{ width: `${(gap / total) * 100}%` }} title={`Short: ${etb(gap)}`} />}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
        {byTier.map(x => <span key={x.t}>{TIER_LABEL[x.t]} {etb(x.v)}</span>)}
        {gap > 0 && <span className="text-red-600">Short {etb(gap)}</span>}
      </div>
    </div>
  )
}

function LeverRow({ l, n }: { l: GoalLever; n: number }) {
  const pct = l.capacity ? Math.min(100, (l.used / l.capacity) * 100) : 0
  return (
    <li className="rounded-lg border p-2.5 dark:border-slate-700">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">{n}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{l.title}</p>
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${TIER_TONE[l.tier]}`}>{TIER_LABEL[l.tier]}</span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">{l.detail}</p>
          {l.caveat && <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-400"><AlertTriangle className="h-3 w-3" /> {l.caveat}</p>}
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"><div className="h-full rounded-full bg-[#2a78d6] dark:bg-[#3987e5]" style={{ width: `${pct}%` }} /></div>
            <span className="shrink-0 text-[11px] tabular-nums text-slate-500">{l.used > 0.5 ? `${etb(l.used)} of ${etb(l.capacity)}` : `up to ${etb(l.capacity)}`}</span>
          </div>
        </div>
        {l.link && <Link to={l.link} className="shrink-0 text-xs font-medium text-brand hover:underline">Open</Link>}
      </div>
    </li>
  )
}

function CreditNote({ g }: { g: VatGoal }) {
  const c = g.credit!
  const months = c.months
  const later = useMemo(() => months.filter(m => m.vat > 0), [months])
  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-3 text-xs text-sky-950 dark:border-sky-800/50 dark:bg-sky-900/15 dark:text-sky-100">
      <p className="flex items-center gap-1.5 text-sm font-semibold"><Info className="h-4 w-4" /> How a VAT credit comes back</p>
      <p className="mt-1">
        A credit of {etb(c.amount)} is not cash in the bank. It is carried into the next returns and used against the VAT due then, so it comes back as VAT you don't pay later.
        A cash refund is the exception, not the rule — it is mainly for exporters and for credits that stay unused for a long time, and needs its own application. Confirm the current rules with the tax officer before counting on cash.
      </p>
      <p className="mt-1.5">
        {c.used_up_in
          ? <>On this forecast the credit is used up in <b>{c.used_up_in}</b>{later.length ? <>, against {later.slice(0, 2).map(m => `${short(m.label)}'s ${etb(m.vat)}`).join(' and ')} of VAT due</> : null}.</>
          : <>Nothing in the next months is forecast to use it — {months.length ? 'the later months have no VAT due yet. Add the sales you expect to see when it is used up.' : 'this is the last month in the forecast.'}</>}
      </p>
    </div>
  )
}
