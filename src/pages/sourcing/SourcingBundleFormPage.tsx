import { useState, useMemo, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { dropRecordCache } from '@/lib/queryCache'
import { supabase } from '@/lib/supabase'
import { fetchAllRows } from '@/lib/fetchAllRows'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency } from '@/lib/utils'
import type { SourcingBundleInsert, SourcingBundlePaymentPattern, SourcingBundleDiscountKind, SourcingBundleStatus } from '@/types/database'
import { checkProjectBudget, logBudgetCheck, type BudgetCheckResult } from '@/lib/budgetCheck'
import { BundleLineStock } from '@/components/stock/BundleLineStock'
import { useVariantsForItems } from '@/hooks/useItemVariants'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { Segmented } from '@/components/shared/Segmented'
import { Panel, RecordHeader, RecordLayout } from '@/components/record/Record'
import { PO_STATUS, PRICE_CHECK_PERCENT, priceOverEstimate } from '@/lib/purchasing'
import {
  Plus, Trash2, Search, Package, AlertCircle, ShieldAlert, Zap, Layers, Tag,
  Save, Store, Truck, Banknote, ClipboardList, Receipt, TrendingUp,
} from 'lucide-react'

type OrderRow = {
  id: string
  request_code: string | null
  order_name: string | null
  project_id: string | null
  approval_status: string
  priority: string | null
  required_by_date: string | null
  is_new_item: boolean
  projects: { project_name: string } | null
}

type OrderItemRow = {
  id: string
  order_id: string
  item_name: string
  specifications: string | null
  quantity: number
  unit: string | null
  unit_price_est: number | null
  status: string
  stock_dispatch_qty: number | null
  stock_item_id: string | null
  sub_categories: { parent_category_id: string | null; categories: { cost_group_id: string | null } | null } | null
}

const VAT_RATE = 0.15
const WHT_RATE = 0.03

type VendorRow = {
  id: string
  vendor_name: string
  wth_eligible: boolean | null
}

type BundleLineItem = {
  _key: string
  order_item_id: string
  item_name: string
  unit: string | null
  quantity_requested: number
  source_pr_code: string
  project_name: string | null
  quantity_actual: string
  unit_price_actual: string
  notes: string
  sort_order: number
  stock_item_id: string | null
  orig_stock_item_id: string | null  // as saved on the request line; changed ones are written back
  // Which product of the stock item was bought (372) — 6 mm or 16 mm,
  // the 3 L or the 15 L — so its price joins the right trend.
  variant_id: string | null
}

export default function SourcingBundleFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { toast } = useToast()
  const { profile } = useAuth()

  const [vendorId, setVendorId] = useState<string>('')
  const [vendorName, setVendorName] = useState<string>('')
  const [deliveryDate, setDeliveryDate] = useState<string>('')
  const [paymentPattern, setPaymentPattern] = useState<SourcingBundlePaymentPattern>('pay_on_delivery')
  const [notes, setNotes] = useState<string>('')
  const [discountKind, setDiscountKind] = useState<SourcingBundleDiscountKind>('none')
  const [discountValue, setDiscountValue] = useState<string>('')
  const [discountReason, setDiscountReason] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [itemSearch, setItemSearch] = useState<string>('')
  const [bundleItems, setBundleItems] = useState<BundleLineItem[]>([])
  const [existingLoaded, setExistingLoaded] = useState(false)

  const { data: existingBundle } = useQuery({
    queryKey: ['sourcing-bundle', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sourcing_bundles')
        .select('*, sourcing_bundle_items(*)')
        .eq('id', id!)
        .single()
      if (error) throw error
      return data
    },
    enabled: isEdit,
  })

  const { data: vendors = [] } = useQuery({
    queryKey: ['vendors-list'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vendors').select('id, vendor_name, wth_eligible').order('vendor_name')
      if (error) throw error
      return (data ?? []) as VendorRow[]
    },
  })

  const selectedVendor = useMemo(() => vendors.find(v => v.id === vendorId), [vendors, vendorId])

  // A purchase request is sourceable as soon as it exists — the
  // PR-level approval ladder was retired in migration 149. Operations
  // Manual v0.1 §4.1's Materials chain is "Need -> stock check -> (if
  // short) sourcing -> PO -> GRN -> expense": there is no PR approval
  // step in it, and the one that existed resolved to admin-only (the
  // `manager` role it checked had no holders), making every single
  // request wait on one person.
  //
  // The real gates are unchanged and both still apply downstream:
  // the finance sourcing review per line (147, enforced by trigger on
  // sourcing_bundle_items), and the PO approval by amount threshold.
  // Explicitly-rejected requests are still excluded.
  const { data: approvedOrders = [] } = useQuery({
    queryKey: ['sourceable-orders'],
    queryFn: async () => {
      const data = await fetchAllRows((from, to) => supabase
        .from('orders')
        .select('id, request_code, order_name, project_id, approval_status, priority, required_by_date, is_new_item, projects(project_name)')
        .neq('approval_status', 'rejected')
        .order('created_at', { ascending: false }).order('id')
        .range(from, to))
      return data as unknown as OrderRow[]
    },
  })

  // Every open request line, filtered to the non-rejected requests here
  // rather than by listing the request ids in the URL: with a few hundred
  // requests that URL ran to 13 KB and grew with every new request.
  const { data: openOrderItems = [] } = useQuery({
    queryKey: ['order-items-for-sourcing'],
    queryFn: async () => {
      const data = await fetchAllRows((from, to) => supabase
        .from('order_items')
        .select('*, sub_categories(parent_category_id, categories(cost_group_id))')
        .neq('status', 'cancelled')
        .order('id').range(from, to))
      return data as unknown as OrderItemRow[]
    },
  })
  const allOrderItems = useMemo(() => {
    const sourceable = new Set(approvedOrders.map(o => o.id))
    return openOrderItems.filter(i => sourceable.has(i.order_id))
  }, [openOrderItems, approvedOrders])

  const { data: bundledItemIds = new Set<string>() } = useQuery({
    queryKey: ['bundled-order-item-ids', id],
    queryFn: async () => {
      const data = await fetchAllRows((from, to) => supabase
        .from('sourcing_bundle_items')
        .select('order_item_id, bundle_id')
        .order('id').range(from, to))
      const excludeSet = new Set<string>()
      for (const row of data) {
        // Exclude items in other bundles; items in this bundle will be in bundleItems state
        if (row.bundle_id !== id) excludeSet.add(row.order_item_id)
      }
      return excludeSet
    },
  })

  // How much of each line has actually left the warehouse already
  // (stock_issues is the source of truth for that — order_items.
  // stock_dispatch_qty only holds the *proposed* amount and gets
  // cleared once signed off). Advisory only: informs the quantity a
  // procurement officer types in below, never auto-fills it. Every issue
  // tied to a request line, rather than one filter per line: the per-line
  // list made a 37 KB URL the gateway refused, and the form hung on it.
  const { data: stockIssuedByItem = {} } = useQuery({
    queryKey: ['stock-issued-by-order-item'],
    queryFn: async () => {
      const data = await fetchAllRows((from, to) => supabase
        .from('stock_issues')
        .select('order_item_id, quantity')
        .not('order_item_id', 'is', null)
        .order('id').range(from, to))
      const map: Record<string, number> = {}
      for (const row of data) {
        if (!row.order_item_id) continue
        map[row.order_item_id] = (map[row.order_item_id] ?? 0) + Number(row.quantity)
      }
      return map
    },
  })

  function stockBadge(item: OrderItemRow | undefined) {
    if (!item) return null
    if (item.status === 'stock_pending_dispatch' && (item.stock_dispatch_qty ?? 0) > 0) {
      return (
        <span className="text-[10px] font-medium text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-900/20 rounded px-1.5 py-0.5 whitespace-nowrap"
          title="Proposed from stock, awaiting stock officer sign-off — not yet actually dispatched">
          {item.stock_dispatch_qty} {item.unit ?? ''} from stock (pending)
        </span>
      )
    }
    const issued = stockIssuedByItem[item.id]
    if (issued && issued > 0) {
      return (
        <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 rounded px-1.5 py-0.5 whitespace-nowrap"
          title="Already dispatched from stock — reduce the vendor quantity accordingly">
          {issued} {item.unit ?? ''} already from stock
        </span>
      )
    }
    return null
  }

  function priorityBadge(priority: string | null) {
    if (!priority || priority === 'normal') return null
    return (
      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap ${
        priority === 'critical'
          ? 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400'
          : 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
      }`}>
        {priority === 'critical' ? 'Critical' : 'Urgent'}
      </span>
    )
  }

  function requiredByBadge(dateStr: string | null) {
    if (!dateStr) return null
    const days = Math.round((new Date(dateStr).getTime() - new Date().getTime()) / 86400000)
    const label = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Due today' : days === 1 ? 'Due tomorrow' : `Due in ${days}d`
    const cls = days < 0 ? 'text-red-600 dark:text-red-400 font-semibold'
      : days <= 3 ? 'text-amber-600 dark:text-amber-400 font-medium'
      : 'text-slate-400'
    return <span className={`shrink-0 text-[10px] whitespace-nowrap ${cls}`}>{label}</span>
  }

  const orderMap = useMemo(() => {
    const m: Record<string, OrderRow> = {}
    for (const o of approvedOrders) m[o.id] = o
    return m
  }, [approvedOrders])

  const orderItemMap = useMemo(() => {
    const m: Record<string, OrderItemRow> = {}
    for (const oi of allOrderItems) m[oi.id] = oi
    return m
  }, [allOrderItems])

  // Populate form when editing
  useEffect(() => {
    if (!existingBundle || existingLoaded) return
    setVendorId(existingBundle.vendor_id ?? '')
    setVendorName(existingBundle.vendor_name ?? '')
    setDeliveryDate(existingBundle.expected_delivery_date ?? '')
    setPaymentPattern(existingBundle.payment_pattern ?? 'pay_on_delivery')
    setNotes(existingBundle.notes ?? '')
    setDiscountKind((existingBundle.discount_kind ?? 'none') as SourcingBundleDiscountKind)
    setDiscountValue(existingBundle.discount_kind && existingBundle.discount_kind !== 'none'
      ? String(existingBundle.discount_value ?? '') : '')
    setDiscountReason(existingBundle.discount_reason ?? '')
    setExistingLoaded(true)
  }, [existingBundle, existingLoaded])

  // Populate bundle items when editing (after order items are loaded)
  useEffect(() => {
    if (!existingBundle?.sourcing_bundle_items?.length || !allOrderItems.length || !existingLoaded) return
    if (bundleItems.length > 0) return // already loaded
    const items: BundleLineItem[] = existingBundle.sourcing_bundle_items.map((sbi: any) => {
      const oi = orderItemMap[sbi.order_item_id]
      const order = oi ? orderMap[oi.order_id] : null
      return {
        _key: sbi.order_item_id,
        order_item_id: sbi.order_item_id,
        item_name: oi?.item_name ?? 'Unknown item',
        unit: oi?.unit ?? null,
        quantity_requested: oi?.quantity ?? 0,
        source_pr_code: order?.request_code ?? '—',
        project_name: order?.projects?.project_name ?? null,
        quantity_actual: sbi.quantity_actual != null ? String(sbi.quantity_actual) : '',
        unit_price_actual: sbi.unit_price_actual != null ? String(sbi.unit_price_actual) : '',
        notes: sbi.notes ?? '',
        sort_order: sbi.sort_order ?? 0,
        stock_item_id: oi?.stock_item_id ?? null,
        orig_stock_item_id: oi?.stock_item_id ?? null,
        variant_id: sbi.variant_id ?? null,
      }
    })
    setBundleItems(items)
  }, [existingBundle, allOrderItems, orderItemMap, orderMap, existingLoaded, bundleItems.length])

  const selectedIds = useMemo(() => new Set(bundleItems.map(i => i.order_item_id)), [bundleItems])
  const { data: variantsByItem } = useVariantsForItems(bundleItems.map(i => i.stock_item_id))

  const availableItems = useMemo(() =>
    allOrderItems.filter(item => !bundledItemIds.has(item.id) && !selectedIds.has(item.id)),
    [allOrderItems, bundledItemIds, selectedIds]
  )

  const filteredAvailable = useMemo(() => {
    const q = itemSearch.trim().toLowerCase()
    if (!q) return availableItems
    return availableItems.filter(item => {
      const order = orderMap[item.order_id]
      return (
        item.item_name.toLowerCase().includes(q) ||
        (order?.request_code ?? '').toLowerCase().includes(q) ||
        (order?.order_name ?? '').toLowerCase().includes(q) ||
        (order?.projects?.project_name ?? '').toLowerCase().includes(q)
      )
    })
  }, [availableItems, itemSearch, orderMap])

  // Overdue/urgent PRs first so a procurement officer scanning a long
  // list sees what actually needs sourcing today, instead of whatever
  // happened to be submitted most recently.
  function orderUrgencyRank(o: OrderRow): number {
    if (o.required_by_date) {
      const days = Math.round((new Date(o.required_by_date).getTime() - new Date().getTime()) / 86400000)
      if (days < 0) return 0
      if (days <= 3) return 1
    }
    if (o.priority === 'critical') return 1
    if (o.priority === 'urgent') return 2
    return o.required_by_date ? 2 : 3
  }

  const groupedAvailable = useMemo(() => {
    const groups: Record<string, { order: OrderRow; items: OrderItemRow[] }> = {}
    for (const item of filteredAvailable) {
      const order = orderMap[item.order_id]
      if (!order) continue
      if (!groups[order.id]) groups[order.id] = { order, items: [] }
      groups[order.id].items.push(item)
    }
    return Object.values(groups).sort((a, b) => {
      const rankDiff = orderUrgencyRank(a.order) - orderUrgencyRank(b.order)
      if (rankDiff !== 0) return rankDiff
      if (a.order.required_by_date && b.order.required_by_date) {
        return new Date(a.order.required_by_date).getTime() - new Date(b.order.required_by_date).getTime()
      }
      return 0
    })
  }, [filteredAvailable, orderMap])

  function toBundleLine(item: OrderItemRow, sortOrder: number): BundleLineItem {
    const order = orderMap[item.order_id]
    return {
      _key: item.id,
      order_item_id: item.id,
      item_name: item.item_name,
      unit: item.unit,
      quantity_requested: item.quantity,
      source_pr_code: order?.request_code ?? '—',
      project_name: order?.projects?.project_name ?? null,
      quantity_actual: String(item.quantity),
      unit_price_actual: item.unit_price_est != null ? String(item.unit_price_est) : '',
      notes: '',
      sort_order: sortOrder,
      stock_item_id: item.stock_item_id,
      orig_stock_item_id: item.stock_item_id,
      variant_id: null,
    }
  }

  function addItem(item: OrderItemRow) {
    setBundleItems(prev => [...prev, toBundleLine(item, prev.length)])
  }

  // Pulls a whole PR's remaining lines into the bundle in one click —
  // the common case for a procurement officer is sourcing everything
  // on a request together, not clicking each line individually.
  function addAllInGroup(items: OrderItemRow[]) {
    setBundleItems(prev => {
      const existingIds = new Set(prev.map(i => i.order_item_id))
      const additions = items
        .filter(item => !existingIds.has(item.id))
        .map((item, idx) => toBundleLine(item, prev.length + idx))
      return [...prev, ...additions]
    })
  }

  function removeItem(orderItemId: string) {
    setBundleItems(prev => prev.filter(i => i.order_item_id !== orderItemId))
  }

  function updateItem(orderItemId: string, patch: Partial<BundleLineItem>) {
    setBundleItems(prev => prev.map(i => i.order_item_id === orderItemId ? { ...i, ...patch } : i))
  }

  const runningTotal = useMemo(() =>
    bundleItems.reduce((sum, i) => sum + (parseFloat(i.quantity_actual) || 0) * (parseFloat(i.unit_price_actual) || 0), 0),
    [bundleItems]
  )

  // Mirrors resolve_bundle_discount() in migration 299 — clamped to the
  // subtotal, so a discount larger than the order shows as the whole order
  // off rather than a negative PO. The database is what actually decides;
  // this only keeps the figures on screen honest before saving.
  const discountAmount = useMemo(() => {
    const v = parseFloat(discountValue) || 0
    if (discountKind === 'none' || v <= 0) return 0
    const raw = discountKind === 'percent'
      ? Math.round(runningTotal * v) / 100
      : v
    return Math.min(Math.max(raw, 0), Math.max(runningTotal, 0))
  }, [discountKind, discountValue, runningTotal])

  // Everything downstream of here is on the discounted figure: the vendor
  // charges VAT on what it actually bills, and withholding is computed off
  // the same base.
  const netSubtotal = runningTotal - discountAmount
  const whtEligible = !!selectedVendor?.wth_eligible
  const vatAmount = netSubtotal * VAT_RATE
  const whtAmount = whtEligible ? netSubtotal * WHT_RATE : 0
  const netPayable = netSubtotal + vatAmount - whtAmount

  // ── Phase 2 warn-only budget check — grouped by (project, cost group),
  // since one bundle can pull items from PRs on different projects and
  // different cost groups. Never blocks; see src/lib/budgetCheck.ts ──
  // key: `${project_id}|${cost_group_id}` (empty string for unmapped)
  const bundleGroupTotals = useMemo(() => {
    const totals = new Map<string, { projectId: string; costGroupId: string; amount: number }>()
    for (const item of bundleItems) {
      const qty = parseFloat(item.quantity_actual) || 0
      const price = parseFloat(item.unit_price_actual) || 0
      if (qty <= 0 || price <= 0) continue
      const oi = orderItemMap[item.order_item_id]
      const order = oi ? orderMap[oi.order_id] : null
      if (!order?.project_id) continue
      const costGroupId = oi?.sub_categories?.categories?.cost_group_id ?? ''
      const key = `${order.project_id}|${costGroupId}`
      const existing = totals.get(key)
      totals.set(key, { projectId: order.project_id, costGroupId, amount: (existing?.amount ?? 0) + qty * price })
    }
    // A discount is negotiated on the order as a whole, so spread it across
    // the groups in proportion to what each contributes. Checking budgets
    // against the undiscounted lines would warn about money the project is
    // not going to spend.
    if (discountAmount > 0 && runningTotal > 0) {
      const ratio = netSubtotal / runningTotal
      for (const [key, g] of totals) totals.set(key, { ...g, amount: g.amount * ratio })
    }
    return totals
  }, [bundleItems, orderItemMap, orderMap, discountAmount, netSubtotal, runningTotal])

  const [budgetChecks, setBudgetChecks] = useState<Record<string, BudgetCheckResult>>({})

  useEffect(() => {
    let cancelled = false
    Promise.all([...bundleGroupTotals.entries()].map(async ([key, g]) => {
      const result = await checkProjectBudget(g.projectId, g.costGroupId || null, g.amount)
      return [key, result] as const
    })).then(results => { if (!cancelled) setBudgetChecks(Object.fromEntries(results)) })
    return () => { cancelled = true }
  }, [bundleGroupTotals])

  const flaggedChecks = Object.values(budgetChecks).filter(r => r.outcome === 'warn' || r.outcome === 'block')

  async function handleSave() {
    if (bundleItems.length === 0) { toast('Add at least one line to the purchase order', 'error'); return }
    setSaving(true)
    try {
      let bundleId = id
      let bundleCode: string | null = existingBundle?.bundle_code ?? null
      const bundleData: Partial<SourcingBundleInsert> = {
        vendor_id: vendorId || null,
        vendor_name: vendorId ? null : (vendorName || null),
        expected_delivery_date: deliveryDate || null,
        payment_pattern: paymentPattern,
        notes: notes || null,
        // Only what was typed goes to the server. discount_etb,
        // items_subtotal_etb and total_value are derived there (299) — a
        // client that sent its own would just be overwritten, and could
        // disagree with the figure the approval caps are checked against.
        discount_kind: discountKind,
        discount_value: discountKind === 'none' ? 0 : (parseFloat(discountValue) || 0),
        discount_reason: discountKind === 'none' ? null : (discountReason.trim() || null),
      }
      // Only stamp the procurement officer at creation — editing
      // shouldn't silently reassign attribution to whoever last saved.
      if (!isEdit) bundleData.procurement_officer_id = profile?.id ?? null

      // Track which items were in the bundle before this save, so we
      // can revert any that got removed back to 'pending'.
      const previousItemIds: string[] = isEdit
        ? ((existingBundle?.sourcing_bundle_items ?? []) as { order_item_id: string }[]).map(i => i.order_item_id)
        : []

      if (isEdit) {
        const { error } = await supabase.from('sourcing_bundles').update(bundleData).eq('id', id!)
        if (error) throw error
        await supabase.from('sourcing_bundle_items').delete().eq('bundle_id', id!)
      } else {
        const { data, error } = await supabase
          .from('sourcing_bundles')
          .insert(bundleData as SourcingBundleInsert)
          .select('id, bundle_code')
          .single()
        if (error) throw error
        bundleId = data.id
        bundleCode = data.bundle_code
      }

      // A stock link changed here goes onto the request line first: a line's
      // variant is checked against the line's stock item.
      const relinks = await Promise.all(bundleItems
        .filter(item => item.stock_item_id !== item.orig_stock_item_id)
        .map(item => supabase.from('order_items').update({ stock_item_id: item.stock_item_id }).eq('id', item.order_item_id)))
      const relinkError = relinks.find(r => r.error)?.error
      if (relinkError) throw relinkError

      const { error: itemError } = await supabase.from('sourcing_bundle_items').insert(
        bundleItems.map((item, idx) => ({
          bundle_id: bundleId!,
          order_item_id: item.order_item_id,
          quantity_actual: parseFloat(item.quantity_actual) || null,
          unit_price_actual: parseFloat(item.unit_price_actual) || null,
          notes: item.notes || null,
          sort_order: idx,
          variant_id: item.variant_id && variantsByItem?.get(item.stock_item_id ?? '')?.some(v => v.id === item.variant_id) ? item.variant_id : null,
        }))
      )
      if (itemError) throw itemError

      // Sync order_items.status: items now bundled become sourced (or
      // partially_sourced if less than the requested quantity was
      // actually sourced); items removed from this bundle go back to
      // pending so they're available to re-source.
      const currentIds = new Set(bundleItems.map(i => i.order_item_id))
      const removedIds = previousItemIds.filter(pid => !currentIds.has(pid))

      const sourcedUpdates = bundleItems.map(item => {
        const requested = item.quantity_requested
        const actual = parseFloat(item.quantity_actual) || 0
        const status = requested > 0 && actual < requested ? 'partially_sourced' : 'sourced'
        // A stock link procurement set or corrected here goes back onto the
        // request line, so goods received books the stock to that item.
        const relink = item.stock_item_id !== item.orig_stock_item_id ? { stock_item_id: item.stock_item_id } : {}
        return supabase.from('order_items').update({ status, ...relink }).eq('id', item.order_item_id)
      })
      const revertUpdates = removedIds.length > 0
        ? [supabase.from('order_items').update({ status: 'pending' }).in('id', removedIds)]
        : []
      const statusResults = await Promise.all([...sourcedUpdates, ...revertUpdates])
      const statusError = statusResults.find(r => r.error)?.error
      if (statusError) throw statusError

      // Log the warn-only budget check outcome for every (project, cost
      // group) present — best-effort, never blocks; see src/lib/budgetCheck.ts
      for (const [key, g] of bundleGroupTotals.entries()) {
        const result = budgetChecks[key]
        if (!result) continue
        logBudgetCheck({
          source: 'po',
          sourceRef: bundleCode,
          projectId: g.projectId,
          costGroupId: g.costGroupId || null,
          requestedAmount: g.amount,
          result,
          userId: profile?.id ?? null,
        })
      }

      dropRecordCache(qc, 'sourcing-bundle', 'order-items-for-sourcing', 'bundled-order-item-ids', 'stock-issued-by-order-item', 'finance-sourcing-reviews-for-sourcing', 'order-items')
      qc.invalidateQueries({ queryKey: ['sourcing-bundles'] })
      qc.invalidateQueries({ queryKey: ['bundled-order-item-ids'] })
      qc.invalidateQueries({ queryKey: ['order-item-counts'] })
      qc.invalidateQueries({ queryKey: ['order-items-for-sourcing'] })
      toast(isEdit ? 'Purchase order saved' : 'Purchase order created', 'success')
      navigate(`/sourcing/${bundleId}`)
    } catch (err: any) {
      toast(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const vendorOptions = useMemo(() => vendors.map(v => ({ id: v.id, label: v.vendor_name, sub: v.wth_eligible ? 'Withholds 3%' : undefined })), [vendors])

  // Lines priced well above what the request estimated — shown on the line
  // and counted in the totals, so it's seen before finance is asked.
  const overEstimate = useMemo(() => {
    const m: Record<string, number> = {}
    for (const item of bundleItems) {
      const pct = priceOverEstimate(orderItemMap[item.order_item_id]?.unit_price_est, parseFloat(item.unit_price_actual))
      if (pct != null) m[item.order_item_id] = pct
    }
    return m
  }, [bundleItems, orderItemMap])
  const overCount = Object.keys(overEstimate).length

  const fieldCls = 'w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
  const labelCls = 'mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400'
  const lineInputCls = 'w-full rounded-md border bg-white px-2 py-1.5 text-sm tabular-nums text-slate-800 outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'

  if (isEdit && existingBundle && existingBundle.status !== 'drafting') {
    return (
      <div className="space-y-4">
        <RecordHeader back={{ to: `/sourcing/${id}`, label: 'Back to the purchase order' }} code={existingBundle.bundle_code} title="Edit purchase order" />
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-800/40 dark:bg-amber-900/10">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">This purchase order can no longer be edited</p>
            <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
              It has moved past drafting (it's <strong>{PO_STATUS[existingBundle.status as SourcingBundleStatus]?.label.toLowerCase() ?? existingBundle.status}</strong>).
              Only a draft can have its vendor, lines or prices changed — so the order finance approved and the vendor received stays the same.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const saveLabel = saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create purchase order'

  return (
    <div className="pb-20 sm:pb-0">
      <RecordHeader
        back={{ to: isEdit ? `/sourcing/${id}` : '/sourcing', label: isEdit ? 'Back to the purchase order' : 'Purchase orders' }}
        code={existingBundle?.bundle_code ?? null}
        title={isEdit ? 'Edit purchase order' : 'New purchase order'}
        subtitle="Pick lines from purchase requests, price them with the vendor, and send to finance"
        actions={[{ label: saveLabel, icon: Save, primary: true, onClick: handleSave, disabled: saving }]}
      />

      <RecordLayout
        main={<>
          <Panel title="Vendor and delivery" icon={Store}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Vendor</label>
                <SearchableSelect value={vendorId || null} options={vendorOptions} placeholder="Search vendors…"
                  onChange={v => { setVendorId(v ?? ''); if (v) setVendorName('') }} />
                {vendorId ? (
                  <p className="mt-1 text-[11px] text-slate-400">{whtEligible ? 'Withholding vendor — 3% is withheld from the payment' : 'Not registered for withholding'}</p>
                ) : (
                  <input type="text" value={vendorName} onChange={e => setVendorName(e.target.value)}
                    placeholder="Not in the list? Type the vendor's name" className={`${fieldCls} mt-2`} />
                )}
              </div>
              <div>
                <label className={labelCls}>Expected delivery</label>
                <input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} className={fieldCls} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Payment</label>
                <Segmented value={paymentPattern} onChange={setPaymentPattern} ariaLabel="Payment"
                  options={[
                    { value: 'pay_on_delivery', label: 'Pay on delivery', icon: Truck },
                    { value: 'pay_in_advance', label: 'Pay in advance', icon: Banknote, tone: 'amber' },
                  ]} />
                {paymentPattern === 'pay_in_advance' && (
                  <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                    Once ordered, finance can send the advance before the goods arrive. Closing it to an expense still needs a goods received note.
                  </p>
                )}
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Notes for finance</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Why this vendor, lead time, anything finance should know…"
                  className={`${fieldCls} resize-none`} />
              </div>
            </div>
          </Panel>

          <Panel title="Lines on this order" icon={ClipboardList} count={bundleItems.length} padded={false}
            action={bundleItems.length > 0 && <span className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(runningTotal)}</span>}>
            {bundleItems.length === 0 ? (
              <div className="py-10 text-center">
                <Package className="mx-auto mb-2 h-7 w-7 text-slate-300 dark:text-slate-600" />
                <p className="text-sm text-slate-500">No lines yet — add them from the purchase requests below.</p>
              </div>
            ) : (
              <div className="divide-y dark:divide-slate-700">
                {bundleItems.map(item => {
                  const lineTotal = (parseFloat(item.quantity_actual) || 0) * (parseFloat(item.unit_price_actual) || 0)
                  const oi = orderItemMap[item.order_item_id]
                  const est = oi?.unit_price_est
                  const over = overEstimate[item.order_item_id]
                  const badge = stockBadge(oi)
                  return (
                    <div key={item._key} className={`space-y-2.5 px-4 py-3 ${over != null ? 'bg-amber-50/50 dark:bg-amber-900/5' : ''}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{item.item_name}</p>
                          <p className="text-[11px] text-slate-400">
                            <span className="font-mono font-semibold text-brand">{item.source_pr_code}</span>
                            {item.project_name && ` · ${item.project_name}`}
                            {` · asked for ${item.quantity_requested} ${item.unit ?? ''}`}
                            {est != null && est > 0 && ` · estimate ${formatCurrency(est)}`}
                          </p>
                          {badge && <div className="mt-1">{badge}</div>}
                        </div>
                        <button onClick={() => removeItem(item.order_item_id)} title="Take off this order"
                          className="shrink-0 rounded p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-[10px] uppercase tracking-wide text-slate-400">Qty{item.unit ? ` (${item.unit})` : ''}</label>
                          <input type="number" inputMode="decimal" value={item.quantity_actual} min={0} step="any"
                            onChange={e => updateItem(item.order_item_id, { quantity_actual: e.target.value })} className={lineInputCls} />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase tracking-wide text-slate-400">Unit price</label>
                          <input type="number" inputMode="decimal" value={item.unit_price_actual} min={0} step="any"
                            onChange={e => updateItem(item.order_item_id, { unit_price_actual: e.target.value })}
                            className={`${lineInputCls} ${over != null ? 'border-amber-400! dark:border-amber-600!' : ''}`} />
                        </div>
                        <div className="text-right">
                          <label className="text-[10px] uppercase tracking-wide text-slate-400">Line total</label>
                          <p className="py-1.5 text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{lineTotal > 0 ? formatCurrency(lineTotal) : '—'}</p>
                        </div>
                      </div>
                      {over != null && (
                        <p className="flex items-center gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                          <TrendingUp className="h-3.5 w-3.5" /> {over}% above the request's estimate of {formatCurrency(est ?? 0)} — say why in the line note
                        </p>
                      )}
                      <BundleLineStock
                        itemName={item.item_name}
                        unit={item.unit}
                        stockItemId={item.stock_item_id}
                        qty={parseFloat(item.quantity_actual) || 0}
                        unitPrice={parseFloat(item.unit_price_actual) || 0}
                        onLink={sid => updateItem(item.order_item_id, { stock_item_id: sid, variant_id: null })}
                      />
                      {(variantsByItem?.get(item.stock_item_id ?? '')?.length ?? 0) > 0 && (
                        <div className="flex items-center gap-2">
                          <label className="shrink-0 text-[11px] text-slate-400">Which one?</label>
                          <select value={item.variant_id ?? ''} onChange={e => updateItem(item.order_item_id, { variant_id: e.target.value || null })}
                            className={`w-full rounded-md border px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:text-slate-200 ${item.variant_id ? 'bg-white dark:border-slate-600' : 'border-amber-300! bg-amber-50 dark:border-amber-700!'}`}>
                            <option value="">— Pick the variant bought —</option>
                            {variantsByItem!.get(item.stock_item_id!)!.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                          </select>
                        </div>
                      )}
                      <input type="text" value={item.notes} onChange={e => updateItem(item.order_item_id, { notes: e.target.value })}
                        placeholder="Line note (optional)"
                        className="w-full rounded-md border bg-white px-2 py-1.5 text-xs text-slate-600 placeholder-slate-400 outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300" />
                    </div>
                  )
                })}
              </div>
            )}
          </Panel>

          <Panel title="Add from purchase requests" icon={Layers} count={availableItems.length} padded={false}>
            <div className="border-b px-4 py-3 dark:border-slate-700">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input type="text" value={itemSearch} onChange={e => setItemSearch(e.target.value)}
                  placeholder="Search items, request codes, projects…" className={`${fieldCls} pl-9`} />
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400">Most urgent requests first — late and due-soon at the top.</p>
            </div>
            <div className="max-h-[520px] overflow-y-auto">
              {groupedAvailable.length === 0 ? (
                <div className="py-10 text-center">
                  <Package className="mx-auto mb-2 h-7 w-7 text-slate-300 dark:text-slate-600" />
                  <p className="text-sm text-slate-400">{availableItems.length === 0 ? 'Every open request line is already on a purchase order' : 'Nothing matches the search'}</p>
                </div>
              ) : groupedAvailable.map(({ order, items }) => (
                <div key={order.id} className="border-b last:border-0 dark:border-slate-700">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 bg-slate-50 px-4 py-2 dark:bg-slate-700/30">
                    <span className="shrink-0 font-mono text-xs font-bold text-brand">{order.request_code ?? '—'}</span>
                    <span className="min-w-[6rem] flex-1 truncate text-xs font-medium text-slate-600 dark:text-slate-300">{order.order_name ?? 'Untitled request'}</span>
                    {priorityBadge(order.priority)}
                    {requiredByBadge(order.required_by_date)}
                    {order.projects && <span className="whitespace-nowrap text-[10px] text-slate-400">{order.projects.project_name}</span>}
                    {order.is_new_item && (
                      <span className="flex items-center gap-0.5 whitespace-nowrap rounded bg-purple-50 px-1.5 py-0.5 text-[10px] text-purple-600 dark:bg-purple-900/20 dark:text-purple-400">
                        <Zap className="h-2.5 w-2.5" />Market search
                      </span>
                    )}
                    <button onClick={() => addAllInGroup(items)} title="Add every line from this request"
                      className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md border bg-white px-2 py-0.5 text-[11px] font-medium text-brand hover:border-brand dark:border-slate-600 dark:bg-slate-800">
                      <Plus className="h-3 w-3" /> All {items.length}
                    </button>
                  </div>
                  {items.map(item => (
                    <button key={item.id} onClick={() => addItem(item)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-brand/5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-slate-700 dark:text-slate-200">{item.item_name}</p>
                        <p className="text-[11px] text-slate-400">
                          {item.quantity} {item.unit ?? ''}
                          {item.unit_price_est != null && ` · estimate ${formatCurrency(item.unit_price_est)}`}
                        </p>
                        {stockBadge(item) && <div className="mt-1">{stockBadge(item)}</div>}
                      </div>
                      <span className="shrink-0 rounded-md p-1 text-brand"><Plus className="h-4 w-4" /></span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </Panel>
        </>}
        rail={<div className="space-y-4 lg:sticky lg:top-28">
          <Panel title="Totals" icon={Receipt}>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm text-slate-600 dark:text-slate-300">
                <span>{bundleItems.length} line{bundleItems.length === 1 ? '' : 's'}</span>
                <span className="tabular-nums">{formatCurrency(runningTotal)}</span>
              </div>

              {/* The vendor's discount is on the order as a whole, not shaded
              into the unit prices — that would hide that a discount was given
              and feed the wrong rates into the market price history. */}
              <div className="space-y-2 rounded-lg border border-dashed p-3 dark:border-slate-600">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300"><Tag className="h-3.5 w-3.5 text-emerald-500" /> Vendor discount</span>
                  <Segmented size="sm" value={discountKind} ariaLabel="Vendor discount"
                    onChange={k => { setDiscountKind(k); if (k === 'none') { setDiscountValue(''); setDiscountReason('') } }}
                    options={[{ value: 'none', label: 'None' }, { value: 'percent', label: '%' }, { value: 'amount', label: 'ETB' }]} />
                </div>
                {discountKind !== 'none' && (
                  <>
                    <div className="flex gap-2">
                      <input type="number" inputMode="decimal" value={discountValue} onChange={e => setDiscountValue(e.target.value)}
                        min={0} max={discountKind === 'percent' ? 100 : undefined} step="any"
                        placeholder={discountKind === 'percent' ? 'e.g. 5' : 'e.g. 2500'}
                        className="w-24 shrink-0 rounded-md border bg-white px-2 py-1.5 text-right text-sm tabular-nums outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                      <input type="text" value={discountReason} onChange={e => setDiscountReason(e.target.value)} placeholder="Why — bulk, early payment…"
                        className="min-w-0 flex-1 rounded-md border bg-white px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                    </div>
                    {discountKind === 'amount' && (parseFloat(discountValue) || 0) > runningTotal && runningTotal > 0 && (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400">More than the order — it's capped at the lines' total.</p>
                    )}
                  </>
                )}
              </div>

              <dl className="space-y-1.5 text-sm">
                {discountAmount > 0 && (
                  <>
                    <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                      <dt>Discount{discountKind === 'percent' ? ` (${parseFloat(discountValue) || 0}%)` : ''}</dt>
                      <dd className="tabular-nums">−{formatCurrency(discountAmount)}</dd>
                    </div>
                    <div className="flex justify-between font-medium text-slate-700 dark:text-slate-200">
                      <dt>After discount</dt><dd className="tabular-nums">{formatCurrency(netSubtotal)}</dd>
                    </div>
                  </>
                )}
                <div className="flex justify-between text-slate-500 dark:text-slate-400">
                  <dt>VAT (15%)</dt><dd className="tabular-nums">+{formatCurrency(vatAmount)}</dd>
                </div>
                {whtEligible && (
                  <div className="flex justify-between text-amber-600 dark:text-amber-400">
                    <dt>Withholding (3%)</dt><dd className="tabular-nums">−{formatCurrency(whtAmount)}</dd>
                  </div>
                )}
                <div className="flex items-baseline justify-between border-t pt-2 dark:border-slate-700">
                  <dt className="font-semibold text-slate-700 dark:text-slate-200">Pay the vendor</dt>
                  <dd className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-50">{formatCurrency(netPayable)}</dd>
                </div>
              </dl>
              <p className="text-[11px] text-slate-400">Finance's approval limits are checked against {formatCurrency(netSubtotal)}, before VAT.</p>
            </div>
          </Panel>

          {overCount > 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800/40 dark:bg-amber-900/10">
              <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p className="text-xs text-amber-800 dark:text-amber-300">
                <b>{overCount} line{overCount === 1 ? ' is' : 's are'} priced {PRICE_CHECK_PERCENT}% or more above the request's estimate.</b> Finance sees this flag when approving — a line note saying why helps.
              </p>
            </div>
          )}

          {/* Budget check — a preview only, never blocks (see src/lib/budgetCheck.ts). */}
          {flaggedChecks.map((r, i) => (
            <div key={i} className={`flex items-start gap-2 rounded-xl border p-3 ${r.outcome === 'block'
              ? 'border-red-200 bg-red-50 dark:border-red-700/40 dark:bg-red-900/20'
              : 'border-amber-200 bg-amber-50 dark:border-amber-700/40 dark:bg-amber-900/20'}`}>
              <ShieldAlert className={`mt-0.5 h-4 w-4 shrink-0 ${r.outcome === 'block' ? 'text-red-600' : 'text-amber-600'}`} />
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
