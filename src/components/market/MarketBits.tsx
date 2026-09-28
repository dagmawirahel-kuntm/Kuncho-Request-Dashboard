import { useMemo } from 'react'
import { formatCurrency } from '@/lib/utils'
import { FRESHNESS_CLASS, FRESHNESS_LABEL, sourceLabel, type Freshness, type HistoryRow } from '@/hooks/useMarketPrices'

/** A price going up costs us more, so up is red and down is green. */
export function ChangeBadge({ pct, title, className = '' }: { pct: number | null | undefined; title?: string; className?: string }) {
  if (pct == null) return <span className={`text-slate-300 dark:text-slate-600 ${className}`}>—</span>
  const n = Number(pct)
  if (Math.abs(n) < 0.05) return <span title={title} className={`text-xs text-slate-400 ${className}`}>same</span>
  return (
    <span title={title} className={`whitespace-nowrap text-xs font-semibold tabular-nums ${n > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'} ${className}`}>
      {n > 0 ? '↑' : '↓'} {Math.abs(n).toFixed(1)}%
    </span>
  )
}

export function FreshnessPill({ freshness, days }: { freshness: Freshness; days?: number | null }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${FRESHNESS_CLASS[freshness]}`}>
      {FRESHNESS_LABEL[freshness]}{days != null && <span className="font-normal normal-case tracking-normal opacity-80">· {days}d</span>}
    </span>
  )
}

/** Where the latest price sits between the lowest and highest we've paid. */
export function PriceRange({ min, max, latest }: { min: number | null | undefined; max: number | null | undefined; latest: number | null | undefined }) {
  if (min == null || max == null || latest == null) return <span className="text-xs text-slate-300 dark:text-slate-600">—</span>
  const lo = Number(min), hi = Number(max), v = Number(latest)
  if (hi - lo < 0.005) return <span className="text-[11px] text-slate-400">one price</span>
  const pos = Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100))
  return (
    <div className="w-28" title={`Lowest ${formatCurrency(lo)} · highest ${formatCurrency(hi)}`}>
      <div className="relative h-1.5 rounded-full bg-gradient-to-r from-emerald-200 via-amber-200 to-red-200 dark:from-emerald-900/60 dark:via-amber-900/60 dark:to-red-900/60">
        <span className="absolute top-1/2 h-3 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-slate-700 ring-2 ring-white dark:bg-slate-100 dark:ring-slate-800" style={{ left: `${pos}%` }} />
      </div>
      <div className="mt-0.5 flex justify-between text-[9px] tabular-nums text-slate-400">
        <span>{compact(lo)}</span><span>{compact(hi)}</span>
      </div>
    </div>
  )
}

function compact(n: number) {
  return n >= 100_000 ? `${(n / 1000).toFixed(0)}k` : n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString('en-US', { maximumFractionDigits: n < 100 ? 2 : 0 })
}

const SOURCE_DOT: Record<string, string> = {
  purchase: 'fill-brand',
  verified_quote: 'fill-emerald-500',
  check_request_response: 'fill-emerald-500',
  po_entry: 'fill-slate-400',
}

/**
 * Every price over time, placed by date so gaps are honest. Purchases are
 * brand-coloured, verified quotes green; a dashed line marks the average.
 */
export function PriceChart({ rows }: { rows: HistoryRow[] }) {
  const pts = useMemo(() => rows.filter(r => !r.other_unit)
    .map(r => ({ t: new Date(r.sourced_at).getTime(), v: Number(r.unit_price), s: r.source, r }))
    .sort((a, b) => a.t - b.t).slice(-80), [rows])
  if (pts.length === 0) return null
  const W = 560, H = 170, L = 60, R = 12, T = 12, B = 26
  const vs = pts.map(p => p.v)
  let lo = Math.min(...vs), hi = Math.max(...vs)
  if (hi - lo < 0.005) { lo = lo * 0.9; hi = hi * 1.1 || 1 }
  const pad = (hi - lo) * 0.12
  lo = Math.max(0, lo - pad); hi = hi + pad
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t
  const x = (p: { t: number }, i: number) => t1 === t0
    ? (pts.length === 1 ? L + (W - L - R) / 2 : L + (i / (pts.length - 1)) * (W - L - R))
    : L + ((p.t - t0) / (t1 - t0)) * (W - L - R)
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B)
  const avg = vs.reduce((s, v) => s + v, 0) / vs.length
  const line = pts.map((p, i) => `${x(p, i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  const ticks = [hi, (hi + lo) / 2, lo]
  const d = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full" role="img" aria-label={`Price history, ${pts.length} prices`}>
      {ticks.map((v, i) => (
        <g key={i}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="stroke-slate-100 dark:stroke-slate-700" strokeWidth={1} />
          <text x={L - 6} y={y(v) + 3} textAnchor="end" className="fill-slate-400 text-[10px]">{compact(v)}</text>
        </g>
      ))}
      {pts.length > 1 && (
        <>
          <line x1={L} x2={W - R} y1={y(avg)} y2={y(avg)} className="stroke-slate-300 dark:stroke-slate-500" strokeDasharray="4 4" strokeWidth={1} />
          <polyline points={line} fill="none" className="stroke-brand/50" strokeWidth={1.5} />
        </>
      )}
      {pts.map((p, i) => (
        <circle key={p.r.id} cx={x(p, i)} cy={y(p.v)} r={4} className={`${SOURCE_DOT[p.s] ?? 'fill-slate-400'} stroke-white dark:stroke-slate-800`} strokeWidth={1.5}>
          <title>{`${formatCurrency(p.v)} · ${d(p.t)} · ${sourceLabel(p.s)}${p.r.vendor_name ? ` · ${p.r.vendor_name}` : ''}`}</title>
        </circle>
      ))}
      <text x={L} y={H - 6} className="fill-slate-400 text-[10px]">{d(t0)}</text>
      {t1 !== t0 && <text x={W - R} y={H - 6} textAnchor="end" className="fill-slate-400 text-[10px]">{d(t1)}</text>}
    </svg>
  )
}
