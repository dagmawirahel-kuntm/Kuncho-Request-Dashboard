import { useRef, useState, useMemo } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate, formatDateGC } from '@/lib/utils'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { TrainerHintBanner } from '@/components/shared/TrainerHintBanner'
import { resolveHint } from '@/lib/trainerHints'
import { documentBaseCss, renderLetterhead, renderFooter } from '@/lib/documentTheme'
import type { SourcingBundleStatus, TransportJobStatus, VehicleCapacityClass, SuggestedVehicle, SourcingBundlePaymentPattern, SourcingBundleDiscountKind } from '@/types/database'
import { useStaff } from '@/hooks/useLookups'
import { FactList, Panel, Pill, RecordHeader, RecordLayout, StatusSteps, type Tone } from '@/components/record/Record'
import {
  Pencil, FileText, Clock, CheckCircle2, Building2, Trash2, ArrowRightCircle,
  Package, TruckIcon, XCircle, Send, Check, AlertCircle, Printer, Receipt, Link2Off, Save, Plus, ClipboardCheck, Undo2
} from 'lucide-react'
import { VAT_RATE, WHT_RATE, WHT_SUBTOTAL_THRESHOLD } from '@/lib/poTax'

const CARGO_SIZES: { value: VehicleCapacityClass; label: string }[] = [
  { value: 'motorbike', label: 'Motorbike load' },
  { value: 'light',     label: 'Light (pickup/van)' },
  { value: 'medium',    label: 'Medium (truck)' },
  { value: 'heavy',     label: 'Heavy (full truck+)' },
]

type BundleDetail = {
  id: string
  bundle_code: string
  vendor_id: string | null
  vendor_name: string | null
  status: SourcingBundleStatus
  procurement_officer_id: string | null
  submitted_at: string | null
  approved_by: string | null
  approved_at: string | null
  ordered_at: string | null
  fulfilled_at: string | null
  expected_delivery_date: string | null
  notes: string | null
  finance_notes: string | null
  expense_id: string | null
  total_value: number
  discount_kind: SourcingBundleDiscountKind
  discount_value: number
  discount_reason: string | null
  discount_etb: number
  items_subtotal_etb: number
  payment_pattern: SourcingBundlePaymentPattern
  created_at: string
  vendors: { vendor_name: string; wth_eligible: boolean | null } | null
  procurement_officer: { full_name: string } | null
  approver: { full_name: string } | null
  expenses: {
    id: string; expense_code: string | null; item_service_description: string | null; amount_etb: number | null
    approval_status: string; payment_state: string
  } | null
  sourcing_bundle_items: {
    id: string
    order_item_id: string
    quantity_actual: number | null
    unit_price_actual: number | null
    notes: string | null
    sort_order: number
    order_items: {
      id: string
      item_name: string
      specifications: string | null
      unit: string | null
      quantity: number
      unit_price_est: number | null
      order_id: string
      orders: {
        request_code: string
        order_name: string
        projects: { project_name: string } | null
      } | null
    } | null
  }[]
}

const STATUS_STEPS: { status: SourcingBundleStatus; label: string; icon: React.ReactNode }[] = [
  { status: 'drafting',  label: 'Drafting',         icon: <FileText className="h-3.5 w-3.5" /> },
  { status: 'submitted', label: 'Awaiting Finance',  icon: <Clock className="h-3.5 w-3.5" /> },
  { status: 'approved',  label: 'Finance Approved',  icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  { status: 'ordered',   label: 'Ordered',           icon: <TruckIcon className="h-3.5 w-3.5" /> },
  { status: 'fulfilled', label: 'Fulfilled',         icon: <Package className="h-3.5 w-3.5" /> },
]

const STATUS_ORDER: SourcingBundleStatus[] = ['drafting', 'submitted', 'approved', 'ordered', 'fulfilled', 'cancelled']


function fmt(n: number): string {
  return `ETB ${n.toLocaleString('en-ET', { minimumFractionDigits: 2 })}`
}

function buildPoHtml(p: {
  bundle: BundleDetail
  vendorDisplay: string
  sortedItems: BundleDetail['sourcing_bundle_items']
  itemsSubtotal: number
  discountEtb: number
  grandTotal: number
  vatAmount: number
  grossTotal: number
  whtAmount: number
  whtEligible: boolean
  netPayable: number
}): string {
  const { bundle, vendorDisplay, sortedItems, itemsSubtotal, discountEtb, grandTotal, vatAmount, grossTotal, whtAmount, whtEligible, netPayable } = p

  const rows = sortedItems.map((item, i) => {
    const oi = item.order_items
    const lineTotal = (item.quantity_actual ?? 0) * (item.unit_price_actual ?? 0)
    return `
    <tr>
      <td class="c">${i + 1}</td>
      <td>
        <div class="item-name">${oi?.item_name ?? '—'}</div>
        ${oi?.specifications ? `<div class="item-spec">${oi.specifications}</div>` : ''}
      </td>
      <td>${oi?.orders?.request_code ?? '—'}</td>
      <td class="r">${item.quantity_actual ?? oi?.quantity ?? '—'}</td>
      <td>${oi?.unit ?? '—'}</td>
      <td class="r">${item.unit_price_actual != null ? fmt(item.unit_price_actual) : '—'}</td>
      <td class="r">${lineTotal > 0 ? fmt(lineTotal) : '—'}</td>
    </tr>`
  }).join('')

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
${documentBaseCss}
body{padding:40px 52px;color:#111;font-size:11pt;line-height:1.5}
.parties{display:flex;justify-content:space-between;gap:24px;margin-bottom:20px}
.party{font-size:10pt}
.party .label{color:#888;font-size:9pt;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}
.party b{font-size:11pt}
table{width:100%;border-collapse:collapse;margin-bottom:16px;font-size:10pt}
thead tr{background:#1B3A5C;color:#fff}
th{padding:8px 10px;text-align:left;font-weight:600;font-size:9pt;letter-spacing:.4px}
th.r,td.r{text-align:right}
th.c,td.c{text-align:center}
tbody tr:nth-child(even){background:#f7f9fb}
td{padding:7px 10px;border-bottom:1px solid #ddd;vertical-align:top}
.item-name{font-weight:600}
.item-spec{font-size:8.5pt;color:#888;margin-top:2px}
.totals{width:320px;margin-left:auto;font-size:10pt}
.totals tr td{border-bottom:none;padding:4px 0}
.totals .lbl{color:#555}
.totals .val{text-align:right}
.totals .net td{border-top:2px solid #1B3A5C;padding-top:8px;font-weight:700;font-size:12pt;color:#1B3A5C}
.totals .gross td{border-top:1px solid #d4d4d4;padding-top:6px;font-weight:600}
.wht{color:#b45309}
.disc{color:#047857}
.disc .lbl{color:#047857}
.notes{font-size:9.5pt;color:#555;margin-top:16px}
</style>
</head>
<body>
${renderLetterhead({
  docTitle: 'PURCHASE ORDER',
  docCode: bundle.bundle_code,
  metaLines: [
    formatDateGC(bundle.created_at),
    ...(bundle.expected_delivery_date ? [`Expected delivery: ${formatDateGC(bundle.expected_delivery_date)}`] : []),
  ],
  gradient: 'purchaseOrder',
})}
<div class="parties">
  <div class="party">
    <div class="label">Vendor / Supplier</div>
    <b>${vendorDisplay}</b>
  </div>
  <div class="party">
    <div class="label">Procurement Officer</div>
    <b>${bundle.procurement_officer?.full_name ?? '—'}</b>
    ${bundle.approver ? `<div class="label" style="margin-top:8px">Approved By</div><b>${bundle.approver.full_name}</b>` : ''}
  </div>
</div>
<table>
  <thead>
    <tr>
      <th class="c" style="width:30px">#</th>
      <th>Item Description</th>
      <th style="width:90px">Source PR</th>
      <th class="r" style="width:50px">Qty</th>
      <th style="width:50px">Unit</th>
      <th class="r" style="width:100px">Unit Price</th>
      <th class="r" style="width:110px">Total</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>
<table class="totals">
  ${discountEtb > 0 ? `<tr><td class="lbl">Subtotal before discount</td><td class="val">${fmt(itemsSubtotal)}</td></tr>
  <tr class="disc"><td class="lbl">Vendor discount${bundle.discount_kind === 'percent' ? ` (${Number(bundle.discount_value)}%)` : ''}${bundle.discount_reason ? ` — ${bundle.discount_reason}` : ''}</td><td class="val">−${fmt(discountEtb)}</td></tr>` : ''}
  <tr><td class="lbl">Subtotal</td><td class="val">${fmt(grandTotal)}</td></tr>
  <tr><td class="lbl">VAT (15%, added)</td><td class="val">${fmt(vatAmount)}</td></tr>
  ${whtEligible ? `<tr class="gross"><td class="lbl">Gross Total (before WHT)</td><td class="val">${fmt(grossTotal)}</td></tr>
  <tr class="wht"><td class="lbl">WHT (3%, withheld)</td><td class="val">−${fmt(whtAmount)}</td></tr>` : ''}
  <tr class="net"><td>Net Payable to Vendor</td><td class="val">${fmt(netPayable)}</td></tr>
</table>
${bundle.notes ? `<div class="notes"><b>Notes:</b> ${bundle.notes}</div>` : ''}
${renderFooter(bundle.bundle_code)}
</body>
</html>`
}

export default function PurchaseOrderPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { toast } = useToast()
  const { role, profile } = useAuth()

  const [financeNotes, setFinanceNotes] = useState<string>('')
  const [showRejectPanel, setShowRejectPanel] = useState(false)
  const [transitioning, setTransitioning] = useState(false)
  const [closingAdvance, setClosingAdvance] = useState(false)
  const printRef = useRef<HTMLIFrameElement>(null)

  // Queue-pickup panel (C3) — raising the transport job right at PO
  // placement instead of only offering a click-through to a separate form.
  const [showQueuePanel, setShowQueuePanel] = useState(false)
  const [queueDriverId, setQueueDriverId] = useState<string | null>(null)
  const [queueVehicleId, setQueueVehicleId] = useState<string | null>(null)
  const [queueCargoSize, setQueueCargoSize] = useState<VehicleCapacityClass | ''>('')
  const [queueDurationHours, setQueueDurationHours] = useState('')
  const [queuing, setQueuing] = useState(false)

  const { data: allStaff = [] } = useStaff()
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const driverOptions = (() => {
    const drivers = (allStaff as any[]).filter(s => s.role === 'Driver')
    return (drivers.length > 0 ? drivers : (allStaff as any[])).map(s => ({ id: s.id, label: s.employee_name, sub: s.role ?? undefined }))
  })()
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Dedicated vehicle per driver (migration 166) — how the fleet
  // actually operates, so picking a driver here should default straight
  // to their own vehicle rather than making someone re-pick it from a
  // ranked list every time. Still overridable (e.g. their vehicle is in
  // maintenance) — this only sets the initial value.
  const { data: fleetVehicles = [] } = useQuery({
    queryKey: ['vehicles-for-dedicated-lookup'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicles').select('id, name, status, assigned_driver_id').eq('active', true)
      if (error) throw error
      return data as { id: string; name: string; status: string; assigned_driver_id: string | null }[]
    },
    enabled: showQueuePanel,
  })
  const vehicleByDriver = new Map(fleetVehicles.filter(v => v.assigned_driver_id).map(v => [v.assigned_driver_id as string, v]))

  function pickQueueDriver(driverId: string | null) {
    setQueueDriverId(driverId)
    const dedicated = driverId ? vehicleByDriver.get(driverId) : null
    if (dedicated) setQueueVehicleId(dedicated.id)
  }

  const { data: suggestedVehicles = [] } = useQuery({
    queryKey: ['suggest-vehicles', queueCargoSize],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('suggest_vehicles_for_transport', { p_cargo_size: queueCargoSize || null })
      if (error) throw error
      return data as SuggestedVehicle[]
    },
    enabled: showQueuePanel,
  })

  const { data: bundle, isLoading, error: bundleError } = useQuery({
    queryKey: ['sourcing-bundle-detail', id],
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sourcing_bundles')
        .select(`
          *,
          vendors(vendor_name, wth_eligible),
          procurement_officer:user_profiles!sourcing_bundles_procurement_officer_id_fkey(full_name),
          approver:user_profiles!sourcing_bundles_approved_by_fkey(full_name),
          expenses!sourcing_bundles_expense_id_fkey(id, expense_code, item_service_description, amount_etb, approval_status, payment_state),
          sourcing_bundle_items(
            *,
            order_items(
              id, item_name, specifications, unit, quantity, unit_price_est, order_id,
              orders(request_code, order_name, projects(project_name))
            )
          )
        `)
        .eq('id', id!)
        .single()
      if (error) throw error
      return data as BundleDetail
    },
  })

  const { data: expenseOptions = [] } = useQuery({
    queryKey: ['expenses-lookup-for-bundle'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('id, expense_code, item_service_description, amount_etb')
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return (data ?? []).map(e => ({
        id: e.id,
        label: e.expense_code ?? '(no code)',
        sub: [e.item_service_description, e.amount_etb != null ? formatCurrency(e.amount_etb) : null].filter(Boolean).join(' · '),
      }))
    },
  })

  const { data: transportJob } = useQuery({
    queryKey: ['transport-job-for-bundle', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transportation_requests')
        .select('id, request_name, job_status')
        .eq('sourcing_bundle_id', id!)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data as { id: string; request_name: string | null; job_status: TransportJobStatus } | null
    },
    enabled: !!id,
  })

  const { data: grn } = useQuery({
    queryKey: ['grn-for-bundle', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('goods_received_notes')
        .select('id, grn_code, received_at, notes, categories(category_name)')
        .eq('sourcing_bundle_id', id!)
        .maybeSingle()
      if (error) throw error
      return data as { id: string; grn_code: string; received_at: string; notes: string | null; categories: { category_name: string } | null } | null
    },
    enabled: !!id,
  })

  const bundleHint = useMemo(() => {
    if (!bundle || grn === undefined) return null
    return resolveHint({
      entityType: 'purchase_order',
      id: bundle.id,
      status: bundle.status,
      orderedAt: bundle.ordered_at,
      hasGrn: !!grn,
      hasExpense: !!bundle.expense_id,
    })
  }, [bundle, grn])

  if (isLoading) return <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
  if (bundleError) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm font-medium text-red-500">Couldn't load this bundle</p>
        <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">{(bundleError as { message?: string }).message ?? String(bundleError)}</p>
      </div>
    )
  }
  if (!bundle) return <div className="py-16 text-center text-sm text-slate-400">Bundle not found.</div>

  const status = bundle.status
  const statusIdx = STATUS_ORDER.indexOf(status)
  const vendorDisplay = bundle.vendors?.vendor_name ?? bundle.vendor_name ?? '—'

  const isAdmin = role === 'admin'
  const isManager = role === 'executive'
  const isFinance = role === 'finance'
  const isProcurement = role === 'procurement_officer'
  const isStockOrLogistics = role === 'stock_manager' || role === 'logistics_officer'
  const isOperationsManager = role === 'operations_manager'

  // The PO approval ladder, per Operations Manual v0.1 §6:
  //   Procurement Officer -> 30,000 -> Operations Manager -> 500,000 -> CEO/MD
  // Both caps are enforced server-side in RLS off the same total_value
  // column (ops_manager in 133, procurement_officer capped at 30,000 in
  // 255, originally 50,000 in 149/163); these constants only keep the
  // buttons honest about what the database will actually allow.
  // `executive` is the CEO/MD tier and admin remains uncapped.
  const PROCUREMENT_APPROVAL_CAP = 30000
  const OPS_MANAGER_APPROVAL_CAP = 500000
  const bundleValue = bundle.total_value ?? 0
  const isOpsManagerWithinCap = isOperationsManager && bundleValue <= OPS_MANAGER_APPROVAL_CAP
  const isProcurementWithinCap = isProcurement && bundleValue <= PROCUREMENT_APPROVAL_CAP

  const canEdit = (isProcurement || isAdmin || isManager) && status === 'drafting'
  const canSubmit = (isProcurement || isAdmin || isManager) && status === 'drafting'
  const canApprove = ((isFinance || isAdmin) || isOpsManagerWithinCap || isProcurementWithinCap) && status === 'submitted'
  const canReject = ((isFinance || isAdmin || isManager) || isOpsManagerWithinCap || isProcurementWithinCap) && (status === 'submitted')
  const canMarkOrdered = (isProcurement || isAdmin || isManager) && status === 'approved'
  const canCancel = (isAdmin || isManager) && !['fulfilled', 'cancelled'].includes(status)

  // Fulfillment is no longer a self-service click — it only happens as a
  // side effect of a stock_manager/logistics_officer recording a real GRN.
  const canRequestTransport = (isProcurement || isAdmin || isManager) && status === 'ordered' && !transportJob
  const canRecordGrn = (isStockOrLogistics || isAdmin) && status === 'ordered' && !grn
  const transportClearForExpense = !transportJob || transportJob.job_status === 'in_progress' || transportJob.job_status === 'completed'
  const canCreateExpense = !!grn && transportClearForExpense

  // Advance payment (pattern B, migration 110): the vendor demands
  // payment before goods arrive, so the expense has to exist before a
  // GRN does — the opposite gate from canCreateExpense above, and only
  // for bundles that actually declared this pattern. Since 342 the
  // database prepares it the moment the PO is marked ordered, so this
  // button is only the fallback for one whose expense was unlinked.
  // Creating the expense does NOT itself send money; it still goes
  // through the normal finance-approval and to-pay-queue flow, landing in
  // payment_state = 'advance' instead of the usual 'sent'/'paid'.
  const isPayInAdvance = bundle.payment_pattern === 'pay_in_advance'
  const canCreateAdvanceExpense = isPayInAdvance && ['ordered', 'fulfilled'].includes(status) && !grn && !bundle.expense_id
  const canCloseAdvance = (isFinance || isAdmin) && !!grn && bundle.expenses?.payment_state === 'advance'

  const sortedItems = [...(bundle.sourcing_bundle_items ?? [])].sort((a, b) => a.sort_order - b.sort_order)

  const itemsSubtotal = sortedItems.reduce((sum, item) =>
    sum + (item.quantity_actual ?? 0) * (item.unit_price_actual ?? 0), 0)

  // The vendor discount comes from the bundle, already resolved to birr and
  // clamped by the database (299) — it is not recomputed here, so the PO
  // shows the same figure the approval caps were checked against.
  const discountEtb = Number(bundle.discount_etb ?? 0)
  // grandTotal is the discounted subtotal from here down: it is what the
  // vendor invoices, so VAT is charged on it and withholding is measured
  // against it.
  const grandTotal = Math.max(itemsSubtotal - discountEtb, 0)

  // Vendor must be tax-registered AND the PO subtotal must clear the
  // withholding bracket floor — either alone is not sufficient.
  const whtEligible = !!bundle.vendors?.wth_eligible && grandTotal > WHT_SUBTOTAL_THRESHOLD
  const vatAmount = grandTotal * VAT_RATE
  // Gross = what the vendor invoices. WHT is withheld from this at payment
  // and remitted to ERCA, so it is the figure the vendor's own invoice and
  // the withholding receipt are both written against — not netPayable.
  const grossTotal = grandTotal + vatAmount
  const whtAmount = whtEligible ? grandTotal * WHT_RATE : 0
  const netPayable = grossTotal - whtAmount

  const poHtml = buildPoHtml({ bundle, vendorDisplay, sortedItems, itemsSubtotal, discountEtb, grandTotal, vatAmount, grossTotal, whtAmount, whtEligible, netPayable })

  function handlePrint() {
    printRef.current?.contentWindow?.print()
  }

  const bundleCode = bundle.bundle_code

  function handleSaveFile() {
    const blob = new Blob([poHtml], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${bundleCode}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Group by project for cost allocation. A discount is negotiated on the
  // order as a whole, so each project carries it in proportion to what it
  // contributed — otherwise these would add up to the undiscounted total
  // and read as more than 100% of the PO.
  const discountRatio = itemsSubtotal > 0 ? grandTotal / itemsSubtotal : 1
  const projectAllocations = sortedItems.reduce<Record<string, { name: string; total: number }>>((acc, item) => {
    const project = item.order_items?.orders?.projects?.project_name ?? 'No project'
    const lineTotal = (item.quantity_actual ?? 0) * (item.unit_price_actual ?? 0) * discountRatio
    if (!acc[project]) acc[project] = { name: project, total: 0 }
    acc[project].total += lineTotal
    return acc
  }, {})

  async function transition(nextStatus: SourcingBundleStatus, extra?: Record<string, any>) {
    setTransitioning(true)
    try {
      const patch: Record<string, any> = { status: nextStatus, ...extra }
      if (nextStatus === 'submitted') patch.submitted_at = new Date().toISOString()
      if (nextStatus === 'approved') { patch.approved_by = profile?.id; patch.approved_at = new Date().toISOString() }
      if (nextStatus === 'ordered') patch.ordered_at = new Date().toISOString()
      if (nextStatus === 'fulfilled') patch.fulfilled_at = new Date().toISOString()

      const { error } = await supabase.from('sourcing_bundles').update(patch).eq('id', id!)
      if (error) throw error

      if (nextStatus === 'cancelled') {
        // Release this bundle's line items so they can be re-sourced:
        // delete the bundle_items rows (allowed once cancelled — see
        // migration 056) and revert their order_items back to pending.
        const itemIds = (bundle?.sourcing_bundle_items ?? []).map(i => i.order_item_id)
        const { error: delErr } = await supabase.from('sourcing_bundle_items').delete().eq('bundle_id', id!)
        if (delErr) throw delErr
        if (itemIds.length > 0) {
          const { error: revertErr } = await supabase.from('order_items').update({ status: 'pending' }).in('id', itemIds)
          if (revertErr) throw revertErr
        }
      }

      qc.invalidateQueries({ queryKey: ['sourcing-bundle-detail', id] })
      qc.invalidateQueries({ queryKey: ['sourcing-bundles'] })
      qc.invalidateQueries({ queryKey: ['order-item-counts'] })
      // Ordering a pay-in-advance PO prepares its expense in the database
      // (342), and cancelling removes one nobody has touched yet.
      if (nextStatus === 'ordered' || nextStatus === 'cancelled') qc.invalidateQueries({ queryKey: ['expenses'] })
      toast(
        nextStatus === 'ordered' && bundle?.payment_pattern === 'pay_in_advance' && !bundle?.expense_id
          ? 'Marked as ordered — the advance expense is prepared and waiting for finance approval'
          : `Bundle moved to ${nextStatus}`,
        'success',
      )
      setShowRejectPanel(false)
      setFinanceNotes('')
    } catch (err: any) {
      toast(err.message, 'error')
    } finally {
      setTransitioning(false)
    }
  }

  // C3: raise the pickup job directly at PO placement, pre-assigned to
  // a driver, tied to this bundle — instead of only offering a
  // click-through to a blank transport form later.
  async function handleQueuePickup() {
    if (!bundle) return
    setQueuing(true)
    try {
      const { error } = await supabase.from('transportation_requests').insert([{
        request_name: `Pickup — ${bundle.bundle_code}`,
        job_type: 'purchase_pickup',
        transport_mode: 'own_fleet',
        job_status: queueDriverId || queueVehicleId ? 'assigned' : 'requested',
        priority: 'normal',
        sourcing_bundle_id: id,
        vendor_id: bundle.vendor_id,
        vendor_name: bundle.vendor_id ? null : (bundle.vendors?.vendor_name ?? bundle.vendor_name),
        requested_by_id: profile?.id,
        requested_date: new Date().toISOString().slice(0, 10),
        assigned_staff_id: queueDriverId,
        vehicle_id: queueVehicleId,
        cargo_size_estimate: queueCargoSize || null,
        expected_duration_hours: queueDurationHours ? parseFloat(queueDurationHours) : null,
      }])
      if (error) throw error
      if (queueVehicleId) await supabase.from('vehicles').update({ status: 'on_job' }).eq('id', queueVehicleId)
      qc.invalidateQueries({ queryKey: ['transport-job-for-bundle', id] })
      qc.invalidateQueries({ queryKey: ['transportation'] })
      qc.invalidateQueries({ queryKey: ['vehicles'] })
      toast('Pickup queued', 'success')
      setShowQueuePanel(false)
      setQueueDriverId(null); setQueueVehicleId(null); setQueueCargoSize(''); setQueueDurationHours('')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setQueuing(false)
    }
  }

  async function linkExpense(expenseId: string | null) {
    const { error } = await supabase.from('sourcing_bundles').update({ expense_id: expenseId }).eq('id', id!)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['sourcing-bundle-detail', id] })
    toast(expenseId ? 'Linked to expense' : 'Expense link removed', 'success')
  }

  async function handleCloseAdvance() {
    const expenseId = bundle?.expenses?.id
    if (!expenseId) return
    setClosingAdvance(true)
    const { error } = await supabase.rpc('close_vendor_advance', { p_expense_id: expenseId })
    setClosingAdvance(false)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['sourcing-bundle-detail', id] })
    qc.invalidateQueries({ queryKey: ['v-open-vendor-advances'] })
    toast('Advance closed — expense is now paid', 'success')
  }

  async function handleDelete() {
    if (!window.confirm('Delete this sourcing bundle? This cannot be undone.')) return
    const { error } = await supabase.from('sourcing_bundles').delete().eq('id', id!)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['sourcing-bundles'] })
    navigate('/sourcing')
    toast('Bundle deleted', 'success')
  }

  async function handleUndoFulfillment() {
    if (!grn) return
    if (!window.confirm(`Undo fulfillment for ${bundleCode}? This deletes GRN ${grn.grn_code} and reverts the PO to "Ordered". The PO itself, its items, and its history are not affected. This cannot be undone.`)) return
    const { error } = await supabase.rpc('undo_grn_fulfillment', { p_grn_id: grn.id })
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['sourcing-bundle-detail', id] })
    qc.invalidateQueries({ queryKey: ['grn-for-bundle', id] })
    qc.invalidateQueries({ queryKey: ['sourcing-bundles'] })
    toast('Fulfillment undone — PO reverted to Ordered', 'success')
  }

  async function handleRevertLegacyFulfillment() {
    if (!window.confirm(`Revert ${bundleCode} to "Ordered"? This PO was fulfilled before GRN tracking existed, so there's no goods received record behind it — reverting it lets you record a real GRN. This cannot be undone.`)) return
    const { error } = await supabase.rpc('revert_legacy_fulfillment', { p_bundle_id: id! })
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['sourcing-bundle-detail', id] })
    qc.invalidateQueries({ queryKey: ['grn-for-bundle', id] })
    qc.invalidateQueries({ queryKey: ['sourcing-bundles'] })
    toast('Reverted to Ordered — you can now record a GRN', 'success')
  }

  const STATUS_TONE: Record<SourcingBundleStatus, Tone> = { drafting: 'slate', submitted: 'amber', approved: 'blue', ordered: 'violet', fulfilled: 'green', cancelled: 'red' }
  const statusLabel = STATUS_STEPS.find(s => s.status === status)?.label ?? status
  const projectNames = [...new Set(sortedItems.map(i => i.order_items?.orders?.projects?.project_name).filter(Boolean))] as string[]
  const stepDates: Record<string, string | null> = {
    drafting: bundle.created_at, submitted: bundle.submitted_at, approved: bundle.approved_at, ordered: bundle.ordered_at, fulfilled: bundle.fulfilled_at,
  }
  const lateDelivery = status === 'ordered' && !!bundle.expected_delivery_date && bundle.expected_delivery_date < new Date().toISOString().slice(0, 10)

  // What happens next, in one sentence, for whoever is looking.
  const nextStep = status === 'drafting' ? (canSubmit ? 'Check the items and prices, then submit it for approval.' : 'Procurement is still preparing this order.')
    : status === 'submitted' ? (canApprove ? 'Review it and approve, or send it back with what to change.'
      : `Waiting for approval — up to ${formatCurrency(PROCUREMENT_APPROVAL_CAP)} procurement, up to ${formatCurrency(OPS_MANAGER_APPROVAL_CAP)} operations manager, above that the CEO.`)
    : status === 'approved' ? (canMarkOrdered ? 'Place the order with the vendor, then mark it ordered.' : 'Approved — waiting for procurement to place the order.')
    : status === 'ordered' ? (grn ? 'Goods received.' : lateDelivery ? `Delivery was expected ${formatDate(bundle.expected_delivery_date)} — follow up with the vendor.` : 'Waiting for the goods. Record a GRN when they arrive.')
    : status === 'fulfilled' ? `Received${bundle.fulfilled_at ? ` on ${formatDate(bundle.fulfilled_at)}` : ''}.`
    : 'This purchase order was cancelled.'

  return (
    <div className="pb-20 sm:pb-0">
      <iframe ref={printRef} srcDoc={poHtml} title="Purchase Order Print" style={{ position: 'absolute', width: 0, height: 0, border: 0, visibility: 'hidden' }} />

      <RecordHeader
        back={{ to: '/sourcing', label: 'Purchase orders' }}
        code={bundle.bundle_code}
        title={vendorDisplay}
        pills={<>
          <Pill tone={STATUS_TONE[status]}>{status === 'cancelled' ? 'Cancelled' : statusLabel}</Pill>
          {isPayInAdvance && <Pill tone="amber">Pay in advance</Pill>}
          {lateDelivery && <Pill tone="red" icon={AlertCircle}>Delivery late</Pill>}
        </>}
        meta={[
          { icon: Receipt, value: <span className="font-semibold text-slate-700 dark:text-slate-200">{formatCurrency(netPayable)}</span>, label: 'Net' },
          ...(bundle.expected_delivery_date ? [{ icon: TruckIcon, value: `Delivery ${formatDate(bundle.expected_delivery_date)}`, tone: lateDelivery ? 'red' as const : undefined }] : []),
          ...(projectNames.length ? [{ icon: Building2, value: projectNames.length === 1 ? projectNames[0] : `${projectNames.length} projects` }] : []),
        ]}
        actions={[
          { label: 'Submit for approval', icon: Send, onClick: () => transition('submitted'), primary: true, disabled: transitioning, hidden: !canSubmit },
          { label: 'Approve', icon: Check, onClick: () => transition('approved', { finance_notes: financeNotes || null }), primary: true, disabled: transitioning, hidden: !canApprove || showRejectPanel },
          { label: 'Mark as ordered', icon: TruckIcon, onClick: () => transition('ordered'), primary: true, disabled: transitioning, hidden: !canMarkOrdered },
          { label: 'Record goods received', icon: ClipboardCheck, to: `/sourcing/${id}/grn/new`, primary: true, hidden: !canRecordGrn },
          { label: 'Request changes', icon: Undo2, onClick: () => setShowRejectPanel(true), hidden: !canReject || showRejectPanel },
          { label: 'Edit', icon: Pencil, to: `/sourcing/${id}/edit`, hidden: !canEdit },
          { label: 'Queue pickup', icon: TruckIcon, onClick: () => setShowQueuePanel(true), hidden: !canRequestTransport || showQueuePanel },
          { label: 'Print', icon: Printer, onClick: handlePrint },
          { label: 'Save as file', icon: Save, onClick: handleSaveFile },
          { label: 'Cancel purchase order', icon: XCircle, onClick: () => { if (window.confirm('Cancel this purchase order? Its items go back to their requests to be sourced again.')) transition('cancelled') }, danger: true, disabled: transitioning, hidden: !canCancel },
          { label: 'Delete', icon: Trash2, onClick: handleDelete, danger: true, hidden: !((isAdmin || isManager) && status === 'drafting') },
        ]}
      />

      <div className="space-y-4">
        <TrainerHintBanner entityType="purchase_order" entityId={bundle.id} hint={bundleHint} />

        <Panel>
          <StatusSteps current={status === 'cancelled' ? (STATUS_STEPS[Math.max(0, statusIdx - 1)]?.status ?? 'drafting') : status}
            done={status === 'fulfilled'} cancelled={status === 'cancelled'}
            steps={STATUS_STEPS.map(s => ({ key: s.status, label: s.label, at: stepDates[s.status] ? formatDate(stepDates[s.status]) : null }))} />
        </Panel>

        {bundle.finance_notes && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800/40 dark:bg-amber-900/10">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div>
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">Notes from approval</p>
              <p className="mt-0.5 text-sm text-amber-700 dark:text-amber-300">{bundle.finance_notes}</p>
            </div>
          </div>
        )}

        <RecordLayout
          main={<>
            <Panel title="Items" icon={Package} count={sortedItems.length} padded={false}>
              {/* Wide screens: a table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-slate-50 dark:border-slate-700 dark:bg-slate-900/30">
                      <th className="w-8 px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">#</th>
                      <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Item</th>
                      <th className="hidden px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400 lg:table-cell">Request · project</th>
                      <th className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-400">Qty</th>
                      <th className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-400">Unit price</th>
                      <th className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-slate-700">
                    {sortedItems.map((item, i) => {
                      const oi = item.order_items
                      const lineTotal = (item.quantity_actual ?? 0) * (item.unit_price_actual ?? 0)
                      return (
                        <tr key={item.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/20">
                          <td className="px-4 py-3 text-xs text-slate-400">{i + 1}</td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-slate-800 dark:text-slate-100">{oi?.item_name ?? '—'}</p>
                            {oi?.specifications && <p className="mt-0.5 text-xs text-slate-400">{oi.specifications}</p>}
                            {item.notes && <p className="mt-0.5 text-xs italic text-slate-400">{item.notes}</p>}
                          </td>
                          <td className="hidden px-4 py-3 lg:table-cell">
                            {oi?.order_id ? <Link to={`/purchase-requests/${oi.order_id}`} className="font-mono text-xs text-brand hover:underline">{oi.orders?.request_code ?? '—'}</Link> : '—'}
                            <p className="text-xs text-slate-500 dark:text-slate-400">{oi?.orders?.projects?.project_name ?? ''}</p>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-700 dark:text-slate-200">
                            {item.quantity_actual ?? oi?.quantity ?? '—'} <span className="text-xs text-slate-400">{oi?.unit ?? ''}</span>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-700 dark:text-slate-200">{item.unit_price_actual != null ? formatCurrency(item.unit_price_actual) : '—'}</td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-800 dark:text-slate-100">{lineTotal > 0 ? formatCurrency(lineTotal) : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {/* Phones: one card per item */}
              <ul className="divide-y md:hidden dark:divide-slate-700">
                {sortedItems.map((item, i) => {
                  const oi = item.order_items
                  const qty = item.quantity_actual ?? oi?.quantity
                  const lineTotal = (item.quantity_actual ?? 0) * (item.unit_price_actual ?? 0)
                  return (
                    <li key={item.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 text-sm font-medium text-slate-800 dark:text-slate-100"><span className="mr-1 text-xs text-slate-400">{i + 1}.</span>{oi?.item_name ?? '—'}</p>
                        <p className="shrink-0 text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{lineTotal > 0 ? formatCurrency(lineTotal) : '—'}</p>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {qty ?? '—'} {oi?.unit ?? ''} × {item.unit_price_actual != null ? formatCurrency(item.unit_price_actual) : '—'}
                      </p>
                      {oi?.specifications && <p className="mt-0.5 text-xs text-slate-400">{oi.specifications}</p>}
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {oi?.order_id && <Link to={`/purchase-requests/${oi.order_id}`} className="font-mono text-brand">{oi.orders?.request_code}</Link>}
                        {oi?.orders?.projects?.project_name ? ` · ${oi.orders.projects.project_name}` : ''}
                      </p>
                    </li>
                  )
                })}
              </ul>

              {/* Totals */}
              <div className="border-t bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/30">
                <dl className="ml-auto max-w-sm space-y-1 text-sm">
                  {discountEtb > 0 && (
                    <>
                      <div className="flex justify-between text-slate-500 dark:text-slate-400"><dt>Before discount</dt><dd className="tabular-nums">{formatCurrency(itemsSubtotal)}</dd></div>
                      <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                        <dt>Vendor discount{bundle.discount_kind === 'percent' ? ` (${Number(bundle.discount_value)}%)` : ''}{bundle.discount_reason ? ` — ${bundle.discount_reason}` : ''}</dt>
                        <dd className="tabular-nums">−{formatCurrency(discountEtb)}</dd>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between text-slate-600 dark:text-slate-300"><dt>Subtotal</dt><dd className="tabular-nums">{formatCurrency(grandTotal)}</dd></div>
                  <div className="flex justify-between text-slate-600 dark:text-slate-300"><dt>VAT (15%)</dt><dd className="tabular-nums">{formatCurrency(vatAmount)}</dd></div>
                  {whtEligible && (
                    <>
                      <div className="flex justify-between font-medium text-slate-700 dark:text-slate-200"><dt>Gross (before WHT)</dt><dd className="tabular-nums">{formatCurrency(grossTotal)}</dd></div>
                      <div className="flex justify-between text-amber-600 dark:text-amber-400"><dt>WHT (3%, withheld)</dt><dd className="tabular-nums">−{formatCurrency(whtAmount)}</dd></div>
                    </>
                  )}
                  {!whtEligible && bundle.vendors?.wth_eligible && grandTotal <= WHT_SUBTOTAL_THRESHOLD && (
                    <p className="text-right text-[11px] italic text-slate-400">No WHT — subtotal is at or below the {formatCurrency(WHT_SUBTOTAL_THRESHOLD)} floor.</p>
                  )}
                  <div className="flex justify-between border-t pt-1.5 text-base font-bold text-slate-900 dark:border-slate-600 dark:text-slate-50"><dt>Net payable</dt><dd className="tabular-nums">{formatCurrency(netPayable)}</dd></div>
                </dl>
              </div>
            </Panel>

            {Object.keys(projectAllocations).length > 1 && (
              <Panel title="Split by project" icon={Building2}>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {Object.values(projectAllocations).map(proj => (
                    <div key={proj.name} className="rounded-lg border px-3 py-2 dark:border-slate-700">
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">{proj.name}</p>
                      <p className="text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(proj.total)}</p>
                      <p className="text-[10px] text-slate-400">{grandTotal > 0 ? Math.round((proj.total / grandTotal) * 100) : 0}% of total</p>
                    </div>
                  ))}
                </div>
              </Panel>
            )}

            {bundle.notes && (
              <Panel title="Notes" icon={FileText}>
                <p className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{bundle.notes}</p>
              </Panel>
            )}
          </>}
          rail={<>
            <Panel title="Next step" icon={ArrowRightCircle}>
              <p className={`text-sm ${lateDelivery ? 'font-medium text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-200'}`}>{nextStep}</p>

              {canApprove && !showRejectPanel && (
                <div className="mt-3 space-y-1">
                  <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Note with the approval (optional)</label>
                  <textarea value={financeNotes} onChange={e => setFinanceNotes(e.target.value)} rows={2} placeholder="Add a note when approving…"
                    className="w-full resize-none rounded-md border bg-slate-50 px-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/40 dark:border-slate-600 dark:bg-slate-700/50 dark:text-slate-200" />
                </div>
              )}

              {showRejectPanel && (
                <div className="mt-3 space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800/40 dark:bg-red-900/10">
                  <p className="text-sm font-medium text-red-700 dark:text-red-400">Send back to drafting</p>
                  <textarea value={financeNotes} onChange={e => setFinanceNotes(e.target.value)} rows={3} placeholder="What needs to be corrected…" autoFocus
                    className="w-full resize-none rounded-md border border-red-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-400/40 dark:border-red-700/50 dark:bg-slate-800 dark:text-slate-200" />
                  <div className="flex items-center gap-2">
                    <button onClick={() => transition('drafting', { finance_notes: financeNotes || null })} disabled={transitioning || !financeNotes.trim()}
                      className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60">{transitioning ? 'Sending…' : 'Send back'}</button>
                    <button onClick={() => { setShowRejectPanel(false); setFinanceNotes('') }} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700">Cancel</button>
                  </div>
                </div>
              )}

              {isStockOrLogistics && !isAdmin && status !== 'ordered' && status !== 'fulfilled' && (
                <p className="mt-2 text-xs text-slate-400">A GRN can be recorded once this purchase order is marked ordered.</p>
              )}
            </Panel>

            {(status === 'ordered' || status === 'fulfilled' || transportJob || showQueuePanel) && (
              <Panel title="Delivery" icon={TruckIcon}>
                <div className="space-y-3 text-sm">
                  {transportJob ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/transportation/${transportJob.id}/edit`} className="text-brand hover:underline">{transportJob.request_name ?? 'Transport job'}</Link>
                      <Pill>{transportJob.job_status.replace('_', ' ')}</Pill>
                    </div>
                  ) : canRequestTransport && !showQueuePanel ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => setShowQueuePanel(true)} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
                        <TruckIcon className="h-3.5 w-3.5" /> Queue pickup
                      </button>
                      <Link to={`/transportation/new?bundle_id=${id}`} className="text-xs text-slate-500 hover:underline">or the full transport form</Link>
                    </div>
                  ) : !transportJob && <p className="text-xs text-slate-400">No transport arranged.</p>}

                  {canRequestTransport && showQueuePanel && (
                    <div className="space-y-2.5 rounded-lg border border-violet-200 bg-violet-50/40 p-3 dark:border-violet-800/40 dark:bg-violet-900/10">
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300">Driver</label>
                        <SearchableSelect value={queueDriverId} onChange={pickQueueDriver} options={driverOptions} placeholder="Select driver…" />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300">Cargo size</label>
                        <select className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                          value={queueCargoSize} onChange={e => {
                            setQueueCargoSize(e.target.value as VehicleCapacityClass | '')
                            if (!queueDriverId || !vehicleByDriver.has(queueDriverId)) setQueueVehicleId(null)
                          }}>
                          <option value="">— Not specified —</option>
                          {CARGO_SIZES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300">Vehicle</label>
                        <select className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                          value={queueVehicleId ?? ''} onChange={e => setQueueVehicleId(e.target.value || null)}>
                          <option value="">— Select vehicle —</option>
                          {suggestedVehicles.map(v => (
                            <option key={v.vehicle_id} value={v.vehicle_id} disabled={v.status === 'maintenance' || v.status === 'offline'}>
                              {v.name} — {v.status.replace('_', ' ')}
                              {queueDriverId && vehicleByDriver.get(queueDriverId)?.id === v.vehicle_id ? ' (their dedicated vehicle)' : ''}
                              {v.fit_rank === 0 ? ' ✓ good fit' : v.fit_rank === 1 ? ' (larger than needed)' : v.fit_rank === 3 ? ' ⚠ may be too small' : ''}
                            </option>
                          ))}
                        </select>
                        {queueDriverId && vehicleByDriver.get(queueDriverId) && vehicleByDriver.get(queueDriverId)!.status !== 'available' && (
                          <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                            Their dedicated vehicle is {vehicleByDriver.get(queueDriverId)!.status.replace('_', ' ')} — pick another or leave it for now.
                          </p>
                        )}
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300">Expected duration (hours)</label>
                        <input type="number" step="0.5" min="0.1" value={queueDurationHours} onChange={e => setQueueDurationHours(e.target.value)} placeholder="e.g. 4"
                          className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                      </div>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={handleQueuePickup} disabled={queuing}
                          className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-60">{queuing ? 'Queuing…' : 'Queue pickup'}</button>
                        <button type="button" onClick={() => setShowQueuePanel(false)} className="rounded-md border px-3 py-1.5 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700">Cancel</button>
                      </div>
                      <p className="text-[11px] text-slate-400">Driver and vehicle can be left blank and dispatched later from Transportation.</p>
                    </div>
                  )}

                  {grn ? (
                    <div className="space-y-2 border-t pt-3 dark:border-slate-700">
                      <div className="flex flex-wrap items-center gap-2">
                        <ClipboardCheck className="h-4 w-4 text-emerald-600" />
                        <span className="font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-300">{grn.grn_code}</span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">received {formatDate(grn.received_at)}</span>
                        {grn.categories?.category_name && <Pill>{grn.categories.category_name}</Pill>}
                      </div>
                      {(isAdmin || isStockOrLogistics) && (
                        <button onClick={handleUndoFulfillment} className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50 dark:border-amber-800/40 dark:text-amber-400 dark:hover:bg-amber-900/20">
                          <Undo2 className="h-3.5 w-3.5" /> Undo fulfillment
                        </button>
                      )}
                    </div>
                  ) : status === 'fulfilled' ? (
                    <div className="border-t pt-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                      Fulfilled before goods-received tracking existed — there's no GRN behind it.
                      {(isAdmin || isStockOrLogistics) && (
                        <button onClick={handleRevertLegacyFulfillment} className="mt-1.5 flex items-center gap-1.5 rounded-md border border-amber-200 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50 dark:border-amber-800/40 dark:text-amber-400 dark:hover:bg-amber-900/20">
                          <Undo2 className="h-3.5 w-3.5" /> Revert to ordered
                        </button>
                      )}
                    </div>
                  ) : canRecordGrn ? (
                    <Link to={`/sourcing/${id}/grn/new`} className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
                      <ClipboardCheck className="h-3.5 w-3.5" /> Record goods received
                    </Link>
                  ) : null}
                </div>
              </Panel>
            )}

            {['ordered', 'fulfilled'].includes(status) && (isAdmin || isManager || isFinance || isProcurement) && (
              <Panel title="Payment" icon={Receipt}>
                {bundle.expenses ? (
                  <div className="space-y-2">
                    <Link to={`/expenses/${bundle.expenses.id}`} className="block rounded-lg border px-3 py-2 hover:border-brand dark:border-slate-600">
                      <span className="font-mono text-xs font-semibold text-brand">{bundle.expenses.expense_code}</span>
                      <span className="block truncate text-sm text-slate-700 dark:text-slate-200">{bundle.expenses.item_service_description}</span>
                      {bundle.expenses.amount_etb != null && <span className="text-sm font-semibold tabular-nums">{formatCurrency(bundle.expenses.amount_etb)}</span>}
                    </Link>
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill tone={bundle.expenses.payment_state === 'paid' ? 'green' : bundle.expenses.payment_state === 'advance' ? 'amber' : bundle.expenses.approval_status === 'pending' ? 'slate' : 'blue'}>
                        {bundle.expenses.payment_state === 'paid' ? 'Paid'
                          : bundle.expenses.payment_state === 'advance' ? 'Advance sent — awaiting GRN'
                          : bundle.expenses.payment_state === 'approved_to_pay' ? (isPayInAdvance ? 'Approved — ready to send advance' : 'Approved — ready to pay')
                          : bundle.expenses.approval_status === 'pending' ? 'Awaiting finance approval'
                          : 'Unpaid'}
                      </Pill>
                      <button onClick={() => linkExpense(null)} className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-red-500">
                        <Link2Off className="h-3 w-3" /> Unlink
                      </button>
                    </div>
                    {canCloseAdvance && (
                      <button onClick={handleCloseAdvance} disabled={closingAdvance}
                        className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
                        <CheckCircle2 className="h-3.5 w-3.5" /> {closingAdvance ? 'Closing…' : 'Close advance — mark paid'}
                      </button>
                    )}
                    {isPayInAdvance && bundle.expenses.payment_state === 'advance' && !grn && (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400">Waiting on a GRN before this advance can be closed.</p>
                    )}
                  </div>
                ) : canCreateExpense || canCreateAdvanceExpense ? (
                  <div className="space-y-2">
                    {canCreateAdvanceExpense && <p className="text-[11px] text-amber-600 dark:text-amber-400">No GRN yet — this records the advance now; closing it needs a GRN once goods arrive.</p>}
                    <Link to={`/expenses/new?bundle_id=${id}`} className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90">
                      <Plus className="h-3.5 w-3.5" /> {canCreateAdvanceExpense ? 'Record advance payment' : 'Create expense for this PO'}
                    </Link>
                    <div>
                      <p className="mb-1 text-[11px] text-slate-400">or link an existing expense:</p>
                      <SearchableSelect value={null} onChange={linkExpense} options={expenseOptions} placeholder="Search expenses…" />
                    </div>
                  </div>
                ) : (
                  <p className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {!grn ? "Payment can't be created until a GRN confirms the goods arrived." : 'The transport job needs to start before payment can be created.'}
                  </p>
                )}
              </Panel>
            )}

            <Panel title="Details" icon={FileText}>
              <FactList facts={[
                { label: 'Vendor', value: bundle.vendor_id ? <Link to={`/vendors/${bundle.vendor_id}`} className="text-brand hover:underline">{vendorDisplay}</Link> : vendorDisplay },
                { label: 'Procurement officer', value: bundle.procurement_officer?.full_name ?? '—' },
                ...(bundle.approver ? [{ label: 'Approved by', value: bundle.approver.full_name, hint: bundle.approved_at ? formatDate(bundle.approved_at) : undefined }] : []),
                { label: 'Created', value: formatDate(bundle.created_at) },
                { label: 'Expected delivery', value: bundle.expected_delivery_date ? formatDate(bundle.expected_delivery_date) : '—', tone: lateDelivery ? 'red' as const : undefined },
                { label: 'Payment', value: isPayInAdvance ? 'In advance' : 'On delivery' },
                { label: 'Projects', value: projectNames.length ? projectNames.join(', ') : '—' },
              ]} />
            </Panel>
          </>}
        />
      </div>
    </div>
  )
}
