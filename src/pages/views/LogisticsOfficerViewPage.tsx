import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { RoleViewSwitcher } from '@/components/shared/RoleViewSwitcher'
import { formatDate } from '@/lib/utils'
import type { TransportationRequest, Vehicle, VehicleMaintenanceRequest, VehiclePenalty } from '@/types/database'
import { Truck, Wrench, AlertTriangle, ArrowRight } from 'lucide-react'

type TransportRow = TransportationRequest & {
  projects: { project_name: string } | null
  vehicles: { name: string } | null
}
type MaintenanceRow = VehicleMaintenanceRequest & { vehicles: { name: string; plate_number: string | null } | null }
type PenaltyRow = VehiclePenalty & { vehicles: { name: string; plate_number: string | null } | null }

const OPEN_JOB_STATUSES = ['requested', 'assigned', 'in_progress']

function SectionCard({ title, icon: Icon, to, children }: { title: string; icon: React.ElementType; to: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
          <Icon className="h-4 w-4 text-brand" /> {title}
        </h2>
        <Link to={to} className="flex items-center gap-1 text-xs text-slate-400 hover:text-brand">
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      {children}
    </div>
  )
}

export default function LogisticsOfficerViewPage() {
  const { role } = useAuth()

  const { data: jobs = [], isLoading: loadingJobs } = useQuery({
    queryKey: ['logistics-view-transport'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transportation_requests')
        .select('*, projects(project_name), vehicles(name)')
        .in('job_status', OPEN_JOB_STATUSES)
        .order('created_at', { ascending: false })
        .limit(8)
      if (error) throw error
      return data as unknown as TransportRow[]
    },
  })

  const { data: maintenance = [], isLoading: loadingMaintenance } = useQuery({
    queryKey: ['logistics-view-maintenance'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicle_maintenance_requests')
        .select('*, vehicles(name, plate_number)')
        .order('created_at', { ascending: false })
        .limit(6)
      if (error) throw error
      return data as unknown as MaintenanceRow[]
    },
  })

  const { data: penalties = [], isLoading: loadingPenalties } = useQuery({
    queryKey: ['logistics-view-penalties'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicle_penalties')
        .select('*, vehicles(name, plate_number)')
        .order('penalty_date', { ascending: false })
        .limit(6)
      if (error) throw error
      return data as unknown as PenaltyRow[]
    },
  })

  const { data: vehicles = [] } = useQuery({
    queryKey: ['logistics-view-vehicles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicles').select('*').eq('active', true)
      if (error) throw error
      return data as Vehicle[]
    },
  })

  const availableCount = vehicles.filter(v => v.status === 'available').length
  const onJobCount = vehicles.filter(v => v.status === 'on_job').length
  const maintenanceCount = vehicles.filter(v => v.status === 'maintenance').length
  const unpaidPenalties = penalties.filter(p => !p.paid).length

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Logistics</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Transportation jobs and fleet, at a glance</p>
      </div>

      <RoleViewSwitcher mode="base" role={role} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4">
          <p className="text-xs text-slate-400">Available Vehicles</p>
          <p className="mt-1 text-xl font-bold text-emerald-600">{availableCount}</p>
        </div>
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4">
          <p className="text-xs text-slate-400">On a Job</p>
          <p className="mt-1 text-xl font-bold text-blue-600">{onJobCount}</p>
        </div>
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4">
          <p className="text-xs text-slate-400">In Maintenance</p>
          <p className="mt-1 text-xl font-bold text-amber-600">{maintenanceCount}</p>
        </div>
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4">
          <p className="text-xs text-slate-400">Unpaid Penalties</p>
          <p className="mt-1 text-xl font-bold text-red-600">{unpaidPenalties}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="Open Transport Jobs" icon={Truck} to="/transportation">
          {loadingJobs ? (
            <p className="py-6 text-center text-xs text-slate-400">Loading…</p>
          ) : jobs.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No open jobs</p>
          ) : (
            <div className="divide-y dark:divide-slate-700">
              {jobs.map(j => (
                <Link key={j.id} to="/transportation" className="flex items-center justify-between gap-2 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/40 -mx-2 px-2 rounded">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-700 dark:text-slate-200">{j.request_name ?? j.dropoff_location_text ?? 'Transport job'}</p>
                    <p className="text-xs text-slate-400 truncate">{j.projects?.project_name ?? '—'} {j.vehicles?.name ? `· ${j.vehicles.name}` : ''}</p>
                  </div>
                  <StatusBadge status={j.job_status} />
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Vehicle Maintenance" icon={Wrench} to="/fleet/maintenance">
          {loadingMaintenance ? (
            <p className="py-6 text-center text-xs text-slate-400">Loading…</p>
          ) : maintenance.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No maintenance requests</p>
          ) : (
            <div className="divide-y dark:divide-slate-700">
              {maintenance.map(m => (
                <div key={m.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-700 dark:text-slate-200">{m.vehicles?.name ?? '—'} <span className="text-slate-400">{m.vehicles?.plate_number}</span></p>
                    <p className="text-xs text-slate-400 truncate">{m.issue_description}</p>
                  </div>
                  <StatusBadge status={m.status} />
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Vehicle Penalties" icon={AlertTriangle} to="/fleet/penalties">
          {loadingPenalties ? (
            <p className="py-6 text-center text-xs text-slate-400">Loading…</p>
          ) : penalties.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No penalty records</p>
          ) : (
            <div className="divide-y dark:divide-slate-700">
              {penalties.map(p => (
                <div key={p.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-700 dark:text-slate-200">{p.vehicles?.name ?? '—'} <span className="text-slate-400">{p.vehicles?.plate_number}</span></p>
                    <p className="text-xs text-slate-400 truncate">{p.reason ?? 'Traffic penalty'} · {formatDate(p.penalty_date)}</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${p.paid ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'}`}>
                    {p.paid ? 'Paid' : 'Unpaid'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Fleet" icon={Truck} to="/logistics">
          <div className="grid grid-cols-2 gap-2">
            {vehicles.slice(0, 8).map(v => (
              <div key={v.id} className="rounded-lg border dark:border-slate-700 px-3 py-2">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{v.name}</p>
                <p className="text-xs text-slate-400">{v.plate_number ?? '—'}</p>
                <StatusBadge status={v.status} />
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
