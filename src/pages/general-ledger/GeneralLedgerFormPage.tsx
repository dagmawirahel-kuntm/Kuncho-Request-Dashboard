import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import type { Category, CategoryInsert } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors'
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  const required = label.endsWith('*')
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600">
        {required ? label.slice(0, -1).trim() : label}
        {required && <span className="text-brand"> *</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  )
}

export default function GeneralLedgerFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['category', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('categories').select('*').eq('id', id).single()
      if (error) throw error
      return data as Category
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit General Ledger' : 'New General Ledger'} backTo="/general-ledger" loading onSave={() => {}} />
  }

  return <GeneralLedgerFormPageBody id={id} record={record} />
}

function GeneralLedgerFormPageBody({ id, record }: { id?: string; record?: Category }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { toast } = useToast()
  const qc = useQueryClient()

  const [form, setForm] = useState<Partial<CategoryInsert>>(
    record
      ? { category_name: record.category_name, nature: record.nature, parent_type: record.parent_type, asset_class: record.asset_class }
      : {}
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(key: keyof CategoryInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    if (!form.category_name?.trim()) { setError('Ledger name is required'); return }
    if (!form.nature) { setError('Nature is required'); return }
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('categories').update(form as any).eq('id', id!) : supabase.from('categories').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['categories'] })
    qc.invalidateQueries({ queryKey: ['categories-lookup'] })
    qc.invalidateQueries({ queryKey: ['general-ledger'] })
    toast(isEdit ? 'General ledger updated' : 'General ledger created', 'success')
    navigate('/general-ledger')
  }

  return (
    <FormPage title={isEdit ? 'Edit General Ledger' : 'New General Ledger'} backTo="/general-ledger" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Add Ledger'} onSave={handleSave}>
      <Field label="Ledger Name *">
        <input type="text" className={inputCls} value={form.category_name ?? ''} onChange={e => set('category_name', e.target.value)} />
      </Field>
      <Field label="Nature *" hint="Where this ledger sits in Assets = Liabilities + Owner's Equity">
        <select className={inputCls} value={form.nature ?? ''} onChange={e => {
          const nature = e.target.value
          setForm(f => ({ ...f, nature: nature as CategoryInsert['nature'], asset_class: nature === 'Asset' ? f.asset_class : null }))
        }}>
          <option value="">— Select —</option>
          <option value="Asset">Asset</option>
          <option value="Liability">Liability</option>
          <option value="Equity">Equity</option>
          <option value="Revenue">Revenue</option>
          <option value="Expense">Expense</option>
        </select>
      </Field>
      {form.nature === 'Asset' && (
        <Field label="Asset Class" hint="How this ledger groups on the Balance Sheet's asset-class view">
          <select className={inputCls} value={form.asset_class ?? ''} onChange={e => set('asset_class', e.target.value || null)}>
            <option value="">— Unclassified —</option>
            <option value="Inventory">Inventory</option>
            <option value="Fixed Assets">Fixed Assets</option>
            <option value="Current Assets">Current Assets</option>
            <option value="Other">Other</option>
          </select>
        </Field>
      )}
      <Field label="Functional Group" hint="Optional operational tag, separate from accounting nature">
        <select className={inputCls} value={form.parent_type ?? ''} onChange={e => set('parent_type', e.target.value)}>
          <option value="">— Select —</option>
          <option>Operational</option><option>Capital</option><option>Payroll</option><option>Transportation</option><option>Other</option>
        </select>
      </Field>
    </FormPage>
  )
}
