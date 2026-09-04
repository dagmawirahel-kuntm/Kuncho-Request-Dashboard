import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { canApproveAsFinance, canIssuePaymentRequest } from '@/lib/expenseAccess'
import { useToast } from '@/contexts/ToastContext'
import { TrainerHintBanner } from '@/components/shared/TrainerHintBanner'
import { resolveHint } from '@/lib/trainerHints'
import { useStaffDirectory } from '@/hooks/useLookups'
import {
  ArrowLeft, Pencil, CheckCircle2, Clock, XCircle,
  DollarSign, FileText, Building2, FolderKanban, Tag, Wallet,
} from 'lucide-react'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { PaymentRequestActions } from '@/components/shared/PaymentRequestActions'
import { CashReceiptUploader } from '@/components/shared/CashReceiptUploader'
import type { Expense, ExpenseType } from '@/types/database'

// ── Theme by expense type ─────────────────────────────────────────────────────

const TYPE_THEME: Record<ExpenseType, { bg: string; label: string; abbr: string }> = {
  general:        { bg: '#1B3A5C', label: 'General Expense',  abbr: 'GE'  },
  purchase_order: { bg: '#0C4A6E', label: 'Purchase Order',   abbr: 'PO'  },
  vrf:            { bg: '#312E81', label: 'Vendor Receipt',    abbr: 'VRF' },
  cpo_bond:       { bg: '#4C1D95', label: 'CPO Bond',          abbr: 'CPO' },
  fuel:           { bg: '#92400E', label: 'Fuel',               abbr: 'FUEL' },
  subcontract:    { bg: '#164E63', label: 'Subcontract',        abbr: 'SUB' },
  maintenance:    { bg: '#78350F', label: 'Vehicle Maintenance', abbr: 'MNT' },
  property_rent:  { bg: '#365314', label: 'Property Rent',       abbr: 'RENT' },
  labor_payment:  { bg: '#0F766E', label: 'Labor Payment',       abbr: 'LBR' },
  transportation: { bg: '#0369A1', label: 'Transportation',      abbr: 'TRSP' },
}

type ExpenseWithJoins = Expense & {
  vendors: { vendor_name: string; bank_account: string | null; location: string | null } | null
  projects: { project_name: string } | null
  accounts: { account_name: string } | null
  categories: { category_name: string } | null
  sub_categories: { item_name: string } | null
  manager_profile: { full_name: string } | null
  finance_profile: { full_name: string } | null
  transfers: { transfer_id_code: string | null } | null
  vendor_receipt_facilitation: { record_name: string | null } | null
  properties: { property_name: string; lease_start_date: string | null; lease_end_date: string | null } | null
  cpo_bonds: { bond_id_ref: string | null; total_bond_amount: number | null; bond_status: string | null } | null
  vehicles: { name: string; plate_number: string | null; vehicle_type: string | null } | null
  sourcing_bundles: {
    bundle_code: string | null; status: string | null; payment_pattern: string | null
    expected_delivery_date: string | null; total_value: number | null
  } | null
  subcontractor_engagements: {
    scope_of_work: string | null; agreed_amount: number | null; percent_complete: number | null
    status: string | null; target_completion_date: string | null
  } | null
}

// The Payment Request document for a single labor draft used to live
// here as a `hidden print:block` component. It has moved into the shared
// template (lib/laborPaymentRequestDocument) that the batch view also
// uses, so the two stopped drifting apart — and so the document can be
// archived on issue rather than only printed.

// ── Detail page ───────────────────────────────────────────────────────────────

export default function ExpenseDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { role } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [rejecting, setRejecting] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')

  const { data: expense, isLoading } = useQuery({
    queryKey: ['expense-detail', id],
    queryFn: async () => {
      // Every embed names its foreign key explicitly. That matters most for
      // vendor_receipt_facilitation, which expenses reaches through two of
      // them: vrf_id, set on no rows, and vendor_receipt_facilitation_id,
      // which carries all 13. This embedded the dead one, so the VRF detail
      // block and the "Matched VRF" field never rendered for any expense.
      const { data, error } = await supabase
        .from('expenses')
        .select(`
          *,
          vendors:vendor_id ( vendor_name, bank_account, location ),
          projects:project_id ( project_name ),
          accounts:account_id ( account_name ),
          categories:category_id ( category_name ),
          sub_categories:sub_category_id ( item_name ),
          manager_profile:user_profiles!manager_approved_by ( full_name ),
          finance_profile:user_profiles!finance_approved_by ( full_name ),
          transfers:transfer_id ( transfer_id_code ),
          vendor_receipt_facilitation:vendor_receipt_facilitation_id ( record_name ),
          properties:property_id ( property_name, lease_start_date, lease_end_date ),
          cpo_bonds:cpo_bond_id ( bond_id_ref, total_bond_amount, bond_status ),
          vehicles:vehicle_id ( name, plate_number, vehicle_type ),
          sourcing_bundles:sourcing_bundle_id ( bundle_code, status, payment_pattern, expected_delivery_date, total_value ),
          subcontractor_engagements:subcontractor_engagement_id ( scope_of_work, agreed_amount, percent_complete, status, target_completion_date )
        `)
        .eq('id', id!)
        .single()
      if (error) throw error
      return data as ExpenseWithJoins
    },
    enabled: !!id,
  })

  // Labor payment breakdown (rollup drafts): staff names go through
  // v_staff_directory, not a raw staff embed — not every role that can
  // view an expense has RLS read access to `staff` directly (see the
  // same note on useStaffDirectory).
  const { data: staffDirectory = [] } = useStaffDirectory()
  const staffNameById = useMemo(() => new Map(staffDirectory.map((s: any) => [s.id, s.employee_name])), [staffDirectory])

  const { data: rawLaborWorkers = [] } = useQuery({
    queryKey: ['expense-labor-workers', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('labor_expense_workers')
        .select('id, staff_id, days_worked, day_rate, subtotal, gang_size, gang_member_names, overtime_hours, overtime_amount')
        .eq('expense_id', id!)
      if (error) throw error
      return data ?? []
    },
    enabled: !!id && !!expense?.rolled_up_from_requisition_id,
  })

  // Bank accounts are not in v_staff_directory, and widening that shared
  // view would hand account numbers to every role that can merely view an
  // expense. So they are fetched separately and only for the roles that
  // can issue a Payment Request; without them the document prints "no
  // account on file" rather than a wrong number.
  const workerStaffIds = useMemo(
    () => Array.from(new Set(rawLaborWorkers.map(w => w.staff_id))),
    [rawLaborWorkers],
  )
  const { data: bankByStaffId = new Map<string, string | null>() } = useQuery({
    queryKey: ['expense-labor-worker-banks', id, workerStaffIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff').select('id, bank_account').in('id', workerStaffIds)
      if (error) throw error
      return new Map((data ?? []).map(s => [s.id as string, (s.bank_account as string | null) ?? null]))
    },
    enabled: workerStaffIds.length > 0 && canIssuePaymentRequest(role),
  })

  const laborWorkers = useMemo(() => rawLaborWorkers.map(w => ({
    ...w,
    employee_name: staffNameById.get(w.staff_id) ?? 'Unknown staff',
    bank_account: bankByStaffId.get(w.staff_id) ?? null,
  })), [rawLaborWorkers, staffNameById, bankByStaffId])
  const paidToStaffName = expense?.paid_to_staff_id ? (staffNameById.get(expense.paid_to_staff_id) ?? null) : null

  const { data: requisitionInfo = null } = useQuery({
    queryKey: ['expense-labor-requisition', expense?.rolled_up_from_requisition_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('labor_requisitions')
        .select('role_needed, payment_basis, volume_unit, scope_of_work, site_location')
        .eq('id', expense!.rolled_up_from_requisition_id!)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!expense?.rolled_up_from_requisition_id,
  })

  // Transport payments have no forward column on expenses — the link runs
  // the other way (transportation_requests.expense_id) — so the route,
  // vehicle and driver the Payment Request document needs are a reverse
  // lookup, same pattern ExpenseFormPage uses for its "linked source" banner.
  const { data: transportRoute = null } = useQuery({
    queryKey: ['expense-transport-route', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transportation_requests')
        .select('pickup_location_text, dropoff_location_text, transport_mode, hired_vehicle_class, driver_name')
        .eq('expense_id', id!)
        .maybeSingle()
      if (error) throw error
      return data
    },
    enabled: !!id && expense?.expense_type === 'transportation',
  })

  // A purchase order is the one non-labor type that has a real itemised
  // breakdown behind it, so its Payment Request can list what was actually
  // bought instead of one lump line. The quantities and prices here are the
  // agreed ones (…_actual), which is what the vendor is being paid on.
  const { data: bundleItems = [] } = useQuery({
    queryKey: ['expense-bundle-items', expense?.sourcing_bundle_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sourcing_bundle_items')
        .select('id, quantity_actual, unit_price_actual, sort_order, order_items:order_item_id ( item_name, unit )')
        .eq('bundle_id', expense!.sourcing_bundle_id!)
        .order('sort_order')
      if (error) throw error
      return (data ?? []) as unknown as {
        id: string; quantity_actual: number | null; unit_price_actual: number | null
        order_items: { item_name: string | null; unit: string | null } | null
      }[]
    },
    enabled: !!expense?.sourcing_bundle_id && expense?.expense_type === 'purchase_order',
  })

  // Maintenance links back the same way transport does
  // (vehicle_maintenance_requests.expense_id), and carries the estimate the
  // job was approved against — worth printing next to what is being paid.
  const { data: maintenanceRequest = null } = useQuery({
    queryKey: ['expense-maintenance-request', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicle_maintenance_requests')
        .select('issue_description, estimated_cost, actual_cost, status')
        .eq('expense_id', id!)
        .maybeSingle()
      if (error) throw error
      return data
    },
    enabled: !!id && expense?.expense_type === 'maintenance',
  })

  // What else has already been claimed against this subcontract. Without it
  // nobody approving a progress payment can see whether it closes out the
  // contract or runs past it. Rejected claims are excluded — counting them
  // would overstate the commitment.
  const { data: subcontractClaimedElsewhere = 0 } = useQuery({
    queryKey: ['expense-subcontract-claimed', expense?.subcontractor_engagement_id, id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('amount_etb')
        .eq('subcontractor_engagement_id', expense!.subcontractor_engagement_id!)
        .neq('id', id!)
        .neq('approval_status', 'rejected')
      if (error) throw error
      return (data ?? []).reduce((sum, r) => sum + Number(r.amount_etb ?? 0), 0)
    },
    enabled: !!expense?.subcontractor_engagement_id && expense?.expense_type === 'subcontract',
  })

  // A vendor credit settles part of a payable with money the vendor already
  // holds — an overpaid advance, or a discount agreed after the order. The
  // amount lives on the expense itself (credit_applied_etb), which anyone who
  // can see the expense can read; this query is only for *where the credit
  // came from*, and vendor_credits is admin/executive/finance-only, so it
  // degrades to no provenance rather than to a wrong number.
  const creditApplied = Number(expense?.credit_applied_etb ?? 0)
  const { data: creditApplications = [] } = useQuery({
    queryKey: ['expense-vendor-credits', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vendor_credit_applications')
        .select(`
          id, amount_etb, applied_at, notes,
          vendor_credits:vendor_credit_id (
            reason,
            source_sourcing_bundle:source_sourcing_bundle_id ( bundle_code ),
            source_expense:source_expense_id ( expense_code )
          )
        `)
        .eq('applied_to_expense_id', id!)
        .order('applied_at')
      if (error) throw error
      return (data ?? []) as unknown as {
        id: string; amount_etb: number | null; applied_at: string | null; notes: string | null
        vendor_credits: {
          reason: string | null
          source_sourcing_bundle: { bundle_code: string | null } | null
          source_expense: { expense_code: string | null } | null
        } | null
      }[]
    },
    enabled: !!id && creditApplied > 0,
  })

  // One line naming the origin of each credit, for the Payment Request note.
  const creditNote = useMemo(() => {
    const parts = creditApplications.map(a => {
      const c = a.vendor_credits
      const src = c?.source_sourcing_bundle?.bundle_code ?? c?.source_expense?.expense_code ?? null
      return [src, c?.reason].filter(Boolean).join(' · ')
    }).filter(Boolean)
    return parts.length > 0 ? Array.from(new Set(parts)).join('; ') : null
  }, [creditApplications])

  // Trainer hint: ledger_posting_failures is keyed by source_table/source_id
  // (polymorphic — no real FK), so it can't ride along on the join above.
  const { data: hasUnresolvedLedgerFailure } = useQuery({
    queryKey: ['expense-has-ledger-failure', id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('ledger_posting_failures')
        .select('id', { count: 'exact', head: true })
        .eq('source_table', 'expenses').eq('source_id', id!).eq('resolved', false)
      if (error) throw error
      return (count ?? 0) > 0
    },
    enabled: !!id,
  })
  const expenseHint = useMemo(() => {
    if (!expense || hasUnresolvedLedgerFailure === undefined) return null
    return resolveHint({
      entityType: 'expense',
      id: expense.id,
      approvalStatus: expense.approval_status,
      accountId: expense.account_id,
      hasUnresolvedLedgerFailure,
      isFinanceUser: canApproveAsFinance(role),
    })
  }, [expense, hasUnresolvedLedgerFailure, role])

  // The Payment Request document, in the shape the shared template takes.
  // A single expense is a one-draft request; everything else — the payee
  // grouping, the totals, the amount in words — the template derives.
  const prDocument = useMemo(() => {
    if (!expense) return null
    const isVolume = requisitionInfo?.payment_basis === 'per_volume'
    const unitLabel = isVolume ? (requisitionInfo?.volume_unit ?? 'units') : 'days'
    const fuelLiters = expense.fuel_liters == null ? null : Number(expense.fuel_liters)
    const vendorPayee = (expense.vendors?.vendor_name ?? expense.vendors_name) ?? 'Vendor'
    const vendorAccount = expense.vendors?.bank_account ?? expense.vendors_bank_account ?? null
    const blankLine = {
      expenseId: expense.id, staffId: expense.id, name: vendorPayee, bankAccount: vendorAccount,
      overtimeHours: null, overtimeAmount: null, gangSize: null, gangMemberNames: null,
      vendorName: null, vendorBankAccount: null,
    }

    // One row per item actually ordered. Bundle items are priced net, while
    // the expense is sometimes booked gross (VAT-inclusive) or net of a
    // vendor discount agreed after the fact — so any difference between the
    // two is carried as its own line rather than left to trip the document's
    // "disbursement total disagrees with the request total" alert.
    const poItemLines = bundleItems.map(bi => {
      const qty = bi.quantity_actual == null ? null : Number(bi.quantity_actual)
      const price = bi.unit_price_actual == null ? null : Number(bi.unit_price_actual)
      return {
        ...blankLine,
        id: bi.id,
        description: bi.order_items?.item_name ?? 'Item',
        units: qty,
        unitLabel: bi.order_items?.unit ?? '',
        rate: price,
        subtotal: qty != null && price != null ? qty * price : null,
      }
    })
    const poItemsTotal = poItemLines.reduce((sum, l) => sum + (l.subtotal ?? 0), 0)
    const poDelta = Number(expense.amount_etb ?? 0) - poItemsTotal
    // A positive difference is the VAT the expense is booked gross of (the
    // items are net); a negative one is a discount agreed after the bundle
    // was priced. Naming it matters on a document finance signs.
    const poVatRate = poItemsTotal > 0 ? Math.round((poDelta / poItemsTotal) * 100) : 0
    const poLines = poItemLines.length > 0 && Math.abs(poDelta) > 0.005
      ? [...poItemLines, {
          ...blankLine,
          id: `${expense.id}-adj`,
          description: poDelta > 0
            ? (poVatRate > 0 ? `VAT (${poVatRate}%)` : 'VAT')
            : 'Discount / adjustment',
          units: null, unitLabel: '', rate: null, subtotal: poDelta,
        }]
      : poItemLines

    // The fields a rent/transport/bond/VRF payment actually needs to be
    // presentable — without this every non-labor expense_type fell back
    // to the same worker-shaped document with nothing type-specific to show.
    const typeDetail = (() => {
      switch (expense.expense_type) {
        case 'transportation':
          return transportRoute ? {
            label: 'Route / Vehicle',
            rows: [
              { label: 'Route', value: `${transportRoute.pickup_location_text ?? '—'} → ${transportRoute.dropoff_location_text ?? '—'}` },
              ...(transportRoute.transport_mode ? [{ label: 'Mode', value: transportRoute.transport_mode }] : []),
              ...(transportRoute.hired_vehicle_class ? [{ label: 'Vehicle Class', value: transportRoute.hired_vehicle_class }] : []),
              ...(transportRoute.driver_name ? [{ label: 'Driver', value: transportRoute.driver_name }] : []),
            ],
          } : null
        case 'property_rent':
          return expense.properties ? {
            label: 'Property / Lease',
            rows: [
              { label: 'Property', value: expense.properties.property_name },
              ...(expense.properties.lease_start_date || expense.properties.lease_end_date ? [{
                label: 'Lease Period',
                value: `${expense.properties.lease_start_date ? formatDate(expense.properties.lease_start_date) : '—'} → ${expense.properties.lease_end_date ? formatDate(expense.properties.lease_end_date) : '—'}`,
              }] : []),
            ],
          } : null
        case 'cpo_bond':
          return expense.cpo_bonds ? {
            label: 'CPO Bond',
            rows: [
              { label: 'Bond Ref', value: expense.cpo_bonds.bond_id_ref ?? '—' },
              ...(expense.cpo_bonds.total_bond_amount != null ? [{ label: 'Total Bond Amount', value: formatCurrency(expense.cpo_bonds.total_bond_amount) }] : []),
              ...(expense.cpo_bonds.bond_status ? [{ label: 'Status', value: expense.cpo_bonds.bond_status }] : []),
            ],
          } : null
        case 'vrf':
          return expense.vendor_receipt_facilitation ? {
            label: 'Vendor Receipt Facilitation',
            rows: [{ label: 'Record', value: expense.vendor_receipt_facilitation.record_name ?? '—' }],
          } : null
        case 'fuel': {
          // Litres and vehicle live on the expense itself; the rate per litre
          // is what makes one fill comparable to the last.
          const liters = fuelLiters
          const amount = expense.amount_etb == null ? null : Number(expense.amount_etb)
          if (!expense.vehicles && liters == null) return null
          return {
            label: 'Vehicle / Fuel',
            rows: [
              ...(expense.vehicles ? [{
                label: 'Vehicle',
                value: [expense.vehicles.name, expense.vehicles.plate_number].filter(Boolean).join(' · '),
              }] : []),
              ...(liters != null ? [{ label: 'Quantity', value: `${liters} L` }] : []),
              ...(liters && amount != null ? [{ label: 'Rate', value: `${formatCurrency(amount / liters)} / L` }] : []),
            ],
          }
        }
        case 'purchase_order': {
          const sb = expense.sourcing_bundles
          if (!sb) return null
          return {
            label: 'Purchase Order',
            rows: [
              { label: 'PO', value: sb.bundle_code ?? '—' },
              ...(sb.status ? [{ label: 'Status', value: sb.status.replace(/_/g, ' ') }] : []),
              // Whether money leaves before the goods arrive is the single
              // thing an approver most needs to see on a PO payment.
              ...(sb.payment_pattern ? [{ label: 'Payment Terms', value: sb.payment_pattern.replace(/_/g, ' ') }] : []),
              ...(sb.expected_delivery_date ? [{ label: 'Expected Delivery', value: formatDate(sb.expected_delivery_date) }] : []),
            ],
          }
        }
        case 'subcontract': {
          const se = expense.subcontractor_engagements
          if (!se) return null
          const agreed = se.agreed_amount == null ? null : Number(se.agreed_amount)
          const thisPayment = Number(expense.amount_etb ?? 0)
          const remaining = agreed == null ? null : agreed - subcontractClaimedElsewhere - thisPayment
          return {
            label: 'Subcontract',
            rows: [
              ...(se.scope_of_work ? [{ label: 'Scope', value: se.scope_of_work.trim() }] : []),
              ...(agreed != null ? [{ label: 'Contract Value', value: formatCurrency(agreed) }] : []),
              // Progress payments are the case where the document alone has
              // to show whether this one closes out the contract or overruns.
              { label: 'Previously Claimed', value: formatCurrency(subcontractClaimedElsewhere) },
              { label: 'This Payment', value: formatCurrency(thisPayment) },
              ...(remaining != null ? [{
                label: 'Remaining After This',
                value: `${formatCurrency(remaining)}${remaining < -0.005 ? ' — EXCEEDS CONTRACT' : ''}`,
              }] : []),
              ...(se.percent_complete != null ? [{ label: 'Work Complete', value: `${se.percent_complete}%` }] : []),
            ],
          }
        }
        case 'maintenance': {
          if (!expense.vehicles && !maintenanceRequest) return null
          const est = maintenanceRequest?.estimated_cost == null ? null : Number(maintenanceRequest.estimated_cost)
          return {
            label: 'Vehicle / Maintenance',
            rows: [
              ...(expense.vehicles ? [{
                label: 'Vehicle',
                value: [expense.vehicles.name, expense.vehicles.plate_number].filter(Boolean).join(' · '),
              }] : []),
              ...(maintenanceRequest?.issue_description ? [{ label: 'Work', value: maintenanceRequest.issue_description.trim() }] : []),
              ...(est != null ? [{ label: 'Approved Estimate', value: formatCurrency(est) }] : []),
              ...(maintenanceRequest?.status ? [{ label: 'Status', value: maintenanceRequest.status.replace(/_/g, ' ') }] : []),
            ],
          }
        }
        default:
          return null
      }
    })()

    return {
      kind: 'single' as const,
      sourceCode: expense.expense_code ?? null,
      issuedOn: new Date().toISOString().slice(0, 10),
      issuedByName: null,
      drafts: [{
        id: expense.id,
        code: expense.expense_code ?? null,
        description: expense.item_service_description ?? null,
        amount: expense.amount_etb ?? null,
        projectName: expense.projects?.project_name ?? expense.project_name ?? null,
        role: requisitionInfo?.role_needed ?? null,
        periodStart: expense.rollup_period_start ?? null,
        periodEnd: expense.rollup_period_end ?? null,
        scopeOfWork: requisitionInfo?.scope_of_work ?? null,
        siteLocation: requisitionInfo?.site_location ?? null,
      }],
      // A labor rollup carries a per-worker breakdown. Anything else is a
      // single payee, so the vendor (or the staff member being paid)
      // stands in as the one line — otherwise the disbursement schedule
      // would come out empty on exactly the documents finance prints most.
      workers: laborWorkers.length > 0
        ? laborWorkers.map(w => ({
            id: w.id,
            expenseId: expense.id,
            staffId: w.staff_id,
            name: w.employee_name,
            bankAccount: w.bank_account,
            units: w.days_worked,
            unitLabel,
            rate: w.day_rate,
            subtotal: w.subtotal,
            overtimeHours: w.overtime_hours,
            overtimeAmount: w.overtime_amount,
            gangSize: w.gang_size,
            gangMemberNames: w.gang_member_names,
            vendorName: expense.vendors?.vendor_name ?? expense.vendors_name ?? null,
            vendorBankAccount: expense.vendors?.bank_account ?? expense.vendors_bank_account ?? null,
          }))
        // A purchase order bills real items, so each one is its own line.
        // They share a payee, so the disbursement schedule still resolves to
        // a single transfer to the vendor.
        : bundleItems.length > 0
        ? poLines
        : [{
            id: expense.id,
            expenseId: expense.id,
            staffId: expense.paid_to_staff_id ?? expense.id,
            name: (expense.vendors?.vendor_name ?? expense.vendors_name)
              ?? paidToStaffName ?? (expense.item_service_description ?? 'Payee'),
            // The payee names who the bank pays; the breakdown row says what
            // was bought. Same string in both columns tells a reader nothing.
            description: expense.item_service_description ?? null,
            bankAccount: expense.vendors?.bank_account ?? expense.vendors_bank_account ?? null,
            // Fuel records its quantity in its own column rather than the
            // generic quantity/uom pair, so the litres and the birr-per-litre
            // they imply reach the page instead of a pair of dashes.
            units: fuelLiters ?? expense.quantity ?? null,
            unitLabel: fuelLiters != null ? 'L' : (expense.uom ?? 'pcs'),
            rate: fuelLiters ? Number(expense.amount_etb ?? 0) / fuelLiters : null,
            subtotal: expense.amount_etb ?? null,
            overtimeHours: null,
            overtimeAmount: null,
            gangSize: null,
            gangMemberNames: null,
            vendorName: null,
            vendorBankAccount: null,
          }],
      approvals: [
        { label: 'Requested By', name: null, date: expense.created_at ?? null },
        {
          label: 'Finance Approved',
          name: expense.finance_profile?.full_name ?? null,
          date: expense.finance_approved_at ?? null,
        },
        { label: 'Disbursed By', name: null, date: null },
      ],
      total: expense.amount_etb ?? 0,
      notes: expense.notes ?? null,
      whtRequired: !!expense.verify_wht,
      whtMethod: expense.wht_handling_method ?? null,
      // Stored on the expense (3% of the VAT-exclusive base) and, until now,
      // never printed — the document showed the gross as the amount to
      // disburse even where net_payable was already lower.
      whtAmount: expense.wht_amount ?? null,
      // amount_etb is unchanged by a credit, so without this the document
      // authorises the gross while the To Pay queue expects cash_to_send.
      creditApplied: creditApplied > 0 ? creditApplied : null,
      creditNote,
      fundingAccount: expense.accounts?.account_name ?? null,
      paymentMethod: expense.payment_method ?? null,
      typeDetail,
      accentColor: TYPE_THEME[expense.expense_type ?? 'general']?.bg ?? null,
      // A labor rollup is the only kind that has real workers behind it.
      // Everything else is a vendor billing line items, and saying so keeps
      // the document from printing it as a one-person payslip.
      breakdownKind: laborWorkers.length > 0 ? ('labor' as const) : ('line_items' as const),
      typeLabel: TYPE_THEME[expense.expense_type ?? 'general']?.label ?? null,
    }
  }, [expense, laborWorkers, requisitionInfo, paidToStaffName, transportRoute,
      bundleItems, maintenanceRequest, subcontractClaimedElsewhere,
      creditApplied, creditNote])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-slate-400 text-sm">Loading…</p>
      </div>
    )
  }

  if (!expense) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-slate-500">Expense not found.</p>
        <Link to="/expenses" className="text-sm text-blue-600 hover:underline">← Back to Approvals</Link>
      </div>
    )
  }

  const theme = TYPE_THEME[expense.expense_type ?? 'general'] ?? TYPE_THEME.general
  const canEdit = role === 'admin' || role === 'executive' || role === 'finance'

  const approvalStatus = expense.approval_status ?? 'pending'
  // Single gate since migration 163 — see ExpenseFormPage for the rationale.
  const showFinanceActions = (approvalStatus === 'pending' || approvalStatus === 'manager_approved')
    && canApproveAsFinance(role)
  const canResubmit = approvalStatus === 'rejected' && (role === 'admin' || role === 'executive')

  async function handleApprovalTransition(nextStatus: string, extra: Record<string, unknown> = {}) {
    if (!id) return
    const { error } = await supabase.from('expenses').update({ approval_status: nextStatus, ...extra }).eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['expense-detail', id] })
    qc.invalidateQueries({ queryKey: ['expenses'] })
    toast('Approval updated', 'success')
    setRejecting(false)
    setRejectionReason('')
  }

  const projectName = expense.projects?.project_name ?? expense.project_name
  const vendorName  = expense.vendors?.vendor_name ?? expense.vendors_name
  const vendorBank  = expense.vendors?.bank_account ?? expense.vendors_bank_account

  const approvalSteps: { label: string; done: boolean; date: string | null; by: string | null }[] = [
    {
      label: 'Submitted',
      done: true,
      date: expense.created_at,
      by: null,
    },
    // The manager rung was retired in migration 163. Show it only for
    // rows that actually went through it, rather than leaving a step
    // that can never complete sitting in every expense's timeline.
    ...(expense.manager_approved_at ? [{
      label: 'Manager Approved',
      done: true,
      date: expense.manager_approved_at,
      by: (expense as any).manager_profile?.full_name ?? null,
    }] : []),
    {
      label: 'Finance Approved',
      done: !!expense.finance_approved_at,
      date: expense.finance_approved_at,
      by: (expense as any).finance_profile?.full_name ?? null,
    },
    // Payment is the final rung. It was missing from the timeline, so a paid
    // expense still looked like it stopped at Finance Approved. Show it on every
    // record (grey until settled) the same way Finance Approved shows.
    {
      label: 'Paid',
      done: expense.payment_state === 'paid' || expense.payment_status === true,
      date: expense.paid_date ?? (expense as any).total_payment_date ?? expense.payment_state_changed_at ?? null,
      by: null,
    },
  ]

  return (
      <div className="space-y-5">

        {/* Back + actions */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <ArrowLeft className="h-4 w-4" /> Approvals
          </button>
          <div className="flex items-center gap-2 flex-wrap">
            {showFinanceActions && !rejecting && (
              <>
                <button
                  onClick={() => handleApprovalTransition('finance_approved')}
                  className="flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Approve for Payment
                </button>
                <button
                  onClick={() => setRejecting(true)}
                  className="flex items-center gap-1.5 rounded-md border border-red-200 dark:border-red-800 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  <XCircle className="h-3.5 w-3.5" /> Reject
                </button>
              </>
            )}
            {canResubmit && !rejecting && (
              <button
                onClick={() => handleApprovalTransition('pending', { rejection_reason: null })}
                className="rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50"
              >
                Resubmit
              </button>
            )}
            {id && prDocument && (
              <PaymentRequestActions sourceType="expense" sourceId={id} document={prDocument} />
            )}
            {canEdit && (
              <Link
                to={`/expenses/${id}/edit`}
                className="flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Link>
            )}
          </div>
        </div>

        {/* Rejection panel */}
        {rejecting && (
          <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 space-y-3">
            <p className="text-sm font-semibold text-red-700 dark:text-red-400">Provide a reason for rejection</p>
            <textarea
              rows={2}
              className="w-full rounded-md border border-red-200 dark:border-red-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-400"
              placeholder="Rejection reason…"
              value={rejectionReason}
              onChange={e => setRejectionReason(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                disabled={!rejectionReason.trim()}
                onClick={() => handleApprovalTransition('rejected', { rejection_reason: rejectionReason.trim() })}
                className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                Confirm Reject
              </button>
              <button
                onClick={() => { setRejecting(false); setRejectionReason('') }}
                className="rounded-md border px-3 py-1.5 text-xs hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <TrainerHintBanner entityType="expense" entityId={expense.id} hint={expenseHint} />

        {/* Hero card */}
        <div className="rounded-2xl overflow-hidden" style={{ background: theme.bg }}>
          <div className="relative px-6 py-7 overflow-hidden">
            {/* Watermark */}
            <span
              className="pointer-events-none select-none absolute -right-4 -bottom-6 font-black leading-none opacity-[0.06]"
              style={{ fontSize: '8rem', color: '#fff' }}
              aria-hidden
            >
              {theme.abbr}
            </span>

            <div className="relative z-10">
              <div className="flex items-center gap-3 mb-5">
                <div
                  className="h-12 w-12 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0 border border-white/20"
                  style={{ background: 'rgba(255,255,255,0.18)', color: '#fff' }}
                >
                  {theme.abbr}
                </div>
                <div>
                  <p className="text-white/60 text-xs uppercase tracking-widest">{theme.label}</p>
                  <h1 className="text-white font-bold text-lg leading-tight font-mono">{expense.expense_code ?? '—'}</h1>
                </div>
              </div>

              <p className="text-white/80 text-base font-medium mb-4 max-w-xl leading-snug">
                {expense.item_service_description ?? '—'}
              </p>

              <div className="flex flex-wrap gap-2">
                <StatusBadge status={expense.approval_status} />
                {expense.payment_status && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(255,255,255,0.18)', color: '#fff' }}>
                    Paid
                  </span>
                )}
                {expense.date && (
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.8)' }}>
                    {formatDate(expense.date)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Stat strip */}
          <div className="grid grid-cols-3 text-center divide-x divide-white/10" style={{ background: 'rgba(0,0,0,0.22)' }}>
            <div className="py-3 px-2">
              <p className="text-white/50 text-xs uppercase tracking-wide">Amount</p>
              <p className="text-white font-black text-xl tabular-nums">
                {expense.amount_etb != null ? formatCurrency(expense.amount_etb) : '—'}
              </p>
            </div>
            <div className="py-3 px-2">
              <p className="text-white/50 text-xs uppercase tracking-wide">Project</p>
              <p className="text-white font-bold text-sm truncate">{projectName ?? '—'}</p>
            </div>
            <div className="py-3 px-2">
              <p className="text-white/50 text-xs uppercase tracking-wide">Vendor</p>
              <p className="text-white font-bold text-sm truncate">{vendorName ?? '—'}</p>
            </div>
          </div>
        </div>

        {/* Approval timeline */}
        <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b dark:border-slate-700">
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Approval Status</h2>
          </div>
          <div className="p-5">
            {expense.approval_status === 'rejected' && expense.rejection_reason && (
              <div className="mb-5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 flex gap-2.5">
                <XCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-700 dark:text-red-400">Rejected</p>
                  <p className="text-xs text-red-600 dark:text-red-300 mt-0.5">{expense.rejection_reason}</p>
                </div>
              </div>
            )}
            <div className="flex items-start gap-1 flex-wrap">
              {approvalSteps.map((step, i) => {
                const stepCls = step.done
                  ? i === 0
                    ? 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                    : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500'

                return (
                  <div key={step.label} className="flex items-start gap-1">
                    {i > 0 && <div className="mt-4 h-px w-5 bg-slate-200 dark:bg-slate-600 flex-shrink-0" />}
                    <div className="flex flex-col items-center gap-1.5 min-w-[96px] max-w-[120px]">
                      <div className={`h-9 w-9 rounded-full flex items-center justify-center flex-shrink-0 ${stepCls}`}>
                        {step.done
                          ? <CheckCircle2 className="h-4 w-4" />
                          : <Clock className="h-4 w-4" />
                        }
                      </div>
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 text-center leading-tight">{step.label}</p>
                      {step.date && (
                        <p className="text-[10px] text-slate-400 text-center">{formatDate(step.date)}</p>
                      )}
                      {step.by && (
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 text-center font-medium">{step.by}</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Settlement — only shown when the cash actually leaving differs from
            the invoice amount. The stat strip and the Details grid both show
            amount_etb, which is right (the purchase cost that) but is not
            what gets wired once WHT is withheld or a vendor credit is
            applied. Without this the discount on a PO was invisible
            everywhere except the To Pay queue. */}
        {(creditApplied > 0 || Number(expense.wht_amount ?? 0) > 0) && (
          <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b dark:border-slate-700 flex items-center gap-2">
              <Wallet className="h-4 w-4 text-slate-400" />
              <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Settlement</h2>
            </div>
            <div className="p-5 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Invoice total</span>
                <span className="tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(expense.amount_etb ?? 0)}</span>
              </div>
              {Number(expense.wht_amount ?? 0) > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Less withholding tax</span>
                  <span className="tabular-nums text-slate-600 dark:text-slate-300">({formatCurrency(Number(expense.wht_amount))})</span>
                </div>
              )}
              {creditApplied > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Less vendor credit applied</span>
                  <span className="tabular-nums text-emerald-600 dark:text-emerald-400">({formatCurrency(creditApplied)})</span>
                </div>
              )}
              <div className="flex justify-between border-t dark:border-slate-700 pt-2 font-semibold">
                <span className="text-slate-700 dark:text-slate-200">Cash to send</span>
                <span className="tabular-nums text-slate-900 dark:text-slate-50">
                  {formatCurrency(Number(expense.amount_etb ?? 0) - Number(expense.wht_amount ?? 0) - creditApplied)}
                </span>
              </div>
              {creditApplications.length > 0 && (
                <div className="pt-2 space-y-1">
                  {creditApplications.map(a => {
                    const c = a.vendor_credits
                    const src = c?.source_sourcing_bundle?.bundle_code ?? c?.source_expense?.expense_code ?? null
                    return (
                      <p key={a.id} className="text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-medium text-emerald-600 dark:text-emerald-400 tabular-nums">
                          {formatCurrency(Number(a.amount_etb ?? 0))}
                        </span>
                        {src ? ` from ${src}` : ' from vendor credit'}
                        {c?.reason ? ` — ${c.reason}` : ''}
                        {a.applied_at ? ` · applied ${formatDate(a.applied_at)}` : ''}
                      </p>
                    )
                  })}
                </div>
              )}
              {creditApplied > 0 && creditApplications.length === 0 && (
                <p className="pt-2 text-xs text-slate-400">
                  Credit provenance is visible to finance and admin only.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Details grid */}
        <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b dark:border-slate-700">
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Details</h2>
          </div>
          <div className="divide-y dark:divide-slate-700">
            {([
              { label: 'Description',        value: expense.item_service_description,                                          icon: <FileText className="h-3.5 w-3.5" /> },
              { label: 'Amount (ETB)',        value: expense.amount_etb != null ? formatCurrency(expense.amount_etb) : null,   icon: <DollarSign className="h-3.5 w-3.5" /> },
              { label: 'Date',               value: expense.date ? formatDate(expense.date) : null,                           icon: null },
              { label: 'Vendor',             value: vendorName,                                                                icon: <Building2 className="h-3.5 w-3.5" /> },
              { label: 'Vendor Bank Account',value: vendorBank,                                                                icon: null },
              { label: 'Project',            value: projectName,                                                               icon: <FolderKanban className="h-3.5 w-3.5" /> },
              { label: 'Account',            value: expense.accounts?.account_name ?? null,                                   icon: null },
              { label: 'Category',           value: expense.categories?.category_name ?? null,                                icon: <Tag className="h-3.5 w-3.5" /> },
              { label: 'Sub-category',       value: expense.sub_categories?.item_name ?? null,                                icon: null },
              { label: 'Quantity / UOM',     value: expense.quantity != null ? `${expense.quantity}${expense.uom ? ' ' + expense.uom : ''}` : null, icon: null },
              { label: 'Purchase Type',      value: expense.purchase_type,                                                    icon: null },
              { label: 'Notes',              value: expense.notes,                                                            icon: null },
              { label: 'Bank Reference',     value: expense.bank_ref,                                                         icon: null },
              { label: 'WHT',                value: expense.verify_wht ? `Required${expense.wht_handling_method ? ' — ' + expense.wht_handling_method : ''}` : null, icon: null },
              { label: 'Payment Method',     value: expense.payment_method,                                                   icon: null },
              { label: 'Matched Bank Line',  value: expense.transfers?.transfer_id_code ?? null,                              icon: null },
              { label: 'Matched VRF',        value: expense.vendor_receipt_facilitation?.record_name ?? null,                icon: null },
            ] as { label: string; value: string | null | undefined; icon: React.ReactNode }[])
              .filter(r => r.value)
              .map(row => (
                <div key={row.label} className="flex items-start gap-3 px-5 py-3">
                  <div className="w-40 shrink-0 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 pt-0.5">
                    {row.icon}
                    {row.label}
                  </div>
                  <p className="text-sm text-slate-800 dark:text-slate-100 flex-1 break-words">{row.value}</p>
                </div>
              ))
            }
          </div>
        </div>

        {/* Cash / VRF receipt evidence — no bank reference to collect for
            these payment methods, a physical receipt photo instead.
            Upload/delete matches cash_payment_receipts RLS: admin/finance
            only (not manager, unlike the general canEdit gate above). */}
        {(expense.payment_method === 'cash' || expense.payment_method === 'vrf') && (role === 'admin' || role === 'finance') && (
          <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b dark:border-slate-700">
              <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Receipt Evidence</h2>
            </div>
            <div className="p-5">
              <CashReceiptUploader expenseId={expense.id} />
            </div>
          </div>
        )}

      </div>
  )
}
