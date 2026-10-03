import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  ChevronLeft, ChevronRight, Target, TrendingDown, TrendingUp, AlertTriangle, Info, CheckCircle2,
  ArrowRight, ChevronDown, FlaskConical, RotateCcw, Save, CalendarClock, Copy, GraduationCap,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatDateGC } from '@/lib/utils'
import { FormattedNumberInput } from '@/components/shared/FormattedNumberInput'
import {
  POLICY_AREA_LABEL, shiftPeriod, useTaxPlan, useTaxPlanHistory,
  type TaxCode, type TaxPlan, type TaxPlanMonth, type TaxPlanSchedule, type TaxPolicy, type TaxSuggestion, type WhatIf,
} from '@/lib/taxPlan'
import { TaxTrainer } from './TaxTrainer'

const etb = (n: number | null | undefined) => n == null ? '—' : Math.round(n).toLocaleString('en-US')
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${etb(Math.abs(n))}`
const card = 'rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800'

const TAX_NOTE: Record<string, string> = {
  VAT: 'VAT on sales less VAT on purchases',
  WHT: 'Withheld from vendors — their tax, collected for the government',
  SCH_A: 'Employment income tax on salaries',
  PENSION: '7% employee + 11% employer',
}

// Management's goal for each tax this month, the benchmark the books point
// to with the tax policies applied, and what was recorded, declared and
// paid (migration 411). Policies can be tried here before they're saved.
export default function TaxPlanPage() {
  const [period, setPeriod] = useState<{ y: number; m: number } | null>(null)
  const [draft, setDraft] = useState<WhatIf>({})
  const [coachTax, setCoachTax] = useState<TaxCode | 'ALL'>('ALL')
  const coach = (t: TaxCode) => {
    setCoachTax(t)
    document.getElementById('tax-trainer')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const { data: plan, isLoading, error, isFetching } = useTaxPlan(period?.y ?? null, period?.m ?? null, draft)
  const { data: history = [] } = useTaxPlanHistory()

  const p = plan?.period
  const go = (by: number) => p && setPeriod(shiftPeriod(p.ec_year, p.ec_month, by))
  const trying = Object.keys(draft).length > 0

  if (error) return <div className="p-6 text-sm text-red-600">{(error as Error).message}</div>

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Tax plan</h1>
          <p className="text-sm text-slate-500">The goal for each month, what the books say it will come to, and the policies that move it.</p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border bg-white p-1 dark:border-slate-700 dark:bg-slate-800">
          <button onClick={() => go(-1)} disabled={!p} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700" aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></button>
          <div className="min-w-[9.5rem] px-2 text-center">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{p?.label ?? '…'}</p>
            {p && <p className="text-[11px] text-slate-400">{formatDateGC(p.start)} – {formatDateGC(p.end)}</p>}
          </div>
          <button onClick={() => go(1)} disabled={!p} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700" aria-label="Next month"><ChevronRight className="h-4 w-4" /></button>
          {p && !p.is_current && <button onClick={() => setPeriod(null)} className="ml-1 rounded-md bg-brand/10 px-2 py-1 text-xs font-medium text-brand">This month</button>}
        </div>
      </header>

      {isLoading || !plan ? <div className={`${card} h-40 animate-pulse`} /> : (
        <>
          {trying && <TryingBar plan={plan} draft={draft} onReset={() => setDraft({})} onSaved={() => setDraft({})} />}
          <Headline plan={plan} busy={isFetching} />
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                {plan.schedules.map(s => <TaxCard key={`${plan.period.ec_year}-${plan.period.ec_month}-${s.code}-${s.goal}`} s={s} plan={plan} onCoach={() => coach(s.code)} />)}
              </div>
              {plan.can_manage && <CopyGoals plan={plan} />}
              <TaxTrainer plan={plan} tax={coachTax} setTax={setCoachTax} onTry={patch => setDraft(d => ({ ...d, ...patch }))} />
              <Suggestions items={plan.suggestions} />
              <History rows={history} />
            </div>
            <div className="space-y-5">
              <Policies plan={plan} draft={draft} setDraft={setDraft} />
              <DueThisMonth plan={plan} />
              <HowItWorks plan={plan} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Headline({ plan, busy }: { plan: TaxPlan; busy: boolean }) {
  const t = plan.totals
  const goal = t.goal
  // Only the taxes that have a goal are measured against it.
  const goaled = plan.schedules.filter(s => s.goal != null)
  const goaledBench = goaled.reduce((a, s) => a + Math.max(s.benchmark, 0), 0)
  const partial = goaled.length > 0 && goaled.length < plan.schedules.length
  const pct = goal ? Math.min(100, (goaledBench / goal) * 100) : null
  const over = goal != null && goaledBench > goal
  return (
    <section className={`${card} p-5 ${busy ? 'opacity-80' : ''}`}>
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Expected for {plan.period.label}</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900 dark:text-white">ETB {etb(t.benchmark)}</p>
          {goal != null ? (
            <>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                <div className={`h-full rounded-full ${over ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
              </div>
              <p className={`mt-1.5 flex items-center gap-1 text-sm ${over ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                {over ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                Goal ETB {etb(goal)}{partial && ` for ${goaled.map(s => s.label).join(', ')}`} — {over ? `${etb(goaledBench - goal)} over` : `${etb(goal - goaledBench)} under`}
              </p>
            </>
          ) : (
            <p className="mt-2 flex items-center gap-1 text-sm text-slate-500"><Target className="h-4 w-4" /> No goal set for this month{plan.can_manage ? ' — set one on each tax below.' : '.'}</p>
          )}
        </div>
        <dl className="grid grid-cols-3 gap-3 self-center text-sm">
          <Stat label="In the books now" value={t.recorded} hint="What a return filed today would say" />
          <Stat label="Declared" value={t.declared} hint="On filed returns" />
          <Stat label="Paid" value={t.paid} hint="To the authority" />
        </dl>
      </div>
    </section>
  )
}

function Stat({ label, value, hint }: { label: string; value: number | null; hint: string }) {
  return (
    <div title={hint}>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 font-semibold tabular-nums text-slate-800 dark:text-slate-100">{value == null ? '—' : etb(value)}</dd>
    </div>
  )
}

function TaxCard({ s, plan, onCoach }: { s: TaxPlanSchedule; plan: TaxPlan; onCoach: () => void }) {
  const [open, setOpen] = useState(false)
  const credit = s.benchmark < 0
  const over = s.goal != null && Math.max(s.benchmark, 0) > s.goal
  return (
    <div className={`${card} flex flex-col p-4`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-slate-800 dark:text-slate-100">{s.label}</p>
          <p className="text-xs text-slate-400">{TAX_NOTE[s.code]}</p>
        </div>
        {s.filing_status && <FilingChip s={s} />}
      </div>
      <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-slate-400">Benchmark</p>
      <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
        {credit ? <>{etb(-s.benchmark)} <span className="text-sm font-medium text-emerald-600">credit</span></> : etb(s.benchmark)}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div><span className="text-slate-400">In the books </span><span className="font-medium tabular-nums text-slate-700 dark:text-slate-200">{etb(s.recorded)}</span></div>
        <div className="text-right">{s.declared != null && <><span className="text-slate-400">Declared </span><span className="font-medium tabular-nums text-slate-700 dark:text-slate-200">{etb(s.declared)}</span></>}</div>
      </div>
      <GoalField s={s} plan={plan} over={over} />
      <div className="mt-3 flex items-center justify-between gap-2">
        <button onClick={() => setOpen(o => !o)} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-brand">
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} /> How it's built
        </button>
        <button onClick={onCoach} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
          <GraduationCap className="h-3.5 w-3.5" /> Coach me
        </button>
      </div>
      {open && (
        <ul className="mt-2 space-y-1 border-t pt-2 text-xs dark:border-slate-700">
          {s.parts.map(pt => (
            <li key={pt.label} className="flex justify-between gap-3">
              <span className="text-slate-600 dark:text-slate-300">{pt.label}{pt.count ? <span className="text-slate-400"> · {pt.count}</span> : null}
                {pt.full != null && Math.abs(pt.full - Math.abs(pt.amount)) > 1 && <span className="text-slate-400"> (of {etb(pt.full)})</span>}</span>
              <span className={`shrink-0 tabular-nums ${pt.amount < 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-200'}`}>{signed(pt.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function FilingChip({ s }: { s: TaxPlanSchedule }) {
  const late = s.filing_status !== 'acknowledged' && s.due_date && s.due_date < new Date().toISOString().slice(0, 10)
  const style = late ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
    : s.filing_status === 'draft' ? 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
  return (
    <Link to="/tax-filings" className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${style}`}>
      {late ? 'Late' : s.filing_status === 'draft' ? 'Not filed' : s.filing_status === 'filed' ? 'Filed' : 'Acknowledged'}
      {s.due_date && ` · due ${formatDateGC(s.due_date).slice(0, 6)}`}
    </Link>
  )
}

function GoalField({ s, plan, over }: { s: TaxPlanSchedule; plan: TaxPlan; over: boolean }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState<number | undefined>(s.goal ?? undefined)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    const key = { ec_year: plan.period.ec_year, ec_month: plan.period.ec_month, schedule_code: s.code }
    const { error } = value == null
      ? await supabase.from('tax_plan_goals').delete().match(key)
      : await supabase.from('tax_plan_goals').upsert({ ...key, goal_amount: value, set_at: new Date().toISOString() })
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    setEditing(false)
    qc.invalidateQueries({ queryKey: ['tax-plan'] })
    qc.invalidateQueries({ queryKey: ['tax-plan-history'] })
  }

  if (editing) {
    return (
      <div className="mt-3 flex items-center gap-2">
        <FormattedNumberInput value={value} onChange={setValue} placeholder="Goal (ETB)"
          className="w-full rounded-md border px-2.5 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
        <button onClick={save} disabled={saving} className="rounded-md bg-brand px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Save</button>
        <button onClick={() => { setEditing(false); setValue(s.goal ?? undefined) }} className="text-xs text-slate-400">Cancel</button>
      </div>
    )
  }
  return (
    <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900/40">
      <span className="flex items-center gap-1 text-slate-500"><Target className="h-3.5 w-3.5" /> Goal</span>
      <span className="flex items-center gap-2">
        {s.goal == null ? <span className="text-slate-400">Not set</span> : (
          <span className={`font-semibold tabular-nums ${over ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
            {etb(s.goal)} {over ? '· over' : '· within'}
          </span>
        )}
        {plan.can_manage && <button onClick={() => setEditing(true)} className="font-medium text-brand hover:underline">{s.goal == null ? 'Set' : 'Change'}</button>}
      </span>
    </div>
  )
}

function CopyGoals({ plan }: { plan: TaxPlan }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const goals = plan.schedules.filter(s => s.goal != null)
  if (goals.length === 0) return null
  async function copy() {
    setBusy(true)
    const rows = [1, 2, 3].flatMap(by => {
      const n = shiftPeriod(plan.period.ec_year, plan.period.ec_month, by)
      return goals.map(s => ({ ec_year: n.y, ec_month: n.m, schedule_code: s.code, goal_amount: s.goal!, set_at: new Date().toISOString() }))
    })
    const { error } = await supabase.from('tax_plan_goals').upsert(rows)
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['tax-plan-history'] })
    toast('Goals copied to the next three months', 'success')
  }
  return (
    <button onClick={copy} disabled={busy} className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-brand disabled:opacity-50">
      <Copy className="h-3.5 w-3.5" /> Use {plan.period.label}'s goals for the next three months
    </button>
  )
}

const TONE: Record<TaxSuggestion['tone'], { icon: typeof Info; cls: string }> = {
  save: { icon: TrendingDown, cls: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400' },
  risk: { icon: AlertTriangle, cls: 'text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400' },
  info: { icon: Info, cls: 'text-sky-600 bg-sky-50 dark:bg-sky-900/30 dark:text-sky-400' },
  good: { icon: CheckCircle2, cls: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400' },
}

function Suggestions({ items }: { items: TaxSuggestion[] }) {
  if (items.length === 0) return null
  return (
    <section className={card}>
      <h2 className="border-b px-4 py-3 text-sm font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100">What would move it</h2>
      <ul className="divide-y dark:divide-slate-700">
        {items.map(sg => {
          const t = TONE[sg.tone]
          const Icon = t.icon
          return (
            <li key={sg.key} className="flex gap-3 px-4 py-3">
              <span className={`mt-0.5 h-fit rounded-full p-1.5 ${t.cls}`}><Icon className="h-3.5 w-3.5" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{sg.title}</p>
                <p className="mt-0.5 text-xs text-slate-500">{sg.detail}</p>
                {sg.link && <Link to={sg.link} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">Open <ArrowRight className="h-3 w-3" /></Link>}
              </div>
              {sg.amount != null && (
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{etb(sg.amount)}</p>
                  <p className="text-[11px] text-slate-400">{sg.amount_label}</p>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Policies({ plan, draft, setDraft }: { plan: TaxPlan; draft: WhatIf; setDraft: (f: (d: WhatIf) => WhatIf) => void }) {
  function change(pol: TaxPolicy, next: { on?: boolean; v?: number }) {
    setDraft(d => {
      const cur = d[pol.code] ?? { on: pol.saved_active, v: pol.saved_value }
      const merged = { on: next.on ?? cur.on, v: next.v ?? cur.v }
      const n = { ...d }
      if (merged.on === pol.saved_active && merged.v === pol.saved_value) delete n[pol.code]
      else n[pol.code] = merged
      return n
    })
  }
  return (
    <section className={card}>
      <div className="border-b px-4 py-3 dark:border-slate-700">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Policies</h2>
        <p className="text-xs text-slate-500">Switch or adjust one to see what it does to {plan.period.label}. Nothing is saved until you save it.</p>
      </div>
      <ul className="divide-y dark:divide-slate-700">
        {plan.policies.map(pol => {
          const changed = !!draft[pol.code]
          return (
            <li key={pol.code} className={`px-4 py-3 ${changed ? 'bg-violet-50/60 dark:bg-violet-900/10' : ''}`}>
              <div className="flex items-start gap-3">
                <button role="switch" aria-checked={pol.is_active} aria-label={pol.name} onClick={() => change(pol, { on: !pol.is_active })}
                  className={`mt-0.5 h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors ${pol.is_active ? 'bg-brand' : 'bg-slate-300 dark:bg-slate-600'}`}>
                  <span className={`block h-4 w-4 rounded-full bg-white shadow transition-transform ${pol.is_active ? 'translate-x-4' : ''}`} />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{POLICY_AREA_LABEL[pol.area]}</p>
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{pol.name}</p>
                  {pol.description && <p className="mt-0.5 text-xs text-slate-500">{pol.description}</p>}
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <PolicyValue key={`${pol.code}:${pol.value}`} pol={pol} onCommit={v => change(pol, { v })} />
                    <Effect pol={pol} />
                  </div>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function PolicyValue({ pol, onCommit }: { pol: TaxPolicy; onCommit: (v: number) => void }) {
  const [v, setV] = useState<number | undefined>(pol.value)
  const commit = () => { if (v != null && v !== pol.value) onCommit(v) }
  if (pol.unit === 'pct') {
    const signedPct = pol.code === 'payroll_change'
    return (
      <label className="flex items-center gap-1 text-xs text-slate-500">
        <input type="number" value={v ?? ''} min={signedPct ? -100 : 0} max={signedPct ? 500 : 100} step={5}
          onChange={e => setV(e.target.value === '' ? undefined : Number(e.target.value))}
          onBlur={commit} onKeyDown={e => e.key === 'Enter' && commit()}
          className="w-16 rounded-md border px-2 py-1 text-right text-sm tabular-nums dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
        %
      </label>
    )
  }
  return (
    <label className="flex items-center gap-1 text-xs text-slate-500">
      ETB
      <span onBlur={commit} onKeyDown={e => e.key === 'Enter' && commit()}>
        <FormattedNumberInput value={v} onChange={setV} className="w-24 rounded-md border px-2 py-1 text-right text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
      </span>
    </label>
  )
}

function Effect({ pol }: { pol: TaxPolicy }) {
  if (!pol.is_active) return <span className="text-xs text-slate-400">Off</span>
  if (Math.abs(pol.effect) < 1) return <span className="text-xs text-slate-400">No effect this month</span>
  const lowers = pol.effect < 0
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${lowers ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200'}`}>
      {signed(pol.effect)}
    </span>
  )
}

function TryingBar({ plan, draft, onReset, onSaved }: { plan: TaxPlan; draft: WhatIf; onReset: () => void; onSaved: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [saving, setSaving] = useState(false)
  async function save() {
    setSaving(true)
    for (const [code, d] of Object.entries(draft)) {
      const { error } = await supabase.from('tax_policies').update({ is_active: d.on, value: d.v }).eq('code', code)
      if (error) { setSaving(false); toast(error.message, 'error'); return }
    }
    setSaving(false)
    onSaved()
    qc.invalidateQueries({ queryKey: ['tax-plan'] })
    qc.invalidateQueries({ queryKey: ['tax-plan-history'] })
    toast('Policies saved — every month now plans with them', 'success')
  }
  const n = Object.keys(draft).length
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm dark:border-violet-800 dark:bg-violet-900/20">
      <FlaskConical className="h-4 w-4 text-violet-600" />
      <p className="flex-1 text-violet-900 dark:text-violet-200">
        Trying {n} policy change{n === 1 ? '' : 's'} — the figures below show {plan.period.label} as if {n === 1 ? 'it were' : 'they were'} in place.
      </p>
      <button onClick={onReset} className="inline-flex items-center gap-1 rounded-md border border-violet-300 px-2.5 py-1.5 text-xs font-medium text-violet-700 dark:border-violet-700 dark:text-violet-300"><RotateCcw className="h-3.5 w-3.5" /> Back to saved</button>
      {plan.can_manage
        ? <button onClick={save} disabled={saving} className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"><Save className="h-3.5 w-3.5" /> {saving ? 'Saving…' : 'Save as policy'}</button>
        : <span className="text-xs text-violet-700 dark:text-violet-300">Only admin or an executive can save policies.</span>}
    </div>
  )
}

function DueThisMonth({ plan }: { plan: TaxPlan }) {
  if (plan.due_in_period.length === 0) return null
  const total = plan.due_in_period.reduce((a, d) => a + (d.paid ?? d.declared ?? d.expected ?? 0), 0)
  return (
    <section className={card}>
      <div className="border-b px-4 py-3 dark:border-slate-700">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100"><CalendarClock className="h-4 w-4 text-brand" /> To pay during {plan.period.label}</h2>
        <p className="text-xs text-slate-500">Returns falling due this month, whichever month they're for. About ETB {etb(total)} in all.</p>
      </div>
      <ul className="divide-y text-sm dark:divide-slate-700">
        {plan.due_in_period.map(d => (
          <li key={d.filing_id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div>
              <p className="font-medium text-slate-800 dark:text-slate-100">{d.code === 'SCH_A' ? 'Sch-A' : d.code === 'PENSION' ? 'Pension' : d.code} · {d.period_label}</p>
              <p className="text-xs text-slate-400">Due {formatDateGC(d.due_date)} · {d.status === 'draft' ? 'not filed' : d.status}</p>
            </div>
            <div className="text-right">
              <p className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{etb(d.paid ?? d.declared ?? d.expected)}</p>
              <p className="text-[11px] text-slate-400">{d.paid != null ? 'paid' : d.declared != null ? 'declared' : 'expected'}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function HowItWorks({ plan }: { plan: TaxPlan }) {
  const r = plan.rates
  return (
    <details className={`${card} px-4 py-3 text-xs text-slate-500`}>
      <summary className="cursor-pointer text-sm font-semibold text-slate-700 dark:text-slate-200">How the benchmark is worked out</summary>
      <ul className="mt-2 list-disc space-y-1.5 pl-4">
        <li><b>In the books</b> is what a return filed today would say: VAT on invoiced sales less VAT on reviewed receipts, withholding on payments made, payroll tax and pension on salaries paid.</li>
        <li><b>The benchmark</b> adds what is on its way — payment requests still to invoice, payments approved but not made, salaries still to pay (or, before payroll runs, last month's) — and applies the policies.</li>
        <li>Policies change what hasn't happened yet. A purchase already paid without a VAT receipt stays that way; it shows under “What would move it” instead.</li>
        <li>Rates come from the tax rate references: VAT {Math.round(r.vat * 100)}%, withholding {Math.round(r.wht * 100)}% over {etb(r.wht_goods)} for goods and {etb(r.wht_services)} for services (before VAT).</li>
        <li>A VAT credit isn't paid back — it carries to the next return — so totals count it as zero.</li>
      </ul>
    </details>
  )
}

function History({ rows }: { rows: TaxPlanMonth[] }) {
  const data = useMemo(() => rows.map(r => ({ ...r, short: r.label.replace(/ \d+$/, '') })), [rows])
  if (rows.length === 0) return null
  return (
    <section className={`${card} p-4 [--s1:#2a78d6] [--s2:#eb6834] [--goal:#0b0b0b] dark:[--s1:#3987e5] dark:[--s2:#d95926] dark:[--goal:#f1f5f9]`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Month by month</h2>
        <div className="flex gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--s1)]" /> Benchmark</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--s2)]" /> Declared</span>
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 bg-[var(--goal)]" /> Goal</span>
        </div>
      </div>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} barGap={2} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="currentColor" className="text-slate-100 dark:text-slate-700" />
            <XAxis dataKey="short" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={44}
              tickFormatter={v => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}K` : String(v)} />
            <Tooltip cursor={{ fill: 'rgba(148,163,184,0.12)' }} content={<HistoryTip />} />
            <Bar dataKey="benchmark" fill="var(--s1)" radius={[4, 4, 0, 0]} maxBarSize={22} />
            <Bar dataKey="declared" fill="var(--s2)" radius={[4, 4, 0, 0]} maxBarSize={22} />
            <Line dataKey="goal" stroke="none" isAnimationActive={false} legendType="none"
              dot={(props: { cx?: number; cy?: number; index?: number }) => props.cx == null || props.cy == null || !Number.isFinite(props.cy)
                ? <g key={props.index} />
                : <line key={props.index} x1={props.cx - 16} x2={props.cx + 16} y1={props.cy} y2={props.cy} stroke="var(--goal)" strokeWidth={2} strokeLinecap="round" />}
              activeDot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[11px] text-slate-400">Benchmarks use the saved policies. The current month is {rows.find(r => r.is_current)?.label ?? '—'}.</p>
    </section>
  )
}

function HistoryTip({ active, payload }: { active?: boolean; payload?: { payload: TaxPlanMonth }[] }) {
  if (!active || !payload?.length) return null
  const r = payload[0].payload
  return (
    <div className="rounded-lg border bg-white px-3 py-2 text-xs shadow-md dark:border-slate-700 dark:bg-slate-800">
      <p className="mb-1 font-semibold text-slate-800 dark:text-slate-100">{r.label}{r.is_current ? ' · this month' : ''}</p>
      <TipRow label="Benchmark" v={r.benchmark} />
      <TipRow label="In the books" v={r.recorded} />
      <TipRow label="Goal" v={r.goal} />
      <TipRow label="Declared" v={r.declared} />
      <TipRow label="Paid" v={r.paid} />
    </div>
  )
}
function TipRow({ label, v }: { label: string; v: number | null }) {
  return <p className="flex justify-between gap-4 text-slate-500">{label}<span className="tabular-nums text-slate-800 dark:text-slate-100">{etb(v)}</span></p>
}

