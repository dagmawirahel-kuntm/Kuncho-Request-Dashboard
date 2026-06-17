import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { formatCurrency } from '@/lib/utils'
import type { Product, ProductInsert } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { Plus, X, Pencil, Trash2, Check } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>{children}</div>
}

function ProductFormModal({ record, onClose }: { record?: Product; onClose: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const isEdit = !!record
  const [form, setForm] = useState<Partial<ProductInsert>>(
    isEdit
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
    const op = isEdit ? supabase.from('products').update(form as any).eq('id', record!.id) : supabase.from('products').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['products'] })
    toast(isEdit ? 'Product updated' : 'Product created', 'success')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isEdit ? 'Edit Product' : 'New Product'}</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4">
          <Field label="Product Name *">
            <input type="text" className={inputCls} value={form.product_name ?? ''} onChange={e => set('product_name', e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
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
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-60">
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Product'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ProductsPage() {
  const [modal, setModal] = useState<'create' | Product | null>(null)
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('*').order('product_name')
      if (error) throw error
      return data as Product[]
    },
  })

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete product "${name}"? This cannot be undone.`)) return
    const { error } = await supabase.from('products').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['products'] })
    toast('Product deleted', 'success')
  }

  const columns: ColumnDef<Product>[] = useMemo(() => [
    { accessorKey: 'product_name', header: 'Product Name' },
    { accessorKey: 'category', header: 'Category', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'unit_price', header: 'Unit Price', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    {
      accessorKey: 'active',
      header: 'Active',
      cell: ({ getValue }) => getValue() ? <Check className="h-4 w-4 text-green-500" /> : <span className="text-slate-300">—</span>,
    },
    { accessorKey: 'description', header: 'Description', cell: ({ getValue }) => <span className="text-slate-400 truncate block max-w-xs">{(getValue() as string) ?? '—'}</span> },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <button onClick={() => setModal(row.original)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></button>
          <button onClick={() => handleDelete(row.original.id, row.original.product_name)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800">Products</h1><p className="text-sm text-slate-500">Product and service catalog</p></div>
        <button onClick={() => setModal('create')} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          <Plus className="h-4 w-4" /> Add Product
        </button>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search products…" persistKey="products" />}
      {modal === 'create' && <ProductFormModal onClose={() => setModal(null)} />}
      {modal && modal !== 'create' && <ProductFormModal record={modal as Product} onClose={() => setModal(null)} />}
    </div>
  )
}
