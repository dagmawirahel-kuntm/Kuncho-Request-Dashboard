import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import type { BatchPayment, BatchPaymentInsert } from '@/types/database'
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

export default function BatchPaymentFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['batch-payment', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('batch_payments').select('*').eq('id', id).single()
      if (error) throw error
      return data as BatchPayment
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Batch Payment' : 'New Batch Payment'} backTo="/batch-payments" loading onSave={() => {}} />
  }

  return <BatchPaymentFormPageBody id={id} record={record} />
}

function BatchPaymentFormPageBody({ id, record }: { id?: string; record?: BatchPayment }) {
  const isEdit = !!id
    const navigate = useNavigate()
    const { toast } = useToast()
    const qc = useQueryClient()
  
    

  const [form, setForm] = useState<Partial<BatchPaymentInsert>>(
    record
      ? { payment_code: record.payment_code, notes: record.notes }
      : {}
  )
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
  
    

    function set(key: keyof BatchPaymentInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('batch_payments').update(form as any).eq('id', id!) : supabase.from('batch_payments').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['batch-payments'] })
    toast(isEdit ? 'Payment updated' : 'Payment created', 'success')
    navigate('/batch-payments')
  }

  return (
    <FormPage title={isEdit ? 'Edit Batch Payment' : 'New Batch Payment'} backTo="/batch-payments" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Add Payment'} onSave={handleSave}>
      <Field label="Payment Code">
        <input type="text" className={inputCls} value={form.payment_code ?? ''} onChange={e => set('payment_code', e.target.value)} />
      </Field>
      <Field label="Notes">
        <textarea rows={3} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
    </FormPage>
  )
}

