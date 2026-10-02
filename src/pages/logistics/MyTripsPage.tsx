import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useLocations, useProjects } from '@/hooks/useLookups'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { Segmented } from '@/components/shared/Segmented'
import { LoadingRows } from '@/components/shared/LoadingRows'
import { NEXT_STEP, OPEN_JOB_STATUSES, setJobStatus } from '@/lib/transport'
import { PAPER_LABEL } from '@/lib/fleet'
import type { Location, TransportJobStatus, TransportJobType } from '@/types/database'
import { Car, Play, Check, Plus, Fuel, MapPin, ArrowRight, AlertTriangle, Phone, X, Truck, ShieldCheck } from 'lucide-react'
import { buzz, chime, confetti, firstTimeToday } from '@/lib/celebrate'

// Trips in a month worth a cheer when the driver reaches them.
const TRIP_LANDMARKS = [10, 25, 50, 100]

function monthStart() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString()
}

type Job = {
  id: string
  request_name: string | null
  job_status: TransportJobStatus
  job_type: TransportJobType
  pickup_location_text: string | null
  dropoff_location_text: string | null
  completed_at: string | null
  created_at: string
  vehicle_id: string | null
  pickup: { location_name: string; contact_phone: string | null } | null
  dropoff: { location_name: string; contact_phone: string | null; contact_name: string | null } | null
  projects: { project_name: string } | null
}
type Paper = { vehicle_id: string | null; staff_id: string | null; kind: string; state: string; days_left: number | null; holder: string }

const inputCls = 'w-full rounded-xl border bg-white px-3 py-3 text-base text-slate-800 outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'

/** The saved place a typed name means — by its name or one of its other names. */
function matchPlace(locations: Location[], text: string) {
  const key = text.trim().toLowerCase()
  if (!key) return null
  return locations.find(l => l.location_name.trim().toLowerCase() === key || (l.aliases ?? []).some(a => a.trim().toLowerCase() === key)) ?? null
}

// A driver's day on a phone: their vehicle, the job they're on, what's next,
// and a 30-second "log a trip" for runs nobody booked — so the company's own
// vehicles show up in the records, not just the hired ones.
export default function MyTripsPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: locations = [] } = useLocations()
  const { data: projects = [] } = useProjects()
  const [logging, setLogging] = useState(false)

  const { data: me, isLoading: meLoading } = useQuery({
    queryKey: ['my-staff-and-vehicle', user?.id],
    queryFn: async () => {
      const { data: staff } = await supabase.from('staff').select('id, employee_name').eq('user_id', user!.id).maybeSingle()
      const { data: vehicle } = staff
        ? await supabase.from('vehicles').select('id, name, plate_number, status, energy_type').eq('assigned_driver_id', staff.id).eq('active', true).maybeSingle()
        : { data: null }
      return { staff: staff as { id: string; employee_name: string } | null, vehicle: vehicle as { id: string; name: string; plate_number: string | null; status: string; energy_type: string } | null }
    },
    enabled: !!user?.id,
  })
  const staffId = me?.staff?.id ?? null
  const vehicle = me?.vehicle ?? null

  const { data: jobs = [] } = useQuery({
    queryKey: ['my-trips', staffId, vehicle?.id],
    queryFn: async () => {
      const ors = [`assigned_staff_id.eq.${staffId}`, ...(vehicle ? [`vehicle_id.eq.${vehicle.id}`] : [])].join(',')
      const { data, error } = await supabase.from('transportation_requests')
        .select('id, request_name, job_status, job_type, pickup_location_text, dropoff_location_text, completed_at, created_at, vehicle_id, pickup:locations!pickup_location_id(location_name, contact_phone), dropoff:locations!dropoff_location_id(location_name, contact_phone, contact_name), projects(project_name)')
        .or(ors)
        .gte('created_at', new Date(Date.now() - 60 * 86400000).toISOString())
        .order('created_at', { ascending: true })
      if (error) throw error
      // Open ones, and the ones finished today.
      const today = new Date().toDateString()
      return ((data ?? []) as unknown as Job[]).filter(j =>
        OPEN_JOB_STATUSES.includes(j.job_status) || (j.job_status === 'completed' && j.completed_at && new Date(j.completed_at).toDateString() === today))
    },
    enabled: !!staffId,
    refetchInterval: 60_000,
  })

  const { data: papers = [] } = useQuery({
    queryKey: ['my-papers', staffId, vehicle?.id],
    queryFn: async () => {
      const { data } = await supabase.from('v_fleet_papers').select('*')
      return ((data ?? []) as Paper[]).filter(p => (vehicle && p.vehicle_id === vehicle.id) || p.staff_id === staffId)
    },
    enabled: !!staffId,
    retry: false,
  })
  const papersToFix = papers.filter(p => p.state !== 'ok')
  const papersAllCurrent = papers.length > 0 && papersToFix.length === 0

  // Jobs this driver finished this month — theirs to see, nobody else's.
  const tripsKey = ['my-trips-month', staffId, vehicle?.id]
  const fetchTripsThisMonth = async () => {
    const ors = [`assigned_staff_id.eq.${staffId}`, ...(vehicle ? [`vehicle_id.eq.${vehicle.id}`] : [])].join(',')
    const { count, error } = await supabase.from('transportation_requests').select('id', { count: 'exact', head: true })
      .or(ors).eq('job_status', 'completed').gte('completed_at', monthStart())
    if (error) throw error
    return count ?? 0
  }
  const { data: tripsThisMonth = 0 } = useQuery({ queryKey: tripsKey, queryFn: fetchTripsThisMonth, enabled: !!staffId, retry: false })

  const onRoad = jobs.filter(j => j.job_status === 'in_progress')
  const upNext = jobs.filter(j => j.job_status === 'requested' || j.job_status === 'assigned')
  const doneToday = jobs.filter(j => j.job_status === 'completed')

  function refresh() {
    for (const k of ['my-trips', 'my-trips-month', 'my-staff-and-vehicle', 'transportation', 'vehicles', 'fleet-active-jobs']) qc.invalidateQueries({ queryKey: [k] })
  }

  async function advance(job: Job, button: HTMLElement | null) {
    const step = NEXT_STEP[job.job_status]
    if (!step) return
    const { data, error } = await setJobStatus([job.id], step.to)
    if (error) { toast(error.message, 'error'); return }
    if (!data?.length) { toast("You can't change this job — ask logistics", 'error'); return }
    toast(step.to === 'completed' ? 'Done — nice one' : 'Started — drive safe', 'success')
    if (step.to === 'completed') {
      buzz([20, 40, 20])
      confetti('burst', button)
      chime('success')
      // A landmark month: 10, 25, 50, 100 trips.
      const n = await qc.fetchQuery({ queryKey: tripsKey, queryFn: fetchTripsThisMonth, staleTime: 0 }).catch(() => 0)
      if (TRIP_LANDMARKS.includes(n) && firstTimeToday(`trips-${monthStart().slice(0, 7)}-${n}`)) {
        window.setTimeout(() => { confetti('big'); chime('fanfare') }, 500)
        toast(`🚚 ${n} trips this month — thank you for keeping the sites supplied`, 'success')
      }
    } else {
      buzz(30)
    }
    refresh()
  }

  if (meLoading) return <LoadingRows rows={3} className="mx-auto max-w-xl py-6" />
  if (!staffId) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <Car className="mx-auto mb-3 h-8 w-8 text-slate-300" />
        <p className="text-sm text-slate-500">Your sign-in isn't linked to a staff record yet, so there are no trips to show. Ask HR or admin to link it.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="whitespace-nowrap text-xl font-bold text-slate-800 dark:text-slate-100">My trips</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{me?.staff?.employee_name}</p>
        </div>
        {vehicle && (
          <Link to={`/logistics/vehicles/${vehicle.id}`} className="flex min-w-0 items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <Car className="h-4 w-4 shrink-0 text-brand" />
            <span className="truncate font-semibold text-slate-800 dark:text-slate-100">{vehicle.name}</span>
            {vehicle.plate_number && <span className="whitespace-nowrap text-xs text-slate-400">{vehicle.plate_number}</span>}
          </Link>
        )}
      </div>

      {(papersAllCurrent || tripsThisMonth > 0) && (
        <div className="flex flex-wrap gap-2">
          {papersAllCurrent && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
              <ShieldCheck className="h-3.5 w-3.5" /> Papers all current
            </span>
          )}
          {tripsThisMonth > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700 dark:bg-violet-900/20 dark:text-violet-300">
              🚚 {tripsThisMonth} trip{tripsThisMonth === 1 ? '' : 's'} done this month
            </span>
          )}
        </div>
      )}

      {papersToFix.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800/40 dark:bg-amber-900/10 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Papers to sort before you get stopped</p>
            <p className="text-xs">
              {papersToFix.map(p => `${PAPER_LABEL[p.kind] ?? p.kind} ${p.state === 'missing' ? 'not on file' : p.state === 'expired' ? 'expired' : `expires in ${p.days_left} day${p.days_left === 1 ? '' : 's'}`}`).join(' · ')}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => setLogging(true)} className="flex items-center justify-center gap-2 rounded-2xl bg-brand px-4 py-4 text-base font-semibold text-white shadow-sm active:scale-[.98]">
          <Plus className="h-5 w-5" /> Log a trip
        </button>
        {vehicle?.energy_type === 'fuel' ? (
          <Link to={`/expenses/fuel/new?vehicle_id=${vehicle.id}`} className="flex items-center justify-center gap-2 rounded-2xl border bg-white px-4 py-4 text-base font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
            <Fuel className="h-5 w-5 text-amber-500" /> Fuel
          </Link>
        ) : (
          <Link to="/transportation" className="flex items-center justify-center gap-2 rounded-2xl border bg-white px-4 py-4 text-base font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
            <Truck className="h-5 w-5 text-slate-400" /> All jobs
          </Link>
        )}
      </div>

      {logging && <LogTrip locations={locations as Location[]} projects={projects as { id: string; project_name: string }[]} vehicleId={vehicle?.id ?? null} staffId={staffId}
        onClose={() => setLogging(false)} onSaved={() => { setLogging(false); refresh() }} />}

      <Section title="On the road" empty={null} jobs={onRoad} onAdvance={advance} highlight />
      <Section title="Up next" empty="Nothing waiting — log a trip when you go somewhere" jobs={upNext} onAdvance={advance} />
      <Section title="Done today" empty={null} jobs={doneToday} onAdvance={advance} />
    </div>
  )
}

function Section({ title, jobs, empty, onAdvance, highlight }: { title: string; jobs: Job[]; empty: string | null; onAdvance: (j: Job, button: HTMLElement | null) => void; highlight?: boolean }) {
  if (!jobs.length && !empty) return null
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}{jobs.length ? ` · ${jobs.length}` : ''}</h2>
      {!jobs.length ? <p className="rounded-xl border border-dashed bg-white px-4 py-6 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-800">{empty}</p> : (
        <ul className="space-y-2">
          {jobs.map(j => {
            const from = j.pickup?.location_name ?? j.pickup_location_text
            const to = j.dropoff?.location_name ?? j.dropoff_location_text
            const step = NEXT_STEP[j.job_status]
            const phone = j.dropoff?.contact_phone ?? j.pickup?.contact_phone
            return (
              <li key={j.id} className={`rounded-2xl border bg-white p-4 shadow-sm dark:bg-slate-800 ${highlight ? 'border-violet-300! ring-2 ring-violet-100 dark:border-violet-700! dark:ring-violet-900/30' : 'dark:border-slate-700'}`}>
                <p className="text-base font-semibold text-slate-800 dark:text-slate-100">{j.request_name ?? 'Trip'}</p>
                {(from || to) && (
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
                    <MapPin className="h-3.5 w-3.5" />{from ?? '?'} <ArrowRight className="h-3.5 w-3.5" /> {to ?? '?'}
                  </p>
                )}
                {j.projects?.project_name && <p className="mt-0.5 text-xs text-slate-400">{j.projects.project_name}</p>}
                <div className="mt-3 flex gap-2">
                  {step && (
                    <button onClick={e => onAdvance(j, e.currentTarget)}
                      className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-base font-semibold text-white active:scale-[.98] ${j.job_status === 'in_progress' ? 'bg-emerald-600' : 'bg-violet-600'}`}>
                      {j.job_status === 'in_progress' ? <Check className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                      {j.job_status === 'in_progress' ? "I've arrived — done" : 'Start'}
                    </button>
                  )}
                  {phone && step && (
                    <a href={`tel:${phone}`} className="flex items-center justify-center rounded-xl border px-4 text-slate-600 dark:border-slate-600 dark:text-slate-300" aria-label="Call">
                      <Phone className="h-5 w-5" />
                    </a>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function LogTrip({ locations, projects, vehicleId, staffId, onClose, onSaved }: {
  locations: Location[]; projects: { id: string; project_name: string }[]; vehicleId: string | null; staffId: string
  onClose: () => void; onSaved: () => void
}) {
  const { user } = useAuth()
  const { toast } = useToast()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [kind, setKind] = useState<TransportJobType>('material_move')
  const [projectId, setProjectId] = useState<string | null>(null)
  const [when, setWhen] = useState<'done' | 'now'>('done')
  const [saving, setSaving] = useState(false)
  const placeNames = useMemo(() => [...new Set(locations.flatMap(l => [l.location_name, ...(l.aliases ?? [])]))].sort(), [locations])
  const projectOptions = useMemo(() => projects.map(p => ({ id: p.id, label: p.project_name })), [projects])

  async function save() {
    if (!from.trim() || !to.trim()) { toast('Where from and where to?', 'error'); return }
    setSaving(true)
    const fromPlace = matchPlace(locations, from)
    const toPlace = matchPlace(locations, to)
    const now = new Date().toISOString()
    const { error } = await supabase.from('transportation_requests').insert([{
      request_name: `${fromPlace?.location_name ?? from.trim()} → ${toPlace?.location_name ?? to.trim()}`,
      requested_date: now.slice(0, 10),
      job_type: kind,
      transport_mode: 'own_fleet',
      vehicle_id: vehicleId,
      assigned_staff_id: staffId,
      requested_by_id: user?.id ?? null,
      pickup_location_id: fromPlace?.id ?? null,
      pickup_location_text: from.trim(),
      dropoff_location_id: toPlace?.id ?? null,
      dropoff_location_text: to.trim(),
      project_id: projectId ?? toPlace?.project_id ?? fromPlace?.project_id ?? null,
      priority: 'normal',
      job_status: when === 'done' ? 'completed' : 'in_progress',
      ...(when === 'done' ? { completed_at: now, actual_delivery_date: now.slice(0, 10) } : {}),
    }])
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast(when === 'done' ? 'Trip logged' : 'Trip started', 'success')
    onSaved()
  }

  return (
    <div className="space-y-3 rounded-2xl border bg-white p-4 shadow-lg dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">Log a trip</h2>
        <button onClick={onClose} aria-label="Close" className="rounded-full p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-5 w-5" /></button>
      </div>
      <datalist id="trip-places">{placeNames.map(n => <option key={n} value={n} />)}</datalist>
      <input list="trip-places" className={inputCls} placeholder="From — e.g. Workshop" value={from} onChange={e => setFrom(e.target.value)} />
      <input list="trip-places" className={inputCls} placeholder="To — e.g. Merkato" value={to} onChange={e => setTo(e.target.value)} />
      <Segmented value={kind} onChange={setKind} ariaLabel="What"
        options={[{ value: 'material_move', label: 'Materials' }, { value: 'people_move', label: 'People' }, { value: 'document_courier', label: 'Documents' }]} />
      <SearchableSelect value={projectId} onChange={setProjectId} options={projectOptions} placeholder="For a project? (optional)" />
      <Segmented value={when} onChange={setWhen} ariaLabel="When"
        options={[{ value: 'done', label: 'Already done' }, { value: 'now', label: 'Starting now' }]} />
      <button onClick={save} disabled={saving} className="w-full rounded-xl bg-brand py-3 text-base font-semibold text-white disabled:opacity-50">
        {saving ? 'Saving…' : 'Save trip'}
      </button>
    </div>
  )
}
