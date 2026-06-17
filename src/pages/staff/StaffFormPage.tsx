import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import type { Staff, StaffInsert } from '@/types/database'
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

export default function StaffFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['staff-member', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('staff').select('*').eq('id', id).single()
      if (error) throw error
      return data as Staff
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Staff Member' : 'New Staff Member'} backTo="/staff" loading onSave={() => {}} />
  }

  return <StaffFormPageBody id={id} record={record} />
}

function StaffFormPageBody({ id, record }: { id?: string; record?: Staff }) {
  const isEdit = !!id
    const navigate = useNavigate()
    const { toast } = useToast()
    const qc = useQueryClient()
  
    

  const [form, setForm] = useState<Partial<StaffInsert>>(
    record
      ? {
        employee_name: record.employee_name,
        staff_type: record.staff_type,
        role: record.role,
        monthly_salary: record.monthly_salary ?? undefined,
        day_rate: record.day_rate ?? undefined,
        payment_frequency: record.payment_frequency,
        bank_account: record.bank_account,
        starting_date: record.starting_date,
        termination_date: record.termination_date,
        phone_number: record.phone_number,
        experience: record.experience,
      }
      : {}
  )
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
  
    

    function set(key: keyof StaffInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    if (!form.employee_name?.trim()) { setError('Employee name is required'); return }
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('staff').update(form as any).eq('id', id!) : supabase.from('staff').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['staff'] })
    qc.invalidateQueries({ queryKey: ['staff-lookup'] })
    toast(isEdit ? 'Staff member updated' : 'Staff member added', 'success')
    navigate('/staff')
  }

  return (
    <FormPage title={isEdit ? 'Edit Staff Member' : 'New Staff Member'} backTo="/staff" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Add Staff'} onSave={handleSave}>
      <Field label="Employee Name *">
        <input type="text" className={inputCls} value={form.employee_name ?? ''} onChange={e => set('employee_name', e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Staff Type">
          <select className={inputCls} value={form.staff_type ?? ''} onChange={e => set('staff_type', e.target.value as Staff['staff_type'])}>
            <option value="">— Select —</option>
            <option>Full Time</option><option>Part Time</option><option>Contract</option><option>Freelance</option>
          </select>
        </Field>
        <Field label="Role / Position">
          <input type="text" className={inputCls} value={form.role ?? ''} onChange={e => set('role', e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Monthly Salary (ETB)">
          <input type="number" step="0.01" className={inputCls} value={form.monthly_salary ?? ''} onChange={e => set('monthly_salary', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
        <Field label="Day Rate (ETB)">
          <input type="number" step="0.01" className={inputCls} value={form.day_rate ?? ''} onChange={e => set('day_rate', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
      </div>
      <Field label="Payment Frequency">
        <input type="text" className={inputCls} value={form.payment_frequency ?? ''} onChange={e => set('payment_frequency', e.target.value)} placeholder="e.g. Monthly, Bi-weekly" />
      </Field>
      <Field label="Bank Account">
        <input type="text" className={inputCls} value={form.bank_account ?? ''} onChange={e => set('bank_account', e.target.value)} />
      </Field>
      <Field label="Phone Number">
        <input type="tel" className={inputCls} value={form.phone_number ?? ''} onChange={e => set('phone_number', e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Starting Date">
          <input type="date" className={inputCls} value={form.starting_date ?? ''} onChange={e => set('starting_date', e.target.value)} />
        </Field>
        <Field label="Termination Date">
          <input type="date" className={inputCls} value={form.termination_date ?? ''} onChange={e => set('termination_date', e.target.value)} />
        </Field>
      </div>
      <Field label="Experience">
        <textarea rows={2} className={inputCls} value={form.experience ?? ''} onChange={e => set('experience', e.target.value)} />
      </Field>
    </FormPage>
  )
}

