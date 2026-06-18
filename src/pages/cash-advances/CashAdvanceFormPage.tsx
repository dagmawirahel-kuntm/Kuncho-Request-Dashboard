import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { MultiSelect } from '@/components/shared/MultiSelect'
import type { CashAdvance, CashAdvanceInsert } from '@/types/database'
import { useStaff, useAccounts, usePayrollList, useExpensesList } from '@/hooks/useLookups'
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

  const { data: linkedExpenses = [] } = useQuery({
    queryKey: ['cash-advance-expenses', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('cash_advance_expenses').select('expense_id').eq('cash_advance_id', id)
      if (error) throw error
      return data.map(r => r.expense_id)
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Cash Advance' : 'New Cash Advance'} backTo="/cash-advances" loading onSave={() => {}} />
  }

  return <CashAdvanceFormPageBody id={id} record={record} linkedExpenseIds={isEdit ? linkedExpenses : []} />
}

function CashAdvanceFormPageBody({ id, record, linkedExpenseIds }: { id?: string; record?: CashAdvance; linkedExpenseIds: string[] }) {
  const isEdit = !!id
    const navigate = useNavigate()
    const { toast } = useToast()
    const qc = useQueryClient()
    const { data: staff = [] } = useStaff()
    const { data: accounts = [] } = useAccounts()
    const { data: payroll = [] } = usePayrollList()
    const { data: expenses = [] } = useExpensesList()
    const staffOptions = useMemo(() => staff.map((s: any) => ({ id: s.id, label: s.employee_name, sub: s.role ?? undefined })), [staff])
    const accountOptions = useMemo(() => accounts.map((a: any) => ({ id: a.id, label: a.account_name, sub: a.account_number ?? undefined })), [accounts])
    const payrollOptions = useMemo(() => payroll.map((p: any) => ({ id: p.id, label: p.payroll_record ?? p.pay_period })), [payroll])
    const expenseOptions = useMemo(() => expenses.map((e: any) => ({ id: e.id, label: e.item_service_description ?? e.expense_code ?? e.id })), [expenses])

  const [form, setForm] = useState<Partial<CashAdvanceInsert>>(
    record
      ? {
        advance_id_code: record.advance_id_code,
        amount_advanced: record.amount_advanced ?? undefined,
        date_given: record.date_given,
        notes: record.notes,
        staff_id: record.staff_id,
        account_used_id: record.account_used_id,
        payroll_id: record.payroll_id,
      }
      : {}
  )
    const [selectedExpenseIds, setSelectedExpenseIds] = useState<string[]>(linkedExpenseIds)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')



    function set(key: keyof CashAdvanceInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('cash_advances').update(form as any).eq('id', id!) : supabase.from('cash_advances').insert([form as any]).select().single()
    const { data: saved, error: err } = await op
    if (err) { setSaving(false); setError(err.message); toast(err.message, 'error'); return }
    const advanceId = isEdit ? id! : (saved as any).id

    await supabase.from('cash_advance_expenses').delete().eq('cash_advance_id', advanceId)
    if (selectedExpenseIds.length > 0) {
      const { error: linkErr } = await supabase.from('cash_advance_expenses').insert(selectedExpenseIds.map(expense_id => ({ cash_advance_id: advanceId, expense_id })))
      if (linkErr) { setSaving(false); setError(linkErr.message); toast(linkErr.message, 'error'); return }
    }

    setSaving(false)
    qc.invalidateQueries({ queryKey: ['cash-advances'] })
    qc.invalidateQueries({ queryKey: ['cash-advance-expenses', advanceId] })
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
      <Field label="Payroll">
        <SearchableSelect value={form.payroll_id ?? null} onChange={id => set('payroll_id', id)} options={payrollOptions} placeholder="Select payroll…" />
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
      <Field label="Linked Expenses">
        <MultiSelect value={selectedExpenseIds} onChange={setSelectedExpenseIds} options={expenseOptions} placeholder="Select expenses…" />
      </Field>
    </FormPage>
  )
}
