import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { SubCategory, SubCategoryInsert } from '@/types/database'
import { useCategories } from '@/hooks/useLookups'
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

export default function SubLedgerFormPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['sub-category', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('sub_categories').select('*').eq('id', id).single()
      if (error) throw error
      return data as SubCategory
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Sub Ledger' : 'New Sub Ledger'} backTo="/general-ledger" loading onSave={() => {}} />
  }

  return <SubLedgerFormPageBody id={id} record={record} presetParentId={searchParams.get('parent')} />
}

function SubLedgerFormPageBody({ id, record, presetParentId }: { id?: string; record?: SubCategory; presetParentId: string | null }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: categories = [] } = useCategories()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const categoryOptions = useMemo(() => categories.map((c: any) => ({ id: c.id, label: c.category_name, sub: c.nature ?? undefined })), [categories])

  const [form, setForm] = useState<Partial<SubCategoryInsert>>(
    record
      ? { item_name: record.item_name, parent_category_id: record.parent_category_id, description: record.description, active: record.active }
      : { parent_category_id: presetParentId, active: true }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(key: keyof SubCategoryInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    if (!form.item_name?.trim()) { setError('Sub ledger name is required'); return }
    if (!form.parent_category_id) { setError('Parent general ledger is required'); return }
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('sub_categories').update(form as any).eq('id', id!) : supabase.from('sub_categories').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['sub-categories-lookup'] })
    qc.invalidateQueries({ queryKey: ['general-ledger'] })
    toast(isEdit ? 'Sub ledger updated' : 'Sub ledger created', 'success')
    navigate('/general-ledger')
  }

  return (
    <FormPage title={isEdit ? 'Edit Sub Ledger' : 'New Sub Ledger'} backTo="/general-ledger" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Add Sub Ledger'} onSave={handleSave}>
      <Field label="Parent General Ledger *">
        <SearchableSelect value={form.parent_category_id ?? null} onChange={id => set('parent_category_id', id)} options={categoryOptions} placeholder="Select general ledger…" />
      </Field>
      <Field label="Sub Ledger Name *">
        <input type="text" className={inputCls} value={form.item_name ?? ''} onChange={e => set('item_name', e.target.value)} />
      </Field>
      <Field label="Description">
        <textarea rows={2} className={inputCls} value={form.description ?? ''} onChange={e => set('description', e.target.value)} />
      </Field>
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={form.active ?? true} onChange={e => set('active', e.target.checked)} />
        Active
      </label>
    </FormPage>
  )
}
