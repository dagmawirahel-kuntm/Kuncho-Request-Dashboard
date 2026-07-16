import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { HseIncident, HseIncidentInsert } from '@/types/database'
import { useProjects, useLocations } from '@/hooks/useLookups'
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

export default function HseIncidentFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['hse-incident', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('hse_incidents').select('*').eq('id', id).single()
      if (error) throw error
      return data as HseIncident
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Incident' : 'New Incident'} backTo="/hse-incidents" loading onSave={() => {}} />
  }

  return <HseIncidentFormPageBody id={id} record={record} />
}

function HseIncidentFormPageBody({ id, record }: { id?: string; record?: HseIncident }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { toast } = useToast()
  const { user } = useAuth()
  const qc = useQueryClient()
  const { data: projects = [] } = useProjects()
  const { data: locations = [] } = useLocations()
  const projectOptions = useMemo(() => projects.map(p => ({ id: p.id, label: p.project_name })), [projects])
  const locationOptions = useMemo(() => locations.map(l => ({ id: l.id, label: l.location_name, sub: l.location_type ?? undefined })), [locations])

  const [form, setForm] = useState<Partial<HseIncidentInsert>>(
    record
      ? {
        project_id: record.project_id,
        location_id: record.location_id,
        incident_date: record.incident_date,
        incident_type: record.incident_type,
        severity: record.severity,
        description: record.description,
        immediate_action: record.immediate_action,
        status: record.status,
      }
      : {
        incident_date: new Date().toISOString().slice(0, 10),
        incident_type: 'near_miss',
        severity: 'low',
        status: 'open',
      }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(key: keyof HseIncidentInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    if (!form.incident_date) { setError('Incident date is required'); return }
    if (!form.incident_type) { setError('Incident type is required'); return }
    if (!form.severity) { setError('Severity is required'); return }

    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit
      ? supabase.from('hse_incidents').update(form as any).eq('id', id!)
      : supabase.from('hse_incidents').insert([{ ...form, reported_by: user?.id } as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['hse-incidents'] })
    toast(isEdit ? 'Incident updated' : 'Incident reported', 'success')
    navigate('/hse-incidents')
  }

  return (
    <FormPage title={isEdit ? 'Edit Incident' : 'New Incident'} backTo="/hse-incidents" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Report Incident'} onSave={handleSave}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Incident Date *">
          <input type="date" className={inputCls} value={form.incident_date ?? ''} onChange={e => set('incident_date', e.target.value)} />
        </Field>
        <Field label="Incident Type *">
          <select className={inputCls} value={form.incident_type ?? ''} onChange={e => set('incident_type', e.target.value)}>
            <option value="near_miss">Near Miss</option>
            <option value="first_aid">First Aid</option>
            <option value="injury">Injury</option>
            <option value="property_damage">Property Damage</option>
            <option value="environmental">Environmental</option>
            <option value="other">Other</option>
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Severity *">
          <select className={inputCls} value={form.severity ?? ''} onChange={e => set('severity', e.target.value)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </Field>
        {isEdit && (
          <Field label="Status">
            <select className={inputCls} value={form.status ?? 'open'} onChange={e => set('status', e.target.value)}>
              <option value="open">Open</option>
              <option value="investigating">Investigating</option>
              <option value="closed">Closed</option>
            </select>
          </Field>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Project">
          <SearchableSelect value={form.project_id ?? null} onChange={v => set('project_id', v)} options={projectOptions} placeholder="Select project…" />
        </Field>
        <Field label="Location">
          <SearchableSelect value={form.location_id ?? null} onChange={v => set('location_id', v)} options={locationOptions} placeholder="Select location…" />
        </Field>
      </div>
      <Field label="Description">
        <textarea rows={3} className={inputCls} value={form.description ?? ''} onChange={e => set('description', e.target.value)} placeholder="What happened…" />
      </Field>
      <Field label="Immediate Action Taken">
        <textarea rows={3} className={inputCls} value={form.immediate_action ?? ''} onChange={e => set('immediate_action', e.target.value)} placeholder="Actions taken immediately after the incident…" />
      </Field>
    </FormPage>
  )
}
