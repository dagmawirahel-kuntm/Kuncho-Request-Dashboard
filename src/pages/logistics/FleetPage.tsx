import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { formatDate } from '@/lib/utils'
import type { Vehicle, VehicleStatus, TransportationRequest } from '@/types/database'
import { Truck, Bike, Car, Plus, BookOpen, BookX, ArrowRight, MapPin } from 'lucide-react'

const STATUS_META: Record<VehicleStatus, { label: string; cls: string; dot: string }> = {
  available:   { label: 'Available',   cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300', dot: '#10B981' },
  on_job:      { label: 'On Job',      cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',             dot: '#3B82F6' },
  maintenance: { label: 'Maintenance', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',         dot: '#F59E0B' },
  offline:     { label: 'Offline',     cls: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',                 dot: '#EF4444' },
}

function vehicleIcon(type: Vehicle['vehicle_type']) {
  if (type === 'motorbike') return <Bike className="h-5 w-5" />
  if (type === 'truck') return <Truck className="h-5 w-5" />
  return <Car className="h-5 w-5" />
}

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'

export default function FleetPage() {
  const { role, profile } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const canManage = role === 'admin' || role === 'manager' || role === 'logistics_officer' || !!profile?.is_logistics_officer

  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [vehicleType, setVehicleType] = useState<Vehicle['vehicle_type']>('pickup')
  const [plate, setPlate] = useState('')
  const [inBooks, setInBooks] = useState(false)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const { data: vehicles = [], isLoading } = useQuery({
    queryKey: ['vehicles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicles').select('*').eq('active', true).order('created_at')
      if (error) throw error
      return data as Vehicle[]
    },
  })

  // Active jobs per vehicle (assigned or in progress)
  const { data: activeJobs = [] } = useQuery({
    queryKey: ['fleet-active-jobs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transportation_requests')
        .select('id, request_name, job_status, vehicle_id, job_type, dropoff_location_text')
        .in('job_status', ['assigned', 'in_progress'])
      if (error) throw error
      return data as Pick<TransportationRequest, 'id' | 'request_name' | 'job_status' | 'vehicle_id' | 'job_type' | 'dropoff_location_text'>[]
    },
  })

  async function setStatus(id: string, status: VehicleStatus) {
    const { error } = await supabase.from('vehicles').update({ status }).eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['vehicles'] })
    toast('Vehicle status updated', 'success')
  }

  async function handleAdd() {
    if (!name.trim()) { toast('Vehicle name is required', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('vehicles').insert([{
      name: name.trim(), vehicle_type: vehicleType, plate_number: plate.trim() || null,
      recognized_in_books: inBooks, purpose_notes: notes.trim() || null,
      status: 'available', active: true,
    }])
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    setShowAdd(false); setName(''); setPlate(''); setNotes(''); setInBooks(false)
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
        <div className="flex items-center gap-2">
          <Link to="/locations/map" className="flex items-center gap-1.5 rounded-md border dark:border-slate-600 px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
            <MapPin className="h-3.5 w-3.5" /> Locations Map
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
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Plate Number</label>
              <input type="text" className={inputCls} value={plate} onChange={e => setPlate(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Purpose / Notes</label>
            <input type="text" className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} placeholder="What is this vehicle for?" />
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

      {/* Fleet board */}
      {isLoading ? (
        <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {vehicles.map(v => {
            const meta = STATUS_META[v.status]
            const jobs = activeJobs.filter(j => j.vehicle_id === v.id)
            return (
              <div key={v.id} className="rounded-2xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
                <div className="p-4 flex items-start gap-3">
                  <div className="rounded-xl p-2.5 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 flex-shrink-0">
                    {vehicleIcon(v.vehicle_type)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-slate-800 dark:text-slate-100">{v.name}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.cls}`}>
                        {meta.label}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5 capitalize">
                      {v.vehicle_type}{v.plate_number ? ` · ${v.plate_number}` : ''}
                    </p>
                    <p className="flex items-center gap-1 text-[10px] mt-1.5 font-medium">
                      {v.recognized_in_books
                        ? <><BookOpen className="h-3 w-3 text-emerald-500" /><span className="text-emerald-600 dark:text-emerald-400">On the books (PPE)</span></>
                        : <><BookX className="h-3 w-3 text-slate-400" /><span className="text-slate-400">Off-books</span></>}
                    </p>
                  </div>
                </div>

                {v.purpose_notes && (
                  <p className="px-4 pb-3 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{v.purpose_notes}</p>
                )}

                {/* Active jobs on this vehicle */}
                <div className="px-4 pb-3">
                  {jobs.length === 0 ? (
                    <p className="text-xs text-slate-300 dark:text-slate-600">No active job</p>
                  ) : jobs.map(j => (
                    <Link key={j.id} to={`/transportation/${j.id}/edit`}
                      className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline">
                      <ArrowRight className="h-3 w-3" />
                      {j.request_name ?? 'Untitled job'} ({j.job_status.replace('_', ' ')})
                    </Link>
                  ))}
                </div>

                {canManage && (
                  <div className="border-t dark:border-slate-700 px-4 py-2.5 bg-slate-50 dark:bg-slate-900/40">
                    <select
                      value={v.status}
                      onChange={e => setStatus(v.id, e.target.value as VehicleStatus)}
                      className="w-full rounded-md border px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
                    >
                      <option value="available">Available</option>
                      <option value="on_job">On Job</option>
                      <option value="maintenance">Maintenance</option>
                      <option value="offline">Offline</option>
                    </select>
                  </div>
                )}
              </div>
            )
          })}
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
