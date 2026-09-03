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
  DollarSign, FileText, Building2, FolderKanban, Tag,
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
          vendor_receipt_facilitation:vrf_id ( record_name ),
          properties:property_id ( property_name, lease_start_date, lease_end_date ),
          cpo_bonds:cpo_bond_id ( bond_id_ref, total_bond_amount, bond_status )
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
            units: expense.quantity ?? null,
            unitLabel: expense.uom ?? 'pcs',
            rate: null,
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
  }, [expense, laborWorkers, requisitionInfo, paidToStaffName, transportRoute])

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
