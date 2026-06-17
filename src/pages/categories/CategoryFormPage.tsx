import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import type { Category, CategoryInsert } from '@/types/database'
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

export default function CategoryFormPage() {
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
    return <FormPage title={isEdit ? 'Edit Category' : 'New Category'} backTo="/categories" loading onSave={() => {}} />
  }

  return <CategoryFormPageBody id={id} record={record} />
}

function CategoryFormPageBody({ id, record }: { id?: string; record?: Category }) {
  const isEdit = !!id
    const navigate = useNavigate()
    const { toast } = useToast()
    const qc = useQueryClient()
  
    

  const [form, setForm] = useState<Partial<CategoryInsert>>(
    record
      ? { category_name: record.category_name, category_type: record.category_type, parent_type: record.parent_type }
      : {}
  )
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
  
    

    function set(key: keyof CategoryInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    if (!form.category_name?.trim()) { setError('Category name is required'); return }
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('categories').update(form as any).eq('id', id!) : supabase.from('categories').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['categories'] })
    qc.invalidateQueries({ queryKey: ['categories-lookup'] })
    toast(isEdit ? 'Category updated' : 'Category created', 'success')
    navigate('/categories')
  }

  return (
    <FormPage title={isEdit ? 'Edit Category' : 'New Category'} backTo="/categories" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Add Category'} onSave={handleSave}>
      <Field label="Category Name *">
        <input type="text" className={inputCls} value={form.category_name ?? ''} onChange={e => set('category_name', e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category Type">
          <select className={inputCls} value={form.category_type ?? ''} onChange={e => set('category_type', e.target.value)}>
            <option value="">— Select —</option>
            <option>Expense</option><option>Revenue</option><option>Asset</option><option>Liability</option><option>Other</option>
          </select>
        </Field>
        <Field label="Parent Type">
          <select className={inputCls} value={form.parent_type ?? ''} onChange={e => set('parent_type', e.target.value)}>
            <option value="">— Select —</option>
            <option>Operational</option><option>Capital</option><option>Payroll</option><option>Transportation</option><option>Other</option>
          </select>
        </Field>
      </div>
    </FormPage>
  )
}

