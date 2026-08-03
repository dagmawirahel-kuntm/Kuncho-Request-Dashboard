import { useQuery, useQueryClient } from '@tanstack/react-query'
import { dropRecordCache } from '@/lib/queryCache'
import { useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { Timesheet, TimesheetInsert } from '@/types/database'
import { useStaff, useProjects, usePayrollList } from '@/hooks/useLookups'
import { formatCurrency } from '@/lib/utils'
import { useToast } from '@/contexts/ToastContext'

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

export default function TimesheetFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['timesheet-entry', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('timesheet').select('*').eq('id', id).single()
      if (error) throw error
      return data as Timesheet
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Timesheet Entry' : 'New Timesheet Entry'} backTo="/timesheet" loading onSave={() => {}} />
  }

  return <TimesheetFormPageBody id={id} record={record} />
}

function TimesheetFormPageBody({ id, record }: { id?: string; record?: Timesheet }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: staff = [] } = useStaff()
  const { data: projects = [] } = useProjects()
  const { data: payrolls = [] } = usePayrollList()
  const staffOptions = useMemo(() => staff.map((s: any) => ({ id: s.id, label: s.employee_name, sub: s.role ?? undefined })), [staff])
  const projectOptions = useMemo(() => projects.map((p: any) => ({ id: p.id, label: p.project_name })), [projects])
  const payrollOptions = useMemo(() => payrolls.map((p: any) => ({ id: p.id, label: p.payroll_record ?? p.pay_period })), [payrolls])

  // Tier-1 = a named staff member on a routine allocation; Tier-2 = casual/new
  // labor from a requisition, often with no staff record. Both feed the same
  // timesheet; the tier picks which link and which cost source apply.
  const { data: allocations = [] } = useQuery({
    queryKey: ['labor-allocations-for-timesheet'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('labor_allocations')
        .select('id, staff_id, project_id, day_rate_snapshot, staff:staff_id(employee_name), projects:project_id(project_name)')
        .order('start_date', { ascending: false })
      if (error) throw error
      return data as any[]
    },
  })
  const { data: requisitions = [] } = useQuery({
    queryKey: ['labor-requisitions-for-timesheet'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('labor_requisitions')
        .select('id, project_id, role_needed, estimated_day_rate, status, projects:project_id(project_name)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as any[]
    },
  })
  const allocationOptions = useMemo(() => allocations.map(a => ({
    id: a.id, label: `${a.staff?.employee_name ?? 'Staff'} · ${a.projects?.project_name ?? 'No project'}`,
  })), [allocations])
  const requisitionOptions = useMemo(() => requisitions.map(r => ({
    id: r.id, label: `${r.role_needed ?? 'Role'} · ${r.projects?.project_name ?? 'No project'}`, sub: r.status ?? undefined,
  })), [requisitions])

  const [form, setForm] = useState<Partial<TimesheetInsert>>(
    record
      ? {
        date: record.date,
        check_in_time: record.check_in_time,
        check_out_time: record.check_out_time,
        notes: record.notes,
        staff_id: record.staff_id,
        project_id: record.project_id,
        payroll_id: record.payroll_id,
        labor_tier: record.labor_tier,
        labor_allocation_id: record.labor_allocation_id,
        labor_requisition_id: record.labor_requisition_id,
        casual_worker_name: record.casual_worker_name,
        day_rate: record.day_rate,
        days_worked: record.days_worked,
      }
      : { labor_tier: 1, days_worked: 1 }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(key: keyof TimesheetInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  const tier = form.labor_tier ?? 1

  function setTier(t: number) {
    // Switching tiers clears the other tier's link so a row is never tagged
    // as both a routine allocation and a casual requisition.
    setForm(f => ({
      ...f,
      labor_tier: t,
      ...(t === 1 ? { labor_requisition_id: null, casual_worker_name: null } : { labor_allocation_id: null, staff_id: null }),
    }))
  }

  function pickAllocation(allocId: string | null) {
    const a = allocations.find(x => x.id === allocId)
    setForm(f => ({
      ...f,
      labor_allocation_id: allocId,
      staff_id: a?.staff_id ?? f.staff_id,
      project_id: a?.project_id ?? f.project_id,
      day_rate: f.day_rate ?? a?.day_rate_snapshot ?? null,
    }))
  }

  function pickRequisition(reqId: string | null) {
    const r = requisitions.find(x => x.id === reqId)
    setForm(f => ({
      ...f,
      labor_requisition_id: reqId,
      project_id: r?.project_id ?? f.project_id,
      day_rate: f.day_rate ?? r?.estimated_day_rate ?? null,
    }))
  }

  const effectiveRate = useMemo(() => {
    if (form.day_rate != null) return form.day_rate
    if (tier === 1) return allocations.find(a => a.id === form.labor_allocation_id)?.day_rate_snapshot ?? null
    return requisitions.find(r => r.id === form.labor_requisition_id)?.estimated_day_rate ?? null
  }, [form.day_rate, form.labor_allocation_id, form.labor_requisition_id, tier, allocations, requisitions])
  const laborCost = effectiveRate != null ? (form.days_worked ?? 1) * effectiveRate : null

  async function handleSave() {
    if (tier === 1 && !form.staff_id) { setError('Tier 1 is a named staff member — pick an allocation or a staff member'); return }
    if (tier === 2 && !form.casual_worker_name?.trim() && !form.labor_requisition_id) {
      setError('Tier 2 needs a requisition or a casual worker name'); return
    }
    setError(''); setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('timesheet').update(form as any).eq('id', id!) : supabase.from('timesheet').insert([form as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    dropRecordCache(qc, 'timesheet-entry')
    qc.invalidateQueries({ queryKey: ['timesheet'] })
    qc.invalidateQueries({ queryKey: ['project-labor-cost'] })
    toast(isEdit ? 'Entry updated' : 'Entry created', 'success')
    navigate('/timesheet')
  }

  return (
    <FormPage title={isEdit ? 'Edit Timesheet Entry' : 'New Timesheet Entry'} backTo="/timesheet" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Save Entry'} onSave={handleSave}>
      <Field label="Labor Tier">
        <div className="flex gap-2">
          <button type="button" onClick={() => setTier(1)}
            className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${tier === 1 ? 'border-brand bg-brand/10 text-brand' : 'text-slate-600 hover:bg-slate-50'}`}>
            Tier 1 · Allocated Staff
          </button>
          <button type="button" onClick={() => setTier(2)}
            className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${tier === 2 ? 'border-brand bg-brand/10 text-brand' : 'text-slate-600 hover:bg-slate-50'}`}>
            Tier 2 · Casual / New
          </button>
        </div>
      </Field>

      {tier === 1 ? (
        <>
          <Field label="Allocation">
            <SearchableSelect value={form.labor_allocation_id ?? null} onChange={pickAllocation} options={allocationOptions} placeholder="Link a routine allocation…" />
          </Field>
          <Field label="Staff Member *">
            <SearchableSelect value={form.staff_id ?? null} onChange={id => set('staff_id', id)} options={staffOptions} placeholder="Select staff…" />
          </Field>
        </>
      ) : (
        <>
          <Field label="Requisition">
            <SearchableSelect value={form.labor_requisition_id ?? null} onChange={pickRequisition} options={requisitionOptions} placeholder="Link an approved requisition…" />
          </Field>
          <Field label="Casual Worker Name">
            <input type="text" className={inputCls} value={form.casual_worker_name ?? ''} onChange={e => set('casual_worker_name', e.target.value)} placeholder="Name of the casual/new worker" />
          </Field>
        </>
      )}

      <Field label="Project">
        <SearchableSelect value={form.project_id ?? null} onChange={id => set('project_id', id)} options={projectOptions} placeholder="Select project…" />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Date">
          <input type="date" className={inputCls} value={form.date ?? ''} onChange={e => set('date', e.target.value)} />
        </Field>
        <Field label="Days Worked">
          <input type="number" step="0.25" min="0" className={inputCls} value={form.days_worked ?? ''} onChange={e => set('days_worked', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Check In Time">
          <input type="time" className={inputCls} value={form.check_in_time ?? ''} onChange={e => set('check_in_time', e.target.value)} />
        </Field>
        <Field label="Check Out Time">
          <input type="time" className={inputCls} value={form.check_out_time ?? ''} onChange={e => set('check_out_time', e.target.value)} />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Day Rate (ETB)">
          <input type="number" step="0.01" min="0" className={inputCls} value={form.day_rate ?? ''} onChange={e => set('day_rate', e.target.value ? parseFloat(e.target.value) : null)}
            placeholder={effectiveRate != null && form.day_rate == null ? `Default ${effectiveRate}` : 'Override rate'} />
        </Field>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Labor Cost</label>
          <div className="rounded-md border bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 tabular-nums">
            {laborCost != null ? formatCurrency(laborCost) : '—'}
          </div>
        </div>
      </div>

      <Field label="Pay Period (Payroll)">
        <SearchableSelect value={form.payroll_id ?? null} onChange={id => set('payroll_id', id)} options={payrollOptions} placeholder="Select pay period…" />
      </Field>
      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>
    </FormPage>
  )
}

