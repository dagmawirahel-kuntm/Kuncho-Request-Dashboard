import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatCurrency, formatCurrencyCompact } from '@/lib/utils'
import { GROUP_SLOT, STAGES, colorOf, cumulative, groupLabel, lastWeeks, useCostWatch, useCostWatchMoves, useCostWatchTrend, watchAlerts, type WatchGroup, type WatchMove, type WatchProject } from '@/lib/costWatch'
import { HeatGrid, NeedsALook, PeriodChange } from '@/components/projects/CostWatchViews'
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronRight, RefreshCw, TrendingUp } from 'lucide-react'

// One colour per cost group, fixed by the group (never by rank), from the
// validated categorical order: light and dark steps of the same hues.
const VARS = `
.cw-root { --cw-g1:#2a78d6; --cw-g2:#eb6834; --cw-g3:#1baf7a; --cw-g4:#eda100; --cw-g5:#e87ba4; --cw-other:#94a3b8; --cw-grid:#eef2f6; --cw-axis:#64748b; --cw-tip-bg:#ffffff; --cw-tip-border:#e2e8f0; --cw-tip-text:#1e293b;
  --cw-h1:#e6effb; --cw-h2:#b7d3f6; --cw-h3:#86b6ef; --cw-h4:#5598e7; --cw-h5:#2a78d6; --cw-h6:#1c5cab; --cw-h7:#0d366b; }
.dark .cw-root { --cw-g1:#3987e5; --cw-g2:#d95926; --cw-g3:#199e70; --cw-g4:#c98500; --cw-g5:#d55181; --cw-other:#64748b; --cw-grid:#334155; --cw-axis:#94a3b8; --cw-tip-bg:#0f172a; --cw-tip-border:#334155; --cw-tip-text:#e2e8f0;
  --cw-h1:#1b2a3d; --cw-h2:#184f95; --cw-h3:#1c5cab; --cw-h4:#256abf; --cw-h5:#3987e5; --cw-h6:#6da7ec; --cw-h7:#b7d3f6; }
.cw-root .cw-hc { color:#1e293b; } .cw-root .cw-hc5, .cw-root .cw-hc6, .cw-root .cw-hc7 { color:#ffffff; }
.dark .cw-root .cw-hc { color:#e2e8f0; } .dark .cw-root .cw-hc6, .dark .cw-root .cw-hc7 { color:#0f172a; }
`
const card = 'rounded-2xl border bg-white dark:border-slate-700 dark:bg-slate-800'
const money = (n: number) => formatCurrencyCompact(n)
const WINDOWS = [7, 30, 90] as const
type View = 'ranked' | 'heat' | 'change'
const VIEWS: { key: View; label: string }[] = [
  { key: 'ranked', label: 'Ranked' },
  { key: 'heat', label: 'Heat grid' },
  { key: 'change', label: 'Against the period before' },
]

function change(now: number, before: number) {
  if (before <= 0) return now > 0 ? { up: true, text: 'new' } : null
  const pct = Math.round(((now - before) / before) * 100)
  return { up: pct >= 0, text: `${pct >= 0 ? '+' : ''}${pct}%` }
}

/** One bar split by cost group, on a scale shared by every project. */
function GroupBar({ groups, scale }: { groups: WatchGroup[]; scale: number }) {
  return (
    <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700/60" role="img"
      aria-label={groups.filter(g => g.total > 0).map(g => `${groupLabel(g.name)} ${formatCurrency(g.total)}`).join(', ')}>
      {groups.filter(g => g.total > 0).map(g => (
        <div key={g.name} title={`${groupLabel(g.name)}: ${formatCurrency(g.total)}`}
          style={{ width: `${Math.max((g.total / scale) * 100, 0.6)}%`, background: colorOf(g.name) }} className="h-full first:rounded-l-full last:rounded-r-full" />
      ))}
    </div>
  )
}

function Legend({ names }: { names: string[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
      {names.map(n => (
        <span key={n} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: colorOf(n) }} />{groupLabel(n)}</span>
      ))}
    </div>
  )
}

function MoveLine({ m, showProject }: { m: WatchMove; showProject: boolean }) {
  const groups = Object.entries(m.groups ?? {}).filter(([, v]) => Number(v) !== 0).sort((a, b) => Number(b[1]) - Number(a[1]))
  const when = new Date(m.at)
  return (
    <li className="flex items-start gap-3 px-4 py-2.5 text-sm">
      <span className="w-14 shrink-0 pt-0.5 text-xs tabular-nums text-slate-400">
        {when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}<br />{when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-slate-800 dark:text-slate-100">
          <b>{m.step}</b>{' '}
          <Link to={m.link} className="text-brand hover:underline">{m.code ?? 'Open'}</Link>
          {showProject && <span className="text-slate-500"> · {m.project_name}</span>}
        </p>
        <p className="text-xs text-slate-500">
          {Number(m.amount) > 0 ? <b className="text-slate-700 dark:text-slate-200">{formatCurrency(Number(m.amount))}</b> : 'Not priced yet'}
          {Number(m.amount) > 0 && (groups.length > 1
            ? <> · {groups.map(([g, v]) => `${groupLabel(g)} ${money(Number(v))}`).join(', ')}</>
            : groups[0] ? <> · {groupLabel(groups[0][0])}</> : null)}
          {m.who ? ` · ${m.who}` : ''}
        </p>
      </div>
      {groups[0] && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: colorOf(groups[0][0]) }} />}
    </li>
  )
}

function Trend({ projectId }: { projectId: string }) {
  const weeks = useMemo(() => lastWeeks(16), [])
  const { data: rows = [], isLoading } = useCostWatchTrend(projectId, 16)
  const { groups, points } = useMemo(() => cumulative(rows, weeks), [rows, weeks])
  if (isLoading) return <p className="py-8 text-center text-xs text-slate-400">Loading…</p>
  if (!groups.length) return null
  const ordered = [...groups].sort((a, b) => (GROUP_SLOT[a] ?? 9) - (GROUP_SLOT[b] ?? 9))
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-300">Cost heading in, running total by week</p>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--cw-grid)" vertical={false} />
            <XAxis dataKey="week" tickFormatter={w => new Date(`${w}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              tick={{ fontSize: 10, fill: 'var(--cw-axis)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
            <YAxis tickFormatter={v => money(Number(v)).replace('ETB', '').trim()} tick={{ fontSize: 10, fill: 'var(--cw-axis)' }} axisLine={false} tickLine={false} width={44} />
            <Tooltip formatter={(v, n) => [formatCurrency(Number(v)), groupLabel(String(n))]}
              labelFormatter={w => `Week of ${new Date(`${w}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}
              contentStyle={{ fontSize: 12, borderRadius: 8, background: 'var(--cw-tip-bg)', border: '1px solid var(--cw-tip-border)', color: 'var(--cw-tip-text)' }}
              itemStyle={{ color: 'var(--cw-tip-text)', padding: 0 }} labelStyle={{ color: 'var(--cw-tip-text)', fontWeight: 600 }}
              itemSorter={item => -Number(item.value ?? 0)} />
            {ordered.map(g => <Line key={g} type="monotone" dataKey={g} stroke={colorOf(g)} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />)}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <Legend names={ordered} />
    </div>
  )
}

function ProjectDetail({ p, days }: { p: WatchProject; days: number }) {
  const { data: moves = [] } = useCostWatchMoves(p.id)
  return (
    <div className="space-y-4 border-t px-4 py-4 dark:border-slate-700">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
              <th className="py-1 pr-2 font-medium">Cost group</th>
              {STAGES.map(s => <th key={s.key} className="py-1 px-2 text-right font-medium">{s.label}</th>)}
              <th className="py-1 px-2 text-right font-medium">Total</th>
              <th className="py-1 pl-2 text-right font-medium">New, {days} days</th>
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-slate-700">
            {p.groups.map(g => (
              <tr key={g.name} className="tabular-nums text-slate-700 dark:text-slate-200">
                <td className="py-1.5 pr-2"><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: colorOf(g.name) }} />{groupLabel(g.name)}</span>
                  {g.unpriced > 0 && <span className="ml-1 text-[11px] text-amber-600">· {g.unpriced} not priced</span>}</td>
                {STAGES.map(s => <td key={s.key} className="py-1.5 px-2 text-right">{g[s.key] ? money(g[s.key]) : '—'}</td>)}
                <td className="py-1.5 px-2 text-right font-semibold">{money(g.total)}</td>
                <td className="py-1.5 pl-2 text-right">{g.new_now ? `+${money(g.new_now)}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Trend projectId={p.id} />
      {moves.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-300">Latest steps</p>
          <ul className="-mx-4 divide-y dark:divide-slate-700">{moves.slice(0, 6).map((m, i) => <MoveLine key={`${m.at}-${m.code}-${i}`} m={m} showProject={false} />)}</ul>
        </div>
      )}
      <Link to={`/projects/${p.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand">Open the project <ChevronRight className="h-3.5 w-3.5" /></Link>
    </div>
  )
}

/**
 * Cost watch (527): every project ranked by how much new cost is heading
 * into it, each cost group's money on its way from requested to paid, and
 * the latest steps as they happen. Refreshes itself every minute.
 */
export default function CostWatchPage() {
  const qc = useQueryClient()
  const [days, setDays] = useState<number>(30)
  const [open, setOpen] = useState<string | null>(null)
  // how the projects are shown: ranked list, heat grid, or this period against the one before
  const [view, setView] = useState<View>(() => { try { const v = localStorage.getItem('cost-watch-view'); return VIEWS.some(x => x.key === v) ? v as View : 'ranked' } catch { return 'ranked' } })
  function pickView(v: View) { setView(v); try { localStorage.setItem('cost-watch-view', v) } catch { /* private window */ } }
  /** From any view or card: show the project opened in the ranked list. */
  function openProject(id: string) {
    setView('ranked'); setOpen(id)
    requestAnimationFrame(() => document.getElementById(`cw-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  const { data: projects = [], isLoading, isFetching, dataUpdatedAt } = useCostWatch(days)
  const { data: moves = [] } = useCostWatchMoves()

  const ranked = useMemo(() => [...projects].sort((a, b) => b.newNow - a.newNow || b.total - a.total), [projects])
  const scale = Math.max(1, ...projects.map(p => p.total))
  const totals = useMemo(() => {
    const byGroup = new Map<string, WatchGroup>()
    let now = 0, before = 0
    for (const p of projects) {
      now += p.newNow; before += p.newBefore
      for (const g of p.groups) {
        const t = byGroup.get(g.name) ?? { ...g, requested: 0, ordered: 0, approved: 0, paid: 0, total: 0, new_now: 0, unpriced: 0 }
        t.requested += g.requested; t.ordered += g.ordered; t.approved += g.approved; t.paid += g.paid; t.total += g.total; t.new_now += g.new_now; t.unpriced += g.unpriced
        byGroup.set(g.name, t)
      }
    }
    return { now, before, groups: [...byGroup.values()].sort((a, b) => a.sort - b.sort) }
  }, [projects])
  const ch = change(totals.now, totals.before)
  const alerts = useMemo(() => watchAlerts(projects, days), [projects, days])
  const fastest = [...totals.groups].sort((a, b) => b.new_now - a.new_now)[0]

  function refresh() {
    for (const k of ['cost-watch', 'cost-watch-moves', 'cost-watch-trend']) void qc.invalidateQueries({ queryKey: [k] })
  }

  return (
    <div className="cw-root mx-auto max-w-5xl space-y-4 pb-10">
      <style>{VARS}</style>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800 dark:text-slate-100"><TrendingUp className="h-5 w-5 text-brand" /> Cost watch</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Where each project's money is heading, by cost group: requested, ordered, approved to pay, paid. Fastest growing first.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border p-0.5 text-xs dark:border-slate-600" role="group" aria-label="Period">
            {WINDOWS.map(w => (
              <button key={w} onClick={() => setDays(w)} className={`rounded-md px-2.5 py-1 ${days === w ? 'bg-brand text-white' : 'text-slate-500'}`}>{w} days</button>
            ))}
          </div>
          <button onClick={refresh} className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs text-slate-500 hover:text-brand dark:border-slate-600" title="Refresh now">
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}
          </button>
        </div>
      </div>

      {/* Across every project shown */}
      <section className={`${card} space-y-3 px-4 py-4`}>
        {isLoading ? <p className="text-sm text-slate-400">Loading…</p> : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p className="text-2xl font-bold tabular-nums text-slate-800 dark:text-slate-100">+{formatCurrency(Math.round(totals.now)).replace(/\.00$/, '')}</p>
              <p className="text-sm text-slate-500">
                new cost heading in over the last {days} days, across {projects.length} project{projects.length === 1 ? '' : 's'}
                {ch && <> · <span className={ch.up ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}>{ch.text}</span> on the {days} days before ({money(totals.before)})</>}
              </p>
            </div>
            {fastest && fastest.new_now > 0 && (
              <p className="text-sm text-slate-600 dark:text-slate-300">Growing most: <b>{groupLabel(fastest.name)}</b>, +{money(fastest.new_now)} in {days} days.</p>
            )}
            <GroupBar groups={totals.groups} scale={Math.max(1, totals.groups.reduce((n, g) => n + g.total, 0))} />
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
              {totals.groups.filter(g => g.total > 0).map(g => (
                <span key={g.name} className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colorOf(g.name) }} />
                  {groupLabel(g.name)} <b className="tabular-nums">{money(g.total)}</b>{g.new_now > 0 && <span className="text-slate-400">(+{money(g.new_now)})</span>}
                </span>
              ))}
            </div>
          </>
        )}
      </section>

      {!isLoading && <NeedsALook alerts={alerts} onOpen={openProject} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* The projects: ranked, as a heat grid, or against the period before */}
        <section className={`${card} min-w-0`}>
          <div className="flex flex-wrap gap-1 border-b px-3 py-2 dark:border-slate-700" role="tablist" aria-label="How to show the projects">
            {VIEWS.map(v => (
              <button key={v.key} role="tab" aria-selected={view === v.key} onClick={() => pickView(v.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${view === v.key ? 'bg-brand/10 text-brand' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-200'}`}>
                {v.label}
              </button>
            ))}
          </div>
          {view === 'heat' && <HeatGrid projects={projects} days={days} onOpen={openProject} />}
          {view === 'change' && <PeriodChange projects={projects} days={days} onOpen={openProject} />}
          {view === 'ranked' && (<>
          {!isLoading && ranked.length === 0 ? <p className="p-6 text-center text-sm text-slate-500">No project has cost on its way.</p> : (
            <ol className="divide-y dark:divide-slate-700">
              {ranked.map((p, i) => {
                const c = change(p.newNow, p.newBefore)
                const isOpen = open === p.id
                return (
                  <li key={p.id} id={`cw-${p.id}`} className="scroll-mt-4">
                    <button onClick={() => setOpen(isOpen ? null : p.id)} className="w-full space-y-1.5 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700/30" aria-expanded={isOpen}>
                      <div className="flex items-start gap-3">
                        <span className="w-6 shrink-0 pt-0.5 text-sm font-semibold tabular-nums text-slate-400">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{p.name}</p>
                          <p className="truncate text-xs text-slate-500">
                            {p.pm ?? 'No project manager'} · {money(p.total)} in all
                            {p.value ? <> · worth {money(p.value)} ({p.valueSource === 'contract' ? 'contract' : p.valueSource === 'quotation' ? 'accepted quotation' : 'invoiced'}), {Math.round((p.total / p.value) * 100)}% of it</> : ' · value not set'}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">+{money(p.newNow)}</p>
                          {c && (
                            <p className={`inline-flex items-center gap-0.5 text-xs ${c.up ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                              {c.up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{c.text}
                            </p>
                          )}
                        </div>
                        {isOpen ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />}
                      </div>
                      <div className="pl-9"><GroupBar groups={p.groups} scale={scale} /></div>
                      <p className="pl-9 text-xs text-slate-500">
                        {STAGES.filter(s => p.stages[s.key] > 0).map(s => `${s.label} ${money(p.stages[s.key])}`).join(' · ')}
                        {p.unpriced > 0 && <span className="text-amber-600"> · {p.unpriced} requested line{p.unpriced === 1 ? '' : 's'} not priced</span>}
                      </p>
                    </button>
                    {isOpen && <ProjectDetail p={p} days={days} />}
                  </li>
                )
              })}
            </ol>
          )}
          </>)}
        </section>

        {/* What just moved */}
        <section className={`${card} min-w-0 self-start`}>
          <h2 className="border-b px-4 py-3 text-sm font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100">Just moved</h2>
          {moves.length === 0 ? <p className="p-4 text-sm text-slate-500">Nothing in the last 60 days.</p> : (
            <ul className="max-h-[36rem] divide-y overflow-y-auto dark:divide-slate-700">
              {moves.slice(0, 25).map((m, i) => <MoveLine key={`${m.at}-${m.code}-${i}`} m={m} showProject />)}
            </ul>
          )}
        </section>
      </div>
      <p className="text-xs text-slate-400">
        A request with no estimate is priced at the last price paid for the same item. Bills to equipment, loans, advances and withdrawals are not project cost and are left out.
        Each amount is counted once, at the step it has reached.
      </p>
    </div>
  )
}
