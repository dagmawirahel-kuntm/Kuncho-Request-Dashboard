import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { FileUpload } from '@/components/shared/FileUpload'
import { FormattedNumberInput } from '@/components/shared/FormattedNumberInput'
import { useVendors, useLocations, useStaff } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency } from '@/lib/utils'
import { CAPITALIZATION_THRESHOLD, CATEGORY_LABELS, DEFAULT_USEFUL_LIFE, METHOD_LABELS } from '@/lib/fixedAssetLabels'
import type { FixedAsset, FixedAssetInsert, FixedAssetAttachment, FixedAssetCategory, DepreciationMethod } from '@/types/database'
import { X, Paperclip } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100'
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  const required = label.endsWith('*')
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
        {required ? label.slice(0, -1).trim() : label}
        {required && <span className="text-brand"> *</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  )
}

export default function FixedAssetFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['fixed-asset', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('fixed_assets').select('*').eq('id', id).single()
      if (error) throw error
      return data as FixedAsset
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title="Edit Asset" backTo="/finance/fixed-assets" loading onSave={() => {}} />
  }

  return <FixedAssetFormPageBody id={id} record={record} />
}

function FixedAssetFormPageBody({ id, record }: { id?: string; record?: FixedAsset }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: vendors = [] } = useVendors()
  const { data: locations = [] } = useLocations()
  const { data: staff = [] } = useStaff()

  const vendorOptions = useMemo(() => vendors.map((v: any) => ({ id: v.id, label: v.vendor_name })), [vendors])
  const locationOptions = useMemo(() => locations.map((l: any) => ({ id: l.id, label: l.location_name })), [locations])
  const staffOptions = useMemo(() => staff.map((s: any) => ({ id: s.id, label: s.employee_name })), [staff])

  const [form, setForm] = useState<Partial<FixedAssetInsert>>(
    record
      ? {
        asset_name: record.asset_name,
        category: record.category,
        serial_number: record.serial_number,
        manufacturer: record.manufacturer,
        model: record.model,
        purchase_date: record.purchase_date,
        purchase_cost_etb: record.purchase_cost_etb,
        purchase_expense_id: record.purchase_expense_id,
        purchase_vendor_id: record.purchase_vendor_id,
        useful_life_years: record.useful_life_years,
        depreciation_method: record.depreciation_method,
        declining_balance_rate: record.declining_balance_rate,
        total_expected_units: record.total_expected_units,
        salvage_value_etb: record.salvage_value_etb,
        depreciation_start_date: record.depreciation_start_date,
        location_id: record.location_id,
        custodian_staff_id: record.custodian_staff_id,
        condition: record.condition,
        disposal_date: record.disposal_date,
        disposal_method: record.disposal_method,
        disposal_value_etb: record.disposal_value_etb,
        disposal_notes: record.disposal_notes,
        notes: record.notes,
        attachments: record.attachments,
        is_active: record.is_active,
      }
      : { category: 'it_equipment', depreciation_method: 'straight_line', salvage_value_etb: 0, condition: 'good', attachments: [], is_active: true }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set<K extends keyof FixedAssetInsert>(key: K, value: FixedAssetInsert[K]) { setForm(f => ({ ...f, [key]: value })) }

  // Purchase cost gate mirrors the DB CHECK constraint — surfaced here so
  // the rejection reads as guidance, not a raw constraint-violation error.
  const belowThreshold = form.purchase_cost_etb != null && form.purchase_cost_etb > 0 && form.purchase_cost_etb < CAPITALIZATION_THRESHOLD

  const { data: expenseOptions = [] } = useQuery({
    queryKey: ['expenses-lookup-for-fixed-asset', form.purchase_vendor_id],
    queryFn: async () => {
      let query = supabase
        .from('expenses')
        .select('id, expense_code, item_service_description, amount_etb, vendor_id')
        .eq('approval_status', 'finance_approved')
        .order('created_at', { ascending: false })
        .limit(200)
      if (form.purchase_vendor_id) query = query.eq('vendor_id', form.purchase_vendor_id)
      const { data, error } = await query
      if (error) throw error
      return (data ?? []).map(e => ({
        id: e.id,
        label: e.expense_code ?? '(no code)',
        sub: [e.item_service_description, e.amount_etb != null ? formatCurrency(e.amount_etb) : null].filter(Boolean).join(' · '),
      }))
    },
  })

  function handleCategoryChange(category: FixedAssetCategory) {
    setForm(f => ({
      ...f,
      category,
      useful_life_years: f.useful_life_years === DEFAULT_USEFUL_LIFE[f.category as FixedAssetCategory] || f.useful_life_years == null
        ? DEFAULT_USEFUL_LIFE[category]
        : f.useful_life_years,
    }))
  }

  function addAttachment(url: string, name: string) {
    const next: FixedAssetAttachment[] = [...(form.attachments ?? []), { url, name }]
    set('attachments', next)
  }
  function removeAttachment(idx: number) {
    const next = (form.attachments ?? []).filter((_, i) => i !== idx)
    set('attachments', next)
  }

  async function handleSave() {
    setError('')
    if (!form.asset_name?.trim()) { setError('Asset name is required'); return }
    if (!form.purchase_date) { setError('Purchase date is required'); return }
    if (form.purchase_cost_etb == null || form.purchase_cost_etb < CAPITALIZATION_THRESHOLD) {
      setError(`Below capitalization threshold (${formatCurrency(CAPITALIZATION_THRESHOLD)}) — record as expense instead`)
      return
    }
    if (form.depreciation_method === 'declining_balance' && !(form.declining_balance_rate! > 0 && form.declining_balance_rate! < 1)) {
      setError('Declining balance rate must be between 0 and 1 (e.g. 0.25 for 25%)')
      return
    }
    if (form.depreciation_method === 'units_of_production' && !(form.total_expected_units! > 0)) {
      setError('Total expected units is required for units-of-production depreciation')
      return
    }

    setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('fixed_assets').update(form as any).eq('id', id!) : supabase.from('fixed_assets').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['fixed-assets'] })
    qc.invalidateQueries({ queryKey: ['fixed-asset-register-summary'] })
    toast(isEdit ? 'Asset updated' : 'Asset registered', 'success')
    navigate('/finance/fixed-assets')
  }

  return (
    <FormPage title={isEdit ? `Edit Asset — ${record?.asset_code}` : 'Register New Asset'} backTo="/finance/fixed-assets" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Register Asset'} onSave={handleSave}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Category *">
          <select className={inputCls} value={form.category ?? ''} onChange={e => handleCategoryChange(e.target.value as FixedAssetCategory)}>
            {(Object.keys(CATEGORY_LABELS) as FixedAssetCategory[]).map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>
        </Field>
        <Field label="Asset Name *">
          <input type="text" className={inputCls} value={form.asset_name ?? ''} onChange={e => set('asset_name', e.target.value)} placeholder="e.g. Dell Latitude 5420 #14" />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Serial Number">
          <input type="text" className={inputCls} value={form.serial_number ?? ''} onChange={e => set('serial_number', e.target.value)} />
        </Field>
        <Field label="Manufacturer">
          <input type="text" className={inputCls} value={form.manufacturer ?? ''} onChange={e => set('manufacturer', e.target.value)} />
        </Field>
        <Field label="Model">
          <input type="text" className={inputCls} value={form.model ?? ''} onChange={e => set('model', e.target.value)} />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Purchase Date *">
          <input type="date" className={inputCls} value={form.purchase_date ?? ''} onChange={e => set('purchase_date', e.target.value)} />
        </Field>
        <Field label="Purchase Cost (ETB) *">
          <FormattedNumberInput className={inputCls} value={form.purchase_cost_etb ?? null} onChange={n => set('purchase_cost_etb', n ?? undefined as any)} />
          {belowThreshold && (
            <p className="mt-1 text-xs font-medium text-red-500">Below capitalization threshold ({formatCurrency(CAPITALIZATION_THRESHOLD)}) — record as expense instead</p>
          )}
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Vendor">
          <SearchableSelect value={form.purchase_vendor_id ?? null} onChange={v => set('purchase_vendor_id', v)} options={vendorOptions} placeholder="Select vendor…" />
        </Field>
        <Field label="Source Expense" hint="Finance-approved expenses, filtered to the selected vendor when set">
          <SearchableSelect value={form.purchase_expense_id ?? null} onChange={v => set('purchase_expense_id', v)} options={expenseOptions} placeholder="Link to an expense…" />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Useful Life (years) *">
          <input type="number" min={1} className={inputCls} value={form.useful_life_years ?? ''} onChange={e => set('useful_life_years', e.target.value ? Number(e.target.value) : undefined as any)} />
        </Field>
        <Field label="Salvage Value (ETB)">
          <FormattedNumberInput className={inputCls} value={form.salvage_value_etb ?? 0} onChange={n => set('salvage_value_etb', n ?? 0)} />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Depreciation Method *">
          <select className={inputCls} value={form.depreciation_method ?? ''} onChange={e => set('depreciation_method', e.target.value as DepreciationMethod)}>
            {(Object.keys(METHOD_LABELS) as DepreciationMethod[]).map(m => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
          </select>
        </Field>
        <Field label="Depreciation Start Date" hint="Defaults to purchase date">
          <input type="date" className={inputCls} value={form.depreciation_start_date ?? form.purchase_date ?? ''} onChange={e => set('depreciation_start_date', e.target.value)} />
        </Field>
      </div>

      {form.depreciation_method === 'declining_balance' && (
        <Field label="Declining Balance Rate *" hint="As a fraction, e.g. 0.25 for 25%">
          <input type="number" step="0.01" min={0} max={0.99} className={inputCls} value={form.declining_balance_rate ?? ''} onChange={e => set('declining_balance_rate', e.target.value ? Number(e.target.value) : undefined as any)} />
        </Field>
      )}
      {form.depreciation_method === 'units_of_production' && (
        <Field label="Total Expected Units *">
          <input type="number" min={1} className={inputCls} value={form.total_expected_units ?? ''} onChange={e => set('total_expected_units', e.target.value ? Number(e.target.value) : undefined as any)} />
        </Field>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Location">
          <SearchableSelect value={form.location_id ?? null} onChange={v => set('location_id', v)} options={locationOptions} placeholder="Select location…" />
        </Field>
        <Field label="Custodian">
          <SearchableSelect value={form.custodian_staff_id ?? null} onChange={v => set('custodian_staff_id', v)} options={staffOptions} placeholder="Assign custodian…" />
        </Field>
        <Field label="Condition">
          <select className={inputCls} value={form.condition ?? 'good'} onChange={e => set('condition', e.target.value as FixedAsset['condition'])}>
            <option value="new">New</option>
            <option value="good">Good</option>
            <option value="fair">Fair</option>
            <option value="poor">Poor</option>
            <option value="under_repair">Under Repair</option>
            <option value="retired">Retired</option>
          </select>
        </Field>
      </div>

      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>

      <Field label="Attachments" hint="Receipt scans, asset photos">
        <div className="space-y-2">
          {(form.attachments ?? []).length > 0 && (
            <ul className="space-y-1.5">
              {(form.attachments ?? []).map((a, i) => (
                <li key={i} className="flex items-center justify-between rounded-md border dark:border-slate-600 px-3 py-1.5 text-sm">
                  <a href={a.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-brand hover:underline truncate">
                    <Paperclip className="h-3.5 w-3.5 flex-shrink-0" />{a.name}
                  </a>
                  <button type="button" onClick={() => removeAttachment(i)} className="rounded p-1 text-slate-400 hover:text-red-500 flex-shrink-0"><X className="h-3.5 w-3.5" /></button>
                </li>
              ))}
            </ul>
          )}
          <FileUpload bucket="documents" folder="fixed-assets" fileUrl={null} fileName={null} onUpload={addAttachment} onClear={() => {}} label="Add Attachment" />
        </div>
      </Field>
    </FormPage>
  )
}
