import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { EmergencyPayrollSummary, EmergencyPayrollSummaryInsert } from '@/types/database'
import { useStaff } from '@/hooks/useLookups'
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

export default function EmergencyPayrollFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['emergency-payroll-entry', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('emergency_payroll_summary').select('*').eq('id', id).single()
      if (error) throw error
      return data as EmergencyPayrollSummary
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Emergency Payroll' : 'New Emergency Payroll'} backTo="/emergency-payroll" loading onSave={() => {}} />
  }

  return <EmergencyPayrollFormPageBody id={id} record={record} />
}

function EmergencyPayrollFormPageBody({ id, record }: { id?: string; record?: EmergencyPayrollSummary }) {
  const isEdit = !!id
    const navigate = useNavigate()
    const { toast } = useToast()
    const qc = useQueryClient()
    const { data: staff = [] } = useStaff()
    const staffOptions = useMemo(() => staff.map((s: any) => ({ id: s.id, label: s.employee_name })), [staff])
  
    

  const [form, setForm] = useState<Partial<EmergencyPayrollSummaryInsert>>(
    record
      ? {
        payroll_month: record.payroll_month,
        days_worked: record.days_worked ?? undefined,
        total_ot_days: record.total_ot_days ?? undefined,
        total_bonus: record.total_bonus ?? undefined,
        advance_taken: record.advance_taken ?? undefined,
        payment_status: record.payment_status,
        payment_date: record.payment_date,
        notes: record.notes,
        staff_id: record.staff_id,
      }
      : {}
  )
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
  
    

    function set(key: keyof EmergencyPayrollSummaryInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('emergency_payroll_summary').update(form as any).eq('id', id!) : supabase.from('emergency_payroll_summary').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['emergency-payroll'] })
    toast(isEdit ? 'Record updated' : 'Record created', 'success')
    navigate('/emergency-payroll')
  }

  return (
    <FormPage title={isEdit ? 'Edit Emergency Payroll' : 'New Emergency Payroll'} backTo="/emergency-payroll" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Add Record'} onSave={handleSave}>
      <Field label="Staff Member">
        <SearchableSelect value={form.staff_id ?? null} onChange={id => set('staff_id', id)} options={staffOptions} placeholder="Select staff…" />
      </Field>
      <Field label="Payroll Month">
        <input type="month" className={inputCls} value={form.payroll_month ?? ''} onChange={e => set('payroll_month', e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Days Worked">
          <input type="number" step="0.5" className={inputCls} value={form.days_worked ?? ''} onChange={e => set('days_worked', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
        <Field label="Total OT Days">
          <input type="number" step="0.5" className={inputCls} value={form.total_ot_days ?? ''} onChange={e => set('total_ot_days', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Total Bonus (ETB)">
          <input type="number" step="0.01" className={inputCls} value={form.total_bonus ?? ''} onChange={e => set('total_bonus', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
        <Field label="Advance Taken (ETB)">
          <input type="number" step="0.01" className={inputCls} value={form.advance_taken ?? ''} onChange={e => set('advance_taken', e.target.value ? parseFloat(e.target.value) : null)} />
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
        <Field label="Payment Date">
          <input type="date" className={inputCls} value={form.payment_date ?? ''} onChange={e => set('payment_date', e.target.value)} />
        </Field>
      </div>
      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
    </FormPage>
  )
}

