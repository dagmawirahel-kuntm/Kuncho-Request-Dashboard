import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { GraduationCap, CheckCircle2, AlertTriangle, ArrowRight, FlaskConical, ShieldCheck, Lightbulb, Info, Save, CalendarRange } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { FormattedNumberInput } from '@/components/shared/FormattedNumberInput'
import {
  STEP_KIND_LABEL, STEP_ORDER, TAX_CODES, useTaxLevers, useTaxYear,
  type StepKind, type TaxCode, type TaxPlan, type TrainerStep, type WhatIf, type YearTax,
} from '@/lib/taxPlan'

const etb = (n: number | null | undefined) => n == null ? '—' : Math.round(n).toLocaleString('en-US')
const card = 'rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800'
const TAB_LABEL: Record<TaxCode | 'ALL', string> = { ALL: 'All taxes', VAT: 'VAT', WHT: 'WHT', SCH_A: 'Sch-A', PENSION: 'Pension' }

const KIND_STYLE: Record<StepKind, string> = {
  paperwork: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  procurement: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  timing: 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  pay_policy: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  protect: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  info: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  advice: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
}
const KIND_NOTE: Partial<Record<StepKind, string>> = {
  paperwork: 'costs nothing',
  procurement: 'where things are bought',
  timing: 'moves tax to another month',
  pay_policy: 'changes take-home pay',
}

interface PathRow { step: TrainerStep; running: number; amount: number }

/** The steps in order — easiest first — with the total after each. A VAT
 *  credit carries to the next return rather than being paid back, so a tax
 *  never counts below zero in the total. */
function buildPath(steps: TrainerStep[], start: Record<string, number>, taxes: TaxCode[], scale: (s: TrainerStep) => number): { total: number; rows: PathRow[] } {
  const per: Record<string, number> = {}
  for (const t of taxes) per[t] = start[t] ?? 0
  const sum = () => Object.values(per).reduce((a, v) => a + Math.max(v, 0), 0)
  const total = sum()
  const rows = steps
    .filter(s => taxes.includes(s.tax) && s.amount > 0 && STEP_ORDER.includes(s.kind) && scale(s) > 0)
    .sort((a, b) => STEP_ORDER.indexOf(a.kind) - STEP_ORDER.indexOf(b.kind))
    .map(step => {
      const amount = step.amount * scale(step)
      per[step.tax] -= amount
      return { step, amount, running: sum() }
    })
  return { total, rows }
}

export function TaxTrainer({ plan, tax, setTax, onTry }: {
  plan: TaxPlan
  tax: TaxCode | 'ALL'
  setTax: (t: TaxCode | 'ALL') => void
  onTry: (patch: WhatIf) => void
}) {
  const [mode, setMode] = useState<'month' | 'year'>('month')
  return (
    <section id="tax-trainer" className={card}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 dark:border-slate-700">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100"><GraduationCap className="h-4 w-4 text-brand" /> Trainer</h2>
          <p className="text-xs text-slate-500">Put in a number and see the steps that get there — and how much lower it can go.</p>
        </div>
        <div className="flex rounded-lg border p-0.5 text-xs dark:border-slate-600">
          {(['month', 'year'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} className={`rounded-md px-3 py-1 font-medium ${mode === m ? 'bg-brand text-white' : 'text-slate-600 dark:text-slate-300'}`}>
              {m === 'month' ? plan.period.label : 'The year'}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-1 overflow-x-auto border-b px-3 pt-2 dark:border-slate-700">
        {(['ALL', ...TAX_CODES] as const).map(t => (
          <button key={t} onClick={() => setTax(t)}
            className={`shrink-0 border-b-2 px-3 pb-2 text-sm font-medium ${tax === t ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>
      {mode === 'month'
        ? <MonthTrainer key={`${plan.period.ec_year}-${plan.period.ec_month}-${tax}`} plan={plan} tax={tax} onTry={onTry} />
        : <YearTrainer key={tax} tax={tax} />}
    </section>
  )
}

// ── This month ────────────────────────────────────────────────────────
function MonthTrainer({ plan, tax, onTry }: { plan: TaxPlan; tax: TaxCode | 'ALL'; onTry: (patch: WhatIf) => void }) {
  const draft = useMemo(() => {
    const d: WhatIf = {}
    for (const p of plan.policies) if (p.is_active !== p.saved_active || p.value !== p.saved_value) d[p.code] = { on: p.is_active, v: p.value }
    return d
  }, [plan.policies])
  const { data: levers, isLoading } = useTaxLevers(plan.period.ec_year, plan.period.ec_month, draft)
  const taxes: TaxCode[] = tax === 'ALL' ? TAX_CODES : [tax]
  const sched = tax === 'ALL' ? null : plan.schedules.find(s => s.code === tax) ?? null
  const savedGoal = tax === 'ALL' ? plan.totals.goal : sched?.goal ?? null
  const [target, setTarget] = useState<number | undefined>(savedGoal ?? undefined)

  if (isLoading || !levers) return <div className="h-40 animate-pulse" />
  const path = buildPath(levers.steps, levers.base, taxes, () => 1)
  const extras = levers.steps.filter(s => taxes.includes(s.tax) && !STEP_ORDER.includes(s.kind))

  if (tax === 'WHT') return <WhtCoach base={levers.base.WHT} extras={extras} />

  return (
    <div className="space-y-4 p-4">
      <TargetBar label={`Expected for ${plan.period.label}`} now={path.total} target={target} setTarget={setTarget}
        saveGoal={tax !== 'ALL' && plan.can_manage ? { tax, ec_year: plan.period.ec_year, ec_month: plan.period.ec_month, saved: savedGoal } : null} />
      <Floors rows={path.rows} start={path.total} />
      <Path start={path.total} rows={path.rows} target={target} onTry={onTry} scaleNote={null} />
      <Extras items={extras} />
    </div>
  )
}

function TargetBar({ label, now, target, setTarget, saveGoal, sub }: {
  label: string
  now: number
  target: number | undefined
  setTarget: (v: number | undefined) => void
  saveGoal: { tax: TaxCode; ec_year: number; ec_month: number; saved: number | null } | { tax: TaxCode; fiscal_period_id: string; saved: number | null } | null
  sub?: string
}) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [saving, setSaving] = useState(false)
  async function save() {
    if (!saveGoal || target == null) return
    setSaving(true)
    const { error } = 'fiscal_period_id' in saveGoal
      ? await supabase.from('tax_plan_year_goals').upsert({ fiscal_period_id: saveGoal.fiscal_period_id, schedule_code: saveGoal.tax, goal_amount: target, set_at: new Date().toISOString() })
      : await supabase.from('tax_plan_goals').upsert({ ec_year: saveGoal.ec_year, ec_month: saveGoal.ec_month, schedule_code: saveGoal.tax, goal_amount: target, set_at: new Date().toISOString() })
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    for (const k of ['tax-plan', 'tax-plan-history', 'tax-year']) qc.invalidateQueries({ queryKey: [k] })
    toast('Saved as the goal', 'success')
  }
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
        <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{etb(now)}</p>
        {sub && <p className="text-xs text-slate-400">{sub}</p>}
      </div>
      <ArrowRight className="mb-2 h-4 w-4 text-slate-300" />
      <label className="block">
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Your number</span>
        <FormattedNumberInput value={target} onChange={setTarget} placeholder="e.g. 150,000"
          className="mt-0.5 block w-40 rounded-md border px-2.5 py-1.5 text-lg font-semibold tabular-nums dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
      </label>
      {saveGoal && target != null && target !== saveGoal.saved && (
        <button onClick={save} disabled={saving} className="mb-0.5 inline-flex items-center gap-1 rounded-md bg-brand px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
          <Save className="h-3.5 w-3.5" /> {saving ? 'Saving…' : 'Make it the goal'}
        </button>
      )}
      {target != null && (
        <p className={`mb-1.5 text-sm ${now <= target ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500'}`}>
          {now <= target ? `Already within it by ${etb(target - now)}` : `${etb(now - target)} to take off`}
        </p>
      )}
    </div>
  )
}

function Floors({ rows, start }: { rows: PathRow[]; start: number }) {
  // Rows are sorted by kind, so the total after the last row up to a kind
  // is how low that much of the path reaches.
  const upTo = (kind: StepKind) => {
    const prior = rows.filter(r => STEP_ORDER.indexOf(r.step.kind) <= STEP_ORDER.indexOf(kind))
    return prior.length ? prior[prior.length - 1].running : start
  }
  const tiers = [
    { label: 'Paperwork and buying right', value: upTo('procurement'), note: 'Lowers the tax for good' },
    { label: 'Plus timing moves', value: upTo('timing'), note: 'The moved part comes back next month' },
    { label: 'Plus pay policy', value: upTo('pay_policy'), note: 'Staff take home less unless pay rises' },
  ]
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {tiers.map((t, i) => (
        <div key={t.label} className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-900/40">
          <p className="text-[11px] font-medium text-slate-500">{i === 0 ? 'Lowest with' : ''} {t.label}</p>
          <p className="text-lg font-semibold tabular-nums text-slate-800 dark:text-slate-100">{etb(t.value)}</p>
          <p className="text-[11px] text-slate-400">{t.note}</p>
        </div>
      ))}
    </div>
  )
}

function Path({ start, rows, target, onTry, scaleNote }: { start: number; rows: PathRow[]; target: number | undefined; onTry?: (p: WhatIf) => void; scaleNote: string | null }) {
  if (rows.length === 0) {
    return <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-500 dark:bg-slate-900/40">No steps lower this one this month — it follows what is sold, bought and paid.</p>
  }
  const within = target != null && start <= target
  const reachedAt = target == null || within ? -1 : rows.findIndex(r => r.running <= target)
  const missed = target != null && !within && reachedAt === -1
  const lowest = rows[rows.length - 1].running
  return (
    <div>
      {scaleNote && <p className="mb-2 text-xs text-slate-400">{scaleNote}</p>}
      {within && <Reached text="You're already within your number. Every step below takes it lower still." />}
      <ol className="space-y-2">
        {rows.map((r, i) => (
          <li key={`${r.step.tax}-${r.step.code}`}>
            {i === reachedAt + 1 && reachedAt >= 0 && <p className="mb-2 mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Even lower</p>}
            <div className={`flex gap-3 rounded-lg border px-3 py-2.5 dark:border-slate-700 ${reachedAt >= 0 && i > reachedAt ? 'opacity-80' : ''}`}>
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${KIND_STYLE[r.step.kind]}`}>{STEP_KIND_LABEL[r.step.kind]}</span>
                  <span className="text-[10px] text-slate-400">{TAB_LABEL[r.step.tax]} · {KIND_NOTE[r.step.kind]}</span>
                </div>
                <p className="mt-1 text-sm font-medium text-slate-800 dark:text-slate-100">{r.step.title}</p>
                <p className="mt-0.5 text-xs text-slate-500">{r.step.detail}</p>
                <div className="mt-1.5 flex flex-wrap gap-3 text-xs">
                  {r.step.patch && onTry && <button onClick={() => onTry(r.step.patch!)} className="inline-flex items-center gap-1 font-medium text-violet-600 hover:underline"><FlaskConical className="h-3 w-3" /> Try it in the plan</button>}
                  {r.step.link && <Link to={r.step.link} className="inline-flex items-center gap-1 font-medium text-brand hover:underline">Open <ArrowRight className="h-3 w-3" /></Link>}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">−{etb(r.amount)}{r.step.estimate ? '*' : ''}</p>
                <p className="text-[11px] tabular-nums text-slate-400">→ {etb(r.running)}</p>
                {r.amount - ((i === 0 ? start : rows[i - 1].running) - r.running) > 1 && (
                  <p className="text-[10px] text-slate-400" title="VAT can't go below zero on a return — what's left carries to the next one as a credit">rest carried as VAT credit</p>
                )}
              </div>
            </div>
            {i === reachedAt && <div className="mt-2"><Reached text={`Your number is reached here — after ${i + 1} step${i === 0 ? '' : 's'}, at ${etb(r.running)}.`} /></div>}
          </li>
        ))}
      </ol>
      {missed && (
        <div className="mt-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Every step together reaches {etb(lowest)} — still {etb(lowest - target!)} above your number. Below that, the tax follows what is actually sold and paid; the advice underneath is what's left to explore.</p>
        </div>
      )}
      {rows.some(r => r.step.estimate) && <p className="mt-2 text-[11px] text-slate-400">* The most it could be — depends on what the documents show.</p>}
    </div>
  )
}

function Reached({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
      <CheckCircle2 className="h-4 w-4 shrink-0" /> {text}
    </p>
  )
}

function Extras({ items }: { items: TrainerStep[] }) {
  const rest = items.filter(s => s.kind !== 'protect')
  if (rest.length === 0) return null
  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Good to know</p>
      <ul className="space-y-1.5">
        {rest.map(s => (
          <li key={`${s.tax}-${s.code}`} className="flex gap-2 text-xs text-slate-600 dark:text-slate-300">
            {s.kind === 'advice' ? <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" /> : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />}
            <span><b className="font-medium text-slate-800 dark:text-slate-100">{s.title}.</b> {s.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function WhtCoach({ base, extras }: { base: number; extras: TrainerStep[] }) {
  const protect = extras.filter(s => s.kind === 'protect')
  return (
    <div className="space-y-4 p-4">
      <div className="flex gap-3 rounded-lg bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:bg-sky-900/20 dark:text-sky-200">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-medium">Withholding isn't the company's money — it's the vendors' tax, taken out of what they are paid.</p>
          <p className="mt-0.5 text-xs">About {etb(base)} is due this month. A lower figure would only mean paying vendors less, not saving anything, so the right goal is exactly what's due. What the trainer can do is keep it from turning into the company's own cost:</p>
        </div>
      </div>
      {protect.length === 0
        ? <Reached text="Nothing at risk this month — every payment over the threshold has its withholding set." />
        : (
          <ul className="space-y-2">
            {protect.map(s => (
              <li key={s.code} className="flex gap-3 rounded-lg border px-3 py-2.5 dark:border-slate-700">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{s.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{s.detail}</p>
                  {s.link && <Link to={s.link} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">Open <ArrowRight className="h-3 w-3" /></Link>}
                </div>
                {s.exposure != null && (
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{etb(s.exposure)}</p>
                    <p className="text-[11px] text-slate-400">at risk</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}

// ── The year ──────────────────────────────────────────────────────────
function YearTrainer({ tax }: { tax: TaxCode | 'ALL' }) {
  const { data: year, isLoading } = useTaxYear()
  const { data: levers } = useTaxLevers(null, null, null)
  const taxes: TaxCode[] = tax === 'ALL' ? TAX_CODES : [tax]
  const rows = year?.taxes.filter(t => taxes.includes(t.code)) ?? []
  const savedGoal = rows.length && rows.every(r => r.goal != null) ? rows.reduce((a, r) => a + (r.goal ?? 0), 0) : (tax !== 'ALL' ? rows[0]?.goal ?? null : null)
  const [target, setTarget] = useState<number | undefined>(savedGoal ?? undefined)

  if (isLoading || !year || !levers) return <div className="h-40 animate-pulse" />
  if (tax === 'WHT') return <WhtCoach base={rows[0]?.projected ?? 0} extras={levers.steps.filter(s => s.tax === 'WHT')} />

  const sum = (f: (t: YearTax) => number) => rows.reduce((a, t) => a + f(t), 0)
  const done = sum(t => t.done), projected = sum(t => t.projected)
  const left = rows[0]?.months_left ?? 0
  const monthsDone = (rows[0]?.months.filter(m => m.state === 'done').length) ?? 0
  const start: Record<string, number> = {}
  for (const t of rows) start[t.code] = t.projected
  // Paperwork counts once (it clears a backlog); buying and pay steps are
  // assumed to repeat every month left; timing moves tax between months
  // and doesn't change the year.
  const path = buildPath(levers.steps, start, taxes, s => s.kind === 'timing' ? 0 : s.kind === 'paperwork' ? 1 : left)
  const needed = target != null && left > 0 ? (target - done) / left : null

  return (
    <div className="space-y-4 p-4">
      <TargetBar label={`Projected for ${year.fiscal_period.label}`} now={projected} target={target} setTarget={setTarget}
        sub={`${etb(done)} in ${monthsDone} month${monthsDone === 1 ? '' : 's'} done · ${left} to go`}
        saveGoal={tax !== 'ALL' && year.can_manage ? { tax, fiscal_period_id: year.fiscal_period.id, saved: rows[0]?.goal ?? null } : null} />
      {needed != null && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 px-3 py-2.5 text-sm dark:bg-slate-900/40">
          <CalendarRange className="h-4 w-4 text-brand" />
          <p className="flex-1 text-slate-700 dark:text-slate-200">
            {needed < 0
              ? <>The months done are already past this number by {etb(-needed * left)}.</>
              : <>To land on {etb(target)}, the {left} months left need to average <b>{etb(needed)}</b> — they're on course for {etb((projected - done) / Math.max(left, 1))}.</>}
          </p>
          {tax !== 'ALL' && year.can_manage && needed >= 0 && <SpreadGoals tax={rows[0]} perMonth={needed} />}
        </div>
      )}
      <YearMonths rows={rows} />
      <Path start={projected} rows={path.rows} target={target}
        scaleNote={`Steps from ${levers.period.label}: buying and pay steps assumed to hold for each of the ${left} months left, paperwork counted once. Timing moves are left out — they don't change the year.`} />
      <Extras items={levers.steps.filter(s => taxes.includes(s.tax) && !STEP_ORDER.includes(s.kind))} />
    </div>
  )
}

function SpreadGoals({ tax, perMonth }: { tax: YearTax; perMonth: number }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  async function spread() {
    setBusy(true)
    const rows = tax.months.filter(m => m.state !== 'done').map(m => ({
      ec_year: m.ec_year, ec_month: m.ec_month, schedule_code: tax.code, goal_amount: Math.round(perMonth), set_at: new Date().toISOString(),
    }))
    const { error } = await supabase.from('tax_plan_goals').upsert(rows)
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    for (const k of ['tax-plan', 'tax-plan-history', 'tax-year']) qc.invalidateQueries({ queryKey: [k] })
    toast(`${tax.label} goal set to ${etb(perMonth)} for each month left`, 'success')
  }
  return (
    <button onClick={spread} disabled={busy} className="rounded-md border px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-white disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
      {busy ? 'Setting…' : 'Set it as each month’s goal'}
    </button>
  )
}

function YearMonths({ rows }: { rows: YearTax[] }) {
  const months = rows[0]?.months ?? []
  const values = months.map((_, i) => rows.reduce((a, t) => a + (t.months[i]?.value ?? 0), 0))
  const goals = months.map((_, i) => rows.every(t => t.months[i]?.goal != null) ? rows.reduce((a, t) => a + (t.months[i]?.goal ?? 0), 0) : null)
  const max = Math.max(1, ...values, ...goals.map(g => g ?? 0))
  return (
    <div>
      <div className="flex h-28 items-end gap-1.5">
        {months.map((m, i) => (
          <div key={`${m.ec_year}-${m.ec_month}`} className="group relative flex h-full flex-1 flex-col justify-end" title={`${m.label}: ${etb(values[i])} (${m.source})${goals[i] != null ? ` · goal ${etb(goals[i])}` : ''}`}>
            {goals[i] != null && <div className="absolute inset-x-0 h-0.5 rounded bg-slate-800 dark:bg-slate-100" style={{ bottom: `${(goals[i]! / max) * 100}%` }} />}
            <div className={`rounded-t ${m.state === 'done' ? 'bg-[#2a78d6] dark:bg-[#3987e5]' : m.state === 'current' ? 'bg-[#2a78d6]/70 ring-2 ring-[#2a78d6] dark:bg-[#3987e5]/70' : 'bg-[#2a78d6]/25 dark:bg-[#3987e5]/30'}`}
              style={{ height: `${Math.max((values[i] / max) * 100, values[i] > 0 ? 2 : 0)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5">
        {months.map(m => <span key={`${m.ec_year}-${m.ec_month}l`} className={`flex-1 truncate text-center text-[10px] ${m.state === 'current' ? 'font-semibold text-slate-700 dark:text-slate-200' : 'text-slate-400'}`}>{m.label.slice(0, 3)}</span>)}
      </div>
      <p className="mt-1 flex flex-wrap gap-3 text-[11px] text-slate-400">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[#2a78d6]" /> Done</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[#2a78d6]/70 ring-1 ring-[#2a78d6]" /> This month</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[#2a78d6]/25" /> Projected</span>
        <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-slate-800 dark:bg-slate-100" /> Monthly goal</span>
      </p>
    </div>
  )
}
