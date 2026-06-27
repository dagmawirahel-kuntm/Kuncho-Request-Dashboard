import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { useMemo, useCallback, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Client } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { getClientLogoUrl } from '@/hooks/useClientLogo'
import { formatCurrency } from '@/lib/utils'
import { Plus, Pencil, Trash2, Users, TrendingUp, Building2, Search, ChevronRight, Mail, Phone, Trophy, Award, Medal } from 'lucide-react'

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

// ── Profile completeness ───────────────────────────────────────────────────────
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

// ── Logo avatar ────────────────────────────────────────────────────────────────
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

// ── Summary stat card ──────────────────────────────────────────────────────────
function StatCard({ label, value, icon, sub }: { label: string; value: string; icon: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4 flex items-center gap-4 shadow-sm">
      <div className="flex-shrink-0 rounded-lg bg-slate-100 dark:bg-slate-700 p-2.5 text-slate-500 dark:text-slate-400">{icon}</div>
      <div>
        <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">{label}</p>
        <p className="text-xl font-bold text-slate-800 dark:text-slate-100 mt-0.5">{value}</p>
        {sub && <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// ── Client row (single-column nav-bar style) ───────────────────────────────────
function ClientRow({
  client, salesCount, totalRevenue, tier, onDelete,
}: {
  client: Client; salesCount: number; totalRevenue: number; tier: ClientTier; onDelete: (id: string, name: string) => void
}) {
  const navigate = useNavigate()
  const { score, total } = profileScore(client)
  const pct = score / total

  const goEdit = useCallback((e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); navigate(`/clients/${client.id}/edit`) }, [client.id, navigate])
  const goDelete = useCallback((e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); onDelete(client.id, client.client_name) }, [client.id, client.client_name, onDelete])

  const borderColor = tier ? TIER_STYLES[tier].color : 'transparent'

  return (
    <div
      className="group flex items-center gap-3 px-3 py-2.5 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/40 active:bg-slate-100 dark:active:bg-slate-700/60 transition-colors duration-100 cursor-pointer"
      style={{ borderLeft: `4px solid ${borderColor}` }}
      onClick={() => navigate(`/clients/${client.id}`)}
    >
      {/* Avatar with tier badge */}
      <ClientAvatar client={client} size="sm" tier={tier} />

      {/* Name + meta */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 truncate">{client.client_name}</span>
          {tier && <TierBadge tier={tier} size="sm" />}
        </div>
        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
          {client.business_type && (
            <span className="text-xs text-slate-400 dark:text-slate-500 flex items-center gap-1">
              <Building2 className="h-3 w-3" />{client.business_type}
            </span>
          )}
          {client.email && (
            <span className="text-xs text-slate-400 dark:text-slate-500 flex items-center gap-1 truncate max-w-[200px]">
              <Mail className="h-3 w-3 flex-shrink-0" />{client.email}
            </span>
          )}
          {client.phone_number && (
            <span className="text-xs text-slate-400 dark:text-slate-500 flex items-center gap-1">
              <Phone className="h-3 w-3 flex-shrink-0" />{client.phone_number}
            </span>
          )}
        </div>
      </div>

      {/* Revenue + sales + completeness */}
      <div className="hidden sm:flex items-center gap-5 flex-shrink-0">
        <div className="text-right">
          <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wide">Revenue</p>
          <p className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(totalRevenue)}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wide">Sales</p>
          <p className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">{salesCount}</p>
        </div>
        <div className="w-16">
          <div className="h-1 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(pct * 100).toFixed(0)}%`, backgroundColor: scoreColor(pct) }} />
          </div>
          <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5 text-center">{score}/{total} profile</p>
        </div>
      </div>

      {/* Action buttons — fade in on hover */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        <button onClick={goEdit} title="Edit"
          className="rounded p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button onClick={goDelete} title="Delete"
          className="rounded p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <ChevronRight className="h-4 w-4 text-slate-300 dark:text-slate-600 group-hover:text-slate-400 dark:group-hover:text-slate-400 transition-colors" />
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function ClientsPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
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
      const { data, error } = await supabase.from('sales').select('client_id, amount, sales_status').not('client_id', 'is', null)
      if (error) throw error
      return data as { client_id: string; amount: number | null; sales_status: string | null }[]
    },
  })

  const statsMap = useMemo(() => {
    const m: Record<string, { count: number; revenue: number; paidRevenue: number }> = {}
    for (const s of salesStats) {
      if (!s.client_id) continue
      if (!m[s.client_id]) m[s.client_id] = { count: 0, revenue: 0, paidRevenue: 0 }
      m[s.client_id].count++
      m[s.client_id].revenue += Number(s.amount ?? 0)
      if (s.sales_status === 'Paid') m[s.client_id].paidRevenue += Number(s.amount ?? 0)
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

  const totals = useMemo(() => ({
    revenue: Object.values(statsMap).reduce((s, v) => s + v.revenue, 0),
    sales: Object.values(statsMap).reduce((s, v) => s + v.count, 0),
  }), [statsMap])

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete client "${name}"? This cannot be undone.`)) return
    const { error } = await supabase.from('clients').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['clients'] })
    qc.invalidateQueries({ queryKey: ['clients-lookup'] })
    toast('Client deleted', 'success')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Clients</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Client profiles and revenue history</p>
        </div>
        <Link to="/clients/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90">
          <Plus className="h-4 w-4" /> Add Client
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Total Clients" value={String(clients.length)} icon={<Users className="h-5 w-5" />} />
        <StatCard label="Total Revenue" value={formatCurrency(totals.revenue)} icon={<TrendingUp className="h-5 w-5" />} />
        <StatCard label="Total Sales" value={String(totals.sales)} icon={<Building2 className="h-5 w-5" />} sub="across all clients" />
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
        <input type="text" placeholder="Search clients…" value={search} onChange={e => setSearch(e.target.value)}
          className="w-full rounded-lg border dark:border-slate-600 bg-white dark:bg-slate-800 pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand" />
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed dark:border-slate-700 bg-white dark:bg-slate-800 py-16 text-center">
          <Users className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600 mb-3" />
          <p className="text-sm text-slate-500 dark:text-slate-400">{search ? 'No clients match your search.' : 'No clients yet.'}</p>
          {!search && <Link to="/clients/new" className="mt-3 inline-flex items-center gap-1 text-sm text-brand font-medium hover:underline"><Plus className="h-3.5 w-3.5" /> Add your first client</Link>}
        </div>
      ) : (
        <div className="rounded-xl border dark:border-slate-700 overflow-hidden divide-y divide-slate-100 dark:divide-slate-700/60 shadow-sm">
          {filtered.map(client => (
            <ClientRow key={client.id} client={client} salesCount={statsMap[client.id]?.count ?? 0} totalRevenue={statsMap[client.id]?.revenue ?? 0} tier={tiersMap[client.id] ?? null} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  )
}
