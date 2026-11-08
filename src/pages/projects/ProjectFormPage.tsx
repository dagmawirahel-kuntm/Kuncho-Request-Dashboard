import { useQuery, useQueryClient } from '@tanstack/react-query'
import { dropRecordCache } from '@/lib/queryCache'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { Project, ProjectInsert } from '@/types/database'
import { useStaff, useLocations, useFinanceContacts, useClients, useUserProfiles, useCategories, locationPickerOptions } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'

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
    const { role } = useAuth()
    const { data: staff = [] } = useStaff()
    const { data: locations = [] } = useLocations()
    const { data: financeContacts = [] } = useFinanceContacts()
    const { data: clients = [] } = useClients()
    const clientOptions = useMemo(() => (clients as { id: string; client_name: string }[]).map(c => ({ id: c.id, label: c.client_name })), [clients])
    const staffOptions = useMemo(() => staff.map((s: any) => ({ id: s.id, label: s.employee_name })), [staff])
    const locationOptions = useMemo(() => locationPickerOptions(locations), [locations])
    const financeContactOptions = useMemo(() => financeContacts.map(f => ({ id: f.id, label: f.full_name })), [financeContacts])
    const { data: users = [] } = useUserProfiles()
    const { data: categories = [] } = useCategories()
    const ownerOptions = useMemo(() => (users as { id: string; full_name: string | null; role: string | null }[])
      .map(u => ({ id: u.id, label: u.full_name ?? 'Unnamed', sub: u.role?.replace(/_/g, ' ') })), [users])
    const categoryOptions = useMemo(() => (categories as { id: string; category_name: string }[]).map(c => ({ id: c.id, label: c.category_name })), [categories])
    const closed = !!record?.costing_closed_at
    // Reassignment is admin-only, enforced server-side (147) regardless
    // of this check — this just avoids a confusing "why didn't that save"
    // for anyone else who happens to have projects.UPDATE access.
    const canEditFinanceContact = role === 'admin'

  const [form, setForm] = useState<Partial<ProjectInsert>>(
    record
      ? {
        project_name: record.project_name,
        department: record.department,
        start_date: record.start_date,
        active_for_year: record.active_for_year,
        project_manager_id: record.project_manager_id,
        finance_contact_id: record.finance_contact_id,
        location_id: record.location_id,
        client_id: record.client_id,
        is_internal: record.is_internal,
        own_work: record.own_work ?? false,
        bucket_owner_id: record.bucket_owner_id ?? null,
        bucket_monthly_budget: record.bucket_monthly_budget ?? null,
        bucket_category_id: record.bucket_category_id ?? null,
      }
      : { active_for_year: true, is_internal: false, own_work: false }
  )
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
  
    

    function set(key: keyof ProjectInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    if (!form.project_name?.trim()) { setError('Project name is required'); return }
    // A job may have no client yet (503): it is flagged until one is set.
    // It leaves the active lists only by closing (502), so the form leaves
    // Active for year alone unless it is a cost bucket.
    const { active_for_year, bucket_owner_id, bucket_monthly_budget, bucket_category_id, ...job } = form
    const payload = form.is_internal
      ? { ...form, client_id: null, own_work: false }
      : { ...job, client_id: form.own_work ? null : job.client_id ?? null, ...(isEdit ? {} : { active_for_year: active_for_year ?? true }) }
    void bucket_owner_id; void bucket_monthly_budget; void bucket_category_id
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('projects').update(payload as any).eq('id', id!) : supabase.from('projects').insert([payload as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    dropRecordCache(qc, 'project')
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
      <Field label="What is it?">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="What is it?">
          {([
            [false, 'Job', 'Work with a start and an end. It closes from its Closing tab.'],
            [true, 'Cost bucket', 'Running costs: workshop, taxes, salaries, office. It never closes.'],
          ] as const).map(([bucket, title, sub]) => (
            <button key={title} type="button" role="radio" aria-checked={!!form.is_internal === bucket} disabled={closed}
              onClick={() => set('is_internal', bucket)}
              className={`rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-60 ${!!form.is_internal === bucket ? 'border-brand bg-brand/5 ring-1 ring-brand' : 'hover:border-slate-400 dark:border-slate-600'}`}>
              <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">{sub}</span>
            </button>
          ))}
        </div>
      </Field>
      {form.is_internal ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Owner">
              <SearchableSelect value={form.bucket_owner_id ?? null} onChange={v => set('bucket_owner_id', v)} options={ownerOptions} placeholder="Who looks after it?" />
              <p className="mt-1 text-[11px] text-slate-400">Approves its spending before finance. With no owner, finance approves alone.</p>
            </Field>
            <Field label="Monthly budget (ETB)">
              <input type="number" min={0} className={inputCls} value={form.bucket_monthly_budget ?? ''}
                onChange={e => set('bucket_monthly_budget', e.target.value === '' ? null : Number(e.target.value))} placeholder="e.g. 50000" />
              <p className="mt-1 text-[11px] text-slate-400">Each month's spending is read against it, and against the same month last year.</p>
            </Field>
          </div>
          <Field label="Default category">
            <SearchableSelect value={form.bucket_category_id ?? null} onChange={v => set('bucket_category_id', v)} options={categoryOptions} placeholder="The ledger its spending goes to…" />
            <p className="mt-1 text-[11px] text-slate-400">Given to spending here that has no category of its own. Purchase orders keep their items' category.</p>
          </Field>
        </>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Client">
            <SearchableSelect value={form.own_work ? null : form.client_id ?? null} onChange={id => set('client_id', id)} options={clientOptions}
              placeholder={form.own_work ? 'Our own work — no client' : 'Select client…'} disabled={!!form.own_work} />
            {!form.own_work && !form.client_id && (
              <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">Not known yet? Save it anyway: it's flagged until the client is set, and needs one before it's marked delivered.</p>
            )}
          </Field>
          <label className="flex items-end gap-2 pb-2 cursor-pointer text-sm text-slate-600">
            <input type="checkbox" checked={!!form.own_work} onChange={e => setForm(f => ({ ...f, own_work: e.target.checked, client_id: e.target.checked ? null : f.client_id }))} />
            Kuncho's own work — it will never have a client
          </label>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Department">
          <input type="text" className={inputCls} value={form.department ?? ''} onChange={e => set('department', e.target.value)} />
        </Field>
        {!form.is_internal && (
          <Field label="Start Date">
            <input type="date" className={inputCls} value={form.start_date ?? ''} onChange={e => set('start_date', e.target.value)} />
          </Field>
        )}
      </div>
      {/* A cost bucket has an owner instead of a project manager, site or finance contact. */}
      {!form.is_internal && (
        <>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Project Manager">
            <SearchableSelect value={form.project_manager_id ?? null} onChange={id => set('project_manager_id', id)} options={staffOptions} placeholder="Select staff…" />
          </Field>
          <Field label="Location">
            <SearchableSelect value={form.location_id ?? null} onChange={id => set('location_id', id)} options={locationOptions} placeholder="Select location…" />
          </Field>
        </div>
        <Field label="Finance Contact">
          {canEditFinanceContact ? (
            <SearchableSelect value={form.finance_contact_id ?? null} onChange={id => set('finance_contact_id', id)} options={financeContactOptions} placeholder="Select finance contact…" />
          ) : (
            <p className={`${inputCls} bg-slate-50 text-slate-500 cursor-not-allowed`}>
              {financeContactOptions.find(f => f.id === form.finance_contact_id)?.label ?? 'Unassigned'}
              <span className="ml-1.5 text-xs text-slate-400">(admin only)</span>
            </p>
          )}
          <p className="mt-1 text-[11px] text-slate-400">
            First reviewer on this project's finance sourcing gate — but any finance role holder can still act if unavailable.
          </p>
        </Field>
        </>
      )}
      {form.is_internal ? (
        <label className="flex items-center gap-2 cursor-pointer text-sm">
          <input type="checkbox" checked={!!form.active_for_year} onChange={e => set('active_for_year', e.target.checked)} />
          In use <span className="text-xs text-slate-400">(shows in the pickers; a cost bucket is never closed)</span>
        </label>
      ) : isEdit && record && !record.is_internal ? (
        <ProjectOpenStatus id={id!} record={record} />
      ) : null}
    </FormPage>
  )
}

/** Where a client project stands, instead of the old Active for year box. */
function ProjectOpenStatus({ id, record }: { id: string; record: Project }) {
  const closed = record.costing_closed_at
  const [tone, text] = closed
    ? ['border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800/50 dark:bg-emerald-900/15 dark:text-emerald-200',
       `Closed on ${new Date(closed).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}: off the active lists, and no new cost can go on it. Finance reopens it from the Closing tab.`]
    : record.active_for_year
      ? ['border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200',
         'Active. It comes off the active lists when it closes from its Closing tab.']
      : ['border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/50 dark:bg-amber-900/15 dark:text-amber-200',
         'Switched off the old way, but never closed: costs can still land on it. Close it from its Closing tab, or finance reviews it on the Projects page.']
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${tone}`}>
      <span>{text}</span>
      <Link to={`/projects/${id}?tab=closing`} className="shrink-0 text-xs font-semibold text-brand hover:underline">Open the Closing tab</Link>
    </div>
  )
}
