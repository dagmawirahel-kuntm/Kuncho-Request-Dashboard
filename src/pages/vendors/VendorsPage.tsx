import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Vendor } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { EntityDirectory, type EntityColumn } from '@/components/shared/EntityDirectory'
import { formatCurrency } from '@/lib/utils'
import { Plus, Pencil, Trash2, Search, Building2, Users, ShieldCheck, Wallet, CheckCircle2, XCircle } from 'lucide-react'

const PALETTE = [
  '#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444',
  '#06B6D4', '#F97316', '#6366F1', '#EC4899', '#14B8A6',
]
function vendorColor(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff
  return PALETTE[Math.abs(h) % PALETTE.length]
}
function vendorInitials(name: string) {
  const w = name.trim().split(/\s+/)
  return w.length >= 2 ? (w[0][0] + w[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase()
}

// Vendor "category" in this schema is really vendor_type — a fixed 5-value
// enum (Supplier / Service Provider / Contractor / Individual / Other) —
// the free-text `category` field is unstructured per-vendor notes, not a
// grouping axis, so it can't drive a coherent brand-colour-per-category
// scheme. Unset/unrecognised types fall back to the per-name hash so every
// vendor still gets a distinct, stable colour.
const VENDOR_TYPE_COLORS: Record<string, string> = {
  'Supplier': '#0EA5E9',
  'Service Provider': '#8B5CF6',
  'Contractor': '#F59E0B',
  'Individual': '#10B981',
  'Other': '#64748B',
}
function vendorBrandColor(vendor: Vendor) {
  return (vendor.vendor_type && VENDOR_TYPE_COLORS[vendor.vendor_type]) || vendorColor(vendor.vendor_name)
}

interface VendorStats {
  totalPaid: number
  lastTransactionDate: string | null
}

export default function VendorsPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { role } = useAuth()
  const canWrite = role === 'admin' || role === 'manager' || role === 'finance' || role === 'procurement_officer'
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all')

  const { data = [], isLoading } = useQuery({
    queryKey: ['vendors'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vendors').select('*').order('vendor_name')
      if (error) throw error
      return data as Vendor[]
    },
  })

  // Total paid to date + last transaction date, per vendor — the source of
  // truth is expenses actually settled (fully or partially), not every
  // expense ever raised against that vendor.
  const { data: paymentRows = [] } = useQuery({
    queryKey: ['vendor-payment-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('vendor_id, amount_etb, payment_status, partially_paid, partial_paid_amount, date, paid_date, partial_payment_date')
        .not('vendor_id', 'is', null)
      if (error) throw error
      return data
    },
  })

  const vendorStatsMap = useMemo(() => {
    const m: Record<string, VendorStats> = {}
    for (const e of paymentRows) {
      const vendorId = e.vendor_id as string
      if (!m[vendorId]) m[vendorId] = { totalPaid: 0, lastTransactionDate: null }
      const paidAmount = e.payment_status
        ? Number(e.amount_etb ?? 0)
        : e.partially_paid
          ? Number(e.partial_paid_amount ?? 0)
          : 0
      m[vendorId].totalPaid += paidAmount
      const txDate = e.paid_date ?? e.partial_payment_date ?? e.date
      if (txDate && (!m[vendorId].lastTransactionDate || txDate > m[vendorId].lastTransactionDate!)) {
        m[vendorId].lastTransactionDate = txDate
      }
    }
    return m
  }, [paymentRows])

  const handleDelete = useCallback(async (id: string, name: string) => {
    if (!window.confirm(`Delete vendor "${name}"? This cannot be undone.`)) return
    const { error } = await supabase.from('vendors').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['vendors'] })
    qc.invalidateQueries({ queryKey: ['vendors-lookup'] })
    toast('Vendor deleted', 'success')
  }, [qc, toast])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return data.filter(v => {
      const matchSearch = !q
        || v.vendor_name.toLowerCase().includes(q)
        || (v.vendor_type ?? '').toLowerCase().includes(q)
        || (v.category ?? '').toLowerCase().includes(q)
        || (v.location ?? '').toLowerCase().includes(q)
      const matchStatus = filterStatus === 'all' || (filterStatus === 'active' ? v.active : !v.active)
      return matchSearch && matchStatus
    })
  }, [data, search, filterStatus])

  const stats = useMemo(() => {
    const activeCount = data.filter(v => v.active).length
    const whtCount = data.filter(v => v.wth_eligible).length
    const totalPaid = Object.values(vendorStatsMap).reduce((s, v) => s + v.totalPaid, 0)
    return { activeCount, whtCount, totalPaid, count: data.length }
  }, [data, vendorStatsMap])

  const columns: EntityColumn<Vendor>[] = [
    { key: 'type', label: 'Type', render: v => v.vendor_type ? <span className="rounded-md bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-300">{v.vendor_type}</span> : null },
    { key: 'status', label: 'Status', render: v => <StatusBadge status={v.active ? 'active' : 'inactive'} /> },
    { key: 'wht', label: 'WHT', render: v => v.wth_eligible ? <ShieldCheck className="h-4 w-4 text-purple-500" /> : null },
    {
      key: 'totalPaid',
      label: 'Total Paid',
      align: 'right',
      render: v => <span className="font-bold text-slate-800 dark:text-slate-100">{formatCurrency(vendorStatsMap[v.id]?.totalPaid ?? 0)}</span>,
    },
  ]

  return (
    <EntityDirectory
      storageKey="vendors"
      title="Vendors"
      subtitle={`${stats.activeCount} active · ${stats.count} total`}
      records={filtered}
      isLoading={isLoading}
      getId={v => v.id}
      getName={v => v.vendor_name}
      getSubline={v => v.tin ? `TIN •••• ${v.tin.slice(-4)}` : null}
      getBrand={v => ({ bg: vendorBrandColor(v), fg: '#fff', logo: null, initials: vendorInitials(v.vendor_name) })}
      columns={columns}
      summaryStats={[
        { label: 'Active Vendors', value: `${stats.activeCount} of ${stats.count}`, icon: <Users className="h-5 w-5" /> },
        { label: 'WHT Eligible', value: String(stats.whtCount), icon: <ShieldCheck className="h-5 w-5" />, valueClassName: 'text-purple-600 dark:text-purple-400' },
        { label: 'Total Paid', value: formatCurrency(stats.totalPaid), icon: <Wallet className="h-5 w-5" /> },
      ]}
      onAdd={canWrite ? () => navigate('/vendors/new') : undefined}
      addLabel="Add Vendor"
      renderCardBody={v => {
        const s = vendorStatsMap[v.id]
        return (
          <>
            <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Total Paid</p>
            <p className="text-2xl font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(s?.totalPaid ?? 0)}</p>
            <div className="mt-3 flex items-center justify-between text-xs">
              <span className={`inline-flex items-center gap-1 font-medium ${v.wth_eligible ? 'text-purple-600 dark:text-purple-400' : 'text-slate-400 dark:text-slate-500'}`}>
                {v.wth_eligible ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                WHT {v.wth_eligible ? 'Eligible' : 'N/A'}
              </span>
              <span className="text-slate-400 dark:text-slate-500">
                {s?.lastTransactionDate ? `Last: ${new Date(s.lastTransactionDate).toLocaleDateString()}` : 'No transactions'}
              </span>
            </div>
          </>
        )
      }}
      renderFooterChips={v => (
        <>
          {v.vendor_type && (
            <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-300">
              <Building2 className="h-3 w-3" />{v.vendor_type}
            </span>
          )}
          <StatusBadge status={v.active ? 'active' : 'inactive'} />
        </>
      )}
      renderRowActions={canWrite ? v => (
        <>
          <button
            onClick={e => { e.stopPropagation(); navigate(`/vendors/${v.id}/edit`) }}
            title="Edit"
            className="rounded p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={e => { e.stopPropagation(); handleDelete(v.id, v.vendor_name) }}
            title="Delete"
            className="rounded p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </>
      ) : undefined}
      getHref={v => `/vendors/${v.id}`}
      ctaLabel="View vendor"
      emptyIcon={<Users className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600" />}
      emptyMessage={search || filterStatus !== 'all' ? 'No vendors match your search.' : 'No vendors yet.'}
      emptyCta={canWrite && !search && filterStatus === 'all' ? (
        <button onClick={() => navigate('/vendors/new')} className="mt-3 inline-flex items-center gap-1 text-sm text-brand font-medium hover:underline">
          <Plus className="h-3.5 w-3.5" /> Add your first vendor
        </button>
      ) : undefined}
      toolbar={
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search vendors…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full rounded-lg border dark:border-slate-600 bg-white dark:bg-slate-800 pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
          <div className="flex rounded-lg border dark:border-slate-600 overflow-hidden text-sm bg-white dark:bg-slate-800">
            {(['all', 'active', 'inactive'] as const).map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`px-3 py-2 capitalize transition-colors ${filterStatus === s ? 'bg-brand text-white' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      }
    />
  )
}
