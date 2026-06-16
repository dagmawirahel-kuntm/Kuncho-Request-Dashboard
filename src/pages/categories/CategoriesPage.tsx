import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import type { Category, CategoryInsert } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { Plus, X, Pencil, Trash2 } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>{children}</div>
}

function CategoryFormModal({ record, onClose }: { record?: Category; onClose: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const isEdit = !!record
  const [form, setForm] = useState<Partial<CategoryInsert>>(
    isEdit
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
    const op = isEdit ? supabase.from('categories').update(form as any).eq('id', record!.id) : supabase.from('categories').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['categories'] })
    qc.invalidateQueries({ queryKey: ['categories-lookup'] })
    toast(isEdit ? 'Category updated' : 'Category created', 'success')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isEdit ? 'Edit Category' : 'New Category'}</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4">
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
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-60">
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Category'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function CategoriesPage() {
  const [modal, setModal] = useState<'create' | Category | null>(null)
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data, error } = await supabase.from('categories').select('*').order('category_name')
      if (error) throw error
      return data as Category[]
    },
  })

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete category "${name}"? This cannot be undone.`)) return
    const { error } = await supabase.from('categories').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['categories'] })
    qc.invalidateQueries({ queryKey: ['categories-lookup'] })
    toast('Category deleted', 'success')
  }

  const columns: ColumnDef<Category>[] = useMemo(() => [
    { accessorKey: 'category_name', header: 'Category Name' },
    { accessorKey: 'category_type', header: 'Type', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'parent_type', header: 'Parent Type', cell: ({ getValue }) => getValue() ?? '—' },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <button onClick={() => setModal(row.original)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></button>
          <button onClick={() => handleDelete(row.original.id, row.original.category_name)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800">Categories</h1><p className="text-sm text-slate-500">Expense and revenue categories</p></div>
        <button onClick={() => setModal('create')} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          <Plus className="h-4 w-4" /> Add Category
        </button>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search categories…" />}
      {modal === 'create' && <CategoryFormModal onClose={() => setModal(null)} />}
      {modal && modal !== 'create' && <CategoryFormModal record={modal as Category} onClose={() => setModal(null)} />}
    </div>
  )
}
