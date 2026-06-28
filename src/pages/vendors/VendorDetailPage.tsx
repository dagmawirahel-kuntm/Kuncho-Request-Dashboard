import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Vendor, Expense, SourcingBundle, CpoBond } from '@/types/database'
import {
  ArrowLeft, Pencil, Phone, Mail, MapPin, Globe, User, CreditCard,
  FileText, Package, Shield, Check, X, Building2, Tag, ExternalLink,
} from 'lucide-react'

const PALETTE = [
  '#3B82F6','#8B5CF6','#10B981','#F59E0B','#EF4444',
  '#06B6D4','#F97316','#6366F1','#EC4899','#14B8A6',
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

type Tab = 'expenses' | 'sourcing' | 'bonds'

function InfoRow({ icon, label, value, href }: { icon: React.ReactNode; label: string; value: string | null | undefined; href?: string }) {
  if (!value) return null
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 text-slate-400 dark:text-slate-500 flex-shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500 font-semibold">{label}</p>
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-sm text-brand hover:underline flex items-center gap-1">
            {value} <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <p className="text-sm text-slate-800 dark:text-slate-100 break-words">{value}</p>
        )}
      </div>
    </div>
  )
}

type ExpenseWithProject = Expense & { projects?: { project_name: string } | null }
type SourcingBundleRow = SourcingBundle & { items_count?: number }

function StatusBadge({ value }: { value: string }) {
  const color =
    value === 'fulfilled' || value === 'approved' || value === 'Paid' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
    value === 'ordered'   ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
    value === 'submitted' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
    value === 'cancelled' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
    'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${color}`}>{value}</span>
}

export default function VendorDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('expenses')

  const { data: vendor, isLoading } = useQuery<Vendor>({
    queryKey: ['vendor', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('vendors').select('*').eq('id', id!).single()
      if (error) throw error
      return data as Vendor
    },
    enabled: !!id,
  })

  const { data: expenses = [] } = useQuery<ExpenseWithProject[]>({
    queryKey: ['vendor-expenses', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('id, date, description_of_item, amount, approval_status, projects(project_name)')
        .eq('vendor_id', id!)
        .order('date', { ascending: false })
        .limit(50)
      if (error) throw error
      return data as ExpenseWithProject[]
    },
    enabled: !!id,
  })

  const { data: bundles = [] } = useQuery<SourcingBundleRow[]>({
    queryKey: ['vendor-bundles', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sourcing_bundles')
        .select('*')
        .eq('vendor_id', id!)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data as SourcingBundleRow[]
    },
    enabled: !!id,
  })

  const { data: bonds = [] } = useQuery<CpoBond[]>({
    queryKey: ['vendor-bonds', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cpo_bonds')
        .select('*')
        .eq('vendor_id', id!)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data as CpoBond[]
    },
    enabled: !!id,
  })

  if (isLoading || !vendor) return (
    <div className="flex items-center justify-center h-64 text-sm text-slate-400 dark:text-slate-500">Loading…</div>
  )

  const totalSpend = expenses.reduce((s, e) => s + Number((e as any).amount ?? 0), 0)
  const color = vendorColor(vendor.vendor_name)
  const initials = vendorInitials(vendor.vendor_name)

  const TABS: { key: Tab; label: string; count: number; icon: React.ReactNode }[] = [
    { key: 'expenses', label: 'Expenses', count: expenses.length, icon: <FileText className="h-3.5 w-3.5" /> },
    { key: 'sourcing', label: 'Sourcing Bundles', count: bundles.length, icon: <Package className="h-3.5 w-3.5" /> },
    { key: 'bonds',    label: 'CPO Bonds',        count: bonds.length,   icon: <Shield className="h-3.5 w-3.5" /> },
  ]

  return (
    <div className="space-y-5">
      {/* Top nav */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <button onClick={() => navigate('/vendors')}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Vendors
        </button>
        <Link to={`/vendors/${id}/edit`}
          className="inline-flex items-center gap-1.5 rounded-lg border dark:border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700">
          <Pencil className="h-3.5 w-3.5" /> Edit Profile
        </Link>
      </div>

      {/* ── Hero card ── */}
      <div className="rounded-2xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
        {/* Top colour strip */}
        <div className="h-2" style={{ backgroundColor: color }} />

        <div className="px-6 py-5 flex items-start gap-5 flex-wrap">
          {/* Avatar */}
          <div className="h-16 w-16 rounded-2xl flex items-center justify-center text-2xl font-black text-white shadow-md flex-shrink-0"
            style={{ backgroundColor: color }}>
            {initials}
          </div>

          {/* Name + badges */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{vendor.vendor_name}</h1>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${vendor.active ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'}`}>
                {vendor.active ? 'Active' : 'Inactive'}
              </span>
              {vendor.wth_eligible && (
                <span className="rounded-full bg-purple-100 dark:bg-purple-900/30 px-2.5 py-0.5 text-xs font-semibold text-purple-700 dark:text-purple-400">WHT</span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              {vendor.vendor_type && (
                <span className="flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400">
                  <Building2 className="h-3.5 w-3.5" />{vendor.vendor_type}
                </span>
              )}
              {vendor.category && (
                <span className="flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400">
                  <Tag className="h-3.5 w-3.5" />{vendor.category}
                </span>
              )}
            </div>
          </div>

          {/* Stats */}
          <div className="flex gap-6 text-right flex-shrink-0">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500 font-semibold">Total Spend</p>
              <p className="text-lg font-bold text-slate-800 dark:text-slate-100 tabular-nums">{formatCurrency(totalSpend)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500 font-semibold">Transactions</p>
              <p className="text-lg font-bold text-slate-800 dark:text-slate-100 tabular-nums">{expenses.length}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500 font-semibold">Bundles</p>
              <p className="text-lg font-bold text-slate-800 dark:text-slate-100 tabular-nums">{bundles.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Info grid ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

        {/* Contact block */}
        <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Contact</h2>
          <InfoRow icon={<User className="h-4 w-4" />} label="Contact Person" value={vendor.contact_person} />
          <InfoRow icon={<Phone className="h-4 w-4" />} label="Phone" value={vendor.phone_contact} href={vendor.phone_contact ? `tel:${vendor.phone_contact}` : undefined} />
          <InfoRow icon={<Mail className="h-4 w-4" />} label="Email" value={vendor.email} href={vendor.email ? `mailto:${vendor.email}` : undefined} />
          <InfoRow icon={<MapPin className="h-4 w-4" />} label="Location" value={vendor.location} />
          <InfoRow icon={<MapPin className="h-4 w-4" />} label="Address" value={vendor.address} />
          <InfoRow icon={<Globe className="h-4 w-4" />} label="Website" value={vendor.website} href={vendor.website ?? undefined} />
          {vendor.notes && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500 font-semibold mb-1">Notes</p>
              <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{vendor.notes}</p>
            </div>
          )}
          {!vendor.contact_person && !vendor.phone_contact && !vendor.email && !vendor.location && !vendor.address && !vendor.website && !vendor.notes && (
            <p className="text-sm text-slate-400 dark:text-slate-500 italic">No contact info — <Link to={`/vendors/${id}/edit`} className="text-brand hover:underline">add it</Link></p>
          )}
        </div>

        {/* Financial block */}
        <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Financial</h2>
          <InfoRow icon={<FileText className="h-4 w-4" />} label="TIN Number" value={vendor.tin} />
          <InfoRow icon={<CreditCard className="h-4 w-4" />} label="Bank Account" value={vendor.bank_account} />
          <InfoRow icon={<CreditCard className="h-4 w-4" />} label="Payment Terms" value={vendor.payment_terms} />
          <div className="flex items-center gap-3 pt-1">
            <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${vendor.wth_eligible ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'}`}>
              {vendor.wth_eligible ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
              WHT Eligible
            </div>
          </div>
          <div className="border-t dark:border-slate-700 pt-4">
            <p className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500 font-semibold mb-1">Added</p>
            <p className="text-sm text-slate-600 dark:text-slate-300">{formatDate(vendor.created_at)}</p>
          </div>
        </div>
      </div>

      {/* ── Activity tabs ── */}
      <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
        {/* Tab bar */}
        <div className="flex border-b dark:border-slate-700">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-brand text-brand dark:text-brand'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              {t.icon}{t.label}
              <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 dark:text-slate-400">{t.count}</span>
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="p-0">

          {/* Expenses tab */}
          {tab === 'expenses' && (
            expenses.length === 0
              ? <p className="py-10 text-center text-sm text-slate-400 dark:text-slate-500">No expenses linked to this vendor.</p>
              : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
                      <tr>
                        {['Date','Description','Project','Amount','Status'].map(h => (
                          <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50 dark:divide-slate-700/60">
                      {expenses.map(e => (
                        <tr key={e.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors">
                          <td className="px-4 py-2.5 whitespace-nowrap text-slate-500 dark:text-slate-400">{e.date ? formatDate(e.date) : '—'}</td>
                          <td className="px-4 py-2.5 max-w-[260px] truncate text-slate-800 dark:text-slate-100">{(e as any).description_of_item || '—'}</td>
                          <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{(e as any).projects?.project_name ?? '—'}</td>
                          <td className="px-4 py-2.5 tabular-nums font-medium text-slate-800 dark:text-slate-100">{formatCurrency((e as any).amount ?? 0)}</td>
                          <td className="px-4 py-2.5"><StatusBadge value={e.approval_status} /></td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/60">
                        <td colSpan={3} className="px-4 py-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Total</td>
                        <td className="px-4 py-2.5 tabular-nums font-bold text-slate-800 dark:text-slate-100">{formatCurrency(totalSpend)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )
          )}

          {/* Sourcing Bundles tab */}
          {tab === 'sourcing' && (
            bundles.length === 0
              ? <p className="py-10 text-center text-sm text-slate-400 dark:text-slate-500">No sourcing bundles linked to this vendor.</p>
              : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
                      <tr>
                        {['Bundle','Status','Submitted','Expected Delivery','Notes',''].map(h => (
                          <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50 dark:divide-slate-700/60">
                      {bundles.map(b => (
                        <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors">
                          <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-slate-100">{b.bundle_code}</td>
                          <td className="px-4 py-2.5"><StatusBadge value={b.status} /></td>
                          <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{b.submitted_at ? formatDate(b.submitted_at) : '—'}</td>
                          <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{b.expected_delivery_date ? formatDate(b.expected_delivery_date) : '—'}</td>
                          <td className="px-4 py-2.5 max-w-[200px] truncate text-slate-500 dark:text-slate-400">{b.notes ?? '—'}</td>
                          <td className="px-4 py-2.5">
                            <Link to={`/sourcing/${b.id}`} className="text-xs text-brand hover:underline">View →</Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
          )}

          {/* CPO Bonds tab */}
          {tab === 'bonds' && (
            bonds.length === 0
              ? <p className="py-10 text-center text-sm text-slate-400 dark:text-slate-500">No CPO bonds linked to this vendor.</p>
              : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
                      <tr>
                        {['Bond Ref','Project','Total Amount','Status','Notes'].map(h => (
                          <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50 dark:divide-slate-700/60">
                      {bonds.map(b => (
                        <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors">
                          <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-slate-100">{b.bond_id_ref ?? '—'}</td>
                          <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{b.project ?? '—'}</td>
                          <td className="px-4 py-2.5 tabular-nums font-medium text-slate-800 dark:text-slate-100">{formatCurrency(b.total_bond_amount ?? 0)}</td>
                          <td className="px-4 py-2.5">{b.bond_status ? <StatusBadge value={b.bond_status} /> : '—'}</td>
                          <td className="px-4 py-2.5 max-w-[200px] truncate text-slate-500 dark:text-slate-400">{b.notes ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
          )}

        </div>
      </div>
    </div>
  )
}
