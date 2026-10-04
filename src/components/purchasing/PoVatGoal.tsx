import { Link } from 'react-router-dom'
import { Landmark, Target, ArrowRight, AlertTriangle } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { FactList, Panel, Pill } from '@/components/record/Record'
import { compactEtb, stepText, type PoVatEffect, type PoVatGoal } from '@/lib/poVatGoal'

// Whole birr: the goal is an estimate, and cents only crowd the figures.
const etb = (n: number) => formatCurrency(Math.round(n)).replace(/\.00$/, '')
const pct = (n: number) => `${(n * 100).toFixed(n < 0.01 ? 1 : 0)}%`

// Series colours: receipts / approved bills / open orders.
const SEG = {
  receipt: 'bg-[#1baa74] dark:bg-[#2bbf86]',
  pay: 'bg-[#2a78d6] dark:bg-[#3987e5]',
  raise: 'bg-[#eb6834] dark:bg-[#d95926]',
}

/** The admin switch. */
export function PoVatToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
      title="Admin only: what each PO could do for the month's saved VAT goal"
      className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${on
        ? 'border-brand bg-brand/10 text-brand'
        : 'text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700'}`}>
      <Landmark className="h-4 w-4" />
      VAT goal
      <span className={`relative h-4 w-7 rounded-full transition-colors ${on ? 'bg-brand' : 'bg-slate-300 dark:bg-slate-600'}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${on ? 'left-3.5' : 'left-0.5'}`} />
      </span>
    </button>
  )
}

/** The month's goal, the gap, and the POs that close it — above the PO list. */
export function PoVatSummary({ data, loading, onPick }: {
  data: PoVatGoal | undefined
  loading: boolean
  onPick: (p: { y: number; m: number }) => void
}) {
  if (!data) {
    return <div className="rounded-xl border bg-white p-4 text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-800">{loading ? 'Working out the VAT goal…' : 'The VAT goal could not be loaded.'}</div>
  }
  const { period, goal, course, need, totals } = data
  const top = data.pos.filter(p => p.potential > 0.5).slice(0, 8)
  const reachIdx = data.pos.findIndex(p => p.reaches_goal)
  const base = need && need > 0 ? need : Math.max(totals.potential, 1)
  const w = (v: number) => `${Math.min(100, (v / base) * 100)}%`
  const askN = data.pos.filter(p => p.step === 'ask').length
  const switchN = data.pos.filter(p => p.step === 'switch').length
  const months = data.goal_months.some(g => g.ec_year === period.ec_year && g.ec_month === period.ec_month)
    ? data.goal_months
    : [{ ec_year: period.ec_year, ec_month: period.ec_month, label: period.label, goal: NaN }, ...data.goal_months]

  return (
    <section className={`rounded-xl border border-brand/30 bg-white shadow-sm dark:border-brand/40 dark:bg-slate-800 ${loading ? 'opacity-70' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 dark:border-slate-700">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <Target className="h-4 w-4 text-brand" /> VAT goal · {period.label}
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          {months.length > 1 && months.map(mo => {
            const active = mo.ec_year === period.ec_year && mo.ec_month === period.ec_month
            return (
              <button key={`${mo.ec_year}-${mo.ec_month}`} type="button" onClick={() => onPick({ y: mo.ec_year, m: mo.ec_month })}
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${active ? 'bg-brand text-white' : 'border text-slate-600 hover:border-brand dark:border-slate-600 dark:text-slate-300'}`}>
                {mo.label}
              </button>
            )
          })}
          <Link to="/tax-plan?tab=forecast" className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
            Tax plan <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      <div className="space-y-3 p-4">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Fact label="Saved goal" value={goal == null ? 'None saved' : etb(goal)} sub={goal == null ? 'Set one in the tax plan' : goal < 0 ? 'A VAT credit' : 'VAT to pay'} />
          <Fact label="Heading to" value={etb(course)} sub="With nothing more done" />
          <Fact label="Gap" value={need == null ? '—' : need <= 0 ? 'Met' : etb(need)} sub={need != null && need > 0 ? 'Input VAT needed' : need != null ? 'Already at the goal' : 'No goal to measure'} tone={need != null && need > 0 ? 'amber' : need != null ? 'green' : undefined} />
          <Fact label="POs could bring" value={etb(totals.potential)} sub={need && need > 0 ? (totals.potential >= need ? 'Enough to reach it' : `${pct(totals.potential / need)} of the gap`) : `${totals.pos} POs`} tone={need && need > 0 ? (totals.potential >= need ? 'green' : 'amber') : undefined} />
        </dl>

        <div>
          <div className="flex h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700" role="img"
            aria-label={`Receipts ${etb(totals.receipt)}, approved bills ${etb(totals.pay)}, open orders ${etb(totals.raise)}${need && need > 0 ? ` against a gap of ${etb(need)}` : ''}`}>
            <span className={SEG.receipt} style={{ width: w(totals.receipt) }} />
            <span className={`${SEG.pay} border-l border-white dark:border-slate-800`} style={{ width: w(Math.min(totals.pay, Math.max(base - totals.receipt, 0))) }} />
            <span className={`${SEG.raise} border-l border-white dark:border-slate-800`} style={{ width: w(Math.min(totals.raise, Math.max(base - totals.receipt - totals.pay, 0))) }} />
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
            <Legend cls={SEG.receipt} label={`Capture receipts ${etb(totals.receipt)}`} />
            <Legend cls={SEG.pay} label={`Pay approved bills ${etb(totals.pay)}`} />
            <Legend cls={SEG.raise} label={`${period.is_current ? 'Raise and pay open orders' : `Pay open orders in ${period.label}`} ${etb(totals.raise)}`} />
            {need != null && need > 0 && <span className="ml-auto">Bar = the {etb(need)} gap</span>}
          </div>
        </div>

        {top.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
              {reachIdx >= 0 ? `The ${reachIdx + 1} biggest POs reach the goal` : 'Biggest effect first'}
            </p>
            <ol className="divide-y rounded-lg border dark:divide-slate-700 dark:border-slate-700">
              {top.map((p, i) => (
                <li key={p.id}>
                  <Link to={`/sourcing/${p.id}`} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <span className="w-5 shrink-0 text-right text-xs tabular-nums text-slate-400">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate sm:inline">
                        <span className="font-mono text-xs font-semibold text-brand">{p.code}</span>
                      </span>
                      <span className="block truncate text-slate-700 sm:ml-2 sm:inline dark:text-slate-200">{p.vendor ?? 'No vendor'}</span>
                      <span className="block text-[11px] text-slate-400">{stepText(p.step, period).label}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-semibold tabular-nums text-slate-800 dark:text-slate-100">{etb(p.potential)}</span>
                      {p.share != null && <span className="block text-[11px] text-slate-400">{pct(p.share)} of the gap</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </div>
        )}

        {(askN > 0 || switchN > 0) && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {askN > 0 && <>{askN} PO{askN === 1 ? '' : 's'} from vendors listed only as "Supplier" carry {etb(totals.ask)} of VAT — ask them for VAT receipts. </>}
            {switchN > 0 && <>{switchN} from suppliers with no VAT receipt ({etb(totals.switch)} if bought from a VAT supplier at the same total).</>}
          </p>
        )}
        <p className="flex items-start gap-1.5 text-[11px] text-slate-400">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
          Paying early only moves VAT between months, and buying more to claim VAT never pays (1.15 out for 0.15 back). Use this to time what is needed anyway.
        </p>
      </div>
    </section>
  )
}

function Fact({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'amber' | 'green' }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={`break-words text-base font-bold tabular-nums sm:text-lg ${tone === 'amber' ? 'text-amber-600 dark:text-amber-400' : tone === 'green' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-800 dark:text-slate-100'}`}>{value}</dd>
      <dd className="text-[11px] text-slate-500 dark:text-slate-400">{sub}</dd>
    </div>
  )
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return <span className="flex items-center gap-1"><span className={`h-2.5 w-2.5 rounded-sm ${cls}`} />{label}</span>
}

/** One PO's effect, on its row in the list. */
export function PoVatChip({ e, period }: { e: PoVatEffect | undefined; period: PoVatGoal['period'] }) {
  if (!e) return null
  const s = stepText(e.step, period)
  if (e.potential > 0.5) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <Pill tone="blue" icon={Landmark} title={`${s.label}. ${s.detail}`}>
          {compactEtb(e.potential)} VAT{e.share != null ? ` · ${pct(e.share)} of gap` : ''} · {s.label}
        </Pill>
        {e.reaches_goal && <Pill tone="green" icon={Target} title="With this PO and every bigger one done, the month reaches its VAT goal">Goal reached here</Pill>}
      </span>
    )
  }
  if (e.step === 'ask') return <Pill tone="amber" icon={Landmark} title={s.detail}>Ask for VAT receipt · {compactEtb(e.ask)}</Pill>
  if (e.step === 'switch') return <Pill tone="slate" icon={Landmark} title={s.detail}>No VAT receipt</Pill>
  return <Pill tone="slate" icon={Landmark} title={s.detail}>VAT counted</Pill>
}

/** One PO's effect, on its own page. */
export function PoVatPanel({ data, poId, onHide }: { data: PoVatGoal | undefined; poId: string; onHide: () => void }) {
  const e = data?.pos.find(p => p.id === poId)
  const s = e && data ? stepText(e.step, data.period) : null
  return (
    <Panel title={data ? `VAT goal · ${data.period.label}` : 'VAT goal'} icon={Landmark}
      action={<button type="button" onClick={onHide} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">Hide</button>}>
      {!data ? (
        <p className="text-sm text-slate-400">Working it out…</p>
      ) : !e ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Nothing from this PO left to claim in {data.period.label}.</p>
      ) : (
        <div className="space-y-3">
          <FactList facts={[
            { label: 'Could bring', value: etb(e.potential), hint: e.share != null ? `${pct(e.share)} of the ${etb(data.need ?? 0)} gap` : undefined, tone: e.potential > 0.5 ? 'green' : undefined },
            ...(e.counted > 0.5 ? [{ label: 'Already counted', value: etb(e.counted) }] : []),
            ...(e.receipt > 0.5 ? [{ label: 'Capture the receipt', value: etb(e.receipt) }] : []),
            ...(e.pay > 0.5 ? [{ label: 'Pay this month', value: etb(e.pay) }] : []),
            ...(e.raise > 0.5 ? [{ label: data.period.is_current ? 'Raise and pay' : `Pay in ${data.period.label}`, value: etb(e.raise) }] : []),
            ...(e.ask > 0.5 ? [{ label: 'With a VAT receipt', value: etb(e.ask), tone: 'amber' as const }] : []),
            ...(e.switch > 0.5 ? [{ label: 'From a VAT supplier', value: etb(e.switch) }] : []),
            { label: 'Month goal', value: data.goal == null ? 'None saved' : etb(data.goal), hint: `heading to ${etb(data.course)}` },
          ]} />
          {s && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
              <b>{s.label}.</b> {s.detail}
            </p>
          )}
          {e.reaches_goal && <Pill tone="green" icon={Target}>With the bigger POs, this one reaches the goal</Pill>}
        </div>
      )}
      <Link to="/tax-plan?tab=forecast" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
        Open the tax plan <ArrowRight className="h-3 w-3" />
      </Link>
    </Panel>
  )
}
