import { useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatCurrencyCompact, formatDate } from '@/lib/utils'
import { toEthiopian } from '@/lib/ethiopianCalendar'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { getClientLogoUrl } from '@/hooks/useClientLogo'
import { clientColor, clientInitials } from '@/pages/clients/ClientsPage'
import { CONTACT_ROLES, CONTACT_ROLE_LABEL, INTERACTION_BY_VALUE, daysSince, warmth, whatsappLink, type Strand } from '@/lib/clientHistory'
import { OPEN_STAGES, STAGE_BY_VALUE } from '@/lib/salesJourney'
import type {
  ClientContact, ClientInteraction, ClientRelationshipRow, ClientTimelineEvent, SalesEngagementRow,
} from '@/types/database'
import {
  AlertTriangle, ArrowLeft, Banknote, Building2, CalendarClock, Check, FileText, FileWarning, Flag, HardHat,
  Mail, MessageCircle, MessagesSquare, Pencil, Phone, Plus, Star, Target, UserPlus, Users,
} from 'lucide-react'
import { RelationshipTimeline } from './RelationshipTimeline'
import { ContactDialog, LogInteractionDialog } from './ClientHistoryDialogs'
import { useRefreshClientHistory } from './useRefreshClientHistory'

type Focus = 'projects' | 'contacts' | 'deals' | 'money' | 'docs'
const FOCUS_STRAND: Record<Focus, Strand> = { projects: 'projects', contacts: 'talks', deals: 'deals', money: 'money', docs: 'docs' }
const ALL_STRANDS: Strand[] = ['deals', 'money', 'projects', 'talks', 'docs']

interface ProjectCard {
  id: string
  project_name: string
  active_for_year: boolean
  is_internal: boolean | null
  physical_progress: number | null
  health: string | null
  contract_value: number | null
  start_date: string | null
  target_handover_date: string | null
  project_manager_id: string | null
}

/**
 * One client, the whole relationship (migration 334): how many projects are
 * open, who we deal with there and how recently we spoke, every deal,
 * invoice, payment, conversation and document on one zoomable timeline, and
 * the money on each contract. The number tiles along the top filter the
 * timeline and take you to their panel.
 */
export default function ClientHistoryPage() {
  const { id = '' } = useParams<{ id: string }>()
  const { user, role } = useAuth()
  const [strands, setStrands] = useState<Set<Strand>>(new Set(ALL_STRANDS))
  const [focus, setFocus] = useState<Focus | null>(null)
  const [logFor, setLogFor] = useState<{ contactId: string | null } | null>(null)
  const [editContact, setEditContact] = useState<ClientContact | 'new' | null>(null)
  const projectsRef = useRef<HTMLDivElement>(null)
  const contactsRef = useRef<HTMLDivElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const moneyRef = useRef<HTMLDivElement>(null)
  const canWrite = role === 'admin' || role === 'executive' || role === 'finance' || (role as string) === 'sales'

  const { data: rel, isLoading } = useQuery({
    queryKey: ['client-relationship', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_client_relationships').select('*').eq('client_id', id).maybeSingle()
      if (error) throw error
      return data as ClientRelationshipRow | null
    },
  })
  const { data: events = [] } = useQuery({
    queryKey: ['client-timeline', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_client_timeline').select('*').eq('client_id', id).order('event_at', { ascending: false })
      if (error) throw error
      return data as ClientTimelineEvent[]
    },
  })
  const { data: contacts = [] } = useQuery({
    queryKey: ['client-contacts', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('client_contacts').select('*').eq('client_id', id)
        .order('is_primary', { ascending: false }).order('full_name')
      if (error) throw error
      return data as ClientContact[]
    },
  })
  const { data: interactions = [] } = useQuery({
    queryKey: ['client-interactions', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('client_interactions').select('*').eq('client_id', id).order('occurred_at', { ascending: false })
      if (error) throw error
      return data as ClientInteraction[]
    },
  })
  const { data: projects = [] } = useQuery({
    queryKey: ['client-projects', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects')
        .select('id, project_name, active_for_year, is_internal, physical_progress, health, contract_value, start_date, target_handover_date, project_manager_id')
        .eq('client_id', id).order('start_date', { ascending: false, nullsFirst: false })
      if (error) throw error
      return (data ?? []) as ProjectCard[]
    },
  })
  const { data: deals = [] } = useQuery({
    queryKey: ['client-deals', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_sales_engagements').select('*').eq('client_id', id).order('created_at', { ascending: false })
      if (error) throw error
      return data as SalesEngagementRow[]
    },
  })
  const { data: settings } = useQuery({
    queryKey: ['sales-settings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('sales_settings').select('key, value')
      if (error) throw error
      return Object.fromEntries((data ?? []).map(r => [r.key, Number(r.value)])) as Record<string, number>
    },
  })
  const pmIds = [...new Set(projects.map(p => p.project_manager_id).filter(Boolean))] as string[]
  const { data: pms = [] } = useQuery({
    queryKey: ['client-pms', pmIds.join(',')],
    enabled: pmIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_staff_directory').select('id, employee_name').in('id', pmIds)
      if (error) throw error
      return data as { id: string; employee_name: string }[]
    },
  })
  const projectIds = projects.map(p => p.id)
  const { data: projectMoney = [] } = useQuery({
    queryKey: ['client-project-money', id, projectIds.join(',')],
    enabled: projectIds.length > 0,
    queryFn: async () => {
      const [{ data: s }, { data: m }] = await Promise.all([
        supabase.from('sales').select('project_id, amount, sales_status').eq('client_id', id).eq('is_archived', false),
        supabase.from('payment_milestones').select('project_id, title, status, net_payable_etb, sequence_number').in('project_id', projectIds).order('sequence_number'),
      ])
      return projectIds.map(pid => ({
        id: pid,
        received: (s ?? []).filter(r => r.project_id === pid && r.sales_status === 'Paid').reduce((a, r) => a + Number(r.amount), 0),
        next: (m ?? []).find(r => r.project_id === pid && r.status !== 'payment_confirmed') as { title: string; status: string; net_payable_etb: number } | undefined,
      }))
    },
  })

  const warmDays = settings?.contact_warm_days ?? 30
  const activeDays = settings?.contact_active_days ?? rel?.active_window_days ?? 90
  const lastTalk = useMemo(() => {
    const m = new Map<string, string>()
    for (const i of interactions) if (i.contact_id && !m.has(i.contact_id)) m.set(i.contact_id, i.occurred_at)
    return m
  }, [interactions])
  const openSteps = interactions.filter(i => i.next_step && !i.next_step_done_at)
    .sort((a, b) => (a.next_step_due ?? '9999').localeCompare(b.next_step_due ?? '9999'))

  function jump(f: Focus) {
    const same = focus === f
    setFocus(same ? null : f)
    setStrands(same ? new Set(ALL_STRANDS) : new Set([FOCUS_STRAND[f]]))
    const target = f === 'projects' ? projectsRef : f === 'contacts' ? contactsRef : f === 'money' ? moneyRef : timelineRef
    if (!same) target.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (isLoading) return <p className="py-12 text-center text-sm text-slate-400">Loading…</p>
  if (!rel) {
    return (
      <div className="space-y-3 py-12 text-center">
        <p className="text-sm text-slate-500">This client isn't here, or you can't see it.</p>
        <Link to="/sales-journey" className="text-sm text-brand hover:underline">← Sales Journey</Link>
      </div>
    )
  }

  const color = clientColor(rel.client_name)
  const logo = getClientLogoUrl(rel.logo_url, rel.email)
  const sinceYear = toEthiopian(rel.first_seen ?? rel.client_since).year
  const lastDays = daysSince(rel.last_interaction_at)
  const openDeals = deals.filter(d => d.opportunity_id && OPEN_STAGES.includes(d.stage))
  const ringFor = (f: Focus) => (focus === f ? 'ring-2 ring-brand ring-offset-2 dark:ring-offset-slate-900' : '')

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to="/sales-journey" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-200">
          <ArrowLeft className="h-4 w-4" /> Sales Journey
        </Link>
        <div className="flex flex-wrap gap-2">
          {canWrite && (
            <>
              <button type="button" onClick={() => setLogFor({ contactId: null })} className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90">
                <MessagesSquare className="h-3.5 w-3.5" /> Log a conversation
              </button>
              <button type="button" onClick={() => setEditContact('new')} className="flex items-center gap-1.5 rounded-md border bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
                <UserPlus className="h-3.5 w-3.5" /> Add contact
              </button>
            </>
          )}
          <Link to={`/opportunities/new?client_id=${id}`} className="flex items-center gap-1.5 rounded-md border bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
            <Flag className="h-3.5 w-3.5" /> New deal
          </Link>
          <Link to={`/clients/${id}/proforma`} className="flex items-center gap-1.5 rounded-md border bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
            <FileText className="h-3.5 w-3.5" /> Proforma
          </Link>
          <Link to={`/clients/${id}`} className="flex items-center gap-1.5 rounded-md border bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
            <Building2 className="h-3.5 w-3.5" /> Client file
          </Link>
        </div>
      </div>

      {/* Hero */}
      <div className="overflow-hidden rounded-2xl" style={{ background: `linear-gradient(135deg, ${color} 0%, ${color}cc 100%)` }}>
        <div className="relative overflow-hidden px-6 py-6">
          <span className="pointer-events-none absolute -bottom-6 -right-2 select-none font-black leading-none text-white opacity-10" style={{ fontSize: '9rem' }} aria-hidden>
            {clientInitials(rel.client_name)}
          </span>
          <div className="relative z-10 flex flex-wrap items-center gap-5">
            <div className="flex h-12 w-12 shrink-0 items-center sm:h-16 sm:w-16 justify-center overflow-hidden rounded-2xl bg-white/15 text-xl font-black text-white ring-2 ring-white/30">
              {logo ? <img src={logo} alt="" className="h-full w-full bg-white object-contain p-1.5" onError={e => { e.currentTarget.style.display = 'none' }} /> : clientInitials(rel.client_name)}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-black leading-tight text-white sm:text-2xl">{rel.client_name}</h1>
              <p className="mt-1 text-sm text-white/80">
                {rel.business_type ? `${rel.business_type} · ` : ''}Client since {sinceYear} E.C.{rel.tin ? ` · TIN ${rel.tin}` : ''}
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-black/20 px-2.5 py-1 text-white">
                  {lastDays == null ? 'No conversation logged yet' : `Last spoke ${lastDays === 0 ? 'today' : lastDays === 1 ? 'yesterday' : `${lastDays} days ago`}`}
                </span>
                {rel.next_step && (
                  <span className={`rounded-full px-2.5 py-1 ${rel.next_step_due && rel.next_step_due < new Date().toISOString().slice(0, 10) ? 'bg-red-500 text-white' : 'bg-white text-slate-800'}`}>
                    Next: {rel.next_step}{rel.next_step_due ? ` · ${formatDate(rel.next_step_due)}` : ''}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 divide-x divide-white/10 text-center" style={{ background: 'rgba(0,0,0,0.22)' }}>
          {[
            { label: 'Contracted', value: formatCurrencyCompact(Number(rel.contracted_value)), full: formatCurrency(Number(rel.contracted_value)) },
            { label: 'Received', value: formatCurrencyCompact(Number(rel.received)), full: formatCurrency(Number(rel.received)) },
            { label: 'Last payment', value: rel.last_payment_at ? formatDate(rel.last_payment_at) : '—', full: undefined },
          ].map(x => (
            <div key={x.label} className="px-2 py-2.5">
              <p className="text-[10px] uppercase tracking-wide text-white/60">{x.label}</p>
              <p className="truncate text-sm font-bold tabular-nums text-white" title={x.full ?? x.value}>{x.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Number tiles — each filters the timeline and jumps to its panel */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {([
          { f: 'projects', icon: HardHat, label: 'Open projects', value: `${rel.projects_open}`, sub: `of ${rel.projects_total} · ${formatCurrencyCompact(Number(rel.open_contract_value))}`, tone: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20' },
          { f: 'contacts', icon: Users, label: 'Active contacts', value: `${rel.contacts_active}`, sub: `of ${rel.contacts_total} · spoken to in ${activeDays} days`, tone: 'text-sky-600 bg-sky-50 dark:bg-sky-900/20' },
          { f: 'deals', icon: Target, label: 'Open deals', value: `${rel.open_deals}`, sub: `${formatCurrencyCompact(Number(rel.pipeline_value))} in the pipeline`, tone: 'text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20' },
          { f: 'money', icon: Banknote, label: 'They owe', value: formatCurrencyCompact(Number(rel.outstanding)), full: formatCurrency(Number(rel.outstanding)), sub: `of ${formatCurrencyCompact(Number(rel.invoiced))} invoiced`, tone: Number(rel.outstanding) > 0 ? 'text-red-600 bg-red-50 dark:bg-red-900/20' : 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20' },
          { f: 'docs', icon: FileWarning, label: 'Missing documents', value: `${rel.docs_missing}`, sub: 'across their deals', tone: rel.docs_missing > 0 ? 'text-red-600 bg-red-50 dark:bg-red-900/20' : 'text-slate-500 bg-slate-50 dark:bg-slate-700' },
        ] as { f: Focus; icon: typeof HardHat; label: string; value: string; full?: string; sub: string; tone: string }[]).map(t => (
          <button key={t.f} type="button" onClick={() => jump(t.f)} aria-pressed={focus === t.f}
            className={`group rounded-xl border bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg dark:border-slate-700 dark:bg-slate-800 ${ringFor(t.f)} ${t.f === 'docs' ? 'col-span-2 md:col-span-1' : ''}`}>
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs text-slate-500 dark:text-slate-400">{t.label}</p>
              <span className={`rounded-lg p-1.5 ${t.tone}`}><t.icon className="h-4 w-4" /></span>
            </div>
            <p className="mt-1 truncate text-xl font-bold tabular-nums text-slate-800 dark:text-slate-100" title={t.full ?? t.value}>{t.value}</p>
            <p className="truncate text-[11px] text-slate-400" title={t.sub}>{t.sub}</p>
            <p className="mt-1 text-[10px] font-medium text-brand opacity-0 transition-opacity group-hover:opacity-100">{focus === t.f ? 'Show everything' : 'Show on the timeline'}</p>
          </button>
        ))}
      </div>

      {openSteps.length > 0 && <NextSteps clientId={id} steps={openSteps} contacts={contacts} />}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <div ref={timelineRef} className={`scroll-mt-4 rounded-xl ${focus === 'deals' || focus === 'docs' ? 'ring-2 ring-brand ring-offset-2 dark:ring-offset-slate-900' : ''}`}>
            <RelationshipTimeline clientId={id} events={events} contacts={contacts} interactions={interactions}
              strands={strands} onStrandsChange={s => { setStrands(s); setFocus(null) }} />
          </div>

          {/* Projects board */}
          <div ref={projectsRef} className={`scroll-mt-4 rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800 ${ringFor('projects')}`}>
            <div className="flex items-center justify-between border-b px-4 py-3 dark:border-slate-700">
              <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Projects</h2>
              <span className="text-xs text-slate-400">{rel.projects_open} open · {rel.projects_total} in all</span>
            </div>
            {projects.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">No projects linked to this client yet.</p>
            ) : (
              <div className="grid gap-4 p-4 md:grid-cols-2">
                {(['open', 'closed'] as const).map(col => {
                  const list = projects.filter(p => (col === 'open') === (p.active_for_year && !p.is_internal))
                  return (
                    <div key={col}>
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{col === 'open' ? `Open (${list.length})` : `Closed or on hold (${list.length})`}</p>
                      <div className="space-y-2">
                        {list.map(p => {
                          const money = projectMoney.find(m => m.id === p.id)
                          const value = Number(p.contract_value ?? 0)
                          const paidPct = value > 0 ? Math.min(100, ((money?.received ?? 0) / value) * 100) : 0
                          const prog = Math.max(0, Math.min(100, Number(p.physical_progress ?? 0)))
                          const pm = pms.find(x => x.id === p.project_manager_id)?.employee_name
                          const late = p.target_handover_date && p.target_handover_date < new Date().toISOString().slice(0, 10) && p.active_for_year
                          return (
                            <Link key={p.id} to={`/projects/${p.id}`}
                              className="group relative flex gap-3 rounded-lg border p-3 transition-all hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md dark:border-slate-700">
                              <ProgressRing pct={prog} tone={p.health === 'On Track' ? 'stroke-emerald-500' : p.health ? 'stroke-amber-500' : 'stroke-slate-400'} />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-slate-800 group-hover:text-brand dark:text-slate-100">{p.project_name}</p>
                                <p className="truncate text-[11px] text-slate-400">
                                  {pm ? `PM ${pm}` : 'No PM'}{p.target_handover_date ? ` · handover ${formatDate(p.target_handover_date)}` : ''}
                                </p>
                                {value > 0 && (
                                  <div className="mt-1.5" title={`Received ${formatCurrency(money?.received ?? 0)} of ${formatCurrency(value)}`}>
                                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                                      <div className="h-full bg-emerald-500" style={{ width: `${paidPct}%` }} />
                                    </div>
                                    <p className="mt-0.5 text-[10px] tabular-nums text-slate-400">{Math.round(paidPct)}% paid of {formatCurrency(value)}</p>
                                  </div>
                                )}
                                {/* More on hover */}
                                <div className="mt-1 hidden text-[11px] text-slate-500 group-hover:block dark:text-slate-400">
                                  {money?.next ? `Next payment: ${money.next.title} · ${formatCurrency(Number(money.next.net_payable_etb))}` : 'No payment plan'}
                                  {p.health ? ` · ${p.health}` : ''}
                                </div>
                              </div>
                              {late && <span className="absolute right-2 top-2 rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-red-700 dark:bg-red-900/30 dark:text-red-300">Late</span>}
                            </Link>
                          )
                        })}
                        {list.length === 0 && <p className="text-xs text-slate-400">None.</p>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-5">
          {/* People */}
          <div ref={contactsRef} className={`scroll-mt-4 rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800 ${ringFor('contacts')}`}>
            <div className="flex items-center justify-between border-b px-4 py-3 dark:border-slate-700">
              <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">People</h2>
              {canWrite && <button type="button" onClick={() => setEditContact('new')} className="flex items-center gap-1 text-xs font-medium text-brand hover:underline"><Plus className="h-3 w-3" /> Add</button>}
            </div>
            {contacts.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-sm text-slate-500 dark:text-slate-400">Nobody recorded at this client yet.</p>
                <p className="mt-1 text-xs text-slate-400">Add who we deal with, and each call or meeting, to see who is active.</p>
              </div>
            ) : (
              <div className="divide-y dark:divide-slate-700">
                {CONTACT_ROLES.map(r => {
                  const people = contacts.filter(c => c.role === r.value)
                  if (people.length === 0) return null
                  return (
                    <div key={r.value} className="px-4 py-3">
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{r.label}</p>
                      <div className="space-y-2">
                        {people.map(c => {
                          const w = warmth(lastTalk.get(c.id) ?? null, warmDays, activeDays)
                          return (
                            <div key={c.id} className={`rounded-lg border p-2.5 dark:border-slate-700 ${c.is_active ? '' : 'opacity-50'}`}>
                              <div className="flex items-start gap-2.5">
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: clientColor(c.full_name) }}>
                                  {clientInitials(c.full_name)}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className="flex items-center gap-1 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                                    {c.full_name}
                                    {c.is_primary && <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" aria-label="Main contact" />}
                                  </p>
                                  <p className="truncate text-[11px] text-slate-400">{c.job_title ?? CONTACT_ROLE_LABEL[c.role]}{!c.is_active ? ' · no longer there' : ''}</p>
                                </div>
                                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${w.cls}`} title="Last conversation">{w.label}</span>
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-1">
                                {c.phone && <a href={`tel:${c.phone}`} className="flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300"><Phone className="h-3 w-3" /> Call</a>}
                                {c.phone && <a href={whatsappLink(c.phone)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 rounded-md bg-green-50 px-2 py-1 text-[11px] text-green-700 hover:bg-green-100 dark:bg-green-900/20 dark:text-green-300"><MessageCircle className="h-3 w-3" /> WhatsApp</a>}
                                {c.email && <a href={`mailto:${c.email}`} className="flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300"><Mail className="h-3 w-3" /> Email</a>}
                                {canWrite && (
                                  <span className="ml-auto flex gap-1">
                                    <button type="button" onClick={() => setLogFor({ contactId: c.id })} className="flex items-center gap-1 rounded-md bg-brand/10 px-2 py-1 text-[11px] font-medium text-brand hover:bg-brand/20"><MessagesSquare className="h-3 w-3" /> Log</button>
                                    <button type="button" onClick={() => setEditContact(c)} aria-label={`Edit ${c.full_name}`} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><Pencil className="h-3 w-3" /></button>
                                  </span>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {rel.phone_number || rel.email ? (
              <p className="border-t px-4 py-2 text-[11px] text-slate-400 dark:border-slate-700">
                Main line: {[rel.phone_number, rel.email].filter(Boolean).join(' · ')}
              </p>
            ) : null}
          </div>

          {/* Money */}
          <div ref={moneyRef} className={`scroll-mt-4 rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800 ${ringFor('money')}`}>
            <div className="border-b px-4 py-3 dark:border-slate-700">
              <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Money by contract</h2>
            </div>
            <div className="space-y-3 p-4">
              {deals.filter(d => d.contract_id).length === 0 && <p className="text-xs text-slate-400">No contracts yet.</p>}
              {deals.filter(d => d.contract_id).map(d => {
                const v = Number(d.contract_value ?? 0)
                const inv = v > 0 ? Math.min(100, (Number(d.invoiced) / v) * 100) : 0
                const paid = v > 0 ? Math.min(100, (Number(d.received) / v) * 100) : 0
                return (
                  <Link key={d.engagement_id} to={`/contracts/${d.contract_id}/edit`} className="block rounded-lg p-1 -m-1 hover:bg-slate-50 dark:hover:bg-slate-700/30">
                    <div className="flex items-center justify-between text-xs">
                      <span className="truncate font-medium text-slate-700 dark:text-slate-200">{d.contract_no ?? d.title}</span>
                      <span className="shrink-0 tabular-nums text-slate-500">{formatCurrency(v)}</span>
                    </div>
                    <div className="relative mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700" title={`Invoiced ${formatCurrency(Number(d.invoiced))} · received ${formatCurrency(Number(d.received))}`}>
                      <span className="absolute inset-y-0 left-0 bg-indigo-200 dark:bg-indigo-800" style={{ width: `${inv}%` }} />
                      <span className="absolute inset-y-0 left-0 bg-emerald-500" style={{ width: `${paid}%` }} />
                    </div>
                    <p className="mt-0.5 flex justify-between text-[10px] tabular-nums text-slate-400">
                      <span>received {formatCurrency(Number(d.received))}</span>
                      {Number(d.outstanding) > 0 && <span className="font-semibold text-red-600 dark:text-red-400">owes {formatCurrency(Number(d.outstanding))}</span>}
                    </p>
                  </Link>
                )
              })}
              {openDeals.length > 0 && (
                <div className="border-t pt-3 dark:border-slate-700">
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">In the pipeline</p>
                  {openDeals.map(d => (
                    <Link key={d.engagement_id} to={`/opportunities/${d.opportunity_id}/edit`} className="flex items-center justify-between gap-2 py-1 text-xs hover:text-brand">
                      <span className="truncate text-slate-700 dark:text-slate-200">{d.title}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${STAGE_BY_VALUE[d.stage]?.cls ?? ''}`}>{STAGE_BY_VALUE[d.stage]?.label}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {logFor && (
        <LogInteractionDialog clientId={id} contacts={contacts} userId={user?.id} defaultContactId={logFor.contactId}
          deals={deals.filter(d => d.opportunity_id).map(d => ({ id: d.opportunity_id!, title: d.title }))}
          projects={projects.map(p => ({ id: p.id, project_name: p.project_name }))}
          onClose={() => setLogFor(null)} />
      )}
      {editContact && <ContactDialog clientId={id} contact={editContact === 'new' ? null : editContact} onClose={() => setEditContact(null)} />}
    </div>
  )
}

function ProgressRing({ pct, tone }: { pct: number; tone: string }) {
  const r = 16
  const c = 2 * Math.PI * r
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" className="shrink-0" role="img" aria-label={`${Math.round(pct)}% built`}>
      <circle cx="20" cy="20" r={r} fill="none" strokeWidth="4" className="stroke-slate-100 dark:stroke-slate-700" />
      <circle cx="20" cy="20" r={r} fill="none" strokeWidth="4" strokeLinecap="round" className={tone}
        strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} transform="rotate(-90 20 20)" />
      <text x="20" y="23.5" textAnchor="middle" className="fill-slate-600 text-[10px] font-bold dark:fill-slate-300">{Math.round(pct)}</text>
    </svg>
  )
}

/** Next steps still open with this client, soonest first, each one tickable. */
function NextSteps({ clientId, steps, contacts }: { clientId: string; steps: ClientInteraction[]; contacts: ClientContact[] }) {
  const { toast } = useToast()
  const refresh = useRefreshClientHistory(clientId)
  const today = new Date().toISOString().slice(0, 10)
  async function done(i: ClientInteraction) {
    const { error } = await supabase.from('client_interactions').update({ next_step_done_at: new Date().toISOString() }).eq('id', i.id)
    if (error) { toast(error.message, 'error'); return }
    refresh()
    toast('Done', 'success')
  }
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 dark:border-amber-800/40 dark:bg-amber-900/10">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-amber-800 dark:text-amber-300"><CalendarClock className="h-3.5 w-3.5" /> Next steps ({steps.length})</p>
      <ul className="space-y-1.5">
        {steps.map(s => {
          const overdue = s.next_step_due && s.next_step_due < today
          const who = s.contact_id ? contacts.find(c => c.id === s.contact_id)?.full_name : null
          const K = INTERACTION_BY_VALUE[s.kind]
          return (
            <li key={s.id} className="flex items-center gap-2 text-xs">
              <button type="button" onClick={() => done(s)} aria-label={`Mark "${s.next_step}" done`}
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-amber-400 bg-white text-transparent hover:text-amber-600 dark:bg-slate-800">
                <Check className="h-3 w-3" />
              </button>
              <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">
                {s.next_step}
                <span className="text-slate-400"> · after a {K?.label.toLowerCase() ?? 'conversation'}{who ? ` with ${who}` : ''}</span>
              </span>
              {s.next_step_due && (
                <span className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${overdue ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                  {overdue && <AlertTriangle className="h-3 w-3" />}{formatDate(s.next_step_due)}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
