import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { SubcontractorEngagement, SubcontractorEngagementInsert, SubcontractorEngagementStatus } from '@/types/database'
import { useVendors, useProjects } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'
const STATUS_OPTIONS: SubcontractorEngagementStatus[] = ['drafting', 'agreed', 'in_progress', 'completed', 'terminated']

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

export default function SubcontractFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['subcontractor-engagement', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('subcontractor_engagements').select('*').eq('id', id).single()
      if (error) throw error
      return data as SubcontractorEngagement
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Engagement' : 'New Engagement'} backTo="/subcontracts" loading onSave={() => {}} />
  }

  return <SubcontractFormPageBody id={id} record={record} />
}

function SubcontractFormPageBody({ id, record }: { id?: string; record?: SubcontractorEngagement }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: vendors = [] } = useVendors()
  const { data: projects = [] } = useProjects()
  const vendorOptions = useMemo(() => vendors.map((v: any) => ({ id: v.id, label: v.vendor_name })), [vendors])
  const projectOptions = useMemo(() => projects.map((p: any) => ({ id: p.id, label: p.project_name, sub: p.department ?? undefined })), [projects])

  const [form, setForm] = useState<Partial<SubcontractorEngagementInsert>>(
    record
      ? {
        vendor_id: record.vendor_id,
        project_id: record.project_id,
        scope_of_work: record.scope_of_work,
        agreed_amount: record.agreed_amount,
        start_date: record.start_date,
        target_completion_date: record.target_completion_date,
        percent_complete: record.percent_complete,
        status: record.status,
        notes: record.notes,
      }
      : { status: 'drafting', percent_complete: 0 }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(key: keyof SubcontractorEngagementInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError('')
    if (!form.vendor_id) { setError('Vendor is required'); return }
    if (!form.project_id) { setError('Project is required'); return }
    if (form.agreed_amount === undefined || form.agreed_amount === null || Number.isNaN(form.agreed_amount)) { setError('Agreed amount is required'); return }
    setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit
      ? supabase.from('subcontractor_engagements').update(form as any).eq('id', id!)
      : supabase.from('subcontractor_engagements').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['subcontractor-engagements'] })
    if (isEdit) qc.invalidateQueries({ queryKey: ['subcontractor-engagement', id] })
    toast(isEdit ? 'Engagement updated' : 'Engagement created', 'success')
    navigate('/subcontracts')
  }

  return (
    <FormPage
      title={isEdit ? 'Edit Engagement' : 'New Engagement'}
      backTo="/subcontracts"
      error={error}
      saving={saving}
      saveLabel={isEdit ? 'Save Changes' : 'Create Engagement'}
      onSave={handleSave}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Vendor (Subcontractor) *">
          <SearchableSelect value={form.vendor_id ?? null} onChange={id => set('vendor_id', id)} options={vendorOptions} placeholder="Select vendor…" />
        </Field>
        <Field label="Project *">
          <SearchableSelect value={form.project_id ?? null} onChange={id => set('project_id', id)} options={projectOptions} placeholder="Select project…" />
        </Field>
      </div>
      <Field label="Scope of Work">
        <textarea rows={3} className={inputCls} value={form.scope_of_work ?? ''} onChange={e => set('scope_of_work', e.target.value)} placeholder="Describe the work being subcontracted…" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Agreed Amount (ETB) *">
          <input type="number" step="0.01" className={inputCls} value={form.agreed_amount ?? ''} onChange={e => set('agreed_amount', e.target.value ? parseFloat(e.target.value) : undefined)} />
        </Field>
        <Field label="Status">
          <select className={inputCls} value={form.status ?? 'drafting'} onChange={e => set('status', e.target.value as SubcontractorEngagementStatus)}>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start Date">
          <input type="date" className={inputCls} value={form.start_date ?? ''} onChange={e => set('start_date', e.target.value || null)} />
        </Field>
        <Field label="Target Completion Date">
          <input type="date" className={inputCls} value={form.target_completion_date ?? ''} onChange={e => set('target_completion_date', e.target.value || null)} />
        </Field>
      </div>
      {isEdit && (
        <Field label="Percent Complete">
          <input
            type="number"
            min={0}
            max={100}
            step="1"
            className={inputCls}
            value={form.percent_complete ?? 0}
            onChange={e => set('percent_complete', e.target.value ? Math.max(0, Math.min(100, parseFloat(e.target.value))) : 0)}
          />
        </Field>
      )}
      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
    </FormPage>
  )
}
