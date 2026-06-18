import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { Sale, SaleInsert } from '@/types/database'
import { useClients, useProjects, useAccounts, useTaxSummaries } from '@/hooks/useLookups'
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

export default function SaleFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['sale', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('sales').select('*').eq('id', id).single()
      if (error) throw error
      return data as Sale
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Sale' : 'New Sale'} backTo="/sales" loading onSave={() => {}} />
  }

  return <SaleFormPageBody id={id} record={record} />
}

function SaleFormPageBody({ id, record }: { id?: string; record?: Sale }) {
  const isEdit = !!id
    const navigate = useNavigate()
    const { toast } = useToast()
    const qc = useQueryClient()
    const { data: clients = [] } = useClients()
    const { data: projects = [] } = useProjects()
    const { data: accounts = [] } = useAccounts()
    const { data: taxSummaries = [] } = useTaxSummaries()
    const clientOptions = useMemo(() => clients.map((c: any) => ({ id: c.id, label: c.client_name, sub: c.phone_number ?? undefined })), [clients])
    const projectOptions = useMemo(() => projects.map((p: any) => ({ id: p.id, label: p.project_name })), [projects])
    const accountOptions = useMemo(() => accounts.map((a: any) => ({ id: a.id, label: a.account_name })), [accounts])
    const taxSummaryOptions = useMemo(() => taxSummaries.map((t: any) => ({ id: t.id, label: t.month })), [taxSummaries])
  
    

  const [form, setForm] = useState<Partial<SaleInsert>>(
    record
      ? {
        sales_description: record.sales_description,
        sales_status: record.sales_status,
        date: record.date,
        amount: record.amount ?? undefined,
        product_or_service: record.product_or_service,
        payment_method: record.payment_method,
        notes: record.notes,
        client_id: record.client_id,
        project_id: record.project_id,
        account_id: record.account_id,
        tax_summary_id: record.tax_summary_id,
      }
      : { sales_status: 'Draft' }
  )
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
  
    

    function set(key: keyof SaleInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    if (!form.sales_description?.trim()) { setError('Description is required'); return }
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('sales').update(form as any).eq('id', id!) : supabase.from('sales').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['sales'] })
    toast(isEdit ? 'Sale updated' : 'Sale created', 'success')
    navigate('/sales')
  }

  return (
    <FormPage title={isEdit ? 'Edit Sale' : 'New Sale'} backTo="/sales" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Save Sale'} onSave={handleSave}>
      <Field label="Description *">
        <textarea rows={2} className={inputCls} value={form.sales_description ?? ''} onChange={e => set('sales_description', e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date">
          <input type="date" className={inputCls} value={form.date ?? ''} onChange={e => set('date', e.target.value)} />
        </Field>
        <Field label="Amount (ETB)">
          <input type="number" step="0.01" className={inputCls} value={form.amount ?? ''} onChange={e => set('amount', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Status">
          <select className={inputCls} value={form.sales_status ?? ''} onChange={e => set('sales_status', e.target.value)}>
            <option value="">— Select —</option>
            <option>Draft</option><option>Invoiced</option><option>Paid</option><option>Cancelled</option>
          </select>
        </Field>
        <Field label="Payment Method">
          <select className={inputCls} value={form.payment_method ?? ''} onChange={e => set('payment_method', e.target.value)}>
            <option value="">— Select —</option>
            <option>Cash</option><option>Bank Transfer</option><option>Check</option><option>Other</option>
          </select>
        </Field>
      </div>
      <Field label="Product / Service">
        <input type="text" className={inputCls} value={form.product_or_service ?? ''} onChange={e => set('product_or_service', e.target.value)} />
      </Field>
      <Field label="Client">
        <SearchableSelect value={form.client_id ?? null} onChange={id => set('client_id', id)} options={clientOptions} placeholder="Select client…" />
      </Field>
      <Field label="Project">
        <SearchableSelect value={form.project_id ?? null} onChange={id => set('project_id', id)} options={projectOptions} placeholder="Select project…" />
      </Field>
      <Field label="Received Through (Account)">
        <SearchableSelect value={form.account_id ?? null} onChange={id => set('account_id', id)} options={accountOptions} placeholder="Select account…" />
      </Field>
      <Field label="Tax Month">
        <SearchableSelect value={form.tax_summary_id ?? null} onChange={id => set('tax_summary_id', id)} options={taxSummaryOptions} placeholder="Select tax month…" />
      </Field>
      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
    </FormPage>
  )
}

