import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { Order, OrderInsert } from '@/types/database'
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

export default function OrderFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['order', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('orders').select('*').eq('id', id).single()
      if (error) throw error
      return data as Order
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Order' : 'New Order'} backTo="/orders" loading onSave={() => {}} />
  }

  return <OrderFormPageBody id={id} record={record} />
}

function OrderFormPageBody({ id, record }: { id?: string; record?: Order }) {
  const isEdit = !!id
    const navigate = useNavigate()
    const { toast } = useToast()
    const qc = useQueryClient()
    const { data: projects = [] } = useProjects()
    const projectOptions = useMemo(() => projects.map((p: any) => ({ id: p.id, label: p.project_name })), [projects])
  
    

  const [form, setForm] = useState<Partial<OrderInsert>>(
    record
      ? {
        item_service_description: record.item_service_description,
        order_date: record.order_date,
        quantity: record.quantity ?? undefined,
        status: record.status,
        notes: record.notes,
        vendor_recommendation: record.vendor_recommendation,
        project_id: record.project_id,
      }
      : { status: 'pending' }
  )
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
  
    

    function set(key: keyof OrderInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('orders').update(form as any).eq('id', id!) : supabase.from('orders').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['orders'] })
    toast(isEdit ? 'Order updated' : 'Order created', 'success')
    navigate('/orders')
  }

  return (
    <FormPage title={isEdit ? 'Edit Order' : 'New Order'} backTo="/orders" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Save Order'} onSave={handleSave}>
      <Field label="Item / Service Description">
        <textarea rows={2} className={inputCls} value={form.item_service_description ?? ''} onChange={e => set('item_service_description', e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Order Date">
          <input type="date" className={inputCls} value={form.order_date ?? ''} onChange={e => set('order_date', e.target.value)} />
        </Field>
        <Field label="Quantity">
          <input type="number" className={inputCls} value={form.quantity ?? ''} onChange={e => set('quantity', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
      </div>
      <Field label="Status">
        <select className={inputCls} value={form.status ?? 'pending'} onChange={e => set('status', e.target.value as any)}>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="completed">Completed</option>
        </select>
      </Field>
      <Field label="Project">
        <SearchableSelect value={form.project_id ?? null} onChange={id => set('project_id', id)} options={projectOptions} placeholder="Select project…" />
      </Field>
      <Field label="Vendor Recommendation">
        <input type="text" className={inputCls} value={form.vendor_recommendation ?? ''} onChange={e => set('vendor_recommendation', e.target.value)} />
      </Field>
      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
    </FormPage>
  )
}

