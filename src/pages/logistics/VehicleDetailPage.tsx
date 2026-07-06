import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { formatDateGC } from '@/lib/utils'
import { Vehicle3D } from '@/components/shared/Vehicle3D'
import { StatusBadge } from '@/components/shared/StatusBadge'
import type { Vehicle, VehicleStatus, TransportationRequest } from '@/types/database'
import { ChevronLeft, BookOpen, BookX, History, Move3d, ArrowRight } from 'lucide-react'

const STATUS_META: Record<VehicleStatus, { label: string; cls: string }> = {
  available:   { label: 'Available',   cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  on_job:      { label: 'On Job',      cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  maintenance: { label: 'Maintenance', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  offline:     { label: 'Offline',     cls: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' },
}

type JobRow = Pick<TransportationRequest,
  'id' | 'request_name' | 'job_status' | 'job_type' | 'dropoff_location_text' | 'pickup_location_text' | 'created_at' | 'priority'>

export default function VehicleDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { role, profile } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const canManage = role === 'admin' || role === 'manager' || role === 'logistics_officer' || !!profile?.is_logistics_officer

  const { data: vehicle, isLoading, error } = useQuery({
    queryKey: ['vehicle', id],
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicles').select('*').eq('id', id!).single()
      if (error) throw error
      return data as Vehicle
    },
  })

  const { data: jobs = [] } = useQuery({
    queryKey: ['vehicle-jobs', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transportation_requests')
        .select('id, request_name, job_status, job_type, dropoff_location_text, pickup_location_text, created_at, priority')
        .eq('vehicle_id', id!)
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return data as JobRow[]
    },
    enabled: !!id,
  })

  async function setStatus(status: VehicleStatus) {
    const { error } = await supabase.from('vehicles').update({ status }).eq('id', id!)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['vehicle', id] })
    qc.invalidateQueries({ queryKey: ['vehicles'] })
    toast('Vehicle status updated', 'success')
  }

  if (isLoading) return <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
  if (error) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm font-medium text-red-500">Couldn't load this vehicle</p>
        <p className="mt-1 text-xs text-slate-400">{(error as { message?: string }).message ?? String(error)}</p>
        <Link to="/logistics" className="mt-4 inline-block text-sm text-brand hover:underline">Back to Fleet</Link>
      </div>
    )
  }
  if (!vehicle) return <div className="py-16 text-center text-sm text-slate-400">Vehicle not found.</div>

  const meta = STATUS_META[vehicle.status]

  return (
    <div className="space-y-5">
      <Link to="/logistics" className="flex w-fit items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
        <ChevronLeft className="h-4 w-4" /> Back to Fleet
      </Link>

      {/* Hero: interactive 3D model */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3 relative overflow-hidden rounded-2xl border dark:border-slate-700 bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-900/70 dark:to-slate-900"
          style={{ minHeight: 300 }}>
          <Vehicle3D type={vehicle.vehicle_type} size={1.5} interactive className="absolute inset-0" />
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-black/30 px-3 py-1 text-[11px] font-medium text-white/90">
            <Move3d className="h-3.5 w-3.5" /> Drag to rotate
          </div>
        </div>

        <div className="lg:col-span-2 rounded-2xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm space-y-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">{vehicle.name}</h1>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${meta.cls}`}>{meta.label}</span>
            </div>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400 capitalize">
              {vehicle.vehicle_type}{vehicle.plate_number ? ` · ${vehicle.plate_number}` : ''}
            </p>
          </div>

          <p className="flex items-center gap-1.5 text-xs font-medium">
            {vehicle.recognized_in_books
              ? <><BookOpen className="h-3.5 w-3.5 text-emerald-500" /><span className="text-emerald-600 dark:text-emerald-400">On the books (PPE)</span></>
              : <><BookX className="h-3.5 w-3.5 text-slate-400" /><span className="text-slate-400">Off-books</span></>}
          </p>

          {vehicle.purpose_notes && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Purpose</p>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{vehicle.purpose_notes}</p>
            </div>
          )}

          {canManage && (
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-400">Set status</label>
              <select
                value={vehicle.status}
                onChange={e => setStatus(e.target.value as VehicleStatus)}
                className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
              >
                <option value="available">Available</option>
                <option value="on_job">On Job</option>
                <option value="maintenance">Maintenance</option>
                <option value="offline">Offline</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Recent engagements feed */}
      <div className="rounded-2xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b dark:border-slate-700 px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <History className="h-4 w-4 text-slate-400" /> Recent Engagements
          </h2>
          <span className="text-xs text-slate-400">{jobs.length} job{jobs.length === 1 ? '' : 's'}</span>
        </div>

        {jobs.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-400">No transport jobs have used this vehicle yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-700/40 border-b dark:border-slate-700 text-left">
                  <th className="px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Job</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 hidden sm:table-cell">Route</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 hidden md:table-cell">Type</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Status</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-right">Date</th>
                  <th className="px-4 py-2.5 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-700">
                {jobs.map(j => (
                  <tr key={j.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/20 transition-colors">
                    <td className="px-5 py-3">
                      <p className="font-medium text-slate-700 dark:text-slate-200">{j.request_name ?? 'Untitled job'}</p>
                      {j.priority && j.priority !== 'normal' && (
                        <span className="text-[10px] font-semibold uppercase text-amber-600 dark:text-amber-400">{j.priority}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell text-xs text-slate-500 dark:text-slate-400">
                      {j.pickup_location_text || '—'} → {j.dropoff_location_text || '—'}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-xs text-slate-500 dark:text-slate-400 capitalize">
                      {j.job_type?.replace('_', ' ') ?? '—'}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={j.job_status.replace('_', ' ')} /></td>
                    <td className="px-4 py-3 text-right text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">{formatDateGC(j.created_at)}</td>
                    <td className="px-4 py-3">
                      <Link to={`/transportation/${j.id}/edit`} className="text-slate-400 hover:text-brand" title="Open job">
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
