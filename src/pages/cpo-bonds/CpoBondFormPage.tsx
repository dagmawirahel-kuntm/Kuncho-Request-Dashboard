import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { CpoBond, CpoBondInsert } from '@/types/database'
import { useVendors, useAccounts, useExpensesList } from '@/hooks/useLookups'
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

export default function CpoBondFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['cpo-bond', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('cpo_bonds').select('*').eq('id', id).single()
      if (error) throw error
      return data as CpoBond
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit CPO Bond' : 'New CPO Bond'} backTo="/cpo-bonds" loading onSave={() => {}} />
  }

  return <CpoBondFormPageBody id={id} record={record} />
}

function CpoBondFormPageBody({ id, record }: { id?: string; record?: CpoBond }) {
  const isEdit = !!id
    const navigate = useNavigate()
    const { toast } = useToast()
    const qc = useQueryClient()
    const { data: vendors = [] } = useVendors()
    const { data: accounts = [] } = useAccounts()
    const { data: expenses = [] } = useExpensesList()
    const vendorOptions = useMemo(() => vendors.map((v: any) => ({ id: v.id, label: v.vendor_name })), [vendors])
    const accountOptions = useMemo(() => accounts.map((a: any) => ({ id: a.id, label: a.account_name, sub: a.account_number ?? undefined })), [accounts])
    const expenseOptions = useMemo(() => expenses.map((e: any) => ({ id: e.id, label: e.item_service_description ?? e.expense_code ?? e.id })), [expenses])
  
    

  const [form, setForm] = useState<Partial<CpoBondInsert>>(
    record
      ? {
        bond_id_ref: record.bond_id_ref,
        project: record.project,
        total_bond_amount: record.total_bond_amount ?? undefined,
        bond_status: record.bond_status,
        notes: record.notes,
        vendor_id: record.vendor_id,
        paid_from_id: record.paid_from_id,
        related_expense_id: record.related_expense_id,
      }
      : { bond_status: 'Active' }
  )
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
  
    

    function set(key: keyof CpoBondInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('cpo_bonds').update(form as any).eq('id', id!) : supabase.from('cpo_bonds').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['cpo-bonds'] })
    toast(isEdit ? 'Bond updated' : 'Bond created', 'success')
    navigate('/cpo-bonds')
  }

  return (
    <FormPage title={isEdit ? 'Edit CPO Bond' : 'New CPO Bond'} backTo="/cpo-bonds" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Add Bond'} onSave={handleSave}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Bond ID / Ref">
          <input type="text" className={inputCls} value={form.bond_id_ref ?? ''} onChange={e => set('bond_id_ref', e.target.value)} />
        </Field>
        <Field label="Status">
          <select className={inputCls} value={form.bond_status ?? ''} onChange={e => set('bond_status', e.target.value)}>
            <option value="">— Select —</option>
            <option>Active</option><option>Released</option><option>Forfeited</option>
          </select>
        </Field>
      </div>
      <Field label="Project">
        <input type="text" className={inputCls} value={form.project ?? ''} onChange={e => set('project', e.target.value)} placeholder="Project name" />
      </Field>
      <Field label="Total Bond Amount (ETB)">
        <input type="number" step="0.01" className={inputCls} value={form.total_bond_amount ?? ''} onChange={e => set('total_bond_amount', e.target.value ? parseFloat(e.target.value) : null)} />
      </Field>
      <Field label="Vendor">
        <SearchableSelect value={form.vendor_id ?? null} onChange={id => set('vendor_id', id)} options={vendorOptions} placeholder="Select vendor…" />
      </Field>
      <Field label="Paid From Account">
        <SearchableSelect value={form.paid_from_id ?? null} onChange={id => set('paid_from_id', id)} options={accountOptions} placeholder="Select account…" />
      </Field>
      <Field label="Related Expense">
        <SearchableSelect value={form.related_expense_id ?? null} onChange={id => set('related_expense_id', id)} options={expenseOptions} placeholder="Select expense…" />
      </Field>
      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
    </FormPage>
  )
}

