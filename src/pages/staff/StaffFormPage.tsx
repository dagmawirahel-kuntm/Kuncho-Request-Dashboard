import { useQuery, useQueryClient } from '@tanstack/react-query'
import { dropRecordCache } from '@/lib/queryCache'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { FileUpload } from '@/components/shared/FileUpload'
import type { Staff, StaffInsert, UserProfile } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useDepartments } from '@/hooks/useLookups'
import { useAuth } from '@/contexts/AuthContext'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { AlertTriangle } from 'lucide-react'

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

type UserProfileRow = Pick<UserProfile, 'id' | 'full_name' | 'role' | 'email'>

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
      const { data } = await supabase.from('user_profiles').select('id, full_name, role, email').order('full_name')
      return (data ?? []) as UserProfileRow[]
    },
  })


  // Small typed helper so we can carry the tier-2 fields alongside the
  // existing StaffInsert shape without patching the generated types.
  type StaffFormState = Partial<StaffInsert> & {
    trade_tag?: string | null
    codename_amharic?: string | null
    codename_english?: string | null
    job_description_id?: string | null
  }

  const { data: jobDescriptions = [] } = useQuery({
    queryKey: ['job-descriptions-picker'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('job_descriptions')
        .select('id, role_name, department_id').eq('active', true).order('role_name')
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return data as any[]
    },
  })

  const { data: tradeRoster = [] } = useQuery({
    queryKey: ['tier2-trade-roster'],
    staleTime: 600_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('tier2_trade_roster')
        .select('trade_tag, codename_amharic, codename_english, icon_emoji, sort_order')
        .order('sort_order')
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []) as any[]
    },
  })

  const [form, setForm] = useState<StaffFormState>(
    record
      ? {
          employee_name: record.employee_name,
          staff_type: record.staff_type,
          employment_type: record.employment_type,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          job_description_id: (record as any).job_description_id ?? null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          trade_tag: (record as any).trade_tag ?? null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          codename_amharic: (record as any).codename_amharic ?? null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          codename_english: (record as any).codename_english ?? null,
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

  // Accepts the extra tier-2 keys carried on StaffFormState in addition to
  // StaffInsert fields.
  function set(key: keyof StaffFormState | string, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  const userProfileOptions = useMemo(
    () => userProfiles.map(u => ({ id: u.id, label: u.full_name, sub: u.email ? `${u.email} · ${u.role}` : u.role })),
    [userProfiles]
  )
  const selectedLogin = userProfiles.find(u => u.id === form.user_id)
  const emailMismatch = !!selectedLogin && !!form.email && !!selectedLogin.email
    && form.email.trim().toLowerCase() !== selectedLogin.email.trim().toLowerCase()

  // "user_profiles is the person, staff is a branch" — other staff rows already
  // linked to whichever login is currently selected, so linking here doesn't
  // silently create a wrong pairing (that's exactly how a login once ended up
  // attached to the wrong staff record: matched by name alone, never checked
  // against email).
  const { data: otherBranches = [] } = useQuery({
    queryKey: ['staff-other-branches', form.user_id, id],
    queryFn: async () => {
      const q = supabase.from('staff').select('id, employee_name, role').eq('user_id', form.user_id!)
      const { data, error } = await (id ? q.neq('id', id) : q)
      if (error) throw error
      return data as { id: string; employee_name: string; role: string | null }[]
    },
    enabled: !!form.user_id,
  })

  async function handleSave() {
    if (!form.employee_name?.trim()) { setError('Employee name is required'); return }
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('staff').update(form as any).eq('id', id!) : supabase.from('staff').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    dropRecordCache(qc, 'staff-member')
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
            <option value="tier_2_casual">Tier 2 casual worker</option>
          </select>
        </Field>
      </div>

      <Field label="Job Description">
        <select className={inputCls} value={form.job_description_id ?? ''} onChange={e => set('job_description_id', e.target.value || null)}>
          <option value="">— Not yet assigned —</option>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {(jobDescriptions as any[]).map(jd => (
            <option key={jd.id} value={jd.id}>{jd.role_name}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-400">Sets which role's responsibilities they're rated against on the Competency tab.</p>
      </Field>

      {form.employment_type === 'tier_2_casual' && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 dark:bg-amber-900/10 dark:border-amber-800 p-3 space-y-3">
          <p className="text-xs text-amber-800 dark:text-amber-300">
            Tier 2 workers get a card on <span className="font-mono">/hr/casual-workers</span>. Pick a trade and codenames auto-fill from the roster (you can override them below).
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Trade *">
              <select
                className={inputCls}
                value={form.trade_tag ?? ''}
                onChange={e => {
                  const tag = e.target.value || null
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const match = (tradeRoster as any[]).find((r: any) => r.trade_tag === tag)
                  setForm(f => ({
                    ...f,
                    trade_tag: tag,
                    // Overwrite codenames when the user picks a new trade — the
                    // BEFORE-insert trigger only fills nulls, so on trade change
                    // the user expects the codenames to follow. Manual edits
                    // afterward are preserved.
                    codename_amharic: match?.codename_amharic ?? f.codename_amharic ?? null,
                    codename_english: match?.codename_english ?? f.codename_english ?? null,
                  }))
                }}
              >
                <option value="">— Select trade —</option>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {(tradeRoster as any[]).map((r: any) => (
                  <option key={r.trade_tag} value={r.trade_tag}>{r.icon_emoji} {r.codename_english}</option>
                ))}
              </select>
            </Field>
            <Field label="Codename (Amharic)">
              <input className={inputCls} value={form.codename_amharic ?? ''} onChange={e => set('codename_amharic', e.target.value || null)} placeholder="የመሠረት ድንጋይ" />
            </Field>
            <Field label="Codename (English)">
              <input className={inputCls} value={form.codename_english ?? ''} onChange={e => set('codename_english', e.target.value || null)} placeholder="The Cornerstone" />
            </Field>
          </div>
        </div>
      )}

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
        <Field label="Workplace / Job Title">
          <input
            type="text" list="workplace-suggestions" className={inputCls}
            value={form.role ?? ''} onChange={e => set('role', e.target.value)}
            placeholder="e.g. site_foreman, Carpenter, Driver, Designer"
          />
          <datalist id="workplace-suggestions">
            {/* system role — grants site-foreman powers when combined with an
                active project assignment. Kept lowercase/underscored as-is so
                the RLS helper matches; the datalist just makes it discoverable. */}
            <option value="site_foreman">site_foreman — residential site day-to-day (unlocks Site Ops)</option>
            <option value="Project Manager" />
            <option value="Site Foreman" />
            <option value="Foreman" />
            <option value="Finance" />
            <option value="Designer" />
            <option value="Driver" />
            <option value="Purchaser" />
            <option value="Carpenter" />
            <option value="Ass. Carpenter" />
            <option value="Painter" />
            <option value="Labor" />
            <option value="CNC operator" />
            <option value="Workshop Manager" />
            <option value="Upper Level Managment" />
          </datalist>
          <p className="mt-1 text-xs text-slate-400">
            Type <code className="rounded bg-slate-100 dark:bg-slate-700 px-1 text-[10px]">site_foreman</code> to give this person residential-site powers.
            Then add an active <span className="font-medium">Role Assignment</span> for each project they run.
          </p>
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

      <Field label="Linked Login (person)">
        <SearchableSelect value={form.user_id ?? null} onChange={v => set('user_id', v)} options={userProfileOptions} placeholder="— Not linked —" />
        <p className="mt-1 text-xs text-slate-400">
          user_profiles is the person's real identity; this staff record is one branch/role under it. Match by email, not name — always verify before linking.
        </p>
        {emailMismatch && (
          <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            This staff record's email ({form.email}) doesn't match the selected login's email ({selectedLogin!.email}). Double-check this is the right person before saving.
          </p>
        )}
        {otherBranches.length > 0 && (
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            This login already has {otherBranches.length} other branch{otherBranches.length > 1 ? 'es' : ''}: {otherBranches.map(b => `${b.employee_name} (${b.role ?? 'no role'})`).join(', ')}.
          </p>
        )}
      </Field>

      <Field label="Experience / Notes">
        <textarea rows={3} className={inputCls} value={form.experience ?? ''} onChange={e => set('experience', e.target.value)} />
      </Field>
    </FormPage>
  )
}

