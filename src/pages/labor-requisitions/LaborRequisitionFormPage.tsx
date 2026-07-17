import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { LaborRequisition, LaborRequisitionInsert } from '@/types/database'
import { useProjects } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100'
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

export default function LaborRequisitionFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['labor-requisition', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('labor_requisitions').select('*').eq('id', id).single()
      if (error) throw error
      return data as LaborRequisition
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Labor Requisition' : 'New Labor Requisition'} backTo="/labor-requisitions" loading onSave={() => {}} />
  }

  return <LaborRequisitionFormPageBody id={id} record={record} />
}

function LaborRequisitionFormPageBody({ id, record }: { id?: string; record?: LaborRequisition }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { toast } = useToast()
  const { user } = useAuth()
  const qc = useQueryClient()
  const { data: projects = [] } = useProjects()
  const projectOptions = useMemo(() => projects.map((p: any) => ({ id: p.id, label: p.project_name })), [projects])

  const [form, setForm] = useState<Partial<LaborRequisitionInsert>>(
    record
      ? {
        project_id: record.project_id,
        role_needed: record.role_needed,
        headcount: record.headcount,
        is_casual_or_new: record.is_casual_or_new,
        start_date: record.start_date,
        end_date: record.end_date,
        estimated_day_rate: record.estimated_day_rate,
        estimated_days: record.estimated_days,
        requested_by: record.requested_by,
        notes: record.notes,
      }
      : { is_casual_or_new: true, headcount: 1 }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(key: keyof LaborRequisitionInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError(''); setSaving(true)
    const payload = isEdit ? form : { ...form, requested_by: user?.id ?? null }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('labor_requisitions').update(payload as any).eq('id', id!) : supabase.from('labor_requisitions').insert([payload as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['labor-requisitions'] })
    toast(isEdit ? 'Labor requisition updated' : 'Labor requisition created', 'success')
    navigate('/labor-requisitions')
  }

  return (
    <FormPage title={isEdit ? 'Edit Labor Requisition' : 'New Labor Requisition'} backTo="/labor-requisitions" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Submit Requisition'} onSave={handleSave}>
      <Field label="Project *">
        <SearchableSelect value={form.project_id ?? null} onChange={id => set('project_id', id)} options={projectOptions} placeholder="Select project…" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Role Needed *">
          <input type="text" className={inputCls} value={form.role_needed ?? ''} onChange={e => set('role_needed', e.target.value)} placeholder="e.g. Site Electrician" />
        </Field>
        <Field label="Headcount *">
          <input type="number" min={1} className={inputCls} value={form.headcount ?? ''} onChange={e => set('headcount', e.target.value ? parseInt(e.target.value, 10) : undefined)} />
        </Field>
      </div>
      <div>
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input type="checkbox" checked={form.is_casual_or_new ?? true} onChange={e => set('is_casual_or_new', e.target.checked)} className="rounded border-slate-300 text-brand focus:ring-brand dark:border-slate-600" />
          Casual / new hire (not on the existing roster)
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start Date *">
          <input type="date" className={inputCls} value={form.start_date ?? ''} onChange={e => set('start_date', e.target.value)} />
        </Field>
        <Field label="End Date">
          <input type="date" className={inputCls} value={form.end_date ?? ''} onChange={e => set('end_date', e.target.value || null)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Estimated Day Rate (ETB) *">
          <input type="number" step="0.01" min={0} className={inputCls} value={form.estimated_day_rate ?? ''} onChange={e => set('estimated_day_rate', e.target.value ? parseFloat(e.target.value) : undefined)} />
        </Field>
        <Field label="Estimated Days">
          <input type="number" min={0} className={inputCls} value={form.estimated_days ?? ''} onChange={e => set('estimated_days', e.target.value ? parseInt(e.target.value, 10) : null)} />
        </Field>
      </div>
      <p className="text-xs text-slate-400 dark:text-slate-500">
        Estimated total cost is calculated automatically (headcount × day rate × estimated days) once saved — it isn't set here.
      </p>
      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
    </FormPage>
  )
}
