import { useQuery, useQueryClient } from '@tanstack/react-query'
import { dropRecordCache } from '@/lib/queryCache'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState, useCallback, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { FormattedNumberInput } from '@/components/shared/FormattedNumberInput'
import type { Order, OrderInsert, OrderPriority, OrderItem, OrderItemStatus } from '@/types/database'
import {
  useProjects, useStaff, useVendors, useUserProfiles, useSubCategoriesAll, useRecentOrderItems,
} from '@/hooks/useLookups'
import { useStockMatches, useStockUnits, canonicalUnit, stockNameKey, FALLBACK_UNITS, type StockMatch } from '@/lib/stockMatch'
import { StockNameInput } from '@/components/stock/StockNameInput'
import { UnitSelect } from '@/components/stock/UnitSelect'
import { LinkedStockChip, DidYouMean } from '@/components/stock/StockLineLink'
import { useToast } from '@/contexts/ToastContext'
import { submitted } from '@/lib/celebrate'
import { useAuth } from '@/contexts/AuthContext'
import { useMyManagedProjects, useMyWorkProjects } from '@/hooks/useMyStaff'
import { formatDate } from '@/lib/utils'
import { checkProjectBudget, logBudgetCheck, type BudgetCheckResult } from '@/lib/budgetCheck'
import { useLatestPrice, FRESHNESS_CLASS, FRESHNESS_LABEL } from '@/hooks/useMarketPrices'
import { RequestPriceCheckModal } from '@/components/shared/RequestPriceCheckModal'
import { formatCurrency as fmtCurrency } from '@/lib/utils'
import { FactList, Panel, RecordHeader, RecordLayout } from '@/components/record/Record'
import { Segmented } from '@/components/shared/Segmented'
import {
  Plus, Trash2, Package, History, Zap, Search, ChevronRight, AlertCircle, ShieldAlert,
  Sparkles, Copy, Save, ClipboardList, StickyNote, Receipt, AlertTriangle,
} from 'lucide-react'

const inputCls = 'w-full rounded-md border dark:border-slate-600 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors dark:bg-slate-800 dark:text-slate-100'

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

const PRIORITY_LABEL: Record<OrderPriority, string> = { normal: 'Normal', urgent: 'Urgent', critical: 'Critical' }

const ITEM_STATUSES: { value: OrderItemStatus; label: string }[] = [
  { value: 'pending',                label: 'Pending' },
  { value: 'sourced',                label: 'Sourced' },
  { value: 'partially_sourced',      label: 'Partially Sourced' },
  { value: 'stock_pending_dispatch', label: 'Stock — Awaiting Dispatch' },
  { value: 'stock_fulfilled',        label: 'Stock Fulfilled' },
  { value: 'unfulfilled',            label: 'Unfulfilled' },
  { value: 'cancelled',              label: 'Cancelled' },
]

// ── Line item state ────────────────────────────────────────────────────────────
type LineItem = {
  _id: string           // stable local key
  dbId?: string         // set once saved
  sub_category_id: string | null
  stock_item_id: string | null
  propose_new_stock_item: boolean
  item_name: string
  specifications: string
  quantity: string
  unit: string
  unit_price_est: string
  needs_market_check: boolean
  status: OrderItemStatus
  fulfillment_notes: string
  showSpecs: boolean
  not_in_stock: boolean  // the requester said it isn't any of the stock matches (form only)
}

function newLine(overrides: Partial<LineItem> = {}): LineItem {
  return {
    _id: crypto.randomUUID(),
    sub_category_id: null,
    stock_item_id: null,
    propose_new_stock_item: false,
    item_name: '',
    specifications: '',
    quantity: '',
    unit: 'pcs',
    unit_price_est: '',
    needs_market_check: false,
    status: 'pending',
    fulfillment_notes: '',
    showSpecs: false,
    not_in_stock: false,
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

// ── Materials stock-first check (per line row) ─────────────────────────────────
// A line linked to a stock item shows its live on-hand qty inline — the
// automatic, no-extra-click check the PR flow requires (091's
// check_and_fulfill_from_stock RPC does the actual fulfillment on save; this
// is just the "does stock cover this" preview so the requester isn't
// surprised by what happens after they hit save). Linking happens in the
// name box: picking a stock match, or typing a name that is exactly one.
function StockLinkControl({ item, onChange }: { item: LineItem; onChange: (patch: Partial<LineItem>) => void }) {
  if (item.stock_item_id) {
    return (
      <LinkedStockChip stockItemId={item.stock_item_id} requestedQty={parseFloat(item.quantity) || 0}
        onUnlink={() => onChange({ stock_item_id: null, not_in_stock: true })} />
    )
  }
  return (
    <label className={`flex items-center gap-1.5 text-[10px] cursor-pointer select-none transition-colors w-fit ${
      item.propose_new_stock_item ? 'text-brand' : 'text-slate-400 hover:text-brand'
    }`}>
      <input type="checkbox" className="accent-brand"
        checked={item.propose_new_stock_item}
        onChange={e => onChange({ propose_new_stock_item: e.target.checked })} />
      <Sparkles className="h-3 w-3" /> New to stock — worth cataloguing for reorder (not a one-off)
    </label>
  )
}

// ── Market-price hint (per line row, when a stock_item is linked) ─────────────
// Shows the latest-known price + freshness for the linked stock_item and,
// only if the price field is still empty, offers a one-click "use this
// price" fill. The user's manual entry is never overwritten. Outdated
// prices sprout a "Request check now" launcher (auto-creates a linked
// check request via the order_item, closing the loop server-side).
function MarketPriceHint({ item, onChange }: { item: LineItem; onChange: (patch: Partial<LineItem>) => void }) {
  const { data: perf } = useLatestPrice(item.stock_item_id ?? undefined)
  const [reqOpen, setReqOpen] = useState(false)
  if (!item.stock_item_id) return null
  if (!perf || perf.display_price == null) {
    return <p className="text-[10px] text-slate-400">No market price on file for this item — <button type="button" onClick={() => setReqOpen(true)} className="text-brand hover:underline">request a check</button>.
      {reqOpen && perf && <RequestPriceCheckModal stockItem={{ id: perf.stock_item_id, item_name: perf.item_name }} orderItemId={item.dbId ?? undefined} onClose={() => setReqOpen(false)} />}
    </p>
  }
  const priceEmpty = !item.unit_price_est || Number(item.unit_price_est) === 0
  return (
    <div className="flex items-center gap-2 flex-wrap text-[11px]">
      <span className={`inline-block text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border ${FRESHNESS_CLASS[perf.freshness]}`}>
        {FRESHNESS_LABEL[perf.freshness]}
      </span>
      <span className="text-slate-500 dark:text-slate-400">
        Latest: <span className="font-medium tabular-nums text-slate-700 dark:text-slate-200">{fmtCurrency(perf.display_price)}</span>
        {perf.days_since_display_price != null && <span className="text-slate-400"> · {perf.days_since_display_price}d old</span>}
        {perf.display_vendor_name && <span className="text-slate-400"> · {perf.display_vendor_name}</span>}
      </span>
      {priceEmpty && (
        <button type="button" onClick={() => onChange({ unit_price_est: String(perf.display_price) })}
          className="text-brand hover:underline">
          Use this price
        </button>
      )}
      {(perf.freshness === 'stale' || perf.freshness === 'outdated') && (
        <>
          <span className="text-slate-400">·</span>
          <button type="button" onClick={() => setReqOpen(true)} className="text-red-600 hover:underline">
            Request fresh check
          </button>
        </>
      )}
      {reqOpen && (
        <RequestPriceCheckModal
          stockItem={{ id: perf.stock_item_id, item_name: perf.item_name }}
          orderItemId={item.dbId ?? undefined}
          onClose={() => setReqOpen(false)}
        />
      )}
    </div>
  )
}

// ── Line item row ──────────────────────────────────────────────────────────────
function LineItemRow({
  item, index, isEdit, subCategories, recentItems, dupOf, canCombine,
  onChange, onRemove, onCombine,
}: {
  item: LineItem; index: number; isEdit: boolean
  subCategories: ReturnType<typeof useSubCategoriesAll>['data']
  recentItems: ReturnType<typeof useRecentOrderItems>['data']
  dupOf: number | null      // an earlier line of this request that is the same item
  canCombine: boolean
  onChange: (patch: Partial<LineItem>) => void
  onRemove: () => void
  onCombine: () => void
}) {
  const [showCatalog, setShowCatalog] = useState(false)
  const [nameFocused, setNameFocused] = useState(false)
  const { data: unitList } = useStockUnits()
  const units = unitList?.length ? unitList : FALLBACK_UNITS
  const { data: matches = [], isFetching: matching } = useStockMatches(item.item_name, { enabled: !item.stock_item_id })
  const liveMatches = item.stock_item_id ? [] : matches

  function pickStock(m: StockMatch) {
    onChange({
      stock_item_id: m.id,
      item_name: m.item_name,
      unit: m.unit,
      sub_category_id: item.sub_category_id ?? m.sub_category_id,
      propose_new_stock_item: false,
      not_in_stock: false,
    })
  }

  // Leaving the name box on a name that IS a stock item (same words, any
  // order, case or punctuation — or a name it was merged from) in the same
  // unit links it without asking. Anything less certain is a suggestion.
  function autoLinkExact() {
    if (item.stock_item_id || item.not_in_stock) return
    const key = stockNameKey(item.item_name)
    const top = matches[0]
    if (!key || !top || top.match !== 'same') return
    const sameName = stockNameKey(top.item_name) === key || (!!top.alias_name && stockNameKey(top.alias_name) === key)
    const unit = canonicalUnit(units, item.unit)
    if (sameName && (!unit || unit === top.unit)) pickStock(top)
  }

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
    pending:                'border-l-slate-300',
    sourced:                'border-l-green-400',
    partially_sourced:      'border-l-amber-400',
    stock_fulfilled:        'border-l-emerald-400',
    stock_pending_dispatch: 'border-l-sky-400',
    unfulfilled:            'border-l-red-400',
    cancelled:              'border-l-slate-200',
  }

  // Show the linked GL account name when a catalog item is selected
  const linkedAccount = item.sub_category_id
    ? (subCategories ?? []).find((s: any) => s.id === item.sub_category_id)?.item_name ?? null
    : null

  const hasFooter = item.showSpecs || (isEdit && item.status !== 'pending')

  return (
    <div className={`rounded-lg border dark:border-slate-700 bg-slate-50 dark:bg-slate-700/30 border-l-4 ${statusBorderCls[item.status]} overflow-visible`}>

      {/* Mobile (below sm): a stacked card — index+name+remove on one
      line, then Qty/Unit paired, then Price/Status paired. sm and up:
      each wrapper below collapses via `sm:contents` (display:contents
      removes the wrapper from layout entirely) so its children become
      direct items of THIS grid, landing in the exact same fixed-width
      column template as before — desktop layout is unchanged. */}
      <div className={`space-y-2 p-3 sm:space-y-0 sm:grid sm:items-start sm:gap-x-2 sm:gap-y-0 ${
        isEdit
          ? 'sm:grid-cols-[1.5rem_minmax(0,1fr)_5.5rem_5rem_7rem_8rem_2rem]'
          : 'sm:grid-cols-[1.5rem_minmax(0,1fr)_5.5rem_5rem_7rem_2rem]'
      }`}>

        {/* Row index + item name + catalog picker (+ mobile-only remove) */}
        <div className="flex items-start gap-2 sm:contents">
          <span className="flex-shrink-0 pt-2.5 text-xs text-slate-400 font-mono sm:text-center">{index + 1}</span>

          <div className="relative min-w-0 flex-1">
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
              <StockNameInput
                className={`${inputCls} font-medium`}
                placeholder={`Item ${index + 1} — start typing to search stock…`}
                value={item.item_name}
                matches={liveMatches}
                loading={matching && !item.stock_item_id}
                onPick={pickStock}
                onChange={v => onChange({ item_name: v, not_in_stock: false, ...(item.stock_item_id ? { stock_item_id: null } : {}) })}
                onFocus={() => setNameFocused(true)}
                onBlur={() => { setNameFocused(false); autoLinkExact() }}
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

          {/* Remove — mobile only, inline and reachable without scrolling right */}
          <button type="button" onClick={onRemove} title="Remove item"
            className="sm:hidden flex-shrink-0 mt-1.5 rounded p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Qty + Unit — paired on mobile, independent grid columns at sm+ */}
        <div className="grid grid-cols-2 gap-2 sm:contents">
          <input type="number" min="0" step="any" className={inputCls} placeholder="Qty"
            value={item.quantity} onChange={e => onChange({ quantity: e.target.value })} />

          <div className="min-w-0">
            <UnitSelect className={`${inputCls} px-2`} value={item.unit} onChange={u => onChange({ unit: u })} />
          </div>
        </div>

        {/* Est. price + Status — paired on mobile, independent grid columns at sm+ */}
        <div className={`grid gap-2 sm:contents ${isEdit ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <FormattedNumberInput className={inputCls} placeholder="Est. price"
            value={item.unit_price_est ? Number(item.unit_price_est) : null}
            onChange={n => onChange({ unit_price_est: n != null ? String(n) : '' })} />

          {isEdit && (
            <select className={`${inputCls} text-xs`} value={item.status}
              onChange={e => onChange({ status: e.target.value as OrderItemStatus })}>
              {ITEM_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          )}
        </div>

        {/* Remove — sm+ only, its own grid column matching the original layout */}
        <button type="button" onClick={onRemove} title="Remove item"
          className="hidden sm:block mt-1.5 rounded p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* ── Full-width footer: specs / market check / fulfillment notes ── */}
      {(hasFooter || true) && (
        <div className="px-3 pb-3 space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
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
          {dupOf != null && (
            <div className="flex items-center gap-2 flex-wrap rounded-md bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-700/40 px-2.5 py-1.5">
              <Copy className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
              <span className="text-[11px] text-sky-800 dark:text-sky-300">Same item as line {dupOf + 1}.</span>
              {canCombine ? (
                <button type="button" onClick={onCombine} className="text-[11px] font-medium text-brand hover:underline">
                  Add this quantity to line {dupOf + 1}
                </button>
              ) : (
                <span className="text-[11px] text-sky-700/80 dark:text-sky-300/80">Different units — check both lines.</span>
              )}
            </div>
          )}
          {!item.stock_item_id && !item.not_in_stock && !nameFocused && item.item_name.trim().length >= 3 && (
            <DidYouMean matches={matches} unit={item.unit} onPick={pickStock}
              onDifferent={() => onChange({ not_in_stock: true })} />
          )}
          {/* Market-price hint for the linked stock item (freshness + budget suggestion) */}
          <MarketPriceHint item={item} onChange={onChange} />
          {/* Materials stock-first check — see check_and_fulfill_from_stock (091) */}
          <StockLinkControl item={item} onChange={onChange} />
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

  // A purchase request must be raised against a project the requester is
  // actually responsible for. Roles with company-wide remit keep the
  // full list; for everyone else, if they're a named project manager the
  // picker is narrowed to their own projects — otherwise a PM could pick
  // any of the ~89 projects from the dropdown, which is what was
  // happening. The database enforces the same rule independently
  // (raa_orders_insert, migration 155), so this is the honest UI for a
  // restriction that already holds server-side, not the restriction
  // itself.
  const { projects: managedProjects, managesAny } = useMyManagedProjects()
  const hasCompanyWideProjectAccess = !!role && ['admin', 'executive', 'finance', 'procurement_officer'].includes(role)
  const scopeToManaged = !hasCompanyWideProjectAccess && managesAny
  // A technician asks for the projects they work on (technician_own_orders, 388).
  const isTechnician = role === 'technician'
  const { projects: workProjects } = useMyWorkProjects(isTechnician)

  const projectOptions = useMemo(() => {
    const source: { id: string; project_name: string }[] =
      isTechnician ? workProjects
        : scopeToManaged ? managedProjects : (projects as { id: string; project_name: string }[])
    return source.map(p => ({ id: p.id, label: p.project_name }))
  }, [projects, managedProjects, scopeToManaged, isTechnician, workProjects])
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
    } : {
      status: 'pending', priority: 'normal', is_new_item: false, requested_by_user_id: profile?.id ?? null,
      // Opened from a project page (?project_id=): that project is already chosen.
      project_id: new URLSearchParams(window.location.search).get('project_id'),
    }
  )

  // Line items state
  const [lines, setLines] = useState<LineItem[]>(() => {
    if (existingItems.length > 0) {
      return existingItems.map(item => ({
        _id: item.id,
        dbId: item.id,
        sub_category_id: item.sub_category_id,
        stock_item_id: item.stock_item_id,
        propose_new_stock_item: item.propose_new_stock_item ?? false,
        item_name: item.item_name,
        specifications: item.specifications ?? '',
        quantity: item.quantity?.toString() ?? '',
        unit: item.unit ?? 'pcs',
        unit_price_est: item.unit_price_est?.toString() ?? '',
        needs_market_check: item.needs_market_check ?? false,
        status: item.status,
        fulfillment_notes: item.fulfillment_notes ?? '',
        showSpecs: !!item.specifications,
        not_in_stock: false,
      }))
    }
    return [newLine()]
  })

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function setHdr(key: keyof OrderInsert, value: unknown) { setHeader(h => ({ ...h, [key]: value })) }

  const updateLine = useCallback((idx: number, patch: Partial<LineItem>) => {
    setLines(ls => ls.map((l, i) => i === idx ? { ...l, ...patch } : l))
  }, [])

  const removeLine = useCallback((idx: number) => {
    setLines(ls => ls.length <= 1 ? [newLine()] : ls.filter((_, i) => i !== idx))
  }, [])

  const addLine = useCallback(() => setLines(ls => [...ls, newLine()]), [])

  // Two lines of one request that are the same item (same stock item, or
  // names that reduce to the same words) — offered as one line instead.
  const dupOf = useMemo(() => {
    const seen = new Map<string, number>()
    return lines.map((l, i) => {
      const keys = [
        l.stock_item_id ? `id:${l.stock_item_id}` : '',
        l.item_name.trim() ? `name:${stockNameKey(l.item_name)}` : '',
      ].filter(k => k && k !== 'name:')
      const hit = keys.map(k => seen.get(k)).find(v => v !== undefined)
      if (hit !== undefined) return hit
      for (const k of keys) seen.set(k, i)
      return null
    })
  }, [lines])

  const combineLine = useCallback((idx: number, into: number) => {
    setLines(ls => {
      const from = ls[idx], to = ls[into]
      if (!from || !to) return ls
      const qty = (parseFloat(to.quantity) || 0) + (parseFloat(from.quantity) || 0)
      const specs = [to.specifications, from.specifications].filter(Boolean).join('\n')
      return ls
        .map((l, i) => i === into ? { ...l, quantity: qty ? String(qty) : l.quantity, specifications: specs, showSpecs: l.showSpecs || !!specs } : l)
        .filter((_, i) => i !== idx)
    })
  }, [])

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
  // Migration 163 retired the purchase request as an approval step
  // entirely — the Materials chain has no PR gate. Authority is
  // exercised downstream at pre-sourcing finance review and at bundle
  // approval by amount. The status is still displayed because historical
  // rows carry real values, but nothing here approves any more.
  const canResubmit = isEdit && approvalStatus === 'rejected' && (role === 'admin' || role === 'executive')

  async function handleApprovalTransition(nextStatus: string, extra: Record<string, unknown> = {}) {
    if (!id) return
    const { error: err } = await supabase.from('orders').update({ approval_status: nextStatus, ...extra }).eq('id', id)
    if (err) { toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['order', id] })
    qc.invalidateQueries({ queryKey: ['orders'] })
    toast('Approval updated', 'success')
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
      stock_item_id: l.stock_item_id,
      propose_new_stock_item: l.propose_new_stock_item,
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

    const { data: savedItems, error: itemErr } = await supabase.from('order_items').upsert(toUpsert).select('id, stock_item_id, status')
    if (itemErr) { setSaving(false); setError(itemErr.message); toast(itemErr.message, 'error'); return }

    // Materials stock-first check — automatic, no extra click, but no
    // longer draws stock down on its own. It only FLAGS a line as
    // stock_pending_dispatch when on-hand covers some or all of it;
    // the actual stock-out happens later, when a stock officer signs
    // off and assigns a transport job (see sign_off_stock_dispatch,
    // migration 115). Only lines linked to a stock item and still
    // 'pending' get checked; a line with nothing to draw on is a
    // no-op and proceeds to external procurement exactly as before.
    const toCheck = (savedItems ?? []).filter(i => i.stock_item_id && i.status === 'pending')
    if (toCheck.length > 0) {
      const results = await Promise.all(
        toCheck.map(i => supabase.rpc('check_and_fulfill_from_stock', { p_order_item_id: i.id }))
      )
      const fulfilledCount = results.filter(r => !r.error && (r.data?.[0]?.proposed_qty ?? 0) > 0).length
      if (fulfilledCount > 0) {
        toast(`${fulfilledCount} line item${fulfilledCount !== 1 ? 's' : ''} covered by stock — awaiting stock officer sign-off`, 'success')
      }
    }

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
    dropRecordCache(qc, 'order', 'order-items')
    qc.invalidateQueries({ queryKey: ['orders'] })
    qc.invalidateQueries({ queryKey: ['order-items', orderId] })
    qc.invalidateQueries({ queryKey: ['order-item-counts'] })
    qc.invalidateQueries({ queryKey: ['recent-order-items'] })
    if (isEdit) toast('Purchase request updated', 'success')
    else submitted(toast, 'Purchase request submitted', 'Procurement can see it now')
    navigate('/purchase-requests')
  }

  const filled = lines.filter(l => l.item_name.trim())
  const filledCount = filled.length
  const estimatedTotal = filled.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.unit_price_est) || 0), 0)
  const unpriced = filled.filter(l => !(parseFloat(l.unit_price_est) > 0)).length
  const fromStock = filled.filter(l => l.stock_item_id).length
  const neededIn = header.required_by_date
    ? Math.round((new Date(header.required_by_date).getTime() - new Date(new Date().toDateString()).getTime()) / 86400000)
    : null
  const saveLabel = saving ? 'Saving…' : isEdit ? 'Save changes' : 'Submit request'
  const showApproval = isEdit && (approvalStatus === 'rejected' || !!record?.manager_approved_by || !!record?.finance_approved_by)

  return (
    <div className="pb-20 sm:pb-0">
      <RecordHeader
        back={isEdit ? { to: `/purchase-requests/${id}`, label: 'Back to the request' } : { to: '/purchase-requests', label: 'Purchase requests' }}
        code={record?.request_code ?? null}
        title={isEdit ? 'Edit purchase request' : 'New purchase request'}
        subtitle={isEdit ? undefined : 'What you need, for which project, and by when — procurement takes it from here'}
        actions={[
          { label: 'Cancel', to: isEdit ? `/purchase-requests/${id}` : '/purchase-requests' },
          { label: saveLabel, icon: Save, primary: true, onClick: handleSave, disabled: saving },
        ]}
      />

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-700/50 dark:bg-red-900/20 dark:text-red-400">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />{error}
        </div>
      )}

      <RecordLayout
        main={<>
          {showApproval && (
            <div className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 text-xs ${approvalStatus === 'rejected'
              ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-800/40 dark:bg-red-900/10 dark:text-red-300'
              : 'bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-700/30'}`}>
              <StatusBadge status={approvalStatus} />
              {record?.manager_approved_by && <span>Manager: {profileName(record.manager_approved_by)} · {formatDate(record.manager_approved_at)}</span>}
              {record?.finance_approved_by && <span>Finance: {profileName(record.finance_approved_by)} · {formatDate(record.finance_approved_at)}</span>}
              {approvalStatus === 'rejected' && record?.rejection_reason && <span className="font-medium">Rejected: {record.rejection_reason}</span>}
              {canResubmit && (
                <button type="button" onClick={() => handleApprovalTransition('pending')}
                  className="ml-auto rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90">Resubmit</button>
              )}
            </div>
          )}

          <Panel title="What and where" icon={ClipboardList}>
            <div className="space-y-4">
              <Field label="Title">
                <input type="text" className={`${inputCls} text-base font-medium`} placeholder="e.g. Kitchen hardware for the Mesob fit-out"
                  value={header.order_name ?? ''} onChange={e => setHdr('order_name', e.target.value || null)} />
              </Field>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Project">
                  <SearchableSelect value={header.project_id ?? null} onChange={v => setHdr('project_id', v)} options={projectOptions} placeholder="Search projects…" />
                  {isTechnician ? (
                    <p className="mt-1 text-[11px] text-slate-400">
                      {workProjects.length ? 'The projects you work on.' : 'You are not on a project yet — ask your manager to assign you.'}
                    </p>
                  ) : scopeToManaged && (
                    <p className="mt-1 text-[11px] text-slate-400">
                      The {managedProjects.length} project{managedProjects.length === 1 ? '' : 's'} you manage.
                    </p>
                  )}
                </Field>
                <Field label="Needed by">
                  <input type="date" className={inputCls} value={header.required_by_date ?? ''}
                    onChange={e => setHdr('required_by_date', e.target.value || null)} />
                </Field>
              </div>
              <Field label="How urgent">
                <Segmented value={(header.priority ?? 'normal') as OrderPriority} onChange={v => setHdr('priority', v)} ariaLabel="How urgent"
                  options={[
                    { value: 'normal', label: 'Normal' },
                    { value: 'urgent', label: 'Urgent', icon: AlertTriangle, tone: 'amber' },
                    { value: 'critical', label: 'Critical', icon: AlertCircle, tone: 'red' },
                  ]} />
              </Field>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="Requested by">
                  <div className={`${inputCls} cursor-default select-none bg-slate-50 text-slate-600 dark:bg-slate-700/50 dark:text-slate-300`}>
                    {profileName(header.requested_by_user_id ?? null) ?? profile?.full_name ?? 'You'}
                  </div>
                </Field>
                <Field label="Procurement officer">
                  <SearchableSelect value={header.staff_id ?? null} onChange={v => setHdr('staff_id', v)} options={staffOptions} placeholder="Leave for procurement" />
                </Field>
                <Field label="Request date">
                  <input type="date" className={inputCls} value={header.order_date ?? ''}
                    onChange={e => setHdr('order_date', e.target.value || null)} />
                </Field>
              </div>
            </div>
          </Panel>

          <Panel title="Items" icon={Package} count={filledCount}
            action={estimatedTotal > 0 && <span className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200">{fmtCurrency(estimatedTotal)}</span>}>
            <p className="-mt-1 mb-3 text-xs text-slate-400">Type a name to find it in stock — stock is checked before anything is bought. <Package className="inline h-3 w-3" /> picks the account.</p>

            {/* Column labels — match LineItemRow's grid; a phone gets stacked cards instead. */}
            <div className={`hidden gap-x-2 px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 sm:grid ${
              isEdit
                ? 'grid-cols-[1.5rem_minmax(0,1fr)_5.5rem_5rem_7rem_8rem_2rem]'
                : 'grid-cols-[1.5rem_minmax(0,1fr)_5.5rem_5rem_7rem_2rem]'
            }`}>
              <span />
              <span>Item</span>
              <span>Qty</span>
              <span>Unit</span>
              <span>Est. price</span>
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
                  dupOf={dupOf[idx]}
                  canCombine={dupOf[idx] != null && line.status === 'pending' && lines[dupOf[idx]!].status === 'pending' && lines[dupOf[idx]!].unit === line.unit}
                  onChange={patch => updateLine(idx, patch)}
                  onRemove={() => removeLine(idx)}
                  onCombine={() => { if (dupOf[idx] != null) combineLine(idx, dupOf[idx]!) }}
                />
              ))}
            </div>

            <button type="button" onClick={addLine}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border-2 border-dashed py-2.5 text-sm font-medium text-brand transition-colors hover:border-brand hover:bg-brand/5 dark:border-slate-600">
              <Plus className="h-4 w-4" /> Add an item
            </button>

            {lines.some(l => l.status === 'unfulfilled') && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-700/40 dark:bg-amber-900/20">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Unfulfilled items need a new purchase request. Mark them cancelled if they're no longer needed.
                </p>
              </div>
            )}
          </Panel>

          <Panel title="Notes for procurement" icon={StickyNote}>
            <div className="space-y-4">
              <Field label="Notes">
                <textarea rows={3} className={inputCls} placeholder="Where it goes, finish or brand to match, who to call on site…"
                  value={header.notes ?? ''} onChange={e => setHdr('notes', e.target.value)} />
              </Field>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="A vendor you'd suggest (optional)">
                  <SearchableSelect value={header.recommended_vendor_id ?? null} onChange={v => setHdr('recommended_vendor_id', v)} options={vendorOptions} placeholder="Leave for procurement" />
                </Field>
                <Field label="About the vendor">
                  <input type="text" className={inputCls} placeholder="e.g. had it last time, ask for a bulk price"
                    value={header.vendor_recommendation ?? ''} onChange={e => setHdr('vendor_recommendation', e.target.value)} />
                </Field>
              </div>
            </div>
          </Panel>
        </>}
        rail={<div className="space-y-4 lg:sticky lg:top-28">
          <Panel title="Summary" icon={Receipt}>
            <FactList facts={[
              { label: 'Items', value: filledCount, hint: fromStock > 0 ? `${fromStock} found in stock` : undefined },
              { label: 'Estimated total', value: estimatedTotal > 0 ? fmtCurrency(estimatedTotal) : '—', hint: unpriced > 0 ? `${unpriced} item${unpriced === 1 ? '' : 's'} without an estimate` : undefined, tone: unpriced > 0 && filledCount > 0 ? 'amber' : undefined },
              { label: 'Needed by', value: header.required_by_date ? formatDate(header.required_by_date) : 'Not set',
                hint: neededIn == null ? undefined : neededIn < 0 ? `${-neededIn} days ago` : neededIn === 0 ? 'Today' : `In ${neededIn} day${neededIn === 1 ? '' : 's'}`,
                tone: neededIn != null && neededIn < 3 ? 'red' : undefined },
              { label: 'Urgency', value: PRIORITY_LABEL[(header.priority ?? 'normal') as OrderPriority], tone: header.priority === 'critical' ? 'red' : header.priority === 'urgent' ? 'amber' : undefined },
            ]} />
            <p className="mt-3 border-t pt-3 text-[11px] leading-relaxed text-slate-400 dark:border-slate-700">
              After you submit: stock is checked first, then procurement puts the rest on a purchase order and finance approves it.
            </p>
          </Panel>

          {/* Budget check — a preview only, never blocks (see src/lib/budgetCheck.ts). */}
          {flaggedChecks.map((r, i) => (
            <div key={i} className={`flex items-start gap-2 rounded-xl border p-3 ${r.outcome === 'block'
              ? 'border-red-200 bg-red-50 dark:border-red-700/40 dark:bg-red-900/20'
              : 'border-amber-200 bg-amber-50 dark:border-amber-700/40 dark:bg-amber-900/20'}`}>
              <ShieldAlert className={`mt-0.5 h-4 w-4 flex-shrink-0 ${r.outcome === 'block' ? 'text-red-600' : 'text-amber-600'}`} />
              <p className={`text-xs ${r.outcome === 'block' ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'}`}>
                {r.message}
                {r.outcome === 'block' && <span className="font-medium"> — a preview, not blocked</span>}
              </p>
            </div>
          ))}
        </div>}
      />
    </div>
  )
}
