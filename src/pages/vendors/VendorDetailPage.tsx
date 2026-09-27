import { useState, useMemo, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Vendor, Expense, SourcingBundle, CpoBond, VendorAttachment, VendorAttachmentCategory, VendorTaxReceipt } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { PrivateDocLink } from '@/components/shared/PrivateDocLink'
import { useAccounts } from '@/hooks/useLookups'
import { useTabParam } from '@/lib/useTabParam'
import { RecordHeader, RecordTabs, RecordLayout, Panel, FactList, Stat, Pill, type TabDef, type RecordAction } from '@/components/record/Record'
import { useVendorMoney, useCanManageVendors, canVerifyVendor, CHANGE_LABEL, type VendorChange } from '@/lib/vendors'
import {
  Pencil, Phone, Mail, Globe, FileText, Package, Shield, ExternalLink, Plus, Trash2, AlertCircle, FileBadge, ScrollText,
  Upload, Download, Eye, Loader2, PackageCheck, Receipt, ShieldCheck, ShieldAlert, LayoutGrid, Boxes, Truck, Power, GitMerge,
} from 'lucide-react'

// One vendor: what we've paid and owe them, what we buy from them and how
// they deliver, their bank details and whether those have been checked,
// and their papers.

const VR_CHIP: Record<string, { label: string; cls: string }> = {
  pending_verification: { label: 'Awaiting verification', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
  verified:             { label: 'Awaiting tax review',   cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  tax_reviewed:         { label: 'Tax reviewed',          cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  rejected:             { label: 'Rejected',              cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
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

const VENDOR_TABS = ['overview', 'expenses', 'orders', 'items', 'documents', 'bonds'] as const
type Tab = typeof VENDOR_TABS[number]

type ExpenseRow = Pick<Expense, 'id' | 'date' | 'description_of_item' | 'item_service_description' | 'amount_etb' | 'approval_status' | 'receipt_url' | 'receipt_name' | 'expense_code' | 'payment_state'> & { projects?: { project_name: string } | null }

interface DeliveryRow {
  bundle_id: string; bundle_code: string | null; status: string; total_value: number | null
  ordered_at: string | null; expected_delivery_date: string | null; first_received_at: string | null
  days_late: number | null; overdue: boolean; qty_received: number; qty_rejected: number; qty_damaged: number
}
interface ItemBoughtRow {
  item_key: string; stock_item_id: string | null; item_name: string; unit: string | null; times_bought: number
  total_qty: number; total_value: number; last_price: number; min_price: number; max_price: number; last_bought_on: string
}

function StatusBadge({ value }: { value: string }) {
  const color =
    value === 'fulfilled' || value === 'approved' || value === 'Paid' || value === 'finance_approved' || value === 'paid'
      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
    value === 'ordered' || value === 'manager_approved' || value === 'sent'
      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
    value === 'submitted' || value === 'pending' || value === 'advance'
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
    value === 'cancelled' || value === 'rejected'
      ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
    'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize whitespace-nowrap ${color}`}>{value.replace(/_/g, ' ')}</span>
}

const th = 'px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 whitespace-nowrap'

export default function VendorDetailPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const { toast } = useToast()
  const { role, profile } = useAuth()
  const canManage = useCanManageVendors()
  const [tab, setTab] = useTabParam<Tab>(VENDOR_TABS, 'overview')

  const { data: vendor, isLoading } = useQuery<Vendor>({
    queryKey: ['vendor', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('vendors').select('*').eq('id', id!).single()
      if (error) throw error
      return data as Vendor
    },
    enabled: !!id,
  })
  // Resolved from the shared accounts list rather than a join, so this
  // page's ['vendor', id] cache stays the same shape as the edit form's.
  const { data: accountsList = [] } = useAccounts()
  const bankName = (accountsList as { id: string; account_name: string }[]).find(a => a.id === vendor?.bank_id)?.account_name ?? null
  const { data: money } = useVendorMoney(id)

  const { data: expenses = [] } = useQuery<ExpenseRow[]>({
    queryKey: ['vendor-expenses', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('id, date, description_of_item, item_service_description, amount_etb, approval_status, payment_state, receipt_url, receipt_name, expense_code, projects(project_name)')
        .eq('vendor_id', id!)
        .order('date', { ascending: false })
        .limit(1000)
      if (error) throw error
      return data as unknown as ExpenseRow[]
    },
    enabled: !!id,
  })

  const { data: bundles = [] } = useQuery<SourcingBundle[]>({
    queryKey: ['vendor-bundles', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('sourcing_bundles').select('*').eq('vendor_id', id!).order('created_at', { ascending: false }).limit(200)
      if (error) throw error
      return data as SourcingBundle[]
    },
    enabled: !!id,
  })

  const { data: delivery = [] } = useQuery<DeliveryRow[]>({
    queryKey: ['vendor-delivery', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_vendor_po_delivery').select('*').eq('vendor_id', id!)
      if (error) throw error
      return (data ?? []) as DeliveryRow[]
    },
    enabled: !!id,
  })

  const { data: items = [] } = useQuery<ItemBoughtRow[]>({
    queryKey: ['vendor-items', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_vendor_items_bought').select('*').eq('vendor_id', id!).order('total_value', { ascending: false })
      if (error) throw error
      return (data ?? []) as ItemBoughtRow[]
    },
    enabled: !!id,
  })

  const { data: bonds = [] } = useQuery<CpoBond[]>({
    queryKey: ['vendor-bonds', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('cpo_bonds').select('*').eq('vendor_id', id!).order('created_at', { ascending: false }).limit(50)
      if (error) throw error
      return data as CpoBond[]
    },
    enabled: !!id,
  })

  const { data: vendorTaxReceipts = [] } = useQuery({
    queryKey: ['vendor-tax-receipts', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_vendor_tax_receipts').select('*').eq('vendor_id', id!).order('receipt_date', { ascending: false, nullsFirst: false })
      if (error) throw error
      return data as VendorTaxReceipt[]
    },
    enabled: !!id,
  })

  const { data: docs = [] } = useQuery<VendorAttachment[]>({
    queryKey: ['vendor-documents', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('vendor_attachments').select('*').eq('vendor_id', id!).order('created_at', { ascending: false })
      if (error) throw error
      return data as VendorAttachment[]
    },
    enabled: !!id,
  })

  // Who entered / verified the bank details, and what changed.
  const { data: people = [] } = useQuery({
    queryKey: ['vendor-people', vendor?.entered_by, vendor?.verified_by],
    enabled: !!vendor && !!(vendor.entered_by || vendor.verified_by),
    queryFn: async () => {
      const ids = [vendor!.entered_by, vendor!.verified_by].filter(Boolean) as string[]
      const { data, error } = await supabase.from('user_profiles').select('id, full_name, role').in('id', ids)
      if (error) throw error
      return (data ?? []) as { id: string; full_name: string | null; role: string | null }[]
    },
  })
  const { data: changes = [] } = useQuery({
    queryKey: ['vendor-detail-changes', id],
    enabled: !!id && canManage,
    queryFn: async () => {
      const { data, error } = await supabase.from('vendor_detail_changes').select('field, old_value, new_value, changed_at, changed_by').eq('vendor_id', id!).order('changed_at', { ascending: false }).limit(20)
      if (error) throw error
      return (data ?? []).map(c => ({ field: c.field, old: c.old_value, new: c.new_value, at: c.changed_at })) as VendorChange[]
    },
  })

  const deliveryByBundle = useMemo(() => new Map(delivery.map(d => [d.bundle_id, d])), [delivery])
  const [busy, setBusy] = useState(false)

  if (isLoading || !vendor) return (
    <div className="flex items-center justify-center h-64 text-sm text-slate-400 dark:text-slate-500">Loading…</div>
  )

  const live = expenses.filter(e => e.approval_status !== 'rejected')
  const missingReceipts = live.filter(e => !e.receipt_url).length
  const highValue = live.filter(e => Number(e.amount_etb ?? 0) >= 100_000).length
  const sixMonthsAgo = new Date(); sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
  const isEngaged = !!money?.last_used_on && new Date(money.last_used_on) >= sixMonthsAgo

  const pending = vendor.verification_status === 'pending_verification'
  const enteredBy = people.find(p => p.id === vendor.entered_by)
  const verifiedBy = people.find(p => p.id === vendor.verified_by)
  const iCanVerify = pending && canVerifyVendor(role, profile?.id, vendor.entered_by, enteredBy?.role ?? null)

  const expired = docs.filter(d => d.expiry_date && new Date(d.expiry_date) < new Date())
  const expiringSoon = docs.filter(d => {
    if (!d.expiry_date) return false
    const days = Math.ceil((new Date(d.expiry_date).getTime() - Date.now()) / 86400000)
    return days <= 60 && days >= 0
  })

  // Delivery record: first goods received against the expected date.
  const timed = delivery.filter(d => d.days_late != null)
  const onTime = timed.filter(d => (d.days_late ?? 0) <= 0).length
  const late = timed.filter(d => (d.days_late ?? 0) > 0)
  const avgLate = late.length ? late.reduce((s, d) => s + (d.days_late ?? 0), 0) / late.length : 0
  const overdue = delivery.filter(d => d.overdue)
  const recv = delivery.reduce((s, d) => s + Number(d.qty_received), 0)
  const bad = delivery.reduce((s, d) => s + Number(d.qty_rejected) + Number(d.qty_damaged), 0)

  function refresh() {
    for (const k of ['vendor', 'vendors', 'vendor-money', 'unverified-vendor-ids', 'vendor-verification-queue', 'vendor-detail-changes', 'vendor-people']) {
      qc.invalidateQueries({ queryKey: [k] })
    }
  }

  async function verify() {
    setBusy(true)
    const { error } = await supabase.rpc('verify_vendor_record', { p_vendor_id: id })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Bank details verified', 'success')
    refresh()
  }

  async function toggleActive() {
    const next = !vendor!.active
    if (!next && !window.confirm(`Deactivate ${vendor!.vendor_name}? They stop being offered when picking a vendor; their history stays.`)) return
    const { error } = await supabase.from('vendors').update({ active: next }).eq('id', id!)
    if (error) { toast(error.message, 'error'); return }
    toast(next ? 'Vendor reactivated' : 'Vendor deactivated', 'success')
    refresh()
  }

  const tabs: TabDef<Tab>[] = [
    { id: 'overview', label: 'Overview', icon: LayoutGrid },
    { id: 'expenses', label: 'Expenses', icon: FileText, count: live.length },
    { id: 'orders', label: 'Purchase orders', icon: Package, count: bundles.length },
    { id: 'items', label: 'Items bought', icon: Boxes, count: items.length },
    { id: 'documents', label: 'Documents', icon: FileBadge, count: docs.length + vendorTaxReceipts.length },
    { id: 'bonds', label: 'CPO bonds', icon: Shield, count: bonds.length, hidden: bonds.length === 0 },
  ]

  const actions: RecordAction[] = [
    { label: busy ? 'Verifying…' : 'Verify bank details', icon: ShieldCheck, onClick: verify, primary: true, hidden: !iCanVerify, disabled: busy },
    { label: 'Edit', icon: Pencil, to: `/vendors/${id}/edit`, hidden: !canManage },
    { label: 'Generate contract', icon: ScrollText, to: `/vendors/${id}/contract` },
    { label: 'Find duplicates', icon: GitMerge, to: `/vendors/review?tab=duplicates&vendor=${id}`, hidden: !canManage },
    { label: vendor.active ? 'Deactivate' : 'Reactivate', icon: Power, onClick: toggleActive, danger: vendor.active, hidden: !canManage },
  ]

  return (
    <div className="space-y-4 pb-20 sm:pb-0">
      <RecordHeader
        back={{ to: '/vendors', label: 'Vendors' }}
        title={vendor.vendor_name}
        subtitle={[vendor.vendor_type, vendor.category, vendor.location].filter(Boolean).join(' · ') || undefined}
        pills={<>
          {vendor.active ? <Pill tone="green">Active</Pill> : <Pill>Inactive</Pill>}
          {pending ? <Pill tone="red" icon={ShieldAlert}>Bank details not verified</Pill> : <Pill tone="green" icon={ShieldCheck}>Verified</Pill>}
          {vendor.wth_eligible && <Pill tone="violet">WHT</Pill>}
          <Pill tone={isEngaged ? 'blue' : 'slate'}>{isEngaged ? 'Used in last 6 months' : 'Dormant'}</Pill>
        </>}
        meta={[
          ...(vendor.phone_contact ? [{ icon: Phone, value: <a href={`tel:${vendor.phone_contact}`} className="hover:text-brand">{vendor.phone_contact}</a> }] : []),
          ...(money?.last_used_on ? [{ label: 'Last used', value: formatDate(money.last_used_on) }] : []),
        ]}
        actions={actions}
        tabs={<RecordTabs tabs={tabs} active={tab} onChange={setTab} />}
      />

      {tab === 'overview' && (
        <RecordLayout
          main={<>
            {pending && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800/50 dark:bg-red-900/15 space-y-2">
                <p className="flex items-center gap-2 text-sm font-semibold text-red-800 dark:text-red-300">
                  <ShieldAlert className="h-4 w-4" /> TIN or bank details need checking
                </p>
                <p className="text-sm text-red-800/90 dark:text-red-300/90">
                  {enteredBy?.full_name ?? 'Someone'} entered or changed them{vendor.entered_at ? ` on ${formatDate(vendor.entered_at)}` : ''}.
                  Someone from the other department (finance ↔ procurement) has to confirm them against the vendor's documents before paying.
                </p>
                {changes.length > 0 && vendor.entered_at && (
                  <ul className="text-xs text-red-800 dark:text-red-300 space-y-0.5">
                    {changes.filter(c => new Date(c.at) >= new Date(new Date(vendor.entered_at!).getTime() - 60_000)).map((c, i) => (
                      <li key={i}><b>{CHANGE_LABEL[c.field]}</b>: {c.old ? <><span className="line-through opacity-70">{c.old}</span> → </> : ''}{c.new ?? '(removed)'}</li>
                    ))}
                  </ul>
                )}
                {iCanVerify ? (
                  <button onClick={verify} disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60">
                    <ShieldCheck className="h-4 w-4" /> I've checked them — verify
                  </button>
                ) : (
                  <p className="text-xs text-red-700/80 dark:text-red-300/80">
                    {profile?.id === vendor.entered_by ? 'You made this change, so someone else has to verify it.' : 'Verification is done by finance or procurement — whichever didn’t make the change.'}
                  </p>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Paid" value={formatCurrency(money?.paid ?? 0)} sub={money?.sent_awaiting_bank ? `${formatCurrency(money.sent_awaiting_bank)} awaiting bank` : `${money?.expense_count ?? 0} expenses`} />
              <Stat label="Approved, not paid" value={formatCurrency(money?.owed ?? 0)} tone={(money?.owed ?? 0) > 0 ? 'amber' : undefined} />
              <Stat label="Awaiting approval" value={formatCurrency(money?.awaiting_approval ?? 0)} />
              <Stat label="On open orders" value={formatCurrency(money?.committed ?? 0)} sub="not yet an expense" />
            </div>
            {((money?.advances_open ?? 0) > 0 || (money?.credit_left ?? 0) > 0) && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(money?.advances_open ?? 0) > 0 && <Stat label="Advances out" value={formatCurrency(money!.advances_open)} sub="paid before goods" tone="amber" />}
                {(money?.credit_left ?? 0) > 0 && <Stat label="Credit with them" value={formatCurrency(money!.credit_left)} tone="green" />}
              </div>
            )}

            {(highValue > 0 || missingReceipts > 0 || expired.length > 0) && (
              <Panel title="Needs attention" icon={AlertCircle}>
                <ul className="space-y-1.5 text-sm">
                  {missingReceipts > 0 && <li><button onClick={() => setTab('expenses')} className="text-left hover:text-brand">{missingReceipts} expense{missingReceipts === 1 ? '' : 's'} without a receipt</button></li>}
                  {highValue > 0 && <li>{highValue} expense{highValue === 1 ? '' : 's'} of ETB 100,000 or more — <Link to={`/vendors/${id}/contract`} className="text-brand hover:underline">generate a contract</Link></li>}
                  {expired.length > 0 && <li><button onClick={() => setTab('documents')} className="text-left hover:text-brand">{expired.length} document{expired.length === 1 ? '' : 's'} expired</button></li>}
                </ul>
              </Panel>
            )}

            <Panel title="Delivery record" icon={Truck}>
              {delivery.length === 0 ? (
                <p className="text-sm text-slate-400">No purchase orders with this vendor yet.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm">
                  <div><p className="text-[11px] uppercase text-slate-400">On time</p><p className="font-semibold tabular-nums">{timed.length ? `${Math.round((onTime / timed.length) * 100)}%` : '—'}</p><p className="text-[11px] text-slate-400">{onTime} of {timed.length} with a date</p></div>
                  <div><p className="text-[11px] uppercase text-slate-400">When late</p><p className="font-semibold tabular-nums">{late.length ? `${avgLate.toFixed(1)} days` : '—'}</p><p className="text-[11px] text-slate-400">{late.length} late</p></div>
                  <div><p className="text-[11px] uppercase text-slate-400">Overdue now</p><p className={`font-semibold tabular-nums ${overdue.length ? 'text-red-600 dark:text-red-400' : ''}`}>{overdue.length}</p><p className="text-[11px] text-slate-400">ordered, not received</p></div>
                  <div><p className="text-[11px] uppercase text-slate-400">Rejected / damaged</p><p className={`font-semibold tabular-nums ${bad > 0 ? 'text-amber-600 dark:text-amber-400' : ''}`}>{recv ? `${Math.round((bad / recv) * 1000) / 10}%` : '—'}</p><p className="text-[11px] text-slate-400">of units received</p></div>
                </div>
              )}
            </Panel>

            {items.length > 0 && (
              <Panel title="Most bought" icon={Boxes} action={<button onClick={() => setTab('items')} className="text-xs text-brand hover:underline">All {items.length}</button>} padded={false}>
                <ul className="divide-y dark:divide-slate-700">
                  {items.slice(0, 5).map(it => (
                    <li key={it.item_key} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                      <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">{it.item_name}</span>
                      <span className="shrink-0 text-xs text-slate-500 tabular-nums">{formatCurrency(it.last_price)}{it.unit ? `/${it.unit}` : ''} · {it.times_bought}×</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </>}
          rail={<>
            <Panel title="Tax and bank" icon={ShieldCheck}>
              <FactList facts={[
                { label: 'TIN', value: vendor.tin ?? '—', tone: vendor.tin ? undefined : 'amber' },
                { label: 'Bank', value: bankName ?? '—', tone: bankName ? undefined : 'amber' },
                { label: 'Account', value: vendor.bank_account ?? '—', tone: vendor.bank_account ? undefined : 'amber' },
                { label: 'Checked', value: pending ? 'Not yet' : (verifiedBy?.full_name ?? 'Yes'), hint: !pending && vendor.verified_at ? formatDate(vendor.verified_at) : undefined, tone: pending ? 'red' : 'green' },
                { label: 'WHT', value: vendor.wth_eligible ? 'Withheld' : 'Not withheld' },
                ...(vendor.requires_payment_confirmation ? [{ label: 'Release', value: 'Only against proof of payment' }] : []),
                ...(vendor.payment_terms ? [{ label: 'Terms', value: vendor.payment_terms }] : []),
              ]} />
            </Panel>
            <Panel title="Contact">
              {vendor.contact_person || vendor.phone_contact || vendor.email || vendor.address || vendor.website || vendor.location ? (
                <FactList facts={[
                  ...(vendor.contact_person ? [{ label: 'Person', value: vendor.contact_person }] : []),
                  ...(vendor.phone_contact ? [{ label: 'Phone', value: <a href={`tel:${vendor.phone_contact}`} className="text-brand hover:underline inline-flex items-center gap-1"><Phone className="h-3 w-3" />{vendor.phone_contact}</a> }] : []),
                  ...(vendor.email ? [{ label: 'Email', value: <a href={`mailto:${vendor.email}`} className="text-brand hover:underline inline-flex items-center gap-1"><Mail className="h-3 w-3" />{vendor.email}</a> }] : []),
                  ...(vendor.location ? [{ label: 'Location', value: vendor.location }] : []),
                  ...(vendor.address ? [{ label: 'Address', value: vendor.address }] : []),
                  ...(vendor.website ? [{ label: 'Website', value: <a href={vendor.website} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline inline-flex items-center gap-1"><Globe className="h-3 w-3" />Open <ExternalLink className="h-3 w-3" /></a> }] : []),
                ]} />
              ) : (
                <p className="text-sm text-slate-400">No contact details{canManage && <> — <Link to={`/vendors/${id}/edit`} className="text-brand hover:underline">add them</Link></>}.</p>
              )}
            </Panel>
            {vendor.notes && (
              <Panel title="Notes"><p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{vendor.notes}</p></Panel>
            )}
            {canManage && changes.length > 0 && (
              <Panel title="Bank detail history">
                <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                  {changes.map((c, i) => (
                    <li key={i}>
                      <span className="text-slate-400">{formatDate(c.at)}</span> · <b>{CHANGE_LABEL[c.field]}</b>: {c.old ?? '—'} → {c.new ?? '—'}
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
            <p className="px-1 text-[11px] text-slate-400">Added {formatDate(vendor.created_at)}{money?.first_expense_on ? ` · first expense ${formatDate(money.first_expense_on)}` : ''}</p>
          </>}
        />
      )}

      {tab === 'expenses' && <ExpensesTab vendorId={id!} expenses={expenses} />}

      {tab === 'orders' && (
        <Panel title="Purchase orders" icon={Package} count={bundles.length} padded={false}>
          {bundles.length === 0 ? <p className="py-10 text-center text-sm text-slate-400">No purchase orders with this vendor.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
                  <tr>{['PO', 'Status', 'Value', 'Expected', 'Received', 'Rejected / damaged', ''].map(h => <th key={h} className={th}>{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-700/60">
                  {bundles.map(b => {
                    const d = deliveryByBundle.get(b.id)
                    const total = Number(b.total_value ?? 0)
                    return (
                      <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/20">
                        <td className="px-4 py-2.5 font-medium"><Link to={`/sourcing/${b.id}`} className="text-slate-800 dark:text-slate-100 hover:text-brand">{b.bundle_code}</Link></td>
                        <td className="px-4 py-2.5"><StatusBadge value={b.status} /></td>
                        <td className="px-4 py-2.5 tabular-nums whitespace-nowrap">{total > 0 ? formatCurrency(total) : '—'}</td>
                        <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{b.expected_delivery_date ? formatDate(b.expected_delivery_date) : '—'}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          {d?.first_received_at ? (
                            <span className={d.days_late != null && d.days_late > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-600 dark:text-slate-300'}>
                              {formatDate(d.first_received_at)}{d.days_late != null && d.days_late > 0 ? ` · ${d.days_late}d late` : d.days_late != null ? ' · on time' : ''}
                            </span>
                          ) : d?.overdue ? <span className="text-red-600 dark:text-red-400 font-medium">Overdue</span> : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-slate-500">
                          {d && (Number(d.qty_rejected) + Number(d.qty_damaged)) > 0 ? `${Number(d.qty_rejected)} / ${Number(d.qty_damaged)}` : '—'}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <Link to={`/vendors/${id}/contract?bundle_id=${b.id}`}
                            className={`text-xs font-medium hover:underline ${total >= 100_000 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400 hover:text-slate-600'}`}>
                            {total >= 100_000 ? '⚠ Contract' : 'Contract'}
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {tab === 'items' && (
        <Panel title="Items bought" icon={Boxes} count={items.length} padded={false}>
          {items.length === 0 ? <p className="py-10 text-center text-sm text-slate-400">Nothing bought from this vendor through a purchase order yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
                  <tr>{['Item', 'Times', 'Quantity', 'Last price', 'Range', 'Spent', 'Last bought'].map(h => <th key={h} className={th}>{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-700/60">
                  {items.map(it => (
                    <tr key={it.item_key}>
                      <td className="px-4 py-2.5 max-w-[16rem]">
                        {it.stock_item_id
                          ? <Link to={`/stock/${it.stock_item_id}`} className="text-slate-800 dark:text-slate-100 hover:text-brand">{it.item_name}</Link>
                          : <span className="text-slate-700 dark:text-slate-200">{it.item_name}</span>}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">{it.times_bought}</td>
                      <td className="px-4 py-2.5 tabular-nums whitespace-nowrap">{Number(it.total_qty)} {it.unit ?? ''}</td>
                      <td className="px-4 py-2.5 tabular-nums whitespace-nowrap font-medium">{formatCurrency(it.last_price)}</td>
                      <td className="px-4 py-2.5 tabular-nums whitespace-nowrap text-slate-500">
                        {Number(it.min_price) === Number(it.max_price) ? '—' : `${formatCurrency(it.min_price)} – ${formatCurrency(it.max_price)}`}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums whitespace-nowrap">{formatCurrency(it.total_value)}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">{formatDate(it.last_bought_on)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {tab === 'documents' && (
        <DocumentsTab vendorId={id!} docs={docs} taxReceipts={vendorTaxReceipts} expired={expired} expiringSoon={expiringSoon} />
      )}

      {tab === 'bonds' && (
        <Panel title="CPO bonds" icon={Shield} padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
                <tr>{['Bond Ref', 'Project', 'Total Amount', 'Status', 'Notes'].map(h => <th key={h} className={th}>{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-700/60">
                {bonds.map(b => (
                  <tr key={b.id}>
                    <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-slate-100">{b.bond_id_ref ?? '—'}</td>
                    <td className="px-4 py-2.5 text-slate-500">{b.project ?? '—'}</td>
                    <td className="px-4 py-2.5 tabular-nums font-medium">{formatCurrency(b.total_bond_amount ?? 0)}</td>
                    <td className="px-4 py-2.5">{b.bond_status ? <StatusBadge value={b.bond_status} /> : '—'}</td>
                    <td className="px-4 py-2.5 max-w-[200px] truncate text-slate-500">{b.notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  )
}

// ── Expenses ───────────────────────────────────────────────────────────────
function ExpensesTab({ vendorId, expenses }: { vendorId: string; expenses: ExpenseRow[] }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const [uploadingFor, setUploadingFor] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [showRejected, setShowRejected] = useState(false)
  const rows = showRejected ? expenses : expenses.filter(e => e.approval_status !== 'rejected')
  const rejectedCount = expenses.length - expenses.filter(e => e.approval_status !== 'rejected').length
  const total = rows.filter(e => e.approval_status !== 'rejected').reduce((s, e) => s + Number(e.amount_etb ?? 0), 0)
  const missing = rows.filter(e => e.approval_status !== 'rejected' && !e.receipt_url).length
  const selectedTotal = selected.reduce((s, eid) => s + Number(expenses.find(e => e.id === eid)?.amount_etb ?? 0), 0)

  async function uploadReceipt(expenseId: string, file: File) {
    setUploadingFor(expenseId)
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `uploads/${Date.now()}-${safeName}`
    const { error: upErr } = await supabase.storage.from('documents').upload(path, file, { upsert: true })
    if (upErr) { toast(`Upload failed: ${upErr.message}`, 'error'); setUploadingFor(null); return }
    const { data: { publicUrl } } = supabase.storage.from('documents').getPublicUrl(path)
    const { error: dbErr } = await supabase.from('expenses').update({ receipt_url: publicUrl, receipt_name: file.name }).eq('id', expenseId)
    setUploadingFor(null)
    if (dbErr) { toast(`Save failed: ${dbErr.message}`, 'error'); return }
    qc.invalidateQueries({ queryKey: ['vendor-expenses', vendorId] })
    toast('Receipt uploaded', 'success')
  }

  return (
    <Panel title="Expenses" icon={FileText} count={rows.length} padded={false}
      action={rejectedCount > 0 ? (
        <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
          <input type="checkbox" checked={showRejected} onChange={e => setShowRejected(e.target.checked)} /> Show {rejectedCount} rejected
        </label>
      ) : undefined}>
      {missing > 0 && (
        <div className="flex items-center gap-2 border-b dark:border-slate-700 px-4 py-2.5 bg-rose-50 dark:bg-rose-900/10">
          <AlertCircle className="h-3.5 w-3.5 text-rose-500 flex-shrink-0" />
          <p className="text-xs text-rose-600 dark:text-rose-400">{missing} expense{missing !== 1 ? 's' : ''} missing a receipt — click <strong>Upload</strong> to attach.</p>
        </div>
      )}
      {rows.length === 0 ? <p className="py-10 text-center text-sm text-slate-400">No expenses linked to this vendor.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
              <tr>
                <th className="px-3 py-2.5 w-8">
                  <input type="checkbox" checked={selected.length === rows.length && rows.length > 0}
                    onChange={() => setSelected(s => s.length === rows.length ? [] : rows.map(e => e.id))} />
                </th>
                {['Date', 'Description', 'Project', 'Amount', 'Approval', 'Payment', 'Receipt', ''].map(h => <th key={h} className={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-700/60">
              {rows.map(e => {
                const hasReceipt = !!e.receipt_url
                const amount = Number(e.amount_etb ?? 0)
                const isSel = selected.includes(e.id)
                const desc = e.description_of_item || e.item_service_description || '—'
                const rejected = e.approval_status === 'rejected'
                return (
                  <tr key={e.id} className={`${rejected ? 'opacity-60' : ''} ${isSel ? 'bg-blue-50/40 dark:bg-blue-900/10' : !hasReceipt && !rejected ? 'bg-rose-50/30 dark:bg-rose-900/5' : 'hover:bg-slate-50 dark:hover:bg-slate-700/20'}`}>
                    <td className="px-3 py-2.5 w-8">
                      <input type="checkbox" checked={isSel} onChange={() => setSelected(s => s.includes(e.id) ? s.filter(i => i !== e.id) : [...s, e.id])} />
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">{e.date ? formatDate(e.date) : '—'}</td>
                    <td className="px-4 py-2.5 max-w-[220px]">
                      <Link to={`/expenses/${e.id}`} className="block truncate text-slate-800 dark:text-slate-100 hover:text-brand hover:underline" title={desc}>{desc}</Link>
                      {e.expense_code && <span className="text-[10px] text-slate-400 font-mono">{e.expense_code}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">{e.projects?.project_name ?? '—'}</td>
                    <td className="px-4 py-2.5 tabular-nums font-medium whitespace-nowrap">
                      {formatCurrency(amount)}
                      {amount >= 100_000 && <span className="ml-1.5 rounded bg-amber-100 dark:bg-amber-900/30 px-1 text-[9px] font-bold text-amber-700 dark:text-amber-400">100K+</span>}
                    </td>
                    <td className="px-4 py-2.5"><StatusBadge value={e.approval_status} /></td>
                    <td className="px-4 py-2.5">{e.payment_state ? <StatusBadge value={e.payment_state} /> : '—'}</td>
                    <td className="px-4 py-2.5">
                      {uploadingFor === e.id ? (
                        <span className="flex items-center gap-1 text-xs text-slate-400"><Loader2 className="h-3 w-3 animate-spin" /> Uploading…</span>
                      ) : hasReceipt ? (
                        <a href={e.receipt_url!} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-brand hover:underline">
                          <FileText className="h-3 w-3" />{e.receipt_name ?? 'View'}
                        </a>
                      ) : (
                        <button onClick={() => fileInputRefs.current[e.id]?.click()} className="flex items-center gap-1 text-xs text-rose-500 hover:text-brand font-medium">
                          <Upload className="h-3 w-3" /> Upload
                        </button>
                      )}
                      <input ref={el => { fileInputRefs.current[e.id] = el }} type="file" accept="image/*,application/pdf,.doc,.docx" className="hidden"
                        onChange={ev => { const f = ev.target.files?.[0]; if (f) uploadReceipt(e.id, f); ev.target.value = '' }} />
                    </td>
                    <td className="px-4 py-2.5"><Link to={`/expenses/${e.id}`} className="text-slate-400 hover:text-brand" title="View expense"><Eye className="h-3.5 w-3.5" /></Link></td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/60">
                <td />
                <td colSpan={3} className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Total (not rejected)</td>
                <td className="px-4 py-2.5 tabular-nums font-bold">{formatCurrency(total)}</td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {selected.length > 0 && (
        <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t dark:border-slate-700 bg-white/95 dark:bg-slate-800/95 backdrop-blur px-4 py-3">
          <div className="text-sm text-slate-700 dark:text-slate-200">
            <span className="font-semibold">{selected.length}</span> selected{selectedTotal > 0 && <span className="ml-2 text-slate-500">— {formatCurrency(selectedTotal)}</span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setSelected([])} className="text-xs text-slate-400 hover:text-slate-600">Clear</button>
            <Link to={`/vendors/${vendorId}/contract?expense_ids=${selected.join(',')}`} onClick={() => setSelected([])}
              className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
              <ScrollText className="h-4 w-4" /> Compose Contract
            </Link>
          </div>
        </div>
      )}
    </Panel>
  )
}

// ── Documents ──────────────────────────────────────────────────────────────
function DocumentsTab({ vendorId, docs, taxReceipts, expired, expiringSoon }: {
  vendorId: string; docs: VendorAttachment[]; taxReceipts: VendorTaxReceipt[]; expired: VendorAttachment[]; expiringSoon: VendorAttachment[]
}) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const docFileRef = useRef<HTMLInputElement>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [category, setCategory] = useState<VendorAttachmentCategory>('other')
  const [notes, setNotes] = useState('')
  const [expiry, setExpiry] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const inCls = 'w-full rounded-md border dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand'

  async function uploadDoc(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    for (const file of Array.from(files)) {
      const path = `${vendorId}/${Date.now()}_${file.name.replace(/\s+/g, '_')}`
      const { error: storageErr } = await supabase.storage.from('vendor-documents').upload(path, file, { upsert: false })
      if (storageErr) { toast(`Upload failed: ${storageErr.message}`, 'error'); setUploading(false); return }
      const { error: dbErr } = await supabase.from('vendor_attachments').insert([{
        vendor_id: vendorId, file_name: file.name, file_path: path, file_size: file.size, mime_type: file.type || null,
        category, notes: notes.trim() || null, expiry_date: expiry || null,
      }])
      if (dbErr) { toast(`Metadata error: ${dbErr.message}`, 'error'); setUploading(false); return }
    }
    setUploading(false); setNotes(''); setExpiry(''); setShowAdd(false)
    qc.invalidateQueries({ queryKey: ['vendor-documents', vendorId] })
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
    qc.invalidateQueries({ queryKey: ['vendor-documents', vendorId] })
  }

  return (
    <div className="space-y-4">
      {taxReceipts.length > 0 && (
        <Panel title="Tax receipts" icon={Receipt} count={taxReceipts.length} padded={false}>
          <div className="divide-y dark:divide-slate-700">
            {taxReceipts.map(r => (
              <div key={r.id} className="flex items-start gap-3 px-4 py-3">
                <Receipt className="h-4 w-4 text-brand shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{r.receipt_no ?? r.document_name ?? 'Receipt'}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${VR_CHIP[r.status]?.cls ?? ''}`}>{VR_CHIP[r.status]?.label ?? r.status}</span>
                    <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${r.physical_received_at ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                      <PackageCheck className="h-3 w-3" />{r.physical_received_at ? 'Paper in' : 'Paper not received'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {r.receipt_date ? formatDate(r.receipt_date) : 'No receipt date'}
                    {r.vat_amount != null ? ` · VAT ${formatCurrency(Number(r.vat_amount))}` : ' · No VAT recorded'}
                    {r.expense_code ? ` · ${r.expense_code}` : ''}{r.project_name ? ` · ${r.project_name}` : ''}
                  </p>
                </div>
                {r.document_path && <PrivateDocLink path={r.document_path} bucket={r.document_bucket} title="View receipt" />}
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel title="Licences and certificates" icon={FileBadge} count={docs.length}
        action={!showAdd ? <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"><Plus className="h-3.5 w-3.5" /> Add</button> : undefined}>
        <div className="space-y-3">
          {(expired.length > 0 || expiringSoon.length > 0) && (
            <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-2.5 space-y-1 text-xs font-medium">
              {expired.length > 0 && <p className="text-red-600 dark:text-red-400">{expired.length} document{expired.length !== 1 ? 's' : ''} expired</p>}
              {expiringSoon.length > 0 && <p className="text-amber-700 dark:text-amber-400">{expiringSoon.length} expiring within 60 days</p>}
            </div>
          )}
          {showAdd && (
            <div className="rounded-xl border dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-4 space-y-3">
              <div className="flex gap-2 flex-wrap">
                {VENDOR_CATEGORIES.map(cat => (
                  <button key={cat.value} onClick={() => setCategory(cat.value)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${category === cat.value ? 'text-white shadow-sm' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200'}`}
                    style={category === cat.value ? { backgroundColor: cat.color } : undefined}>
                    {cat.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Notes (optional)</label>
                  <input type="text" placeholder="e.g. Renewed Jan 2025" value={notes} onChange={e => setNotes(e.target.value)} className={inCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Expiry Date</label>
                  <input type="date" value={expiry} onChange={e => setExpiry(e.target.value)} className={inCls} />
                </div>
              </div>
              <div
                className={`rounded-xl border-2 border-dashed transition-colors cursor-pointer ${dragOver ? 'border-brand bg-brand/5' : 'border-slate-200 dark:border-slate-600 hover:border-brand/50'}`}
                onClick={() => docFileRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); uploadDoc(e.dataTransfer.files) }}>
                <div className="flex flex-col items-center justify-center py-8 px-4 text-center pointer-events-none">
                  {uploading ? <p className="text-sm text-slate-500 animate-pulse">Uploading…</p> : (<>
                    <Upload className="h-8 w-8 text-slate-300 dark:text-slate-500 mb-2" />
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Drop files here or click to browse</p>
                    <p className="text-xs text-slate-400 mt-1">PDF, images, Word documents</p>
                  </>)}
                </div>
                <input ref={docFileRef} type="file" className="hidden" multiple accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" onChange={e => uploadDoc(e.target.files)} />
              </div>
              <button onClick={() => setShowAdd(false)} className="rounded-md border dark:border-slate-600 px-4 py-1.5 text-sm text-slate-600 dark:text-slate-300">Cancel</button>
            </div>
          )}
          {docs.length === 0 && !showAdd ? (
            <p className="py-4 text-center text-sm text-slate-400">No documents yet — add the business licence, trade registration, TIN and VAT certificates.</p>
          ) : docs.map(doc => {
            const isExpired = !!doc.expiry_date && new Date(doc.expiry_date) < new Date()
            const daysLeft = doc.expiry_date ? Math.ceil((new Date(doc.expiry_date).getTime() - Date.now()) / 86400000) : null
            const cat = VENDOR_CATEGORIES.find(c => c.value === doc.category)
            return (
              <div key={doc.id} className={`flex items-start gap-3 rounded-xl border p-3 ${isExpired ? 'border-red-200 dark:border-red-800 bg-red-50/40 dark:bg-red-900/10' : 'border-slate-200 dark:border-slate-700'}`}>
                <FileBadge className="h-5 w-5 text-brand flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-slate-800 dark:text-slate-100 break-all">{doc.file_name}</span>
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: cat?.color ?? '#6B7280' }}>{cat?.label ?? doc.category}</span>
                    {isExpired && <span className="rounded-full bg-red-100 dark:bg-red-900/30 px-2 py-0.5 text-[10px] font-bold text-red-600">EXPIRED</span>}
                    {!isExpired && daysLeft !== null && daysLeft <= 60 && <span className="rounded-full bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 text-[10px] font-bold text-amber-700">Expires in {daysLeft}d</span>}
                  </div>
                  {doc.expiry_date && <p className="text-xs text-slate-400 mt-0.5">Expiry: {formatDate(doc.expiry_date)}</p>}
                  {doc.notes && <p className="text-xs text-slate-500 mt-0.5">{doc.notes}</p>}
                  <button onClick={() => openAttachment(doc.file_path)} className="mt-1 inline-flex items-center gap-1 text-xs text-brand hover:underline">
                    <Download className="h-3 w-3" /> Download
                  </button>
                </div>
                <button onClick={() => deleteAttachment(doc)} className="flex-shrink-0 rounded p-1 text-slate-300 hover:text-red-500" title="Delete">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      </Panel>
    </div>
  )
}
