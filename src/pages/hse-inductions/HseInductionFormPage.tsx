import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { HseInduction, HseInductionInsert } from '@/types/database'
import { useProjects, useStaff } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  const required = label.endsWith('*')
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
        {required ? label.slice(0, -1).trim() : label}
        {required && <span className="text-brand"> *</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{hint}</p>}
    </div>
  )
}

export default function HseInductionFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['hse-induction', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('hse_inductions').select('*').eq('id', id).single()
      if (error) throw error
      return data as HseInduction
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Induction' : 'New Induction'} backTo="/hse-inductions" loading onSave={() => {}} />
  }

  return <HseInductionFormPageBody id={id} record={record} />
}

function HseInductionFormPageBody({ id, record }: { id?: string; record?: HseInduction }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: projects = [] } = useProjects()
  const { data: staff = [] } = useStaff()
  const projectOptions = useMemo(() => projects.map(p => ({ id: p.id, label: p.project_name })), [projects])
  const staffOptions = useMemo(() => staff.map(s => ({ id: s.id, label: s.employee_name, sub: s.role ?? undefined })), [staff])

  const [form, setForm] = useState<Partial<HseInductionInsert>>(
    record
      ? {
        staff_id: record.staff_id,
        person_name: record.person_name,
        project_id: record.project_id,
        induction_date: record.induction_date,
        inducted_by_staff_id: record.inducted_by_staff_id,
        valid_until: record.valid_until,
        notes: record.notes,
      }
      : { induction_date: new Date().toISOString().slice(0, 10) }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(key: keyof HseInductionInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    if (!form.induction_date) { setError('Induction date is required'); return }
    if (!form.staff_id && !form.person_name?.trim()) { setError('Provide either a staff member or a person name'); return }

    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('hse_inductions').update(form as any).eq('id', id!) : supabase.from('hse_inductions').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['hse-inductions'] })
    toast(isEdit ? 'Induction updated' : 'Induction recorded', 'success')
    navigate('/hse-inductions')
  }

  return (
    <FormPage title={isEdit ? 'Edit Induction' : 'New Induction'} backTo="/hse-inductions" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Add Induction'} onSave={handleSave}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Staff Member" hint="Use this for employees on staff.">
          <SearchableSelect value={form.staff_id ?? null} onChange={v => set('staff_id', v)} options={staffOptions} placeholder="Select staff member…" />
        </Field>
        <Field label="Other Person Name" hint="Use this for non-staff / subcontractor workers.">
          <input type="text" className={inputCls} value={form.person_name ?? ''} onChange={e => set('person_name', e.target.value)} placeholder="Full name" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Project">
          <SearchableSelect value={form.project_id ?? null} onChange={v => set('project_id', v)} options={projectOptions} placeholder="Select project…" />
        </Field>
        <Field label="Inducted By">
          <SearchableSelect value={form.inducted_by_staff_id ?? null} onChange={v => set('inducted_by_staff_id', v)} options={staffOptions} placeholder="Select staff member…" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Induction Date *">
          <input type="date" className={inputCls} value={form.induction_date ?? ''} onChange={e => set('induction_date', e.target.value)} />
        </Field>
        <Field label="Valid Until">
          <input type="date" className={inputCls} value={form.valid_until ?? ''} onChange={e => set('valid_until', e.target.value || null)} />
        </Field>
      </div>
      <Field label="Notes">
        <textarea rows={3} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
    </FormPage>
  )
}
