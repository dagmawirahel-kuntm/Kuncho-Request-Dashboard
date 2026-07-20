import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useMemo, useCallback, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Client } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { getClientLogoUrl } from '@/hooks/useClientLogo'
import { formatCurrency } from '@/lib/utils'
import { EntityDirectory, type EntityColumn } from '@/components/shared/EntityDirectory'
import { Plus, Pencil, Trash2, Users, TrendingUp, FileWarning, Search, Trophy, Award, Medal, MoreHorizontal, ShoppingCart, FileText, FilePlus, Tag } from 'lucide-react'

// ── Shared helpers ─────────────────────────────────────────────────────────────
const PALETTE = [
  '#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444',
  '#06B6D4', '#F97316', '#6366F1', '#EC4899', '#14B8A6',
]
// ── Tier system ───────────────────────────────────────────────────────────────
export type ClientTier = 'gold' | 'silver' | 'bronze' | null

/**
 * Assigns tiers relative to the entire client base so thresholds shift
 * automatically as paid amounts change.
 * Score = 75% normalised paid revenue + 25% normalised engagement count.
 * Gold: top 15% (min 1) · Silver: next 25% (min 1) · Bronze: any remaining active client
 */
export function computeClientTiers(
  statsMap: Record<string, { count: number; paidRevenue: number }>,
  clientIds: string[],
): Record<string, ClientTier> {
  const entries = clientIds.map(id => ({
    id,
    paidRevenue: statsMap[id]?.paidRevenue ?? 0,
    count:       statsMap[id]?.count       ?? 0,
  }))

  const result: Record<string, ClientTier> = {}
  const active = entries.filter(e => e.paidRevenue > 0 || e.count > 0)
  entries.filter(e => e.paidRevenue === 0 && e.count === 0).forEach(e => { result[e.id] = null })

  const n = active.length
  if (n === 0) return result

  const maxRevenue = Math.max(...active.map(e => e.paidRevenue), 1)
  const maxCount   = Math.max(...active.map(e => e.count), 1)
  const score = (e: typeof active[0]) =>
    (e.paidRevenue / maxRevenue) * 0.75 + (e.count / maxCount) * 0.25

  const sorted = [...active].sort((a, b) => score(b) - score(a))
  const goldCutoff   = Math.max(1, Math.ceil(n * 0.15))
  const silverCutoff = Math.max(2, Math.ceil(n * 0.40))

  sorted.forEach((e, idx) => {
    const rank = idx + 1
    result[e.id] = rank <= goldCutoff ? 'gold' : rank <= silverCutoff ? 'silver' : 'bronze'
  })
  return result
}

export const TIER_STYLES = {
  gold:   { label: 'Gold',   Icon: Trophy, bg: 'linear-gradient(135deg,#F59E0B,#D97706)', color: '#F59E0B', glow: 'rgba(245,158,11,0.5)',  shadow: 'rgba(245,158,11,0.32)' },
  silver: { label: 'Silver', Icon: Award,  bg: 'linear-gradient(135deg,#94A3B8,#64748B)', color: '#94A3B8', glow: 'rgba(100,116,139,0.4)', shadow: 'rgba(148,163,184,0.26)' },
  bronze: { label: 'Bronze', Icon: Medal,  bg: 'linear-gradient(135deg,#CD7F32,#92400E)', color: '#CD7F32', glow: 'rgba(180,100,40,0.45)', shadow: 'rgba(205,127,50,0.3)'  },
}

/** Text + icon pill — use for prominent display (detail hero, etc.) */
export function TierBadge({ tier, size = 'md' }: { tier: ClientTier; size?: 'sm' | 'md' | 'lg' }) {
  if (!tier) return null
  const { label, Icon, bg, glow } = TIER_STYLES[tier]
  const cls =
    size === 'lg' ? 'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold text-white' :
    size === 'sm' ? 'flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-white' :
                   'flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold text-white'
  const iconCls = size === 'lg' ? 'h-4 w-4' : size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3'
  return (
    <span className={cls} style={{ background: bg, boxShadow: `0 0 10px 2px ${glow}` }}>
      <Icon className={iconCls} />{label}
    </span>
  )
}

/** Floating circular icon badge — sits on the corner of avatars */
export function TierIconBadge({ tier, size = 'md' }: { tier: ClientTier; size?: 'sm' | 'md' | 'lg' }) {
  if (!tier) return null
  const { Icon, bg, glow } = TIER_STYLES[tier]
  const dims  = size === 'lg' ? 'h-8 w-8'    : size === 'sm' ? 'h-4 w-4'     : 'h-6 w-6'
  const border= size === 'lg' ? 'border-[2.5px]' : 'border-2'
  const icon  = size === 'lg' ? 'h-4 w-4'    : size === 'sm' ? 'h-2 w-2'     : 'h-3 w-3'
  return (
    <span className={`${dims} ${border} rounded-full flex items-center justify-center border-white dark:border-slate-800 shadow-md`}
      style={{ background: bg, boxShadow: `0 0 8px 2px ${glow}` }}>
      <Icon className={`${icon} text-white`} />
    </span>
  )
}

export function clientColor(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff
  return PALETTE[Math.abs(h) % PALETTE.length]
}
export function clientInitials(name: string) {
  const w = name.trim().split(/\s+/)
  return w.length >= 2 ? (w[0][0] + w[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase()
}

// ── Profile completeness (still used on the detail page) ───────────────────────
export function profileScore(client: Client): { score: number; total: number; checks: { label: string; done: boolean }[] } {
  const checks = [
    { label: 'Email',          done: !!client.email },
    { label: 'Phone',          done: !!client.phone_number },
    { label: 'Address',        done: !!client.address },
    { label: 'Business type',  done: !!client.business_type },
    { label: 'Notes',          done: !!client.notes },
  ]
  return { score: checks.filter(c => c.done).length, total: checks.length, checks }
}

function scoreColor(pct: number) {
  if (pct >= 0.8) return '#10B981'  // green
  if (pct >= 0.5) return '#F59E0B'  // amber
  return '#EF4444'                   // red
}

// ── Logo avatar (still used on the detail page) ─────────────────────────────────
export function ClientAvatar({ client, size = 'md', tier }: { client: Client; size?: 'sm' | 'md' | 'lg'; tier?: ClientTier }) {
  const color = clientColor(client.client_name)
  const initials = clientInitials(client.client_name)
  const logoUrl = getClientLogoUrl(client.logo_url, client.email)
  const [failed, setFailed] = useState(false)

  const dims = size === 'lg' ? 'h-20 w-20 text-3xl' : size === 'sm' ? 'h-9 w-9 text-xs' : 'h-14 w-14 text-lg'
  const radius = size === 'lg' ? 'rounded-2xl' : 'rounded-xl'
  const badgePos = size === 'lg' ? '-bottom-2 -right-2' : size === 'sm' ? '-bottom-1 -right-1' : '-bottom-1.5 -right-1.5'

  const inner = logoUrl && !failed ? (
    <div className={`${dims} ${radius} bg-white shadow-md overflow-hidden border border-slate-100 dark:border-slate-600 transition-all duration-300 group-hover:shadow-[0_0_20px_6px] group-hover:scale-110 flex items-center justify-center`}
      style={{ '--glow': color + '44' } as React.CSSProperties}
    >
      <img src={logoUrl} alt={client.client_name} className="h-full w-full object-contain p-1.5" onError={() => setFailed(true)} />
    </div>
  ) : (
    <div className={`${dims} ${radius} flex items-center justify-center font-black text-white shadow-md transition-all duration-300 group-hover:scale-110 group-hover:brightness-110`}
      style={{ backgroundColor: color }}>
      {initials}
    </div>
  )

  return (
    <div className="relative flex-shrink-0">
      {inner}
      {tier && (
        <span className={`absolute ${badgePos} z-10`}>
          <TierIconBadge tier={tier} size={size === 'lg' ? 'lg' : size === 'sm' ? 'sm' : 'md'} />
        </span>
      )}
    </div>
  )
}

// ── Row actions: edit / delete / more (new sale, proforma, payment request) ────
function ClientRowActions({
  client, canWrite, onDelete,
}: {
  client: Client
  canWrite: boolean
  onDelete: (id: string, name: string) => void
}) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  return (
    <>
      {canWrite && (
        <>
          <button
            onClick={e => { e.stopPropagation(); navigate(`/clients/${client.id}/edit`) }}
            title="Edit"
            className="rounded p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={e => { e.stopPropagation(); onDelete(client.id, client.client_name) }}
            title="Delete"
            className="rounded p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </>
      )}
      <div className="relative">
        <button
          onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
          title="More actions"
          className="rounded p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={e => { e.stopPropagation(); setOpen(false) }} />
            <div className="absolute right-0 top-8 z-50 w-56 rounded-lg border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-xl py-1" onClick={e => e.stopPropagation()}>
              {canWrite && (
                <button
                  onClick={() => { setOpen(false); navigate(`/sales/new?client_id=${client.id}`) }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  <ShoppingCart className="h-4 w-4 text-slate-400 flex-shrink-0" /> New Sale
                </button>
              )}
              <button
                onClick={() => { setOpen(false); navigate(`/clients/${client.id}/proforma`) }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                <FileText className="h-4 w-4 text-slate-400 flex-shrink-0" /> Proforma Invoice
              </button>
              <div className="h-px bg-slate-100 dark:bg-slate-700 my-1" />
              <button
                onClick={() => { setOpen(false); navigate(`/clients/${client.id}/payment-request?type=new`) }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                <FilePlus className="h-4 w-4 text-slate-400 flex-shrink-0" /> Payment Request (New Contract)
              </button>
              <button
                onClick={() => { setOpen(false); navigate(`/clients/${client.id}/payment-request?type=existing`) }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                <FilePlus className="h-4 w-4 text-slate-400 flex-shrink-0" /> Payment Request (Existing)
              </button>
            </div>
          </>
        )}
      </div>
    </>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function ClientsPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { role } = useAuth()
  const canWrite = role === 'admin' || role === 'finance'
  const [search, setSearch] = useState('')

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ['clients'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('*').order('client_name')
      if (error) throw error
      return data as Client[]
    },
  })

  const { data: salesStats = [] } = useQuery({
    queryKey: ['client-sales-stats'],
    queryFn: async () => {
      const { data, error } = await supabase.from('sales').select('client_id, amount, sales_status, date, created_at').not('client_id', 'is', null)
      if (error) throw error
      return data as { client_id: string; amount: number | null; sales_status: string | null; date: string | null; created_at: string }[]
    },
  })

  const statsMap = useMemo(() => {
    const m: Record<string, { count: number; revenue: number; paidRevenue: number; outstanding: number; outstandingAmount: number }> = {}
    for (const s of salesStats) {
      if (!s.client_id) continue
      if (!m[s.client_id]) m[s.client_id] = { count: 0, revenue: 0, paidRevenue: 0, outstanding: 0, outstandingAmount: 0 }
      m[s.client_id].count++
      m[s.client_id].revenue += Number(s.amount ?? 0)
      if (s.sales_status === 'Paid') m[s.client_id].paidRevenue += Number(s.amount ?? 0)
      if (s.sales_status === 'Draft' || s.sales_status === 'Invoiced') {
        m[s.client_id].outstanding++
        m[s.client_id].outstandingAmount += Number(s.amount ?? 0)
      }
    }
    return m
  }, [salesStats])

  const tiersMap = useMemo(
    () => computeClientTiers(statsMap, clients.map(c => c.id)),
    [statsMap, clients],
  )

  const filtered = useMemo(() => {
    if (!search.trim()) return clients
    const q = search.toLowerCase()
    return clients.filter(c => c.client_name.toLowerCase().includes(q) || (c.business_type ?? '').toLowerCase().includes(q) || (c.email ?? '').toLowerCase().includes(q))
  }, [clients, search])

  const stats = useMemo(() => {
    const values = Object.values(statsMap)
    const activeCount = clients.filter(c => (statsMap[c.id]?.count ?? 0) > 0 || (statsMap[c.id]?.paidRevenue ?? 0) > 0).length
    const openInvoices = values.reduce((s, v) => s + v.outstanding, 0)
    const outstandingAmount = values.reduce((s, v) => s + v.outstandingAmount, 0)
    return { activeCount, openInvoices, outstandingAmount, count: clients.length }
  }, [clients, statsMap])

  const handleDelete = useCallback(async (id: string, name: string) => {
    if (!window.confirm(`Delete client "${name}"? This cannot be undone.`)) return
    const { error } = await supabase.from('clients').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['clients'] })
    qc.invalidateQueries({ queryKey: ['clients-lookup'] })
    toast('Client deleted', 'success')
  }, [qc, toast])

  const columns: EntityColumn<Client>[] = [
    {
      key: 'segment',
      label: 'Segment',
      render: c => c.business_type
        ? <span className="rounded-md bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-300">{c.business_type}</span>
        : null,
    },
    { key: 'sales', label: 'Sales', render: c => <span className="text-slate-500 dark:text-slate-400">{statsMap[c.id]?.count ?? 0}</span> },
    {
      key: 'outstanding',
      label: 'Outstanding',
      align: 'right',
      render: c => (statsMap[c.id]?.outstanding ?? 0) > 0
        ? <span className="font-semibold text-amber-600 dark:text-amber-400">{formatCurrency(statsMap[c.id]?.outstandingAmount ?? 0)}</span>
        : <span className="text-slate-300 dark:text-slate-600">—</span>,
    },
    {
      key: 'revenue',
      label: 'Revenue',
      align: 'right',
      render: c => <span className="font-bold text-slate-800 dark:text-slate-100">{formatCurrency(statsMap[c.id]?.revenue ?? 0)}</span>,
    },
  ]

  return (
    <EntityDirectory
      storageKey="clients"
      title="Clients"
      subtitle="Client profiles and revenue history"
      records={filtered}
      isLoading={isLoading}
      getId={c => c.id}
      getName={c => c.client_name}
      getSubline={c => c.phone_number ?? c.email ?? null}
      getBrand={c => ({ bg: clientColor(c.client_name), fg: '#fff', logo: getClientLogoUrl(c.logo_url, c.email), initials: clientInitials(c.client_name) })}
      columns={columns}
      summaryStats={[
        { label: 'Active Clients', value: `${stats.activeCount} of ${stats.count}`, icon: <Users className="h-5 w-5" /> },
        { label: 'Open Invoices', value: String(stats.openInvoices), icon: <FileWarning className="h-5 w-5" />, valueClassName: stats.openInvoices > 0 ? 'text-amber-600 dark:text-amber-400' : undefined },
        { label: 'Outstanding Balance', value: formatCurrency(stats.outstandingAmount), icon: <TrendingUp className="h-5 w-5" />, valueClassName: stats.outstandingAmount > 0 ? 'text-amber-600 dark:text-amber-400' : undefined },
      ]}
      onAdd={canWrite ? () => navigate('/clients/new') : undefined}
      addLabel="Add Client"
      renderCardBody={c => {
        const s = statsMap[c.id]
        const revenue = s?.revenue ?? 0
        const outstandingAmount = s?.outstandingAmount ?? 0
        const share = revenue > 0 ? Math.min(1, outstandingAmount / revenue) : 0
        const { score, total } = profileScore(c)
        const profilePct = score / total
        return (
          <>
            <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Lifetime Sales</p>
            <p className="text-2xl font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(revenue)}</p>
            <div className="mt-2 flex items-center justify-between text-xs text-slate-400 dark:text-slate-500">
              <span>{s?.count ?? 0} sale{(s?.count ?? 0) !== 1 ? 's' : ''}</span>
              <span>{s?.outstanding ?? 0} open invoice{(s?.outstanding ?? 0) !== 1 ? 's' : ''}</span>
            </div>
            {outstandingAmount > 0 && (
              <div className="mt-3">
                <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                  <div className="h-full rounded-full bg-amber-500 transition-all duration-700" style={{ width: `${(share * 100).toFixed(1)}%` }} />
                </div>
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{formatCurrency(outstandingAmount)} outstanding</p>
              </div>
            )}
            <div className="mt-3 flex items-center gap-2">
              <div className="h-1 flex-1 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(profilePct * 100).toFixed(0)}%`, backgroundColor: scoreColor(profilePct) }} />
              </div>
              <span className="text-[10px] text-slate-400 dark:text-slate-500 flex-shrink-0">{score}/{total} profile</span>
            </div>
          </>
        )
      }}
      renderFooterChips={c => (
        <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-300">
          <Tag className="h-3 w-3" />{c.business_type ?? 'Unclassified'}
        </span>
      )}
      renderCornerBadge={c => tiersMap[c.id] ? <TierIconBadge tier={tiersMap[c.id]} size="sm" /> : null}
      renderRowActions={c => <ClientRowActions client={c} canWrite={canWrite} onDelete={handleDelete} />}
      getHref={c => `/clients/${c.id}`}
      ctaLabel="View client"
      emptyIcon={<Users className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600" />}
      emptyMessage={search ? 'No clients match your search.' : 'No clients yet.'}
      emptyCta={!search && canWrite ? (
        <button onClick={() => navigate('/clients/new')} className="mt-3 inline-flex items-center gap-1 text-sm text-brand font-medium hover:underline">
          <Plus className="h-3.5 w-3.5" /> Add your first client
        </button>
      ) : undefined}
      toolbar={
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search clients…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-lg border dark:border-slate-600 bg-white dark:bg-slate-800 pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
      }
    />
  )
}
