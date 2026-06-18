import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { MultiSelect } from '@/components/shared/MultiSelect'
import type { Order, OrderInsert } from '@/types/database'
import { useProjects, useStaff, useCategories, useVendors, useExpensesList } from '@/hooks/useLookups'
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

export default function OrderFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['order', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('orders').select('*').eq('id', id).single()
      if (error) throw error
      return data as Order
    },
    enabled: isEdit,
  })

  const { data: linkedExpenses = [] } = useQuery({
    queryKey: ['order-expenses', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('order_expenses').select('expense_id').eq('order_id', id)
      if (error) throw error
      return data.map(r => r.expense_id)
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Order' : 'New Order'} backTo="/orders" loading onSave={() => {}} />
  }

  return <OrderFormPageBody id={id} record={record} linkedExpenseIds={isEdit ? linkedExpenses : []} />
}

function OrderFormPageBody({ id, record, linkedExpenseIds }: { id?: string; record?: Order; linkedExpenseIds: string[] }) {
  const isEdit = !!id
    const navigate = useNavigate()
    const { toast } = useToast()
    const qc = useQueryClient()
    const { data: projects = [] } = useProjects()
    const { data: staff = [] } = useStaff()
    const { data: categories = [] } = useCategories()
    const { data: vendors = [] } = useVendors()
    const { data: expenses = [] } = useExpensesList()
    const projectOptions = useMemo(() => projects.map((p: any) => ({ id: p.id, label: p.project_name })), [projects])
    const staffOptions = useMemo(() => staff.map((s: any) => ({ id: s.id, label: s.employee_name })), [staff])
    const categoryOptions = useMemo(() => categories.map((c: any) => ({ id: c.id, label: c.category_name })), [categories])
    const vendorOptions = useMemo(() => vendors.map((v: any) => ({ id: v.id, label: v.vendor_name })), [vendors])
    const expenseOptions = useMemo(() => expenses.map((e: any) => ({ id: e.id, label: e.item_service_description ?? e.expense_code ?? e.id })), [expenses])

  const [form, setForm] = useState<Partial<OrderInsert>>(
    record
      ? {
        item_service_description: record.item_service_description,
        order_date: record.order_date,
        quantity: record.quantity ?? undefined,
        status: record.status,
        notes: record.notes,
        vendor_recommendation: record.vendor_recommendation,
        project_id: record.project_id,
        staff_id: record.staff_id,
        category_id: record.category_id,
        recommended_vendor_id: record.recommended_vendor_id,
      }
      : { status: 'pending' }
  )
    const [selectedExpenseIds, setSelectedExpenseIds] = useState<string[]>(linkedExpenseIds)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')



    function set(key: keyof OrderInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('orders').update(form as any).eq('id', id!) : supabase.from('orders').insert([form as any]).select().single()
    const { data: saved, error: err } = await op
    if (err) { setSaving(false); setError(err.message); toast(err.message, 'error'); return }
    const orderId = isEdit ? id! : (saved as any).id

    await supabase.from('order_expenses').delete().eq('order_id', orderId)
    if (selectedExpenseIds.length > 0) {
      const { error: linkErr } = await supabase.from('order_expenses').insert(selectedExpenseIds.map(expense_id => ({ order_id: orderId, expense_id })))
      if (linkErr) { setSaving(false); setError(linkErr.message); toast(linkErr.message, 'error'); return }
    }

    setSaving(false)
    qc.invalidateQueries({ queryKey: ['orders'] })
    qc.invalidateQueries({ queryKey: ['order-expenses', orderId] })
    toast(isEdit ? 'Order updated' : 'Order created', 'success')
    navigate('/orders')
  }

  return (
    <FormPage title={isEdit ? 'Edit Order' : 'New Order'} backTo="/orders" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Save Order'} onSave={handleSave}>
      <Field label="Item / Service Description">
        <textarea rows={2} className={inputCls} value={form.item_service_description ?? ''} onChange={e => set('item_service_description', e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Order Date">
          <input type="date" className={inputCls} value={form.order_date ?? ''} onChange={e => set('order_date', e.target.value)} />
        </Field>
        <Field label="Quantity">
          <input type="number" className={inputCls} value={form.quantity ?? ''} onChange={e => set('quantity', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
      </div>
      <Field label="Status">
        <select className={inputCls} value={form.status ?? 'pending'} onChange={e => set('status', e.target.value as any)}>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="completed">Completed</option>
        </select>
      </Field>
      <Field label="Project">
        <SearchableSelect value={form.project_id ?? null} onChange={id => set('project_id', id)} options={projectOptions} placeholder="Select project…" />
      </Field>
      <Field label="Ordered By (Staff)">
        <SearchableSelect value={form.staff_id ?? null} onChange={id => set('staff_id', id)} options={staffOptions} placeholder="Select staff…" />
      </Field>
      <Field label="Item Category">
        <SearchableSelect value={form.category_id ?? null} onChange={id => set('category_id', id)} options={categoryOptions} placeholder="Select category…" />
      </Field>
      <Field label="Recommended Vendor">
        <SearchableSelect value={form.recommended_vendor_id ?? null} onChange={id => set('recommended_vendor_id', id)} options={vendorOptions} placeholder="Select vendor…" />
      </Field>
      <Field label="Vendor Recommendation">
        <input type="text" className={inputCls} value={form.vendor_recommendation ?? ''} onChange={e => set('vendor_recommendation', e.target.value)} />
      </Field>
      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
      <Field label="Linked Expenses">
        <MultiSelect value={selectedExpenseIds} onChange={setSelectedExpenseIds} options={expenseOptions} placeholder="Select expenses…" />
      </Field>
    </FormPage>
  )
}

