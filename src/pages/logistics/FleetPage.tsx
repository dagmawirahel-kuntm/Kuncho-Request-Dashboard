import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { PAPER_LABEL, paperStateText, type FleetPaper } from '@/lib/fleet'
import { FileUpload } from '@/components/shared/FileUpload'
import type { Vehicle, VehicleStatus, TransportationRequest } from '@/types/database'
import { useStaff } from '@/hooks/useLookups'
import { Car, Truck, Bike, Plus, BookOpen, BookX, ArrowRight, MapPin, Camera, UserCircle2, ChevronRight, FileText, Route, Wrench, ShieldAlert } from 'lucide-react'

const STATUS_META: Record<VehicleStatus, { label: string; cls: string; dot: string }> = {
  available:   { label: 'Available',   cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300', dot: '#10B981' },
  on_job:      { label: 'On Job',      cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',             dot: '#3B82F6' },
  maintenance: { label: 'Maintenance', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',         dot: '#F59E0B' },
  offline:     { label: 'Offline',     cls: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',                 dot: '#EF4444' },
}
const STATUSES: VehicleStatus[] = ['available', 'on_job', 'maintenance', 'offline']

const secondaryBtn = 'flex items-center gap-1.5 rounded-md border dark:border-slate-600 px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'

type JobRow = Pick<TransportationRequest, 'id' | 'request_name' | 'job_status' | 'vehicle_id' | 'job_type' | 'dropoff_location_text' | 'created_at'>

const etb = (n: number) => formatCurrency(n).replace(/\.00$/, '')

function vehicleIcon(type: Vehicle['vehicle_type'], cls = 'h-8 w-8') {
  if (type === 'motorbike') return <Bike className={cls} />
  if (type === 'truck') return <Truck className={cls} />
  return <Car className={cls} />
}

function StatCard({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone: 'green' | 'blue' | 'amber' | 'slate' }) {
  const bar = { green: 'bg-emerald-500', blue: 'bg-blue-500', amber: 'bg-amber-500', slate: 'bg-slate-400' }[tone]
  return (
    <div className="relative overflow-hidden rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3">
      <span className={`absolute inset-y-0 left-0 w-1 ${bar}`} />
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums text-slate-800 dark:text-slate-100">{value}</p>
      {sub && <p className="text-xs text-slate-500 dark:text-slate-400">{sub}</p>}
    </div>
  )
}

function VehicleCard({
  vehicle, jobs, canManage, onStatusChange, onImageSaved, driverOptions, driverName, onDriverChange, papers, month, lastMonthTotal,
}: {
  papers: FleetPaper[]
  month: { total_etb: number; trips: number } | null
  lastMonthTotal: number
  vehicle: Vehicle
  jobs: JobRow[]
  canManage: boolean
  onStatusChange: (id: string, status: VehicleStatus) => void
  onImageSaved: (id: string, url: string) => void
  driverOptions: { id: string; employee_name: string }[]
  driverName: string | null
  onDriverChange: (vehicleId: string, driverId: string | null) => void
}) {
  const meta = STATUS_META[vehicle.status]
  const [editingPhoto, setEditingPhoto] = useState(false)
  const detail = `/logistics/vehicles/${vehicle.id}`

  const expired = papers.filter(p => p.state === 'expired')
  const due = papers.filter(p => p.state === 'due')
  const missing = papers.filter(p => p.state === 'missing')
  const cost = month ? Number(month.total_etb) : 0
  const plateText = vehicle.plate_number ? ` · ${vehicle.plate_number}` : ' · no plate recorded'

  return (
    <div className="flex flex-col rounded-2xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
      <div className="relative h-36 w-full bg-slate-100 dark:bg-slate-900/40">
        <Link
          to={detail}
          className="group absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset"
          aria-label={`Open ${vehicle.name} details`}
        >
          {vehicle.image_url ? (
            <>
              <img src={vehicle.image_url} alt={vehicle.name} className="h-full w-full object-cover" />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-8">
                <p className="flex items-center gap-1 font-semibold text-white text-sm">
                  <span className="truncate">{vehicle.name}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-70 transition-transform group-hover:translate-x-0.5" />
                </p>
                <p className="text-[11px] text-white/75"><span className="capitalize">{vehicle.vehicle_type}</span>{plateText}</p>
              </div>
            </>
          ) : (
            <div className="flex h-full items-end gap-3 bg-gradient-to-br from-slate-50 to-slate-200 px-3 pb-3 dark:from-slate-800 dark:to-slate-900">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white text-slate-400 shadow-sm dark:bg-slate-700 dark:text-slate-400">
                {vehicleIcon(vehicle.vehicle_type, 'h-7 w-7')}
              </span>
              <div className="min-w-0 pb-0.5">
                <p className="flex items-center gap-1 font-semibold text-slate-800 dark:text-slate-100 text-sm">
                  <span className="truncate">{vehicle.name}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5" />
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400"><span className="capitalize">{vehicle.vehicle_type}</span>{plateText}</p>
              </div>
            </div>
          )}
          <span className={`absolute top-2 right-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.cls}`}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.dot }} />{meta.label}
          </span>
        </Link>
        {canManage && (
          <button
            type="button"
            onClick={() => setEditingPhoto(v => !v)}
            className={`absolute top-2 left-2 z-10 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium ${vehicle.image_url
              ? 'bg-black/45 text-white hover:bg-black/65'
              : 'bg-white/80 text-slate-600 shadow-sm hover:bg-white dark:bg-slate-700 dark:text-slate-200'}`}
          >
            <Camera className="h-3 w-3" /> {vehicle.image_url ? 'Change' : 'Add photo'}
          </button>
        )}
      </div>

      {editingPhoto && (
        <div className="border-b dark:border-slate-700 px-4 py-3 bg-slate-50 dark:bg-slate-900/40">
          <FileUpload
            bucket="documents"
            folder="vehicle-photos"
            fileUrl={null}
            fileName={null}
            accept="image/*"
            label="Upload photo"
            onUpload={url => { onImageSaved(vehicle.id, url); setEditingPhoto(false) }}
            onClear={() => {}}
          />
        </div>
      )}

      <div className="flex-1 space-y-3 p-4">
        {/* What it is doing right now */}
        {jobs.length > 0 ? (
          <div className="space-y-1.5">
            {jobs.map(j => (
              <Link key={j.id} to={`/transportation/${j.id}/edit`}
                className="block rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 hover:bg-blue-100 dark:border-blue-800/50 dark:bg-blue-900/20 dark:hover:bg-blue-900/30">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-blue-800 dark:text-blue-200">
                  <Route className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{j.request_name ?? 'Untitled job'}</span>
                  <span className="ml-auto shrink-0 rounded-full bg-white/70 px-1.5 text-[10px] font-medium capitalize dark:bg-blue-950/50">
                    {j.job_status.replace('_', ' ')}
                  </span>
                </p>
                {j.dropoff_location_text && (
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] text-blue-700/80 dark:text-blue-300/80">
                    <MapPin className="h-3 w-3 shrink-0" /><span className="truncate">{j.dropoff_location_text}</span>
                  </p>
                )}
              </Link>
            ))}
          </div>
        ) : (
          <p className={`rounded-lg px-3 py-2 text-xs font-medium ${
            vehicle.status === 'available' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
            : vehicle.status === 'maintenance' ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300'
            : vehicle.status === 'offline' ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
            : 'bg-slate-50 text-slate-500 dark:bg-slate-900/40 dark:text-slate-400'}`}>
            {vehicle.status === 'available' ? 'Free — no job assigned'
              : vehicle.status === 'maintenance' ? 'In the workshop'
              : vehicle.status === 'offline' ? 'Out of service'
              : 'Marked on a job, but no active job is linked'}
          </p>
        )}

        <div className="flex items-center gap-1.5 text-xs">
          <UserCircle2 className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          {canManage ? (
            <select
              value={vehicle.assigned_driver_id ?? ''}
              onChange={e => onDriverChange(vehicle.id, e.target.value || null)}
              aria-label="Dedicated driver"
              className="w-full rounded-md border px-1.5 py-1 text-xs outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
            >
              <option value="">No dedicated driver</option>
              {driverOptions.map(d => <option key={d.id} value={d.id}>{d.employee_name}</option>)}
            </select>
          ) : (
            <span className="text-slate-600 dark:text-slate-300">{driverName ?? 'No dedicated driver'}</span>
          )}
        </div>

        {/* Papers: problems first, missing ones grouped */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <FileText className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          {expired.length + due.length + missing.length === 0 && (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">Papers in order</span>
          )}
          {expired.map(p => (
            <span key={p.kind + (p.staff_id ?? '')} title={paperStateText(p)}
              className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700 dark:bg-red-900/30 dark:text-red-300">
              {PAPER_LABEL[p.kind]} expired
            </span>
          ))}
          {due.map(p => (
            <span key={p.kind + (p.staff_id ?? '')} title={paperStateText(p)}
              className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              {PAPER_LABEL[p.kind]} in {p.days_left}d
            </span>
          ))}
          {missing.length > 0 && (
            <Link to={detail} title={missing.map(p => PAPER_LABEL[p.kind]).join(', ')}
              className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600">
              {missing.length} paper{missing.length === 1 ? '' : 's'} not on file →
            </Link>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>
            {cost > 0
              ? <>This month <b className="text-slate-700 dark:text-slate-200">{etb(cost)}</b>{month?.trips ? ` · ${month.trips} trip${month.trips === 1 ? '' : 's'}` : ''}</>
              : lastMonthTotal > 0 ? <>Nothing yet this month · last month {etb(lastMonthTotal)}</> : 'No costs this month'}
          </span>
          <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-[10px]">
            {vehicle.recognized_in_books
              ? <><BookOpen className="h-3 w-3 text-emerald-500" /> On the books</>
              : <><BookX className="h-3 w-3" /> Off-books</>}
          </span>
        </div>
      </div>

      {canManage && (
        <div className="border-t dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-2">
          <div role="radiogroup" aria-label="Vehicle status" className="grid grid-cols-4 gap-1">
            {STATUSES.map(s => {
              const on = vehicle.status === s
              return (
                <button key={s} type="button" role="radio" aria-checked={on}
                  onClick={() => { if (!on) onStatusChange(vehicle.id, s) }}
                  className={`rounded-md px-1 py-1.5 text-[11px] font-medium transition-colors ${on
                    ? `${STATUS_META[s].cls} shadow-sm`
                    : 'text-slate-500 hover:bg-white dark:text-slate-400 dark:hover:bg-slate-800'}`}>
                  {STATUS_META[s].label}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default function FleetPage() {
  const { role, profile } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const canManage = role === 'admin' || role === 'executive' || role === 'logistics_officer' || !!profile?.is_logistics_officer

  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [vehicleType, setVehicleType] = useState<Vehicle['vehicle_type']>('pickup')
  const [capacityClass, setCapacityClass] = useState<Vehicle['capacity_class']>('light')
  const [assignedDriverId, setAssignedDriverId] = useState<string | null>(null)
  const [plate, setPlate] = useState('')
  const [inBooks, setInBooks] = useState(false)
  const [notes, setNotes] = useState('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [fuelTankLiters, setFuelTankLiters] = useState('')
  const [saving, setSaving] = useState(false)

  const { data: vehicles = [], isLoading } = useQuery({
    queryKey: ['vehicles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicles').select('*').eq('active', true).order('created_at')
      if (error) throw error
      return data as Vehicle[]
    },
  })

  const { data: allStaff = [] } = useStaff()
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const driverOptions = (allStaff as any[]).filter(s => s.role === 'Driver').map(s => ({ id: s.id, employee_name: s.employee_name }))
  const driverNameById = new Map((allStaff as any[]).map(s => [s.id, s.employee_name]))
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Active jobs per vehicle (assigned or in progress)
  const { data: papers = [] } = useQuery({
    queryKey: ['fleet-papers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_fleet_papers').select('*')
      if (error) throw error
      return (data ?? []) as FleetPaper[]
    },
    retry: false,
  })
  // This month and last, so early in the month there is something to compare with.
  const now = new Date()
  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  const thisMonth = monthKey(now)
  const lastMonth = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1))
  const { data: costRows = [] } = useQuery({
    queryKey: ['vehicle-month-costs', thisMonth],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_vehicle_month_costs').select('vehicle_id, month, total_etb, trips').in('month', [thisMonth, lastMonth])
      if (error) throw error
      return (data ?? []) as { vehicle_id: string; month: string; total_etb: number; trips: number }[]
    },
    retry: false,
  })
  const monthCosts = costRows.filter(m => String(m.month).slice(0, 10) === thisMonth)
  const lastMonthCosts = costRows.filter(m => String(m.month).slice(0, 10) === lastMonth)
  const paperIssues = papers.filter(p => p.state !== 'ok')
  const paperCount = (state: FleetPaper['state']) => paperIssues.filter(p => p.state === state).length
  const count = (s: VehicleStatus) => vehicles.filter(v => v.status === s).length
  const monthTotal = monthCosts.reduce((t, m) => t + Number(m.total_etb || 0), 0)
  const monthTrips = monthCosts.reduce((t, m) => t + Number(m.trips || 0), 0)
  const lastMonthTotal = lastMonthCosts.reduce((t, m) => t + Number(m.total_etb || 0), 0)

  const { data: activeJobs = [] } = useQuery({
    queryKey: ['fleet-active-jobs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transportation_requests')
        .select('id, request_name, job_status, vehicle_id, job_type, dropoff_location_text, created_at')
        .in('job_status', ['assigned', 'in_progress'])
      if (error) throw error
      return data as JobRow[]
    },
  })
  const offFleetJobs = activeJobs.filter(j => !vehicles.some(v => v.id === j.vehicle_id)).length

  async function setStatus(id: string, status: VehicleStatus) {
    const { error } = await supabase.from('vehicles').update({ status }).eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['vehicles'] })
    toast('Vehicle status updated', 'success')
  }

  async function setImage(id: string, url: string) {
    const { error } = await supabase.from('vehicles').update({ image_url: url }).eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['vehicles'] })
    toast('Photo updated', 'success')
  }

  async function setDriver(id: string, driverId: string | null) {
    const { error } = await supabase.from('vehicles').update({ assigned_driver_id: driverId }).eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['vehicles'] })
    toast(driverId ? 'Driver assigned' : 'Driver unassigned', 'success')
  }

  async function handleAdd() {
    if (!name.trim()) { toast('Vehicle name is required', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('vehicles').insert([{
      name: name.trim(), vehicle_type: vehicleType, capacity_class: capacityClass, plate_number: plate.trim() || null,
      recognized_in_books: inBooks, purpose_notes: notes.trim() || null, image_url: imageUrl,
      fuel_tank_liters: fuelTankLiters ? parseFloat(fuelTankLiters) : null,
      assigned_driver_id: assignedDriverId,
      status: 'available', active: true,
    }])
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    setShowAdd(false); setName(''); setPlate(''); setNotes(''); setInBooks(false); setImageUrl(null); setFuelTankLiters(''); setAssignedDriverId(null)
    qc.invalidateQueries({ queryKey: ['vehicles'] })
    toast('Vehicle added', 'success')
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800 dark:text-slate-100">
            Fleet & Logistics
            {vehicles.some(v => v.status === 'available') && (
              <span title="A vehicle is available right now">
                <Car className="car-twist-anim h-5 w-5 text-emerald-500" />
              </span>
            )}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Own vehicles, live availability, and what each is doing right now</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/fleet/maintenance" className={secondaryBtn}>
            <Wrench className="h-3.5 w-3.5" /> Maintenance
          </Link>
          <Link to="/fleet/penalties" className={secondaryBtn}>
            <ShieldAlert className="h-3.5 w-3.5" /> Penalties
          </Link>
          <Link to="/locations/map" className={secondaryBtn}>
            <MapPin className="h-3.5 w-3.5" /> Map
          </Link>
          {canManage && (
            <button onClick={() => setShowAdd(v => !v)}
              className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
              <Plus className="h-4 w-4" /> {showAdd ? 'Close' : 'Add Vehicle'}
            </button>
          )}
        </div>
      </div>

      {showAdd && canManage && (
        <div className="rounded-2xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 space-y-3 shadow-sm">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Name</label>
              <input type="text" className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Isuzu NPR" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Type</label>
              <select className={inputCls} value={vehicleType} onChange={e => setVehicleType(e.target.value as Vehicle['vehicle_type'])}>
                <option value="truck">Truck</option>
                <option value="pickup">Pickup</option>
                <option value="motorbike">Motorbike</option>
                <option value="van">Van</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Capacity Class</label>
              <select className={inputCls} value={capacityClass ?? ''} onChange={e => setCapacityClass((e.target.value || null) as Vehicle['capacity_class'])}>
                <option value="">— Not specified —</option>
                <option value="motorbike">Motorbike</option>
                <option value="light">Light (pickup/van)</option>
                <option value="medium">Medium (truck)</option>
                <option value="heavy">Heavy (full truck+)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Dedicated Driver</label>
              <select className={inputCls} value={assignedDriverId ?? ''} onChange={e => setAssignedDriverId(e.target.value || null)}>
                <option value="">No dedicated driver</option>
                {driverOptions.map(d => <option key={d.id} value={d.id}>{d.employee_name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Plate Number</label>
              <input type="text" className={inputCls} value={plate} onChange={e => setPlate(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Fuel Tank Capacity (Liters)</label>
              <input type="number" min={0} step="any" className={inputCls} value={fuelTankLiters} onChange={e => setFuelTankLiters(e.target.value)} placeholder="e.g. 80" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Purpose / Notes</label>
            <input type="text" className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} placeholder="What is this vehicle for?" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Photo (optional)</label>
            <FileUpload
              bucket="documents"
              folder="vehicle-photos"
              fileUrl={imageUrl}
              fileName={imageUrl ? 'Vehicle photo' : null}
              accept="image/*"
              label="Upload photo"
              onUpload={url => setImageUrl(url)}
              onClear={() => setImageUrl(null)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={inBooks} onChange={e => setInBooks(e.target.checked)} />
            Recognized in the books (PPE)
          </label>
          <button onClick={handleAdd} disabled={saving}
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50">
            {saving ? 'Adding…' : 'Add Vehicle'}
          </button>
        </div>
      )}

      {vehicles.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard tone="green" label="Available now" value={count('available')} sub={`of ${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'}`} />
          <StatCard tone="blue" label="On a job" value={count('on_job')}
            sub={offFleetJobs ? `+${offFleetJobs} job${offFleetJobs === 1 ? '' : 's'} on hired or no vehicle` : activeJobs.length ? `${activeJobs.length} active job${activeJobs.length === 1 ? '' : 's'}` : 'No active jobs'} />
          <StatCard tone="amber" label="Out of service" value={count('maintenance') + count('offline')}
            sub={count('maintenance') + count('offline') ? `${count('maintenance')} in workshop · ${count('offline')} offline` : 'Whole fleet running'} />
          <StatCard tone="slate" label="Running cost this month" value={etb(monthTotal)}
            sub={[monthTrips ? `${monthTrips} trip${monthTrips === 1 ? '' : 's'}` : 'No trips yet', lastMonthTotal ? `last month ${etb(lastMonthTotal)}` : null].filter(Boolean).join(' · ')} />
        </div>
      )}

      {paperIssues.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-800/40 dark:bg-amber-900/10 dark:text-amber-200">
          <FileText className="h-4 w-4 shrink-0" />
          <p className="font-semibold">
            Papers: {[
              paperCount('expired') && `${paperCount('expired')} expired`,
              paperCount('due') && `${paperCount('due')} due within 30 days`,
              paperCount('missing') && `${paperCount('missing')} not on file`,
            ].filter(Boolean).join(' · ')}
          </p>
          <p className="text-xs text-amber-800/80 dark:text-amber-300/80">Most traffic penalties are for papers — open a vehicle to add them.</p>
        </div>
      )}

      {/* Fleet board */}
      {isLoading ? (
        <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {vehicles.map(v => (
            <VehicleCard
              key={v.id}
              vehicle={v}
              jobs={activeJobs.filter(j => j.vehicle_id === v.id)}
              papers={papers.filter(p => p.vehicle_id === v.id || (!!v.assigned_driver_id && p.staff_id === v.assigned_driver_id))}
              month={monthCosts.find(m => m.vehicle_id === v.id) ?? null}
              lastMonthTotal={Number(lastMonthCosts.find(m => m.vehicle_id === v.id)?.total_etb ?? 0)}
              canManage={canManage}
              onStatusChange={setStatus}
              onImageSaved={setImage}
              driverOptions={driverOptions}
              driverName={v.assigned_driver_id ? (driverNameById.get(v.assigned_driver_id) ?? null) : null}
              onDriverChange={setDriver}
            />
          ))}
        </div>
      )}

      <div className="flex items-center justify-between rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Dispatch jobs, assignments, and third-party hires live in Transportation.
        </p>
        <Link to="/transportation" className="flex items-center gap-1 text-sm font-medium text-brand hover:underline">
          Open Transport Jobs <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <p className="text-xs text-slate-400 dark:text-slate-500">
        Last updated {formatDate(new Date().toISOString())}. Vehicle status is set manually here (or automatically
        when a job it's assigned to starts/completes).
      </p>
    </div>
  )
}
