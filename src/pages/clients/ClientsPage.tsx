import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { useMemo, useCallback, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Client } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency } from '@/lib/utils'
import { Plus, Pencil, Trash2, Users, TrendingUp, Building2, Search, ChevronRight, Mail, Phone } from 'lucide-react'

const PALETTE = [
  '#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444',
  '#06B6D4', '#F97316', '#6366F1', '#EC4899', '#14B8A6',
]

function clientColor(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff
  return PALETTE[Math.abs(h) % PALETTE.length]
}

function getInitials(name: string) {
  const words = name.trim().split(/\s+/)
  return words.length >= 2 ? (words[0][0] + words[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase()
}

function emailDomain(email: string | null): string | null {
  if (!email) return null
  const parts = email.split('@')
  return parts.length === 2 ? parts[1].toLowerCase() : null
}

function ClientAvatar({
  client,
  size = 'md',
}: {
  client: Client
  size?: 'sm' | 'md' | 'lg'
}) {
  const color = clientColor(client.client_name)
  const initials = getInitials(client.client_name)
  const domain = emailDomain(client.email)
  const [logoFailed, setLogoFailed] = useState(false)

  const dims = size === 'lg' ? 'h-20 w-20 text-3xl' : size === 'sm' ? 'h-9 w-9 text-xs' : 'h-14 w-14 text-lg'
  const radius = size === 'lg' ? 'rounded-2xl' : 'rounded-xl'

  if (domain && !logoFailed) {
    return (
      <div
        className={`${dims} ${radius} bg-white flex items-center justify-center flex-shrink-0 shadow-md overflow-hidden border border-slate-100 transition-all duration-300 group-hover:shadow-[0_0_20px_6px] group-hover:scale-110`}
        style={{ '--glow': color + '44' } as React.CSSProperties}
      >
        <img
          src={`https://logo.clearbit.com/${domain}`}
          alt={client.client_name}
          className="h-full w-full object-contain p-1.5"
          onError={() => setLogoFailed(true)}
        />
      </div>
    )
  }

  return (
    <div
      className={`${dims} ${radius} flex items-center justify-center font-black flex-shrink-0 shadow-md transition-all duration-300 group-hover:scale-110 group-hover:brightness-110 group-hover:shadow-lg`}
      style={{ backgroundColor: color, color: '#fff' }}
    >
      {initials}
    </div>
  )
}

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

function ClientCard({
  client,
  salesCount,
  totalRevenue,
  onDelete,
}: {
  client: Client
  salesCount: number
  totalRevenue: number
  onDelete: (id: string, name: string) => void
}) {
  const navigate = useNavigate()
  const color = clientColor(client.client_name)

  const goEdit = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    navigate(`/clients/${client.id}/edit`)
  }, [client.id, navigate])

  const goDelete = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    onDelete(client.id, client.client_name)
  }, [client.id, client.client_name, onDelete])

  return (
    <div
      className="group rounded-xl overflow-hidden border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm hover:shadow-lg active:scale-[0.98] transition-all duration-150 flex flex-col cursor-pointer"
      onClick={() => navigate(`/clients/${client.id}`)}
    >
      {/* Header */}
      <div
        className="relative px-4 pt-5 pb-4 flex items-start gap-3"
        style={{ background: `linear-gradient(135deg, ${color}18 0%, ${color}08 100%)` }}
      >
        <ClientAvatar client={client} size="md" />

        {/* Name + type */}
        <div className="flex-1 min-w-0 pt-1">
          <h3 className="font-bold text-slate-800 dark:text-slate-100 leading-tight truncate">{client.client_name}</h3>
          {client.business_type && (
            <span className="inline-flex items-center gap-1 mt-1 text-xs rounded-full px-2 py-0.5 font-medium" style={{ backgroundColor: color + '18', color }}>
              <Building2 className="h-3 w-3" />
              {client.business_type}
            </span>
          )}
        </div>

        {/* Edit / Delete */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button onClick={goEdit} title="Edit" className="rounded p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button onClick={goDelete} title="Delete" className="rounded p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Contact */}
      <div className="px-4 py-2 flex flex-col gap-1 border-t dark:border-slate-700">
        {client.email && (
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 truncate">
            <Mail className="h-3 w-3 flex-shrink-0" />{client.email}
          </div>
        )}
        {client.phone_number && (
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Phone className="h-3 w-3 flex-shrink-0" />{client.phone_number}
          </div>
        )}
        {!client.email && !client.phone_number && (
          <p className="text-xs text-slate-300 dark:text-slate-600 italic">No contact info</p>
        )}
      </div>

      {/* Revenue strip */}
      <div className="px-4 py-3 flex items-center justify-between border-t dark:border-slate-700 flex-1">
        <div>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wide">Revenue</p>
          <p className="text-base font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(totalRevenue)}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wide">Sales</p>
          <p className="text-base font-bold tabular-nums text-slate-800 dark:text-slate-100">{salesCount}</p>
        </div>
      </div>

      {/* Hover CTA */}
      <div className="max-h-0 group-hover:max-h-14 overflow-hidden transition-all duration-300 ease-out">
        <Link
          to={`/clients/${client.id}`}
          onClick={e => e.stopPropagation()}
          className="flex items-center justify-between px-4 py-2.5 text-sm font-medium"
          style={{ backgroundColor: color, color: '#fff' }}
        >
          <span>View profile</span>
          <ChevronRight className="h-4 w-4 opacity-80 transition-transform duration-200 group-hover:translate-x-0.5" />
        </Link>
      </div>
    </div>
  )
}

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
      const { data, error } = await supabase.from('sales').select('client_id, amount').not('client_id', 'is', null)
      if (error) throw error
      return data as { client_id: string; amount: number | null }[]
    },
  })

  const statsMap = useMemo(() => {
    const m: Record<string, { count: number; revenue: number }> = {}
    for (const s of salesStats) {
      if (!s.client_id) continue
      if (!m[s.client_id]) m[s.client_id] = { count: 0, revenue: 0 }
      m[s.client_id].count++
      m[s.client_id].revenue += Number(s.amount ?? 0)
    }
    return m
  }, [salesStats])

  const filtered = useMemo(() => {
    if (!search.trim()) return clients
    const q = search.toLowerCase()
    return clients.filter(c =>
      c.client_name.toLowerCase().includes(q) ||
      (c.business_type ?? '').toLowerCase().includes(q) ||
      (c.email ?? '').toLowerCase().includes(q)
    )
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
        <input
          type="text"
          placeholder="Search clients…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded-lg border dark:border-slate-600 bg-white dark:bg-slate-800 pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand"
        />
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed dark:border-slate-700 bg-white dark:bg-slate-800 py-16 text-center">
          <Users className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600 mb-3" />
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {search ? 'No clients match your search.' : 'No clients yet.'}
          </p>
          {!search && (
            <Link to="/clients/new" className="mt-3 inline-flex items-center gap-1 text-sm text-brand font-medium hover:underline">
              <Plus className="h-3.5 w-3.5" /> Add your first client
            </Link>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(client => (
            <ClientCard
              key={client.id}
              client={client}
              salesCount={statsMap[client.id]?.count ?? 0}
              totalRevenue={statsMap[client.id]?.revenue ?? 0}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}
