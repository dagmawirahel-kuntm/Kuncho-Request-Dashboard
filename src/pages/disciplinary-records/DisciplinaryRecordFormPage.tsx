import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { DisciplinaryRecord, DisciplinaryRecordInsert, DisciplinaryCategory } from '@/types/database'
import { useStaff } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'

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

const CATEGORIES: { value: DisciplinaryCategory; label: string }[] = [
  { value: 'verbal_warning', label: 'Verbal Warning' },
  { value: 'written_warning', label: 'Written Warning' },
  { value: 'suspension', label: 'Suspension' },
  { value: 'dismissal', label: 'Dismissal' },
  { value: 'other', label: 'Other' },
]

export default function DisciplinaryRecordFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['disciplinary-record', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('disciplinary_records').select('*').eq('id', id).single()
      if (error) throw error
      return data as DisciplinaryRecord
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Disciplinary Record' : 'New Disciplinary Record'} backTo="/disciplinary-records" loading onSave={() => {}} />
  }

  return <DisciplinaryRecordFormPageBody id={id} record={record} />
}

function DisciplinaryRecordFormPageBody({ id, record }: { id?: string; record?: DisciplinaryRecord }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { toast } = useToast()
  const { user } = useAuth()
  const qc = useQueryClient()
  const { data: staff = [] } = useStaff()
  const staffOptions = useMemo(() => staff.map((s: any) => ({ id: s.id, label: s.employee_name })), [staff])

  const [form, setForm] = useState<Partial<DisciplinaryRecordInsert>>(
    record
      ? {
        staff_id: record.staff_id,
        incident_date: record.incident_date,
        category: record.category,
        description: record.description,
        action_taken: record.action_taken,
      }
      : { category: 'verbal_warning' }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(key: keyof DisciplinaryRecordInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError(''); setSaving(true)
    const op = isEdit
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? supabase.from('disciplinary_records').update(form as any).eq('id', id!)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : supabase.from('disciplinary_records').insert([{ ...form, recorded_by: user?.id ?? null } as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['disciplinary-records'] })
    toast(isEdit ? 'Disciplinary record updated' : 'Disciplinary record created', 'success')
    navigate('/disciplinary-records')
  }

  return (
    <FormPage title={isEdit ? 'Edit Disciplinary Record' : 'New Disciplinary Record'} backTo="/disciplinary-records" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Create Record'} onSave={handleSave}>
      <Field label="Staff *">
        <SearchableSelect value={form.staff_id ?? null} onChange={id => set('staff_id', id)} options={staffOptions} placeholder="Select staff…" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Incident Date *">
          <input type="date" className={inputCls} value={form.incident_date ?? ''} onChange={e => set('incident_date', e.target.value)} />
        </Field>
        <Field label="Category *">
          <select className={inputCls} value={form.category ?? ''} onChange={e => set('category', e.target.value as DisciplinaryCategory)}>
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Description">
        <textarea rows={4} className={inputCls} value={form.description ?? ''} onChange={e => set('description', e.target.value)} placeholder="Factual account of the incident" />
      </Field>
      <Field label="Action Taken">
        <textarea rows={3} className={inputCls} value={form.action_taken ?? ''} onChange={e => set('action_taken', e.target.value)} />
      </Field>
    </FormPage>
  )
}
