import { useQuery, useQueryClient } from '@tanstack/react-query'
import { dropRecordCache } from '@/lib/queryCache'
import { useTaxPeriodLabel } from '@/hooks/useTaxPeriod'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { FormattedNumberInput } from '@/components/shared/FormattedNumberInput'
import type { Expense, ExpenseInsert, Order, OrderItem, VendorReceiptFacilitation, Property, CpoBond, SubcontractorEngagement, SourcingBundleDiscountKind } from '@/types/database'
import { useVendors, useCategories, useStaffDirectory, useSubCategories, useAccounts, useVendorReceiptFacilitations, useTransfers, useLocations, useUserProfiles, useSubcontractorEngagements, useProperties, locationPickerOptions } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { submitted } from '@/lib/celebrate'
import { useAuth } from '@/contexts/AuthContext'
import { canEditFinanceFields, canApproveAsFinance } from '@/lib/expenseAccess'
import { formatCurrency, formatDate } from '@/lib/utils'
import { poTax } from '@/lib/poTax'
import { Lock, Package, Fuel, Truck, EyeOff, Eye, ShoppingCart } from 'lucide-react'
import { ProjectOrOverheadSelect, ReceiptFields } from '@/components/expenses/ExpenseFields'
import { expenseFormProblems, findPossibleDuplicates, fromProjectChoice, projectChoice } from '@/lib/expenseQuality'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed'
function Field({ label, locked, error, children }: { label: string; locked?: boolean; error?: string; children: React.ReactNode }) {
  const required = label.endsWith('*')
  return (
    <div className={error ? '[&_input]:border-red-400 [&_textarea]:border-red-400' : undefined}>
      <label className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">
        {required ? label.slice(0, -1).trim() : label}
        {required && <span className="text-brand"> *</span>}
        {locked && <span title="Finance only" className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-normal text-slate-400"><Lock className="h-2.5 w-2.5" /> Finance only</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-[11px] font-medium text-red-600">{error}</p>}
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

const EXPENSE_TYPE_LABEL: Record<string, string> = {
  general: 'expense',
  purchase_order: 'purchase order',
  vrf: 'VRF settlement',
  cpo_bond: 'CPO bond',
  fuel: 'fuel request',
  subcontract: 'subcontract certificate',
  maintenance: 'fleet record',
  property_rent: 'rent payment',
}

const UOM_OPTIONS = ['Pcs', 'Kg', 'L', 'm', 'm²', 'm³', 'Hr', 'Day', 'Month', 'Set', 'Other']
const DELIVERY_STATUS_OPTIONS = ['Ordered', 'In Transit', 'Delivered', 'Returned']
const WHT_HANDLING_OPTIONS = ['Withheld & Remitted', 'Vendor Exempt', 'Company Absorbs', 'Not Applicable']

export default function ExpenseFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const returnTo: string = (location.state as { returnTo?: string })?.returnTo ?? '/expenses'
  const prId   = searchParams.get('pr_id')
  const lineId = searchParams.get('line_id')
  const vrfId  = searchParams.get('vrf_id')
  const bundleId = searchParams.get('bundle_id')
  const propertyId = searchParams.get('property_id')
  const cpoBondId = searchParams.get('cpo_bond_id')
  const engagementId = searchParams.get('engagement_id')

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

  const { data: linkedBundle } = useQuery({
    queryKey: ['bundle-for-expense', bundleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sourcing_bundles')
        .select(`
          id, bundle_code, vendor_id, vendor_name, vendors(wth_eligible),
          total_value, items_subtotal_etb, discount_etb, discount_kind, discount_value, discount_reason,
          sourcing_bundle_items(
            quantity_actual, unit_price_actual,
            order_items(item_name, orders(project_id))
          )
        `)
        .eq('id', bundleId!)
        .single()
      if (error) throw error
      return data as unknown as LinkedBundle
    },
    enabled: !isEdit && !!bundleId,
  })

  const { data: linkedProperty } = useQuery({
    queryKey: ['property-for-expense', propertyId],
    queryFn: async () => {
      const { data, error } = await supabase.from('properties').select('*').eq('id', propertyId!).single()
      if (error) throw error
      return data as Property
    },
    enabled: !isEdit && !!propertyId,
  })

  const { data: linkedCpoBond } = useQuery({
    queryKey: ['cpo-bond-for-expense', cpoBondId],
    queryFn: async () => {
      const { data, error } = await supabase.from('cpo_bonds').select('*').eq('id', cpoBondId!).single()
      if (error) throw error
      return data as CpoBond
    },
    enabled: !isEdit && !!cpoBondId,
  })

  const { data: linkedEngagement } = useQuery({
    queryKey: ['engagement-for-expense', engagementId],
    queryFn: async () => {
      const { data, error } = await supabase.from('subcontractor_engagements').select('*').eq('id', engagementId!).single()
      if (error) throw error
      return data as SubcontractorEngagement
    },
    enabled: !isEdit && !!engagementId,
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
      linkedBundle={linkedBundle}
      linkedProperty={linkedProperty}
      linkedCpoBond={linkedCpoBond}
      linkedEngagement={linkedEngagement}
    />
  )
}

type LinkedBundle = {
  id: string; bundle_code: string; vendor_id: string | null; vendor_name: string | null
  vendors: { wth_eligible: boolean | null } | null
  total_value: number | null; items_subtotal_etb: number | null; discount_etb: number | null
  discount_kind: SourcingBundleDiscountKind | null; discount_value: number | null; discount_reason: string | null
  sourcing_bundle_items: {
    quantity_actual: number | null; unit_price_actual: number | null
    order_items: { item_name: string; orders: { project_id: string | null } | null } | null
  }[]
}

function ExpenseFormPageBody({ id, record, returnTo = '/expenses', linkedPr, linkedLineItem, linkedVrf, linkedBundle, linkedProperty, linkedCpoBond, linkedEngagement }: {
  id?: string; record?: Expense; returnTo?: string
  linkedPr?: Order; linkedLineItem?: OrderItem
  linkedVrf?: (VendorReceiptFacilitation & { initial: { account_name: string } | null })
  linkedBundle?: LinkedBundle
  linkedProperty?: Property
  linkedCpoBond?: CpoBond
  linkedEngagement?: SubcontractorEngagement
}) {
  const isEdit = !!id
    const navigate = useNavigate()
    const { user, role } = useAuth()
    const taxPeriodOf = useTaxPeriodLabel()
    const { toast } = useToast()
    const qc = useQueryClient()
    const { data: vendors = [] } = useVendors()
    const { data: staffDirectory = [] } = useStaffDirectory()
    const { data: categories = [] } = useCategories()
    const { data: subCategories = [] } = useSubCategories()
    const { data: accounts = [] } = useAccounts()
    const { data: vendorReceiptFacilitations = [] } = useVendorReceiptFacilitations()
    const { data: transfers = [] } = useTransfers()
    const { data: locations = [] } = useLocations()
    const { data: userProfiles = [] } = useUserProfiles()
    const { data: subcontractorEngagements = [] } = useSubcontractorEngagements()
    const { data: properties = [] } = useProperties()

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
    // One combined lookup covering every other auto-created expense_type's
    // reference record — same "curated gateway" banner idea as fuel/transport
    // above, generalized instead of one query+banner pair per type.
    const { data: linkedSource } = useQuery({
      queryKey: ['expense-linked-source', record?.id, record?.expense_type],
      queryFn: async () => {
        if (!record) return null
        switch (record.expense_type) {
          case 'maintenance': {
            if (!record.vehicle_id) return null
            const { data } = await supabase.from('vehicles').select('id, name, plate_number').eq('id', record.vehicle_id).single()
            return data ? { label: 'Vehicle', name: data.name, sub: data.plate_number ?? undefined, to: `/logistics/vehicles/${data.id}` } : null
          }
          case 'subcontract': {
            if (!record.subcontractor_engagement_id) return null
            const { data } = await supabase.from('subcontractor_engagements').select('id, scope_of_work, vendors(vendor_name)').eq('id', record.subcontractor_engagement_id).single()
            return data ? { label: 'Subcontract Engagement', name: data.scope_of_work ?? 'Engagement', sub: (data as any).vendors?.vendor_name, to: `/subcontracts/${data.id}` } : null
          }
          case 'cpo_bond': {
            if (!record.cpo_bond_id) return null
            const { data } = await supabase.from('cpo_bonds').select('id, bond_id_ref, project').eq('id', record.cpo_bond_id).single()
            return data ? { label: 'CPO Bond', name: data.bond_id_ref ?? 'Bond', sub: data.project ?? undefined, to: `/cpo-bonds/${data.id}/edit` } : null
          }
          case 'vrf': {
            if (!record.vendor_receipt_facilitation_id) return null
            const { data } = await supabase.from('vendor_receipt_facilitation').select('id, record_name').eq('id', record.vendor_receipt_facilitation_id).single()
            return data ? { label: 'Vendor Receipt Facilitation', name: data.record_name ?? 'VRF record', to: `/vendor-receipts/${data.id}` } : null
          }
          case 'property_rent': {
            if (!record.property_id) return null
            const { data } = await supabase.from('properties').select('id, property_name, lease_end_date').eq('id', record.property_id).single()
            return data ? { label: 'Property', name: data.property_name, sub: data.lease_end_date ? `Lease ends ${formatDate(data.lease_end_date)}` : undefined, to: '/rent' } : null
          }
          case 'purchase_order': {
            if (!record.sourcing_bundle_id) return null
            const { data } = await supabase.from('sourcing_bundles').select('id, bundle_code').eq('id', record.sourcing_bundle_id).single()
            return data ? { label: 'Purchase Order', name: data.bundle_code ?? 'PO', to: `/sourcing/${data.id}` } : null
          }
          default:
            return null
        }
      },
      enabled: isEdit && !!record && record.expense_type !== 'general',
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

    const vendorOptions = useMemo(() => vendors.map((v: any) => ({ id: v.id, label: v.vendor_name })), [vendors])
    const staffOptions = useMemo(() => (staffDirectory as { id: string; employee_name: string; role: string | null }[]).map(s => ({ id: s.id, label: s.employee_name, sub: s.role ?? undefined })), [staffDirectory])
    const categoryOptions = useMemo(() => categories.map((c: any) => ({ id: c.id, label: c.category_name })), [categories])
    const engagementOptions = useMemo(() => subcontractorEngagements.map((e: any) => ({
      id: e.id,
      label: `${e.vendors?.vendor_name ?? 'Vendor'} — ${e.projects?.project_name ?? 'Project'}`,
      sub: e.scope_of_work ?? undefined,
    })), [subcontractorEngagements])
    const subCategoryOptions = useMemo(() => subCategories.map((s: any) => ({ id: s.id, label: s.item_name })), [subCategories])
    const accountOptions = useMemo(() => accounts.map((a: any) => ({ id: a.id, label: a.account_name })), [accounts])
    const vendorReceiptFacilitationOptions = useMemo(() => vendorReceiptFacilitations.map((v: any) => ({ id: v.id, label: v.record_name })), [vendorReceiptFacilitations])
    const transferOptions = useMemo(() => transfers.map((t: any) => ({ id: t.id, label: t.transfer_id_code })), [transfers])
    const locationOptions = useMemo(() => locationPickerOptions(locations), [locations])
    const propertyOptions = useMemo(() => properties.filter((p: any) => p.status === 'active').map((p: any) => ({ id: p.id, label: p.property_name })), [properties])

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
        verify_wht: record.verify_wht,
        wht_handling_method: record.wht_handling_method,
        description_of_item: record.description_of_item,
        receipt_url: record.receipt_url,
        receipt_name: record.receipt_name,
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
        vrf_id: record.vrf_id,
        transfer_id: record.transfer_id,
        tax_summary_id: record.tax_summary_id,
        location_id: record.location_id,
        vehicle_id: record.vehicle_id,
        fuel_liters: record.fuel_liters ?? undefined,
        subcontractor_engagement_id: record.subcontractor_engagement_id,
        property_id: record.property_id,
        paid_to_staff_id: record.paid_to_staff_id,
        wht_amount: record.wht_amount,
        is_overhead: record.is_overhead ?? false,
        receipt_is_vat: record.receipt_is_vat ?? null,
        receipt_no: record.receipt_no ?? null,
        receipt_vat_amount: record.receipt_vat_amount ?? null,
      }
      : {
    payment_status: false,
    partially_paid: false,
    verify_wht: false,
    delivery_status: [],
    purchaser_user_id: user?.id,
    approval_status: 'pending',
    date: new Date().toISOString().slice(0, 10),
    // pre-fill from linked PR line item (estimate only — no sourcing yet)
    ...(linkedLineItem ? {
      item_service_description: linkedLineItem.item_name,
      quantity: linkedLineItem.quantity ?? undefined,
      uom: linkedLineItem.unit ?? undefined,
      amount_etb: linkedLineItem.unit_price_est != null && linkedLineItem.quantity != null
        ? linkedLineItem.unit_price_est * linkedLineItem.quantity
        : undefined,
      sub_category_id: linkedLineItem.sub_category_id ?? undefined,
      description_of_item: linkedLineItem.specifications ?? undefined,
    } : {}),
    ...(linkedPr ? {
      project_id: linkedPr.project_id ?? undefined,
      vendor_id: linkedPr.recommended_vendor_id ?? undefined,
    } : {}),
    // pre-fill from a fulfilled Purchase Order (Sourcing Bundle) — the real
    // negotiated vendor and price, not the PR's original estimate
    ...(linkedBundle ? (() => {
      const items = linkedBundle.sourcing_bundle_items ?? []
      // total_value is the bundle's net commitment — the line items less any
      // vendor discount — maintained by the database (299). Re-summing the
      // lines here would bill the vendor the undiscounted figure, which is
      // not what the PO was approved at. The fallback only covers a bundle
      // row that somehow arrives without it.
      const total = Number(linkedBundle.total_value
        ?? items.reduce((sum, i) => sum + (i.quantity_actual ?? 0) * (i.unit_price_actual ?? 0), 0))
      const discount = Number(linkedBundle.discount_etb ?? 0)
      const projectIds = new Set(items.map(i => i.order_items?.orders?.project_id).filter(Boolean))
      const itemNames = items.map(i => i.order_items?.item_name).filter(Boolean).join(', ')
      // The expense is the PO's gross — subtotal + VAT, as the PO prints it
      // — with the WHT set to be withheld at payment, exactly as the GRN
      // trigger raises one (341). Billing the subtotal left the VAT unpaid.
      const tax = poTax(total, !!linkedBundle.vendors?.wth_eligible)
      return {
        expense_type: 'purchase_order' as const,
        item_service_description: `PO ${linkedBundle.bundle_code}${itemNames ? ` — ${itemNames}` : ''}`,
        amount_etb: total ? tax.gross : undefined,
        ...(tax.wht > 0 ? {
          wht_amount: tax.wht,
          verify_wht: true,
          wht_handling_method: 'Withheld & Remitted',
        } : {}),
        notes: [
          discount > 0
            ? `Vendor discount of ${formatCurrency(discount)} applied: `
              + `${formatCurrency(Number(linkedBundle.items_subtotal_etb ?? 0))} before discount, `
              + `${formatCurrency(total)} billed.`
              + (linkedBundle.discount_reason ? ` ${linkedBundle.discount_reason}` : '')
            : null,
          total
            ? `PO subtotal ${formatCurrency(total)} + VAT 15% ${formatCurrency(tax.vat)} = ${formatCurrency(tax.gross)}.`
              + (tax.wht > 0 ? ` WHT 3% ${formatCurrency(tax.wht)} withheld; ${formatCurrency(tax.gross - tax.wht)} to the vendor.` : '')
            : null,
        ].filter(Boolean).join('\n') || undefined,
        vendor_id: linkedBundle.vendor_id ?? undefined,
        vendors_name: linkedBundle.vendor_id ? undefined : (linkedBundle.vendor_name ?? undefined),
        project_id: projectIds.size === 1 ? [...projectIds][0] as string : undefined,
        // Migration 136 auto-creates this from the GRN trigger going
        // forward and sets this correctly there; this manual path only
        // still runs for pre-existing GRN'd-but-unbilled bundles, and
        // used to never set this at all — a real gap since 110's GRN-
        // gating/advance logic keys off it.
        sourcing_bundle_id: linkedBundle.id,
      }
    })() : {}),
    // A company payment made from a VRF's returned money (migration 322): it
    // draws on that VRF (vrf_id) and is paid from the holding account the
    // money came back to. vendor_receipt_facilitation_id is no longer set:
    // that link marked the VRF payment itself, which is not an expense.
    ...(linkedVrf ? {
      vrf_id: linkedVrf.id,
      account_id: linkedVrf.return_account_id ?? undefined,
    } : {}),
    // pre-fill from a linked property — used by the Rent page's "Record
    // Rent Payment" link, same ?xxx_id= gateway pattern as PO/VRF above
    ...(linkedProperty ? {
      property_id: linkedProperty.id,
      expense_type: 'property_rent' as const,
      item_service_description: `Rent — ${linkedProperty.property_name}`,
      amount_etb: linkedProperty.monthly_rent_amount ?? undefined,
      vendor_id: linkedProperty.landlord_vendor_id ?? undefined,
    } : {}),
    // pre-fill from a linked CPO bond — same ?xxx_id= gateway pattern as
    // PO/VRF/property above. cpo_bonds.project is free text, not a real
    // project_id FK, so it's left for the user to pick if relevant.
    ...(linkedCpoBond ? {
      cpo_bond_id: linkedCpoBond.id,
      expense_type: 'cpo_bond' as const,
      item_service_description: linkedCpoBond.bond_id_ref ? `CPO Bond ${linkedCpoBond.bond_id_ref}` : undefined,
      amount_etb: linkedCpoBond.total_bond_amount ?? undefined,
      vendor_id: linkedCpoBond.vendor_id ?? undefined,
    } : {}),
    // pre-fill from a linked subcontractor engagement — the manual
    // "Subcontractor Engagement" picker below already supports this
    // relationship; this just arrives with it pre-selected instead of
    // making the user search for the engagement by hand.
    ...(linkedEngagement ? {
      subcontractor_engagement_id: linkedEngagement.id,
      expense_type: 'subcontract' as const,
      vendor_id: linkedEngagement.vendor_id,
      project_id: linkedEngagement.project_id,
      amount_etb: linkedEngagement.agreed_amount ?? undefined,
    } : {}),
  }
  )
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const [rejecting, setRejecting] = useState(false)
    const [rejectionReason, setRejectionReason] = useState('')

    function set(key: keyof ExpenseInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

    // Checked on save; shown under the fields once a save was tried.
    const [showErrors, setShowErrors] = useState(false)
    const problems = expenseFormProblems(form, !isEdit)
    const [dupes, setDupes] = useState<Awaited<ReturnType<typeof findPossibleDuplicates>>>([])

    // Who is paid: a vendor, a staff member, or a typed name.
    type PayeeMode = 'vendor' | 'staff' | 'other'
    const [payeeMode, setPayeeMode] = useState<PayeeMode>(
      form.vendor_id ? 'vendor' : form.paid_to_staff_id ? 'staff' : form.vendors_name ? 'other' : 'vendor')
    function choosePayee(mode: PayeeMode, vendorId?: string) {
      setPayeeMode(mode)
      if (mode === 'vendor') {
        setForm(f => ({ ...f, paid_to_staff_id: null, vendors_name: f.vendor_id ? f.vendors_name : null }))
        if (vendorId) handleVendorChange(vendorId)
      } else if (mode === 'staff') {
        setForm(f => ({ ...f, vendor_id: null, vendors_name: null }))
      } else {
        setForm(f => ({ ...f, vendor_id: null, paid_to_staff_id: null }))
      }
    }
    // A typed name that is already a vendor: offer the vendor instead.
    const typedNameMatch = useMemo(() => {
      const n = (form.vendors_name ?? '').trim().toLowerCase()
      if (payeeMode !== 'other' || n.length < 3) return null
      return (vendors as { id: string; vendor_name: string }[]).find(v => v.vendor_name.toLowerCase() === n)
        ?? (vendors as { id: string; vendor_name: string }[]).find(v => v.vendor_name.toLowerCase().startsWith(n)) ?? null
    }, [form.vendors_name, payeeMode, vendors])

    // Rarely used fields fold away; open when one already holds a value.
    const [showMore, setShowMore] = useState(false)
    const moreOpen = showMore || !!(form.quantity || form.uom || form.purchase_type || form.description_of_item || form.sub_category_id
      || form.location_id || form.vendors_location || form.delivery_notes || (form.delivery_status as string[] | undefined)?.length || form.completion_percentage)

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

  // A vendor_id can arrive pre-filled from a gateway (PR recommendation,
  // sourced Purchase Order) without going through handleVendorChange, so
  // backfill the bank account once the vendor list is loaded — but only
  // fill it in, never overwrite a value the user already has.
  useEffect(() => {
    if (form.vendor_id && !form.vendors_bank_account && vendors.length > 0) {
      const v = vendors.find((x: any) => x.id === form.vendor_id) as any
      if (v?.bank_account) set('vendors_bank_account', v.bank_account)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.vendor_id, vendors])

  // The general ledger follows the nature of the engagement: a rent
  // payment belongs to Property Rent, a subcontract certificate to Sub
  // Contractors, a purchase order to whatever its line items were
  // classified as. Without it there's no expense-side account to debit
  // and the ledger silently refuses to post the payment (migration 105).
  //
  // Resolved by asking the database (migration 154's
  // resolve_expense_category) rather than keeping a second copy of the
  // mapping here — so what the form shows is exactly what the trigger
  // would store, and the two can't drift apart.
  const bundleForCategory = record?.sourcing_bundle_id ?? form.sourcing_bundle_id ?? null
  const { data: defaultCategoryId } = useQuery({
    queryKey: ['default-expense-category', form.expense_type, bundleForCategory],
    enabled: !!form.expense_type && form.expense_type !== 'general',
    staleTime: 300000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('resolve_expense_category', {
        p_expense_type: form.expense_type,
        p_sourcing_bundle_id: bundleForCategory,
      })
      if (error) throw error
      return (data as string | null) ?? null
    },
  })

  // Fill-only, the same rule the database trigger follows: a ledger
  // someone picked by hand stays picked, and re-saving can't revert it.
  // Derived rather than written into form state by an effect, so the
  // default can't be mistaken for an edit and there's no render cascade.
  const effectiveCategoryId = form.category_id ?? defaultCategoryId ?? null
  const categoryIsDefaulted = !form.category_id && !!defaultCategoryId

  async function handleSave(duplicateConfirmed = false) {
    setError('')
    const firstProblem = Object.values(problems)[0]
    if (firstProblem) { setShowErrors(true); setError(firstProblem); return }
    // Same payee, same amount, within 3 days: ask before recording it twice.
    if (!duplicateConfirmed && (!isEdit || form.amount_etb !== record?.amount_etb)) {
      const found = await findPossibleDuplicates({ ...form, id })
      if (found.length) { setDupes(found); return }
    }
    setDupes([])
    setSaving(true)
    let expenseId = id
    // Persist the ledger the form is actually showing. The database
    // trigger would fill the same value anyway (migration 154), but
    // saving it explicitly keeps what was on screen and what lands in
    // the row identical, rather than depending on the two agreeing.
    const payload = {
      ...form,
      category_id: effectiveCategoryId,
      // Only the chosen kind of payee is kept.
      ...(payeeMode === 'vendor' ? { paid_to_staff_id: null } : payeeMode === 'staff' ? { vendor_id: null, vendors_name: null } : { vendor_id: null, paid_to_staff_id: null }),
      receipt_available: form.receipt_url ? 'Yes' : form.receipt_available ?? null,
      receipt_is_vat: form.receipt_url ? form.receipt_is_vat ?? null : null,
    }
    if (isEdit) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: err } = await supabase.from('expenses').update(payload as any).eq('id', id!)
      if (err) { setSaving(false); setError(err.message); toast(err.message, 'error'); return }
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error: err } = await supabase.from('expenses').insert([payload as any]).select('id').single()
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
      // Link back to the Purchase Order this expense pays for, so its
      // "Reconciled Expense" reflects this automatically
      if (linkedBundle && expenseId) {
        const { error: linkErr } = await supabase.from('sourcing_bundles').update({ expense_id: expenseId }).eq('id', linkedBundle.id)
        if (linkErr) toast(`Expense saved but linking to the purchase order failed: ${linkErr.message}`, 'error')
      }
    }
    setSaving(false)
    dropRecordCache(qc, 'expense', 'pr-for-expense', 'pr-line-for-expense', 'vrf-for-expense', 'bundle-for-expense', 'property-for-expense', 'expense-linked-orders', 'expense-linked-batch-payments', 'expense-linked-cash-advances', 'expense-fuel-vehicle', 'expense-linked-source', 'expense-transport-job', 'default-expense-category')
    qc.invalidateQueries({ queryKey: ['expenses'] })
    qc.invalidateQueries({ queryKey: ['expenses-lookup'] })
    if (isEdit) toast('Expense updated', 'success')
    else submitted(toast, 'Expense submitted', 'Now waiting for approval. Track it under Approvals')
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
  // Single gate since migration 163: Finance approves straight from
  // pending, which releases the expense to payment. `manager_approved`
  // is accepted here only so rows stranded in that retired state by the
  // old first rung still have a way forward.
  const showFinanceActions = isEdit
    && (approvalStatus === 'pending' || approvalStatus === 'manager_approved')
    && canApproveAsFinance(role)
  const canResubmit = isEdit && approvalStatus === 'rejected' && (role === 'admin' || role === 'executive' || record?.purchaser_user_id === user?.id)

  return (
    <FormPage title={isEdit ? 'Edit Expense' : 'New Expense'} backTo={returnTo} error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Save Expense'} onSave={() => handleSave()}>

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
            <p className="text-xs text-amber-600">Amount exceeds 50,000 ETB.</p>
          )}
          {record?.manager_approved_by && (
            <p className="text-xs text-slate-500">Approved by manager: {profileName(record.manager_approved_by)} on {formatDate(record.manager_approved_at)} <span className="text-slate-400">(retired approval step)</span></p>
          )}
          {record?.finance_approved_by && (
            <p className="text-xs text-slate-500">Approved by finance: {profileName(record.finance_approved_by)} on {formatDate(record.finance_approved_at)}</p>
          )}
          {approvalStatus === 'rejected' && record?.rejection_reason && (
            <p className="text-xs text-red-600">Rejection reason: {record.rejection_reason}</p>
          )}

          {showFinanceActions && !rejecting && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleApprovalTransition('finance_approved')}
                className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
              >
                Approve for Payment
              </button>
              <button type="button" onClick={() => setRejecting(true)} className="rounded-md bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100">
                Reject
              </button>
            </div>
          )}
          {showFinanceActions && rejecting && (
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

      {/* Linked source banner — one per remaining auto-created expense_type
          (purchase_order/subcontract/cpo_bond/maintenance/vrf/property_rent),
          same idea as the Fuel/Transport banners above, generalized */}
      {isEdit && linkedSource && (
        <div className="flex items-start gap-3 rounded-lg bg-slate-50 dark:bg-slate-700/30 border border-slate-200 dark:border-slate-600 px-4 py-3">
          <ShoppingCart className="h-4 w-4 text-slate-500 dark:text-slate-400 flex-shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">{linkedSource.label}</p>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
              {linkedSource.name}{linkedSource.sub ? ` · ${linkedSource.sub}` : ''}
            </p>
            <Link to={linkedSource.to} className="text-[11px] text-slate-500 dark:text-slate-400 hover:underline mt-0.5 inline-block">
              View →
            </Link>
          </div>
        </div>
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

      {/* Linked Purchase Order (Sourcing Bundle) banner */}
      {!isEdit && linkedBundle && (
        <div className="flex items-start gap-3 rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700/40 px-4 py-3">
          <ShoppingCart className="h-4 w-4 text-purple-600 dark:text-purple-400 flex-shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-purple-700 dark:text-purple-300">Linked to Purchase Order</p>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
              <span className="font-mono font-bold mr-2">{linkedBundle.bundle_code}</span>
              {linkedBundle.vendor_name && <span>{linkedBundle.vendor_name}</span>}
            </p>
            <Link
              to={`/sourcing/${linkedBundle.id}`}
              className="text-[11px] text-purple-700 dark:text-purple-300 hover:underline mt-0.5 inline-block">
              View purchase order →
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

      <SectionHeader title="What and how much" />
      <Field label="What was it for? *" error={showErrors ? problems.description : undefined}>
        <textarea rows={2} className={inputCls} value={form.item_service_description ?? ''} onChange={e => set('item_service_description', e.target.value)} placeholder="e.g. 20 bags of cement for the Bole site" />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Total paid (ETB, VAT included) *" error={showErrors ? problems.amount : undefined}>
          <FormattedNumberInput className={inputCls} value={form.amount_etb ?? null} onChange={n => set('amount_etb', n ?? null)} />
        </Field>
        <Field label="Date *" error={showErrors ? problems.date : undefined}>
          <input type="date" className={inputCls} value={form.date ?? ''} onChange={e => set('date', e.target.value)} />
        </Field>
      </div>
      {canEditFinanceFields(role) ? (
        <Field label="Expense Type">
          <select className={inputCls} value={form.expense_type ?? 'general'} onChange={e => set('expense_type', e.target.value)}>
            <option value="general">General</option>
            <option value="purchase_order">Purchase Order</option>
            <option value="vrf">VRF (Vendor Receipt Facilitation)</option>
            <option value="cpo_bond">CPO Bond</option>
            <option value="fuel">Fuel</option>
            <option value="subcontract">Subcontract</option>
            <option value="maintenance">Vehicle Maintenance / Penalty</option>
            <option value="property_rent">Property Rent</option>
            <option value="labor_payment">Labour payment</option>
            <option value="transportation">Transportation</option>
          </select>
        </Field>
      ) : form.expense_type && form.expense_type !== 'general' && (
        <p className="text-xs text-slate-500">Type: {EXPENSE_TYPE_LABEL[form.expense_type] ?? form.expense_type}</p>
      )}

      <SectionHeader title="Who is paid" />
      <div className="flex flex-wrap gap-2">
        {([['vendor', 'A vendor'], ['staff', 'A staff member'], ['other', 'Someone else']] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => choosePayee(k)}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium ${payeeMode === k ? 'border-brand bg-brand/10 text-brand' : 'text-slate-600 dark:text-slate-300 dark:border-slate-600'}`}>
            {label}
          </button>
        ))}
      </div>
      {payeeMode === 'vendor' && (
        <Field label="Vendor *" error={showErrors ? problems.payee : undefined}>
          <SearchableSelect value={form.vendor_id ?? null} onChange={handleVendorChange} options={vendorOptions} placeholder="Search vendors…" />
          <p className="mt-1 text-[11px] text-slate-400">Not in the list? Procurement adds vendors under Supply Chain → Vendors; meanwhile use "Someone else".</p>
        </Field>
      )}
      {payeeMode === 'staff' && (
        <Field label="Staff member *" error={showErrors ? problems.payee : undefined}>
          <SearchableSelect value={form.paid_to_staff_id ?? null} onChange={id => set('paid_to_staff_id', id)} options={staffOptions} placeholder="Search staff…" />
        </Field>
      )}
      {payeeMode === 'other' && (
        <Field label="Name *" error={showErrors ? problems.payee : undefined}>
          <input type="text" className={inputCls} value={form.vendors_name ?? ''} onChange={e => set('vendors_name', e.target.value)} placeholder="e.g. the driver's or shop's name" />
          {typedNameMatch && (
            <button type="button" onClick={() => choosePayee('vendor', typedNameMatch.id)} className="mt-1 text-[11px] font-medium text-brand hover:underline">
              Is it {typedNameMatch.vendor_name}? Use the vendor →
            </button>
          )}
          <p className="mt-1 text-[11px] text-slate-400">A typed name doesn't show on any vendor's statement. If they're paid again, ask for them to be added as a vendor.</p>
        </Field>
      )}

      <SectionHeader title="Where it goes" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={`Project${(form.expense_type ?? 'general') === 'general' ? ' *' : ''}`} error={showErrors ? problems.project : undefined}>
          <ProjectOrOverheadSelect value={projectChoice(form.project_id, form.is_overhead)} onChange={v => setForm(f => ({ ...f, ...fromProjectChoice(v) }))} />
        </Field>
        <Field label="General Ledger">
          <SearchableSelect value={effectiveCategoryId} onChange={id => set('category_id', id)} options={categoryOptions} placeholder="Select general ledger…" />
          {categoryIsDefaulted && (
            <p className="mt-1 text-[11px] text-slate-400">
              Set automatically from this {EXPENSE_TYPE_LABEL[form.expense_type ?? 'general'] ?? 'expense'}. Change it if the posting belongs elsewhere.
            </p>
          )}
          {!effectiveCategoryId && (
            <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
              {canEditFinanceFields(role) ? 'Finance can\'t approve it until a ledger is picked.' : 'Pick one if you know it — otherwise finance will.'}
            </p>
          )}
        </Field>
      </div>
      {(form.expense_type === 'subcontract' || !!form.subcontractor_engagement_id) && (
        <Field label="Subcontractor Engagement">
          <SearchableSelect value={form.subcontractor_engagement_id ?? null} onChange={id => set('subcontractor_engagement_id', id)} options={engagementOptions} placeholder="Which engagement is this certificate for?" />
          {form.subcontractor_engagement_id && (
            <p className="mt-1 text-[11px] text-slate-400">
              Requires at least one completion certificate on the engagement — admin can override if needed, but the save will be blocked otherwise.
            </p>
          )}
        </Field>
      )}
      {form.expense_type === 'property_rent' && (
        <Field label="Property">
          <SearchableSelect value={form.property_id ?? null} onChange={id => set('property_id', id)} options={propertyOptions} placeholder="Select property…" />
        </Field>
      )}

      <SectionHeader title="Receipt" subtitle="A photo is enough. A VAT invoice lets the VAT be claimed back." />
      <ReceiptFields
        value={{
          receipt_url: form.receipt_url ?? null, receipt_name: form.receipt_name ?? null,
          receipt_is_vat: form.receipt_is_vat ?? null, receipt_no: form.receipt_no ?? null, receipt_vat_amount: form.receipt_vat_amount ?? null,
        }}
        onChange={patch => setForm(f => ({ ...f, ...patch }))}
        total={form.amount_etb ?? null}
      />
      {showErrors && problems.receipt_vat && <p className="text-xs text-red-600">{problems.receipt_vat}</p>}
      {!form.receipt_url && (
        <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={form.receipt_available === 'No'} onChange={e => set('receipt_available', e.target.checked ? 'No' : null)} />
          The payee gave no receipt
        </label>
      )}
      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>

      {canEditFinanceFields(role) ? (
        <>
          <SectionHeader title="Payment & tax" subtitle="Finance only" />
          <Field label="Bank Reference">
            <input type="text" className={inputCls} value={form.bank_ref ?? ''} onChange={e => set('bank_ref', e.target.value)} />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Paid Date">
              <input type="date" className={inputCls} value={form.paid_date ?? ''} onChange={e => set('paid_date', e.target.value)} />
            </Field>
            <Field label="Total Payment Date">
              <input type="date" className={inputCls} value={form.total_payment_date ?? ''} onChange={e => set('total_payment_date', e.target.value)} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            {isEdit ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Payment:</span>
                <StatusBadge status={record?.payment_state ?? 'unpaid'} />
                <Link to="/finance/payments" className="text-xs text-brand hover:underline">Manage in Payments →</Link>
              </div>
            ) : (
              <span className="text-xs text-slate-400">New expenses start Unpaid — approve &amp; pay from the Payments dashboard.</span>
            )}
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!form.partially_paid} onChange={e => set('partially_paid', e.target.checked)} />
              Partially Paid
            </label>
          </div>
          {!!form.partially_paid && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Partial Paid Amount">
                  <FormattedNumberInput className={inputCls} value={form.partial_paid_amount ?? null} onChange={n => set('partial_paid_amount', n ?? null)} />
                </Field>
                <Field label="Partial Payment Date">
                  <input type="date" className={inputCls} value={form.partial_payment_date ?? ''} onChange={e => set('partial_payment_date', e.target.value)} />
                </Field>
              </div>
              <Field label="Partial Payment Notes">
                <input type="text" className={inputCls} value={form.partial_payment_notes ?? ''} onChange={e => set('partial_payment_notes', e.target.value)} />
              </Field>
            </>
          )}
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={!!form.verify_wht} onChange={e => set('verify_wht', e.target.checked)} />
            Verify WHT
          </label>
          {/* The amount above is the total (incl VAT + WHT). The WHT levied is
              withheld from it; net is what actually leaves to the payee. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="WHT Handling Method">
              <select className={inputCls} value={form.wht_handling_method ?? ''} onChange={e => set('wht_handling_method', e.target.value)}>
                <option value="">— Select —</option>
                {WHT_HANDLING_OPTIONS.map(o => <option key={o}>{o}</option>)}
                {form.wht_handling_method && !WHT_HANDLING_OPTIONS.includes(form.wht_handling_method) && (
                  <option value={form.wht_handling_method}>{form.wht_handling_method} (as entered)</option>
                )}
              </select>
            </Field>
            <Field label="WHT Amount (levied)">
              <FormattedNumberInput className={inputCls} value={form.wht_amount ?? null} onChange={n => set('wht_amount', n ?? null)} />
            </Field>
            <div>
              <label className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">Net Payable</label>
              <div className="rounded-md border bg-slate-50 dark:bg-slate-900/40 dark:border-slate-600 px-3 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
                {form.amount_etb != null ? formatCurrency(Number(form.amount_etb) - Number(form.wht_amount ?? 0)) : '—'}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Account">
              <SearchableSelect value={form.account_id ?? null} onChange={id => set('account_id', id)} options={accountOptions} placeholder="Select account…" />
            </Field>
            <Field label="Transfer">
              <SearchableSelect value={form.transfer_id ?? null} onChange={id => set('transfer_id', id)} options={transferOptions} placeholder="Select transfer…" />
            </Field>
            <Field label="Paid from VRF (returned money)">
              <SearchableSelect value={form.vrf_id ?? null} onChange={id => set('vrf_id', id)} options={vendorReceiptFacilitationOptions} placeholder="Not paid from a VRF" />
            </Field>
            {/* Was a "Tax Month" picker over tax_summary, which is empty and
                retired. The period for VAT and WHT follows from the date. */}
            <Field label="Tax period">
              <p className="py-2 text-sm text-slate-600 dark:text-slate-300">{taxPeriodOf(form.date) ?? 'Set a date'}</p>
            </Field>
          </div>
        </>
      ) : isEdit && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>Payment:</span>
          <StatusBadge status={record?.payment_state ?? 'unpaid'} />
          <span className="text-slate-400">Finance approves and pays it.</span>
        </div>
      )}

      <button type="button" onClick={() => setShowMore(v => !v)}
        className="mt-4 flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
        {moreOpen ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        {moreOpen ? 'Hide more details' : 'More details (quantity, delivery, location…)'}
      </button>
      {moreOpen && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Purchase Type">
              <select className={inputCls} value={form.purchase_type ?? ''} onChange={e => set('purchase_type', e.target.value)}>
                <option value="">— Select —</option>
                <option>Goods</option><option>Services</option><option>Labor</option>
              </select>
            </Field>
            <Field label="Quantity">
              <input type="number" step="0.01" className={inputCls} value={form.quantity ?? ''} onChange={e => set('quantity', e.target.value ? parseFloat(e.target.value) : null)} />
            </Field>
            <Field label="UOM">
              <select className={inputCls} value={form.uom ?? ''} onChange={e => set('uom', e.target.value)}>
                <option value="">— Select —</option>
                {UOM_OPTIONS.map(u => <option key={u}>{u}</option>)}
              </select>
            </Field>
          </div>
          {!!form.quantity && form.amount_etb != null && (
            <p className="text-xs text-slate-400">Unit price: {formatCurrency(form.amount_etb / form.quantity)}</p>
          )}
          <Field label="Description of Item">
            <textarea rows={2} className={inputCls} value={form.description_of_item ?? ''} onChange={e => set('description_of_item', e.target.value)} />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Sub Ledger">
              <SearchableSelect value={form.sub_category_id ?? null} onChange={id => set('sub_category_id', id)} options={subCategoryOptions} placeholder="Select sub ledger…" />
            </Field>
            <Field label="Location">
              <SearchableSelect value={form.location_id ?? null} onChange={id => set('location_id', id)} options={locationOptions} placeholder="Select location…" />
            </Field>
            <Field label="Payee Bank Account">
              <input type="text" className={inputCls} value={form.vendors_bank_account ?? ''} onChange={e => set('vendors_bank_account', e.target.value)} />
            </Field>
            <Field label="Vendor Location">
              <input type="text" className={inputCls} value={form.vendors_location ?? ''} onChange={e => set('vendors_location', e.target.value)} />
            </Field>
            <Field label="Delivery Status">
              <select className={inputCls} value={deliveryStatuses[0] ?? ''} onChange={e => set('delivery_status', e.target.value ? [e.target.value] : [])}>
                <option value="">— Select —</option>
                {DELIVERY_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Completion %">
              <input type="number" step="1" min="0" max="100" className={inputCls} value={form.completion_percentage ?? ''} onChange={e => set('completion_percentage', e.target.value ? parseFloat(e.target.value) : null)} />
            </Field>
          </div>
          <Field label="Delivery Notes">
            <textarea rows={2} className={inputCls} value={form.delivery_notes ?? ''} onChange={e => set('delivery_notes', e.target.value)} />
          </Field>
        </>
      )}

      {!isEdit && (() => {
        // How complete this expense is: what the form requires, plus the two
        // things finance otherwise chases (a ledger, a receipt photo). A
        // complete one goes straight through the approval queue.
        const missing = [
          ...Object.values(problems),
          ...(effectiveCategoryId ? [] : ['Pick the general ledger']),
          ...(form.receipt_url ? [] : ['Add a photo of the receipt']),
        ]
        return missing.length === 0 ? (
          <p className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 animate-fade-in dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-300">
            <span aria-hidden>✅</span> Complete — finance can approve this one straight away.
          </p>
        ) : (
          <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-slate-500 dark:border-slate-600 dark:text-slate-400">
            <span className="font-semibold text-slate-700 dark:text-slate-200">{missing.length === 1 ? 'One thing' : `${missing.length} things`} to make it complete:</span>{' '}
            {missing.map(m => m.charAt(0).toLowerCase() + m.slice(1)).join(' · ')}
          </p>
        )
      })()}

      {dupes.length > 0 && (
        <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm dark:border-violet-800/40 dark:bg-violet-900/20">
          <p className="font-semibold text-violet-800 dark:text-violet-300">This looks like it may already be recorded</p>
          <ul className="mt-1 space-y-0.5 text-xs text-violet-700 dark:text-violet-300">
            {dupes.map(d => (
              <li key={d.id}>
                <Link to={`/expenses/${d.id}`} target="_blank" className="font-mono font-semibold hover:underline">{d.expense_code ?? 'Expense'}</Link>
                {' '}· {formatDate(d.date)} · {formatCurrency(d.amount_etb)} · {d.item_service_description ?? ''}
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => handleSave(true)} className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700">It's a different payment — save</button>
            <button type="button" onClick={() => setDupes([])} className="rounded-md border px-3 py-1.5 text-xs">Go back</button>
          </div>
        </div>
      )}

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
