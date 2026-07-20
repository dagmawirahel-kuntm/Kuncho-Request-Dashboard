import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import type { Product, ProductInsert } from '@/types/database'
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

export default function ProductFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['product', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('*').eq('id', id).single()
      if (error) throw error
      return data as Product
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Product' : 'New Product'} backTo="/products" loading onSave={() => {}} />
  }

  return <ProductFormPageBody id={id} record={record} />
}

function ProductFormPageBody({ id, record }: { id?: string; record?: Product }) {
  const isEdit = !!id
    const navigate = useNavigate()
    const { toast } = useToast()
    const qc = useQueryClient()
  
    

  const [form, setForm] = useState<Partial<ProductInsert>>(
    record
      ? {
        product_name: record.product_name,
        category: record.category,
        unit_price: record.unit_price ?? undefined,
        active: record.active,
        description: record.description,
      }
      : { active: true }
  )
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
  
    

    function set(key: keyof ProductInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    if (!form.product_name?.trim()) { setError('Product name is required'); return }
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('products').update(form as any).eq('id', id!) : supabase.from('products').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['products'] })
    toast(isEdit ? 'Product updated' : 'Product created', 'success')
    navigate('/products')
  }

  return (
    <FormPage title={isEdit ? 'Edit Product' : 'New Product'} backTo="/products" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Add Product'} onSave={handleSave}>
      <Field label="Product Name *">
        <input type="text" className={inputCls} value={form.product_name ?? ''} onChange={e => set('product_name', e.target.value)} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Category">
          <input type="text" className={inputCls} value={form.category ?? ''} onChange={e => set('category', e.target.value)} />
        </Field>
        <Field label="Unit Price (ETB)">
          <input type="number" step="0.01" className={inputCls} value={form.unit_price ?? ''} onChange={e => set('unit_price', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
      </div>
      <Field label="Description">
        <textarea rows={3} className={inputCls} value={form.description ?? ''} onChange={e => set('description', e.target.value)} />
      </Field>
      <label className="flex items-center gap-2 cursor-pointer text-sm">
        <input type="checkbox" checked={!!form.active} onChange={e => set('active', e.target.checked)} />
        Active
      </label>
    </FormPage>
  )
}

