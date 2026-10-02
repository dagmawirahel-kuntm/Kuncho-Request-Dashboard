import { useQuery, useQueryClient } from '@tanstack/react-query'
import { dropRecordCache } from '@/lib/queryCache'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FileUpload } from '@/components/shared/FileUpload'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { Segmented } from '@/components/shared/Segmented'
import { Panel, RecordHeader, RecordLayout } from '@/components/record/Record'
import type { Staff, StaffInsert, UserProfile } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useDepartments, useStaffDirectory } from '@/hooks/useLookups'
import { useAuth } from '@/contexts/AuthContext'
import {
  AlertTriangle, AlertCircle, Save, User, Briefcase, Wallet, CalendarDays, KeyRound, StickyNote, CheckCircle2, Circle, HardHat, Camera, X,
} from 'lucide-react'

const inputCls = 'w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-brand disabled:bg-slate-50 disabled:text-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-900/40'
function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  )
}

// The kinds of worker. A casual (Tier 2) worker is paid by the day and gets
// a trade and codename instead of a desk, a login or a management level.
const KINDS = [
  { value: 'Full Time', label: 'Full time' },
  { value: 'Part Time', label: 'Part time' },
  { value: 'Contract', label: 'Contract' },
  { value: 'Freelance', label: 'Freelance' },
  { value: 'tier_2_casual', label: 'Casual (Tier 2)' },
]
// Where they work day to day (staff.staff_type) — the org department is separate.
const WORKPLACES = ['Office', 'Work Shop', 'Leather Workshop', 'Site', 'Field']
const JOB_TITLES = ['Project Manager', 'Site Foreman', 'Foreman', 'Finance', 'Designer', 'Driver', 'Purchaser', 'Carpenter', 'Ass. Carpenter',
  'Painter', 'Electrician', 'Labor', 'CNC operator', 'Workshop Manager', 'Upper Level Management']
// The system role that, with an active project assignment, unlocks Site Ops.
const SITE_FOREMAN_ROLE = 'site_foreman'

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

  if (isEdit && isLoading) return <div className="py-24 text-center text-sm text-slate-400">Loading…</div>
  return <StaffFormBody id={id} record={record} />
}

type UserProfileRow = Pick<UserProfile, 'id' | 'full_name' | 'role' | 'email'>
type StaffFormState = Partial<StaffInsert> & {
  trade_tag?: string | null
  codename_amharic?: string | null
  codename_english?: string | null
  job_description_id?: string | null
}

function StaffFormBody({ id, record }: { id?: string; record?: Staff }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { role } = useAuth()
  const canAssignDepartment = role === 'admin' || role === 'hr_officer'

  const { data: departments = [] } = useDepartments()
  const deptOptions = useMemo(() => (departments as { id: string; name: string }[]).map(d => ({ id: d.id, label: d.name })), [departments])
  const departmentNameById = useMemo(() => new Map((departments as { id: string; name: string }[]).map(d => [d.id, d.name])), [departments])
  const { data: directory = [] } = useStaffDirectory()

  const { data: userProfiles = [] } = useQuery({
    queryKey: ['user-profiles-lookup'],
    queryFn: async () => {
      const { data } = await supabase.from('user_profiles').select('id, full_name, role, email').order('full_name')
      return (data ?? []) as UserProfileRow[]
    },
  })
  const { data: jobDescriptions = [] } = useQuery({
    queryKey: ['job-descriptions-picker'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('job_descriptions').select('id, role_name, department_id').eq('active', true).order('role_name')
      if (error) throw error
      return (data ?? []) as { id: string; role_name: string; department_id: string | null }[]
    },
  })
  const { data: tradeRoster = [] } = useQuery({
    queryKey: ['tier2-trade-roster'],
    staleTime: 600_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('tier2_trade_roster')
        .select('trade_tag, codename_amharic, codename_english, icon_emoji, sort_order').order('sort_order')
      if (error) throw error
      return (data ?? []) as { trade_tag: string; codename_amharic: string | null; codename_english: string | null; icon_emoji: string | null }[]
    },
  })

  const [form, setForm] = useState<StaffFormState>(
    record
      ? {
          employee_name: record.employee_name, staff_type: record.staff_type, employment_type: record.employment_type,
          job_description_id: (record as StaffFormState).job_description_id ?? null,
          trade_tag: (record as StaffFormState).trade_tag ?? null,
          codename_amharic: (record as StaffFormState).codename_amharic ?? null,
          codename_english: (record as StaffFormState).codename_english ?? null,
          role: record.role, management_level: record.management_level,
          monthly_salary: record.monthly_salary ?? undefined, day_rate: record.day_rate ?? undefined,
          payment_frequency: record.payment_frequency, bank_account: record.bank_account,
          starting_date: record.starting_date, birth_date: record.birth_date ?? null, birthday_public: record.birthday_public ?? true, termination_date: record.termination_date, contract_end_date: record.contract_end_date ?? null,
          phone_number: record.phone_number, email: record.email, national_id: record.national_id, experience: record.experience,
          status: record.status ?? 'active', photo_url: record.photo_url,
          id_document_url: record.id_document_url, id_document_name: record.id_document_name,
          user_id: record.user_id, department_id: record.department_id, sub_team: record.sub_team, reports_to_id: record.reports_to_id,
        }
      : { status: 'active', employment_type: 'Full Time', payment_frequency: 'Monthly' }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  function set(key: keyof StaffFormState, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  const isCasual = form.employment_type === 'tier_2_casual'
  // Paid by the month or by the day — one of the two, shown as one choice.
  const [payBasis, setPayBasis] = useState<'monthly' | 'daily'>(
    isCasual || (record && record.monthly_salary == null && record.day_rate != null) ? 'daily' : 'monthly')
  const isSiteForeman = (form.role ?? '').trim() === SITE_FOREMAN_ROLE
  const isOps = !!form.department_id && departmentNameById.get(form.department_id) === 'Operations/Construction'

  const managerOptions = useMemo(() => (directory as { id: string; employee_name: string; role: string | null; employment_type: string | null }[])
    .filter(s => s.id !== id && s.employment_type !== 'tier_2_casual')
    .map(s => ({ id: s.id, label: s.employee_name, sub: s.role ?? undefined })), [directory, id])
  const jdOptions = useMemo(() => jobDescriptions.map(j => ({ id: j.id, label: j.role_name, sub: j.department_id ? departmentNameById.get(j.department_id) : undefined })), [jobDescriptions, departmentNameById])
  const userProfileOptions = useMemo(() => userProfiles.map(u => ({ id: u.id, label: u.full_name, sub: u.email ? `${u.email} · ${u.role}` : u.role })), [userProfiles])

  const selectedLogin = userProfiles.find(u => u.id === form.user_id)
  const emailMismatch = !!selectedLogin && !!form.email && !!selectedLogin.email
    && form.email.trim().toLowerCase() !== selectedLogin.email.trim().toLowerCase()
  // A login matching this person's email, offered when nothing is linked yet.
  const emailMatch = !form.user_id && form.email
    ? userProfiles.find(u => (u.email ?? '').trim().toLowerCase() === form.email!.trim().toLowerCase()) : undefined

  // "user_profiles is the person, staff is a branch": other staff rows
  // already linked to the selected login, so a link isn't made blind.
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

  // What's still missing — the things HR, payroll and site ops lean on.
  const checks = isCasual
    ? [
        { label: 'Trade', ok: !!form.trade_tag },
        { label: 'Phone', ok: !!form.phone_number?.trim() },
        { label: 'Day rate', ok: Number(form.day_rate) > 0 },
        { label: 'Photo', ok: !!form.photo_url },
      ]
    : [
        { label: 'Phone', ok: !!form.phone_number?.trim() },
        { label: 'Start date', ok: !!form.starting_date },
        { label: 'Department', ok: !!form.department_id },
        { label: 'Job description', ok: !!form.job_description_id },
        { label: 'Reports to', ok: !!form.reports_to_id || form.management_level === 'upper' },
        { label: 'Pay', ok: Number(form.monthly_salary) > 0 || Number(form.day_rate) > 0 },
        { label: 'National ID', ok: !!form.national_id?.trim() },
        { label: 'ID document', ok: !!form.id_document_url },
        { label: 'Bank account', ok: !!form.bank_account?.trim() },
        { label: 'Login linked', ok: !!form.user_id },
      ]
  const done = checks.filter(c => c.ok).length

  async function handleSave() {
    if (!form.employee_name?.trim()) { setError('Enter their name'); return }
    if (isCasual && !form.trade_tag) { setError('Pick their trade'); return }
    setError(''); setSaving(true)
    const payload: StaffFormState = {
      ...form,
      employee_name: form.employee_name.trim(),
      // One pay basis: the other figure is cleared so payroll reads one number.
      monthly_salary: payBasis === 'monthly' ? form.monthly_salary ?? null : null,
      day_rate: payBasis === 'daily' ? form.day_rate ?? null : null,
    }
    if (isEdit) delete payload.bank_account // accounts are kept in staff_bank_accounts once the person exists
    // Birthday columns arrive with migration 402: send them only when there
    // is a birthday to keep, so saving staff still works before it is run.
    if (!payload.birth_date && !record?.birth_date) { delete payload.birth_date; delete payload.birthday_public }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('staff').update(payload as any).eq('id', id!).select('id').single() : supabase.from('staff').insert([payload as any]).select('id').single()
    const { data, error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    dropRecordCache(qc, 'staff-member')
    for (const k of ['staff', 'staff-lookup', 'staff-directory-lookup']) qc.invalidateQueries({ queryKey: [k] })
    toast(isEdit ? 'Saved' : `${payload.employee_name} added`, 'success')
    navigate(`/staff/${(data as { id: string }).id}`)
  }

  const name = form.employee_name?.trim()
  const saveLabel = saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add to staff'

  return (
    <div className="pb-20 sm:pb-0">
      <RecordHeader
        back={isEdit ? { to: `/staff/${id}`, label: 'Back to their page' } : { to: '/staff', label: 'Staff' }}
        title={isEdit ? `Edit ${record?.employee_name ?? 'staff member'}` : 'New staff member'}
        subtitle={isEdit ? undefined : 'Who they are, what they do, how they\'re paid'}
        actions={[
          { label: 'Cancel', to: isEdit ? `/staff/${id}` : '/staff' },
          { label: saveLabel, icon: Save, primary: true, onClick: handleSave, disabled: saving },
        ]}
      />
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-700/50 dark:bg-red-900/20 dark:text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />{error}
        </div>
      )}

      <RecordLayout
        main={<>
          <Panel>
            <Field label="Kind of worker">
              <Segmented value={form.employment_type ?? ''} ariaLabel="Kind of worker"
                onChange={v => { set('employment_type', v); if (v === 'tier_2_casual') { setPayBasis('daily'); if (!form.payment_frequency || form.payment_frequency === 'Monthly') set('payment_frequency', 'Daily') } }}
                options={KINDS} />
            </Field>
          </Panel>

          <Panel title="The person" icon={User}>
            <div className="flex flex-col gap-4 sm:flex-row">
              <div className="shrink-0">
                {form.photo_url ? (
                  <div className="relative h-24 w-24">
                    <img src={form.photo_url} alt="" className="h-24 w-24 rounded-2xl border object-cover dark:border-slate-600" />
                    <button type="button" onClick={() => set('photo_url', null)} aria-label="Remove photo"
                      className="absolute -right-2 -top-2 rounded-full border bg-white p-1 text-slate-500 shadow-sm hover:text-red-600 dark:border-slate-600 dark:bg-slate-800"><X className="h-3 w-3" /></button>
                  </div>
                ) : (
                  <div className="w-24">
                    <div className="mb-1 flex h-24 w-24 items-center justify-center rounded-2xl border-2 border-dashed text-slate-300 dark:border-slate-600"><Camera className="h-6 w-6" /></div>
                    <FileUpload folder="staff-photos" accept="image/*" label="Photo" fileUrl={null} fileName={null}
                      onUpload={url => set('photo_url', url)} onClear={() => set('photo_url', null)} />
                  </div>
                )}
              </div>
              <div className="flex-1 space-y-4">
                <Field label="Full name">
                  <input className={`${inputCls} text-base font-medium`} value={form.employee_name ?? ''} onChange={e => set('employee_name', e.target.value)} placeholder="As on their ID" autoFocus={!isEdit} />
                </Field>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Phone"><input type="tel" inputMode="tel" className={inputCls} value={form.phone_number ?? ''} onChange={e => set('phone_number', e.target.value)} placeholder="+251 9…" /></Field>
                  {!isCasual && <Field label="Email"><input type="email" className={inputCls} value={form.email ?? ''} onChange={e => set('email', e.target.value)} placeholder="name@kuncho.com" /></Field>}
                </div>
              </div>
            </div>
            {!isCasual && (
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="National ID number"><input className={inputCls} value={form.national_id ?? ''} onChange={e => set('national_id', e.target.value)} /></Field>
                <Field label="ID document (national ID / passport)" hint="Kept private — opens only through a short-lived link">
                  <FileUpload bucket="staff-documents" folder="staff-ids" privateBucket label="Upload ID"
                    fileUrl={form.id_document_url ?? null} fileName={form.id_document_name ?? null}
                    onUpload={(url, n) => setForm(f => ({ ...f, id_document_url: url, id_document_name: n }))}
                    onClear={() => setForm(f => ({ ...f, id_document_url: null, id_document_name: null }))} />
                </Field>
              </div>
            )}
          </Panel>

          {isCasual ? (
            <Panel title="Trade" icon={HardHat}>
              <p className="-mt-1 mb-3 text-xs text-slate-400">Casual workers get a card on <Link to="/hr/casual-workers" className="text-brand hover:underline">Casual workers</Link>. The codenames follow the trade; change them if you like.</p>
              <div className="flex flex-wrap gap-1.5">
                {tradeRoster.map(r => (
                  <button key={r.trade_tag} type="button"
                    onClick={() => setForm(f => ({ ...f, trade_tag: r.trade_tag, codename_amharic: r.codename_amharic ?? f.codename_amharic ?? null, codename_english: r.codename_english ?? f.codename_english ?? null }))}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${form.trade_tag === r.trade_tag
                      ? 'border-slate-900! bg-slate-900 text-white dark:border-slate-100! dark:bg-slate-100 dark:text-slate-900'
                      : 'bg-white text-slate-600 hover:border-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                    <span>{r.icon_emoji}</span>{r.codename_english}
                  </button>
                ))}
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Codename (Amharic)"><input className={inputCls} value={form.codename_amharic ?? ''} onChange={e => set('codename_amharic', e.target.value || null)} placeholder="የመሠረት ድንጋይ" /></Field>
                <Field label="Codename (English)"><input className={inputCls} value={form.codename_english ?? ''} onChange={e => set('codename_english', e.target.value || null)} placeholder="The Cornerstone" /></Field>
              </div>
            </Panel>
          ) : (
            <Panel title="The job" icon={Briefcase}>
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Job title">
                    <input list="job-titles" className={inputCls} disabled={isSiteForeman}
                      value={isSiteForeman ? 'Site foreman' : form.role ?? ''} onChange={e => set('role', e.target.value)} placeholder="e.g. Carpenter, Driver, Designer" />
                    <datalist id="job-titles">{JOB_TITLES.map(t => <option key={t} value={t} />)}</datalist>
                    <label className="mt-2 flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
                      <input type="checkbox" className="mt-0.5 accent-brand" checked={isSiteForeman}
                        onChange={e => set('role', e.target.checked ? SITE_FOREMAN_ROLE : 'Site Foreman')} />
                      <span>Site foreman — runs residential sites day to day. Unlocks Site Ops on each project they get an active role assignment for.</span>
                    </label>
                  </Field>
                  <Field label="Job description" hint="The role they're rated against on the Competency tab">
                    <SearchableSelect value={form.job_description_id ?? null} onChange={v => set('job_description_id', v)} options={jdOptions} placeholder="Not assigned yet" />
                  </Field>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Department" hint={!canAssignDepartment ? 'Only admin or HR can set this' : undefined}>
                    <SearchableSelect value={form.department_id ?? null} onChange={v => set('department_id', v)} options={deptOptions} placeholder="Unassigned" disabled={!canAssignDepartment} />
                  </Field>
                  <Field label="Reports to">
                    <SearchableSelect value={form.reports_to_id ?? null} onChange={v => set('reports_to_id', v)} options={managerOptions} placeholder="Their manager…" />
                  </Field>
                </div>
                <Field label="Works at">
                  <Segmented value={form.staff_type ?? ''} onChange={v => set('staff_type', v || null)} ariaLabel="Works at" size="sm"
                    options={[...WORKPLACES.map(w => ({ value: w, label: w === 'Work Shop' ? 'Workshop' : w })), { value: '', label: 'Not set' }]} />
                </Field>
                <Field label="Level">
                  <Segmented value={form.management_level ?? ''} onChange={v => set('management_level', v || null)} ariaLabel="Level" size="sm"
                    options={[{ value: 'upper', label: 'Upper management' }, { value: 'medium', label: 'Middle management' }, { value: 'low', label: 'Staff' }, { value: '', label: 'Not set' }]} />
                </Field>
                {isOps && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Sub-team" hint="For drivers, security, general labour and site supervisors">
                      <input list="sub-team-list" className={inputCls} value={form.sub_team ?? ''} onChange={e => set('sub_team', e.target.value || null)} placeholder="e.g. Workshop — Carpentry" />
                      <datalist id="sub-team-list">{['Workshop — Carpentry', 'Workshop — CNC', 'Workshop — Leather', 'Site'].map(t => <option key={t} value={t} />)}</datalist>
                    </Field>
                    {id && (
                      <Field label="FF&E skills" hint="For the five FF&E fabrication roles — the level is worked out there">
                        <Link to={`/staff/${id}/ffe-skills`} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">Open the FF&E profile →</Link>
                      </Field>
                    )}
                  </div>
                )}
              </div>
            </Panel>
          )}

          <Panel title="Pay" icon={Wallet}>
            <div className="space-y-4">
              {!isCasual && (
                <Field label="Paid">
                  <Segmented value={payBasis} onChange={setPayBasis} ariaLabel="Paid"
                    options={[{ value: 'monthly', label: 'A monthly salary' }, { value: 'daily', label: 'By the day' }]} />
                </Field>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {payBasis === 'monthly' ? (
                  <Field label="Monthly salary (ETB)">
                    <input type="number" inputMode="decimal" min={0} step="0.01" className={`${inputCls} tabular-nums`} value={form.monthly_salary ?? ''} onChange={e => set('monthly_salary', e.target.value ? parseFloat(e.target.value) : null)} />
                  </Field>
                ) : (
                  <Field label="Day rate (ETB)">
                    <input type="number" inputMode="decimal" min={0} step="0.01" className={`${inputCls} tabular-nums`} value={form.day_rate ?? ''} onChange={e => set('day_rate', e.target.value ? parseFloat(e.target.value) : null)} />
                  </Field>
                )}
                <Field label="Paid every">
                  <Segmented value={form.payment_frequency ?? ''} onChange={v => set('payment_frequency', v || null)} ariaLabel="Paid every" size="sm"
                    options={[{ value: 'Monthly', label: 'Month' }, { value: 'Bi-Weekly', label: '2 weeks' }, { value: 'Weekly', label: 'Week' }, { value: 'Daily', label: 'Day' }]} />
                </Field>
              </div>
              <Field label="Bank account" hint={isEdit ? 'Accounts are added and changed under Bank accounts on their page' : 'Becomes their main account; pick the bank on their page'}>
                {isEdit ? (
                  <div className="flex items-center justify-between gap-2 rounded-lg border bg-slate-50 px-3 py-2 text-sm text-slate-500 dark:border-slate-600 dark:bg-slate-900/40">
                    <span className="tabular-nums">{form.bank_account || 'None yet'}</span>
                    <Link to={`/staff/${id}`} className="text-xs font-medium text-brand hover:underline">Manage</Link>
                  </div>
                ) : (
                  <input className={`${inputCls} tabular-nums`} value={form.bank_account ?? ''} onChange={e => set('bank_account', e.target.value)} placeholder="Account number" />
                )}
              </Field>
            </div>
          </Panel>

          <Panel title="Notes" icon={StickyNote}>
            <textarea rows={3} className={inputCls} value={form.experience ?? ''} onChange={e => set('experience', e.target.value)} placeholder="Experience, skills, anything worth knowing" />
          </Panel>
        </>}
        rail={<div className="space-y-4 lg:sticky lg:top-28">
          <Panel title="On file" icon={CheckCircle2} action={<span className={`text-xs font-semibold ${done === checks.length ? 'text-emerald-600' : 'text-slate-500'}`}>{done}/{checks.length}</span>}>
            <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
              <div className={`h-full rounded-full ${done === checks.length ? 'bg-emerald-500' : 'bg-brand'}`} style={{ width: `${(done / checks.length) * 100}%` }} />
            </div>
            <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              {checks.map(c => (
                <li key={c.label} className={`flex items-center gap-1.5 ${c.ok ? 'text-slate-600 dark:text-slate-300' : 'text-slate-400'}`}>
                  {c.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Circle className="h-3.5 w-3.5" />}{c.label}
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Dates" icon={CalendarDays}>
            <div className="space-y-3">
              <Field label="Started"><input type="date" className={inputCls} value={form.starting_date ?? ''} onChange={e => set('starting_date', e.target.value || null)} /></Field>
              {!isCasual && (
                <Field label="Birthday" hint="Colleagues see the day and month only — never the year">
                  <input type="date" className={inputCls} value={form.birth_date ?? ''} onChange={e => set('birth_date', e.target.value || null)} />
                  {form.birth_date && (
                    <label className="mt-1.5 flex items-center gap-2 text-xs text-slate-500">
                      <input type="checkbox" className="h-3.5 w-3.5 accent-brand" checked={form.birthday_public ?? true} onChange={e => set('birthday_public', e.target.checked)} />
                      Show it in Team pulse so colleagues can send a wish
                    </label>
                  )}
                </Field>
              )}
              {!isCasual && (
                <Field label="Contract ends" hint="Leave empty for an open-ended job">
                  <input type="date" className={inputCls} value={form.contract_end_date ?? ''} onChange={e => set('contract_end_date', e.target.value || null)} />
                </Field>
              )}
              {isEdit && (
                <>
                  <Field label="Status">
                    <Segmented value={form.status ?? 'active'} onChange={v => set('status', v)} ariaLabel="Status" size="sm"
                      options={[{ value: 'active', label: 'Active' }, { value: 'on_leave', label: 'On leave', tone: 'amber' }, { value: 'terminated', label: 'Left', tone: 'red' }]} />
                  </Field>
                  {(form.status === 'terminated' || form.termination_date) && (
                    <Field label="Left on" hint="A date today or earlier marks them as left">
                      <input type="date" className={inputCls} value={form.termination_date ?? ''} onChange={e => set('termination_date', e.target.value || null)} />
                    </Field>
                  )}
                </>
              )}
            </div>
          </Panel>

          {!isCasual && (
            <Panel title="Sign-in" icon={KeyRound}>
              <SearchableSelect value={form.user_id ?? null} onChange={v => set('user_id', v)} options={userProfileOptions} placeholder="Not linked" />
              {emailMatch && (
                <button type="button" onClick={() => set('user_id', emailMatch.id)}
                  className="mt-2 w-full rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-left text-xs text-brand hover:bg-brand/10">
                  Link <b>{emailMatch.full_name}</b> — same email ({emailMatch.email})
                </button>
              )}
              <p className="mt-2 text-[11px] text-slate-400">Links this record to the person's login, so they see their own pay, trips and jobs. Match by email, not by name.</p>
              {emailMismatch && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  The email here ({form.email}) isn't the login's ({selectedLogin!.email}). Check it's the same person before saving.
                </p>
              )}
              {otherBranches.length > 0 && (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  This login is also linked to: {otherBranches.map(b => `${b.employee_name} (${b.role ?? 'no title'})`).join(', ')}.
                </p>
              )}
            </Panel>
          )}
          {name && !isEdit && <p className="px-1 text-[11px] text-slate-400">After saving you land on {name}'s page, where bank accounts, role assignments and documents are added.</p>}
        </div>}
      />
    </div>
  )
}
