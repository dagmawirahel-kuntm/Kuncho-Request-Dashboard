import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { StarRating } from '@/components/shared/StarRating'
import type { WorkOrder, WorkOrderInsert, WorkOrderType, FfeJobDescription, FfeKeyResponsibility, StaffFfeCurrentScoreRow } from '@/types/database'
import { useProjects, useStaffDirectory } from '@/hooks/useLookups'
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

export default function WorkOrderFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['work-order', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('work_orders').select('*').eq('id', id).single()
      if (error) throw error
      return data as WorkOrder
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Work Order' : 'New Work Order'} backTo="/work-orders" loading onSave={() => {}} />
  }

  return <WorkOrderFormPageBody id={id} record={record} />
}

function WorkOrderFormPageBody({ id, record }: { id?: string; record?: WorkOrder }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { toast } = useToast()
  const { user } = useAuth()
  const qc = useQueryClient()
  const { data: projects = [] } = useProjects()
  const { data: staff = [] } = useStaffDirectory()
  const projectOptions = useMemo(() => projects.map((p: any) => ({ id: p.id, label: p.project_name })), [projects])
  const staffOptions = useMemo(() => staff.map((s: any) => ({ id: s.id, label: s.employee_name, sub: s.role ?? undefined })), [staff])
  const staffNameById = useMemo(() => new Map(staff.map((s: any) => [s.id, s.employee_name])), [staff])

  const [form, setForm] = useState<Partial<WorkOrderInsert>>(
    record
      ? {
        project_id: record.project_id,
        work_type: record.work_type,
        scope_of_work: record.scope_of_work,
        assigned_lead_staff_id: record.assigned_lead_staff_id,
        status: record.status,
        target_completion_date: record.target_completion_date,
      }
      : { work_type: 'workshop', status: 'requested' }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(key: keyof WorkOrderInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  // Skill-matched staffing (§3): for a workshop work order, a lead
  // picks the SPECIFIC responsibility the job is really about (e.g.
  // "Welding & Joining" for a mirror-polish weld job, not just "Metal
  // Fabricator" in general) and candidates are sorted by their current
  // score for that exact responsibility — a suggestion, never an
  // enforced restriction.
  const [relevantResponsibilityId, setRelevantResponsibilityId] = useState<string | null>(null)

  const { data: roles = [] } = useQuery({
    queryKey: ['ffe-job-descriptions-active'],
    queryFn: async () => {
      const { data, error } = await supabase.from('ffe_job_descriptions').select('*').eq('active', true).order('sort_order')
      if (error) throw error
      return data as FfeJobDescription[]
    },
    enabled: form.work_type === 'workshop',
  })
  const { data: responsibilities = [] } = useQuery({
    queryKey: ['ffe-key-responsibilities-active'],
    queryFn: async () => {
      const { data, error } = await supabase.from('ffe_key_responsibilities').select('*').eq('active', true).order('sort_order')
      if (error) throw error
      return data as FfeKeyResponsibility[]
    },
    enabled: form.work_type === 'workshop',
  })
  const roleNameById = useMemo(() => new Map(roles.map(r => [r.id, r.role_name])), [roles])
  const responsibilityOptions = useMemo(
    () => responsibilities.map(r => ({ id: r.id, label: `${roleNameById.get(r.job_description_id) ?? ''} — ${r.responsibility_title}` })),
    [responsibilities, roleNameById]
  )

  const { data: currentScores = [] } = useQuery({
    queryKey: ['staff-ffe-current-scores', relevantResponsibilityId],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_staff_ffe_current_scores').select('*').eq('responsibility_id', relevantResponsibilityId!)
      if (error) throw error
      return data as StaffFfeCurrentScoreRow[]
    },
    enabled: form.work_type === 'workshop' && !!relevantResponsibilityId,
  })
  const sortedCandidates = useMemo(() => [...currentScores].sort((a, b) => b.score - a.score), [currentScores])

  async function handleSave() {
    setError('')
    if (!form.project_id) { setError('Project is required'); return }
    if (!form.scope_of_work?.trim()) { setError('Scope of work is required'); return }
    setSaving(true)
    const payload = isEdit ? form : { ...form, requested_by: user?.id ?? null }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('work_orders').update(payload as any).eq('id', id!) : supabase.from('work_orders').insert([payload as any]).select('id').single()
    const { data, error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['work-orders'] })
    toast(isEdit ? 'Work order updated' : 'Work order created', 'success')
    navigate(isEdit ? `/work-orders/${id}` : `/work-orders/${(data as { id: string })?.id}`)
  }

  return (
    <FormPage title={isEdit ? 'Edit Work Order' : 'New Work Order'} backTo={isEdit ? `/work-orders/${id}` : '/work-orders'} error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Create Work Order'} onSave={handleSave}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Project *">
          <SearchableSelect value={form.project_id ?? null} onChange={id => set('project_id', id)} options={projectOptions} placeholder="Select project…" />
        </Field>
        <Field label="Type">
          <select className={inputCls} value={form.work_type ?? 'workshop'} onChange={e => set('work_type', e.target.value as WorkOrderType)}>
            <option value="workshop">Workshop (fabrication)</option>
            <option value="site">Site (in-house, no subcontract)</option>
          </select>
        </Field>
      </div>
      <Field label="Scope of Work *">
        <textarea rows={3} className={inputCls} value={form.scope_of_work ?? ''} onChange={e => set('scope_of_work', e.target.value)} placeholder="What needs to be built or done…" />
      </Field>
      <Field label={form.work_type === 'workshop' ? 'Assigned Lead (skill-matched suggestions below)' : 'Assigned Lead'}>
        <SearchableSelect value={form.assigned_lead_staff_id ?? null} onChange={id => set('assigned_lead_staff_id', id)} options={staffOptions} placeholder="Select staff…" />
      </Field>

      {form.work_type === 'workshop' && (
        <div className="rounded-lg border dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-3 space-y-2">
          <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">Skill-matched staffing (suggestion only — doesn't block your choice)</p>
          <SearchableSelect value={relevantResponsibilityId} onChange={setRelevantResponsibilityId} options={responsibilityOptions} placeholder="Which responsibility is this job really about?" />
          {relevantResponsibilityId && (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {sortedCandidates.length === 0 ? (
                <p className="text-xs text-slate-400 px-2 py-1.5">No one has been rated on this responsibility yet.</p>
              ) : sortedCandidates.map(c => (
                <button
                  type="button"
                  key={c.staff_id}
                  onClick={() => set('assigned_lead_staff_id', c.staff_id)}
                  className="flex w-full items-center justify-between rounded px-2 py-1.5 text-xs hover:bg-white dark:hover:bg-slate-800 text-left"
                >
                  <span className="text-slate-700 dark:text-slate-200">{staffNameById.get(c.staff_id) ?? '—'}</span>
                  <StarRating score={c.score} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Status">
          <select className={inputCls} value={form.status ?? 'requested'} onChange={e => set('status', e.target.value)}>
            <option value="requested">Requested</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </Field>
        <Field label="Target Completion Date">
          <input type="date" className={inputCls} value={form.target_completion_date ?? ''} onChange={e => set('target_completion_date', e.target.value || null)} />
        </Field>
      </div>

      {isEdit && (
        <p className="text-xs text-slate-400">Link labor and materials, and see the computed cost, from the work order's detail page after saving.</p>
      )}
    </FormPage>
  )
}
