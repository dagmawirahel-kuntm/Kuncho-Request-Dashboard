import { useQuery, useQueryClient } from '@tanstack/react-query'
import { dropRecordCache } from '@/lib/queryCache'
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom'
import { RoutePriceHint } from '@/components/transport/RoutePriceHint'
import { PickupAdvice } from '@/components/transport/PickupAdvice'
import { TripCrewPanel } from '@/components/transport/TripCrew'
import { DriverPicker } from '@/components/transport/DriverPicker'
import { PAY_STAGE, payStageOf } from '@/lib/transport'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { formatCurrency } from '@/lib/utils'
import type {
  TransportationRequest, TransportationRequestInsert, Vehicle,
  TransportJobType, HiredVehicleClass, TransportJobStatus, VehicleCapacityClass,
  SuggestedVehicle,
} from '@/types/database'
import { useProjects, useLocations, useVendors, useStaff, locationPickerOptions } from '@/hooks/useLookups'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { submitted } from '@/lib/celebrate'
import { Receipt, ExternalLink, CheckCircle2, Check, Handshake, Send } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors'
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  const required = label.endsWith('*')
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600">
        {required ? label.slice(0, -1).trim() : label}
        {required && <span className="text-brand"> *</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  )
}

const JOB_TYPES: { value: TransportJobType; label: string }[] = [
  { value: 'material_move',    label: 'Material Move (workshop ↔ site)' },
  { value: 'purchase_pickup',  label: 'Purchase Pickup (from vendor)' },
  { value: 'document_courier', label: 'Document Courier (receipts, checks, contracts)' },
  { value: 'people_move',      label: 'People (site-to-site / office-to-office)' },
]

const CARGO_SIZES: { value: VehicleCapacityClass; label: string }[] = [
  { value: 'motorbike', label: 'Motorbike load (small parcel, documents)' },
  { value: 'light',     label: 'Light (pickup/van load)' },
  { value: 'medium',    label: 'Medium (truck load)' },
  { value: 'heavy',     label: 'Heavy (full truck+)' },
]

const HIRED_CLASSES: { value: HiredVehicleClass; label: string }[] = [
  { value: 'lada',           label: 'Lada (small purchases)' },
  { value: 'mini_isuzu',     label: 'Mini Isuzu' },
  { value: 'isuzu',          label: 'Isuzu' },
  { value: 'toyota_carryon', label: 'Toyota with carry-on' },
  { value: 'other',          label: 'Other' },
]

// Who finds the driver for a new job. Most of the time it's whoever needs the
// truck: they agree the price with a driver upfront and record the deal here.
type Who = 'self' | 'logistics'
const WHO: { value: Who; icon: typeof Send; title: string; sub: string }[] = [
  { value: 'self', icon: Handshake, title: "I've hired a driver", sub: 'Record the deal: the driver, the vehicle and the price agreed' },
  { value: 'logistics', icon: Send, title: 'Logistics arranges it', sub: 'They send one of our drivers or hire one' },
]

// Who can see and add to the driver list (transport_drivers RLS); anyone
// else types the driver and transport_driver_for_trip (migration 435) adds them.
const DRIVER_LIST_ROLES = ['admin', 'executive', 'finance', 'operations_manager', 'hr_officer', 'project_manager', 'stock_manager', 'procurement_officer', 'logistics_officer']

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
  const [searchParams] = useSearchParams()
  const bundleId = searchParams.get('bundle_id')
  const { toast } = useToast()
  const { role, profile, user } = useAuth()
  const qc = useQueryClient()
  const { data: projects = [] } = useProjects()
  const { data: locations = [] } = useLocations()
  const { data: vendors = [] } = useVendors()
  const { data: staff = [] } = useStaff()

  // Requesting transport straight off a Purchase Order — prefill the job
  // from the bundle instead of starting from a blank form.
  const { data: sourceBundle } = useQuery({
    queryKey: ['sourcing-bundle-for-transport', bundleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sourcing_bundles')
        .select('id, bundle_code, vendor_id, vendor_name, vendors(vendor_name)')
        .eq('id', bundleId!)
        .single()
      if (error) throw error
      return data as unknown as { id: string; bundle_code: string; vendor_id: string | null; vendor_name: string | null; vendors: { vendor_name: string } | null }
    },
    enabled: !isEdit && !!bundleId,
  })

  const canDispatch = role === 'admin' || role === 'executive' || role === 'logistics_officer' || !!profile?.is_logistics_officer
  const rideHailingAllowed = canDispatch || !!profile?.is_ride_hailing_authorized
  const canSeeDrivers = DRIVER_LIST_ROLES.includes(role ?? '') || !!profile?.is_logistics_officer
  // Logistics, and links that already say how (the trip estimator), start
  // from the full form; everyone else from the deal they made.
  const [who, setWho] = useState<Who>(() => (isEdit || canDispatch || searchParams.get('mode') ? 'logistics' : 'self'))
  const selfHire = !isEdit && who === 'self'
  const [typedDriver, setTypedDriver] = useState({ name: '', phone: '' })

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const projectOptions  = useMemo(() => projects.map((p: any) => ({ id: p.id, label: p.project_name })), [projects])
  const locationOptions = useMemo(() => locationPickerOptions(locations), [locations])
  const locationById    = useMemo(() => new Map(locations.map((l: any) => [l.id, l])), [locations])
  const vendorOptions   = useMemo(() => vendors.map((v: any) => ({ id: v.id, label: v.vendor_name })), [vendors])
  const staffOptions    = useMemo(() => staff.map((s: any) => ({ id: s.id, label: s.employee_name, sub: s.role ?? undefined })), [staff])
  // Named drivers (staff.role = 'Driver') are the primary picker for an
  // own_fleet job — reusing the existing role value rather than a
  // parallel driver identity. Falls back to the full staff list if no
  // one is tagged 'Driver' yet, so the field never goes blank.
  const driverOptions   = useMemo(() => {
    const drivers = staff.filter((s: any) => s.role === 'Driver')
    return (drivers.length > 0 ? drivers : staff).map((s: any) => ({ id: s.id, label: s.employee_name, sub: s.role ?? undefined }))
  }, [staff])
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
        .select('id, expense_code, amount_etb, payment_status, payment_state, paid_date')
        .eq('id', record!.expense_id!)
        .single()
      if (error) throw error
      return data as { id: string; expense_code: string | null; amount_etb: number | null; payment_status: boolean; payment_state: string | null; paid_date: string | null }
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
          expected_duration_minutes: record.expected_duration_minutes,
          actual_delivery_date: record.actual_delivery_date,
          pickup_location_id: record.pickup_location_id,
          dropoff_location_id: record.dropoff_location_id,
          pickup_location_text: record.pickup_location_text,
          dropoff_location_text: record.dropoff_location_text,
          vendor_id: record.vendor_id,
          vendor_name: record.vendor_name,
          hired_driver_id: record.hired_driver_id ?? null,
          notes: record.notes,
          project_id: record.project_id,
          cargo_size_estimate: record.cargo_size_estimate,
          expected_duration_hours: record.expected_duration_hours ?? undefined,
        }
      : {
          requested_date: new Date().toISOString().slice(0, 10),
          job_type: bundleId ? 'purchase_pickup' : 'material_move',
          transport_mode: (searchParams.get('mode') as TransportationRequestInsert['transport_mode'] | null) ?? (who === 'self' ? 'hired' : 'own_fleet'),
          priority: 'normal',
          sourcing_bundle_id: bundleId,
          // From the trip estimator or a combined pickup (migrations 413/414).
          pickup_location_id: searchParams.get('pickup'),
          dropoff_location_id: searchParams.get('dropoff'),
          hired_vehicle_class: searchParams.get('class') as HiredVehicleClass | null,
          hired_driver_id: searchParams.get('driver'),
          amount: searchParams.get('amount') ? Number(searchParams.get('amount')) : undefined,
          request_name: searchParams.get('name') ?? undefined,
          notes: searchParams.get('notes') ?? undefined,
        }
  )

  // Advisory-only vehicle fit for the chosen cargo size — never filters
  // the picker, just orders/labels it. Suggestion, not enforcement,
  // same principle as FF&E skill matching on work orders.
  const { data: suggestedVehicles = [] } = useQuery({
    queryKey: ['suggest-vehicles', form.cargo_size_estimate],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('suggest_vehicles_for_transport', { p_cargo_size: form.cargo_size_estimate ?? null })
      if (error) throw error
      return data as SuggestedVehicle[]
    },
    enabled: form.transport_mode === 'own_fleet',
  })
  const fitRankByVehicle = useMemo(() => new Map(suggestedVehicles.map(v => [v.vehicle_id, v.fit_rank])), [suggestedVehicles])
  const FIT_LABEL: Record<number, string> = { 0: ' ✓ good fit', 1: ' (larger than needed)', 3: ' ⚠ may be too small' }
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [bundlePrefilled, setBundlePrefilled] = useState(false)

  useEffect(() => {
    if (!sourceBundle || bundlePrefilled) return
    setForm(f => ({
      ...f,
      request_name: f.request_name || `Pickup — ${sourceBundle.bundle_code}`,
      vendor_id: sourceBundle.vendor_id,
      vendor_name: sourceBundle.vendor_id ? null : (sourceBundle.vendors?.vendor_name ?? sourceBundle.vendor_name),
    }))
    setBundlePrefilled(true)
  }, [sourceBundle, bundlePrefilled])

  function set(key: keyof TransportationRequestInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }

  // A hired driver needs no fleet vehicle or dispatcher; asking logistics
  // leaves the mode to them.
  function pickWho(next: Who) {
    setWho(next)
    setForm(f => next === 'self'
      ? { ...f, transport_mode: 'hired', vehicle_id: null, assigned_staff_id: null }
      : { ...f, transport_mode: f.transport_mode === 'hired' ? 'own_fleet' : f.transport_mode })
  }

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

  // A vendor's usual place (migration 409) fills the pickup, and a
  // project's site the drop-off — only while that end is still empty.
  const vendorPlace = useMemo(() => new Map((vendors as { id: string; location_id?: string | null }[]).filter(v => v.location_id).map(v => [v.id, v.location_id as string])), [vendors])
  const projectPlace = useMemo(() => new Map((projects as { id: string; location_id?: string | null }[]).filter(p => p.location_id).map(p => [p.id, p.location_id as string])), [projects])
  const [autoFilled, setAutoFilled] = useState<{ pickup?: boolean; dropoff?: boolean }>({})
  function setVendor(vid: string | null) {
    setForm(f => {
      const place = vid ? vendorPlace.get(vid) : undefined
      if (place && !f.pickup_location_id && !f.pickup_location_text) { setAutoFilled(a => ({ ...a, pickup: true })); return { ...f, vendor_id: vid, pickup_location_id: place } }
      return { ...f, vendor_id: vid }
    })
  }
  function setProject(pid: string | null) {
    setForm(f => {
      const place = pid ? projectPlace.get(pid) : undefined
      if (place && !f.dropoff_location_id && !f.dropoff_location_text) { setAutoFilled(a => ({ ...a, dropoff: true })); return { ...f, project_id: pid, dropoff_location_id: place } }
      return { ...f, project_id: pid }
    })
  }
  // A new pickup started from a purchase order shows its vendor's place
  // until someone picks or types another (worked out, not stored, until saved).
  const pickupId = form.pickup_location_id
    ?? (!isEdit && !form.pickup_location_text && form.vendor_id ? vendorPlace.get(form.vendor_id) ?? null : null)
  const pickupFromVendor = !form.pickup_location_id && !!pickupId

  // Typing a place that is saved — by its name or one of its other names
  // (migration 391) — picks the saved place too, so the job lands on the
  // map and in the place's history instead of staying loose text.
  function typePlace(end: 'pickup' | 'dropoff', text: string) {
    const key = text.trim().toLowerCase()
    const hit = key ? (locations as { id: string; location_name: string; aliases?: string[] }[])
      .find(l => l.location_name.trim().toLowerCase() === key || (l.aliases ?? []).some(a => a.trim().toLowerCase() === key)) : undefined
    set(`${end}_location_text`, text)
    if (hit && !form[`${end}_location_id`]) pickLocation(`${end}_location_id`, hit.id)
  }

  // Dedicated vehicle per driver (migration 166) — the fleet's real
  // operating model. Picking a driver defaults straight to their own
  // vehicle instead of a ranked list; still overridable.
  const vehicleByDriver = new Map(vehicles.filter(v => v.assigned_driver_id).map(v => [v.assigned_driver_id as string, v]))
  function pickDriver(driverId: string | null) {
    const dedicated = driverId ? vehicleByDriver.get(driverId) : null
    setForm(f => ({ ...f, assigned_staff_id: driverId, ...(dedicated ? { vehicle_id: dedicated.id } : {}) }))
  }

  const jobStatus: TransportJobStatus = record?.job_status ?? 'requested'
  const flow = STATUS_FLOW[jobStatus]
  const isMoneyJob = form.transport_mode === 'ride_hailing' || form.transport_mode === 'hired'
  // Whoever hired a driver follows the trip themselves; nobody in logistics is on it.
  const canMove = canDispatch || (!!record && record.transport_mode !== 'own_fleet' && !!user && record.requested_by_id === user.id)

  // The vehicle's own status follows its jobs in the database (migration 392).
  async function transition(next: TransportJobStatus) {
    const patch: Record<string, unknown> = { job_status: next }
    if (next === 'completed') {
      patch.actual_delivery_date = new Date().toISOString().slice(0, 10)
      // Capture the actual finish time, not just the date — dispatchers want to
      // see when a job really closed against its expected duration.
      patch.completed_at = new Date().toISOString()
    }
    const { error: err } = await supabase.from('transportation_requests').update(patch).eq('id', id!)
    if (err) { toast(err.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['vehicles'] })
    dropRecordCache(qc, 'transport-request', 'sourcing-bundle-for-transport', 'transport-linked-expense')
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
    if (selfHire && !form.hired_driver_id && !typedDriver.name.trim()) { setError('Who is the driver? Pick one or type their name'); return }
    if (selfHire && !(Number(form.amount) > 0)) { setError('What price did you agree with the driver?'); return }
    setError(''); setSaving(true)
    const payload: Record<string, unknown> = { ...form, pickup_location_id: pickupId ?? null }
    // Who asked: it's how people find their own requests, and what lets staff save one at all.
    if (!isEdit) payload.requested_by_id = user?.id ?? null
    if (selfHire) {
      let driverId = form.hired_driver_id ?? null
      if (!driverId) {
        const { data, error: e } = await supabase.rpc('transport_driver_for_trip', {
          p_name: typedDriver.name.trim(), p_phone: typedDriver.phone.trim() || null, p_vclass: form.hired_vehicle_class ?? null,
        })
        if (e) { setSaving(false); setError(e.message); toast(e.message, 'error'); return }
        driverId = data as string
      }
      // The deal is the arrangement: hired, and arranged from the start.
      Object.assign(payload, {
        transport_mode: 'hired', hired_driver_id: driverId, driver_name: form.driver_name || typedDriver.name.trim() || null,
        job_status: 'assigned', assigned_at: new Date().toISOString(), assigned_staff_id: null,
      })
    }
    if (payload.transport_mode !== 'own_fleet') payload.vehicle_id = null
    if (payload.transport_mode !== 'hired') payload.hired_vehicle_class = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = isEdit ? supabase.from('transportation_requests').update(payload as any).eq('id', id!) : supabase.from('transportation_requests').insert([payload as any])
    const { error: err } = await op
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    dropRecordCache(qc, 'transport-request', 'sourcing-bundle-for-transport', 'transport-linked-expense')
    qc.invalidateQueries({ queryKey: ['transportation'] })
    qc.invalidateQueries({ queryKey: ['fleet-active-jobs'] })
    if (selfHire) qc.invalidateQueries({ queryKey: ['transport-drivers'] })
    if (bundleId) qc.invalidateQueries({ queryKey: ['sourcing-bundle-detail', bundleId] })
    if (isEdit) toast('Job updated', 'success')
    else if (selfHire) submitted(toast, 'Deal recorded', 'Logistics can see it, and the cashier can pay it at the gate')
    else submitted(toast, 'Transport job created', 'Logistics can see it now')
    navigate(bundleId ? `/sourcing/${bundleId}` : '/transportation')
  }

  const backTo = bundleId ? `/sourcing/${bundleId}` : '/transportation'

  return (
    <FormPage title={isEdit ? 'Edit Transport Job' : 'New Transport Job'} backTo={backTo} error={error} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Create Job'} onSave={handleSave}>

      {/* ── Where the job is (edit mode) ── */}
      {isEdit && record && (
        <JobTimeline record={record} paid={linkedExpense ? payStageOf(record.transport_mode, linkedExpense) : (isMoneyJob ? 'none' : 'not_needed')}
          actions={canMove ? flow.next : []} onAction={transition} />
      )}

      {!isEdit && (
        <Field label="Who finds the driver?">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Who finds the driver?">
            {WHO.map(o => {
              const on = who === o.value
              return (
                <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => pickWho(o.value)}
                  className={`flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors ${on
                    ? 'border-brand bg-brand/5 ring-1 ring-brand'
                    : 'hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/40'}`}>
                  <o.icon className={`mt-0.5 h-4 w-4 shrink-0 ${on ? 'text-brand' : 'text-slate-400'}`} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{o.title}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">{o.sub}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </Field>
      )}

      <Field label="Job Name *">
        <input type="text" className={inputCls} value={form.request_name ?? ''} onChange={e => set('request_name', e.target.value)}
          placeholder="e.g. Move booth panels workshop → Skylight site" />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
      {!selfHire && (
        <Field label="Transport Mode">
          <select className={inputCls} value={form.transport_mode ?? 'own_fleet'} onChange={e => set('transport_mode', e.target.value)}>
            <option value="own_fleet">Own fleet (IVECO / Toyota / e-bike)</option>
            <option value="ride_hailing" disabled={!rideHailingAllowed}>
              Ride-hailing{!rideHailingAllowed ? ' (not authorized)' : ''}
            </option>
            <option value="hired">Hired third-party (when fleet is busy/offline)</option>
          </select>
        </Field>
      )}

      {form.transport_mode === 'own_fleet' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Cargo Size (optional)">
            <select className={inputCls} value={form.cargo_size_estimate ?? ''} onChange={e => set('cargo_size_estimate', e.target.value || null)}>
              <option value="">— Not specified —</option>
              {CARGO_SIZES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="Vehicle">
            <select className={inputCls} value={form.vehicle_id ?? ''} onChange={e => set('vehicle_id', e.target.value || null)}>
              <option value="">— Select vehicle —</option>
              {vehicles.map(v => (
                <option key={v.id} value={v.id} disabled={v.status === 'maintenance' || v.status === 'offline'}>
                  {v.name} — {v.status.replace('_', ' ')}{v.status !== 'available' ? ' ⚠' : ''}
                  {form.assigned_staff_id && vehicleByDriver.get(form.assigned_staff_id)?.id === v.id ? ' (their dedicated vehicle)' : ''}
                  {FIT_LABEL[fitRankByVehicle.get(v.id) ?? 2] ?? ''}
                </option>
              ))}
            </select>
            {form.assigned_staff_id && vehicleByDriver.get(form.assigned_staff_id) && vehicleByDriver.get(form.assigned_staff_id)!.status !== 'available' && (
              <p className="mt-1 text-[11px] text-amber-600">
                Their dedicated vehicle is {vehicleByDriver.get(form.assigned_staff_id)!.status.replace('_', ' ')} — pick a different one if this job can't wait.
              </p>
            )}
          </Field>
        </div>
      )}

      {form.transport_mode === 'hired' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={selfHire ? 'Vehicle' : 'Hired Vehicle Class'}>
            <select className={inputCls} value={form.hired_vehicle_class ?? ''} onChange={e => set('hired_vehicle_class', e.target.value || null)}>
              <option value="">— Select —</option>
              {HIRED_CLASSES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="Vendor / Transporter">
            <SearchableSelect value={form.vendor_id ?? null} onChange={setVendor} options={vendorOptions} placeholder="Select if known…" />
          </Field>
        </div>
      )}

      {!selfHire && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={form.transport_mode === 'own_fleet' ? 'Driver' : 'Assigned Staff (logistics)'}>
            <SearchableSelect
              value={form.assigned_staff_id ?? null}
              onChange={sid => form.transport_mode === 'own_fleet' ? pickDriver(sid) : set('assigned_staff_id', sid)}
              options={form.transport_mode === 'own_fleet' ? driverOptions : staffOptions}
              placeholder={form.transport_mode === 'own_fleet' ? 'Select driver…' : 'Who runs this job…'}
            />
          </Field>
          {form.transport_mode === 'own_fleet' && (
            <Field label="Driver name (if not on the staff list)">
              <input type="text" className={inputCls} value={form.driver_name ?? ''} onChange={e => set('driver_name', e.target.value)} />
            </Field>
          )}
        </div>
      )}

      {isMoneyJob && (selfHire && !canSeeDrivers ? (
        <Field label="Driver *" hint="Their name and phone are kept for next time and for paying this trip.">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input type="text" className={inputCls} placeholder="Driver's name" value={typedDriver.name}
              onChange={e => setTypedDriver(d => ({ ...d, name: e.target.value }))} />
            <input type="tel" inputMode="tel" className={inputCls} placeholder="Phone (09… or 07…)" value={typedDriver.phone}
              onChange={e => setTypedDriver(d => ({ ...d, phone: e.target.value }))} />
          </div>
        </Field>
      ) : (
        <Field label={selfHire ? 'Driver *' : 'Driver'} hint="Pick a driver we know, or add a new one — their phone, plate and how they're paid are kept for next time and for paying this job.">
          <DriverPicker driverId={form.hired_driver_id} typedName={!form.hired_driver_id ? form.driver_name : null} defaultClass={form.hired_vehicle_class}
            onPick={d => setForm(f => ({
              ...f,
              hired_driver_id: d?.id ?? null,
              driver_name: d ? d.full_name : f.driver_name,
              hired_vehicle_class: f.hired_vehicle_class ?? ((d?.vehicle_class as HiredVehicleClass | null) ?? null),
            }))} />
        </Field>
      ))}

      {selfHire ? (
        <Field label="Agreed price (ETB) *" hint="What you agreed with the driver. The cashier pays it at the gate once the trip is done.">
          <input type="number" step="0.01" min="0" inputMode="decimal" className={inputCls} value={form.amount ?? ''} placeholder="e.g. 1500"
            onChange={e => set('amount', e.target.value ? parseFloat(e.target.value) : null)} />
        </Field>
      ) : (
        <Field label="Job Duration (hours)" hint="How long this ties up the vehicle. Set it here and the job joins the fleet queue with an ETA immediately — used for own-fleet jobs.">
          <input
            type="number" step="0.25" min="0" className={inputCls}
            value={form.expected_duration_minutes != null ? form.expected_duration_minutes / 60 : ''}
            onChange={e => set('expected_duration_minutes', e.target.value ? Math.round(parseFloat(e.target.value) * 60) : null)}
            placeholder="e.g. 4"
          />
        </Field>
      )}

      {/* ── Route ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="From (saved place)" hint={(autoFilled.pickup && form.pickup_location_id) || pickupFromVendor ? "Filled from the vendor's usual place" : undefined}>
          <SearchableSelect value={pickupId ?? null} onChange={lid => { setAutoFilled(a => ({ ...a, pickup: false })); pickLocation('pickup_location_id', lid) }} options={locationOptions} placeholder="Pickup…" />
        </Field>
        <Field label="To (saved place)" hint={autoFilled.dropoff && form.dropoff_location_id ? "Filled from the project's site" : undefined}>
          <SearchableSelect value={form.dropoff_location_id ?? null} onChange={lid => { setAutoFilled(a => ({ ...a, dropoff: false })); pickLocation('dropoff_location_id', lid) }} options={locationOptions} placeholder="Dropoff…" />
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="From — or type it">
          <input type="text" className={inputCls} placeholder="e.g. Merkato" value={form.pickup_location_text ?? ''} onChange={e => typePlace('pickup', e.target.value)} />
        </Field>
        <Field label="To — or type it">
          <input type="text" className={inputCls} placeholder="e.g. Urael site" value={form.dropoff_location_text ?? ''} onChange={e => typePlace('dropoff', e.target.value)} />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Requested Date">
          <input type="date" className={inputCls} value={form.requested_date ?? ''} onChange={e => set('requested_date', e.target.value)} />
        </Field>
        <Field label="Expected">
          <input type="date" className={inputCls} value={form.expected_delivery_date ?? ''} onChange={e => set('expected_delivery_date', e.target.value)} />
        </Field>
        <Field label="Actual Delivery Date">
          <input type="date" className={inputCls} value={form.actual_delivery_date ?? ''} onChange={e => set('actual_delivery_date', e.target.value)} />
        </Field>
      </div>

      {isEdit && record?.completed_at && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-900/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          Job completed {new Date(record.completed_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Project">
          <SearchableSelect value={form.project_id ?? null} onChange={setProject} options={projectOptions} placeholder="Select project…" />
        </Field>
        {!selfHire && (
          <Field label={isMoneyJob ? 'Estimated Cost (ETB)' : 'Cost (ETB, if any)'}>
            <input type="number" step="0.01" className={inputCls} value={form.amount ?? ''} onChange={e => set('amount', e.target.value ? parseFloat(e.target.value) : null)} />
          </Field>
        )}
      </div>
      <RoutePriceHint jobId={id} pickupId={pickupId} dropoffId={form.dropoff_location_id} jobType={form.job_type}
        mode={form.transport_mode} amount={form.amount} date={form.requested_date} />
      {!isEdit && form.job_type === 'purchase_pickup' && (bundleId || form.vendor_id) && !searchParams.get('notes') && (
        <PickupAdvice bundleId={bundleId} vendorId={form.vendor_id} compact />
      )}

      {isEdit && id && (
        <TripCrewPanel jobId={id} isTruck={(vehicles as { id: string; vehicle_type?: string | null }[]).some(v => v.id === form.vehicle_id && v.vehicle_type === 'truck')} />
      )}
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
                <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${PAY_STAGE[payStageOf(form.transport_mode ?? 'hired', linkedExpense)].cls}`}>
                  {PAY_STAGE[payStageOf(form.transport_mode ?? 'hired', linkedExpense)].label}
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

// Requested → assigned → on the way → delivered → paid, with when each
// happened (assigned_at / started_at / completed_at, migration 410) and the
// next step as a button.
function JobTimeline({ record, paid, actions, onAction }: {
  record: TransportationRequest
  paid: ReturnType<typeof payStageOf>
  actions: { to: TransportJobStatus; label: string; cls: string }[]
  onAction: (to: TransportJobStatus) => void
}) {
  const cancelled = record.job_status === 'cancelled'
  const rank: Record<TransportJobStatus, number> = { requested: 0, assigned: 1, in_progress: 2, completed: 3, cancelled: -1 }
  const at = rank[record.job_status]
  const when = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null
  const steps: { label: string; done: boolean; time: string | null }[] = [
    { label: 'Requested', done: true, time: when(record.created_at) },
    { label: 'Assigned', done: at >= 1, time: when(record.assigned_at) },
    { label: 'On the way', done: at >= 2, time: when(record.started_at) },
    { label: 'Delivered', done: at >= 3, time: when(record.completed_at) },
    ...(paid === 'not_needed' ? [] : [{ label: paid === 'paid' ? 'Paid' : PAY_STAGE[paid].label, done: paid === 'paid', time: null }]),
  ]
  return (
    <div className="rounded-lg border bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40">
      {cancelled ? (
        <p className="text-sm font-semibold text-red-600">Cancelled</p>
      ) : (
        <ol className="flex items-start">
          {steps.map((st, i) => (
            <li key={st.label} className="flex flex-1 flex-col items-center text-center">
              <div className="flex w-full items-center">
                <span className={`h-0.5 flex-1 ${i === 0 ? 'opacity-0' : st.done ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}`} />
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${st.done ? 'bg-emerald-500 text-white' : 'border-2 border-slate-300 text-slate-400 dark:border-slate-600'}`}>
                  {st.done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className={`h-0.5 flex-1 ${i === steps.length - 1 ? 'opacity-0' : steps[i + 1].done ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}`} />
              </div>
              <span className={`mt-1 text-[11px] font-medium ${st.done ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400'}`}>{st.label}</span>
              {st.time && <span className="text-[10px] text-slate-400">{st.time}</span>}
            </li>
          ))}
        </ol>
      )}
      {actions.length > 0 && (
        <div className="mt-3 flex flex-wrap justify-end gap-1.5 border-t pt-2 dark:border-slate-700">
          {actions.map(n => (
            <button key={n.to} type="button" onClick={() => onAction(n.to)} className={`rounded-md px-3 py-1.5 text-xs font-semibold text-white ${n.cls}`}>{n.label}</button>
          ))}
        </div>
      )}
    </div>
  )
}
