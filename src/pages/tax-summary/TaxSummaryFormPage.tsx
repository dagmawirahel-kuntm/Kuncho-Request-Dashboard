import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import type { TaxSummary, TaxSummaryInsert } from '@/types/database'
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

export default function TaxSummaryFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['tax-summary-entry', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('tax_summary').select('*').eq('id', id).single()
      if (error) throw error
      return data as TaxSummary
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Tax Summary' : 'New Tax Summary'} backTo="/tax-summary" loading onSave={() => {}} />
  }

  return <TaxSummaryFormPageBody id={id} record={record} />
}

function TaxSummaryFormPageBody({ id, record }: { id?: string; record?: TaxSummary }) {
  const isEdit = !!id
    const navigate = useNavigate()
    const { toast } = useToast()
    const qc = useQueryClient()
  
    

  const [form, setForm] = useState<Partial<TaxSummaryInsert>>(
    record
      ? {
        month: record.month,
        vat_from_expenses: record.vat_from_expenses ?? undefined,
        vat_from_sales: record.vat_from_sales ?? undefined,
        wht_from_expenses: record.wht_from_expenses ?? undefined,
        wht_deducted_by_client: record.wht_deducted_by_client ?? undefined,
      }
      : {}
  )
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
  
    

    function set(key: keyof TaxSummaryInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    if (!form.month) { setError('Month is required'); return }
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('tax_summary').update(form as any).eq('id', id!) : supabase.from('tax_summary').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['tax-summary'] })
    toast(isEdit ? 'Tax summary updated' : 'Tax summary created', 'success')
    navigate('/tax-summary')
  }

  return (
    <FormPage title={isEdit ? 'Edit Tax Summary' : 'New Tax Summary'} backTo="/tax-summary" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Add Summary'} onSave={handleSave}>
      <Field label="Month *">
        <input type="month" className={inputCls} value={form.month ?? ''} onChange={e => set('month', e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="VAT from Expenses (ETB)">
          <input type="number" step="0.01" className={inputCls} value={form.vat_from_expenses ?? ''} onChange={e => set('vat_from_expenses', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
        <Field label="VAT from Sales (ETB)">
          <input type="number" step="0.01" className={inputCls} value={form.vat_from_sales ?? ''} onChange={e => set('vat_from_sales', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="WHT from Expenses (ETB)">
          <input type="number" step="0.01" className={inputCls} value={form.wht_from_expenses ?? ''} onChange={e => set('wht_from_expenses', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
        <Field label="WHT Deducted by Client (ETB)">
          <input type="number" step="0.01" className={inputCls} value={form.wht_deducted_by_client ?? ''} onChange={e => set('wht_deducted_by_client', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
      </div>
    </FormPage>
  )
}

