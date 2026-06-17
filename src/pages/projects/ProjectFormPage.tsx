import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import type { Project, ProjectInsert } from '@/types/database'
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

export default function ProjectFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('*').eq('id', id).single()
      if (error) throw error
      return data as Project
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Project' : 'New Project'} backTo="/projects" loading onSave={() => {}} />
  }

  return <ProjectFormPageBody id={id} record={record} />
}

function ProjectFormPageBody({ id, record }: { id?: string; record?: Project }) {
  const isEdit = !!id
    const navigate = useNavigate()
    const { toast } = useToast()
    const qc = useQueryClient()
  
    

  const [form, setForm] = useState<Partial<ProjectInsert>>(
    record
      ? {
        project_name: record.project_name,
        department: record.department,
        start_date: record.start_date,
        active_for_year: record.active_for_year,
      }
      : { active_for_year: true }
  )
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
  
    

    function set(key: keyof ProjectInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    if (!form.project_name?.trim()) { setError('Project name is required'); return }
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('projects').update(form as any).eq('id', id!) : supabase.from('projects').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['projects'] })
    qc.invalidateQueries({ queryKey: ['projects-lookup'] })
    toast(isEdit ? 'Project updated' : 'Project created', 'success')
    navigate('/projects')
  }

  return (
    <FormPage title={isEdit ? 'Edit Project' : 'New Project'} backTo="/projects" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Add Project'} onSave={handleSave}>
      <Field label="Project Name *">
        <input type="text" className={inputCls} value={form.project_name ?? ''} onChange={e => set('project_name', e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Department">
          <input type="text" className={inputCls} value={form.department ?? ''} onChange={e => set('department', e.target.value)} />
        </Field>
        <Field label="Start Date">
          <input type="date" className={inputCls} value={form.start_date ?? ''} onChange={e => set('start_date', e.target.value)} />
        </Field>
      </div>
      <label className="flex items-center gap-2 cursor-pointer text-sm">
        <input type="checkbox" checked={!!form.active_for_year} onChange={e => set('active_for_year', e.target.checked)} />
        Active for Year
      </label>
    </FormPage>
  )
}

