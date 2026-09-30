import { useQuery, useQueryClient } from '@tanstack/react-query'
import { dropRecordCache } from '@/lib/queryCache'
import { useNavigate, useParams } from 'react-router-dom'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import type { Category, CategoryInsert, ChartOfAccounts } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors'
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  const required = label.endsWith('*')
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600">
        {required ? label.slice(0, -1).trim() : label}
        {required && <span className="text-brand"> *</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  )
}

export default function GeneralLedgerFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['category', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('categories').select('*').eq('id', id).single()
      if (error) throw error
      return data as Category
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit General Ledger' : 'New General Ledger'} backTo="/general-ledger" loading onSave={() => {}} />
  }

  return <GeneralLedgerFormPageBody id={id} record={record} />
}

function GeneralLedgerFormPageBody({ id, record }: { id?: string; record?: Category }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { toast } = useToast()
  const qc = useQueryClient()

  const [form, setForm] = useState<Partial<CategoryInsert>>(
    record
      ? { category_name: record.category_name, parent_type: record.parent_type, ledger_group_id: record.ledger_group_id ?? null }
      : {}
  )
  // Where the ledger's account sits in the chart (380): a heading such as
  // 5100 Materials or 6200 Premises and office. Its nature follows.
  const { data: coa = [] } = useQuery({
    queryKey: ['chart-headings'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('chart_of_accounts')
        .select('id, account_code, account_name, nature, parent_account_id, is_postable')
        .eq('is_postable', false).order('account_code')
      if (error) throw error
      return (data ?? []) as Pick<ChartOfAccounts, 'id' | 'account_code' | 'account_name' | 'nature' | 'parent_account_id' | 'is_postable'>[]
    },
  })
  const headings = coa.filter(a => a.parent_account_id)
  const parentName = (id: string | null) => coa.find(a => a.id === id)?.account_name ?? ''
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(key: keyof CategoryInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    if (!form.category_name?.trim()) { setError('Ledger name is required'); return }
    if (!form.ledger_group_id) { setError('Pick the ledger group it belongs to'); return }
    const group = headings.find(h => h.id === form.ledger_group_id)
    const payload = { ...form, nature: group?.nature ?? null }
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('categories').update(payload as any).eq('id', id!) : supabase.from('categories').insert([payload as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    dropRecordCache(qc, 'category')
    qc.invalidateQueries({ queryKey: ['categories'] })
    qc.invalidateQueries({ queryKey: ['categories-lookup'] })
    qc.invalidateQueries({ queryKey: ['general-ledger'] })
    toast(isEdit ? 'General ledger updated' : 'General ledger created', 'success')
    navigate('/general-ledger')
  }

  return (
    <FormPage title={isEdit ? 'Edit General Ledger' : 'New General Ledger'} backTo="/general-ledger" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Add Ledger'} onSave={handleSave}>
      <Field label="Ledger Name *">
        <input type="text" className={inputCls} value={form.category_name ?? ''} onChange={e => set('category_name', e.target.value)} />
      </Field>
      <Field label="Ledger group *" hint="Where it sits in the chart of accounts. Its account is made (or moved) there when you save.">
        <select className={inputCls} value={form.ledger_group_id ?? ''} onChange={e => set('ledger_group_id', e.target.value || null)}>
          <option value="">— Select —</option>
          {headings.map(h => (
            <option key={h.id} value={h.id}>{h.account_code} {h.account_name} · {parentName(h.parent_account_id)}</option>
          ))}
        </select>
      </Field>
      <Field label="Functional Group" hint="Optional operational tag, separate from accounting nature">
        <select className={inputCls} value={form.parent_type ?? ''} onChange={e => set('parent_type', e.target.value)}>
          <option value="">— Select —</option>
          <option>Operational</option><option>Capital</option><option>Payroll</option><option>Transportation</option><option>Other</option>
        </select>
      </Field>
    </FormPage>
  )
}
