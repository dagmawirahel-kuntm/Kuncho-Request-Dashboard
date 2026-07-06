import { useState, useMemo, useEffect } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency } from '@/lib/utils'
import type { SourcingBundleInsert } from '@/types/database'
import { ChevronLeft, Plus, Trash2, Search, Package, AlertCircle } from 'lucide-react'

type OrderRow = {
  id: string
  request_code: string
  order_name: string
  project_id: string | null
  approval_status: string
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
  const [notes, setNotes] = useState<string>('')
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
      const { data, error } = await supabase.from('vendors').select('id, vendor_name').order('vendor_name')
      if (error) throw error
      return data ?? []
    },
  })

  // Sourcing can start as soon as a manager has approved the request —
  // it no longer waits for finance's PR-level sign-off too. Finance's
  // real check happens once at the bundle stage, against the actual
  // vendor price, instead of twice (once on the estimate, once on the
  // real cost). Finance-approved requests are included too, since a
  // request further along the chain is obviously still sourceable.
  const { data: approvedOrders = [] } = useQuery({
    queryKey: ['sourceable-orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, request_code, order_name, project_id, approval_status, projects(project_name)')
        .in('approval_status', ['manager_approved', 'finance_approved'])
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as OrderRow[]
    },
  })

  const orderIds = useMemo(() => approvedOrders.map(o => o.id), [approvedOrders])

  const { data: allOrderItems = [] } = useQuery({
    queryKey: ['order-items-for-sourcing', orderIds],
    queryFn: async () => {
      if (!orderIds.length) return []
      const { data, error } = await supabase
        .from('order_items')
        .select('*')
        .in('order_id', orderIds)
        .neq('status', 'cancelled')
      if (error) throw error
      return (data ?? []) as OrderItemRow[]
    },
    enabled: orderIds.length > 0,
  })

  const { data: bundledItemIds = new Set<string>() } = useQuery({
    queryKey: ['bundled-order-item-ids', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sourcing_bundle_items')
        .select('order_item_id, bundle_id')
      if (error) throw error
      const excludeSet = new Set<string>()
      for (const row of data ?? []) {
        // Exclude items in other bundles; items in this bundle will be in bundleItems state
        if (row.bundle_id !== id) excludeSet.add(row.order_item_id)
      }
      return excludeSet
    },
  })

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
    setNotes(existingBundle.notes ?? '')
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
      }
    })
    setBundleItems(items)
  }, [existingBundle, allOrderItems, orderItemMap, orderMap, existingLoaded, bundleItems.length])

  const selectedIds = useMemo(() => new Set(bundleItems.map(i => i.order_item_id)), [bundleItems])

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
        order?.request_code.toLowerCase().includes(q) ||
        order?.order_name.toLowerCase().includes(q) ||
        (order?.projects?.project_name ?? '').toLowerCase().includes(q)
      )
    })
  }, [availableItems, itemSearch, orderMap])

  const groupedAvailable = useMemo(() => {
    const groups: Record<string, { order: OrderRow; items: OrderItemRow[] }> = {}
    for (const item of filteredAvailable) {
      const order = orderMap[item.order_id]
      if (!order) continue
      if (!groups[order.id]) groups[order.id] = { order, items: [] }
      groups[order.id].items.push(item)
    }
    return Object.values(groups)
  }, [filteredAvailable, orderMap])

  function addItem(item: OrderItemRow) {
    const order = orderMap[item.order_id]
    setBundleItems(prev => [...prev, {
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
      sort_order: prev.length,
    }])
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

  async function handleSave() {
    if (bundleItems.length === 0) { toast('Add at least one item to the bundle', 'error'); return }
    setSaving(true)
    try {
      let bundleId = id
      const bundleData: Partial<SourcingBundleInsert> = {
        vendor_id: vendorId || null,
        vendor_name: vendorId ? null : (vendorName || null),
        expected_delivery_date: deliveryDate || null,
        notes: notes || null,
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
          .select('id')
          .single()
        if (error) throw error
        bundleId = data.id
      }

      const { error: itemError } = await supabase.from('sourcing_bundle_items').insert(
        bundleItems.map((item, idx) => ({
          bundle_id: bundleId!,
          order_item_id: item.order_item_id,
          quantity_actual: parseFloat(item.quantity_actual) || null,
          unit_price_actual: parseFloat(item.unit_price_actual) || null,
          notes: item.notes || null,
          sort_order: idx,
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
        return supabase.from('order_items').update({ status }).eq('id', item.order_item_id)
      })
      const revertUpdates = removedIds.length > 0
        ? [supabase.from('order_items').update({ status: 'pending' }).in('id', removedIds)]
        : []
      const statusResults = await Promise.all([...sourcedUpdates, ...revertUpdates])
      const statusError = statusResults.find(r => r.error)?.error
      if (statusError) throw statusError

      qc.invalidateQueries({ queryKey: ['sourcing-bundles'] })
      qc.invalidateQueries({ queryKey: ['bundled-order-item-ids'] })
      qc.invalidateQueries({ queryKey: ['order-item-counts'] })
      qc.invalidateQueries({ queryKey: ['order-items-for-sourcing'] })
      toast(isEdit ? 'Bundle updated' : 'Bundle created', 'success')
      navigate(`/sourcing/${bundleId}`)
    } catch (err: any) {
      toast(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  if (isEdit && existingBundle && existingBundle.status !== 'drafting') {
    return (
      <div className="space-y-4">
        <Link to={`/sourcing/${id}`} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 w-fit">
          <ChevronLeft className="h-4 w-4" /> Back to bundle
        </Link>
        <div className="rounded-xl border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/10 p-5 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">This bundle can no longer be edited</p>
            <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">
              It has moved past drafting (currently <strong>{existingBundle.status}</strong>). Only bundles still in
              drafting can have their vendor, items, or amounts changed — this keeps the purchase order that finance
              approved and the vendor received from changing after the fact.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Link to="/sourcing" className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">
              {isEdit ? 'Edit Sourcing Bundle' : 'New Sourcing Bundle'}
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Consolidate approved PR line items into a vendor purchase order
            </p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-60">
          {saving ? 'Saving…' : isEdit ? 'Update Bundle' : 'Create Bundle'}
        </button>
      </div>

      {/* Bundle details */}
      <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm space-y-4">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Bundle Details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Vendor</label>
            <select
              value={vendorId}
              onChange={e => { setVendorId(e.target.value); if (e.target.value) setVendorName('') }}
              className="w-full rounded-md border dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/40">
              <option value="">— Select vendor or type below —</option>
              {vendors.map((v: any) => <option key={v.id} value={v.id}>{v.vendor_name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {vendorId ? 'Free-text vendor (optional override)' : 'Free-text vendor name'}
            </label>
            <input
              type="text"
              value={vendorName}
              onChange={e => setVendorName(e.target.value)}
              disabled={!!vendorId}
              placeholder={vendorId ? 'Vendor selected above' : 'e.g. Local market supplier'}
              className="w-full rounded-md border dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/40 disabled:opacity-50" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Expected Delivery Date</label>
            <input
              type="date"
              value={deliveryDate}
              onChange={e => setDeliveryDate(e.target.value)}
              className="w-full rounded-md border dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/40" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Notes for Finance</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Optional notes…"
              className="w-full rounded-md border dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/40 resize-none" />
          </div>
        </div>
      </div>

      {/* Item picker + selected items */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Available PR items */}
        <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b dark:border-slate-700 space-y-2 shrink-0">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Available PR Line Items</h2>
            <div className="relative">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={itemSearch}
                onChange={e => setItemSearch(e.target.value)}
                placeholder="Search items, PR codes, projects…"
                className="w-full rounded-md border dark:border-slate-600 bg-slate-50 dark:bg-slate-700/50 pl-8 pr-3 py-1.5 text-sm text-slate-700 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/40" />
            </div>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 480 }}>
            {groupedAvailable.length === 0 ? (
              <div className="py-12 text-center">
                <Package className="mx-auto h-7 w-7 text-slate-300 dark:text-slate-600 mb-2" />
                <p className="text-sm text-slate-400">
                  {availableItems.length === 0
                    ? 'No finance-approved PR items available'
                    : 'No items match your search'}
                </p>
              </div>
            ) : groupedAvailable.map(({ order, items }) => (
              <div key={order.id} className="border-b dark:border-slate-700 last:border-0">
                <div className="px-4 py-2 bg-slate-50 dark:bg-slate-700/30 flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs font-bold text-brand">{order.request_code}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400 truncate flex-1">{order.order_name}</span>
                  {order.approval_status === 'manager_approved' && (
                    <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded px-1.5 py-0.5 whitespace-nowrap" title="Manager-approved; finance hasn't signed off on this request yet — that review now happens on the bundle instead">
                      Awaiting Finance (PR)
                    </span>
                  )}
                  {order.projects && (
                    <span className="text-[10px] text-slate-400 bg-slate-100 dark:bg-slate-700 rounded px-1.5 py-0.5 whitespace-nowrap">
                      {order.projects.project_name}
                    </span>
                  )}
                </div>
                {items.map(item => (
                  <div key={item.id}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-700 dark:text-slate-200 truncate">{item.item_name}</p>
                      <p className="text-[11px] text-slate-400">
                        Qty {item.quantity} {item.unit ?? ''}
                        {item.unit_price_est != null && ` · Est. ${formatCurrency(item.unit_price_est)}`}
                      </p>
                    </div>
                    <button onClick={() => addItem(item)}
                      className="shrink-0 rounded p-1 text-brand hover:bg-brand/10 transition-colors" title="Add to bundle">
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Selected bundle items */}
        <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b dark:border-slate-700 flex items-center justify-between shrink-0">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              Bundle Items <span className="ml-1 text-slate-400 font-normal">({bundleItems.length})</span>
            </h2>
            {bundleItems.length > 0 && (
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
                {formatCurrency(runningTotal)}
              </span>
            )}
          </div>
          <div className="overflow-y-auto flex-1" style={{ maxHeight: 480 }}>
            {bundleItems.length === 0 ? (
              <div className="py-12 text-center">
                <AlertCircle className="mx-auto h-7 w-7 text-slate-300 dark:text-slate-600 mb-2" />
                <p className="text-sm text-slate-400">Add items from the left panel</p>
              </div>
            ) : (
              <div className="divide-y dark:divide-slate-700">
                {bundleItems.map(item => {
                  const lineTotal = (parseFloat(item.quantity_actual) || 0) * (parseFloat(item.unit_price_actual) || 0)
                  return (
                    <div key={item._key} className="px-4 py-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{item.item_name}</p>
                          <p className="text-[11px] text-slate-400">
                            {item.source_pr_code}
                            {item.project_name && ` · ${item.project_name}`}
                            {' · Req: '}{item.quantity_requested} {item.unit ?? ''}
                          </p>
                        </div>
                        <button onClick={() => removeItem(item.order_item_id)}
                          className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 transition-colors">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="space-y-0.5">
                          <label className="text-[10px] text-slate-400">Qty Actual</label>
                          <input
                            type="number"
                            value={item.quantity_actual}
                            onChange={e => updateItem(item.order_item_id, { quantity_actual: e.target.value })}
                            min={0} step="any"
                            className="w-full rounded border dark:border-slate-600 bg-slate-50 dark:bg-slate-700/50 px-2 py-1 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-brand/40" />
                        </div>
                        <div className="space-y-0.5">
                          <label className="text-[10px] text-slate-400">Unit Price</label>
                          <input
                            type="number"
                            value={item.unit_price_actual}
                            onChange={e => updateItem(item.order_item_id, { unit_price_actual: e.target.value })}
                            min={0} step="any"
                            className="w-full rounded border dark:border-slate-600 bg-slate-50 dark:bg-slate-700/50 px-2 py-1 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-brand/40" />
                        </div>
                        <div className="space-y-0.5">
                          <label className="text-[10px] text-slate-400">Line Total</label>
                          <p className="px-2 py-1 text-sm font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
                            {lineTotal > 0 ? formatCurrency(lineTotal) : '—'}
                          </p>
                        </div>
                      </div>
                      <input
                        type="text"
                        value={item.notes}
                        onChange={e => updateItem(item.order_item_id, { notes: e.target.value })}
                        placeholder="Item notes (optional)"
                        className="w-full rounded border dark:border-slate-600 bg-slate-50 dark:bg-slate-700/50 px-2 py-1 text-xs text-slate-600 dark:text-slate-300 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-brand/40" />
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          {bundleItems.length > 0 && (
            <div className="px-4 py-3 border-t dark:border-slate-700 bg-slate-50 dark:bg-slate-700/30 flex items-center justify-between shrink-0">
              <span className="text-xs text-slate-500">{bundleItems.length} item{bundleItems.length !== 1 ? 's' : ''}</span>
              <span className="text-lg font-bold text-slate-800 dark:text-slate-100 tabular-nums">
                {formatCurrency(runningTotal)}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
