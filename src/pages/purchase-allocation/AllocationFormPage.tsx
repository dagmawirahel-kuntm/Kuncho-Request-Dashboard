import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { formatCurrency } from '@/lib/utils'
import type { PurchaseAllocation, PurchaseAllocationInsert } from '@/types/database'
import { useExpensesList, useSubCategories, useProjects } from '@/hooks/useLookups'
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

const UOM_OPTIONS = ['Pcs', 'Kg', 'L', 'm', 'm²', 'm³', 'Hr', 'Day', 'Month', 'Set', 'Other']
const VAT_OPTIONS = ['Incl. VAT', 'Excl. VAT', 'No VAT']

export default function AllocationFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['allocation', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('purchase_allocation').select('*').eq('id', id).single()
      if (error) throw error
      return data as PurchaseAllocation
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Allocation' : 'New Allocation'} backTo="/purchase-allocation" loading onSave={() => {}} />
  }

  return <AllocationFormPageBody id={id} record={record} />
}

function AllocationFormPageBody({ id, record }: { id?: string; record?: PurchaseAllocation }) {
  const isEdit = !!id
    const navigate = useNavigate()
    const { toast } = useToast()
    const qc = useQueryClient()
    const { data: expenses = [] } = useExpensesList()
    const { data: projects = [] } = useProjects()
    const { data: subCategories = [] } = useSubCategories()
  
    const expenseOptions = useMemo(() => expenses.map((e: any) => ({
      id: e.id,
      label: e.expense_code ? `${e.expense_code} — ${e.item_service_description ?? ''}` : (e.item_service_description ?? e.id),
      sub: e.amount_etb ? formatCurrency(e.amount_etb) : undefined,
    })), [expenses])
    const projectOptions = useMemo(() => projects.map((p: any) => ({ id: p.id, label: p.project_name })), [projects])
    const subCategoryOptions = useMemo(() => subCategories.map((s: any) => ({ id: s.id, label: s.item_name })), [subCategories])
  
    

  const [form, setForm] = useState<Partial<PurchaseAllocationInsert>>(
    record
      ? {
        parent_purchase_id: record.parent_purchase_id,
        sub_category_id: record.sub_category_id,
        quantity: record.quantity ?? undefined,
        uom: record.uom,
        unit_price_vat_status: record.unit_price_vat_status,
        unit_price: record.unit_price ?? undefined,
        project_id: record.project_id,
        notes: record.notes,
      }
      : {}
  )
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
  
    

    function set(key: keyof PurchaseAllocationInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('purchase_allocation').update(form as any).eq('id', id!) : supabase.from('purchase_allocation').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['purchase-allocation'] })
    toast(isEdit ? 'Allocation updated' : 'Allocation created', 'success')
    navigate('/purchase-allocation')
  }

  return (
    <FormPage title={isEdit ? 'Edit Allocation' : 'New Allocation'} backTo="/purchase-allocation" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Add Allocation'} onSave={handleSave}>
      <Field label="Parent Expense">
        <SearchableSelect value={form.parent_purchase_id ?? null} onChange={id => set('parent_purchase_id', id)} options={expenseOptions} placeholder="Select expense…" />
      </Field>
      <Field label="Sub-Category">
        <SearchableSelect value={form.sub_category_id ?? null} onChange={id => set('sub_category_id', id)} options={subCategoryOptions} placeholder="Search sub-categories…" />
      </Field>
      <Field label="Project">
        <SearchableSelect value={form.project_id ?? null} onChange={id => set('project_id', id)} options={projectOptions} placeholder="Select project…" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Quantity">
          <input type="number" step="0.01" className={inputCls} value={form.quantity ?? ''} onChange={e => set('quantity', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
        <Field label="UOM">
          <select className={inputCls} value={form.uom ?? ''} onChange={e => set('uom', e.target.value)}>
            <option value="">— Select —</option>
            {UOM_OPTIONS.map(u => <option key={u}>{u}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Unit Price">
          <input type="number" step="0.01" className={inputCls} value={form.unit_price ?? ''} onChange={e => set('unit_price', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
        <Field label="VAT Status">
          <select className={inputCls} value={form.unit_price_vat_status ?? ''} onChange={e => set('unit_price_vat_status', e.target.value)}>
            <option value="">— Select —</option>
            {VAT_OPTIONS.map(v => <option key={v}>{v}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
    </FormPage>
  )
}

