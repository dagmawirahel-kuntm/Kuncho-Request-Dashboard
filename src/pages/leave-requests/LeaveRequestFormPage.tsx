import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { LeaveRequest, LeaveRequestInsert, LeaveType, LeaveStatus } from '@/types/database'
import { useStaff } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const required = label.endsWith('*')
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
        {required ? label.slice(0, -1).trim() : label}
        {required && <span className="text-brand"> *</span>}
      </label>
      {children}
    </div>
  )
}

const LEAVE_TYPES: { value: LeaveType; label: string }[] = [
  { value: 'annual', label: 'Annual' },
  { value: 'sick', label: 'Sick' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'maternity', label: 'Maternity' },
  { value: 'compassionate', label: 'Compassionate' },
  { value: 'other', label: 'Other' },
]

export default function LeaveRequestFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['leave-request', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('leave_requests').select('*').eq('id', id).single()
      if (error) throw error
      return data as LeaveRequest
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Leave Request' : 'New Leave Request'} backTo="/leave-requests" loading onSave={() => {}} />
  }

  return <LeaveRequestFormPageBody id={id} record={record} />
}

function LeaveRequestFormPageBody({ id, record }: { id?: string; record?: LeaveRequest }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: staff = [] } = useStaff()
  const staffOptions = useMemo(() => staff.map((s: any) => ({ id: s.id, label: s.employee_name })), [staff])

  const [form, setForm] = useState<Partial<LeaveRequestInsert> & { status?: LeaveStatus }>(
    record
      ? {
        staff_id: record.staff_id,
        leave_type: record.leave_type,
        start_date: record.start_date,
        end_date: record.end_date,
        days: record.days,
        reason: record.reason,
        status: record.status,
      }
      : { leave_type: 'annual', status: 'pending' }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(key: keyof LeaveRequestInsert | 'status', value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('leave_requests').update(form as any).eq('id', id!) : supabase.from('leave_requests').insert([{ ...form, status: 'pending' } as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['leave-requests'] })
    toast(isEdit ? 'Leave request updated' : 'Leave request created', 'success')
    navigate('/leave-requests')
  }

  return (
    <FormPage title={isEdit ? 'Edit Leave Request' : 'New Leave Request'} backTo="/leave-requests" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Create Request'} onSave={handleSave}>
      <Field label="Staff *">
        <SearchableSelect value={form.staff_id ?? null} onChange={id => set('staff_id', id)} options={staffOptions} placeholder="Select staff…" />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Leave Type *">
          <select className={inputCls} value={form.leave_type ?? ''} onChange={e => set('leave_type', e.target.value as LeaveType)}>
            {LEAVE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="Days">
          <input type="number" step="0.5" className={inputCls} value={form.days ?? ''} onChange={e => set('days', e.target.value ? parseFloat(e.target.value) : null)} placeholder="Optional" />
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Start Date *">
          <input type="date" className={inputCls} value={form.start_date ?? ''} onChange={e => set('start_date', e.target.value)} />
        </Field>
        <Field label="End Date *">
          <input type="date" className={inputCls} value={form.end_date ?? ''} onChange={e => set('end_date', e.target.value)} />
        </Field>
      </div>
      <Field label="Reason">
        <textarea rows={3} className={inputCls} value={form.reason ?? ''} onChange={e => set('reason', e.target.value)} />
      </Field>
      {isEdit && (form.status === 'pending' || form.status === 'cancelled') && (
        <Field label="Status">
          <select className={inputCls} value={form.status ?? 'pending'} onChange={e => set('status', e.target.value as LeaveStatus)}>
            <option value="pending">Pending</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Approve/reject decisions are made from the list view.</p>
        </Field>
      )}
    </FormPage>
  )
}
