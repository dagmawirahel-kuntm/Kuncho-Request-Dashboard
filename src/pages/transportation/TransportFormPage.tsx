import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { TransportationRequest, TransportationRequestInsert } from '@/types/database'
import { useProjects } from '@/hooks/useLookups'
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

export default function TransportFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['transport-request', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('transportation_requests').select('*').eq('id', id).single()
      if (error) throw error
      return data as TransportationRequest
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Transportation Request' : 'New Transportation Request'} backTo="/transportation" loading onSave={() => {}} />
  }

  return <TransportFormPageBody id={id} record={record} />
}

function TransportFormPageBody({ id, record }: { id?: string; record?: TransportationRequest }) {
  const isEdit = !!id
    const navigate = useNavigate()
    const { toast } = useToast()
    const qc = useQueryClient()
    const { data: projects = [] } = useProjects()
    const projectOptions = useMemo(() => projects.map((p: any) => ({ id: p.id, label: p.project_name })), [projects])
  
    

  const [form, setForm] = useState<Partial<TransportationRequestInsert>>(
    record
      ? {
        requested_date: record.requested_date,
        payment_status: record.payment_status,
        requested: record.requested,
        amount: record.amount ?? undefined,
        bank_ref: record.bank_ref,
        delivery_status: record.delivery_status,
        vehicle_type: record.vehicle_type,
        driver_name: record.driver_name,
        expected_delivery_date: record.expected_delivery_date,
        actual_delivery_date: record.actual_delivery_date,
        pickup_location_text: record.pickup_location_text,
        dropoff_location_text: record.dropoff_location_text,
        vendor_name: record.vendor_name,
        vendor_bank_account: record.vendor_bank_account,
        notes: record.notes,
        project_id: record.project_id,
      }
      : { payment_status: false, requested: false }
  )
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
  
    

    function set(key: keyof TransportationRequestInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('transportation_requests').update(form as any).eq('id', id!) : supabase.from('transportation_requests').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['transportation'] })
    toast(isEdit ? 'Request updated' : 'Request created', 'success')
    navigate('/transportation')
  }

  return (
    <FormPage title={isEdit ? 'Edit Transportation Request' : 'New Transportation Request'} backTo="/transportation" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Save Request'} onSave={handleSave}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Requested Date">
          <input type="date" className={inputCls} value={form.requested_date ?? ''} onChange={e => set('requested_date', e.target.value)} />
        </Field>
        <Field label="Amount (ETB)">
          <input type="number" step="0.01" className={inputCls} value={form.amount ?? ''} onChange={e => set('amount', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
      </div>
      <Field label="Project">
        <SearchableSelect value={form.project_id ?? null} onChange={id => set('project_id', id)} options={projectOptions} placeholder="Select project…" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Vehicle Type">
          <input type="text" className={inputCls} value={form.vehicle_type ?? ''} onChange={e => set('vehicle_type', e.target.value)} />
        </Field>
        <Field label="Driver Name">
          <input type="text" className={inputCls} value={form.driver_name ?? ''} onChange={e => set('driver_name', e.target.value)} />
        </Field>
      </div>
      <Field label="Delivery Status">
        <select className={inputCls} value={form.delivery_status ?? ''} onChange={e => set('delivery_status', e.target.value)}>
          <option value="">— Select —</option>
          <option>Pending</option><option>In Transit</option><option>Delivered</option><option>Cancelled</option>
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Pickup Location">
          <input type="text" className={inputCls} value={form.pickup_location_text ?? ''} onChange={e => set('pickup_location_text', e.target.value)} />
        </Field>
        <Field label="Dropoff Location">
          <input type="text" className={inputCls} value={form.dropoff_location_text ?? ''} onChange={e => set('dropoff_location_text', e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Expected Delivery">
          <input type="date" className={inputCls} value={form.expected_delivery_date ?? ''} onChange={e => set('expected_delivery_date', e.target.value)} />
        </Field>
        <Field label="Actual Delivery">
          <input type="date" className={inputCls} value={form.actual_delivery_date ?? ''} onChange={e => set('actual_delivery_date', e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Vendor Name">
          <input type="text" className={inputCls} value={form.vendor_name ?? ''} onChange={e => set('vendor_name', e.target.value)} />
        </Field>
        <Field label="Vendor Bank Account">
          <input type="text" className={inputCls} value={form.vendor_bank_account ?? ''} onChange={e => set('vendor_bank_account', e.target.value)} />
        </Field>
      </div>
      <Field label="Bank Reference">
        <input type="text" className={inputCls} value={form.bank_ref ?? ''} onChange={e => set('bank_ref', e.target.value)} />
      </Field>
      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
      <div className="flex items-center gap-4 text-sm">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={!!form.requested} onChange={e => set('requested', e.target.checked)} />
          Requested
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={!!form.payment_status} onChange={e => set('payment_status', e.target.checked)} />
          Paid
        </label>
      </div>
    </FormPage>
  )
}

