import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { MultiSelect } from '@/components/shared/MultiSelect'
import type { BatchPayment, BatchPaymentInsert } from '@/types/database'
import { useUserProfiles, useExpensesList } from '@/hooks/useLookups'
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

export default function BatchPaymentFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['batch-payment', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('batch_payments').select('*').eq('id', id).single()
      if (error) throw error
      return data as BatchPayment
    },
    enabled: isEdit,
  })

  const { data: linkedExpenses = [] } = useQuery({
    queryKey: ['batch-payment-expenses', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('batch_payment_expenses').select('expense_id').eq('batch_payment_id', id)
      if (error) throw error
      return data.map(r => r.expense_id)
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Batch Payment' : 'New Batch Payment'} backTo="/batch-payments" loading onSave={() => {}} />
  }

  return <BatchPaymentFormPageBody id={id} record={record} linkedExpenseIds={isEdit ? linkedExpenses : []} />
}

function BatchPaymentFormPageBody({ id, record, linkedExpenseIds }: { id?: string; record?: BatchPayment; linkedExpenseIds: string[] }) {
  const isEdit = !!id
    const navigate = useNavigate()
    const { toast } = useToast()
    const qc = useQueryClient()
    const { data: userProfiles = [] } = useUserProfiles()
    const { data: expenses = [] } = useExpensesList()
    const assigneeOptions = useMemo(() => userProfiles.map((u: any) => ({ id: u.id, label: u.full_name })), [userProfiles])
    const expenseOptions = useMemo(() => expenses.map((e: any) => ({ id: e.id, label: e.item_service_description ?? e.expense_code ?? e.id })), [expenses])

  const [form, setForm] = useState<Partial<BatchPaymentInsert>>(
    record
      ? { payment_code: record.payment_code, notes: record.notes, assignee_id: record.assignee_id }
      : {}
  )
    const [selectedExpenseIds, setSelectedExpenseIds] = useState<string[]>(linkedExpenseIds)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')



    function set(key: keyof BatchPaymentInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('batch_payments').update(form as any).eq('id', id!) : supabase.from('batch_payments').insert([form as any]).select().single()
    const { data: saved, error: err } = await op
    if (err) { setSaving(false); setError(err.message); toast(err.message, 'error'); return }
    const batchId = isEdit ? id! : (saved as any).id

    await supabase.from('batch_payment_expenses').delete().eq('batch_payment_id', batchId)
    if (selectedExpenseIds.length > 0) {
      const { error: linkErr } = await supabase.from('batch_payment_expenses').insert(selectedExpenseIds.map(expense_id => ({ batch_payment_id: batchId, expense_id })))
      if (linkErr) { setSaving(false); setError(linkErr.message); toast(linkErr.message, 'error'); return }
    }

    setSaving(false)
    qc.invalidateQueries({ queryKey: ['batch-payments'] })
    qc.invalidateQueries({ queryKey: ['batch-payment-expenses', batchId] })
    toast(isEdit ? 'Payment updated' : 'Payment created', 'success')
    navigate('/batch-payments')
  }

  return (
    <FormPage title={isEdit ? 'Edit Batch Payment' : 'New Batch Payment'} backTo="/batch-payments" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Add Payment'} onSave={handleSave}>
      <Field label="Payment Code">
        <input type="text" className={inputCls} value={form.payment_code ?? ''} onChange={e => set('payment_code', e.target.value)} />
      </Field>
      <Field label="Notes">
        <textarea rows={3} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
      <Field label="Assignee">
        <SearchableSelect value={form.assignee_id ?? null} onChange={id => set('assignee_id', id)} options={assigneeOptions} placeholder="Select assignee…" />
      </Field>
      <Field label="Linked Expenses">
        <MultiSelect value={selectedExpenseIds} onChange={setSelectedExpenseIds} options={expenseOptions} placeholder="Select expenses…" />
      </Field>
    </FormPage>
  )
}
