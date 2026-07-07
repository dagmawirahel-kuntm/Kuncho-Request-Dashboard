import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { StatusBadge } from '@/components/shared/StatusBadge'
import type { Expense, ExpenseInsert, Order, OrderItem, VendorReceiptFacilitation } from '@/types/database'
import { useVendors, useProjects, useCategories, useSubCategories, useAccounts, useVendorReceiptFacilitations, useTransfers, useTaxSummaries, useLocations, useUserProfiles } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { canEditFinanceFields, canApproveAsManager, canApproveAsFinance } from '@/lib/expenseAccess'
import { formatCurrency, formatDate } from '@/lib/utils'
import { FileUpload } from '@/components/shared/FileUpload'
import { Lock, Package, Fuel, Truck, EyeOff, Eye } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed'
function Field({ label, locked, children }: { label: string; locked?: boolean; children: React.ReactNode }) {
  const required = label.endsWith('*')
  return (
    <div>
      <label className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">
        {required ? label.slice(0, -1).trim() : label}
        {required && <span className="text-brand"> *</span>}
        {locked && <span title="Finance only" className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-normal text-slate-400"><Lock className="h-2.5 w-2.5" /> Finance only</span>}
      </label>
      {children}
    </div>
  )
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mt-5 mb-1 border-b-2 border-slate-200 dark:border-slate-600 pb-2 first:mt-0">
      <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">{title}</h3>
      {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
    </div>
  )
}

const UOM_OPTIONS = ['Pcs', 'Kg', 'L', 'm', 'm²', 'm³', 'Hr', 'Day', 'Month', 'Set', 'Other']
const DELIVERY_STATUS_OPTIONS = ['Ordered', 'In Transit', 'Delivered', 'Returned']

export default function ExpenseFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const returnTo: string = (location.state as { returnTo?: string })?.returnTo ?? '/expenses'
  const prId   = searchParams.get('pr_id')
  const lineId = searchParams.get('line_id')
  const vrfId  = searchParams.get('vrf_id')

  const { data: record, isLoading } = useQuery({
    queryKey: ['expense', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('expenses').select('*').eq('id', id).single()
      if (error) throw error
      return data as Expense
    },
    enabled: isEdit,
  })

  const { data: linkedPr } = useQuery({
    queryKey: ['pr-for-expense', prId],
    queryFn: async () => {
      const { data, error } = await supabase.from('orders').select('*').eq('id', prId!).single()
      if (error) throw error
      return data as Order
    },
    enabled: !isEdit && !!prId,
  })

  const { data: linkedLineItem } = useQuery({
    queryKey: ['pr-line-for-expense', lineId],
    queryFn: async () => {
      const { data, error } = await supabase.from('order_items').select('*').eq('id', lineId!).single()
      if (error) throw error
      return data as OrderItem
    },
    enabled: !isEdit && !!lineId,
  })

  const { data: linkedVrf } = useQuery({
    queryKey: ['vrf-for-expense', vrfId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vendor_receipt_facilitation')
        .select('*, initial:accounts!initial_account_id(account_name)')
        .eq('id', vrfId!)
        .single()
      if (error) throw error
      return data as VendorReceiptFacilitation & { initial: { account_name: string } | null }
    },
    enabled: !isEdit && !!vrfId,
  })

  if (isEdit && isLoading) {
    return <FormPage title="Edit Expense" backTo={returnTo} loading onSave={() => {}} />
  }

  return (
    <ExpenseFormPageBody
      id={id}
      record={record}
      returnTo={returnTo}
      linkedPr={linkedPr}
      linkedLineItem={linkedLineItem}
      linkedVrf={linkedVrf}
    />
  )
}

function ExpenseFormPageBody({ id, record, returnTo = '/expenses', linkedPr, linkedLineItem, linkedVrf }: {
  id?: string; record?: Expense; returnTo?: string
  linkedPr?: Order; linkedLineItem?: OrderItem
  linkedVrf?: (VendorReceiptFacilitation & { initial: { account_name: string } | null })
}) {
  const isEdit = !!id
    const navigate = useNavigate()
    const { user, role } = useAuth()
    const { toast } = useToast()
    const qc = useQueryClient()
    const { data: vendors = [] } = useVendors()
    const { data: projects = [] } = useProjects()
    const { data: categories = [] } = useCategories()
    const { data: subCategories = [] } = useSubCategories()
    const { data: accounts = [] } = useAccounts()
    const { data: vendorReceiptFacilitations = [] } = useVendorReceiptFacilitations()
    const { data: transfers = [] } = useTransfers()
    const { data: taxSummaries = [] } = useTaxSummaries()
    const { data: locations = [] } = useLocations()
    const { data: userProfiles = [] } = useUserProfiles()

    const financeLocked = !canEditFinanceFields(role)

    const { data: linkedOrders = [] } = useQuery({
      queryKey: ['expense-linked-orders', id],
      queryFn: async () => {
        const { data, error } = await supabase.from('order_expenses').select('orders(id,order_date,item_service_description)').eq('expense_id', id)
        if (error) throw error
        return (data ?? []).map((r: any) => r.orders).filter(Boolean)
      },
      enabled: isEdit,
    })
    const { data: linkedBatchPayments = [] } = useQuery({
      queryKey: ['expense-linked-batch-payments', id],
      queryFn: async () => {
        const { data, error } = await supabase.from('batch_payment_expenses').select('batch_payments(id,payment_code)').eq('expense_id', id)
        if (error) throw error
        return (data ?? []).map((r: any) => r.batch_payments).filter(Boolean)
      },
      enabled: isEdit,
    })
    const { data: linkedCashAdvances = [] } = useQuery({
      queryKey: ['expense-linked-cash-advances', id],
      queryFn: async () => {
        const { data, error } = await supabase.from('cash_advance_expenses').select('cash_advances(id,advance_id_code,amount_advanced)').eq('expense_id', id)
        if (error) throw error
        return (data ?? []).map((r: any) => r.cash_advances).filter(Boolean)
      },
      enabled: isEdit,
    })
    const { data: fuelVehicle } = useQuery({
      queryKey: ['expense-fuel-vehicle', record?.vehicle_id],
      queryFn: async () => {
        const { data, error } = await supabase.from('vehicles').select('id, name, plate_number').eq('id', record!.vehicle_id!).single()
        if (error) throw error
        return data as { id: string; name: string; plate_number: string | null }
      },
      enabled: isEdit && record?.expense_type === 'fuel' && !!record?.vehicle_id,
    })
    // Transport payments have no forward column on expenses — the link runs
    // the other way (transportation_requests.expense_id), same as orders/
    // batch payments/cash advances below, so this is a reverse lookup too.
    const { data: linkedTransportJob } = useQuery({
      queryKey: ['expense-transport-job', id],
      queryFn: async () => {
        const { data, error } = await supabase.from('transportation_requests').select('id, request_name').eq('expense_id', id!).maybeSingle()
        if (error) throw error
        return data as { id: string; request_name: string | null } | null
      },
      enabled: isEdit,
    })
    const isCuratedGateway = isEdit && (record?.expense_type === 'fuel' || !!linkedTransportJob)
    const [showAllFields, setShowAllFields] = useState(false)
    const showFullFieldSet = !isCuratedGateway || showAllFields

    const vendorOptions = useMemo(() => vendors.map((v: any) => ({ id: v.id, label: v.vendor_name })), [vendors])
    const projectOptions = useMemo(() => projects.map((p: any) => ({ id: p.id, label: p.project_name })), [projects])
    const categoryOptions = useMemo(() => categories.map((c: any) => ({ id: c.id, label: c.category_name })), [categories])
    const subCategoryOptions = useMemo(() => subCategories.map((s: any) => ({ id: s.id, label: s.item_name })), [subCategories])
    const accountOptions = useMemo(() => accounts.map((a: any) => ({ id: a.id, label: a.account_name })), [accounts])
    const vendorReceiptFacilitationOptions = useMemo(() => vendorReceiptFacilitations.map((v: any) => ({ id: v.id, label: v.record_name })), [vendorReceiptFacilitations])
    const transferOptions = useMemo(() => transfers.map((t: any) => ({ id: t.id, label: t.transfer_id_code })), [transfers])
    const taxSummaryOptions = useMemo(() => taxSummaries.map((t: any) => ({ id: t.id, label: t.month })), [taxSummaries])
    const locationOptions = useMemo(() => locations.map((l: any) => ({ id: l.id, label: l.location_name })), [locations])

    function profileName(userId: string | null) {
      if (!userId) return null
      return (userProfiles as any[]).find(p => p.id === userId)?.full_name ?? 'Unknown user'
    }

  const [form, setForm] = useState<Partial<ExpenseInsert>>(
    record
      ? {
        item_service_description: record.item_service_description,
        amount_etb: record.amount_etb ?? undefined,
        date: record.date,
        expense_type: record.expense_type,
        purchase_type: record.purchase_type,
        quantity: record.quantity ?? undefined,
        uom: record.uom,
        receipt_available: record.receipt_available,
        bank_ref: record.bank_ref,
        vendors_name: record.vendors_name,
        vendors_bank_account: record.vendors_bank_account,
        vendors_location: record.vendors_location,
        delivery_status: record.delivery_status,
        delivery_notes: record.delivery_notes,
        notes: record.notes,
        proposed_item_name: record.proposed_item_name,
        contacted: record.contacted,
        verify_wht: record.verify_wht,
        wht_handling_method: record.wht_handling_method,
        wht_fund: record.wht_fund,
        is_new_item: record.is_new_item,
        description_of_item: record.description_of_item,
        is_allocated: record.is_allocated,
        receipt_delivered: record.receipt_delivered,
        receipt_url: record.receipt_url,
        receipt_name: record.receipt_name,
        requested: record.requested,
        payment_status: record.payment_status,
        partially_paid: record.partially_paid,
        partial_paid_amount: record.partial_paid_amount ?? undefined,
        partial_payment_notes: record.partial_payment_notes,
        total_payment_date: record.total_payment_date,
        partial_payment_date: record.partial_payment_date,
        completion_percentage: record.completion_percentage ?? undefined,
        paid_date: record.paid_date,
        vendor_id: record.vendor_id,
        category_id: record.category_id,
        project_id: record.project_id,
        staff_id: record.staff_id,
        sub_category_id: record.sub_category_id,
        account_id: record.account_id,
        vendor_receipt_facilitation_id: record.vendor_receipt_facilitation_id,
        transfer_id: record.transfer_id,
        tax_summary_id: record.tax_summary_id,
        location_id: record.location_id,
        vehicle_id: record.vehicle_id,
        fuel_liters: record.fuel_liters ?? undefined,
      }
      : {
    payment_status: false,
    requested: false,
    partially_paid: false,
    contacted: false,
    verify_wht: false,
    is_new_item: linkedLineItem?.needs_market_check ? false : false,
    is_allocated: false,
    receipt_delivered: false,
    delivery_status: [],
    purchaser_user_id: user?.id,
    approval_status: 'pending',
    // pre-fill from linked PR line item
    ...(linkedLineItem ? {
      item_service_description: linkedLineItem.item_name,
      quantity: linkedLineItem.quantity ?? undefined,
      uom: linkedLineItem.unit ?? undefined,
      amount_etb: linkedLineItem.unit_price_est != null && linkedLineItem.quantity != null
        ? linkedLineItem.unit_price_est * linkedLineItem.quantity
        : undefined,
      sub_category_id: linkedLineItem.sub_category_id ?? undefined,
      proposed_item_name: linkedLineItem.item_name,
      description_of_item: linkedLineItem.specifications ?? undefined,
    } : {}),
    ...(linkedPr ? {
      project_id: linkedPr.project_id ?? undefined,
    } : {}),
    ...(linkedVrf ? {
      vendor_receipt_facilitation_id: linkedVrf.id,
      account_id: linkedVrf.initial_account_id ?? undefined,
      expense_type: 'vrf' as const,
    } : {}),
  }
  )
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const [rejecting, setRejecting] = useState(false)
    const [rejectionReason, setRejectionReason] = useState('')

    function set(key: keyof ExpenseInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  function handleVendorChange(id: string | null) {
    set('vendor_id', id)
    if (id) {
      const v = vendors.find((x: any) => x.id === id) as any
      if (v) {
        set('vendors_name', v.vendor_name)
        set('vendors_bank_account', v.bank_account ?? '')
      }
    }
  }

  function toggleDeliveryStatus(status: string) {
    const current = (form.delivery_status as string[]) ?? []
    const updated = current.includes(status) ? current.filter(s => s !== status) : [...current, status]
    set('delivery_status', updated)
  }

  async function handleSave() {
    setError(''); setSaving(true)
    let expenseId = id
    if (isEdit) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: err } = await supabase.from('expenses').update(form as any).eq('id', id!)
      if (err) { setSaving(false); setError(err.message); toast(err.message, 'error'); return }
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error: err } = await supabase.from('expenses').insert([form as any]).select('id').single()
      if (err) { setSaving(false); setError(err.message); toast(err.message, 'error'); return }
      expenseId = (data as any).id
      // Link to PR line item if this expense was created from a purchase request
      if (linkedLineItem && expenseId) {
        await supabase.from('expense_order_items').insert([{
          expense_id: expenseId,
          order_item_id: linkedLineItem.id,
          quantity_covered: linkedLineItem.quantity,
          notes: null,
        }])
      }
    }
    setSaving(false)
    qc.invalidateQueries({ queryKey: ['expenses'] })
    qc.invalidateQueries({ queryKey: ['expenses-lookup'] })
    toast(isEdit ? 'Expense updated' : 'Expense created', 'success')
    navigate(returnTo)
  }

  async function handleApprovalTransition(nextStatus: string, extra: Record<string, unknown> = {}) {
    if (!id) return
    const { error: err } = await supabase.from('expenses').update({ approval_status: nextStatus, ...extra }).eq('id', id)
    if (err) { toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['expense', id] })
    qc.invalidateQueries({ queryKey: ['expenses'] })
    toast('Approval status updated', 'success')
    setRejecting(false)
    setRejectionReason('')
  }

  const deliveryStatuses = (form.delivery_status as string[]) ?? []

  const approvalStatus = record?.approval_status ?? 'pending'
  const showManagerActions = isEdit && approvalStatus === 'pending' && canApproveAsManager(role)
  const showFinanceActions = isEdit && approvalStatus === 'manager_approved' && record?.requires_finance_approval && canApproveAsFinance(role)
  const canResubmit = isEdit && approvalStatus === 'rejected' && (role === 'admin' || role === 'manager' || record?.purchaser_user_id === user?.id)

  return (
    <FormPage title={isEdit ? 'Edit Expense' : 'New Expense'} backTo={returnTo} error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Save Expense'} onSave={handleSave}>

      {isEdit && (
        <div className="rounded-lg border bg-slate-50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Request ID</p>
              <p className="font-mono text-base font-bold text-slate-800">{record?.expense_code ?? '—'}</p>
            </div>
            <StatusBadge status={approvalStatus} />
          </div>
          {record?.requires_finance_approval && (
            <p className="text-xs text-amber-600">Amount exceeds 50,000 ETB — requires Finance's final approval before payment.</p>
          )}
          {record?.manager_approved_by && (
            <p className="text-xs text-slate-500">Approved by manager: {profileName(record.manager_approved_by)} on {formatDate(record.manager_approved_at)}</p>
          )}
          {record?.finance_approved_by && (
            <p className="text-xs text-slate-500">Approved by finance: {profileName(record.finance_approved_by)} on {formatDate(record.finance_approved_at)}</p>
          )}
          {approvalStatus === 'rejected' && record?.rejection_reason && (
            <p className="text-xs text-red-600">Rejection reason: {record.rejection_reason}</p>
          )}

          {(showManagerActions || showFinanceActions) && !rejecting && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleApprovalTransition(showFinanceActions ? 'finance_approved' : 'manager_approved')}
                className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
              >
                {showFinanceActions ? 'Give Final Approval' : 'Approve'}
              </button>
              <button type="button" onClick={() => setRejecting(true)} className="rounded-md bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100">
                Reject
              </button>
            </div>
          )}
          {(showManagerActions || showFinanceActions) && rejecting && (
            <div className="space-y-2">
              <textarea rows={2} className={inputCls} placeholder="Reason for rejection…" value={rejectionReason} onChange={e => setRejectionReason(e.target.value)} />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!rejectionReason.trim()}
                  onClick={() => handleApprovalTransition('rejected', { rejection_reason: rejectionReason.trim() })}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  Confirm Reject
                </button>
                <button type="button" onClick={() => { setRejecting(false); setRejectionReason('') }} className="rounded-md border px-3 py-1.5 text-xs hover:bg-slate-100">
                  Cancel
                </button>
              </div>
            </div>
          )}
          {canResubmit && (
            <button type="button" onClick={() => handleApprovalTransition('pending')} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90">
              Resubmit for Approval
            </button>
          )}
        </div>
      )}

      {/* Fuel vehicle banner (fuel expenses can only be created via the Fuel Request gateway, but still get edited/approved here) */}
      {isEdit && record?.expense_type === 'fuel' && (
        <div className="flex items-start gap-3 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40 px-4 py-3">
          <Fuel className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">Fuel Request</p>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
              {fuelVehicle ? <><span className="font-semibold">{fuelVehicle.name}</span>{fuelVehicle.plate_number ? ` · ${fuelVehicle.plate_number}` : ''}</> : 'Vehicle unavailable'}
              {record.fuel_liters != null && <span className="text-slate-400"> · {record.fuel_liters} L</span>}
            </p>
            {fuelVehicle && (
              <Link
                to={`/logistics/vehicles/${fuelVehicle.id}`}
                className="text-[11px] text-amber-700 dark:text-amber-400 hover:underline mt-0.5 inline-block">
                View vehicle →
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Transport payment banner — same curated-gateway logic as fuel above */}
      {isEdit && linkedTransportJob && (
        <div className="flex items-start gap-3 rounded-lg bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800/40 px-4 py-3">
          <Truck className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">Transport Payment</p>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">{linkedTransportJob.request_name ?? 'Untitled job'}</p>
            <Link
              to={`/transportation/${linkedTransportJob.id}/edit`}
              className="text-[11px] text-blue-700 dark:text-blue-400 hover:underline mt-0.5 inline-block">
              View job →
            </Link>
          </div>
        </div>
      )}

      {/* Curated gateways (Fuel/Transport) hide the fields that never apply to
          them; finance can still reach everything if a genuine edge case needs it */}
      {isCuratedGateway && (
        <button
          type="button"
          onClick={() => setShowAllFields(v => !v)}
          className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        >
          {showAllFields ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {showAllFields ? 'Hide fields not used by this request type' : 'Show all fields'}
        </button>
      )}

      {/* Linked VRF banner */}
      {!isEdit && linkedVrf && (
        <div className="flex items-start gap-3 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700/40 px-4 py-3">
          <Package className="h-4 w-4 text-indigo-500 flex-shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">Linked to VRF Record</p>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
              {linkedVrf.record_name && <span className="font-mono font-bold mr-2">{linkedVrf.record_name}</span>}
              {linkedVrf.facilitator_name && <span className="mr-2">· {linkedVrf.facilitator_name}</span>}
              {linkedVrf.initial?.account_name && (
                <span className="text-slate-400">Debited from: {linkedVrf.initial.account_name}</span>
              )}
            </p>
            <Link
              to={`/vendor-receipts/${linkedVrf.id}`}
              className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline mt-0.5 inline-block">
              View VRF record →
            </Link>
          </div>
        </div>
      )}

      {/* Linked PR banner */}
      {!isEdit && linkedPr && (
        <div className="flex items-start gap-3 rounded-lg bg-brand/5 border border-brand/20 px-4 py-3">
          <Package className="h-4 w-4 text-brand flex-shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-brand">Linked to Purchase Request</p>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 truncate">
              {linkedPr.request_code && <span className="font-mono font-bold mr-2">{linkedPr.request_code}</span>}
              {linkedPr.order_name ?? 'Untitled request'}
              {linkedLineItem && <span className="text-slate-400"> · Line item: {linkedLineItem.item_name}</span>}
            </p>
            <Link
              to={`/purchase-requests/${linkedPr.id}`}
              className="text-[11px] text-brand hover:underline mt-0.5 inline-block">
              View purchase request →
            </Link>
          </div>
        </div>
      )}

      <SectionHeader title="Basic Info" />
      <Field label="Description">
        <textarea rows={2} className={inputCls} value={form.item_service_description ?? ''} onChange={e => set('item_service_description', e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount (ETB)">
          <input type="number" step="0.01" className={inputCls} value={form.amount_etb ?? ''} onChange={e => set('amount_etb', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
        <Field label="Date">
          <input type="date" className={inputCls} value={form.date ?? ''} onChange={e => set('date', e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Expense Type">
          <select className={inputCls} value={form.expense_type ?? 'general'} onChange={e => set('expense_type', e.target.value)}>
            <option value="general">General</option>
            <option value="purchase_order">Purchase Order</option>
            <option value="vrf">VRF (Vendor Receipt Facilitation)</option>
            <option value="cpo_bond">CPO Bond</option>
            <option value="fuel">Fuel</option>
          </select>
        </Field>
        {showFullFieldSet && (
          <Field label="Purchase Type">
            <select className={inputCls} value={form.purchase_type ?? ''} onChange={e => set('purchase_type', e.target.value)}>
              <option value="">— Select —</option>
              <option>Goods</option><option>Services</option><option>Labor</option>
            </select>
          </Field>
        )}
      </div>
      <div className={showFullFieldSet ? 'grid grid-cols-3 gap-3' : ''}>
        {showFullFieldSet && (
          <>
            <Field label="Quantity">
              <input type="number" step="0.01" className={inputCls} value={form.quantity ?? ''} onChange={e => set('quantity', e.target.value ? parseFloat(e.target.value) : null)} />
            </Field>
            <Field label="UOM">
              <select className={inputCls} value={form.uom ?? ''} onChange={e => set('uom', e.target.value)}>
                <option value="">— Select —</option>
                {UOM_OPTIONS.map(u => <option key={u}>{u}</option>)}
              </select>
            </Field>
          </>
        )}
        <Field label="Receipt Available">
          <select className={inputCls} value={form.receipt_available ?? ''} onChange={e => set('receipt_available', e.target.value)}>
            <option value="">— Select —</option>
            <option>Yes</option><option>No</option><option>Pending</option>
          </select>
        </Field>
      </div>
      {showFullFieldSet && (
        <Field label="Proposed Item Name">
          <input type="text" className={inputCls} value={form.proposed_item_name ?? ''} onChange={e => set('proposed_item_name', e.target.value)} />
        </Field>
      )}
      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>

      {showFullFieldSet && (
        <>
          <SectionHeader title="Vendor" subtitle={isCuratedGateway ? 'Already captured by the request gateway — shown because "Show all fields" is on' : undefined} />
          <Field label="Vendor">
            <SearchableSelect value={form.vendor_id ?? null} onChange={handleVendorChange} options={vendorOptions} placeholder="Select vendor…" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Vendor Name (override)">
              <input type="text" className={inputCls} value={form.vendors_name ?? ''} onChange={e => set('vendors_name', e.target.value)} />
            </Field>
            <Field label="Vendor Bank Account">
              <input type="text" className={inputCls} value={form.vendors_bank_account ?? ''} onChange={e => set('vendors_bank_account', e.target.value)} />
            </Field>
          </div>
          <Field label="Vendor Location">
            <input type="text" className={inputCls} value={form.vendors_location ?? ''} onChange={e => set('vendors_location', e.target.value)} />
          </Field>
        </>
      )}

      <SectionHeader title="Classification" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="General Ledger">
          <SearchableSelect value={form.category_id ?? null} onChange={id => set('category_id', id)} options={categoryOptions} placeholder="Select general ledger…" />
        </Field>
        <Field label="Project">
          <SearchableSelect value={form.project_id ?? null} onChange={id => set('project_id', id)} options={projectOptions} placeholder="Select project…" />
        </Field>
      </div>
      {showFullFieldSet && (
        <>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!form.is_new_item} onChange={e => set('is_new_item', e.target.checked)} />
              New Item
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!form.is_allocated} onChange={e => set('is_allocated', e.target.checked)} />
              Allocated
            </label>
          </div>
          <Field label="Description of Item">
            <textarea rows={2} className={inputCls} value={form.description_of_item ?? ''} onChange={e => set('description_of_item', e.target.value)} />
          </Field>
        </>
      )}

      <SectionHeader title="Payment & Status" />
      <Field label="Bank Reference" locked={financeLocked}>
        <input disabled={financeLocked} type="text" className={inputCls} value={form.bank_ref ?? ''} onChange={e => set('bank_ref', e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Paid Date" locked={financeLocked}>
          <input disabled={financeLocked} type="date" className={inputCls} value={form.paid_date ?? ''} onChange={e => set('paid_date', e.target.value)} />
        </Field>
        <Field label="Total Payment Date" locked={financeLocked}>
          <input disabled={financeLocked} type="date" className={inputCls} value={form.total_payment_date ?? ''} onChange={e => set('total_payment_date', e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Partial Paid Amount" locked={financeLocked}>
          <input disabled={financeLocked} type="number" step="0.01" className={inputCls} value={form.partial_paid_amount ?? ''} onChange={e => set('partial_paid_amount', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
        <Field label="Partial Payment Date" locked={financeLocked}>
          <input disabled={financeLocked} type="date" className={inputCls} value={form.partial_payment_date ?? ''} onChange={e => set('partial_payment_date', e.target.value)} />
        </Field>
      </div>
      <Field label="Partial Payment Notes" locked={financeLocked}>
        <input disabled={financeLocked} type="text" className={inputCls} value={form.partial_payment_notes ?? ''} onChange={e => set('partial_payment_notes', e.target.value)} />
      </Field>
      {showFullFieldSet && (
        <Field label="Completion %">
          <input type="number" step="1" min="0" max="100" className={inputCls} value={form.completion_percentage ?? ''} onChange={e => set('completion_percentage', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
      )}
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={!!form.requested} onChange={e => set('requested', e.target.checked)} />
          Requested
        </label>
        <label className={`flex items-center gap-2 ${financeLocked ? 'opacity-50' : 'cursor-pointer'}`}>
          <input disabled={financeLocked} type="checkbox" checked={!!form.payment_status} onChange={e => set('payment_status', e.target.checked)} />
          Paid {financeLocked && <Lock className="h-3 w-3 text-slate-400" />}
        </label>
        <label className={`flex items-center gap-2 ${financeLocked ? 'opacity-50' : 'cursor-pointer'}`}>
          <input disabled={financeLocked} type="checkbox" checked={!!form.partially_paid} onChange={e => set('partially_paid', e.target.checked)} />
          Partially Paid {financeLocked && <Lock className="h-3 w-3 text-slate-400" />}
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={!!form.receipt_delivered} onChange={e => set('receipt_delivered', e.target.checked)} />
          Receipt Delivered
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={!!form.contacted} onChange={e => set('contacted', e.target.checked)} />
          Contacted
        </label>
      </div>

      <SectionHeader title="Receipt Attachment" />
      <FileUpload
        bucket="documents"
        folder="expense-receipts"
        fileUrl={form.receipt_url ?? null}
        fileName={form.receipt_name ?? null}
        onUpload={(url, name) => { set('receipt_url', url); set('receipt_name', name) }}
        onClear={() => { set('receipt_url', null); set('receipt_name', null) }}
        accept="image/*,application/pdf"
        label="Upload Receipt"
      />

      {showFullFieldSet && (
        <>
          <SectionHeader title="Delivery" subtitle={isCuratedGateway ? 'Doesn\'t apply here, shown because "Show all fields" is on' : undefined} />
          <Field label="Delivery Status">
            <div className="flex flex-wrap gap-3 text-sm">
              {DELIVERY_STATUS_OPTIONS.map(s => (
                <label key={s} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={deliveryStatuses.includes(s)} onChange={() => toggleDeliveryStatus(s)} />
                  {s}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Delivery Notes">
            <textarea rows={2} className={inputCls} value={form.delivery_notes ?? ''} onChange={e => set('delivery_notes', e.target.value)} />
          </Field>
        </>
      )}

      <SectionHeader title="WHT" />
      <div className="flex items-center gap-4 text-sm">
        <label className={`flex items-center gap-2 ${financeLocked ? 'opacity-50' : 'cursor-pointer'}`}>
          <input disabled={financeLocked} type="checkbox" checked={!!form.verify_wht} onChange={e => set('verify_wht', e.target.checked)} />
          Verify WHT {financeLocked && <Lock className="h-3 w-3 text-slate-400" />}
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="WHT Handling Method" locked={financeLocked}>
          <input disabled={financeLocked} type="text" className={inputCls} value={form.wht_handling_method ?? ''} onChange={e => set('wht_handling_method', e.target.value)} />
        </Field>
        <Field label="WHT Fund" locked={financeLocked}>
          <input disabled={financeLocked} type="text" className={inputCls} value={form.wht_fund ?? ''} onChange={e => set('wht_fund', e.target.value)} />
        </Field>
      </div>

      <SectionHeader title="Linked Records" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Sub Ledger">
          <SearchableSelect value={form.sub_category_id ?? null} onChange={id => set('sub_category_id', id)} options={subCategoryOptions} placeholder="Select sub ledger…" />
        </Field>
        <Field label="Account" locked={financeLocked}>
          <SearchableSelect disabled={financeLocked} value={form.account_id ?? null} onChange={id => set('account_id', id)} options={accountOptions} placeholder="Select account…" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {showFullFieldSet && (
          <Field label="Vendor Receipt Facilitation">
            <SearchableSelect value={form.vendor_receipt_facilitation_id ?? null} onChange={id => set('vendor_receipt_facilitation_id', id)} options={vendorReceiptFacilitationOptions} placeholder="Select record…" />
          </Field>
        )}
        <Field label="Transfer" locked={financeLocked}>
          <SearchableSelect disabled={financeLocked} value={form.transfer_id ?? null} onChange={id => set('transfer_id', id)} options={transferOptions} placeholder="Select transfer…" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tax Month" locked={financeLocked}>
          <SearchableSelect disabled={financeLocked} value={form.tax_summary_id ?? null} onChange={id => set('tax_summary_id', id)} options={taxSummaryOptions} placeholder="Select tax month…" />
        </Field>
        <Field label="Location">
          <SearchableSelect value={form.location_id ?? null} onChange={id => set('location_id', id)} options={locationOptions} placeholder="Select location…" />
        </Field>
      </div>

      {isEdit && (linkedOrders.length > 0 || linkedBatchPayments.length > 0 || linkedCashAdvances.length > 0) && (
        <>
          <SectionHeader title="Referenced By" />
          <div className="space-y-2 text-sm">
            {linkedOrders.map((o: any) => (
              <Link key={o.id} to={`/orders/${o.id}/edit`} className="block rounded-md border px-3 py-2 hover:bg-slate-50">
                <span className="text-slate-400">Order · </span>{o.item_service_description ?? o.id} {o.order_date && <span className="text-slate-400">({formatDate(o.order_date)})</span>}
              </Link>
            ))}
            {linkedBatchPayments.map((b: any) => (
              <Link key={b.id} to={`/batch-payments/${b.id}/edit`} className="block rounded-md border px-3 py-2 hover:bg-slate-50">
                <span className="text-slate-400">Batch Payment · </span>{b.payment_code ?? b.id}
              </Link>
            ))}
            {linkedCashAdvances.map((c: any) => (
              <Link key={c.id} to={`/cash-advances/${c.id}/edit`} className="block rounded-md border px-3 py-2 hover:bg-slate-50">
                <span className="text-slate-400">Cash Advance · </span>{c.advance_id_code ?? c.id} {c.amount_advanced != null && <span className="text-slate-400">({formatCurrency(c.amount_advanced)})</span>}
              </Link>
            ))}
          </div>
        </>
      )}
    </FormPage>
  )
}
