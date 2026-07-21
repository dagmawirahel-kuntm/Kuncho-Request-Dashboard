import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { FileUpload } from '@/components/shared/FileUpload'
import type { Staff, StaffInsert, UserProfile } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useDepartments } from '@/hooks/useLookups'
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

export default function StaffFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['staff-member', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('staff').select('*').eq('id', id).single()
      if (error) throw error
      return data as Staff
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Staff Member' : 'New Staff Member'} backTo="/staff" loading onSave={() => {}} />
  }

  return <StaffFormPageBody id={id} record={record} />
}

type UserProfileRow = Pick<UserProfile, 'id' | 'full_name' | 'role'>

function StaffFormPageBody({ id, record }: { id?: string; record?: Staff }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { role } = useAuth()
  const canAssignDepartment = role === 'admin' || role === 'hr_officer'

  const { data: departments = [] } = useDepartments()
  const departmentNameById = useMemo(() => new Map(departments.map((d: any) => [d.id, d.name])), [departments])

  const { data: userProfiles = [] } = useQuery({
    queryKey: ['user-profiles-lookup'],
    queryFn: async () => {
      const { data } = await supabase.from('user_profiles').select('id, full_name, role').order('full_name')
      return (data ?? []) as UserProfileRow[]
    },
  })

  const [form, setForm] = useState<Partial<StaffInsert>>(
    record
      ? {
          employee_name: record.employee_name,
          staff_type: record.staff_type,
          employment_type: record.employment_type,
          role: record.role,
          management_level: record.management_level,
          monthly_salary: record.monthly_salary ?? undefined,
          day_rate: record.day_rate ?? undefined,
          payment_frequency: record.payment_frequency,
          bank_account: record.bank_account,
          starting_date: record.starting_date,
          termination_date: record.termination_date,
          phone_number: record.phone_number,
          email: record.email,
          national_id: record.national_id,
          experience: record.experience,
          status: record.status ?? 'active',
          photo_url: record.photo_url,
          id_document_url: record.id_document_url,
          id_document_name: record.id_document_name,
          user_id: record.user_id,
          department_id: record.department_id,
          sub_team: record.sub_team,
        }
      : { status: 'active' }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(key: keyof StaffInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    if (!form.employee_name?.trim()) { setError('Employee name is required'); return }
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('staff').update(form as any).eq('id', id!) : supabase.from('staff').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['staff'] })
    qc.invalidateQueries({ queryKey: ['staff-lookup'] })
    toast(isEdit ? 'Staff member updated' : 'Staff member added', 'success')
    navigate('/staff')
  }

  return (
    <FormPage title={isEdit ? 'Edit Staff Member' : 'New Staff Member'} backTo="/staff" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Add Staff'} onSave={handleSave}>
      <Field label="Employee Name *">
        <input type="text" className={inputCls} value={form.employee_name ?? ''} onChange={e => set('employee_name', e.target.value)} />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Department">
          <select className={inputCls} value={form.staff_type ?? ''} onChange={e => set('staff_type', e.target.value || null)}>
            <option value="">— Select —</option>
            <option>Office</option>
            <option>Work Shop</option>
            <option>Field</option>
            <option>Leather Workshop</option>
            <option>Site</option>
          </select>
        </Field>
        <Field label="Employment Type">
          <select className={inputCls} value={form.employment_type ?? ''} onChange={e => set('employment_type', e.target.value || null)}>
            <option value="">— Select —</option>
            <option>Full Time</option>
            <option>Part Time</option>
            <option>Contract</option>
            <option>Freelance</option>
          </select>
        </Field>
      </div>

      <Field label="Org. Department">
        <select
          className={inputCls}
          value={form.department_id ?? ''}
          disabled={!canAssignDepartment}
          onChange={e => set('department_id', e.target.value || null)}
        >
          <option value="">Unassigned</option>
          {departments.map((d: { id: string; name: string }) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        {!canAssignDepartment && (
          <p className="mt-1 text-xs text-slate-400">Only Admin or HR can set this — leave as Unassigned.</p>
        )}
      </Field>

      {form.department_id && departmentNameById.get(form.department_id) === 'Operations/Construction' && (
        <Field label="Sub-Team">
          <input
            type="text" list="sub-team-list" className={inputCls}
            value={form.sub_team ?? ''} onChange={e => set('sub_team', e.target.value || null)}
            placeholder="e.g. Workshop — Carpentry"
          />
          <datalist id="sub-team-list">
            <option value="Workshop — Carpentry" />
            <option value="Workshop — CNC" />
            <option value="Workshop — Leather" />
            <option value="Site" />
          </datalist>
          <p className="mt-1 text-xs text-slate-400">
            For non-FF&E Operations/Construction staff (drivers, security, general labor, site supervisors).
            {id && <> FF&E fabrication staff use the <Link to={`/staff/${id}/ffe-skills`} className="text-brand hover:underline">FF&E Skills profile</Link> below instead.</>}
          </p>
        </Field>
      )}

      {id && form.department_id && departmentNameById.get(form.department_id) === 'Operations/Construction' && (
        <Field label="FF&E Skills">
          <Link
            to={`/staff/${id}/ffe-skills`}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            Open FF&E competency profile →
          </Link>
          <p className="mt-1 text-xs text-slate-400">For the five FF&E fabrication roles only — check off responsibilities there, not here; the level is computed automatically.</p>
        </Field>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Workplace">
          <input type="text" className={inputCls} value={form.role ?? ''} onChange={e => set('role', e.target.value)} placeholder="e.g. Front Desk, Site A, Carpentry Bench 3" />
        </Field>
        <Field label="Management Level">
          <select className={inputCls} value={form.management_level ?? ''} onChange={e => set('management_level', e.target.value || null)}>
            <option value="">— Select —</option>
            <option value="upper">Upper Management</option>
            <option value="medium">Medium Management</option>
            <option value="low">Low Level</option>
          </select>
        </Field>
      </div>

      <Field label="Status">
        <select className={inputCls} value={form.status ?? 'active'} onChange={e => set('status', e.target.value)}>
          <option value="active">Active</option>
          <option value="on_leave">On Leave</option>
          <option value="terminated">Terminated</option>
        </select>
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Monthly Salary (ETB)">
          <input type="number" step="0.01" className={inputCls} value={form.monthly_salary ?? ''} onChange={e => set('monthly_salary', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
        <Field label="Day Rate (ETB)">
          <input type="number" step="0.01" className={inputCls} value={form.day_rate ?? ''} onChange={e => set('day_rate', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
      </div>

      <Field label="Payment Frequency">
        <input type="text" className={inputCls} value={form.payment_frequency ?? ''} onChange={e => set('payment_frequency', e.target.value)} placeholder="e.g. Monthly, Bi-weekly" />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Phone Number">
          <input type="tel" className={inputCls} value={form.phone_number ?? ''} onChange={e => set('phone_number', e.target.value)} />
        </Field>
        <Field label="Email">
          <input type="email" className={inputCls} value={form.email ?? ''} onChange={e => set('email', e.target.value)} placeholder="staff@company.com" />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="National ID">
          <input type="text" className={inputCls} value={form.national_id ?? ''} onChange={e => set('national_id', e.target.value)} />
        </Field>
        <Field label="Bank Account">
          <input type="text" className={inputCls} value={form.bank_account ?? ''} onChange={e => set('bank_account', e.target.value)} />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Starting Date">
          <input type="date" className={inputCls} value={form.starting_date ?? ''} onChange={e => set('starting_date', e.target.value)} />
        </Field>
        <Field label="Termination Date">
          <input type="date" className={inputCls} value={form.termination_date ?? ''} onChange={e => set('termination_date', e.target.value)} />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Profile Photo">
          {form.photo_url ? (
            <div className="flex items-center gap-3">
              <img src={form.photo_url} alt="Profile" className="h-14 w-14 rounded-xl object-cover border" />
              <button type="button" onClick={() => set('photo_url', null)}
                className="text-xs text-red-500 hover:underline">Remove</button>
            </div>
          ) : (
            <FileUpload
              folder="staff-photos"
              accept="image/*"
              label="Upload Photo"
              fileUrl={null}
              fileName={null}
              onUpload={url => set('photo_url', url)}
              onClear={() => set('photo_url', null)}
            />
          )}
        </Field>
        <Field label="ID Document (national ID / passport)">
          <FileUpload
            folder="staff-ids"
            label="Upload ID"
            fileUrl={form.id_document_url ?? null}
            fileName={form.id_document_name ?? null}
            onUpload={(url, name) => setForm(f => ({ ...f, id_document_url: url, id_document_name: name }))}
            onClear={() => setForm(f => ({ ...f, id_document_url: null, id_document_name: null }))}
          />
        </Field>
      </div>

      <Field label="Linked User Account">
        <select className={inputCls} value={form.user_id ?? ''} onChange={e => set('user_id', e.target.value || null)}>
          <option value="">— Not linked —</option>
          {userProfiles.map(u => (
            <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>
          ))}
        </select>
      </Field>

      <Field label="Experience / Notes">
        <textarea rows={3} className={inputCls} value={form.experience ?? ''} onChange={e => set('experience', e.target.value)} />
      </Field>
    </FormPage>
  )
}

