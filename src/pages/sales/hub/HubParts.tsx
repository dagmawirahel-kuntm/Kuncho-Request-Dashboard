import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlarmClock, Check, Clock, Search, UserPlus, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { OPEN_STAGES, STAGES, STAGE_BY_VALUE, SOURCE_LABEL } from '@/lib/salesJourney'
import { EVENT_META, STRANDS, STRAND_BY_VALUE, type Strand } from '@/lib/clientHistory'
import {
  FOLLOWUP_LABEL, isDueToday, isOverdue, useHubScore, useRefreshHub,
  type HubDeal, type HubFeedEvent, type HubFollowup,
} from '@/lib/salesHub'
import type { ClientContact, ClientRelationshipRow, OpportunitySource, OpportunityStage } from '@/types/database'
import { LogInteractionDialog } from '@/pages/sales/client-history/ClientHistoryDialogs'

const card = 'rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800'
const chip = 'rounded-full border px-2.5 py-0.5 text-xs font-medium'
const inputCls = 'w-full rounded-md border px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'

export function Panel({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={`${card} p-4`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  )
}

// ── Numbers across the top ──────────────────────────────────────────────
export function KpiStrip({ deals, clients }: { deals: HubDeal[]; clients: ClientRelationshipRow[] }) {
  const { data: quotesOut = [] } = useQuery({
    queryKey: ['hub-quotes-out'],
    queryFn: async () => {
      const { data, error } = await supabase.from('proformas').select('id, total, valid_until').eq('status', 'sent')
      if (error) throw error
      return (data ?? []) as { id: string; total: number | null; valid_until: string | null }[]
    },
  })
  // Fixed for the life of the page, so a re-render never shifts the window.
  const [{ since90, today }] = useState(() => {
    const now = Date.now()
    return { since90: new Date(now - 90 * 864e5).toISOString(), today: new Date(now).toISOString().slice(0, 10) }
  })
  const open = deals.filter(d => OPEN_STAGES.includes(d.stage))
  const won90 = deals.filter(d => d.stage === 'won' && d.stage_since >= since90)
  const closed90 = deals.filter(d => (d.stage === 'won' || d.stage === 'lost') && d.stage_since >= since90)
  const liveQuotes = quotesOut.filter(q => !q.valid_until || q.valid_until >= today)
  const owed = clients.reduce((s, c) => s + Number(c.outstanding ?? 0), 0)
  const tiles = [
    { label: 'Open pipeline', value: formatCurrency(open.reduce((s, d) => s + Number(d.estimated_value ?? 0), 0)), note: `${open.length} deals` },
    { label: 'Weighted by win chance', value: formatCurrency(open.reduce((s, d) => s + Number(d.weighted_value ?? 0), 0)), note: 'what the pipeline is likely worth' },
    { label: 'Quotes out', value: formatCurrency(liveQuotes.reduce((s, q) => s + Number(q.total ?? 0), 0)), note: `${liveQuotes.length} sent, not answered` },
    { label: 'Won, last 90 days', value: formatCurrency(won90.reduce((s, d) => s + Number(d.estimated_value ?? 0), 0)), note: closed90.length ? `${Math.round((100 * won90.length) / closed90.length)}% of deals closed` : 'no deals closed' },
    { label: 'Clients owe', value: formatCurrency(owed), note: 'invoiced, not yet received' },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {tiles.map(t => (
        <div key={t.label} className={`${card} p-3`}>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t.label}</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-800 dark:text-slate-100">{t.value}</p>
          <p className="text-[11px] text-slate-400">{t.note}</p>
        </div>
      ))}
    </div>
  )
}

// ── What's waiting on someone ───────────────────────────────────────────
export function FollowupsPanel({ items, mine, userId }: { items: HubFollowup[]; mine: boolean; userId: string | undefined }) {
  const { toast } = useToast()
  const refresh = useRefreshHub()
  const [busy, setBusy] = useState<string | null>(null)
  const shown = items.filter(i => !mine || i.owner_user_id === userId)
  const order = (i: HubFollowup) => (isOverdue(i.due_on) ? 0 : isDueToday(i.due_on) ? 1 : i.due_on ? 2 : 3)
  const sorted = [...shown].sort((a, b) => order(a) - order(b) || (a.due_on ?? '9').localeCompare(b.due_on ?? '9'))

  async function done(i: HubFollowup) {
    setBusy(i.item_id)
    const { error } = i.interaction_id
      ? await supabase.from('client_interactions').update({ next_step_done_at: new Date().toISOString() }).eq('id', i.interaction_id)
      : await supabase.from('opportunities').update({ next_step: null, next_step_due: null }).eq('id', i.opportunity_id!)
    setBusy(null)
    if (error) { toast(error.message, 'error'); return }
    toast('Done — set the next one when you know it', 'success')
    refresh()
  }

  if (!sorted.length) return <p className="py-6 text-center text-sm text-slate-400">Nothing waiting{mine ? ' on you' : ''}.</p>
  return (
    <ul className="divide-y dark:divide-slate-700">
      {sorted.slice(0, 40).map(i => {
        const late = isOverdue(i.due_on)
        const canTick = i.kind === 'next_step'
        return (
          <li key={i.item_id} className="flex items-start gap-3 py-2">
            <span className={`mt-0.5 shrink-0 ${chip} ${late ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-800/40 dark:bg-red-900/20 dark:text-red-300' : 'border-slate-200 text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>
              {FOLLOWUP_LABEL[i.kind]}
            </span>
            <div className="min-w-0 flex-1">
              <Link to={i.link} className="block truncate text-sm font-medium text-slate-800 hover:text-brand dark:text-slate-100">{i.title}</Link>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">{[i.party, i.detail].filter(Boolean).join(' · ')}</p>
            </div>
            {i.due_on && (
              <span className={`shrink-0 text-xs tabular-nums ${late ? 'font-semibold text-red-600' : 'text-slate-500'}`}>
                {late ? <AlarmClock className="mr-1 inline h-3.5 w-3.5" /> : <Clock className="mr-1 inline h-3.5 w-3.5" />}{formatDate(i.due_on)}
              </span>
            )}
            {canTick && (
              <button type="button" onClick={() => done(i)} disabled={busy === i.item_id} title="Mark done"
                className="shrink-0 rounded-md border p-1 text-emerald-600 hover:bg-emerald-50 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-emerald-900/20">
                <Check className="h-4 w-4" />
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

// ── The board ────────────────────────────────────────────────────────────
export function PipelineBoard({ deals, mine, userId }: { deals: HubDeal[]; mine: boolean; userId: string | undefined }) {
  const { toast } = useToast()
  const refresh = useRefreshHub()
  const open = deals.filter(d => OPEN_STAGES.includes(d.stage) && (!mine || d.owner_user_id === userId))

  async function move(d: HubDeal, stage: OpportunityStage) {
    const { error } = await supabase.from('opportunities').update({ stage }).eq('id', d.id)
    if (error) { toast(error.message, 'error'); return }
    toast(`${d.title} → ${STAGE_BY_VALUE[stage].label}`, 'success')
    refresh()
  }

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2">
      <div className="grid min-w-[900px] grid-cols-5 gap-3">
        {OPEN_STAGES.map(stage => {
          const col = open.filter(d => d.stage === stage)
          const total = col.reduce((s, d) => s + Number(d.estimated_value ?? 0), 0)
          return (
            <div key={stage} className="rounded-lg bg-slate-50 p-2 dark:bg-slate-900/40">
              <div className="mb-2 flex items-baseline justify-between px-1">
                <span className={`${chip} ${STAGE_BY_VALUE[stage].cls} border-transparent`}>{STAGE_BY_VALUE[stage].label}</span>
                <span className="text-[11px] tabular-nums text-slate-500">{col.length} · {formatCurrency(total)}</span>
              </div>
              <div className="space-y-2">
                {col.map(d => {
                  const quiet = d.days_in_stage >= 14
                  return (
                    <div key={d.id} className="rounded-md border bg-white p-2 text-xs shadow-sm dark:border-slate-700 dark:bg-slate-800">
                      <Link to={`/opportunities/${d.id}/edit`} className="block font-medium text-slate-800 hover:text-brand dark:text-slate-100">{d.title}</Link>
                      <p className="truncate text-slate-500 dark:text-slate-400">
                        {d.client_id
                          ? <Link to={`/sales-journey/clients/${d.client_id}`} className="hover:text-brand">{d.party}</Link>
                          : <>{d.party ?? 'No client yet'} <span className="text-amber-600">· prospect</span></>}
                      </p>
                      <div className="mt-1 flex items-center justify-between tabular-nums">
                        <span className="font-semibold text-slate-700 dark:text-slate-200">{d.estimated_value ? formatCurrency(Number(d.estimated_value)) : '—'}</span>
                        <span className="text-slate-500" title="Win chance">{d.win_chance}%</span>
                      </div>
                      {d.proforma_number && (
                        <Link to={`/proformas/${d.proforma_id}`} className="mt-1 block truncate text-indigo-600 hover:underline dark:text-indigo-300">
                          {d.proforma_number} · {d.proforma_status}
                        </Link>
                      )}
                      <p className={`mt-1 truncate ${d.next_step ? (isOverdue(d.next_step_due) ? 'text-red-600' : 'text-slate-600 dark:text-slate-300') : 'text-amber-600'}`}>
                        {d.next_step ? `Next: ${d.next_step}${d.next_step_due ? ` · ${formatDate(d.next_step_due)}` : ''}` : 'No next step'}
                      </p>
                      <div className="mt-1 flex items-center justify-between gap-1">
                        <span className={quiet ? 'text-amber-600' : 'text-slate-400'}>{d.days_in_stage}d here{d.owner_name ? ` · ${d.owner_name.split(' ')[0]}` : ''}</span>
                        <select aria-label="Move to stage" value={d.stage} onChange={e => move(d, e.target.value as OpportunityStage)}
                          className="rounded border bg-transparent px-1 py-0.5 text-[11px] dark:border-slate-600">
                          {STAGES.filter(s => OPEN_STAGES.includes(s.value)).map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                      </div>
                    </div>
                  )
                })}
                {!col.length && <p className="px-1 py-3 text-center text-[11px] text-slate-400">Empty</p>}
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-[11px] text-slate-400">Won or lost? Open the deal to close it with its client or reason.</p>
    </div>
  )
}

// ── Everything that happened ────────────────────────────────────────────
export function FeedPanel({ events }: { events: HubFeedEvent[] }) {
  const [strand, setStrand] = useState<Strand | 'all'>('all')
  const shown = events.filter(e => strand === 'all' || EVENT_META[e.kind]?.strand === strand)
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setStrand('all')} className={`${chip} ${strand === 'all' ? 'border-brand text-brand' : 'border-slate-200 text-slate-500 dark:border-slate-600'}`}>Everything</button>
        {STRANDS.map(s => (
          <button key={s.value} type="button" onClick={() => setStrand(s.value)} className={`${chip} ${strand === s.value ? s.chip : 'border-slate-200 text-slate-500 dark:border-slate-600'}`}>{s.label}</button>
        ))}
      </div>
      <ul className="space-y-2">
        {shown.slice(0, 60).map(e => {
          const meta = EVENT_META[e.kind]
          const Icon = meta?.icon
          return (
            <li key={e.event_id} className="flex items-start gap-2 text-sm">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${meta ? STRAND_BY_VALUE[meta.strand].dot : 'bg-slate-300'}`} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-slate-700 dark:text-slate-200">
                  {Icon && <Icon className="mr-1 inline h-3.5 w-3.5 text-slate-400" />}
                  <span className="font-medium">{meta?.label ?? e.kind}</span>
                  {e.title ? ` · ${e.title}` : ''}
                </p>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {e.client_id ? <Link to={`/sales-journey/clients/${e.client_id}`} className="hover:text-brand">{e.client_name}</Link> : null}
                  {e.amount ? ` · ${formatCurrency(Number(e.amount))}` : ''} · {formatDate(e.event_at)}
                </p>
              </div>
            </li>
          )
        })}
        {!shown.length && <li className="py-6 text-center text-sm text-slate-400">Nothing yet.</li>}
      </ul>
    </>
  )
}

// ── Scorecard ────────────────────────────────────────────────────────────
export function Scorecard() {
  const [days, setDays] = useState(365)
  const [dim, setDim] = useState<'owner' | 'source'>('owner')
  const { data = [], isLoading } = useHubScore(days)
  const rows = data.filter(r => r.dimension === dim)
  const pct = (n: number | null) => (n == null ? '—' : `${n}%`)
  return (
    <Panel title="Scorecard" right={
      <div className="flex gap-2 text-xs">
        <select value={dim} onChange={e => setDim(e.target.value as 'owner' | 'source')} className="rounded border px-2 py-1 dark:border-slate-600 dark:bg-slate-900">
          <option value="owner">By owner</option><option value="source">By lead source</option>
        </select>
        <select value={days} onChange={e => setDays(Number(e.target.value))} className="rounded border px-2 py-1 dark:border-slate-600 dark:bg-slate-900">
          <option value={90}>Last 90 days</option><option value={180}>Last 180 days</option><option value={365}>Last 12 months</option>
        </select>
      </div>
    }>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="py-1 pr-3 font-medium">{dim === 'owner' ? 'Owner' : 'Source'}</th>
              {['Deals', 'Won', 'Lost', 'Win rate', 'Won value', 'Open', 'Weighted', 'Quotes sent', 'Accepted', 'Days to accept', 'Avg discount'].map(h => <th key={h} className="py-1 pr-3 text-right font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-slate-700">
            {rows.map(r => (
              <tr key={r.key} className="tabular-nums text-slate-700 dark:text-slate-200">
                <td className="py-1.5 pr-3">{dim === 'source' ? (SOURCE_LABEL[r.key as OpportunitySource] ?? r.label) : r.label}</td>
                <td className="pr-3 text-right">{r.deals}</td><td className="pr-3 text-right">{r.won}</td><td className="pr-3 text-right">{r.lost}</td>
                <td className="pr-3 text-right">{pct(r.win_rate)}</td>
                <td className="pr-3 text-right">{formatCurrency(Number(r.won_value))}</td>
                <td className="pr-3 text-right">{formatCurrency(Number(r.open_value))}</td>
                <td className="pr-3 text-right">{formatCurrency(Number(r.weighted_value))}</td>
                <td className="pr-3 text-right">{r.quotes_sent}</td><td className="pr-3 text-right">{r.quotes_accepted}</td>
                <td className="pr-3 text-right">{r.avg_days_to_accept ?? '—'}</td><td className="pr-3 text-right">{pct(r.avg_discount_pct)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={12} className="py-6 text-center text-slate-400">{isLoading ? 'Loading…' : 'No deals in this period.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

// ── Find anything ────────────────────────────────────────────────────────
export function FindAnything({ deals, clients }: { deals: HubDeal[]; clients: ClientRelationshipRow[] }) {
  const [q, setQ] = useState('')
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (t.length < 2) return []
    const has = (...xs: (string | null | undefined)[]) => xs.some(x => x?.toLowerCase().includes(t))
    return [
      ...clients.filter(c => has(c.client_name, c.phone_number, c.email, c.tin)).slice(0, 6)
        .map(c => ({ key: `c${c.client_id}`, to: `/sales-journey/clients/${c.client_id}`, kind: 'Client', label: c.client_name, sub: [c.phone_number, c.open_deals ? `${c.open_deals} open deals` : null].filter(Boolean).join(' · ') })),
      ...deals.filter(d => has(d.title, d.party, d.proforma_number)).slice(0, 6)
        .map(d => ({ key: `d${d.id}`, to: `/opportunities/${d.id}/edit`, kind: STAGE_BY_VALUE[d.stage]?.label ?? 'Deal', label: d.title, sub: [d.party, d.proforma_number].filter(Boolean).join(' · ') })),
    ]
  }, [q, deals, clients])
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a client, deal, phone, TIN or proforma number…"
        className={`${inputCls} pl-9`} />
      {q.trim().length >= 2 && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
          {hits.length ? hits.map(h => (
            <Link key={h.key} to={h.to} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700">
              <span className="w-20 shrink-0 text-[11px] text-slate-400">{h.kind}</span>
              <span className="truncate font-medium text-slate-700 dark:text-slate-100">{h.label}</span>
              <span className="truncate text-xs text-slate-400">{h.sub}</span>
            </Link>
          )) : <p className="px-3 py-2 text-sm text-slate-400">Nothing matches.</p>}
        </div>
      )}
    </div>
  )
}

// ── Record a new client ──────────────────────────────────────────────────
export function NewClientDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast()
  const navigate = useNavigate()
  const refresh = useRefreshHub()
  const [f, setF] = useState({ client_name: '', phone_number: '', email: '', business_type: '', address: '', tin: '' })
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF(s => ({ ...s, [k]: e.target.value }))

  async function save() {
    if (!f.client_name.trim()) { toast('Give the client a name', 'error'); return }
    setBusy(true)
    const { data: dupes } = await supabase.from('clients').select('id, client_name').ilike('client_name', f.client_name.trim()).limit(1)
    if (dupes?.length) { setBusy(false); toast(`${dupes[0].client_name} is already a client`, 'error'); navigate(`/sales-journey/clients/${dupes[0].id}`); return }
    const row = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || null]))
    const { data, error } = await supabase.from('clients').insert([row]).select('id').single()
    setBusy(false)
    if (error || !data) { toast(error?.message ?? 'Could not save', 'error'); return }
    refresh()
    toast('Client added', 'success')
    onClose()
    navigate(`/sales-journey/clients/${data.id}`)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div className={`${card} w-full max-w-md p-4`} onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-100"><UserPlus className="h-4 w-4" /> New client</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-2">
          <input className={inputCls} placeholder="Name *" value={f.client_name} onChange={set('client_name')} autoFocus />
          <div className="grid grid-cols-2 gap-2">
            <input className={inputCls} placeholder="Phone" value={f.phone_number} onChange={set('phone_number')} />
            <input className={inputCls} placeholder="Email" type="email" value={f.email} onChange={set('email')} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input className={inputCls} placeholder="Business type" value={f.business_type} onChange={set('business_type')} />
            <input className={inputCls} placeholder="TIN" value={f.tin} onChange={set('tin')} />
          </div>
          <input className={inputCls} placeholder="Address" value={f.address} onChange={set('address')} />
          <p className="text-[11px] text-slate-400">Add the people you deal with, and file their documents, on the client's page next.</p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border px-3 py-1.5 text-sm dark:border-slate-600">Cancel</button>
          <button type="button" onClick={save} disabled={busy} className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">Add client</button>
        </div>
      </div>
    </div>
  )
}

// ── Log a conversation, from anywhere ────────────────────────────────────
export function QuickLog({ clientId, userId, onClose }: { clientId: string; userId: string | undefined; onClose: () => void }) {
  const refresh = useRefreshHub()
  const { data, isLoading } = useQuery({
    queryKey: ['hub-quicklog', clientId],
    queryFn: async () => {
      const [c, d, p] = await Promise.all([
        supabase.from('client_contacts').select('*').eq('client_id', clientId),
        supabase.from('opportunities').select('id, title').eq('client_id', clientId).in('stage', OPEN_STAGES),
        supabase.from('projects').select('id, project_name').eq('client_id', clientId),
      ])
      return {
        contacts: (c.data ?? []) as ClientContact[],
        deals: (d.data ?? []) as { id: string; title: string }[],
        projects: (p.data ?? []) as { id: string; project_name: string }[],
      }
    },
  })
  if (isLoading || !data) return null
  return (
    <LogInteractionDialog clientId={clientId} contacts={data.contacts} deals={data.deals} projects={data.projects}
      userId={userId} onClose={() => { refresh(); onClose() }} />
  )
}
