import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatCurrency, formatDate } from '@/lib/utils'
import { ETHIOPIAN_MONTHS_SHORT, ecPeriodLabel, toEthiopian, toGregorian } from '@/lib/ethiopianCalendar'
import { EVENT_META, INTERACTION_BY_VALUE, STRANDS, STRAND_BY_VALUE, type Strand } from '@/lib/clientHistory'
import { STAGE_BY_VALUE, SOURCE_LABEL } from '@/lib/salesJourney'
import type { ClientContact, ClientInteraction, ClientTimelineEvent, InteractionKind, OpportunitySource, OpportunityStage } from '@/types/database'
import { ExternalLink, X, ZoomIn, ZoomOut } from 'lucide-react'

type Range = 'all' | number

/** "quoted→won" → "Quoted → Won" */
function stageMove(detail: string | null) {
  if (!detail) return null
  const [a, b] = detail.split('→') as [OpportunityStage, OpportunityStage]
  return `${STAGE_BY_VALUE[a]?.label ?? a} → ${STAGE_BY_VALUE[b]?.label ?? b}`
}

function describe(e: ClientTimelineEvent, contacts: Map<string, ClientContact>) {
  const bits: string[] = []
  if (e.kind === 'deal_moved' || e.kind === 'deal_won' || e.kind === 'deal_lost') { const m = stageMove(e.detail); if (m) bits.push(m) }
  else if (e.kind === 'deal_opened' && e.detail) bits.push(SOURCE_LABEL[e.detail as OpportunitySource] ?? e.detail)
  else if (e.kind === 'interaction' && e.detail) bits.push(INTERACTION_BY_VALUE[e.detail as InteractionKind]?.label ?? e.detail)
  else if (e.detail && e.kind !== 'payment') { const d = e.detail.replace(/_/g, ' '); bits.push(d[0].toUpperCase() + d.slice(1)) }
  if (e.contact_id && contacts.get(e.contact_id)) bits.push(`with ${contacts.get(e.contact_id)!.full_name}`)
  if (e.amount != null && Number(e.amount) !== 0) bits.push(formatCurrency(Number(e.amount)))
  return bits.join(' · ')
}

/** Where an event lives in the app, if it has a page of its own. */
function eventLink(e: ClientTimelineEvent, clientId: string): { to: string; label: string } | null {
  const [prefix, id] = e.event_id.split(':')
  if (prefix === 'invoice' || prefix === 'payment') return { to: `/sales/${id}`, label: 'Open the invoice' }
  if (e.contract_id) return { to: `/contracts/${e.contract_id}/edit`, label: 'Open the contract' }
  if (e.opportunity_id) return { to: `/opportunities/${e.opportunity_id}/edit`, label: 'Open the deal' }
  if (e.project_id) return { to: `/projects/${e.project_id}`, label: 'Open the project' }
  if (prefix === 'doc') return { to: `/clients/${clientId}`, label: 'Open the client file' }
  return null
}

/**
 * Everything that has happened with a client on one strip, zoomable from
 * the whole relationship down to a single Ethiopian year, with each strand
 * (deals, money, projects, conversations, documents) switchable, a hover
 * card on every point and a drawer with the detail and a link through.
 */
export function RelationshipTimeline({ clientId, events, contacts, interactions, strands, onStrandsChange }: {
  clientId: string
  events: ClientTimelineEvent[]
  contacts: ClientContact[]
  interactions: ClientInteraction[]
  strands: Set<Strand>
  onStrandsChange: (s: Set<Strand>) => void
}) {
  const [range, setRange] = useState<Range>('all')
  const [hovered, setHovered] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  // Read once per mount: where "today" sits on the strip.
  const [now] = useState(() => Date.now())
  const contactMap = useMemo(() => new Map(contacts.map(c => [c.id, c])), [contacts])
  const talkMap = useMemo(() => new Map(interactions.map(i => [i.id, i])), [interactions])

  const years = useMemo(() => {
    const ys = new Set(events.map(e => toEthiopian(e.event_at).year))
    return [...ys].sort((a, b) => a - b)
  }, [events])

  const visible = useMemo(() => events.filter(e => {
    if (!strands.has(EVENT_META[e.kind]?.strand)) return false
    return range === 'all' || toEthiopian(e.event_at).year === range
  }), [events, strands, range])

  // The span of the strip, and its ticks: EC years across the whole
  // relationship, or the thirteen EC months when zoomed into one year.
  const { start, end, ticks } = useMemo(() => {
    if (range !== 'all') {
      const s = toGregorian(range, 1, 1).getTime()
      const e = toGregorian(range + 1, 1, 1).getTime()
      return { start: s, end: e, ticks: ETHIOPIAN_MONTHS_SHORT.map((m, i) => ({ at: toGregorian(range, i + 1, 1).getTime(), label: m })) }
    }
    const times = events.map(e => new Date(e.event_at).getTime())
    const lo = times.length ? Math.min(...times, now) : now - 365 * 86_400_000
    const hi = times.length ? Math.max(...times, now) : now
    const firstYear = toEthiopian(new Date(lo)).year
    const lastYear = toEthiopian(new Date(hi)).year
    const s = toGregorian(firstYear, 1, 1).getTime()
    const e = toGregorian(lastYear + 1, 1, 1).getTime()
    const t = []
    for (let y = firstYear; y <= lastYear; y++) t.push({ at: toGregorian(y, 1, 1).getTime(), label: `${y}` })
    return { start: s, end: e, ticks: t }
  }, [range, events, now])

  const pct = (t: number) => Math.min(100, Math.max(0, ((t - start) / (end - start)) * 100))

  // Stack points that would overlap into lanes, so every one stays clickable.
  const placed = useMemo(() => {
    const sorted = [...visible].sort((a, b) => new Date(a.event_at).getTime() - new Date(b.event_at).getTime())
    const lastInLane: number[] = []
    return sorted.map(e => {
      const x = pct(new Date(e.event_at).getTime())
      let lane = lastInLane.findIndex(last => x - last > 1.6)
      if (lane === -1) lane = lastInLane.length < 5 ? lastInLane.length : 4
      lastInLane[lane] = x
      return { e, x, lane }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, start, end])
  const lanes = Math.max(1, ...placed.map(p => p.lane + 1))

  const byMonth = useMemo(() => {
    const groups = new Map<string, ClientTimelineEvent[]>()
    for (const e of visible) {
      const ec = toEthiopian(e.event_at)
      const key = ecPeriodLabel(ec.year, ec.month)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(e)
    }
    return [...groups.entries()]
  }, [visible])
  const shownGroups = showAll ? byMonth : byMonth.slice(0, 6)

  const sel = selected ? events.find(e => e.event_id === selected) ?? null : null
  const hov = hovered ? placed.find(p => p.e.event_id === hovered) ?? null : null
  const nowX = pct(now)

  useEffect(() => {
    if (!sel) return
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setSelected(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sel])

  function toggle(s: Strand) {
    const next = new Set(strands)
    if (next.has(s) && next.size > 1) next.delete(s); else next.add(s)
    onStrandsChange(next)
  }

  return (
    <div className="rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3 dark:border-slate-700">
        <h2 className="mr-auto text-sm font-bold text-slate-800 dark:text-slate-100">The relationship</h2>
        <div className="flex items-center gap-1" role="group" aria-label="Zoom">
          <button type="button" onClick={() => setRange('all')} aria-pressed={range === 'all'}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${range === 'all' ? 'bg-brand text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300'}`}>
            <ZoomOut className="h-3 w-3" /> All years
          </button>
          {years.map(y => (
            <button key={y} type="button" onClick={() => setRange(y)} aria-pressed={range === y}
              className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium tabular-nums ${range === y ? 'bg-brand text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300'}`}>
              {range === y && <ZoomIn className="h-3 w-3" />}{y} E.C.
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 px-4 pt-3">
        {STRANDS.map(s => {
          const on = strands.has(s.value)
          const n = events.filter(e => EVENT_META[e.kind]?.strand === s.value && (range === 'all' || toEthiopian(e.event_at).year === range)).length
          return (
            <button key={s.value} type="button" onClick={() => toggle(s.value)} aria-pressed={on}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-opacity ${on ? s.chip : 'border-slate-200 text-slate-400 opacity-60 dark:border-slate-700'}`}>
              <span className={`h-2 w-2 rounded-full ${s.dot}`} /> {s.label} <span className="tabular-nums opacity-70">{n}</span>
            </button>
          )
        })}
      </div>

      {/* The strip */}
      <div className="px-4 pb-2 pt-4">
        <div className="relative" style={{ height: `${lanes * 18 + 30}px` }}>
          {ticks.map(t => (
            <div key={t.at} className="absolute top-0 bottom-5 border-l border-dashed border-slate-200 dark:border-slate-700" style={{ left: `${pct(t.at)}%` }}>
              <span className="absolute bottom-[-18px] -translate-x-1/2 whitespace-nowrap text-[10px] tabular-nums text-slate-400">{t.label}</span>
            </div>
          ))}
          {nowX > 0 && nowX < 100 && (
            <div className="absolute top-0 bottom-5 border-l-2 border-brand/60" style={{ left: `${nowX}%` }} title="Today">
              <span className="absolute -top-1 left-1 text-[9px] font-semibold uppercase tracking-wide text-brand">Today</span>
            </div>
          )}
          {placed.map(({ e, x, lane }) => {
            const meta = EVENT_META[e.kind]
            const future = new Date(e.event_at).getTime() > now
            const active = e.event_id === selected || e.event_id === hovered
            return (
              <button key={e.event_id} type="button"
                onMouseEnter={() => setHovered(e.event_id)} onMouseLeave={() => setHovered(h => (h === e.event_id ? null : h))}
                onFocus={() => setHovered(e.event_id)} onBlur={() => setHovered(null)}
                onClick={() => setSelected(e.event_id)}
                aria-label={`${meta.label}: ${e.title ?? ''}, ${formatDate(e.event_at)}`}
                className={`absolute -translate-x-1/2 rounded-full ring-white transition-transform dark:ring-slate-800 ${active ? 'z-10 h-4 w-4 scale-110 ring-2' : 'h-3 w-3 ring-1 hover:scale-125'} ${future ? `border-2 bg-white dark:bg-slate-800 ${STRAND_BY_VALUE[meta.strand].hollow}` : STRAND_BY_VALUE[meta.strand].dot}`}
                style={{ left: `${x}%`, top: `${lane * 18 + 6}px` }} />
            )
          })}
          {hov && (
            <div className="pointer-events-none absolute z-20 w-60 -translate-x-1/2 rounded-lg border bg-white p-2.5 text-xs shadow-lg dark:border-slate-600 dark:bg-slate-900"
              style={{ left: `${Math.min(88, Math.max(12, hov.x))}%`, top: `${hov.lane * 18 + 24}px` }}>
              <p className="font-semibold text-slate-800 dark:text-slate-100">{EVENT_META[hov.e.kind].label}</p>
              <p className="truncate text-slate-600 dark:text-slate-300">{hov.e.title}</p>
              <p className="text-[10px] text-slate-400">{formatDate(hov.e.event_at)}</p>
              {describe(hov.e, contactMap) && <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{describe(hov.e, contactMap)}</p>}
            </div>
          )}
        </div>
        {visible.length === 0 && <p className="py-4 text-center text-xs text-slate-400">Nothing in this view.</p>}
      </div>

      {/* The same events as a list, by Ethiopian month */}
      <div className="border-t px-4 py-3 dark:border-slate-700">
        {shownGroups.map(([month, list]) => (
          <div key={month} className="mb-3 last:mb-0">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{month}</p>
            <ul className="space-y-0.5">
              {list.map(e => {
                const meta = EVENT_META[e.kind]
                const Icon = meta.icon
                return (
                  <li key={e.event_id}>
                    <button type="button" onClick={() => setSelected(e.event_id)}
                      onMouseEnter={() => setHovered(e.event_id)} onMouseLeave={() => setHovered(null)}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-700/40 ${selected === e.event_id ? 'bg-slate-50 dark:bg-slate-700/40' : ''}`}>
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white ${STRAND_BY_VALUE[meta.strand].dot}`}><Icon className="h-3 w-3" /></span>
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium text-slate-700 dark:text-slate-200">{meta.label}</span>
                        <span className="text-slate-500 dark:text-slate-400"> · {e.title}</span>
                      </span>
                      <span className="hidden shrink-0 text-[11px] text-slate-400 sm:inline">{describe(e, contactMap)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
        {byMonth.length > 6 && (
          <button type="button" onClick={() => setShowAll(s => !s)} className="text-xs font-medium text-brand hover:underline">
            {showAll ? 'Show less' : `Show all ${byMonth.length} months`}
          </button>
        )}
      </div>

      {/* Drawer */}
      {sel && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/20" onClick={() => setSelected(null)}>
          <aside role="dialog" aria-label={EVENT_META[sel.kind].label}
            className="h-full w-full max-w-sm overflow-y-auto border-l bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-800"
            onClick={ev => ev.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-2">
              <div>
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STRAND_BY_VALUE[EVENT_META[sel.kind].strand].chip}`}>
                  {EVENT_META[sel.kind].label}
                </span>
                <h3 className="mt-2 text-base font-bold text-slate-800 dark:text-slate-100">{sel.title}</h3>
                <p className="text-xs text-slate-400">{formatDate(sel.event_at)}</p>
              </div>
              <button type="button" onClick={() => setSelected(null)} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
            </div>
            {describe(sel, contactMap) && <p className="text-sm text-slate-600 dark:text-slate-300">{describe(sel, contactMap)}</p>}
            {sel.kind === 'interaction' && (() => {
              const t = talkMap.get(sel.event_id.split(':')[1])
              if (!t) return null
              return (
                <div className="mt-4 space-y-2 text-sm">
                  <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-200">{t.summary}</p>
                  {t.next_step && (
                    <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                      Next: {t.next_step}{t.next_step_due ? ` · by ${formatDate(t.next_step_due)}` : ''}{t.next_step_done_at ? ' · done' : ''}
                    </p>
                  )}
                </div>
              )
            })()}
            {(() => {
              const l = eventLink(sel, clientId)
              return l && (
                <Link to={l.to} className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90">
                  {l.label} <ExternalLink className="h-3 w-3" />
                </Link>
              )
            })()}
          </aside>
        </div>
      )}
    </div>
  )
}
