import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState, useCallback, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { StatusBadge } from '@/components/shared/StatusBadge'
import type { Order, OrderInsert, OrderPriority, OrderItem, OrderItemStatus } from '@/types/database'
import {
  useProjects, useStaff, useVendors, useUserProfiles, useSubCategoriesAll, useRecentOrderItems,
} from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { canApproveAsManager, canApproveAsFinance } from '@/lib/expenseAccess'
import { formatDate } from '@/lib/utils'
import { checkProjectBudget, logBudgetCheck, type BudgetCheckResult } from '@/lib/budgetCheck'
import {
  ArrowLeft, Plus, Trash2, Package, History, Zap, Search, ChevronRight, AlertCircle, ShieldAlert,
} from 'lucide-react'

const inputCls = 'w-full rounded-md border dark:border-slate-600 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors dark:bg-slate-800 dark:text-slate-100'
const sectionCls = 'rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-3 shadow-sm'

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

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="border-b dark:border-slate-700 pb-2 mb-1">
      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}

const PRIORITY_OPTS: { value: OrderPriority; label: string; cls: string }[] = [
  { value: 'normal',   label: 'Normal',   cls: 'text-slate-600 bg-slate-100 dark:bg-slate-700' },
  { value: 'urgent',   label: 'Urgent',   cls: 'text-amber-700 bg-amber-50 dark:bg-amber-900/30' },
  { value: 'critical', label: 'Critical', cls: 'text-red-700 bg-red-50 dark:bg-red-900/30' },
]

const COMMON_UNITS = ['pcs', 'kg', 'liters', 'meters', 'sheets', 'bags', 'boxes', 'sets', 'pairs', 'rolls']

const ITEM_STATUSES: { value: OrderItemStatus; label: string }[] = [
  { value: 'pending',           label: 'Pending' },
  { value: 'sourced',           label: 'Sourced' },
  { value: 'partially_sourced', label: 'Partially Sourced' },
  { value: 'unfulfilled',       label: 'Unfulfilled' },
  { value: 'cancelled',         label: 'Cancelled' },
]

// ── Line item state ────────────────────────────────────────────────────────────
type LineItem = {
  _id: string           // stable local key
  dbId?: string         // set once saved
  sub_category_id: string | null
  item_name: string
  specifications: string
  quantity: string
  unit: string
  unit_price_est: string
  needs_market_check: boolean
  status: OrderItemStatus
  fulfillment_notes: string
  showSpecs: boolean
}

function newLine(overrides: Partial<LineItem> = {}): LineItem {
  return {
    _id: crypto.randomUUID(),
    sub_category_id: null,
    item_name: '',
    specifications: '',
    quantity: '',
    unit: 'pcs',
    unit_price_est: '',
    needs_market_check: false,
    status: 'pending',
    fulfillment_notes: '',
    showSpecs: false,
    ...overrides,
  }
}

// ── Mini catalog picker (per line row) ────────────────────────────────────────
type CatalogEntry = { id: string; name: string; glCategory: string | null; glCategoryId: string | null; desc: string | null; source: 'sub_ledger' | 'history'; raw: Record<string, unknown> }

function MiniCatalog({
  subCategories, recentItems, onPick, onClose,
}: {
  subCategories: ReturnType<typeof useSubCategoriesAll>['data']
  recentItems: ReturnType<typeof useRecentOrderItems>['data']
  onPick: (e: CatalogEntry) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'sub_ledger' | 'history'>('sub_ledger')

  const ledger: CatalogEntry[] = useMemo(() =>
    (subCategories ?? []).map(s => ({
      id: s.id, name: s.item_name, glCategory: s.categories?.category_name ?? null,
      glCategoryId: s.parent_category_id, desc: s.description, source: 'sub_ledger' as const, raw: s as Record<string, unknown>,
    })), [subCategories])

  const history: CatalogEntry[] = useMemo(() =>
    (recentItems ?? []).map((o, i) => ({
      id: `h${i}`, name: o.order_name || (o.item_service_description ?? '').slice(0, 60),
      glCategory: null, glCategoryId: o.category_id, desc: o.item_service_description,
      source: 'history' as const, raw: o as Record<string, unknown>,
    })), [recentItems])

  const all = tab === 'sub_ledger' ? ledger : history
  const q = search.toLowerCase()
  const filtered = q ? all.filter(i => i.name.toLowerCase().includes(q) || (i.glCategory ?? '').toLowerCase().includes(q)) : all

  // Group ledger items by GL category when no search
  const grouped = useMemo(() => {
    if (tab !== 'sub_ledger' || q) return null
    const m = new Map<string, CatalogEntry[]>()
    for (const item of ledger) {
      const key = item.glCategory ?? 'Uncategorized'
      if (!m.has(key)) m.set(key, [])
      m.get(key)!.push(item)
    }
    return Array.from(m.entries()).map(([k, items]) => ({ key: k, items }))
  }, [tab, ledger, q])

  return (
    <div className="absolute z-50 left-0 top-full mt-1 w-80 rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-xl overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-700/60 border-b dark:border-slate-700">
        <Search className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
        <input autoFocus className="flex-1 bg-transparent text-xs outline-none placeholder:text-slate-400 dark:text-slate-100"
          placeholder="Search sub-ledger accounts…" value={search} onChange={e => setSearch(e.target.value)} />
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xs">✕</button>
      </div>
      <div className="flex gap-3 px-3 pt-1.5 pb-1 text-[11px] font-medium border-b dark:border-slate-700">
        {(['sub_ledger', 'history'] as const).map(t => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`pb-1 border-b-2 transition-colors ${tab === t ? 'border-brand text-brand' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
            {t === 'sub_ledger' ? 'Sub-ledger' : 'Previously ordered'}
          </button>
        ))}
      </div>
      <div className="max-h-56 overflow-y-auto">
        {grouped ? grouped.map(g => (
          <div key={g.key}>
            <div className="sticky top-0 px-3 py-1 bg-slate-50 dark:bg-slate-700/80 border-b dark:border-slate-700">
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{g.key}</p>
            </div>
            {g.items.map(item => (
              <button key={item.id} type="button" onClick={() => onPick(item)}
                className="w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/40 group transition-colors">
                <Package className="h-3 w-3 text-slate-400 flex-shrink-0" />
                <span className="flex-1 text-xs text-slate-700 dark:text-slate-200 truncate group-hover:text-brand">{item.name}</span>
                <ChevronRight className="h-3 w-3 text-slate-300 group-hover:text-brand flex-shrink-0" />
              </button>
            ))}
          </div>
        )) : filtered.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">No matches</p>
        ) : (
          filtered.map(item => (
            <button key={item.id} type="button" onClick={() => onPick(item)}
              className="w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/40 group transition-colors border-b dark:border-slate-700/40 last:border-0">
              {item.source === 'sub_ledger' ? <Package className="h-3 w-3 text-slate-400 flex-shrink-0" /> : <History className="h-3 w-3 text-slate-400 flex-shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-700 dark:text-slate-200 truncate group-hover:text-brand">{item.name}</p>
                {item.glCategory && <p className="text-[10px] text-slate-400">{item.glCategory}</p>}
              </div>
              <ChevronRight className="h-3 w-3 text-slate-300 group-hover:text-brand flex-shrink-0" />
            </button>
          ))
        )}
      </div>
      <div className="px-3 py-2 border-t dark:border-slate-700 bg-slate-50 dark:bg-slate-700/40">
        <button type="button" onClick={() => { onPick({ id: '', name: '', glCategory: null, glCategoryId: null, desc: null, source: 'sub_ledger', raw: {} }); onClose() }}
          className="text-xs text-brand font-medium hover:underline flex items-center gap-1">
          <Zap className="h-3 w-3" /> Enter new item manually
        </button>
      </div>
    </div>
  )
}

// ── Line item row ──────────────────────────────────────────────────────────────
function LineItemRow({
  item, index, isEdit, subCategories, recentItems,
  onChange, onRemove,
}: {
  item: LineItem; index: number; isEdit: boolean
  subCategories: ReturnType<typeof useSubCategoriesAll>['data']
  recentItems: ReturnType<typeof useRecentOrderItems>['data']
  onChange: (patch: Partial<LineItem>) => void
  onRemove: () => void
}) {
  const [showCatalog, setShowCatalog] = useState(false)

  function pickCatalogEntry(entry: CatalogEntry) {
    onChange({
      item_name: entry.name || item.item_name,
      sub_category_id: entry.source === 'sub_ledger' ? entry.id : null,
      specifications: entry.desc ?? item.specifications,
      unit: (entry.raw as any).unit ?? item.unit,
      unit_price_est: String((entry.raw as any).unit_price_estimate ?? item.unit_price_est),
    })
    setShowCatalog(false)
  }

  const statusBorderCls: Record<OrderItemStatus, string> = {
    pending:           'border-l-slate-300',
    sourced:           'border-l-green-400',
    partially_sourced: 'border-l-amber-400',
    unfulfilled:       'border-l-red-400',
    cancelled:         'border-l-slate-200',
  }

  // Show the linked GL account name when a catalog item is selected
  const linkedAccount = item.sub_category_id
    ? (subCategories ?? []).find((s: any) => s.id === item.sub_category_id)?.item_name ?? null
    : null

  const hasFooter = item.showSpecs || (isEdit && item.status !== 'pending')

  return (
    <div className={`rounded-lg border dark:border-slate-700 bg-slate-50 dark:bg-slate-700/30 border-l-4 ${statusBorderCls[item.status]} overflow-visible`}>

      {/* ── Grid row: [#] [item] [qty] [unit] [price] [status?] [×] ── */}
      <div className={`grid items-start gap-x-2 gap-y-0 p-3 ${
        isEdit
          ? 'grid-cols-[1.5rem_minmax(0,1fr)_5.5rem_5rem_7rem_8rem_2rem]'
          : 'grid-cols-[1.5rem_minmax(0,1fr)_5.5rem_5rem_7rem_2rem]'
      }`}>

        {/* Row index */}
        <span className="pt-2.5 text-xs text-slate-400 font-mono text-center">{index + 1}</span>

        {/* Item name + catalog picker */}
        <div className="relative min-w-0">
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setShowCatalog(s => !s)}
              title="Pick from sub-ledger catalog"
              className={`flex-shrink-0 rounded-md p-1.5 border transition-colors ${
                item.sub_category_id
                  ? 'bg-brand/10 border-brand/40 text-brand'
                  : 'bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-400 hover:text-brand hover:border-brand'
              }`}>
              <Package className="h-3.5 w-3.5" />
            </button>
            <input
              className={`${inputCls} font-medium flex-1 min-w-0`}
              placeholder={`Item ${index + 1} name…`}
              value={item.item_name}
              onChange={e => onChange({ item_name: e.target.value })}
            />
          </div>
          {/* Linked GL account badge */}
          {linkedAccount && (
            <p className="mt-0.5 pl-8 text-[10px] text-brand truncate" title={linkedAccount}>
              GL: {linkedAccount}
            </p>
          )}
          {/* Catalog dropdown */}
          {showCatalog && (
            <MiniCatalog
              subCategories={subCategories}
              recentItems={recentItems}
              onPick={pickCatalogEntry}
              onClose={() => setShowCatalog(false)}
            />
          )}
        </div>

        {/* Qty */}
        <input type="number" min="0" step="any" className={inputCls} placeholder="Qty"
          value={item.quantity} onChange={e => onChange({ quantity: e.target.value })} />

        {/* Unit */}
        <div className="min-w-0">
          <input type="text" className={inputCls} placeholder="unit" list={`units-${item._id}`}
            value={item.unit} onChange={e => onChange({ unit: e.target.value })} />
          <datalist id={`units-${item._id}`}>{COMMON_UNITS.map(u => <option key={u} value={u} />)}</datalist>
        </div>

        {/* Est. price */}
        <input type="number" min="0" step="0.01" className={inputCls} placeholder="Est. price"
          value={item.unit_price_est} onChange={e => onChange({ unit_price_est: e.target.value })} />

        {/* Status (edit mode only) */}
        {isEdit && (
          <select className={`${inputCls} text-xs`} value={item.status}
            onChange={e => onChange({ status: e.target.value as OrderItemStatus })}>
            {ITEM_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        )}

        {/* Remove */}
        <button type="button" onClick={onRemove} title="Remove item"
          className="mt-1.5 rounded p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* ── Full-width footer: specs / market check / fulfillment notes ── */}
      {(hasFooter || true) && (
        <div className="px-3 pb-3 space-y-2">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => onChange({ showSpecs: !item.showSpecs })}
              className="text-[10px] text-slate-400 hover:text-brand transition-colors">
              {item.showSpecs ? '− Hide specs' : '+ Add specs / description'}
            </button>
            <label className={`flex items-center gap-1.5 text-[10px] cursor-pointer select-none transition-colors ${
              item.needs_market_check ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400 hover:text-amber-500'
            }`}>
              <input type="checkbox" className="accent-amber-500"
                checked={item.needs_market_check}
                onChange={e => onChange({ needs_market_check: e.target.checked })} />
              Ask procurement: check market price
            </label>
          </div>
          {item.showSpecs && (
            <textarea rows={2} className={`${inputCls} text-xs w-full`}
              placeholder="Specifications, grade, dimensions, brand, quality grade…"
              value={item.specifications} onChange={e => onChange({ specifications: e.target.value })} />
          )}
          {isEdit && item.status !== 'pending' && (
            <input type="text" className={`${inputCls} text-xs w-full`}
              placeholder="Fulfillment notes — e.g. sourced from alternative vendor, partial delivery, item unavailable…"
              value={item.fulfillment_notes} onChange={e => onChange({ fulfillment_notes: e.target.value })} />
          )}
        </div>
      )}
    </div>
  )
}

// ── Page loader ────────────────────────────────────────────────────────────────
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

  const { data: existingItems = [] } = useQuery({
    queryKey: ['order-items', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('order_items').select('*').eq('order_id', id).order('sort_order')
      if (error) throw error
      return data as OrderItem[]
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <div className="py-24 text-center text-sm text-slate-400">Loading…</div>
  }

  return <PurchaseRequestFormBody id={id} record={record} existingItems={isEdit ? existingItems : []} />
}

// ── Form body ──────────────────────────────────────────────────────────────────
function PurchaseRequestFormBody({
  id, record, existingItems,
}: { id?: string; record?: Order; existingItems: OrderItem[] }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { role, profile } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data: projects = [] }     = useProjects()
  const { data: staff = [] }        = useStaff()
  const { data: vendors = [] }      = useVendors()
  const { data: userProfiles = [] } = useUserProfiles()
  const { data: subCategories = [] } = useSubCategoriesAll()
  const { data: recentItems = [] }  = useRecentOrderItems()

  const projectOptions = useMemo(() => projects.map((p: any) => ({ id: p.id, label: p.project_name })), [projects])
  const staffOptions   = useMemo(() => staff.map((s: any) => ({ id: s.id, label: s.employee_name })), [staff])
  const vendorOptions  = useMemo(() => vendors.map((v: any) => ({ id: v.id, label: v.vendor_name })), [vendors])

  function profileName(uid: string | null) {
    if (!uid) return null
    return (userProfiles as any[]).find(p => p.id === uid)?.full_name ?? 'Unknown'
  }

  // Header form state
  const [header, setHeader] = useState<Partial<OrderInsert>>(
    record ? {
      order_name:              record.order_name,
      order_date:              record.order_date,
      project_id:              record.project_id,
      staff_id:                record.staff_id,
      requested_by_user_id:    record.requested_by_user_id ?? profile?.id ?? null,
      required_by_date:        record.required_by_date,
      priority:                record.priority ?? 'normal',
      notes:                   record.notes,
      recommended_vendor_id:   record.recommended_vendor_id,
      vendor_recommendation:   record.vendor_recommendation,
      status:                  record.status,
      is_new_item:             record.is_new_item ?? false,
    } : { status: 'pending', priority: 'normal', is_new_item: false, requested_by_user_id: profile?.id ?? null }
  )

  // Line items state
  const [lines, setLines] = useState<LineItem[]>(() => {
    if (existingItems.length > 0) {
      return existingItems.map(item => ({
        _id: item.id,
        dbId: item.id,
        sub_category_id: item.sub_category_id,
        item_name: item.item_name,
        specifications: item.specifications ?? '',
        quantity: item.quantity?.toString() ?? '',
        unit: item.unit ?? 'pcs',
        unit_price_est: item.unit_price_est?.toString() ?? '',
        needs_market_check: item.needs_market_check ?? false,
        status: item.status,
        fulfillment_notes: item.fulfillment_notes ?? '',
        showSpecs: !!item.specifications,
      }))
    }
    return [newLine()]
  })

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')

  function setHdr(key: keyof OrderInsert, value: unknown) { setHeader(h => ({ ...h, [key]: value })) }

  const updateLine = useCallback((idx: number, patch: Partial<LineItem>) => {
    setLines(ls => ls.map((l, i) => i === idx ? { ...l, ...patch } : l))
  }, [])

  const removeLine = useCallback((idx: number) => {
    setLines(ls => ls.length <= 1 ? [newLine()] : ls.filter((_, i) => i !== idx))
  }, [])

  const addLine = useCallback(() => setLines(ls => [...ls, newLine()]), [])

  // ── Phase 2 warn-only budget check — per cost group present across the
  // line items, since one PR can span several. Never blocks; a request
  // over budget just shows "would block once enforcing" and still saves. ──
  // key: cost_group_id, or '' for unmapped/no sub-ledger link
  const lineGroupTotals = useMemo(() => {
    const totals = new Map<string, number>()
    for (const l of lines) {
      if (!l.item_name.trim()) continue
      const qty = parseFloat(l.quantity) || 0
      const price = parseFloat(l.unit_price_est) || 0
      if (qty <= 0 || price <= 0) continue
      const sub = subCategories.find((s: any) => s.id === l.sub_category_id)
      const costGroupId = sub?.categories?.cost_group_id ?? ''
      totals.set(costGroupId, (totals.get(costGroupId) ?? 0) + qty * price)
    }
    return totals
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, subCategories])

  const [budgetChecks, setBudgetChecks] = useState<Record<string, BudgetCheckResult>>({})

  useEffect(() => {
    if (!header.project_id) { setBudgetChecks({}); return }
    let cancelled = false
    Promise.all([...lineGroupTotals.entries()].map(async ([key, total]) => {
      const result = await checkProjectBudget(header.project_id!, key || null, total)
      return [key, result] as const
    })).then(results => { if (!cancelled) setBudgetChecks(Object.fromEntries(results)) })
    return () => { cancelled = true }
  }, [header.project_id, lineGroupTotals])

  const flaggedChecks = Object.values(budgetChecks).filter(r => r.outcome === 'warn' || r.outcome === 'block')

  const approvalStatus = record?.approval_status ?? 'pending'
  const showManagerActions = isEdit && approvalStatus === 'pending' && canApproveAsManager(role)
  const showFinanceActions = isEdit && approvalStatus === 'manager_approved' && canApproveAsFinance(role)
  const canResubmit = isEdit && approvalStatus === 'rejected' && (role === 'admin' || role === 'manager')

  async function handleApprovalTransition(nextStatus: string, extra: Record<string, unknown> = {}) {
    if (!id) return
    const { error: err } = await supabase.from('orders').update({ approval_status: nextStatus, ...extra }).eq('id', id)
    if (err) { toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['order', id] })
    qc.invalidateQueries({ queryKey: ['orders'] })
    toast('Approval updated', 'success')
    setRejecting(false); setRejectionReason('')
  }

  async function handleSave() {
    const filledLines = lines.filter(l => l.item_name.trim())
    if (filledLines.length === 0) { setError('Add at least one line item.'); return }
    setError(''); setSaving(true)

    const op = isEdit
      ? supabase.from('orders').update(header as any).eq('id', id!)
      : supabase.from('orders').insert([header as any]).select().single()
    const { data: saved, error: err } = await op
    if (err) { setSaving(false); setError(err.message); toast(err.message, 'error'); return }
    const orderId = isEdit ? id! : (saved as any).id

    // Sync line items: delete removed rows, upsert the rest
    const existingDbIds = existingItems.map(i => i.id)
    const keepIds = filledLines.filter(l => l.dbId).map(l => l.dbId!)
    const removeIds = existingDbIds.filter(id => !keepIds.includes(id))

    if (removeIds.length > 0) {
      await supabase.from('order_items').delete().in('id', removeIds)
    }

    const toUpsert = filledLines.map((l, i) => ({
      ...(l.dbId ? { id: l.dbId } : {}),
      order_id: orderId,
      sub_category_id: l.sub_category_id,
      item_name: l.item_name.trim(),
      specifications: l.specifications || null,
      quantity: l.quantity ? parseFloat(l.quantity) : null,
      unit: l.unit || null,
      unit_price_est: l.unit_price_est ? parseFloat(l.unit_price_est) : null,
      needs_market_check: l.needs_market_check,
      status: l.status,
      fulfillment_notes: l.fulfillment_notes || null,
      sort_order: i,
    }))

    const { error: itemErr } = await supabase.from('order_items').upsert(toUpsert)
    if (itemErr) { setSaving(false); setError(itemErr.message); toast(itemErr.message, 'error'); return }

    // Log the warn-only budget check outcome for every cost group present —
    // best-effort, never blocks; see src/lib/budgetCheck.ts
    const sourceRef = isEdit ? (record?.request_code ?? orderId) : ((saved as any)?.request_code ?? orderId)
    for (const [key, result] of Object.entries(budgetChecks)) {
      logBudgetCheck({
        source: 'pr',
        sourceRef,
        projectId: header.project_id ?? null,
        costGroupId: key || null,
        requestedAmount: lineGroupTotals.get(key) ?? 0,
        result,
        userId: profile?.id ?? null,
      })
    }

    setSaving(false)
    qc.invalidateQueries({ queryKey: ['orders'] })
    qc.invalidateQueries({ queryKey: ['order-items', orderId] })
    qc.invalidateQueries({ queryKey: ['order-item-counts'] })
    qc.invalidateQueries({ queryKey: ['recent-order-items'] })
    toast(isEdit ? 'Purchase request updated' : 'Purchase request created', 'success')
    navigate('/purchase-requests')
  }

  const filledCount = lines.filter(l => l.item_name.trim()).length

  return (
    <div className="space-y-5">

      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <Link to="/purchase-requests"
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand transition-colors flex-shrink-0">
            <ArrowLeft className="h-4 w-4" />Purchase Requests
          </Link>
          <span className="text-slate-300 dark:text-slate-600 flex-shrink-0">/</span>
          <h1 className="text-base font-bold text-slate-800 dark:text-slate-100 truncate">
            {isEdit
              ? `Edit${record?.request_code ? ` · ${record.request_code}` : ' Request'}`
              : 'New Purchase Request'}
          </h1>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Link to="/purchase-requests"
            className="rounded-md border dark:border-slate-600 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
            Cancel
          </Link>
          <button onClick={handleSave} disabled={saving}
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-60 transition-colors shadow-sm">
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Submit Request'}
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 px-4 py-3 text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />{error}
        </div>
      )}

      {/* Approval panel */}
      {isEdit && (
        <div className="rounded-lg border bg-slate-50 dark:bg-slate-700/30 dark:border-slate-700 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Approval</p>
            <StatusBadge status={approvalStatus} />
          </div>
          {record?.manager_approved_by && (
            <p className="text-xs text-slate-500">Manager: {profileName(record.manager_approved_by)} · {formatDate(record.manager_approved_at)}</p>
          )}
          {record?.finance_approved_by && (
            <p className="text-xs text-slate-500">Finance: {profileName(record.finance_approved_by)} · {formatDate(record.finance_approved_at)}</p>
          )}
          {approvalStatus === 'rejected' && record?.rejection_reason && (
            <p className="text-xs text-red-600 dark:text-red-400">Rejected: {record.rejection_reason}</p>
          )}
          {(showManagerActions || showFinanceActions) && !rejecting && (
            <div className="flex gap-2">
              <button type="button" onClick={() => handleApprovalTransition(showFinanceActions ? 'finance_approved' : 'manager_approved')}
                className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700">
                {showFinanceActions ? 'Final Approval' : 'Approve'}
              </button>
              <button type="button" onClick={() => setRejecting(true)}
                className="rounded-md bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100">Reject</button>
            </div>
          )}
          {(showManagerActions || showFinanceActions) && rejecting && (
            <div className="space-y-2">
              <textarea rows={2} className={inputCls} placeholder="Reason for rejection…" value={rejectionReason} onChange={e => setRejectionReason(e.target.value)} />
              <div className="flex gap-2">
                <button type="button" disabled={!rejectionReason.trim()}
                  onClick={() => handleApprovalTransition('rejected', { rejection_reason: rejectionReason })}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50">Confirm Reject</button>
                <button type="button" onClick={() => { setRejecting(false); setRejectionReason('') }}
                  className="rounded-md border px-3 py-1.5 text-xs hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
              </div>
            </div>
          )}
          {canResubmit && (
            <button type="button" onClick={() => handleApprovalTransition('pending')}
              className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90">Resubmit</button>
          )}
        </div>
      )}

      {/* Section 1: Header */}
      <div className={sectionCls}>
        <SectionHeader title="Request Details" sub="Project context and urgency" />
        <div className="grid grid-cols-3 gap-3">
          <Field label="Project">
            <SearchableSelect value={header.project_id ?? null} onChange={v => setHdr('project_id', v)} options={projectOptions} placeholder="Select project…" />
          </Field>
          <Field label="Requested By">
            <div className={`${inputCls} bg-slate-50 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300 cursor-default select-none`}>
              {profile?.full_name ?? 'Current User'}
            </div>
          </Field>
          <Field label="Assign Procurement Officer">
            <SearchableSelect value={header.staff_id ?? null} onChange={v => setHdr('staff_id', v)} options={staffOptions} placeholder="Select officer…" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Required By">
            <input type="date" className={inputCls} value={header.required_by_date ?? ''}
              onChange={e => setHdr('required_by_date', e.target.value || null)} />
          </Field>
          <Field label="Order Date">
            <input type="date" className={inputCls} value={header.order_date ?? ''}
              onChange={e => setHdr('order_date', e.target.value || null)} />
          </Field>
        </div>
        <Field label="Priority">
          <div className="flex gap-2">
            {PRIORITY_OPTS.map(({ value, label, cls }) => (
              <button key={value} type="button" onClick={() => setHdr('priority', value)}
                className={`rounded-full px-3 py-1 text-xs font-semibold border-2 transition-all ${
                  header.priority === value ? `${cls} border-current` : 'border-transparent bg-slate-100 dark:bg-slate-700 text-slate-500 hover:bg-slate-200'
                }`}>
                {label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Request Title / Description">
          <input type="text" className={inputCls} placeholder="Short title for this request…"
            value={header.order_name ?? ''} onChange={e => setHdr('order_name', e.target.value || null)} />
        </Field>
        <Field label="Notes">
          <textarea rows={2} className={inputCls} placeholder="Context or instructions for procurement…"
            value={header.notes ?? ''} onChange={e => setHdr('notes', e.target.value)} />
        </Field>
      </div>

      {/* Section 2: Line Items */}
      <div className={sectionCls}>
        <div className="flex items-center justify-between border-b dark:border-slate-700 pb-2 mb-1">
          <div>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Line Items</p>
            <p className="text-xs text-slate-400">Click <Package className="inline h-3 w-3" /> to pick from sub-ledger catalog</p>
          </div>
          <span className="text-xs text-slate-400">{filledCount} item{filledCount !== 1 ? 's' : ''}</span>
        </div>

        {/* Column headers — match LineItemRow grid */}
        <div className={`grid gap-x-2 px-3 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider ${
          isEdit
            ? 'grid-cols-[1.5rem_minmax(0,1fr)_5.5rem_5rem_7rem_8rem_2rem]'
            : 'grid-cols-[1.5rem_minmax(0,1fr)_5.5rem_5rem_7rem_2rem]'
        }`}>
          <span />
          <span>Item / GL Account</span>
          <span>Qty</span>
          <span>Unit</span>
          <span>Est. Price</span>
          {isEdit && <span>Status</span>}
          <span />
        </div>

        <div className="space-y-2">
          {lines.map((line, idx) => (
            <LineItemRow
              key={line._id}
              item={line}
              index={idx}
              isEdit={isEdit}
              subCategories={subCategories}
              recentItems={recentItems}
              onChange={patch => updateLine(idx, patch)}
              onRemove={() => removeLine(idx)}
            />
          ))}
        </div>

        <button type="button" onClick={addLine}
          className="mt-1 flex items-center gap-1.5 text-sm text-brand font-medium hover:underline">
          <Plus className="h-4 w-4" /> Add line item
        </button>

        {lines.some(l => l.status === 'unfulfilled') && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 p-3 mt-1">
            <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Unfulfilled items will require a new purchase request. Mark them as cancelled if no longer needed.
            </p>
          </div>
        )}

        {/* Phase 2 budget check — preview only, never blocks (see src/lib/budgetCheck.ts) */}
        {flaggedChecks.length > 0 && (
          <div className="space-y-1.5 mt-1">
            {flaggedChecks.map((r, i) => (
              <div key={i} className={`flex items-start gap-2 rounded-lg p-3 border ${
                r.outcome === 'block'
                  ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700/40'
                  : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700/40'
              }`}>
                <ShieldAlert className={`h-4 w-4 flex-shrink-0 mt-0.5 ${r.outcome === 'block' ? 'text-red-600' : 'text-amber-600'}`} />
                <p className={`text-xs ${r.outcome === 'block' ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'}`}>
                  {r.message}
                  {r.outcome === 'block' && <span className="font-medium"> — preview only, not blocked (budget checks: preview only)</span>}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Section 3: Vendor context */}
      <div className={sectionCls}>
        <SectionHeader title="Vendor Context" sub="Optional — leave blank for procurement to decide" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Recommended Vendor">
            <SearchableSelect value={header.recommended_vendor_id ?? null} onChange={v => setHdr('recommended_vendor_id', v)} options={vendorOptions} placeholder="Select vendor…" />
          </Field>
          <Field label="Vendor Notes">
            <input type="text" className={inputCls} placeholder="e.g. ask for bulk discount…"
              value={header.vendor_recommendation ?? ''} onChange={e => setHdr('vendor_recommendation', e.target.value)} />
          </Field>
        </div>
      </div>
    </div>
  )
}
