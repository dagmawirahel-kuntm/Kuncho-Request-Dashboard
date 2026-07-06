import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Truck, Car, Wrench, PauseCircle, ArrowRight, Plus,
  MapPin, ClipboardList, Fuel, Send,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDateGC } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { DepartmentBoard } from '@/components/shared/DepartmentBoard'
import type { Staff, Vehicle, VehicleStatus, TransportationRequest, Expense } from '@/types/database'

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function StatPill({ label, value, sub, icon, color, to }: {
  label: string; value: string; sub?: string; icon: React.ReactNode; color: string; to: string
}) {
  return (
    <Link to={to} className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4 flex items-start justify-between hover:shadow-md transition-shadow">
      <div>
        <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
        <p className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{sub}</p>}
      </div>
      <span className={`rounded-lg p-2 ${color}`}>{icon}</span>
    </Link>
  )
}

type JobRow = Pick<TransportationRequest,
  'id' | 'request_name' | 'job_status' | 'job_type' | 'vehicle_id' | 'assigned_staff_id' | 'dropoff_location_text' | 'created_at' | 'priority'>
type FuelRow = Pick<Expense, 'id' | 'expense_code' | 'item_service_description' | 'fuel_liters' | 'amount_etb' | 'approval_status' | 'date'>

export default function LogisticsDashboardPage() {
  const { user, profile } = useAuth()

  const { data: staff } = useQuery({
    queryKey: ['my-staff-record', user?.id],
    queryFn: async () => {
      const email = user!.email?.toLowerCase() ?? ''
      const orFilter = email ? `user_id.eq.${user!.id},email.ilike.${email}` : `user_id.eq.${user!.id}`
      const { data } = await supabase.from('staff').select('*').or(orFilter).limit(5)
      if (!data || data.length === 0) return null
      const linked = data.find(r => r.user_id === user!.id)
      const byEmail = data.find(r => (r.email ?? '').toLowerCase() === email)
      return (linked ?? byEmail ?? data[0]) as Staff
    },
    enabled: !!user,
  })

  const { data: vehicles = [] } = useQuery({
    queryKey: ['vehicles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicles').select('*').eq('active', true)
      if (error) throw error
      return data as Vehicle[]
    },
  })

  const { data: jobs = [] } = useQuery({
    queryKey: ['logistics-dashboard-jobs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transportation_requests')
        .select('id, request_name, job_status, job_type, vehicle_id, assigned_staff_id, dropoff_location_text, created_at, priority')
        .in('job_status', ['requested', 'assigned', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw error
      return data as JobRow[]
    },
  })

  const { data: fuelRequests = [] } = useQuery({
    queryKey: ['logistics-dashboard-fuel'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('id, expense_code, item_service_description, fuel_liters, amount_etb, approval_status, date')
        .eq('expense_type', 'fuel')
        .order('created_at', { ascending: false })
        .limit(5)
      if (error) throw error
      return data as FuelRow[]
    },
  })

  const countByStatus = (s: VehicleStatus) => vehicles.filter(v => v.status === s).length
  const needsDispatch = jobs.filter(j => j.job_status === 'requested')
  const myAssigned = jobs.filter(j => staff && j.assigned_staff_id === staff.id && j.job_status !== 'requested')

  const displayName = staff?.employee_name ?? profile?.full_name ?? user?.email ?? 'there'
  const firstName = displayName.split(/\s+/)[0]

  return (
    <div className="space-y-6">
      <DepartmentBoard
        department={staff?.staff_type ?? null}
        greeting={{
          name: displayName,
          headline: `${greeting()}, ${firstName}`,
          subtitle: 'Fleet & dispatch overview',
          photoUrl: staff?.photo_url,
          profileTo: staff ? `/staff/${staff.id}` : undefined,
        }}
      />

      {/* Fleet status */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">Fleet Status</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatPill label="Available" value={String(countByStatus('available'))} icon={<Car className="h-5 w-5" />} color="bg-emerald-50 text-emerald-500 dark:bg-emerald-900/20" to="/logistics" />
          <StatPill label="On Job" value={String(countByStatus('on_job'))} icon={<Truck className="h-5 w-5" />} color="bg-blue-50 text-blue-500 dark:bg-blue-900/20" to="/logistics" />
          <StatPill label="Maintenance" value={String(countByStatus('maintenance'))} icon={<Wrench className="h-5 w-5" />} color="bg-amber-50 text-amber-500 dark:bg-amber-900/20" to="/logistics" />
          <StatPill label="Offline" value={String(countByStatus('offline'))} icon={<PauseCircle className="h-5 w-5" />} color="bg-red-50 text-red-500 dark:bg-red-900/20" to="/logistics" />
        </div>
      </div>

      {/* Quick actions */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">Quick Actions</h2>
        <div className="flex flex-wrap gap-2">
          <Link to="/transportation/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
            <Plus className="h-4 w-4" /> New Transport Job
          </Link>
          <Link to="/logistics" className="flex items-center gap-1.5 rounded-md border bg-white dark:bg-slate-800 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700">
            <Truck className="h-4 w-4" /> Fleet & Logistics
          </Link>
          <Link to="/locations/map" className="flex items-center gap-1.5 rounded-md border bg-white dark:bg-slate-800 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700">
            <MapPin className="h-4 w-4" /> Locations Map
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Needs dispatch */}
        <div className="rounded-2xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b dark:border-slate-700 px-5 py-3.5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <Send className="h-4 w-4 text-slate-400" /> Needs Dispatch
            </h2>
            <span className="text-xs text-slate-400">{needsDispatch.length}</span>
          </div>
          {needsDispatch.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400">Nothing waiting on dispatch.</div>
          ) : (
            <div className="divide-y dark:divide-slate-700">
              {needsDispatch.slice(0, 6).map(j => (
                <Link key={j.id} to={`/transportation/${j.id}/edit`} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/30">
                  <span className="truncate text-slate-700 dark:text-slate-200">{j.request_name ?? 'Untitled job'}</span>
                  <span className="shrink-0 flex items-center gap-1 text-xs text-slate-400">
                    {j.priority !== 'normal' && <span className="font-semibold uppercase text-amber-600 dark:text-amber-400">{j.priority}</span>}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* My assigned jobs */}
        <div className="rounded-2xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b dark:border-slate-700 px-5 py-3.5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <ClipboardList className="h-4 w-4 text-slate-400" /> My Assigned Jobs
            </h2>
            <span className="text-xs text-slate-400">{myAssigned.length}</span>
          </div>
          {!staff ? (
            <div className="py-10 text-center text-sm text-slate-400">Not linked to a staff profile yet.</div>
          ) : myAssigned.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400">No jobs assigned to you right now.</div>
          ) : (
            <div className="divide-y dark:divide-slate-700">
              {myAssigned.slice(0, 6).map(j => (
                <Link key={j.id} to={`/transportation/${j.id}/edit`} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/30">
                  <span className="truncate text-slate-700 dark:text-slate-200">{j.request_name ?? 'Untitled job'}</span>
                  <span className="shrink-0 text-xs text-slate-400 capitalize">{j.job_status.replace('_', ' ')}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent fuel requests */}
      <div className="rounded-2xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b dark:border-slate-700 px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <Fuel className="h-4 w-4 text-slate-400" /> Recent Fuel Requests
          </h2>
          <Link to="/expenses" className="text-xs font-medium text-brand hover:underline">View all</Link>
        </div>
        {fuelRequests.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-400">No fuel requests yet.</div>
        ) : (
          <div className="divide-y dark:divide-slate-700">
            {fuelRequests.map(f => (
              <Link key={f.id} to={`/expenses/${f.id}`} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/30">
                <span className="truncate text-slate-700 dark:text-slate-200">{f.item_service_description ?? f.expense_code}</span>
                <span className="shrink-0 flex items-center gap-3 text-xs text-slate-400">
                  {f.fuel_liters != null && <span>{f.fuel_liters} L</span>}
                  <span>{formatCurrency(f.amount_etb)}</span>
                  <span>{formatDateGC(f.date)}</span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
