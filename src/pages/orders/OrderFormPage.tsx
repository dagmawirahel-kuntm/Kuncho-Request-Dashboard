import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { MultiSelect } from '@/components/shared/MultiSelect'
import { StatusBadge } from '@/components/shared/StatusBadge'
import type { Order, OrderInsert, OrderPriority } from '@/types/database'
import {
  useProjects, useStaff, useCategories, useVendors,
  useExpensesList, useUserProfiles, useProducts, useRecentOrderItems,
} from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { canApproveAsManager, canApproveAsFinance } from '@/lib/expenseAccess'
import { formatDate, formatCurrency } from '@/lib/utils'
import { Search, Package, History, AlertTriangle, Zap, ChevronRight } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'
const sectionCls = 'rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-3'

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

function SectionHeader({ icon, title, sub }: { icon: React.ReactNode; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2 pb-1 border-b dark:border-slate-700 mb-3">
      <span className="text-brand">{icon}</span>
      <div>
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</p>
        {sub && <p className="text-xs text-slate-400">{sub}</p>}
      </div>
    </div>
  )
}

const PRIORITY_OPTS: { value: OrderPriority; label: string; color: string }[] = [
  { value: 'normal',   label: 'Normal',   color: 'text-slate-600 bg-slate-100 dark:bg-slate-700' },
  { value: 'urgent',   label: 'Urgent',   color: 'text-amber-700 bg-amber-50 dark:bg-amber-900/30' },
  { value: 'critical', label: 'Critical', color: 'text-red-700 bg-red-50 dark:bg-red-900/30' },
]

const COMMON_UNITS = ['pcs', 'kg', 'liters', 'meters', 'boxes', 'bags', 'sets', 'pairs', 'sheets', 'rolls']

// ── Catalog Picker ─────────────────────────────────────────────────────────────
type CatalogItem = {
  id: string
  name: string
  category: string | null
  price: number | null
  description: string | null
  source: 'product' | 'history'
  raw: Record<string, unknown>
}

function CatalogPicker({
  products,
  recentItems,
  onSelect,
  onNewItem,
}: {
  products: { id: string; product_name: string; category: string | null; unit_price: number | null; description: string | null }[]
  recentItems: { order_name: string | null; item_service_description: string | null; unit: string | null; unit_price_estimate: number | null; category_id: string | null; recommended_vendor_id: string | null }[]
  onSelect: (item: CatalogItem) => void
  onNewItem: () => void
}) {
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'products' | 'history'>('products')

  const productItems: CatalogItem[] = useMemo(() =>
    products.map(p => ({
      id: p.id,
      name: p.product_name,
      category: p.category,
      price: p.unit_price,
      description: p.description,
      source: 'product' as const,
      raw: p as Record<string, unknown>,
    }))
  , [products])

  const historyItems: CatalogItem[] = useMemo(() =>
    recentItems.map((o, i) => ({
      id: `hist-${i}`,
      name: o.order_name || (o.item_service_description ?? '').slice(0, 60),
      category: null,
      price: o.unit_price_estimate,
      description: o.item_service_description,
      source: 'history' as const,
      raw: o as Record<string, unknown>,
    }))
  , [recentItems])

  const allItems = tab === 'products' ? productItems : historyItems
  const filtered = search.trim()
    ? allItems.filter(i => i.name.toLowerCase().includes(search.toLowerCase()) || (i.category ?? '').toLowerCase().includes(search.toLowerCase()))
    : allItems

  return (
    <div className="rounded-xl border dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-800">
      {/* Search bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-700/60 border-b dark:border-slate-700">
        <Search className="h-4 w-4 text-slate-400 flex-shrink-0" />
        <input
          autoFocus
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400 dark:text-slate-100"
          placeholder="Search catalog…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <button
          type="button"
          onClick={onNewItem}
          className="flex items-center gap-1 text-xs font-semibold text-brand hover:underline whitespace-nowrap flex-shrink-0"
        >
          <Zap className="h-3 w-3" /> New item
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 px-3 pt-2 pb-1 text-xs font-medium border-b dark:border-slate-700">
        <button
          type="button"
          onClick={() => setTab('products')}
          className={`pb-1 border-b-2 transition-colors ${tab === 'products' ? 'border-brand text-brand' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
        >
          <span className="flex items-center gap-1"><Package className="h-3 w-3" /> Products catalog</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('history')}
          className={`pb-1 border-b-2 transition-colors ${tab === 'history' ? 'border-brand text-brand' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
        >
          <span className="flex items-center gap-1"><History className="h-3 w-3" /> Previously ordered</span>
        </button>
      </div>

      {/* Items list */}
      <div className="max-h-64 overflow-y-auto divide-y dark:divide-slate-700/60">
        {filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">
            {search ? 'No matches.' : tab === 'products' ? 'No products in catalog.' : 'No order history yet.'}
            {' '}
            <button type="button" onClick={onNewItem} className="text-brand font-medium hover:underline">Request new item →</button>
          </div>
        ) : filtered.map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item)}
            className="w-full text-left flex items-start gap-3 px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors group"
          >
            <div className="mt-0.5 flex-shrink-0 rounded-lg p-1.5 bg-slate-100 dark:bg-slate-700 text-slate-500">
              {item.source === 'product' ? <Package className="h-3.5 w-3.5" /> : <History className="h-3.5 w-3.5" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate group-hover:text-brand transition-colors">{item.name}</p>
              {item.category && <p className="text-xs text-slate-400 mt-0.5">{item.category}</p>}
              {item.description && item.source === 'history' && (
                <p className="text-xs text-slate-400 mt-0.5 truncate">{item.description.slice(0, 80)}</p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {item.price != null && <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 tabular-nums">{formatCurrency(item.price)}</p>}
              <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-brand transition-colors" />
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Selected item chip ─────────────────────────────────────────────────────────
function SelectedItemChip({ name, isNew, onClear }: { name: string; isNew: boolean; onClear: () => void }) {
  return (
    <div className={`flex items-center gap-3 rounded-lg border p-3 ${isNew ? 'border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700/40' : 'border-brand/20 bg-brand/5 dark:bg-brand/10'}`}>
      <div className={`rounded-md p-1.5 ${isNew ? 'bg-amber-100 dark:bg-amber-800/40 text-amber-600' : 'bg-brand/10 text-brand'}`}>
        {isNew ? <Zap className="h-4 w-4" /> : <Package className="h-4 w-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{name}</p>
        {isNew && (
          <p className="text-xs text-amber-600 dark:text-amber-400 font-medium mt-0.5">New item — procurement will source from market</p>
        )}
      </div>
      <button type="button" onClick={onClear} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:underline flex-shrink-0">
        Change
      </button>
    </div>
  )
}

// ── Main page loader ───────────────────────────────────────────────────────────
export default function OrderFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id

  const { data: record, isLoading } = useQuery({
    queryKey: ['order', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('orders').select('*').eq('id', id).single()
      if (error) throw error
      return data as Order
    },
    enabled: isEdit,
  })

  const { data: linkedExpenses = [] } = useQuery({
    queryKey: ['order-expenses', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('order_expenses').select('expense_id').eq('order_id', id)
      if (error) throw error
      return data.map(r => r.expense_id)
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title="Edit Order" backTo="/orders" loading onSave={() => {}} />
  }

  return <OrderFormPageBody id={id} record={record} linkedExpenseIds={isEdit ? linkedExpenses : []} />
}

// ── Form body ──────────────────────────────────────────────────────────────────
function OrderFormPageBody({ id, record, linkedExpenseIds }: { id?: string; record?: Order; linkedExpenseIds: string[] }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { role } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data: projects = [] } = useProjects()
  const { data: staff = [] } = useStaff()
  const { data: categories = [] } = useCategories()
  const { data: vendors = [] } = useVendors()
  const { data: expenses = [] } = useExpensesList()
  const { data: userProfiles = [] } = useUserProfiles()
  const { data: products = [] } = useProducts()
  const { data: recentItems = [] } = useRecentOrderItems()

  const projectOptions  = useMemo(() => projects.map((p: any) => ({ id: p.id, label: p.project_name })), [projects])
  const staffOptions    = useMemo(() => staff.map((s: any) => ({ id: s.id, label: s.employee_name })), [staff])
  const categoryOptions = useMemo(() => categories.map((c: any) => ({ id: c.id, label: c.category_name })), [categories])
  const vendorOptions   = useMemo(() => vendors.map((v: any) => ({ id: v.id, label: v.vendor_name })), [vendors])
  const expenseOptions  = useMemo(() => expenses.map((e: any) => ({ id: e.id, label: e.item_service_description ?? e.expense_code ?? e.id })), [expenses])

  function profileName(userId: string | null) {
    if (!userId) return null
    return (userProfiles as any[]).find(p => p.id === userId)?.full_name ?? 'Unknown user'
  }

  const [form, setForm] = useState<Partial<OrderInsert>>(
    record
      ? {
          order_name:              record.order_name,
          item_service_description: record.item_service_description,
          order_date:              record.order_date,
          quantity:                record.quantity ?? undefined,
          status:                  record.status,
          notes:                   record.notes,
          vendor_recommendation:   record.vendor_recommendation,
          project_id:              record.project_id,
          staff_id:                record.staff_id,
          category_id:             record.category_id,
          recommended_vendor_id:   record.recommended_vendor_id,
          product_id:              record.product_id,
          unit:                    record.unit,
          unit_price_estimate:     record.unit_price_estimate,
          required_by_date:        record.required_by_date,
          priority:                record.priority ?? 'normal',
          is_new_item:             record.is_new_item ?? false,
        }
      : { status: 'pending', priority: 'normal', is_new_item: false }
  )

  const [selectedExpenseIds, setSelectedExpenseIds] = useState<string[]>(linkedExpenseIds)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')
  const [showCatalog, setShowCatalog] = useState(!isEdit && !form.order_name)
  const [unitInput, setUnitInput] = useState(form.unit ?? '')

  function set(key: keyof OrderInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  function handleCatalogSelect(item: CatalogItem) {
    setForm(f => ({
      ...f,
      order_name:               item.name,
      item_service_description: item.description ?? f.item_service_description,
      product_id:               item.source === 'product' ? item.id : null,
      unit_price_estimate:      item.price ?? f.unit_price_estimate,
      is_new_item:              false,
    }))
    if ((item.raw as any).unit)                   setUnitInput((item.raw as any).unit)
    if ((item.raw as any).category_id)            set('category_id', (item.raw as any).category_id)
    if ((item.raw as any).recommended_vendor_id)  set('recommended_vendor_id', (item.raw as any).recommended_vendor_id)
    setShowCatalog(false)
  }

  function handleNewItem() {
    setForm(f => ({ ...f, is_new_item: true, product_id: null, order_name: f.order_name ?? '' }))
    setShowCatalog(false)
  }

  function clearItem() {
    setForm(f => ({ ...f, order_name: '', item_service_description: '', product_id: null, is_new_item: false }))
    setShowCatalog(true)
  }

  const approvalStatus = record?.approval_status ?? 'pending'
  const showManagerActions = isEdit && approvalStatus === 'pending' && canApproveAsManager(role)
  const showFinanceActions = isEdit && approvalStatus === 'manager_approved' && canApproveAsFinance(role)
  const canResubmit = isEdit && approvalStatus === 'rejected' && (role === 'admin' || role === 'manager' || role === 'procurement_officer')

  async function handleApprovalTransition(nextStatus: string, extra: Record<string, unknown> = {}) {
    if (!id) return
    const { error: err } = await supabase.from('orders').update({ approval_status: nextStatus, ...extra }).eq('id', id)
    if (err) { toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['order', id] })
    qc.invalidateQueries({ queryKey: ['orders'] })
    toast('Approval status updated', 'success')
    setRejecting(false)
    setRejectionReason('')
  }

  async function handleSave() {
    if (!form.order_name?.trim() && !form.item_service_description?.trim()) {
      setError('Please select an item from the catalog or describe what you need.')
      return
    }
    setError(''); setSaving(true)
    const payload = { ...form, unit: unitInput || null }
    const op = isEdit
      ? supabase.from('orders').update(payload as any).eq('id', id!)
      : supabase.from('orders').insert([payload as any]).select().single()
    const { data: saved, error: err } = await op
    if (err) { setSaving(false); setError(err.message); toast(err.message, 'error'); return }
    const orderId = isEdit ? id! : (saved as any).id

    await supabase.from('order_expenses').delete().eq('order_id', orderId)
    if (selectedExpenseIds.length > 0) {
      const { error: linkErr } = await supabase.from('order_expenses').insert(selectedExpenseIds.map(expense_id => ({ order_id: orderId, expense_id })))
      if (linkErr) { setSaving(false); setError(linkErr.message); toast(linkErr.message, 'error'); return }
    }

    setSaving(false)
    qc.invalidateQueries({ queryKey: ['orders'] })
    qc.invalidateQueries({ queryKey: ['order-expenses', orderId] })
    qc.invalidateQueries({ queryKey: ['recent-order-items'] })
    toast(isEdit ? 'Order updated' : 'Order created', 'success')
    navigate('/orders')
  }

  return (
    <FormPage
      title={isEdit ? 'Edit Order' : 'New Order'}
      backTo="/orders"
      error={error}
      saving={saving}
      saveLabel={isEdit ? 'Save Changes' : 'Submit Order'}
      onSave={handleSave}
    >
      {/* ── Approval panel (edit only) ─────────────────────────── */}
      {isEdit && (
        <div className="rounded-lg border bg-slate-50 dark:bg-slate-700/30 dark:border-slate-700 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Approval</p>
            <StatusBadge status={approvalStatus} />
          </div>
          {record?.manager_approved_by && (
            <p className="text-xs text-slate-500">Manager reviewed: {profileName(record.manager_approved_by)} on {formatDate(record.manager_approved_at)}</p>
          )}
          {record?.finance_approved_by && (
            <p className="text-xs text-slate-500">Finance approved: {profileName(record.finance_approved_by)} on {formatDate(record.finance_approved_at)}</p>
          )}
          {approvalStatus === 'rejected' && record?.rejection_reason && (
            <p className="text-xs text-red-600 dark:text-red-400">Rejection reason: {record.rejection_reason}</p>
          )}
          {(showManagerActions || showFinanceActions) && !rejecting && (
            <div className="flex gap-2">
              <button type="button" onClick={() => handleApprovalTransition(showFinanceActions ? 'finance_approved' : 'manager_approved')} className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700">
                {showFinanceActions ? 'Give Final Approval' : 'Approve'}
              </button>
              <button type="button" onClick={() => setRejecting(true)} className="rounded-md bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100">Reject</button>
            </div>
          )}
          {(showManagerActions || showFinanceActions) && rejecting && (
            <div className="space-y-2">
              <textarea rows={2} className={inputCls} placeholder="Reason for rejection…" value={rejectionReason} onChange={e => setRejectionReason(e.target.value)} />
              <div className="flex gap-2">
                <button type="button" disabled={!rejectionReason.trim()} onClick={() => handleApprovalTransition('rejected', { rejection_reason: rejectionReason.trim() })} className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50">Confirm Reject</button>
                <button type="button" onClick={() => { setRejecting(false); setRejectionReason('') }} className="rounded-md border px-3 py-1.5 text-xs hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
              </div>
            </div>
          )}
          {canResubmit && (
            <button type="button" onClick={() => handleApprovalTransition('pending')} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90">Resubmit for Approval</button>
          )}
        </div>
      )}

      {/* ── Section 1: What do you need? ───────────────────────── */}
      <div className={sectionCls}>
        <SectionHeader
          icon={<Package className="h-4 w-4" />}
          title="What do you need?"
          sub="Pick from the product catalog, reuse a previous order, or register a new item"
        />

        {showCatalog ? (
          <CatalogPicker
            products={products}
            recentItems={recentItems}
            onSelect={handleCatalogSelect}
            onNewItem={handleNewItem}
          />
        ) : (
          <div className="space-y-3">
            <SelectedItemChip
              name={form.order_name ?? form.item_service_description ?? 'Unnamed item'}
              isNew={form.is_new_item ?? false}
              onClear={clearItem}
            />

            {/* Item name (editable) */}
            <Field label="Item Name" required>
              <input
                type="text"
                className={inputCls}
                placeholder="Short name for this purchase…"
                value={form.order_name ?? ''}
                onChange={e => set('order_name', e.target.value || null)}
              />
            </Field>

            {/* Specifications */}
            <Field label="Specifications / Description">
              <textarea
                rows={3}
                className={inputCls}
                placeholder="Detailed specs, model number, color, grade, dimensions…"
                value={form.item_service_description ?? ''}
                onChange={e => set('item_service_description', e.target.value)}
              />
            </Field>
          </div>
        )}
      </div>

      {/* ── Section 2: Quantity & Timeline ─────────────────────── */}
      {!showCatalog && (
        <div className={sectionCls}>
          <SectionHeader
            icon={<AlertTriangle className="h-4 w-4" />}
            title="Quantity & Timeline"
          />
          <div className="grid grid-cols-3 gap-3">
            <Field label="Quantity" required>
              <input type="number" min="0" step="any" className={inputCls} placeholder="0"
                value={form.quantity ?? ''}
                onChange={e => set('quantity', e.target.value ? parseFloat(e.target.value) : null)} />
            </Field>
            <Field label="Unit">
              <input
                type="text"
                className={inputCls}
                placeholder="pcs, kg, liters…"
                list="unit-suggestions"
                value={unitInput}
                onChange={e => { setUnitInput(e.target.value); set('unit', e.target.value || null) }}
              />
              <datalist id="unit-suggestions">
                {COMMON_UNITS.map(u => <option key={u} value={u} />)}
              </datalist>
            </Field>
            <Field label="Est. Unit Price (ETB)">
              <input type="number" min="0" step="0.01" className={inputCls} placeholder="0.00"
                value={form.unit_price_estimate ?? ''}
                onChange={e => set('unit_price_estimate', e.target.value ? parseFloat(e.target.value) : null)} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Required By">
              <input type="date" className={inputCls}
                value={form.required_by_date ?? ''}
                onChange={e => set('required_by_date', e.target.value || null)} />
            </Field>
            <Field label="Order Date">
              <input type="date" className={inputCls}
                value={form.order_date ?? ''}
                onChange={e => set('order_date', e.target.value || null)} />
            </Field>
          </div>

          <Field label="Priority">
            <div className="flex gap-2 flex-wrap">
              {PRIORITY_OPTS.map(({ value, label, color }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => set('priority', value)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold border-2 transition-all ${
                    form.priority === value
                      ? `${color} border-current`
                      : 'border-transparent bg-slate-100 dark:bg-slate-700 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-600'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>
        </div>
      )}

      {/* ── Section 3: Project & Requester ─────────────────────── */}
      {!showCatalog && (
        <div className={sectionCls}>
          <SectionHeader
            icon={<span className="text-base leading-none">📋</span>}
            title="Project & Requester"
          />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Project">
              <SearchableSelect value={form.project_id ?? null} onChange={v => set('project_id', v)} options={projectOptions} placeholder="Select project…" />
            </Field>
            <Field label="Ordered By (Staff)">
              <SearchableSelect value={form.staff_id ?? null} onChange={v => set('staff_id', v)} options={staffOptions} placeholder="Select staff…" />
            </Field>
          </div>
          <Field label="General Ledger Category">
            <SearchableSelect value={form.category_id ?? null} onChange={v => set('category_id', v)} options={categoryOptions} placeholder="Select GL account…" />
          </Field>
        </div>
      )}

      {/* ── Section 4: Procurement context ─────────────────────── */}
      {!showCatalog && (
        <div className={sectionCls}>
          <SectionHeader
            icon={<span className="text-base leading-none">🏪</span>}
            title="Vendor & Procurement Notes"
            sub="Optional — leave blank for procurement to decide"
          />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Recommended Vendor">
              <SearchableSelect value={form.recommended_vendor_id ?? null} onChange={v => set('recommended_vendor_id', v)} options={vendorOptions} placeholder="Select vendor…" />
            </Field>
            <Field label="Vendor Recommendation Notes">
              <input type="text" className={inputCls} placeholder="e.g. ask for bulk pricing…"
                value={form.vendor_recommendation ?? ''}
                onChange={e => set('vendor_recommendation', e.target.value)} />
            </Field>
          </div>
          <Field label="Fulfillment Status">
            <select className={inputCls} value={form.status ?? 'pending'} onChange={e => set('status', e.target.value as any)}>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="completed">Completed</option>
            </select>
          </Field>
        </div>
      )}

      {/* ── Section 5: Notes & linked expenses ─────────────────── */}
      {!showCatalog && (
        <div className={sectionCls}>
          <SectionHeader
            icon={<span className="text-base leading-none">📝</span>}
            title="Notes & Links"
          />
          <Field label="Additional Notes">
            <textarea rows={2} className={inputCls} placeholder="Any other context for procurement…"
              value={form.notes ?? ''}
              onChange={e => set('notes', e.target.value)} />
          </Field>
          <Field label="Linked Expenses">
            <MultiSelect value={selectedExpenseIds} onChange={setSelectedExpenseIds} options={expenseOptions} placeholder="Link related expenses…" />
          </Field>
        </div>
      )}
    </FormPage>
  )
}
