import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { formatCurrency } from '@/lib/utils'
import type {
  TransportationRequest, TransportationRequestInsert, Vehicle,
  TransportJobType, HiredVehicleClass, TransportJobStatus,
} from '@/types/database'
import { useProjects, useLocations, useVendors, useStaff } from '@/hooks/useLookups'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { Receipt, ExternalLink } from 'lucide-react'

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

const JOB_TYPES: { value: TransportJobType; label: string }[] = [
  { value: 'material_move',    label: 'Material Move (workshop ↔ site)' },
  { value: 'purchase_pickup',  label: 'Purchase Pickup (from vendor)' },
  { value: 'document_courier', label: 'Document Courier (receipts, checks, contracts)' },
  { value: 'people_move',      label: 'People (site-to-site / office-to-office)' },
]

const HIRED_CLASSES: { value: HiredVehicleClass; label: string }[] = [
  { value: 'lada',           label: 'Lada (small purchases)' },
  { value: 'mini_isuzu',     label: 'Mini Isuzu' },
  { value: 'isuzu',          label: 'Isuzu' },
  { value: 'toyota_carryon', label: 'Toyota with carry-on' },
  { value: 'other',          label: 'Other' },
]

const STATUS_FLOW: Record<TransportJobStatus, { label: string; next: { to: TransportJobStatus; label: string; cls: string }[] }> = {
  requested:   { label: 'Requested',   next: [{ to: 'assigned', label: 'Assign', cls: 'bg-blue-600 hover:bg-blue-700' }, { to: 'cancelled', label: 'Cancel', cls: 'bg-red-600 hover:bg-red-700' }] },
  assigned:    { label: 'Assigned',    next: [{ to: 'in_progress', label: 'Start Job', cls: 'bg-purple-600 hover:bg-purple-700' }, { to: 'cancelled', label: 'Cancel', cls: 'bg-red-600 hover:bg-red-700' }] },
  in_progress: { label: 'In Progress', next: [{ to: 'completed', label: 'Complete', cls: 'bg-green-600 hover:bg-green-700' }, { to: 'cancelled', label: 'Cancel', cls: 'bg-red-600 hover:bg-red-700' }] },
  completed:   { label: 'Completed',   next: [] },
  cancelled:   { label: 'Cancelled',   next: [{ to: 'requested', label: 'Reopen', cls: 'bg-slate-600 hover:bg-slate-700' }] },
}

export default function TransportFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['transport-request', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('transportation_requests').select('*').eq('id', id).single()
      if (error) throw error
      return data as TransportationRequest
    },
    enabled: isEdit,
  })

  if (isEdit && isLoading) {
    return <FormPage title={isEdit ? 'Edit Transport Job' : 'New Transport Job'} backTo="/transportation" loading onSave={() => {}} />
  }

  return <TransportFormPageBody id={id} record={record} />
}

function TransportFormPageBody({ id, record }: { id?: string; record?: TransportationRequest }) {
  const isEdit = !!id
  const navigate = useNavigate()
  const { toast } = useToast()
  const { role, profile } = useAuth()
  const qc = useQueryClient()
  const { data: projects = [] } = useProjects()
  const { data: locations = [] } = useLocations()
  const { data: vendors = [] } = useVendors()
  const { data: staff = [] } = useStaff()

  const canDispatch = role === 'admin' || role === 'manager' || role === 'logistics_officer' || !!profile?.is_logistics_officer
  const rideHailingAllowed = canDispatch || !!profile?.is_ride_hailing_authorized

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const projectOptions  = useMemo(() => projects.map((p: any) => ({ id: p.id, label: p.project_name })), [projects])
  const locationOptions = useMemo(() => locations.map((l: any) => ({ id: l.id, label: l.location_name })), [locations])
  const locationById    = useMemo(() => new Map(locations.map((l: any) => [l.id, l])), [locations])
  const vendorOptions   = useMemo(() => vendors.map((v: any) => ({ id: v.id, label: v.vendor_name })), [vendors])
  const staffOptions    = useMemo(() => staff.map((s: any) => ({ id: s.id, label: s.employee_name, sub: s.role ?? undefined })), [staff])
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const { data: vehicles = [] } = useQuery({
    queryKey: ['vehicles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicles').select('*').eq('active', true).order('created_at')
      if (error) throw error
      return data as Vehicle[]
    },
  })

  const { data: linkedExpense } = useQuery({
    queryKey: ['transport-linked-expense', record?.expense_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('id, expense_code, amount_etb, payment_status, paid_date')
        .eq('id', record!.expense_id!)
        .single()
      if (error) throw error
      return data as { id: string; expense_code: string | null; amount_etb: number | null; payment_status: boolean; paid_date: string | null }
    },
    enabled: !!record?.expense_id,
  })

  const [form, setForm] = useState<Partial<TransportationRequestInsert>>(
    record
      ? {
          request_name: record.request_name,
          requested_date: record.requested_date,
          amount: record.amount ?? undefined,
          job_type: record.job_type,
          transport_mode: record.transport_mode,
          vehicle_id: record.vehicle_id,
          hired_vehicle_class: record.hired_vehicle_class,
          assigned_staff_id: record.assigned_staff_id,
          priority: record.priority,
          driver_name: record.driver_name,
          expected_delivery_date: record.expected_delivery_date,
          actual_delivery_date: record.actual_delivery_date,
          pickup_location_id: record.pickup_location_id,
          dropoff_location_id: record.dropoff_location_id,
          pickup_location_text: record.pickup_location_text,
          dropoff_location_text: record.dropoff_location_text,
          vendor_id: record.vendor_id,
          vendor_name: record.vendor_name,
          notes: record.notes,
          project_id: record.project_id,
        }
      : {
          requested_date: new Date().toISOString().slice(0, 10),
          job_type: 'material_move',
          transport_mode: 'own_fleet',
          priority: 'normal',
        }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(key: keyof TransportationRequestInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  // Picking a pinned location auto-fills project/vendor if that place
  // is already linked to one and the job hasn't set its own yet.
  function pickLocation(field: 'pickup_location_id' | 'dropoff_location_id', locationId: string | null) {
    setForm(f => {
      const next = { ...f, [field]: locationId }
      const loc = locationId ? (locationById.get(locationId) as any) : null
      if (loc?.project_id && !f.project_id) next.project_id = loc.project_id
      if (loc?.vendor_id && !f.vendor_id) next.vendor_id = loc.vendor_id
      return next
    })
  }

  const jobStatus: TransportJobStatus = record?.job_status ?? 'requested'
  const flow = STATUS_FLOW[jobStatus]
  const isMoneyJob = form.transport_mode === 'ride_hailing' || form.transport_mode === 'hired'

  // Keep vehicle status roughly in sync with the job lifecycle
  async function syncVehicle(vehicleId: string | null | undefined, next: TransportJobStatus) {
    if (!vehicleId) return
    if (next === 'assigned' || next === 'in_progress') {
      await supabase.from('vehicles').update({ status: 'on_job' }).eq('id', vehicleId)
    } else if (next === 'completed' || next === 'cancelled') {
      await supabase.from('vehicles').update({ status: 'available' }).eq('id', vehicleId)
    }
    qc.invalidateQueries({ queryKey: ['vehicles'] })
  }

  async function transition(next: TransportJobStatus) {
    const patch: Record<string, unknown> = { job_status: next }
    if (next === 'completed') patch.actual_delivery_date = new Date().toISOString().slice(0, 10)
    const { error: err } = await supabase.from('transportation_requests').update(patch).eq('id', id!)
    if (err) { toast(err.message, 'error'); return }
    await syncVehicle(record?.vehicle_id, next)
    qc.invalidateQueries({ queryKey: ['transportation'] })
    qc.invalidateQueries({ queryKey: ['transport-request', id] })
    qc.invalidateQueries({ queryKey: ['fleet-active-jobs'] })
    toast(`Job ${next.replace('_', ' ')}`, 'success')
    navigate('/transportation')
  }

  async function handleSave() {
    if (!form.request_name?.trim()) { setError('Give the job a short name'); return }
    if (form.transport_mode === 'ride_hailing' && !rideHailingAllowed) {
      setError('Your account is not authorized for ride-hailing — ask an admin for the badge, or pick another mode')
      return
    }
    setError(''); setSaving(true)
    const payload = { ...form }
    if (payload.transport_mode !== 'own_fleet') payload.vehicle_id = null
    if (payload.transport_mode !== 'hired') payload.hired_vehicle_class = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('transportation_requests').update(payload as any).eq('id', id!) : supabase.from('transportation_requests').insert([payload as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['transportation'] })
    qc.invalidateQueries({ queryKey: ['fleet-active-jobs'] })
    toast(isEdit ? 'Job updated' : 'Job created', 'success')
    navigate('/transportation')
  }

  return (
    <FormPage title={isEdit ? 'Edit Transport Job' : 'New Transport Job'} backTo="/transportation" error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Create Job'} onSave={handleSave}>

      {/* ── Job lifecycle (edit mode, dispatchers only) ── */}
      {isEdit && (
        <div className="rounded-lg border bg-slate-50 p-3 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-500">Job status:</span>
            <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-semibold text-slate-700 capitalize">
              {flow.label}
            </span>
          </div>
          {canDispatch && flow.next.length > 0 && (
            <div className="flex items-center gap-1.5">
              {flow.next.map(n => (
                <button key={n.to} type="button" onClick={() => transition(n.to)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold text-white ${n.cls}`}>
                  {n.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <Field label="Job Name *">
        <input type="text" className={inputCls} value={form.request_name ?? ''} onChange={e => set('request_name', e.target.value)}
          placeholder="e.g. Move booth panels workshop → Skylight site" />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Job Type">
          <select className={inputCls} value={form.job_type ?? 'material_move'} onChange={e => set('job_type', e.target.value)}>
            {JOB_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <select className={inputCls} value={form.priority ?? 'normal'} onChange={e => set('priority', e.target.value)}>
            <option value="normal">Normal</option>
            <option value="urgent">Urgent</option>
            <option value="critical">Critical</option>
          </select>
        </Field>
      </div>

      {/* ── Mode & vehicle ── */}
      <Field label="Transport Mode">
        <select className={inputCls} value={form.transport_mode ?? 'own_fleet'} onChange={e => set('transport_mode', e.target.value)}>
          <option value="own_fleet">Own fleet (IVECO / Toyota / e-bike)</option>
          <option value="ride_hailing" disabled={!rideHailingAllowed}>
            Ride-hailing{!rideHailingAllowed ? ' (not authorized)' : ''}
          </option>
          <option value="hired">Hired third-party (when fleet is busy/offline)</option>
        </select>
      </Field>

      {form.transport_mode === 'own_fleet' && (
        <Field label="Vehicle">
          <select className={inputCls} value={form.vehicle_id ?? ''} onChange={e => set('vehicle_id', e.target.value || null)}>
            <option value="">— Select vehicle —</option>
            {vehicles.map(v => (
              <option key={v.id} value={v.id} disabled={v.status === 'maintenance' || v.status === 'offline'}>
                {v.name} — {v.status.replace('_', ' ')}{v.status !== 'available' ? ' ⚠' : ''}
              </option>
            ))}
          </select>
        </Field>
      )}

      {form.transport_mode === 'hired' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Hired Vehicle Class">
            <select className={inputCls} value={form.hired_vehicle_class ?? ''} onChange={e => set('hired_vehicle_class', e.target.value || null)}>
              <option value="">— Select —</option>
              {HIRED_CLASSES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="Vendor / Transporter">
            <SearchableSelect value={form.vendor_id ?? null} onChange={vid => set('vendor_id', vid)} options={vendorOptions} placeholder="Select if known…" />
          </Field>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Assigned Staff (logistics)">
          <SearchableSelect value={form.assigned_staff_id ?? null} onChange={sid => set('assigned_staff_id', sid)} options={staffOptions} placeholder="Who runs this job…" />
        </Field>
        <Field label="Driver Name (if different)">
          <input type="text" className={inputCls} value={form.driver_name ?? ''} onChange={e => set('driver_name', e.target.value)} />
        </Field>
      </div>

      {/* ── Route ── */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="From (pinned location)">
          <SearchableSelect value={form.pickup_location_id ?? null} onChange={lid => pickLocation('pickup_location_id', lid)} options={locationOptions} placeholder="Pickup…" />
        </Field>
        <Field label="To (pinned location)">
          <SearchableSelect value={form.dropoff_location_id ?? null} onChange={lid => pickLocation('dropoff_location_id', lid)} options={locationOptions} placeholder="Dropoff…" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From (free text, if unpinned)">
          <input type="text" className={inputCls} value={form.pickup_location_text ?? ''} onChange={e => set('pickup_location_text', e.target.value)} />
        </Field>
        <Field label="To (free text, if unpinned)">
          <input type="text" className={inputCls} value={form.dropoff_location_text ?? ''} onChange={e => set('dropoff_location_text', e.target.value)} />
        </Field>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Requested Date">
          <input type="date" className={inputCls} value={form.requested_date ?? ''} onChange={e => set('requested_date', e.target.value)} />
        </Field>
        <Field label="Expected">
          <input type="date" className={inputCls} value={form.expected_delivery_date ?? ''} onChange={e => set('expected_delivery_date', e.target.value)} />
        </Field>
        <Field label="Actual">
          <input type="date" className={inputCls} value={form.actual_delivery_date ?? ''} onChange={e => set('actual_delivery_date', e.target.value)} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Project">
          <SearchableSelect value={form.project_id ?? null} onChange={pid => set('project_id', pid)} options={projectOptions} placeholder="Select project…" />
        </Field>
        <Field label={isMoneyJob ? 'Estimated Cost (ETB)' : 'Cost (ETB, if any)'}>
          <input type="number" step="0.01" className={inputCls} value={form.amount ?? ''} onChange={e => set('amount', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
      </div>

      <Field label="Notes">
        <textarea rows={2} className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </Field>

      {/* ── Payment: through the real ledger only ── */}
      {isEdit && (
        <div className="rounded-lg border bg-slate-50 p-3 space-y-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
            <Receipt className="h-3.5 w-3.5" /> Payment
          </p>
          {linkedExpense ? (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="text-sm text-slate-700">
                <span className="font-mono text-xs font-bold text-brand mr-1.5">{linkedExpense.expense_code}</span>
                {linkedExpense.amount_etb != null && formatCurrency(linkedExpense.amount_etb)}
                <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${linkedExpense.payment_status ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                  {linkedExpense.payment_status ? 'Paid' : 'Unpaid'}
                </span>
              </div>
              <Link to={`/expenses/${linkedExpense.id}`} className="flex items-center gap-1 text-xs text-brand hover:underline">
                View expense <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          ) : isMoneyJob ? (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-xs text-slate-500">
                No expense linked yet — payment happens through a real, finance-gated expense.
              </p>
              <Link
                to={`/transportation/${id}/pay`}
                className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90"
              >
                Create Expense for this job
              </Link>
            </div>
          ) : (
            <p className="text-xs text-slate-400">Own-fleet job — no direct payment expected (fuel is handled separately).</p>
          )}
        </div>
      )}
    </FormPage>
  )
}
