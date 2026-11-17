import { useMemo, useState } from 'react'
import { formatCurrency, formatCurrencyCompact } from '@/lib/utils'
import { groupLabel, type WatchAlert, type WatchProject } from '@/lib/costWatch'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, OctagonAlert } from 'lucide-react'

// Three more ways to read cost watch (527), all from the numbers the page
// already has — no extra calls: what needs a look, a heat grid of new cost
// by project and cost group, and this period against the one before.

const money = (n: number) => formatCurrencyCompact(n)
const card = 'rounded-2xl border bg-white dark:border-slate-700 dark:bg-slate-800'

/** What someone should look at today: plain rules, most urgent first. */
export function NeedsALook({ alerts, onOpen }: { alerts: WatchAlert[]; onOpen: (projectId: string) => void }) {
  const [all, setAll] = useState(false)
  if (alerts.length === 0) return null
  const shown = all ? alerts : alerts.slice(0, 6)
  return (
    <section className={`${card} px-4 py-3`} aria-labelledby="cw-alerts">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 id="cw-alerts" className="text-sm font-semibold text-slate-800 dark:text-slate-100">Needs a look <span className="font-normal text-slate-400">({alerts.length})</span></h2>
        {alerts.length > 6 && (
          <button onClick={() => setAll(a => !a)} className="text-xs font-medium text-brand">{all ? 'Show fewer' : `Show all ${alerts.length}`}</button>
        )}
      </div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((a, i) => (
          <li key={`${a.projectId}-${a.title}-${i}`}>
            <button onClick={() => onOpen(a.projectId)}
              className="flex h-full w-full flex-col gap-1 rounded-xl border px-3 py-2.5 text-left hover:border-brand/50 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/30">
              <span className={`inline-flex items-center gap-1 self-start rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                a.level === 'act' ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-900/25 dark:text-amber-300'}`}>
                {a.level === 'act' ? <OctagonAlert className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                {a.level === 'act' ? 'Act now' : 'Check'}
              </span>
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{a.projectName}</span>
              <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{a.title}</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">{a.detail}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Projects down the side, cost groups across: new cost in the period, darker = more. */
export function HeatGrid({ projects, days, onOpen }: { projects: WatchProject[]; days: number; onOpen: (projectId: string) => void }) {
  const { rows, groups, bin } = useMemo(() => {
    const rows = projects.filter(p => p.newNow > 0).sort((a, b) => b.newNow - a.newNow)
    const order = new Map<string, number>()
    for (const p of rows) for (const g of p.groups) if (g.new_now > 0) order.set(g.name, Math.min(order.get(g.name) ?? 99, g.sort))
    const groups = [...order.entries()].sort((a, b) => a[1] - b[1]).map(([n]) => n)
    const vals = rows.flatMap(p => p.groups.map(g => g.new_now)).filter(v => v > 0)
    const lo = Math.log10(Math.min(...vals, 1e9)), hi = Math.log10(Math.max(...vals, 1))
    // seven steps on a log scale, from the smallest to the largest cell
    const bin = (v: number) => Math.min(7, 1 + Math.floor(((Math.log10(v) - lo) / (hi - lo || 1)) * 7))
    return { rows, groups, bin }
  }, [projects])

  if (rows.length === 0) return <p className="p-6 text-center text-sm text-slate-500">No new cost in the last {days} days.</p>
  return (
    <div className="space-y-2 p-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] border-separate text-xs" style={{ borderSpacing: 2 }}>
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-slate-400">
              <th className="px-1 py-1 text-left font-medium">Project</th>
              {groups.map(g => <th key={g} className="px-2 py-1 text-right font-medium">{groupLabel(g)}</th>)}
              <th className="px-2 py-1 text-right font-medium">All</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(p => (
              <tr key={p.id} onClick={() => onOpen(p.id)} className="cursor-pointer">
                <td className="max-w-[14rem] truncate px-1 py-1.5 text-slate-800 hover:text-brand dark:text-slate-100" title={p.name}>
                  {p.name} <span className="text-slate-400">{p.pm ?? 'no PM'}</span>
                </td>
                {groups.map(gName => {
                  const v = p.groups.find(g => g.name === gName)?.new_now ?? 0
                  if (!v) return <td key={gName} className="px-2 py-1.5 text-right text-slate-300 dark:text-slate-600">·</td>
                  const b = bin(v)
                  return (
                    <td key={gName} className={`cw-hc cw-hc${b} rounded px-2 py-1.5 text-right tabular-nums`} style={{ background: `var(--cw-h${b})` }}
                      title={`${p.name} · ${groupLabel(gName)}: +${formatCurrency(v)} in ${days} days`}>
                      {money(v)}
                    </td>
                  )
                })}
                <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-slate-800 dark:text-slate-100">+{money(p.newNow)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
        New cost in {days} days · darker is more
        {[1, 2, 3, 4, 5, 6, 7].map(i => <span key={i} className="h-2.5 w-4 rounded-sm" style={{ background: `var(--cw-h${i})` }} />)}
        · tap a project to open it
      </p>
    </div>
  )
}

/** This period against the one before, biggest jumps first. */
export function PeriodChange({ projects, days, onOpen }: { projects: WatchProject[]; days: number; onOpen: (projectId: string) => void }) {
  const [all, setAll] = useState(false)
  const rows = useMemo(() => projects.filter(p => p.newNow > 0 || p.newBefore > 0)
    .sort((a, b) => (b.newNow - b.newBefore) - (a.newNow - a.newBefore)), [projects])
  const max = Math.max(1, ...rows.map(p => Math.max(p.newNow, p.newBefore)))
  if (rows.length === 0) return <p className="p-6 text-center text-sm text-slate-500">No new cost in either period.</p>
  const shown = all ? rows : rows.slice(0, 15)
  return (
    <div className="space-y-2 p-3">
      <ol className="space-y-1">
        {shown.map(p => {
          const a = (p.newBefore / max) * 100, b = (p.newNow / max) * 100, d = p.newNow - p.newBefore
          return (
            <li key={p.id}>
              <button onClick={() => onOpen(p.id)} className="grid w-full grid-cols-[minmax(6rem,13rem)_minmax(0,1fr)_4.75rem] items-center gap-3 rounded-lg px-1 py-1 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-700/30"
                title={`${p.name}: ${formatCurrency(p.newBefore)} the ${days} days before → ${formatCurrency(p.newNow)} the last ${days} days`}>
                <span className="truncate text-slate-800 dark:text-slate-100">{p.name}</span>
                <span className="relative h-4" aria-hidden>
                  <span className="absolute top-[7px] h-0.5 bg-slate-200 dark:bg-slate-600" style={{ left: `${Math.min(a, b)}%`, width: `${Math.abs(b - a)}%` }} />
                  <span className="absolute top-[3px] -ml-[5px] h-2.5 w-2.5 rounded-full border-2 border-slate-400 bg-white dark:bg-slate-800" style={{ left: `${a}%` }} />
                  <span className="absolute top-[3px] -ml-[5px] h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-slate-800" style={{ left: `${b}%`, background: 'var(--cw-g1)' }} />
                </span>
                <span className={`inline-flex items-center justify-end gap-0.5 font-semibold tabular-nums ${d > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                  {d > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{money(Math.abs(d))}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
        <span className="flex flex-wrap gap-x-4">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-slate-400" />The {days} days before</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: 'var(--cw-g1)' }} />The last {days} days</span>
        </span>
        {rows.length > 15 && <button onClick={() => setAll(v => !v)} className="font-medium text-brand">{all ? 'Show fewer' : `Show all ${rows.length}`}</button>}
      </div>
    </div>
  )
}

/**
 * Each project as a dot: its cost so far, all steps (across, log scale),
 * against the new cost in the period (up). Big and still growing sits top
 * right; a small job suddenly spending like a big one sits top left.
 */
export function MomentumMap({ projects, days, onOpen }: { projects: WatchProject[]; days: number; onOpen: (projectId: string) => void }) {
  const [hover, setHover] = useState<{ p: WatchProject; x: number; y: number } | null>(null)
  const W = 640, H = 340, L = 52, R = 16, T = 16, B = 40

  const chart = useMemo(() => {
    const pts = projects.filter(p => p.total > 0)
    if (pts.length === 0) return null
    const lo = Math.floor(Math.log10(Math.min(...pts.map(p => p.total))))
    // end a little past the largest project, not at the next power of ten
    const hi = Math.log10(Math.max(...pts.map(p => p.total)) * 1.5)
    const yTop = Math.max(...pts.map(p => p.newNow), 1)
    const step = 10 ** Math.floor(Math.log10(yTop)) * (yTop / 10 ** Math.floor(Math.log10(yTop)) > 5 ? 2 : yTop / 10 ** Math.floor(Math.log10(yTop)) > 2 ? 1 : 0.5)
    const yMax = Math.ceil(yTop / step) * step
    const x = (v: number) => L + ((Math.log10(Math.max(v, 10 ** lo)) - lo) / (hi - lo || 1)) * (W - L - R)
    const y = (v: number) => H - B - (v / yMax) * (H - T - B)
    const xTicks = Array.from({ length: Math.floor(hi) - lo + 1 }, (_, i) => 10 ** (lo + i))
    const yTicks = Array.from({ length: Math.round(yMax / step) + 1 }, (_, i) => i * step)
    // name the five fastest growing, nudged so labels don't sit on each other
    const named = [...pts].filter(p => p.newNow > 0).sort((a, b) => b.newNow - a.newNow).slice(0, 5)
      .map(p => ({ p, cx: x(p.total), cy: y(p.newNow), ly: y(p.newNow) + 4 }))
      .sort((a, b) => a.ly - b.ly)
    for (let i = 1; i < named.length; i++) if (named[i].ly - named[i - 1].ly < 15) named[i].ly = named[i - 1].ly + 15
    return { pts, x, y, xTicks, yTicks, named, namedIds: new Set(named.map(n => n.p.id)) }
  }, [projects])

  if (!chart) return <p className="p-6 text-center text-sm text-slate-500">No project has cost yet.</p>
  const { pts, x, y, xTicks, yTicks, named, namedIds } = chart
  const short = (s: string) => (s.length > 24 ? `${s.slice(0, 22)}…` : s)
  const axis = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}K` : String(n))

  return (
    <div className="space-y-2 p-3">
      <div className="relative overflow-x-auto" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[28rem]" role="img"
          aria-label={`Projects by cost so far and new cost in ${days} days`}>
          {yTicks.map(t => (
            <g key={`y${t}`}>
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--cw-grid)" />
              <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--cw-axis)">{axis(t)}</text>
            </g>
          ))}
          {xTicks.map(t => (
            <text key={`x${t}`} x={x(t)} y={H - B + 18} textAnchor={x(t) > W - R - 20 ? 'end' : 'middle'} fontSize={11} fill="var(--cw-axis)">{axis(t)}</text>
          ))}
          <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--cw-axis)">Cost so far, all steps (log scale)</text>
          <text x={12} y={(T + H - B) / 2} textAnchor="middle" fontSize={11} fill="var(--cw-axis)" transform={`rotate(-90 12 ${(T + H - B) / 2})`}>New in {days} days</text>
          <text x={W - R - 4} y={T + 10} textAnchor="end" fontSize={11} fill="var(--cw-axis)">Big and still growing</text>
          <text x={L + 6} y={T + 10} fontSize={11} fill="var(--cw-axis)">Small but moving fast</text>

          {pts.map(p => {
            const cx = x(p.total), cy = y(p.newNow), big = namedIds.has(p.id)
            return (
              <g key={p.id} className="cursor-pointer" tabIndex={0} role="button" aria-label={`${p.name}: ${formatCurrency(p.total)} so far, +${formatCurrency(p.newNow)} in ${days} days`}
                onClick={() => onOpen(p.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(p.id) } }}
                onMouseEnter={() => setHover({ p, x: cx, y: cy })} onFocus={() => setHover({ p, x: cx, y: cy })} onBlur={() => setHover(null)}>
                <circle cx={cx} cy={cy} r={12} fill="transparent" />
                <circle cx={cx} cy={cy} r={big ? 6 : 4.5} fill="var(--cw-g1)" fillOpacity={big ? 1 : 0.55} stroke="var(--cw-tip-bg)" strokeWidth={2} />
              </g>
            )
          })}

          {named.map(({ p, cx, cy, ly }) => {
            const left = cx > L + 190
            const tx = left ? cx - 12 : cx + 12
            return (
              <g key={`l${p.id}`} pointerEvents="none">
                {Math.abs(ly - 4 - cy) > 3 && <line x1={left ? cx - 6 : cx + 6} y1={cy} x2={left ? tx + 2 : tx - 2} y2={ly - 4} stroke="var(--cw-axis)" strokeWidth={1} />}
                <text x={tx} y={ly} textAnchor={left ? 'end' : 'start'} fontSize={11.5} fontWeight={500} fill="var(--cw-tip-text)">{short(p.name)}</text>
              </g>
            )
          })}
        </svg>
        {hover && (
          <div className="pointer-events-none absolute z-10 rounded-lg border px-2.5 py-1.5 text-xs shadow-lg"
            style={{ left: `min(calc(${(hover.x / W) * 100}% + 12px), calc(100% - 14rem))`, top: `calc(${(hover.y / H) * 100}% + 10px)`, background: 'var(--cw-tip-bg)', borderColor: 'var(--cw-tip-border)', color: 'var(--cw-tip-text)' }}>
            <p className="font-semibold">{hover.p.name}</p>
            <p className="tabular-nums">{formatCurrency(hover.p.total)} so far</p>
            <p className="tabular-nums">+{formatCurrency(hover.p.newNow)} in {days} days</p>
            {hover.p.pm && <p className="opacity-70">{hover.p.pm}</p>}
          </div>
        )}
      </div>
      <p className="text-[11px] text-slate-400">The five fastest growing are named. Hover a dot for its figures; tap it to open the project.</p>
    </div>
  )
}
