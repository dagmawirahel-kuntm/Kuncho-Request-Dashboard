import { useState, useMemo, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Vendor, Expense, SourcingBundle, CpoBond, VendorAttachment, VendorAttachmentCategory, SourcingBundleItem } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import {
  ArrowLeft, Pencil, Phone, Mail, MapPin, Globe, User, CreditCard,
  FileText, Package, Shield, Check, X, Building2, Tag, ExternalLink,
  Plus, Trash2, AlertCircle, FileBadge, ScrollText, Upload, Download,
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

const VENDOR_CATEGORIES: { value: VendorAttachmentCategory; label: string; color: string }[] = [
  { value: 'business_license',   label: 'Business License',   color: '#3B82F6' },
  { value: 'trade_registration', label: 'Trade Registration', color: '#10B981' },
  { value: 'tin_certificate',    label: 'TIN Certificate',    color: '#F59E0B' },
  { value: 'vat_certificate',    label: 'VAT Certificate',    color: '#EF4444' },
  { value: 'contract',           label: 'Contract',           color: '#8B5CF6' },
  { value: 'insurance',          label: 'Insurance',          color: '#06B6D4' },
  { value: 'other',              label: 'Other',              color: '#6B7280' },
]

type Tab = 'expenses' | 'sourcing' | 'bonds' | 'documents'

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
    value === 'fulfilled' || value === 'approved' || value === 'Paid' || value === 'finance_approved'
      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
    value === 'ordered' || value === 'manager_approved'
      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
    value === 'submitted'
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
    value === 'cancelled' || value === 'rejected'
      ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
    'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${color}`}>{value.replace(/_/g, ' ')}</span>
}

export default function VendorDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('expenses')
  const { toast } = useToast()
  const docFileRef = useRef<HTMLInputElement>(null)
  const [showAddDoc, setShowAddDoc] = useState(false)
  const [uploadingDoc, setUploadingDoc] = useState(false)
  const [docCategory, setDocCategory] = useState<VendorAttachmentCategory>('other')
  const [docNotes, setDocNotes] = useState('')
  const [docExpiry, setDocExpiry] = useState('')
  const [dragOver, setDragOver] = useState(false)

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
        .select('id, date, description_of_item, amount_etb, approval_status, receipt_url, receipt_name, projects(project_name)')
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

  const bundleIds = useMemo(() => bundles.map(b => b.id), [bundles])

  const { data: allBundleItems = [] } = useQuery<SourcingBundleItem[]>({
    queryKey: ['vendor-bundle-items', id, bundleIds.join(',')],
    queryFn: async () => {
      if (!bundleIds.length) return []
      const { data, error } = await supabase
        .from('sourcing_bundle_items')
        .select('bundle_id, quantity_actual, unit_price_actual')
        .in('bundle_id', bundleIds)
      if (error) throw error
      return data as SourcingBundleItem[]
    },
    enabled: !!id && bundleIds.length > 0,
  })

  const bundleTotals = useMemo(() => {
    const map: Record<string, number> = {}
    allBundleItems.forEach(item => {
      const t = (item.quantity_actual ?? 0) * (item.unit_price_actual ?? 0)
      map[item.bundle_id] = (map[item.bundle_id] ?? 0) + t
    })
    return map
  }, [allBundleItems])

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

  const { data: docs = [] } = useQuery<VendorAttachment[]>({
    queryKey: ['vendor-documents', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vendor_attachments')
        .select('*')
        .eq('vendor_id', id!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as VendorAttachment[]
    },
    enabled: !!id,
  })

  if (isLoading || !vendor) return (
    <div className="flex items-center justify-center h-64 text-sm text-slate-400 dark:text-slate-500">Loading…</div>
  )

  const totalSpend = expenses.reduce((s, e) => s + Number((e as any).amount_etb ?? 0), 0)
  const missingReceipts = expenses.filter(e => !(e as any).receipt_url).length
  const highValueExpenses = expenses.filter(e => Number((e as any).amount_etb ?? 0) >= 100_000)
  const color = vendorColor(vendor.vendor_name)
  const initials = vendorInitials(vendor.vendor_name)

  const expiringSoon = docs.filter(d => {
    if (!d.expiry_date) return false
    const days = Math.ceil((new Date(d.expiry_date).getTime() - Date.now()) / 86400000)
    return days <= 60 && days >= 0
  })
  const expired = docs.filter(d => {
    if (!d.expiry_date) return false
    return new Date(d.expiry_date) < new Date()
  })

  const TABS: { key: Tab; label: string; count: number; icon: React.ReactNode; badge?: string }[] = [
    { key: 'expenses', label: 'Expenses', count: expenses.length, icon: <FileText className="h-3.5 w-3.5" />,
      badge: missingReceipts > 0 ? String(missingReceipts) : undefined },
    { key: 'sourcing', label: 'Sourcing Bundles', count: bundles.length, icon: <Package className="h-3.5 w-3.5" /> },
    { key: 'bonds',    label: 'CPO Bonds',        count: bonds.length,   icon: <Shield className="h-3.5 w-3.5" /> },
    { key: 'documents', label: 'Documents', count: docs.length, icon: <FileBadge className="h-3.5 w-3.5" />,
      badge: (expired.length + expiringSoon.length) > 0 ? '!' : undefined },
  ]

  async function uploadDoc(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploadingDoc(true)
    for (const file of Array.from(files)) {
      const path = `${id}/${Date.now()}_${file.name.replace(/\s+/g, '_')}`
      const { error: storageErr } = await supabase.storage.from('vendor-documents').upload(path, file, { upsert: false })
      if (storageErr) { toast(`Upload failed: ${storageErr.message}`, 'error'); setUploadingDoc(false); return }
      const { error: dbErr } = await supabase.from('vendor_attachments').insert([{
        vendor_id: id!,
        file_name: file.name,
        file_path: path,
        file_size: file.size,
        mime_type: file.type || null,
        category: docCategory,
        notes: docNotes.trim() || null,
        expiry_date: docExpiry || null,
      }])
      if (dbErr) { toast(`Metadata error: ${dbErr.message}`, 'error'); setUploadingDoc(false); return }
    }
    setUploadingDoc(false); setDocNotes(''); setDocExpiry(''); setShowAddDoc(false)
    qc.invalidateQueries({ queryKey: ['vendor-documents', id] })
    toast(`${files.length} file${files.length > 1 ? 's' : ''} uploaded`, 'success')
  }

  async function openAttachment(filePath: string) {
    const { data, error } = await supabase.storage.from('vendor-documents').createSignedUrl(filePath, 60)
    if (error || !data?.signedUrl) { toast('Could not open file', 'error'); return }
    window.open(data.signedUrl, '_blank')
  }

  async function deleteAttachment(att: VendorAttachment) {
    if (!confirm('Delete this document?')) return
    await supabase.storage.from('vendor-documents').remove([att.file_path])
    await supabase.from('vendor_attachments').delete().eq('id', att.id)
    qc.invalidateQueries({ queryKey: ['vendor-documents', id] })
  }

  const inCls = 'w-full rounded-md border dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand'

  return (
    <div className="space-y-5">
      {/* Top nav */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <button onClick={() => navigate('/vendors')}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Vendors
        </button>
        <div className="flex items-center gap-2">
          <Link to={`/vendors/${id}/contract`}
            className="inline-flex items-center gap-1.5 rounded-lg border dark:border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700">
            <ScrollText className="h-3.5 w-3.5" /> Generate Contract
          </Link>
          <Link to={`/vendors/${id}/edit`}
            className="inline-flex items-center gap-1.5 rounded-lg border dark:border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700">
            <Pencil className="h-3.5 w-3.5" /> Edit Profile
          </Link>
        </div>
      </div>

      {/* Alerts for high-value or missing receipts */}
      {(highValueExpenses.length > 0 || missingReceipts > 0) && (
        <div className="space-y-2">
          {highValueExpenses.length > 0 && (
            <div className="flex items-center gap-2.5 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-2.5">
              <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
              <p className="text-sm text-amber-800 dark:text-amber-300">
                <strong>{highValueExpenses.length}</strong> expense{highValueExpenses.length !== 1 ? 's' : ''} ≥ ETB 100,000 with this vendor.
                {' '}<Link to={`/vendors/${id}/contract`} className="underline font-medium">Generate a contract →</Link>
              </p>
            </div>
          )}
          {missingReceipts > 0 && (
            <div className="flex items-center gap-2.5 rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 px-4 py-2.5">
              <AlertCircle className="h-4 w-4 text-rose-500 dark:text-rose-400 flex-shrink-0" />
              <p className="text-sm text-rose-700 dark:text-rose-300">
                <strong>{missingReceipts}</strong> expense{missingReceipts !== 1 ? 's' : ''} missing a receipt attachment. Click the Expenses tab to review.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Hero card ── */}
      <div className="rounded-2xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
        <div className="h-2" style={{ backgroundColor: color }} />
        <div className="px-6 py-5 flex items-start gap-5 flex-wrap">
          <div className="h-16 w-16 rounded-2xl flex items-center justify-center text-2xl font-black text-white shadow-md flex-shrink-0"
            style={{ backgroundColor: color }}>
            {initials}
          </div>
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
        <div className="flex border-b dark:border-slate-700 overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                tab === t.key
                  ? 'border-brand text-brand dark:text-brand'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              {t.icon}{t.label}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                t.badge ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
              }`}>
                {t.badge ?? t.count}
              </span>
            </button>
          ))}
        </div>

        <div className="p-0">

          {/* Expenses tab */}
          {tab === 'expenses' && (
            <div>
              {missingReceipts > 0 && (
                <div className="flex items-center gap-2 border-b dark:border-slate-700 px-4 py-2.5 bg-rose-50 dark:bg-rose-900/10">
                  <AlertCircle className="h-3.5 w-3.5 text-rose-500 flex-shrink-0" />
                  <p className="text-xs text-rose-600 dark:text-rose-400">
                    {missingReceipts} expenses are missing receipt attachments — edit each to attach the receipt.
                  </p>
                </div>
              )}
              {expenses.length === 0
                ? <p className="py-10 text-center text-sm text-slate-400 dark:text-slate-500">No expenses linked to this vendor.</p>
                : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
                        <tr>
                          {['Date','Description','Project','Amount','Status','Receipt',''].map(h => (
                            <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50 dark:divide-slate-700/60">
                        {expenses.map(e => {
                          const hasReceipt = !!(e as any).receipt_url
                          const amount = Number((e as any).amount_etb ?? 0)
                          return (
                            <tr key={e.id} className={`hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors ${!hasReceipt ? 'bg-rose-50/30 dark:bg-rose-900/5' : ''}`}>
                              <td className="px-4 py-2.5 whitespace-nowrap text-slate-500 dark:text-slate-400">{e.date ? formatDate(e.date) : '—'}</td>
                              <td className="px-4 py-2.5 max-w-[220px] truncate text-slate-800 dark:text-slate-100">{(e as any).description_of_item || '—'}</td>
                              <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{(e as any).projects?.project_name ?? '—'}</td>
                              <td className="px-4 py-2.5 tabular-nums font-medium text-slate-800 dark:text-slate-100">
                                {formatCurrency(amount)}
                                {amount >= 100_000 && <span className="ml-1.5 rounded bg-amber-100 dark:bg-amber-900/30 px-1 text-[9px] font-bold text-amber-700 dark:text-amber-400">100K+</span>}
                              </td>
                              <td className="px-4 py-2.5"><StatusBadge value={e.approval_status} /></td>
                              <td className="px-4 py-2.5">
                                {hasReceipt ? (
                                  <a href={(e as any).receipt_url} target="_blank" rel="noopener noreferrer"
                                    className="flex items-center gap-1 text-xs text-brand hover:underline">
                                    <FileText className="h-3 w-3" />{(e as any).receipt_name ?? 'View'}
                                  </a>
                                ) : (
                                  <span className="flex items-center gap-1 text-xs text-rose-500">
                                    <AlertCircle className="h-3 w-3" />Missing
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2.5">
                                <Link to={`/expenses/${e.id}/edit`} className="text-xs text-slate-400 hover:text-brand">Edit</Link>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/60">
                          <td colSpan={3} className="px-4 py-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Total</td>
                          <td className="px-4 py-2.5 tabular-nums font-bold text-slate-800 dark:text-slate-100">{formatCurrency(totalSpend)}</td>
                          <td colSpan={3} className="px-4 py-2.5 text-xs text-rose-500">
                            {missingReceipts > 0 && `${missingReceipts} missing receipt${missingReceipts !== 1 ? 's' : ''}`}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
            </div>
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
                        {['Bundle','Status','Total Value','Submitted','Expected','Notes',''].map(h => (
                          <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50 dark:divide-slate-700/60">
                      {bundles.map(b => {
                        const total = bundleTotals[b.id] ?? 0
                        return (
                          <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors">
                            <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-slate-100">{b.bundle_code}</td>
                            <td className="px-4 py-2.5"><StatusBadge value={b.status} /></td>
                            <td className="px-4 py-2.5 tabular-nums font-medium text-slate-800 dark:text-slate-100">
                              {total > 0 ? (
                                <>
                                  {formatCurrency(total)}
                                  {total >= 100_000 && <span className="ml-1.5 rounded bg-amber-100 dark:bg-amber-900/30 px-1 text-[9px] font-bold text-amber-700 dark:text-amber-400">100K+</span>}
                                </>
                              ) : '—'}
                            </td>
                            <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{b.submitted_at ? formatDate(b.submitted_at) : '—'}</td>
                            <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{b.expected_delivery_date ? formatDate(b.expected_delivery_date) : '—'}</td>
                            <td className="px-4 py-2.5 max-w-[180px] truncate text-slate-500 dark:text-slate-400">{b.notes ?? '—'}</td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2">
                                <Link to={`/sourcing/${b.id}`} className="text-xs text-brand hover:underline">View</Link>
                                <Link
                                  to={`/vendors/${id}/contract?bundle_id=${b.id}`}
                                  className={`text-xs font-medium hover:underline ${total >= 100_000 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'}`}
                                >
                                  {total >= 100_000 ? '⚠ Contract' : 'Contract'}
                                </Link>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
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

          {/* Documents tab */}
          {tab === 'documents' && (
            <div className="p-4 space-y-4">
              {(expired.length > 0 || expiringSoon.length > 0) && (
                <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 space-y-1">
                  {expired.length > 0 && (
                    <p className="text-xs font-medium text-red-600 dark:text-red-400 flex items-center gap-1.5">
                      <AlertCircle className="h-3.5 w-3.5" />
                      {expired.length} document{expired.length !== 1 ? 's' : ''} expired
                    </p>
                  )}
                  {expiringSoon.length > 0 && (
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                      <AlertCircle className="h-3.5 w-3.5" />
                      {expiringSoon.length} document{expiringSoon.length !== 1 ? 's' : ''} expiring within 60 days
                    </p>
                  )}
                </div>
              )}

              {/* Upload area */}
              {showAddDoc ? (
                <div className="rounded-xl border dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-4 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Upload Document</p>
                  <div className="flex gap-2 flex-wrap">
                    {VENDOR_CATEGORIES.map(cat => (
                      <button key={cat.value} onClick={() => setDocCategory(cat.value)}
                        className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${docCategory === cat.value ? 'text-white shadow-sm' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200'}`}
                        style={docCategory === cat.value ? { backgroundColor: cat.color } : undefined}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Notes (optional)</label>
                      <input type="text" placeholder="e.g. Renewed Jan 2025" value={docNotes}
                        onChange={e => setDocNotes(e.target.value)} className={inCls} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Expiry Date</label>
                      <input type="date" value={docExpiry} onChange={e => setDocExpiry(e.target.value)} className={inCls} />
                    </div>
                  </div>
                  <div
                    className={`rounded-xl border-2 border-dashed transition-colors cursor-pointer ${dragOver ? 'border-brand bg-brand/5' : 'border-slate-200 dark:border-slate-600 hover:border-brand/50 hover:bg-slate-50 dark:hover:bg-slate-700/30'}`}
                    onClick={() => docFileRef.current?.click()}
                    onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={e => { e.preventDefault(); setDragOver(false); uploadDoc(e.dataTransfer.files) }}
                  >
                    <div className="flex flex-col items-center justify-center py-8 px-4 text-center pointer-events-none">
                      {uploadingDoc ? (
                        <p className="text-sm text-slate-500 animate-pulse">Uploading…</p>
                      ) : (
                        <>
                          <Upload className="h-8 w-8 text-slate-300 dark:text-slate-500 mb-2" />
                          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Drop files here or click to browse</p>
                          <p className="text-xs text-slate-400 mt-1">PDF, images, Word documents</p>
                        </>
                      )}
                    </div>
                    <input ref={docFileRef} type="file" className="hidden" multiple
                      accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" onChange={e => uploadDoc(e.target.files)} />
                  </div>
                  <button onClick={() => setShowAddDoc(false)}
                    className="rounded-md border dark:border-slate-600 px-4 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">
                    Cancel
                  </button>
                </div>
              ) : (
                <button onClick={() => setShowAddDoc(true)}
                  className="flex items-center gap-1.5 rounded-lg border dark:border-slate-600 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">
                  <Plus className="h-4 w-4" /> Add Document
                </button>
              )}

              {/* Document list */}
              {docs.length === 0 && !showAddDoc ? (
                <p className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">No documents uploaded yet — add licenses, trade registrations, and certificates.</p>
              ) : (
                <div className="space-y-2">
                  {docs.map(doc => {
                    const isExpired = doc.expiry_date && new Date(doc.expiry_date) < new Date()
                    const daysLeft = doc.expiry_date
                      ? Math.ceil((new Date(doc.expiry_date).getTime() - Date.now()) / 86400000)
                      : null
                    const cat = VENDOR_CATEGORIES.find(c => c.value === doc.category)

                    return (
                      <div key={doc.id} className={`flex items-start gap-3 rounded-xl border p-4 ${isExpired ? 'border-red-200 dark:border-red-800 bg-red-50/40 dark:bg-red-900/10' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'}`}>
                        <FileBadge className="h-5 w-5 text-brand flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm text-slate-800 dark:text-slate-100">{doc.file_name}</span>
                            <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                              style={{ backgroundColor: cat?.color ?? '#6B7280' }}>
                              {cat?.label ?? doc.category}
                            </span>
                            {isExpired && <span className="rounded-full bg-red-100 dark:bg-red-900/30 px-2 py-0.5 text-[10px] font-bold text-red-600 dark:text-red-400">EXPIRED</span>}
                            {!isExpired && daysLeft !== null && daysLeft <= 60 && (
                              <span className="rounded-full bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-400">Expires in {daysLeft}d</span>
                            )}
                          </div>
                          {doc.expiry_date && (
                            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Expiry: {formatDate(doc.expiry_date)}</p>
                          )}
                          {doc.notes && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{doc.notes}</p>}
                          <button onClick={() => openAttachment(doc.file_path)}
                            className="mt-1 inline-flex items-center gap-1 text-xs text-brand hover:underline">
                            <Download className="h-3 w-3" /> Download
                          </button>
                        </div>
                        <button onClick={() => deleteAttachment(doc)}
                          className="flex-shrink-0 rounded p-1 text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400" title="Delete">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
