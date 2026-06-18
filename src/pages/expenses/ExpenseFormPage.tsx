import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { Expense, ExpenseInsert } from '@/types/database'
import { useVendors, useProjects, useCategories, useSubCategories, useAccounts, useVendorReceiptFacilitations, useTransfers, useTaxSummaries, useLocations } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const required = label.endsWith('*')
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600">
        {required ? label.slice(0, -1).trim() : label}
        {required && <span className="text-brand"> *</span>}
      </label>
      {children}
    </div>
  )
}

const UOM_OPTIONS = ['Pcs', 'Kg', 'L', 'm', 'm²', 'm³', 'Hr', 'Day', 'Month', 'Set', 'Other']
const DELIVERY_STATUS_OPTIONS = ['Ordered', 'In Transit', 'Delivered', 'Returned']

export default function ExpenseFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['expense', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('expenses').select('*').eq('id', id).single()
      if (error) throw error
      return data as Expense
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Expense' : 'New Expense'} backTo="/expenses" loading onSave={() => {}} />
  }

  return <ExpenseFormPageBody id={id} record={record} />
}

function ExpenseFormPageBody({ id, record }: { id?: string; record?: Expense }) {
  const isEdit = !!id
    const navigate = useNavigate()
    const { user } = useAuth()
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

    const vendorOptions = useMemo(() => vendors.map((v: any) => ({ id: v.id, label: v.vendor_name })), [vendors])
    const projectOptions = useMemo(() => projects.map((p: any) => ({ id: p.id, label: p.project_name })), [projects])
    const categoryOptions = useMemo(() => categories.map((c: any) => ({ id: c.id, label: c.category_name })), [categories])
    const subCategoryOptions = useMemo(() => subCategories.map((s: any) => ({ id: s.id, label: s.item_name })), [subCategories])
    const accountOptions = useMemo(() => accounts.map((a: any) => ({ id: a.id, label: a.account_name })), [accounts])
    const vendorReceiptFacilitationOptions = useMemo(() => vendorReceiptFacilitations.map((v: any) => ({ id: v.id, label: v.record_name })), [vendorReceiptFacilitations])
    const transferOptions = useMemo(() => transfers.map((t: any) => ({ id: t.id, label: t.transfer_id_code })), [transfers])
    const taxSummaryOptions = useMemo(() => taxSummaries.map((t: any) => ({ id: t.id, label: t.month })), [taxSummaries])
    const locationOptions = useMemo(() => locations.map((l: any) => ({ id: l.id, label: l.location_name })), [locations])



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
      }
      : {
    payment_status: false,
    requested: false,
    partially_paid: false,
    contacted: false,
    verify_wht: false,
    is_new_item: false,
    is_allocated: false,
    receipt_delivered: false,
    delivery_status: [],
    purchaser_user_id: user?.id,
  }
  )
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
  
    

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('expenses').update(form as any).eq('id', id!) : supabase.from('expenses').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['expenses'] })
    qc.invalidateQueries({ queryKey: ['expenses-lookup'] })
    toast(isEdit ? 'Expense updated' : 'Expense created', 'success')
    navigate('/expenses')
  }

  const deliveryStatuses = (form.delivery_status as string[]) ?? []

  return (
    <FormPage title={isEdit ? 'Edit Expense' : 'New Expense'} backTo="/expenses" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Save Expense'} onSave={handleSave}>

      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide pt-2">Basic Info</p>
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
          <select className={inputCls} value={form.expense_type ?? ''} onChange={e => set('expense_type', e.target.value)}>
            <option value="">— Select —</option>
            <option>Operational</option><option>Capital</option><option>Payroll</option><option>Transportation</option><option>Other</option>
          </select>
        </Field>
        <Field label="Purchase Type">
          <select className={inputCls} value={form.purchase_type ?? ''} onChange={e => set('purchase_type', e.target.value)}>
            <option value="">— Select —</option>
            <option>Goods</option><option>Services</option><option>Labor</option>
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Quantity">
          <input type="number" step="0.01" className={inputCls} value={form.quantity ?? ''} onChange={e => set('quantity', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
        <Field label="UOM">
          <select className={inputCls} value={form.uom ?? ''} onChange={e => set('uom', e.target.value)}>
            <option value="">— Select —</option>
            {UOM_OPTIONS.map(u => <option key={u}>{u}</option>)}
          </select>
        </Field>
        <Field label="Receipt Available">
          <select className={inputCls} value={form.receipt_available ?? ''} onChange={e => set('receipt_available', e.target.value)}>
            <option value="">— Select —</option>
            <option>Yes</option><option>No</option><option>Pending</option>
          </select>
        </Field>
      </div>
      <Field label="Proposed Item Name">
        <input type="text" className={inputCls} value={form.proposed_item_name ?? ''} onChange={e => set('proposed_item_name', e.target.value)} />
      </Field>
      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>

      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide pt-2">Vendor</p>
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

      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide pt-2">Classification</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category">
          <SearchableSelect value={form.category_id ?? null} onChange={id => set('category_id', id)} options={categoryOptions} placeholder="Select category…" />
        </Field>
        <Field label="Project">
          <SearchableSelect value={form.project_id ?? null} onChange={id => set('project_id', id)} options={projectOptions} placeholder="Select project…" />
        </Field>
      </div>
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

      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide pt-2">Payment & Status</p>
      <Field label="Bank Reference">
        <input type="text" className={inputCls} value={form.bank_ref ?? ''} onChange={e => set('bank_ref', e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Paid Date">
          <input type="date" className={inputCls} value={form.paid_date ?? ''} onChange={e => set('paid_date', e.target.value)} />
        </Field>
        <Field label="Total Payment Date">
          <input type="date" className={inputCls} value={form.total_payment_date ?? ''} onChange={e => set('total_payment_date', e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Partial Paid Amount">
          <input type="number" step="0.01" className={inputCls} value={form.partial_paid_amount ?? ''} onChange={e => set('partial_paid_amount', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
        <Field label="Partial Payment Date">
          <input type="date" className={inputCls} value={form.partial_payment_date ?? ''} onChange={e => set('partial_payment_date', e.target.value)} />
        </Field>
      </div>
      <Field label="Partial Payment Notes">
        <input type="text" className={inputCls} value={form.partial_payment_notes ?? ''} onChange={e => set('partial_payment_notes', e.target.value)} />
      </Field>
      <Field label="Completion %">
        <input type="number" step="1" min="0" max="100" className={inputCls} value={form.completion_percentage ?? ''} onChange={e => set('completion_percentage', e.target.value ? parseFloat(e.target.value) : null)} />
      </Field>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={!!form.requested} onChange={e => set('requested', e.target.checked)} />
          Requested
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={!!form.payment_status} onChange={e => set('payment_status', e.target.checked)} />
          Paid
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={!!form.partially_paid} onChange={e => set('partially_paid', e.target.checked)} />
          Partially Paid
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

      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide pt-2">Delivery</p>
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

      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide pt-2">WHT</p>
      <div className="flex items-center gap-4 text-sm">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={!!form.verify_wht} onChange={e => set('verify_wht', e.target.checked)} />
          Verify WHT
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="WHT Handling Method">
          <input type="text" className={inputCls} value={form.wht_handling_method ?? ''} onChange={e => set('wht_handling_method', e.target.value)} />
        </Field>
        <Field label="WHT Fund">
          <input type="text" className={inputCls} value={form.wht_fund ?? ''} onChange={e => set('wht_fund', e.target.value)} />
        </Field>
      </div>

      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide pt-2">Linked Records</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Sub-Category">
          <SearchableSelect value={form.sub_category_id ?? null} onChange={id => set('sub_category_id', id)} options={subCategoryOptions} placeholder="Select sub-category…" />
        </Field>
        <Field label="Account">
          <SearchableSelect value={form.account_id ?? null} onChange={id => set('account_id', id)} options={accountOptions} placeholder="Select account…" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Vendor Receipt Facilitation">
          <SearchableSelect value={form.vendor_receipt_facilitation_id ?? null} onChange={id => set('vendor_receipt_facilitation_id', id)} options={vendorReceiptFacilitationOptions} placeholder="Select record…" />
        </Field>
        <Field label="Transfer">
          <SearchableSelect value={form.transfer_id ?? null} onChange={id => set('transfer_id', id)} options={transferOptions} placeholder="Select transfer…" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tax Month">
          <SearchableSelect value={form.tax_summary_id ?? null} onChange={id => set('tax_summary_id', id)} options={taxSummaryOptions} placeholder="Select tax month…" />
        </Field>
        <Field label="Location">
          <SearchableSelect value={form.location_id ?? null} onChange={id => set('location_id', id)} options={locationOptions} placeholder="Select location…" />
        </Field>
      </div>
    </FormPage>
  )
}

