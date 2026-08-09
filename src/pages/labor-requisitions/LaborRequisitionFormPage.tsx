import { useQuery, useQueryClient } from '@tanstack/react-query'
import { dropRecordCache } from '@/lib/queryCache'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
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
  const [searchParams] = useSearchParams()
  const prefillProjectId = searchParams.get('project_id')
  const { toast } = useToast()
  const { user } = useAuth()
  const qc = useQueryClient()
  const { data: projects = [] } = useProjects()
  const projectOptions = useMemo(() => projects.map((p: any) => ({ id: p.id, label: p.project_name })), [projects])

  const [form, setForm] = useState<Partial<LaborRequisitionInsert> & { payment_model?: string; pay_cycle?: string; gang_leader_vendor_id?: string | null; payment_basis?: string; volume_unit?: string | null; unit_rate?: number | null; specific_staff_id?: string | null }>(
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        payment_model: (record as any).payment_model ?? 'individual',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pay_cycle: (record as any).pay_cycle ?? 'weekly',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        gang_leader_vendor_id: (record as any).gang_leader_vendor_id ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        payment_basis: (record as any).payment_basis ?? 'per_day',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        volume_unit: (record as any).volume_unit ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        unit_rate: (record as any).unit_rate ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        specific_staff_id: (record as any).specific_staff_id ?? null,
      }
      : { is_casual_or_new: true, headcount: 1, project_id: prefillProjectId ?? undefined, payment_model: 'individual', pay_cycle: 'weekly', payment_basis: 'per_day' }
  )

  // Vendors filtered to labor-broker types — the DB doesn't constrain this,
  // but the picker is opinionated: if you're paying a gang leader you want to
  // see the ones flagged as such first. We fall back to all vendors so the
  // list isn't empty for early adopters who haven't tagged one yet.
  const { data: vendors = [] } = useQuery({
    queryKey: ['labor-broker-vendors'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vendors')
        .select('id, vendor_name, vendor_type')
        .eq('active', true)
        .order('vendor_name')
      if (error) throw error
      return data ?? []
    },
  })
  const vendorOptions = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const brokers = vendors.filter((v: any) => (v.vendor_type ?? '').toLowerCase().includes('labor'))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list = brokers.length > 0 ? brokers : (vendors as any[])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return list.map((v: any) => ({ id: v.id, label: v.vendor_type ? `${v.vendor_name} · ${v.vendor_type}` : v.vendor_name }))
  }, [vendors])

  const estTotal = (Number(form.headcount ?? 0)) * Number(form.estimated_day_rate ?? 0) * Number(form.estimated_days ?? 0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function set(key: string, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  async function handleSave() {
    setError(''); setSaving(true)
    // Clear the vendor field when switching away from gang_leader, and the
    // volume fields when switching away from per_volume — the DB CHECKs
    // require volume_unit + unit_rate iff per_volume, and gang_leader_vendor_id
    // iff gang_leader.
    let cleaned = form.payment_model === 'individual'
      ? { ...form, gang_leader_vendor_id: null }
      : form
    if (cleaned.payment_basis !== 'per_volume') {
      cleaned = { ...cleaned, volume_unit: null, unit_rate: null }
    }
    const payload = isEdit ? cleaned : { ...cleaned, requested_by: user?.id ?? null }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('labor_requisitions').update(payload as any).eq('id', id!) : supabase.from('labor_requisitions').insert([payload as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    dropRecordCache(qc, 'labor-requisition')
    qc.invalidateQueries({ queryKey: ['labor-requisitions'] })
    toast(isEdit ? 'Labor requisition updated' : 'Labor requisition created', 'success')
    navigate('/labor-requisitions')
  }

  return (
    <FormPage title={isEdit ? 'Edit Labor Requisition' : 'New Labor Requisition'} backTo="/labor-requisitions" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Submit Requisition'} onSave={handleSave}>
      <Field label="Project *">
        <SearchableSelect value={form.project_id ?? null} onChange={id => set('project_id', id)} options={projectOptions} placeholder="Select project…" />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Start Date *">
          <input type="date" className={inputCls} value={form.start_date ?? ''} onChange={e => set('start_date', e.target.value)} />
        </Field>
        <Field label="End Date">
          <input type="date" className={inputCls} value={form.end_date ?? ''} onChange={e => set('end_date', e.target.value || null)} />
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Estimated Day Rate (ETB) *">
          <input type="number" step="0.01" min={0} className={inputCls} value={form.estimated_day_rate ?? ''} onChange={e => set('estimated_day_rate', e.target.value ? parseFloat(e.target.value) : undefined)} />
        </Field>
        <Field label="Estimated Days">
          <input type="number" min={0} className={inputCls} value={form.estimated_days ?? ''} onChange={e => set('estimated_days', e.target.value ? parseInt(e.target.value, 10) : null)} />
        </Field>
      </div>
      <div className="rounded-md border border-brand/30 bg-brand/5 dark:bg-brand/10 px-3 py-2 text-xs text-slate-700 dark:text-slate-200">
        Estimated total: <span className="font-semibold tabular-nums">ETB {estTotal.toLocaleString()}</span>
        <span className="text-slate-400 ml-1">(headcount × day rate × days)</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Payment Model">
          <div className="flex gap-2">
            {[
              { v: 'individual',  label: 'Individual' },
              { v: 'gang_leader', label: 'Gang leader' },
            ].map(opt => (
              <label key={opt.v} className={`flex-1 cursor-pointer rounded-md border px-3 py-2 text-sm text-center ${form.payment_model === opt.v ? 'border-brand bg-brand/5 text-brand dark:bg-brand/10' : 'border-slate-200 text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>
                <input type="radio" name="pm" className="sr-only" checked={form.payment_model === opt.v} onChange={() => set('payment_model', opt.v)} />
                {opt.label}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Pay Cycle">
          <div className="flex gap-2">
            {[
              { v: 'weekly',          label: 'Weekly' },
              { v: 'engagement_end',  label: 'At engagement end' },
            ].map(opt => (
              <label key={opt.v} className={`flex-1 cursor-pointer rounded-md border px-3 py-2 text-sm text-center ${form.pay_cycle === opt.v ? 'border-brand bg-brand/5 text-brand dark:bg-brand/10' : 'border-slate-200 text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>
                <input type="radio" name="cyc" className="sr-only" checked={form.pay_cycle === opt.v} onChange={() => set('pay_cycle', opt.v)} />
                {opt.label}
              </label>
            ))}
          </div>
        </Field>
      </div>

      {form.payment_model === 'gang_leader' && (
        <Field label="Gang Leader Vendor *">
          <SearchableSelect value={form.gang_leader_vendor_id ?? null} onChange={id => set('gang_leader_vendor_id', id)} options={vendorOptions} placeholder="Select the vendor who receives payment…" />
          <p className="mt-1 text-[11px] text-slate-400">Only vendors flagged as labor brokers are prioritized; all active vendors are available.</p>
        </Field>
      )}

      <Field label="Work Measurement">
        <div className="flex gap-2">
          {[
            { v: 'per_day',    label: 'By day',    desc: 'Pay day-rate × days worked (default).' },
            { v: 'per_volume', label: 'By volume', desc: 'Pay unit-rate × piece-work completed (m², pcs, lm, …).' },
          ].map(opt => (
            <label key={opt.v} className={`flex-1 cursor-pointer rounded-md border px-3 py-2 text-sm ${form.payment_basis === opt.v ? 'border-brand bg-brand/5 text-brand dark:bg-brand/10' : 'border-slate-200 text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>
              <input type="radio" name="basis" className="sr-only" checked={form.payment_basis === opt.v} onChange={() => set('payment_basis', opt.v)} />
              <span className="block font-medium text-center">{opt.label}</span>
              <span className="block text-[10px] text-slate-400 mt-0.5 text-center">{opt.desc}</span>
            </label>
          ))}
        </div>
      </Field>

      {form.payment_basis === 'per_volume' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Volume Unit *">
            <input type="text" className={inputCls} value={form.volume_unit ?? ''} onChange={e => set('volume_unit', e.target.value || null)} placeholder="e.g. m², pcs, lm" list="volume-units" />
            <datalist id="volume-units"><option value="m²" /><option value="m³" /><option value="lm" /><option value="pcs" /><option value="kg" /><option value="ton" /></datalist>
          </Field>
          <Field label={`Unit Rate (ETB${form.volume_unit ? ' per ' + form.volume_unit : ''}) *`}>
            <input type="number" step="0.01" min={0} className={inputCls} value={form.unit_rate ?? ''} onChange={e => set('unit_rate', e.target.value ? parseFloat(e.target.value) : null)} />
          </Field>
        </div>
      )}

      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
    </FormPage>
  )
}
