import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { FormattedNumberInput } from '@/components/shared/FormattedNumberInput'
import { useVendors } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import type { Property, PropertyInsert } from '@/types/database'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">{label}</label>
      {children}
    </div>
  )
}

export default function PropertyFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['property', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('properties').select('*').eq('id', id).single()
      if (error) throw error
      return data as Property
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title="Edit Property" backTo="/rent" loading onSave={() => {}} />
  }

  return <PropertyFormPageBody id={id} record={record} />
}

function PropertyFormPageBody({ id, record }: { id?: string; record?: Property }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: vendors = [] } = useVendors()
  const vendorOptions = vendors.map((v: any) => ({ id: v.id, label: v.vendor_name }))

  const [form, setForm] = useState<Partial<PropertyInsert>>(
    record
      ? {
        property_name: record.property_name,
        property_type: record.property_type,
        purpose: record.purpose,
        address: record.address,
        landlord_vendor_id: record.landlord_vendor_id,
        monthly_rent_amount: record.monthly_rent_amount ?? undefined,
        lease_start_date: record.lease_start_date,
        lease_end_date: record.lease_end_date,
        deposit_amount: record.deposit_amount ?? undefined,
        renewal_notice_days: record.renewal_notice_days ?? undefined,
        status: record.status,
        notes: record.notes,
      }
      : { property_type: 'workshop', status: 'active' }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(key: keyof PropertyInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError('')
    if (!form.property_name?.trim()) { setError('Property name is required'); return }
    setSaving(true)
    const op = isEdit
      ? supabase.from('properties').update(form as any).eq('id', id!)
      : supabase.from('properties').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['properties-lookup'] })
    qc.invalidateQueries({ queryKey: ['properties'] })
    toast(isEdit ? 'Property updated' : 'Property created', 'success')
    navigate('/rent')
  }

  return (
    <FormPage title={isEdit ? 'Edit Property' : 'New Property'} backTo="/rent" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Create Property'} onSave={handleSave}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Property Name *">
          <input type="text" className={inputCls} value={form.property_name ?? ''} onChange={e => set('property_name', e.target.value)} />
        </Field>
        <Field label="Property Type">
          <input type="text" className={inputCls} value={form.property_type ?? ''} onChange={e => set('property_type', e.target.value)} placeholder="e.g. workshop" />
        </Field>
      </div>
      <Field label="Purpose">
        <input type="text" className={inputCls} value={form.purpose ?? ''} onChange={e => set('purpose', e.target.value)} placeholder="e.g. Primary fabrication workshop" />
      </Field>
      <Field label="Address">
        <input type="text" className={inputCls} value={form.address ?? ''} onChange={e => set('address', e.target.value)} />
      </Field>
      <Field label="Landlord">
        <SearchableSelect value={form.landlord_vendor_id ?? null} onChange={id => set('landlord_vendor_id', id)} options={vendorOptions} placeholder="Select landlord vendor…" />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Monthly Rent (ETB)">
          <FormattedNumberInput className={inputCls} value={form.monthly_rent_amount ?? null} onChange={n => set('monthly_rent_amount', n ?? null)} />
        </Field>
        <Field label="Deposit (ETB)">
          <FormattedNumberInput className={inputCls} value={form.deposit_amount ?? null} onChange={n => set('deposit_amount', n ?? null)} />
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Lease Start">
          <input type="date" className={inputCls} value={form.lease_start_date ?? ''} onChange={e => set('lease_start_date', e.target.value || null)} />
        </Field>
        <Field label="Lease End">
          <input type="date" className={inputCls} value={form.lease_end_date ?? ''} onChange={e => set('lease_end_date', e.target.value || null)} />
        </Field>
      </div>
      <Field label="Renewal Alert — Notice Period (days)">
        <input type="number" step="1" min="0" className={inputCls} value={form.renewal_notice_days ?? ''} onChange={e => set('renewal_notice_days', e.target.value ? parseInt(e.target.value, 10) : null)} placeholder="e.g. 60 — set from this lease's own agreement" />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Status">
          <select className={inputCls} value={form.status ?? 'active'} onChange={e => set('status', e.target.value)}>
            <option value="active">Active</option>
            <option value="vacated">Vacated</option>
          </select>
        </Field>
      </div>
      <Field label="Notes">
        <textarea rows={3} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
    </FormPage>
  )
}
