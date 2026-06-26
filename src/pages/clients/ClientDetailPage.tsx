import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import type { Client, Sale } from '@/types/database'
import { ArrowLeft, Pencil, Mail, Phone, MapPin, Building2, FileText, TrendingUp, CheckCircle2, Clock, ExternalLink } from 'lucide-react'
import { StatusBadge } from '@/components/shared/StatusBadge'

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

function fmt(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

type SaleRow = Sale & { projects?: { project_name: string } | null }

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [tab, setTab] = useState<'sales' | 'info'>('sales')

  const { data: client, isLoading: loadingClient } = useQuery({
    queryKey: ['client', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('*').eq('id', id).single()
      if (error) throw error
      return data as Client
    },
  })

  const { data: sales = [], isLoading: loadingSales } = useQuery({
    queryKey: ['client-sales', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales')
        .select('*, projects:project_id ( project_name )')
        .eq('client_id', id!)
        .order('date', { ascending: false, nullsFirst: false })
      if (error) throw error
      return data as SaleRow[]
    },
    enabled: !!id,
  })

  if (loadingClient) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-sm text-slate-400">Loading…</p>
      </div>
    )
  }

  if (!client) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-slate-500">Client not found.</p>
        <Link to="/clients" className="text-sm text-blue-600 hover:underline">← Back to Clients</Link>
      </div>
    )
  }

  const color = clientColor(client.client_name)
  const initials = getInitials(client.client_name)

  const paidSales = sales.filter(s => s.sales_status === 'Paid')
  const pendingSales = sales.filter(s => s.sales_status !== 'Paid' && s.sales_status !== 'Cancelled')

  const totalRevenue = sales.reduce((s, r) => s + Number(r.amount ?? 0), 0)
  const totalPaid = paidSales.reduce((s, r) => s + Number(r.amount ?? 0), 0)
  const totalPending = pendingSales.reduce((s, r) => s + Number(r.amount ?? 0), 0)

  return (
    <div className="space-y-5">

      {/* Back + Edit */}
      <div className="flex items-center justify-between">
        <Link to="/clients" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-200">
          <ArrowLeft className="h-4 w-4" /> Clients
        </Link>
        <Link
          to={`/clients/${id}/edit`}
          className="flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
        >
          <Pencil className="h-3.5 w-3.5" /> Edit
        </Link>
      </div>

      {/* Hero card */}
      <div className="rounded-2xl overflow-hidden" style={{ background: `linear-gradient(135deg, ${color} 0%, ${color}cc 100%)` }}>
        {/* Top section */}
        <div className="relative px-6 py-7 overflow-hidden">
          {/* Watermark */}
          <span
            className="pointer-events-none select-none absolute -right-4 -bottom-4 font-black leading-none opacity-[0.1] text-white"
            style={{ fontSize: '10rem' }}
            aria-hidden
          >
            {initials}
          </span>

          <div className="relative z-10 flex items-center gap-5">
            {/* Avatar */}
            <div className="h-20 w-20 rounded-2xl bg-white/20 border-2 border-white/40 flex items-center justify-center text-3xl font-black text-white flex-shrink-0 shadow-lg">
              {initials}
            </div>

            <div>
              <h1 className="text-2xl font-black text-white leading-tight">{client.client_name}</h1>
              {client.business_type && (
                <div className="flex items-center gap-1.5 mt-1">
                  <Building2 className="h-3.5 w-3.5 text-white/70" />
                  <span className="text-sm text-white/80">{client.business_type}</span>
                </div>
              )}
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                {client.email && (
                  <a href={`mailto:${client.email}`} className="flex items-center gap-1.5 text-xs text-white/80 hover:text-white transition-colors">
                    <Mail className="h-3 w-3" />{client.email}
                  </a>
                )}
                {client.phone_number && (
                  <span className="flex items-center gap-1.5 text-xs text-white/80">
                    <Phone className="h-3 w-3" />{client.phone_number}
                  </span>
                )}
                {client.address && (
                  <span className="flex items-center gap-1.5 text-xs text-white/80">
                    <MapPin className="h-3 w-3" />{client.address}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Stat strip */}
        <div className="grid grid-cols-4 text-center divide-x divide-white/10" style={{ background: 'rgba(0,0,0,0.22)' }}>
          {[
            { label: 'Sales', value: String(sales.length) },
            { label: 'Total Revenue', value: formatCurrency(totalRevenue) },
            { label: 'Paid', value: formatCurrency(totalPaid) },
            { label: 'Pending', value: formatCurrency(totalPending) },
          ].map(({ label, value }) => (
            <div key={label} className="py-3 px-2">
              <p className="text-[10px] font-medium text-white/50 uppercase tracking-wider">{label}</p>
              <p className="text-sm font-bold text-white mt-0.5 tabular-nums">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b dark:border-slate-700">
        {(['sales', 'info'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors capitalize ${
              tab === t
                ? 'border-current text-brand'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            {t === 'sales' ? `Sales (${sales.length})` : 'Info'}
          </button>
        ))}
      </div>

      {/* SALES TAB */}
      {tab === 'sales' && (
        <>
          {loadingSales && <p className="text-center text-sm text-slate-400 py-12">Loading sales…</p>}

          {!loadingSales && sales.length === 0 && (
            <div className="rounded-2xl border-2 border-dashed dark:border-slate-700 py-14 text-center space-y-2">
              <TrendingUp className="mx-auto h-9 w-9 text-slate-300 dark:text-slate-600" />
              <p className="text-sm text-slate-500 dark:text-slate-400">No sales linked to this client yet.</p>
              <Link
                to="/sales/new"
                state={{ returnTo: `/clients/${id}` }}
                className="inline-flex items-center gap-1 text-sm text-brand font-medium hover:underline"
              >
                + Record a sale
              </Link>
            </div>
          )}

          {!loadingSales && sales.length > 0 && (
            <div className="space-y-3">
              {/* Paid / Pending summary pills */}
              <div className="flex gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 px-3 py-1 text-xs font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {paidSales.length} paid · {formatCurrency(totalPaid)}
                </span>
                {pendingSales.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 px-3 py-1 text-xs font-medium">
                    <Clock className="h-3.5 w-3.5" /> {pendingSales.length} pending · {formatCurrency(totalPending)}
                  </span>
                )}
              </div>

              {/* Sales rows */}
              <div className="rounded-2xl border dark:border-slate-700 overflow-hidden">
                {sales.map((s, i) => (
                  <Link
                    key={s.id}
                    to={`/sales/${s.id}/edit`}
                    state={{ returnTo: `/clients/${id}` }}
                    className={`flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors group/row ${i < sales.length - 1 ? 'border-b dark:border-slate-700' : ''}`}
                  >
                    {/* Date */}
                    <div className="w-12 flex-shrink-0 text-center">
                      {s.date ? (
                        <>
                          <p className="text-[10px] text-slate-400 leading-none">
                            {new Date(s.date).toLocaleString('default', { month: 'short' })}
                          </p>
                          <p className="text-lg font-bold text-slate-700 dark:text-slate-200 leading-tight">
                            {new Date(s.date).getDate()}
                          </p>
                        </>
                      ) : (
                        <p className="text-slate-300 text-lg">—</p>
                      )}
                    </div>

                    {/* Description */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                        {s.sales_description || '—'}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        {s.projects?.project_name && (
                          <span className="text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 px-1.5 py-0.5 rounded font-medium truncate max-w-[120px]">
                            {s.projects.project_name}
                          </span>
                        )}
                        {s.product_or_service && (
                          <span className="text-xs text-slate-400 truncate">{s.product_or_service}</span>
                        )}
                        <span className="text-xs text-slate-400">{fmt(s.date)}</span>
                      </div>
                    </div>

                    {/* Status + amount */}
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">
                        {s.amount != null ? formatCurrency(Number(s.amount)) : '—'}
                      </span>
                      {s.sales_status && <StatusBadge status={s.sales_status} />}
                    </div>

                    <ExternalLink className="h-3.5 w-3.5 text-slate-300 group-hover/row:text-slate-400 flex-shrink-0 transition-colors" />
                  </Link>
                ))}
              </div>

              {/* Grand total */}
              <div className="flex items-center justify-between rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 px-5 py-4 shadow-sm">
                <span className="text-sm text-slate-500 dark:text-slate-400">Total across {sales.length} sale{sales.length !== 1 ? 's' : ''}</span>
                <span className="text-lg font-black tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(totalRevenue)}</span>
              </div>
            </div>
          )}
        </>
      )}

      {/* INFO TAB */}
      {tab === 'info' && (
        <div className="rounded-2xl border dark:border-slate-700 bg-white dark:bg-slate-800 divide-y dark:divide-slate-700 shadow-sm">
          {[
            { icon: <Building2 className="h-4 w-4" />, label: 'Business Type', value: client.business_type },
            { icon: <Mail className="h-4 w-4" />, label: 'Email', value: client.email },
            { icon: <Mail className="h-4 w-4" />, label: 'Additional Email', value: client.additional_email },
            { icon: <Phone className="h-4 w-4" />, label: 'Phone', value: client.phone_number },
            { icon: <MapPin className="h-4 w-4" />, label: 'Address', value: client.address },
            { icon: <FileText className="h-4 w-4" />, label: 'Notes', value: client.notes },
          ].map(({ icon, label, value }) => (
            <div key={label} className="flex items-start gap-4 px-5 py-4">
              <span className="flex-shrink-0 text-slate-400 dark:text-slate-500 mt-0.5">{icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">{label}</p>
                <p className="text-sm text-slate-700 dark:text-slate-200 mt-0.5 break-words">{value ?? <span className="text-slate-300 dark:text-slate-600 italic">Not set</span>}</p>
              </div>
            </div>
          ))}
          <div className="flex items-center gap-4 px-5 py-4">
            <span className="flex-shrink-0 text-slate-400"><FileText className="h-4 w-4" /></span>
            <div>
              <p className="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Receipt Vouched</p>
              <p className="text-sm text-slate-700 dark:text-slate-200 mt-0.5">{client.receipt_vouched ? 'Yes' : 'No'}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
