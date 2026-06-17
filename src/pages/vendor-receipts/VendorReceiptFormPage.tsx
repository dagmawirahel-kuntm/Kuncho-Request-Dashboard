import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import type { VendorReceiptFacilitation, VendorReceiptFacilitationInsert } from '@/types/database'
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

export default function VendorReceiptFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['vendor-receipt', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('vendor_receipt_facilitation').select('*').eq('id', id).single()
      if (error) throw error
      return data as VendorReceiptFacilitation
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Receipt Record' : 'New Receipt Record'} backTo="/vendor-receipts" loading onSave={() => {}} />
  }

  return <VendorReceiptFormPageBody id={id} record={record} />
}

function VendorReceiptFormPageBody({ id, record }: { id?: string; record?: VendorReceiptFacilitation }) {
  const isEdit = !!id
    const navigate = useNavigate()
    const { toast } = useToast()
    const qc = useQueryClient()
  
    

  const [form, setForm] = useState<Partial<VendorReceiptFacilitationInsert>>(
    record
      ? {
        trxn_date: record.trxn_date,
        money_returned: record.money_returned ?? undefined,
        net_facilitation_cost: record.net_facilitation_cost ?? undefined,
        notes: record.notes,
      }
      : {}
  )
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
  
    

    function set(key: keyof VendorReceiptFacilitationInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('vendor_receipt_facilitation').update(form as any).eq('id', id!) : supabase.from('vendor_receipt_facilitation').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['vendor-receipts'] })
    toast(isEdit ? 'Record updated' : 'Record created', 'success')
    navigate('/vendor-receipts')
  }

  return (
    <FormPage title={isEdit ? 'Edit Receipt Record' : 'New Receipt Record'} backTo="/vendor-receipts" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Add Record'} onSave={handleSave}>
      <Field label="Transaction Date">
        <input type="date" className={inputCls} value={form.trxn_date ?? ''} onChange={e => set('trxn_date', e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Money Returned (ETB)">
          <input type="number" step="0.01" className={inputCls} value={form.money_returned ?? ''} onChange={e => set('money_returned', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
        <Field label="Net Facilitation Cost (ETB)">
          <input type="number" step="0.01" className={inputCls} value={form.net_facilitation_cost ?? ''} onChange={e => set('net_facilitation_cost', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
      </div>
      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
    </FormPage>
  )
}

