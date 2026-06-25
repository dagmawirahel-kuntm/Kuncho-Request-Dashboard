import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { Transfer, TransferInsert } from '@/types/database'
import { useAccounts } from '@/hooks/useLookups'
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

export default function TransferFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['transfer', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('transfers').select('*').eq('id', id).single()
      if (error) throw error
      return data as Transfer
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title="Edit Transfer" backTo="/transfers" loading onSave={() => {}} />
  }

  return <TransferFormBody id={id} record={record} />
}

function TransferFormBody({ id, record }: { id?: string; record?: Transfer }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: accounts = [] } = useAccounts()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accountOptions = (accounts as any[]).map(a => ({ id: a.id, label: a.account_name }))

  const [form, setForm] = useState<Partial<TransferInsert>>(
    record
      ? {
        date: record.date,
        from_account_id: record.from_account_id,
        to_account_id: record.to_account_id,
        amount: record.amount ?? undefined,
        notes: record.notes,
      }
      : {}
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(key: keyof TransferInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    if (!form.from_account_id) { setError('From account is required'); return }
    if (!form.to_account_id) { setError('To account is required'); return }
    if (!form.amount || (form.amount as number) <= 0) { setError('Amount must be greater than 0'); return }
    if (form.from_account_id === form.to_account_id) { setError('From and To accounts must be different'); return }
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('transfers').update(form as any).eq('id', id!) : supabase.from('transfers').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['transfers'] })
    toast(isEdit ? 'Transfer updated' : 'Transfer recorded', 'success')
    navigate('/transfers')
  }

  return (
    <FormPage title={isEdit ? 'Edit Transfer' : 'New Transfer'} backTo="/transfers" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Record Transfer'} onSave={handleSave}>
      <Field label="Date">
        <input type="date" className={inputCls} value={form.date ?? ''} onChange={e => set('date', e.target.value)} />
      </Field>
      <Field label="From Account *">
        <SearchableSelect value={form.from_account_id ?? null} onChange={id => set('from_account_id', id)} options={accountOptions} placeholder="Select account…" />
      </Field>
      <Field label="To Account *">
        <SearchableSelect value={form.to_account_id ?? null} onChange={id => set('to_account_id', id)} options={accountOptions} placeholder="Select account…" />
      </Field>
      <Field label="Amount (ETB) *">
        <input type="number" step="0.01" min="0" className={inputCls} value={form.amount ?? ''} onChange={e => set('amount', e.target.value ? parseFloat(e.target.value) : null)} />
      </Field>
      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
    </FormPage>
  )
}
