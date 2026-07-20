import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { Timesheet, TimesheetInsert } from '@/types/database'
import { useStaff, useProjects, usePayrollList } from '@/hooks/useLookups'
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

export default function TimesheetFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['timesheet-entry', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('timesheet').select('*').eq('id', id).single()
      if (error) throw error
      return data as Timesheet
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Timesheet Entry' : 'New Timesheet Entry'} backTo="/timesheet" loading onSave={() => {}} />
  }

  return <TimesheetFormPageBody id={id} record={record} />
}

function TimesheetFormPageBody({ id, record }: { id?: string; record?: Timesheet }) {
  const isEdit = !!id
    const navigate = useNavigate()
    const { toast } = useToast()
    const qc = useQueryClient()
    const { data: staff = [] } = useStaff()
    const { data: projects = [] } = useProjects()
    const { data: payrolls = [] } = usePayrollList()
    const staffOptions = useMemo(() => staff.map((s: any) => ({ id: s.id, label: s.employee_name, sub: s.role ?? undefined })), [staff])
    const projectOptions = useMemo(() => projects.map((p: any) => ({ id: p.id, label: p.project_name })), [projects])
    const payrollOptions = useMemo(() => payrolls.map((p: any) => ({ id: p.id, label: p.payroll_record ?? p.pay_period })), [payrolls])
  
    

  const [form, setForm] = useState<Partial<TimesheetInsert>>(
    record
      ? {
        date: record.date,
        check_in_time: record.check_in_time,
        check_out_time: record.check_out_time,
        notes: record.notes,
        staff_id: record.staff_id,
        project_id: record.project_id,
        payroll_id: record.payroll_id,
      }
      : {}
  )
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
  
    

    function set(key: keyof TimesheetInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('timesheet').update(form as any).eq('id', id!) : supabase.from('timesheet').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['timesheet'] })
    toast(isEdit ? 'Entry updated' : 'Entry created', 'success')
    navigate('/timesheet')
  }

  return (
    <FormPage title={isEdit ? 'Edit Timesheet Entry' : 'New Timesheet Entry'} backTo="/timesheet" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Save Entry'} onSave={handleSave}>
      <Field label="Staff Member">
        <SearchableSelect value={form.staff_id ?? null} onChange={id => set('staff_id', id)} options={staffOptions} placeholder="Select staff…" />
      </Field>
      <Field label="Date">
        <input type="date" className={inputCls} value={form.date ?? ''} onChange={e => set('date', e.target.value)} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Check In Time">
          <input type="time" className={inputCls} value={form.check_in_time ?? ''} onChange={e => set('check_in_time', e.target.value)} />
        </Field>
        <Field label="Check Out Time">
          <input type="time" className={inputCls} value={form.check_out_time ?? ''} onChange={e => set('check_out_time', e.target.value)} />
        </Field>
      </div>
      <Field label="Project">
        <SearchableSelect value={form.project_id ?? null} onChange={id => set('project_id', id)} options={projectOptions} placeholder="Select project…" />
      </Field>
      <Field label="Pay Period (Payroll)">
        <SearchableSelect value={form.payroll_id ?? null} onChange={id => set('payroll_id', id)} options={payrollOptions} placeholder="Select pay period…" />
      </Field>
      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
    </FormPage>
  )
}

