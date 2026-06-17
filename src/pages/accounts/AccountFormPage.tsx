import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import type { Account, AccountInsert } from '@/types/database'
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

export default function AccountFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['account', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('accounts').select('*').eq('id', id).single()
      if (error) throw error
      return data as Account
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Account' : 'New Account'} backTo="/accounts" loading onSave={() => {}} />
  }

  return <AccountFormPageBody id={id} record={record} />
}

function AccountFormPageBody({ id, record }: { id?: string; record?: Account }) {
  const isEdit = !!id
    const navigate = useNavigate()
    const { toast } = useToast()
    const qc = useQueryClient()
  
    

  const [form, setForm] = useState<Partial<AccountInsert>>(
    record
      ? { account_name: record.account_name, type: record.type, account_number: record.account_number, notes: record.notes, status: record.status }
      : { status: 'active' }
  )
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
  
    

    function set(key: keyof AccountInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    if (!form.account_name?.trim()) { setError('Account name is required'); return }
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('accounts').update(form as any).eq('id', id!) : supabase.from('accounts').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['accounts'] })
    qc.invalidateQueries({ queryKey: ['accounts-lookup'] })
    toast(isEdit ? 'Account updated' : 'Account created', 'success')
    navigate('/accounts')
  }

  return (
    <FormPage title={isEdit ? 'Edit Account' : 'New Account'} backTo="/accounts" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Add Account'} onSave={handleSave}>
      <Field label="Account Name *">
        <input type="text" className={inputCls} value={form.account_name ?? ''} onChange={e => set('account_name', e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          <select className={inputCls} value={form.type ?? ''} onChange={e => set('type', e.target.value)}>
            <option value="">— Select —</option>
            <option>Bank</option><option>Cash</option><option>Mobile Money</option><option>Other</option>
          </select>
        </Field>
        <Field label="Status">
          <select className={inputCls} value={form.status ?? 'active'} onChange={e => set('status', e.target.value)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </Field>
      </div>
      <Field label="Account Number">
        <input type="text" className={inputCls} value={form.account_number ?? ''} onChange={e => set('account_number', e.target.value)} />
      </Field>
      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
    </FormPage>
  )
}

