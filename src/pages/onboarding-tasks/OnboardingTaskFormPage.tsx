import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { OnboardingTask, OnboardingTaskInsert } from '@/types/database'
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

export default function OnboardingTaskFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['onboarding-task', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('onboarding_tasks').select('*').eq('id', id).single()
      if (error) throw error
      return data as OnboardingTask
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Onboarding Task' : 'New Onboarding Task'} backTo="/onboarding-tasks" loading onSave={() => {}} />
  }

  return <OnboardingTaskFormPageBody id={id} record={record} />
}

function OnboardingTaskFormPageBody({ id, record }: { id?: string; record?: OnboardingTask }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: staff = [] } = useStaff()
  const staffOptions = useMemo(() => staff.map((s: any) => ({ id: s.id, label: s.employee_name })), [staff])

  const [form, setForm] = useState<Partial<OnboardingTaskInsert>>(
    record
      ? {
        staff_id: record.staff_id,
        task: record.task,
        notes: record.notes,
      }
      : {}
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(key: keyof OnboardingTaskInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('onboarding_tasks').update(form as any).eq('id', id!) : supabase.from('onboarding_tasks').insert([{ ...form, is_done: false } as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['onboarding-tasks'] })
    toast(isEdit ? 'Onboarding task updated' : 'Onboarding task created', 'success')
    navigate('/onboarding-tasks')
  }

  return (
    <FormPage title={isEdit ? 'Edit Onboarding Task' : 'New Onboarding Task'} backTo="/onboarding-tasks" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Create Task'} onSave={handleSave}>
      <Field label="Staff *">
        <SearchableSelect value={form.staff_id ?? null} onChange={id => set('staff_id', id)} options={staffOptions} placeholder="Select staff…" />
      </Field>
      <Field label="Task *">
        <input type="text" className={inputCls} value={form.task ?? ''} onChange={e => set('task', e.target.value)} placeholder="e.g. Issue laptop and email account" />
      </Field>
      <Field label="Notes">
        <textarea rows={3} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
    </FormPage>
  )
}
