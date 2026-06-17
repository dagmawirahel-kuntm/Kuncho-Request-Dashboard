import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { CashAdvance, CashAdvanceInsert } from '@/types/database'
import { useStaff, useAccounts } from '@/hooks/useLookups'
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

export default function CashAdvanceFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['cash-advance', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('cash_advances').select('*').eq('id', id).single()
      if (error) throw error
      return data as CashAdvance
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Cash Advance' : 'New Cash Advance'} backTo="/cash-advances" loading onSave={() => {}} />
  }

  return <CashAdvanceFormPageBody id={id} record={record} />
}

function CashAdvanceFormPageBody({ id, record }: { id?: string; record?: CashAdvance }) {
  const isEdit = !!id
    const navigate = useNavigate()
    const { toast } = useToast()
    const qc = useQueryClient()
    const { data: staff = [] } = useStaff()
    const { data: accounts = [] } = useAccounts()
    const staffOptions = useMemo(() => staff.map((s: any) => ({ id: s.id, label: s.employee_name, sub: s.role ?? undefined })), [staff])
    const accountOptions = useMemo(() => accounts.map((a: any) => ({ id: a.id, label: a.account_name, sub: a.account_number ?? undefined })), [accounts])
  
    

  const [form, setForm] = useState<Partial<CashAdvanceInsert>>(
    record
      ? {
        advance_id_code: record.advance_id_code,
        amount_advanced: record.amount_advanced ?? undefined,
        date_given: record.date_given,
        notes: record.notes,
        staff_id: record.staff_id,
        account_used_id: record.account_used_id,
      }
      : {}
  )
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
  
    

    function set(key: keyof CashAdvanceInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('cash_advances').update(form as any).eq('id', id!) : supabase.from('cash_advances').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['cash-advances'] })
    toast(isEdit ? 'Advance updated' : 'Advance created', 'success')
    navigate('/cash-advances')
  }

  return (
    <FormPage title={isEdit ? 'Edit Cash Advance' : 'New Cash Advance'} backTo="/cash-advances" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Add Advance'} onSave={handleSave}>
      <Field label="Staff Member">
        <SearchableSelect value={form.staff_id ?? null} onChange={id => set('staff_id', id)} options={staffOptions} placeholder="Select staff…" />
      </Field>
      <Field label="Account Used">
        <SearchableSelect value={form.account_used_id ?? null} onChange={id => set('account_used_id', id)} options={accountOptions} placeholder="Select account…" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount Advanced (ETB)">
          <input type="number" step="0.01" className={inputCls} value={form.amount_advanced ?? ''} onChange={e => set('amount_advanced', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
        <Field label="Date Given">
          <input type="date" className={inputCls} value={form.date_given ?? ''} onChange={e => set('date_given', e.target.value)} />
        </Field>
      </div>
      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
    </FormPage>
  )
}

