import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { MultiSelect } from '@/components/shared/MultiSelect'
import type { Payroll, PayrollInsert } from '@/types/database'
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

export default function PayrollFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['payroll-entry', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll').select('*').eq('id', id).single()
      if (error) throw error
      return data as Payroll
    },
    enabled: isEdit,
  })

  const { data: linkedStaff = [] } = useQuery({
    queryKey: ['payroll-staff', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll_staff').select('staff_id').eq('payroll_id', id)
      if (error) throw error
      return data.map(r => r.staff_id)
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Payroll' : 'New Payroll'} backTo="/payroll" loading onSave={() => {}} />
  }

  return <PayrollFormPageBody id={id} record={record} linkedStaffIds={isEdit ? linkedStaff : []} />
}

function PayrollFormPageBody({ id, record, linkedStaffIds }: { id?: string; record?: Payroll; linkedStaffIds: string[] }) {
  const isEdit = !!id
    const navigate = useNavigate()
    const { toast } = useToast()
    const qc = useQueryClient()
    const { data: staff = [] } = useStaff()
    const { data: accounts = [] } = useAccounts()
    const staffOptions = useMemo(() => staff.map((s: any) => ({ id: s.id, label: s.employee_name })), [staff])
    const accountOptions = useMemo(() => accounts.map((a: any) => ({ id: a.id, label: a.account_name })), [accounts])

  const [form, setForm] = useState<Partial<PayrollInsert>>(
    record
      ? {
        pay_period: record.pay_period,
        start_date: record.start_date,
        end_date: record.end_date,
        payroll_type: record.payroll_type,
        payment_status: record.payment_status,
        payment_method: record.payment_method,
        notes: record.notes,
        account_id: record.account_id,
      }
      : { payment_status: 'pending', pay_period: 'Monthly', payroll_type: 'Regular' }
  )
    const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>(linkedStaffIds)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')



    function set(key: keyof PayrollInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('payroll').update(form as any).eq('id', id!) : supabase.from('payroll').insert([form as any]).select().single()
    const { data: saved, error: err } = await op
    if (err) { setSaving(false); setError(err.message); toast(err.message, 'error'); return }
    const payrollId = isEdit ? id! : (saved as any).id

    await supabase.from('payroll_staff').delete().eq('payroll_id', payrollId)
    if (selectedStaffIds.length > 0) {
      const { error: linkErr } = await supabase.from('payroll_staff').insert(selectedStaffIds.map(staff_id => ({ payroll_id: payrollId, staff_id })))
      if (linkErr) { setSaving(false); setError(linkErr.message); toast(linkErr.message, 'error'); return }
    }

    setSaving(false)
    qc.invalidateQueries({ queryKey: ['payroll'] })
    qc.invalidateQueries({ queryKey: ['payroll-lookup'] })
    qc.invalidateQueries({ queryKey: ['payroll-staff', payrollId] })
    toast(isEdit ? 'Payroll updated' : 'Payroll created', 'success')
    navigate('/payroll')
  }

  return (
    <FormPage title={isEdit ? 'Edit Payroll' : 'New Payroll'} backTo="/payroll" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Add Payroll'} onSave={handleSave}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Pay Period">
          <select className={inputCls} value={form.pay_period ?? ''} onChange={e => set('pay_period', e.target.value)}>
            <option value="">— Select —</option>
            <option>Monthly</option><option>Bi-weekly</option>
          </select>
        </Field>
        <Field label="Payroll Type">
          <select className={inputCls} value={form.payroll_type ?? ''} onChange={e => set('payroll_type', e.target.value)}>
            <option value="">— Select —</option>
            <option>Regular</option><option>Emergency</option><option>Bonus</option>
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start Date">
          <input type="date" className={inputCls} value={form.start_date ?? ''} onChange={e => set('start_date', e.target.value)} />
        </Field>
        <Field label="End Date">
          <input type="date" className={inputCls} value={form.end_date ?? ''} onChange={e => set('end_date', e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Payment Status">
          <select className={inputCls} value={form.payment_status ?? ''} onChange={e => set('payment_status', e.target.value)}>
            <option value="">— Select —</option>
            <option value="pending">Pending</option>
            <option value="processing">Processing</option>
            <option value="paid">Paid</option>
          </select>
        </Field>
        <Field label="Payment Method">
          <select className={inputCls} value={form.payment_method ?? ''} onChange={e => set('payment_method', e.target.value)}>
            <option value="">— Select —</option>
            <option>Bank Transfer</option><option>Cash</option><option>Mobile Money</option>
          </select>
        </Field>
      </div>
      <Field label="Account">
        <SearchableSelect value={form.account_id ?? null} onChange={id => set('account_id', id)} options={accountOptions} placeholder="Select account…" />
      </Field>
      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
      <Field label="Employees">
        <MultiSelect value={selectedStaffIds} onChange={setSelectedStaffIds} options={staffOptions} placeholder="Select employees…" />
      </Field>
    </FormPage>
  )
}

