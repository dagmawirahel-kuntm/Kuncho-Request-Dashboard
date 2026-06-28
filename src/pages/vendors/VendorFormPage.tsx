import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import type { Vendor, VendorInsert } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'

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

export default function VendorFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['vendor', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('vendors').select('*').eq('id', id).single()
      if (error) throw error
      return data as Vendor
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Vendor' : 'New Vendor'} backTo="/vendors" loading onSave={() => {}} />
  }

  return <VendorFormPageBody id={id} record={record} />
}

function VendorFormPageBody({ id, record }: { id?: string; record?: Vendor }) {
  const isEdit = !!id
    const navigate = useNavigate()
    const { toast } = useToast()
    const qc = useQueryClient()
  
    

  const [form, setForm] = useState<Partial<VendorInsert>>(
    record
      ? {
          vendor_name: record.vendor_name, vendor_type: record.vendor_type, tin: record.tin,
          bank_account: record.bank_account, phone_contact: record.phone_contact, category: record.category,
          wth_eligible: record.wth_eligible, active: record.active, location: record.location,
          email: record.email, address: record.address, contact_person: record.contact_person,
          payment_terms: record.payment_terms, website: record.website, notes: record.notes,
        }
      : { wth_eligible: false, active: true }
  )
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
  
    

    function set(key: keyof VendorInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    if (!form.vendor_name?.trim()) { setError('Vendor name is required'); return }
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('vendors').update(form as any).eq('id', id!) : supabase.from('vendors').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['vendors'] })
    qc.invalidateQueries({ queryKey: ['vendors-lookup'] })
    toast(isEdit ? 'Vendor updated' : 'Vendor added', 'success')
    navigate('/vendors')
  }

  return (
    <FormPage title={isEdit ? 'Edit Vendor' : 'New Vendor'} backTo="/vendors" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Add Vendor'} onSave={handleSave}>
      <Field label="Vendor Name *">
        <input type="text" className={inputCls} value={form.vendor_name ?? ''} onChange={e => set('vendor_name', e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Vendor Type">
          <select className={inputCls} value={form.vendor_type ?? ''} onChange={e => set('vendor_type', e.target.value)}>
            <option value="">— Select —</option>
            <option>Supplier</option><option>Service Provider</option><option>Contractor</option><option>Individual</option><option>Other</option>
          </select>
        </Field>
        <Field label="Category">
          <input type="text" className={inputCls} value={form.category ?? ''} onChange={e => set('category', e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="TIN Number">
          <input type="text" className={inputCls} value={form.tin ?? ''} onChange={e => set('tin', e.target.value)} />
        </Field>
        <Field label="Phone / Contact">
          <input type="tel" className={inputCls} value={form.phone_contact ?? ''} onChange={e => set('phone_contact', e.target.value)} />
        </Field>
      </div>
      <Field label="Bank Account">
        <input type="text" className={inputCls} value={form.bank_account ?? ''} onChange={e => set('bank_account', e.target.value)} />
      </Field>
      <Field label="Location">
        <input type="text" className={inputCls} value={form.location ?? ''} onChange={e => set('location', e.target.value)} />
      </Field>
      <Field label="Address">
        <input type="text" className={inputCls} value={form.address ?? ''} onChange={e => set('address', e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Contact Person">
          <input type="text" className={inputCls} value={form.contact_person ?? ''} onChange={e => set('contact_person', e.target.value)} />
        </Field>
        <Field label="Email">
          <input type="email" className={inputCls} value={form.email ?? ''} onChange={e => set('email', e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Website">
          <input type="url" className={inputCls} value={form.website ?? ''} onChange={e => set('website', e.target.value)} placeholder="https://" />
        </Field>
        <Field label="Payment Terms">
          <input type="text" className={inputCls} value={form.payment_terms ?? ''} onChange={e => set('payment_terms', e.target.value)} placeholder="e.g. Net 30, COD" />
        </Field>
      </div>
      <Field label="Notes">
        <textarea rows={3} className={inputCls + ' resize-none'} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
      <div className="flex items-center gap-6 text-sm">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={!!form.wth_eligible} onChange={e => set('wth_eligible', e.target.checked)} />
          WHT Eligible
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={!!form.active} onChange={e => set('active', e.target.checked)} />
          Active
        </label>
      </div>
    </FormPage>
  )
}

