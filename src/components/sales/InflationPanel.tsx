import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Info, Loader2, Pencil, Rows3, TrendingUp, Undo2, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency } from '@/lib/utils'
import {
  blendedRate, inflationToCollection, observedIsReliable, pct, useInflationSettings, useObservedInflation,
  type CollectPlan, type InflationSettings, type InflationResult,
} from '@/lib/inflation'

// "Today's fair price against tomorrow": what a proforma's price is worth by
// the time each payment arrives, and the allowance that keeps it whole
// (lib/inflation.ts). In the editor the plan is editable and the allowance can
// be applied; on the proforma page it shows what the price was set for.

const etb = (n: number) => formatCurrency(Math.round(n)).replace(/\.00$/, '')
const num = 'w-full rounded-lg border bg-white px-2.5 py-1.5 text-sm tabular-nums outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'

export type InflationApplied = 'none' | 'spread' | 'line'

export function InflationPanel({
  price, plan, onPlan, materialsShare, shareSource, applied = 'none', appliedPct, onApply, onUndo, canEditBenchmark, readOnly = false,
}: {
  /** The price before VAT, after any discount. */
  price: number
  plan: CollectPlan
  onPlan?: (p: CollectPlan) => void
  materialsShare: number | null
  shareSource?: string
  applied?: InflationApplied
  appliedPct?: number | null
  onApply?: (how: 'spread' | 'line', r: InflationResult) => void
  onUndo?: () => void
  canEditBenchmark: boolean
  readOnly?: boolean
}) {
  const { data: settings } = useInflationSettings()
  const [editing, setEditing] = useState(false)
  const [showTable, setShowTable] = useState(false)
  const share = materialsShare ?? Number(settings?.default_materials_share ?? 0.6)
  const rate = settings ? blendedRate(settings, share) : 0
  const r = useMemo(() => inflationToCollection(price, plan, rate), [price, plan, rate])
  const progressPct = Math.max(0, 100 - plan.advancePct - plan.finalPct)
  const set = (patch: Partial<CollectPlan>) => onPlan?.({ ...plan, ...patch })

  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800" aria-label="Inflation to collection">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-300">
          <TrendingUp className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-[14rem] flex-1">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Inflation to collection</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Today's price, against what it is worth when each payment comes in. The longer the money takes, the less it buys.
          </p>
        </div>
        {applied !== 'none' && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
            <Check className="h-3.5 w-3.5" /> Allowance {appliedPct != null ? `+${appliedPct.toFixed(1)}% ` : ''}{applied === 'spread' ? 'in the prices' : 'as its own line'}
          </span>
        )}
      </div>

      {/* The plan */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <PlanField label="Months of work" value={plan.months} suffix="mo" readOnly={readOnly} step={0.5} max={60} onChange={v => set({ months: v })} />
        <PlanField label="Advance at signing" value={plan.advancePct} suffix="%" readOnly={readOnly} max={100} onChange={v => set({ advancePct: v })} />
        <PlanField label="Final on handover" value={plan.finalPct} suffix="%" readOnly={readOnly} max={100} onChange={v => set({ finalPct: v })} />
        <PlanField label="Final paid after" value={plan.finalLagMonths} suffix="mo" readOnly={readOnly} step={0.5} max={24} onChange={v => set({ finalLagMonths: v })} />
      </div>
      <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
        {progressPct > 0 ? `${progressPct}% against progress, spread over ${plan.months || 0} month${plan.months === 1 ? '' : 's'}` : 'No progress payments'}
        {' · '}money arrives on average <b className="text-slate-700 dark:text-slate-200">{r.avgMonths.toFixed(1)} months</b> from today
      </p>

      {/* Headline */}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Today's price" value={etb(price)} note="before VAT" />
        <Stat label="Worth when collected" value={etb(r.worthToday)} note={`${etb(r.lost)} lost to inflation`} tone="loss" />
        <Stat label="Price that keeps today's value" value={etb(r.neededPrice)} note={`+${r.allowancePct.toFixed(1)}% allowance`} tone="fix" />
      </div>

      {price > 0 && r.tranches.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3 text-[11px] text-slate-600 dark:text-slate-300">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#2a78d6] dark:bg-[#3987e5]" /> Worth in today's money</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#eb6834] dark:bg-[#d95926]" /> Lost to inflation</span>
            </div>
            <button type="button" onClick={() => setShowTable(t => !t)} aria-pressed={showTable}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700">
              <Rows3 className="h-3.5 w-3.5" /> {showTable ? 'Chart' : 'Table'}
            </button>
          </div>
          {showTable ? <CollectionTable r={r} /> : <CollectionChart r={r} />}
        </div>
      )}

      {/* The rate */}
      <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
        <div className="flex flex-wrap items-start gap-2">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
          <p className="min-w-0 flex-1">
            Yearly rate <b>{pct(rate)}</b>: materials {pct(Number(settings?.materials_rate ?? 0), 0)} on {Math.round(share * 100)}% of the cost
            {' '}and {pct(Number(settings?.general_rate ?? 0), 0)} on the rest
            {shareSource ? <span className="text-slate-400"> · share {shareSource}</span> : null}.
            {settings?.rate_note ? <span className="block text-slate-400">{settings.rate_note}</span> : null}
          </p>
          {canEditBenchmark && !editing && (
            <button type="button" onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-medium text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-700">
              <Pencil className="h-3 w-3" /> Benchmark
            </button>
          )}
        </div>
        {editing && settings && <BenchmarkEditor settings={settings} onClose={() => setEditing(false)} />}
      </div>

      {!readOnly && onApply && price > 0 && r.allowancePct > 0.05 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {applied === 'none' ? (
            <>
              <button type="button" onClick={() => onApply('spread', r)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-white">
                Add +{r.allowancePct.toFixed(1)}% to the prices
              </button>
              <button type="button" onClick={() => onApply('line', r)}
                className="inline-flex items-center gap-1.5 rounded-lg border bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
                Add {etb(r.neededPrice - price)} as its own line
              </button>
              <span className="text-[11px] text-slate-400">Spread it quietly into the unit prices, or show the client an escalation line.</span>
            </>
          ) : onUndo && (
            <button type="button" onClick={onUndo}
              className="inline-flex items-center gap-1.5 rounded-lg border bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
              <Undo2 className="h-4 w-4" /> Take the allowance out
            </button>
          )}
        </div>
      )}
    </section>
  )
}

function PlanField({ label, value, suffix, onChange, readOnly, step = 1, max }: {
  label: string; value: number; suffix: string; onChange: (v: number) => void; readOnly: boolean; step?: number; max: number
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">{label}</span>
      {readOnly ? (
        <span className="block text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{value}{suffix === '%' ? '%' : ` ${suffix}`}</span>
      ) : (
        <span className="relative block">
          <input type="number" min={0} max={max} step={step} value={Number.isFinite(value) ? value : 0} className={`${num} pr-9`}
            onChange={e => onChange(Math.min(max, Math.max(0, Number(e.target.value) || 0)))} />
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">{suffix}</span>
        </span>
      )}
    </label>
  )
}

function Stat({ label, value, note, tone }: { label: string; value: string; note: string; tone?: 'loss' | 'fix' }) {
  return (
    <div className={`rounded-lg border px-3 py-2.5 dark:border-slate-700 ${tone === 'fix' ? 'border-brand/30 bg-brand/[0.03] dark:border-[#D4AF37]/30 dark:bg-[#D4AF37]/[0.05]' : ''}`}>
      <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900 dark:text-slate-50">{value}</p>
      <p className={`text-[11px] ${tone === 'loss' ? 'text-orange-700 dark:text-orange-300' : 'text-slate-500 dark:text-slate-400'}`}>{note}</p>
    </div>
  )
}

// Each payment as a bar: the part still worth today's money below, the part
// inflation eats above. Hover a bar for its numbers.
function CollectionChart({ r }: { r: InflationResult }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 640, H = 150, padB = 20, padT = 8
  const n = r.tranches.length
  const max = Math.max(...r.tranches.map(t => t.amount), 1)
  const slot = W / n
  const barW = Math.max(6, Math.min(44, slot * 0.62))
  const y = (v: number) => H - padB - (v / max) * (H - padB - padT)
  const every = Math.ceil(n / 12)
  const short = (l: string) => l === 'Advance' ? 'Adv' : l === 'Final' ? 'Final' : l.replace('Month ', 'M')
  const t = hover != null ? r.tranches[hover] : null
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-36 w-full" role="img"
        aria-label={`Payments over time: ${r.tranches.map(x => `${x.label} ${etb(x.amount)}, worth ${etb(x.worth)}`).join('; ')}`}
        onMouseLeave={() => setHover(null)}>
        <line x1={0} x2={W} y1={H - padB} y2={H - padB} className="stroke-slate-200 dark:stroke-slate-700" strokeWidth={1} />
        {r.tranches.map((tr, i) => {
          const cx = slot * i + slot / 2
          const x = cx - barW / 2
          const yWorth = y(tr.worth), yTop = y(tr.amount)
          const lostH = Math.max(0, yWorth - yTop - 2)
          return (
            <g key={i} onMouseEnter={() => setHover(i)} opacity={hover == null || hover === i ? 1 : 0.55}>
              <rect x={slot * i} y={0} width={slot} height={H} fill="transparent" />
              <rect x={x} y={yWorth} width={barW} height={Math.max(0, H - padB - yWorth)} rx={lostH > 0 ? 0 : 4}
                className="fill-[#2a78d6] dark:fill-[#3987e5]" />
              {lostH > 0.5 && (
                <path className="fill-[#eb6834] dark:fill-[#d95926]"
                  d={`M${x},${yWorth - 2} V${yTop + 4} a4,4 0 0 1 4,-4 h${barW - 8} a4,4 0 0 1 4,4 V${yWorth - 2} Z`} />
              )}
              {i % every === 0 && (
                <text x={cx} y={H - 5} textAnchor="middle" className="fill-slate-400 text-[11px]">{short(tr.label)}</text>
              )}
            </g>
          )
        })}
      </svg>
      {t && hover != null && (
        <div className="pointer-events-none absolute top-0 z-10 w-48 -translate-x-1/2 rounded-lg border bg-white px-3 py-2 text-[11px] shadow-lg dark:border-slate-600 dark:bg-slate-800"
          style={{ left: `${Math.min(85, Math.max(15, ((hover + 0.5) / r.tranches.length) * 100))}%` }}>
          <p className="font-semibold text-slate-800 dark:text-slate-100">{t.label.startsWith('Month') ? t.label : `${t.label} · month ${t.month % 1 ? t.month.toFixed(1) : t.month}`}</p>
          <p className="text-slate-600 dark:text-slate-300">Collected <b className="tabular-nums">{etb(t.amount)}</b></p>
          <p className="text-slate-600 dark:text-slate-300">Worth today <b className="tabular-nums">{etb(t.worth)}</b></p>
          <p className="text-slate-600 dark:text-slate-300">Lost <b className="tabular-nums">{etb(t.amount - t.worth)}</b></p>
        </div>
      )}
    </div>
  )
}

function CollectionTable({ r }: { r: InflationResult }) {
  return (
    <div className="max-h-56 overflow-auto rounded-lg border dark:border-slate-700">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400">
          <tr><th className="px-3 py-1.5">Payment</th><th className="px-3 py-1.5 text-right">Month</th><th className="px-3 py-1.5 text-right">Collected</th><th className="px-3 py-1.5 text-right">Worth today</th><th className="px-3 py-1.5 text-right">Lost</th></tr>
        </thead>
        <tbody className="divide-y tabular-nums text-slate-700 dark:divide-slate-700 dark:text-slate-200">
          {r.tranches.map((t, i) => (
            <tr key={i}>
              <td className="px-3 py-1.5">{t.label}</td>
              <td className="px-3 py-1.5 text-right">{t.month % 1 ? t.month.toFixed(1) : t.month}</td>
              <td className="px-3 py-1.5 text-right">{etb(t.amount)}</td>
              <td className="px-3 py-1.5 text-right">{etb(t.worth)}</td>
              <td className="px-3 py-1.5 text-right">{etb(t.amount - t.worth)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// The benchmark itself, with our own price history beside it as evidence.
function BenchmarkEditor({ settings, onClose }: { settings: InflationSettings; onClose: () => void }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { data: obs } = useObservedInflation()
  const [mat, setMat] = useState(String(Math.round(Number(settings.materials_rate) * 1000) / 10))
  const [gen, setGen] = useState(String(Math.round(Number(settings.general_rate) * 1000) / 10))
  const [share, setShare] = useState(String(Math.round(Number(settings.default_materials_share) * 100)))
  const [months, setMonths] = useState(String(settings.default_months))
  const [lag, setLag] = useState(String(settings.default_final_lag_months))
  const [note, setNote] = useState(settings.rate_note ?? '')
  const [saving, setSaving] = useState(false)
  const reliable = observedIsReliable(obs)

  async function save() {
    setSaving(true)
    const { error } = await supabase.rpc('sales_inflation_save', {
      p_materials_rate: Number(mat) / 100, p_general_rate: Number(gen) / 100, p_default_materials_share: Number(share) / 100,
      p_default_months: Number(months), p_default_final_lag_months: Number(lag), p_rate_note: note.trim() || null,
    })
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    await qc.invalidateQueries({ queryKey: ['sales-inflation-settings'] })
    toast('Inflation benchmark saved — every proforma uses it from now', 'success')
    onClose()
  }

  const field = (label: string, value: string, setV: (v: string) => void, suffix: string) => (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">{label}</span>
      <span className="relative block">
        <input type="number" step="0.5" value={value} onChange={e => setV(e.target.value)} className={`${num} pr-9`} />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">{suffix}</span>
      </span>
    </label>
  )

  return (
    <div className="mt-3 space-y-3 border-t pt-3 dark:border-slate-700">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {field('Materials, a year', mat, setMat, '%')}
        {field('Labour & other, a year', gen, setGen, '%')}
        {field('Materials share', share, setShare, '%')}
        {field('Default months', months, setMonths, 'mo')}
        {field('Final paid after', lag, setLag, 'mo')}
      </div>
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">Where the rates come from</span>
        <input className={num} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. CPI for the latest month; cement and rebar quotes" />
      </label>
      <div className={`rounded-md px-3 py-2 ${reliable ? 'bg-sky-50 text-sky-900 dark:bg-sky-900/20 dark:text-sky-100' : 'bg-white text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>
        <p className="font-semibold">Our own purchase prices</p>
        {obs ? (
          reliable ? (
            <p>Across {obs.items} items bought more than once, prices moved a median <b>{pct(obs.median ?? 0)}</b> a year (middle half {pct(obs.p25 ?? 0, 0)} to {pct(obs.p75 ?? 0, 0)}).
              <button type="button" onClick={() => setMat(String(Math.round((obs.median ?? 0) * 1000) / 10))} className="ml-1 font-semibold underline">Use for materials</button></p>
          ) : (
            <p>Too little history to lean on yet: {obs.items} item{obs.items === 1 ? '' : 's'} bought twice, about {obs.avg_days ?? 0} days apart, out of {obs.prices} prices over {obs.history_days ?? 0} days.
              It becomes a usable check with 20+ items over about four months.</p>
          )
        ) : <p>Loading…</p>}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save benchmark
        </button>
        <button type="button" onClick={onClose}
          className="inline-flex items-center gap-1 rounded-lg border bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
          <X className="h-4 w-4" /> Cancel
        </button>
      </div>
    </div>
  )
}
