import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { DesignPackage, DesignPackageInsert, DesignPackageStatus } from '@/types/database'
import { useProjects } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const required = label.endsWith('*')
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
        {required ? label.slice(0, -1).trim() : label}
        {required && <span className="text-brand"> *</span>}
      </label>
      {children}
    </div>
  )
}

const STATUS_OPTIONS: DesignPackageStatus[] = ['brief', 'concept', 'detailed', 'client_review', 'signed_off']

export default function DesignPackageFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['design-package', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('design_packages').select('*').eq('id', id).single()
      if (error) throw error
      return data as DesignPackage
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title="Edit Design Package" backTo="/design" loading onSave={() => {}} />
  }

  return <DesignPackageFormPageBody id={id} record={record} />
}

function DesignPackageFormPageBody({ id, record }: { id?: string; record?: DesignPackage }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: projects = [] } = useProjects()
  const projectOptions = useMemo(() => projects.map((p: any) => ({ id: p.id, label: p.project_name })), [projects])

  const [form, setForm] = useState<Partial<DesignPackageInsert>>(
    record
      ? {
        project_id: record.project_id,
        title: record.title,
        brief: record.brief,
        status: record.status,
        notes: record.notes,
      }
      : { status: 'brief' }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(key: keyof DesignPackageInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    if (!form.project_id) { setError('Select a project'); return }
    if (!form.title?.trim()) { setError('Title is required'); return }
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('design_packages').update(form as any).eq('id', id!) : supabase.from('design_packages').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['design-packages'] })
    if (isEdit) qc.invalidateQueries({ queryKey: ['design-package', id] })
    toast(isEdit ? 'Design package updated' : 'Design package created', 'success')
    navigate('/design')
  }

  return (
    <FormPage title={isEdit ? 'Edit Design Package' : 'New Design Package'} backTo="/design" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Create Package'} onSave={handleSave}>
      <Field label="Project *">
        <SearchableSelect value={form.project_id ?? null} onChange={id => set('project_id', id)} options={projectOptions} placeholder="Select project…" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Title *">
          <input type="text" className={inputCls} value={form.title ?? ''} onChange={e => set('title', e.target.value)} />
        </Field>
        <Field label="Status">
          <select className={inputCls} value={form.status ?? 'brief'} onChange={e => set('status', e.target.value as DesignPackageStatus)}>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Brief">
        <textarea rows={3} className={inputCls} value={form.brief ?? ''} onChange={e => set('brief', e.target.value)} placeholder="Design brief / scope summary…" />
      </Field>
      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
    </FormPage>
  )
}
