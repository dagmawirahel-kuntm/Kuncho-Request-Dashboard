import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Vendor } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { EntityDirectory, type EntityColumn } from '@/components/shared/EntityDirectory'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useVendorMoneyMap, useVendorTypes, useCanManageVendors, type VendorMoney } from '@/lib/vendors'
import { Plus, Pencil, Trash2, Search, Building2, Users, ShieldCheck, ShieldAlert, Wallet, Power, GitMerge, ClipboardList, Clock } from 'lucide-react'

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

// Colour by type where the type says something about how we deal with
// them (tax receipt or not); otherwise a stable per-name colour.
const VENDOR_TYPE_COLORS: Record<string, string> = {
  'Supplier with VAT': '#0EA5E9',
  'Supplier with TOT': '#6366F1',
  'Supplier with no receipt': '#F97316',
  'Service Provider': '#8B5CF6',
  'Contractor': '#F59E0B',
  'Labor Broker': '#14B8A6',
  'Individual': '#10B981',
  'Government': '#64748B',
}
function vendorBrandColor(vendor: Vendor) {
  return (vendor.vendor_type && VENDOR_TYPE_COLORS[vendor.vendor_type]) || vendorColor(vendor.vendor_name)
}

type Flag = 'unverified' | 'owed' | 'no_bank' | 'no_tin' | 'wht' | 'dormant'
const FLAGS: { id: Flag; label: string }[] = [
  { id: 'unverified', label: 'Not verified' },
  { id: 'owed', label: 'We owe them' },
  { id: 'no_bank', label: 'No bank details' },
  { id: 'no_tin', label: 'No TIN' },
  { id: 'wht', label: 'WHT' },
  { id: 'dormant', label: 'Not used in a year' },
]
type Sort = 'name' | 'paid' | 'owed' | 'recent'

const ZERO: VendorMoney = { vendor_id: '', paid: 0, sent_awaiting_bank: 0, advances_open: 0, owed: 0, awaiting_approval: 0, committed: 0, credit_left: 0, expense_count: 0, po_count: 0, last_used_on: null, first_expense_on: null }

export default function VendorsPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const canWrite = useCanManageVendors()
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('active')
  const [type, setType] = useState('')
  const [category, setCategory] = useState('')
  const [flags, setFlags] = useState<Set<Flag>>(new Set())
  const [sort, setSort] = useState<Sort>('recent')

  const { data = [], isLoading } = useQuery({
    queryKey: ['vendors'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vendors').select('*').order('vendor_name')
      if (error) throw error
      return data as Vendor[]
    },
  })
  const { data: moneyMap } = useVendorMoneyMap()
  const { data: types = [] } = useVendorTypes()
  const money = useCallback((id: string) => moneyMap?.get(id) ?? ZERO, [moneyMap])

  // Counts for the review shortcuts.
  const { data: dupCount = 0 } = useQuery({
    queryKey: ['vendor-duplicate-count'],
    enabled: canWrite,
    queryFn: async () => {
      const { count, error } = await supabase.from('v_vendor_duplicate_pairs').select('vendor_a', { count: 'exact', head: true })
      if (error) throw error
      return count ?? 0
    },
  })

  const categories = useMemo(() => [...new Set(data.map(v => v.category).filter(Boolean) as string[])].sort(), [data])
  const yearAgo = useMemo(() => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d }, [])

  // Deleting a vendor with history fails on the database's references, so
  // those are deactivated instead; only a vendor never used can go.
  const handleRemove = useCallback(async (v: Vendor) => {
    const m = money(v.id)
    const used = m.expense_count + m.po_count > 0
    if (used) {
      if (!window.confirm(`${v.vendor_name} has ${m.expense_count} expense(s) and ${m.po_count} purchase order(s), so it can't be deleted. Deactivate it instead? It stops being offered when picking a vendor; its history stays.`)) return
      const { error } = await supabase.from('vendors').update({ active: false }).eq('id', v.id)
      if (error) { toast(error.message, 'error'); return }
      toast('Vendor deactivated', 'success')
    } else {
      if (!window.confirm(`Delete vendor "${v.vendor_name}"? It has never been used. This cannot be undone.`)) return
      const { error } = await supabase.from('vendors').delete().eq('id', v.id)
      if (error) { toast(error.message.includes('foreign key') ? 'This vendor is referenced elsewhere — deactivate it instead.' : error.message, 'error'); return }
      toast('Vendor deleted', 'success')
    }
    qc.invalidateQueries({ queryKey: ['vendors'] })
    qc.invalidateQueries({ queryKey: ['vendors-lookup'] })
  }, [qc, toast, money])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    const rows = data.filter(v => {
      const m = money(v.id)
      if (q && !(v.vendor_name.toLowerCase().includes(q) || (v.vendor_type ?? '').toLowerCase().includes(q)
        || (v.category ?? '').toLowerCase().includes(q) || (v.location ?? '').toLowerCase().includes(q)
        || (v.tin ?? '').includes(q) || (v.bank_account ?? '').includes(q) || (v.phone_contact ?? '').includes(q))) return false
      if (filterStatus !== 'all' && (filterStatus === 'active') !== !!v.active) return false
      if (type && (type === '(none)' ? !!v.vendor_type : v.vendor_type !== type)) return false
      if (category && v.category !== category) return false
      if (flags.has('unverified') && v.verification_status !== 'pending_verification') return false
      if (flags.has('owed') && m.owed <= 0) return false
      if (flags.has('no_bank') && !!v.bank_account && !!v.bank_id) return false
      if (flags.has('no_tin') && !!v.tin) return false
      if (flags.has('wht') && !v.wth_eligible) return false
      if (flags.has('dormant') && m.last_used_on && new Date(m.last_used_on) >= yearAgo) return false
      return true
    })
    const by: Record<Sort, (a: Vendor, b: Vendor) => number> = {
      name: (a, b) => a.vendor_name.localeCompare(b.vendor_name),
      paid: (a, b) => money(b.id).paid - money(a.id).paid,
      owed: (a, b) => money(b.id).owed - money(a.id).owed,
      recent: (a, b) => (money(b.id).last_used_on ?? '').localeCompare(money(a.id).last_used_on ?? '') || a.vendor_name.localeCompare(b.vendor_name),
    }
    return rows.sort(by[sort])
  }, [data, search, filterStatus, type, category, flags, sort, money, yearAgo])

  const stats = useMemo(() => {
    const active = data.filter(v => v.active)
    let paid = 0, owed = 0
    for (const v of data) { paid += money(v.id).paid; owed += money(v.id).owed }
    return {
      activeCount: active.length, count: data.length, paid, owed,
      unverified: data.filter(v => v.verification_status === 'pending_verification').length,
    }
  }, [data, money])

  const columns: EntityColumn<Vendor>[] = [
    { key: 'type', label: 'Type', render: v => v.vendor_type ? <span className="rounded-md bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap">{v.vendor_type}</span> : <span className="text-xs text-amber-600">not set</span> },
    { key: 'checked', label: 'Bank details', render: v => v.verification_status === 'pending_verification'
      ? <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400 whitespace-nowrap"><ShieldAlert className="h-3.5 w-3.5" />Not verified</span>
      : !v.bank_account ? <span className="text-xs text-slate-400">none</span>
      : <ShieldCheck className="h-4 w-4 text-emerald-500" /> },
    { key: 'last', label: 'Last used', render: v => <span className="text-xs text-slate-500 whitespace-nowrap">{money(v.id).last_used_on ? formatDate(money(v.id).last_used_on) : '—'}</span> },
    { key: 'owed', label: 'Owed', align: 'right', render: v => money(v.id).owed > 0 ? <span className="font-medium text-amber-600 dark:text-amber-400 tabular-nums">{formatCurrency(money(v.id).owed)}</span> : <span className="text-slate-300">—</span> },
    { key: 'paid', label: 'Paid', align: 'right', render: v => <span className="font-bold text-slate-800 dark:text-slate-100 tabular-nums">{formatCurrency(money(v.id).paid)}</span> },
  ]

  const chip = (on: boolean) => `rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${on ? 'border-brand bg-brand text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'}`
  const selCls = 'rounded-lg border dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-2 text-sm text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-brand'

  return (
    <EntityDirectory
      storageKey="vendors"
      title="Vendors"
      subtitle={`${stats.activeCount} active · ${stats.count} total`}
      records={filtered}
      isLoading={isLoading}
      getId={v => v.id}
      getName={v => v.vendor_name}
      getSubline={v => [v.category, v.tin ? `TIN •••• ${v.tin.slice(-4)}` : null].filter(Boolean).join(' · ') || null}
      getBrand={v => ({ bg: vendorBrandColor(v), fg: '#fff', logo: null, initials: vendorInitials(v.vendor_name) })}
      columns={columns}
      summaryStats={[
        { label: 'Active Vendors', value: `${stats.activeCount} of ${stats.count}`, icon: <Users className="h-5 w-5" /> },
        { label: 'Approved, not paid', value: formatCurrency(stats.owed), icon: <Clock className="h-5 w-5" />, valueClassName: stats.owed > 0 ? 'text-amber-600 dark:text-amber-400' : undefined },
        { label: 'Total Paid', value: formatCurrency(stats.paid), icon: <Wallet className="h-5 w-5" /> },
      ]}
      onAdd={canWrite ? () => navigate('/vendors/new') : undefined}
      addLabel="Add Vendor"
      renderCardBody={v => {
        const m = money(v.id)
        return (
          <>
            <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Paid</p>
            <p className="text-2xl font-bold tabular-nums text-slate-800 dark:text-slate-100 truncate">{formatCurrency(m.paid)}</p>
            <p className={`mt-0.5 text-xs tabular-nums ${m.owed > 0 ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-slate-400'}`}>
              {m.owed > 0 ? `${formatCurrency(m.owed)} approved, not paid` : 'Nothing owed'}
            </p>
            <div className="mt-3 flex items-center justify-between gap-2 text-xs">
              {v.verification_status === 'pending_verification'
                ? <span className="inline-flex items-center gap-1 font-medium text-red-600 dark:text-red-400"><ShieldAlert className="h-3.5 w-3.5" />Bank details not verified</span>
                : <span className={`inline-flex items-center gap-1 font-medium ${v.wth_eligible ? 'text-purple-600 dark:text-purple-400' : 'text-slate-400'}`}>{v.wth_eligible ? 'WHT withheld' : 'No WHT'}</span>}
              <span className="text-slate-400 dark:text-slate-500">{m.last_used_on ? `Last: ${formatDate(m.last_used_on)}` : 'Never used'}</span>
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
      renderRowActions={canWrite ? v => {
        const used = money(v.id).expense_count + money(v.id).po_count > 0
        return (
          <>
            <button onClick={e => { e.stopPropagation(); navigate(`/vendors/${v.id}/edit`) }} title="Edit"
              className="rounded p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            {v.active && (
              <button onClick={e => { e.stopPropagation(); handleRemove(v) }} title={used ? 'Deactivate' : 'Delete'}
                className="rounded p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                {used ? <Power className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            )}
          </>
        )
      } : undefined}
      getHref={v => `/vendors/${v.id}`}
      ctaLabel="View vendor"
      emptyIcon={<Users className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600" />}
      emptyMessage={data.length ? 'No vendors match these filters.' : 'No vendors yet.'}
      emptyCta={canWrite && !data.length ? (
        <button onClick={() => navigate('/vendors/new')} className="mt-3 inline-flex items-center gap-1 text-sm text-brand font-medium hover:underline">
          <Plus className="h-3.5 w-3.5" /> Add your first vendor
        </button>
      ) : undefined}
      toolbar={
        <div className="space-y-3">
          {canWrite && (stats.unverified > 0 || dupCount > 0) && (
            <div className="flex flex-wrap gap-2">
              {stats.unverified > 0 && (
                <Link to="/vendors/review" className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-300">
                  <ShieldAlert className="h-4 w-4" /> {stats.unverified} to verify
                </Link>
              )}
              {dupCount > 0 && (
                <Link to="/vendors/review?tab=duplicates" className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-300">
                  <GitMerge className="h-4 w-4" /> {dupCount} possible duplicate{dupCount === 1 ? '' : 's'}
                </Link>
              )}
              <Link to="/vendors/review?tab=missing" className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
                <ClipboardList className="h-4 w-4" /> Missing details
              </Link>
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input type="text" placeholder="Search name, TIN, account, phone…" value={search} onChange={e => setSearch(e.target.value)}
                className="w-full rounded-lg border dark:border-slate-600 bg-white dark:bg-slate-800 pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand" />
            </div>
            <select className={selCls} value={type} onChange={e => setType(e.target.value)} aria-label="Type">
              <option value="">All types</option>
              <option value="(none)">Type not set</option>
              {types.map(t => <option key={t.code} value={t.code}>{t.code}</option>)}
            </select>
            <select className={selCls} value={category} onChange={e => setCategory(e.target.value)} aria-label="Category">
              <option value="">All categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className={selCls} value={sort} onChange={e => setSort(e.target.value as Sort)} aria-label="Sort">
              <option value="recent">Recently used</option>
              <option value="paid">Most paid</option>
              <option value="owed">Most owed</option>
              <option value="name">Name</option>
            </select>
            <div className="flex rounded-lg border dark:border-slate-600 overflow-hidden text-sm bg-white dark:bg-slate-800">
              {(['active', 'inactive', 'all'] as const).map(s => (
                <button key={s} onClick={() => setFilterStatus(s)}
                  className={`px-3 py-2 capitalize transition-colors ${filterStatus === s ? 'bg-brand text-white' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FLAGS.map(f => (
              <button key={f.id} className={chip(flags.has(f.id))}
                onClick={() => setFlags(prev => { const n = new Set(prev); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n })}>
                {f.label}
              </button>
            ))}
            {(flags.size > 0 || type || category || search) && (
              <button className="text-xs text-slate-500 hover:text-brand px-1" onClick={() => { setFlags(new Set()); setType(''); setCategory(''); setSearch('') }}>Clear filters</button>
            )}
          </div>
        </div>
      }
    />
  )
}
