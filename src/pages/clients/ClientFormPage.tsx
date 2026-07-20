import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import type { Client, ClientInsert } from '@/types/database'
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

export default function ClientFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const location = useLocation()
  const returnTo: string = (location.state as { returnTo?: string })?.returnTo ?? '/clients'
  const { data: record, isLoading } = useQuery({
    queryKey: ['client', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('*').eq('id', id).single()
      if (error) throw error
      return data as Client
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title="Edit Client" backTo={returnTo} loading onSave={() => {}} />
  }

  return <ClientFormBody id={id} record={record} returnTo={returnTo} />
}

function ClientFormBody({ id, record, returnTo }: { id?: string; record?: Client; returnTo: string }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { toast } = useToast()
  const qc = useQueryClient()

  const [form, setForm] = useState<Partial<ClientInsert>>(
    record
      ? {
          client_name: record.client_name,
          phone_number: record.phone_number,
          email: record.email,
          additional_email: record.additional_email,
          business_type: record.business_type,
          address: record.address,
          notes: record.notes,
          receipt_vouched: record.receipt_vouched,
          logo_url: record.logo_url,
        }
      : { receipt_vouched: false, logo_url: null }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(key: keyof ClientInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    if (!form.client_name?.trim()) { setError('Client name is required'); return }
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('clients').update(form as any).eq('id', id!) : supabase.from('clients').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['clients'] })
    qc.invalidateQueries({ queryKey: ['clients-lookup'] })
    if (isEdit) qc.invalidateQueries({ queryKey: ['client', id] })
    toast(isEdit ? 'Client updated' : 'Client added', 'success')
    navigate(isEdit ? `/clients/${id}` : '/clients')
  }

  return (
    <FormPage
      title={isEdit ? 'Edit Client' : 'New Client'}
      backTo={returnTo}
      error={error}
      saving={saving}
      saveLabel={isEdit ? 'Save Changes' : 'Add Client'}
      onSave={handleSave}
    >
      <Field label="Client Name *">
        <input type="text" className={inputCls} value={form.client_name ?? ''} onChange={e => set('client_name', e.target.value)} />
      </Field>

      <Field label="Business Type">
        <select className={inputCls} value={form.business_type ?? ''} onChange={e => set('business_type', e.target.value || null)}>
          <option value="">— Select —</option>
          <option>Government</option>
          <option>NGO / Non-Profit</option>
          <option>Private Company</option>
          <option>Sole Proprietor</option>
          <option>Partnership</option>
          <option>Other</option>
        </select>
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Email">
          <input type="email" className={inputCls} value={form.email ?? ''} onChange={e => set('email', e.target.value || null)} />
        </Field>
        <Field label="Additional Email">
          <input type="email" className={inputCls} value={form.additional_email ?? ''} onChange={e => set('additional_email', e.target.value || null)} />
        </Field>
      </div>

      <Field label="Phone Number">
        <input type="tel" className={inputCls} value={form.phone_number ?? ''} onChange={e => set('phone_number', e.target.value || null)} />
      </Field>

      <Field label="Address">
        <input type="text" className={inputCls} value={form.address ?? ''} onChange={e => set('address', e.target.value || null)} />
      </Field>

      <Field label="Notes">
        <textarea rows={3} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value || null)} />
      </Field>

      <Field label="Logo URL (optional)">
        <input type="url" className={inputCls} placeholder="https://example.com/logo.png" value={form.logo_url ?? ''} onChange={e => set('logo_url', e.target.value || null)} />
      </Field>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={form.receipt_vouched ?? false}
          onChange={e => set('receipt_vouched', e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
        />
        <span className="text-sm text-slate-700 dark:text-slate-300">Receipt vouched</span>
      </label>
    </FormPage>
  )
}
