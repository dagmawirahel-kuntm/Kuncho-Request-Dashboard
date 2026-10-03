import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Building2, Map as MapIcon, Minus, Route as RouteIcon, ShoppingBasket, Truck, Users, Wand2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { RecordHeader, Stat } from '@/components/record/Record'
import { Segmented } from '@/components/shared/Segmented'
import { BaseMap, type MapLine, type MapPin } from '@/components/map/BaseMap'
import { roadRoute } from '@/components/map/geo'
import { formatCurrency, formatDateGC } from '@/lib/utils'
import type { Location } from '@/types/database'

// Transport, read for decisions (migration 405):
//   · what a route usually costs, and whether that is moving;
//   · whether each own vehicle costs less than hiring the same trips;
//   · what transport adds to each project;
//   · where purchases are collected, and trips that could have been one;
//   · which hired carriers are cheap and close their jobs.

type Tab = 'overview' | 'routes' | 'fleet' | 'projects' | 'areas' | 'carriers'

interface RouteCost { pickup_id: string; dropoff_id: string; pickup_name: string; dropoff_name: string; jobs: number; median_price: number; low_price: number; high_price: number; min_price: number; max_price: number; last_price: number; last_date: string; median_recent: number | null; median_before: number | null; km: number | null; km_is_road: boolean }
interface MonthPrice { month: string; transport_mode: string; job_type: string; jobs: number; priced_jobs: number; spend: number; median_price: number | null }
interface FleetMonth { vehicle_id: string; vehicle_name: string; vehicle_type: string; plate_number: string | null; month: string; trips: number; trips_on_known_routes: number; fuel_etb: number; repairs_etb: number; other_etb: number; driver_etb: number; running_cost: number; cost_per_trip: number | null; hire_equivalent: number | null; saved_by_owning: number }
interface ProjectRow { project_id: string; project_name: string; contract_value: number | null; jobs: number; hired_jobs: number; own_trips: number; paid_out: number; own_fleet_estimate: number; pct_of_contract: number | null; last_date: string }
interface AreaRow { pickup_id: string | null; place: string; saved: boolean; pickups: number; spend: number; median_price: number | null; days_with_repeat_trips: number; extra_trips: number; last_date: string }
interface CarrierRow { carrier: string; vendor_id: string | null; jobs: number; priced_jobs: number; spend: number; median_price: number | null; on_time: number; late: number; still_open: number; last_date: string }
interface JobRow { id: string; request_name: string | null; job_date: string; transport_mode: string; job_type: string; job_status: string; vehicle_id: string | null; amount: number | null; pickup_label: string | null; dropoff_label: string | null }

function useView<T>(name: string, order?: string) {
  return useQuery({
    queryKey: ['transport-insights', name],
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      let q = supabase.from(name).select('*')
      if (order) q = q.order(order, { ascending: false })
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as T[]
    },
  })
}

// The views group by calendar month, so the label is the calendar month.
const ec = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
const etb = (n: number | null | undefined) => n == null ? '—' : formatCurrency(Math.round(n))
const BRAND = '#2563eb'

function Trend({ now, before }: { now: number | null | undefined; before: number | null | undefined }) {
  if (!now || !before) return <span className="text-slate-300">—</span>
  const pct = Math.round(((now - before) / before) * 100)
  if (Math.abs(pct) < 5) return <span className="inline-flex items-center gap-0.5 text-slate-500"><Minus className="h-3 w-3" />steady</span>
  return pct > 0
    ? <span className="inline-flex items-center gap-0.5 font-medium text-red-600"><ArrowUpRight className="h-3.5 w-3.5" />{pct}%</span>
    : <span className="inline-flex items-center gap-0.5 font-medium text-emerald-600"><ArrowDownRight className="h-3.5 w-3.5" />{-pct}%</span>
}

export default function TransportInsightsPage() {
  const [tab, setTab] = useState<Tab>('overview')
  const routes = useView<RouteCost>('v_transport_route_costs')
  const months = useView<MonthPrice>('v_transport_month_prices')
  const fleet = useView<FleetMonth>('v_fleet_vs_hire', 'month')
  const projects = useView<ProjectRow>('v_transport_by_project')
  const areas = useView<AreaRow>('v_transport_pickup_areas')
  const carriers = useView<CarrierRow>('v_transport_carriers')
  const jobs = useView<JobRow>('v_transport_jobs_clean', 'job_date')
  const { data: typedLeft = 0 } = useQuery({
    queryKey: ['unsaved-transport-places', 'count'],
    queryFn: async () => {
      const { data } = await supabase.from('v_unsaved_transport_places').select('times')
      return ((data ?? []) as { times: number }[]).reduce((s, r) => s + r.times, 0)
    },
  })

  const allJobs = jobs.data ?? []
  const ownNoVehicle = allJobs.filter(j => j.transport_mode === 'own_fleet' && !j.vehicle_id)
  const [weekAgo] = useState(() => new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10))
  const staleOpen = allJobs.filter(j => j.transport_mode === 'hired' && j.job_status !== 'completed' && j.job_date < weekAgo)

  return (
    <div className="space-y-4">
      <RecordHeader back={{ to: '/logistics', label: 'Fleet & Logistics' }} title="Transport insights"
        subtitle="What routes cost, whether our vehicles pay for themselves, and where trips could be combined" />

      {(typedLeft > 0 || ownNoVehicle.length > 0 || staleOpen.length > 0) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200 space-y-1">
          <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-4 w-4" /> These numbers get better as the records do</p>
          {typedLeft > 0 && <p>· {typedLeft} job ends have a typed place, not a saved one — they can't be counted on a route. <Link to="/locations/tidy" className="font-semibold underline">Tidy up places →</Link></p>}
          {ownNoVehicle.length > 0 && <p>· {ownNoVehicle.length} own-fleet trips don't say which vehicle went, so “own vehicle or hire” counts only the rest. <button onClick={() => setTab('fleet')} className="font-semibold underline">Set the vehicle →</button></p>}
          {staleOpen.length > 0 && <p>· {staleOpen.length} hired jobs are still open more than a week later — close them on Transport Jobs so on-time figures count them.</p>}
        </div>
      )}

      <Segmented value={tab} onChange={setTab} ariaLabel="View" options={[
        { value: 'overview', label: 'Overview', icon: MapIcon },
        { value: 'routes', label: 'Routes', icon: RouteIcon },
        { value: 'fleet', label: 'Own vehicle or hire', icon: Truck },
        { value: 'projects', label: 'Projects', icon: Building2 },
        { value: 'areas', label: 'Pickup areas', icon: ShoppingBasket },
        { value: 'carriers', label: 'Carriers', icon: Users },
      ]} />

      {tab === 'overview' && <Overview months={months.data ?? []} fleet={fleet.data ?? []} routes={routes.data ?? []} areas={areas.data ?? []} />}
      {tab === 'routes' && <Routes routes={routes.data ?? []} loading={routes.isLoading} />}
      {tab === 'fleet' && <FleetVsHire fleet={fleet.data ?? []} unassigned={ownNoVehicle} />}
      {tab === 'projects' && <Projects rows={projects.data ?? []} />}
      {tab === 'areas' && <Areas rows={areas.data ?? []} />}
      {tab === 'carriers' && <Carriers rows={carriers.data ?? []} />}
    </div>
  )
}

// ── Overview ─────────────────────────────────────────────────────────
function useLocations() {
  return useQuery({
    queryKey: ['locations'],
    queryFn: async () => {
      const { data, error } = await supabase.from('locations').select('*').order('location_name')
      if (error) throw error
      return (data ?? []) as Location[]
    },
  })
}

function Overview({ months, fleet, routes, areas }: { months: MonthPrice[]; fleet: FleetMonth[]; routes: RouteCost[]; areas: AreaRow[] }) {
  const { data: locations = [] } = useLocations()
  const byMonth = useMemo(() => {
    const m = new Map<string, { month: string; hired: number; pickupMedian: number | null }>()
    for (const r of months) {
      const x = m.get(r.month) ?? { month: r.month, hired: 0, pickupMedian: null }
      if (r.transport_mode !== 'own_fleet') x.hired += Number(r.spend)
      if (r.transport_mode === 'hired' && r.job_type === 'purchase_pickup') x.pickupMedian = r.median_price
      m.set(r.month, x)
    }
    return [...m.values()].sort((a, b) => a.month.localeCompare(b.month)).map(x => ({ ...x, label: ec(x.month) }))
  }, [months])
  const last = byMonth[byMonth.length - 1], prev = byMonth[byMonth.length - 2]
  const fleetNow = fleet.filter(f => f.month === last?.month).reduce((s, f) => s + Number(f.running_cost), 0)
  const extra = areas.reduce((s, a) => s + a.extra_trips, 0)

  const pinned = new Map(locations.filter(l => l.latitude != null && l.longitude != null).map(l => [l.id, l]))
  const visits = new Map<string, number>()
  for (const r of routes) { visits.set(r.pickup_id, (visits.get(r.pickup_id) ?? 0) + r.jobs); visits.set(r.dropoff_id, (visits.get(r.dropoff_id) ?? 0) + r.jobs) }
  const maxJobs = Math.max(1, ...routes.map(r => r.jobs))
  const lines: MapLine[] = routes.filter(r => pinned.has(r.pickup_id) && pinned.has(r.dropoff_id) && r.pickup_id !== r.dropoff_id).map(r => {
    const a = pinned.get(r.pickup_id)!, b = pinned.get(r.dropoff_id)!
    return { id: `${r.pickup_id}-${r.dropoff_id}`, from: [a.latitude!, a.longitude!], to: [b.latitude!, b.longitude!], width: 2 + (r.jobs / maxJobs) * 6, color: BRAND, label: `${r.jobs} jobs` }
  })
  const pins: MapPin[] = [...pinned.values()].map(l => ({
    id: l.id, name: l.location_name, lat: l.latitude!, lng: l.longitude!,
    sub: visits.get(l.id) ? `${visits.get(l.id)} hired jobs on routes here` : l.area,
    color: l.kind === 'market' || l.kind === 'vendor_shop' ? '#c026d3' : l.kind === 'site' || l.kind === 'client' ? '#059669' : l.kind === 'workshop' || l.kind === 'warehouse' ? '#d97706' : '#2563eb',
    size: 0.9 + Math.min(1, (visits.get(l.id) ?? 0) / maxJobs), label: (visits.get(l.id) ?? 0) > 0,
  }))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label={`Paid for transport · ${last ? ec(last.month) : ''}`} value={etb(last?.hired)} sub={prev ? <>so far · {etb(prev.hired)} in all of {ec(prev.month)}</> : undefined} />
        <Stat label="Usual hired pickup" value={etb(last?.pickupMedian)} sub={<span className="inline-flex items-center gap-1">vs last month <Trend now={last?.pickupMedian} before={prev?.pickupMedian} /></span>} />
        <Stat label={`Own vehicles to run · ${last ? ec(last.month) : ''}`} value={etb(fleetNow)} sub="fuel, repairs, papers, drivers" />
        <Stat label="Trips that could have been one" value={extra} sub="same place, same day — see Pickup areas" tone={extra ? 'amber' : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Paid for hired transport, by month" empty={!byMonth.length}>
          <BarChart data={byMonth} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#e2e8f0" strokeOpacity={0.6} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
            <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={56} tickFormatter={v => `${Math.round(v / 1000)}k`} />
            <Tooltip cursor={{ fill: 'rgba(148,163,184,.12)' }} formatter={v => [etb(Number(v)), 'Paid']} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
            <Bar dataKey="hired" fill={BRAND} radius={[4, 4, 0, 0]} maxBarSize={36} />
          </BarChart>
        </ChartCard>
        <ChartCard title="Usual price of a hired purchase pickup" empty={byMonth.filter(m => m.pickupMedian).length < 1}>
          <LineChart data={byMonth.filter(m => m.pickupMedian)} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#e2e8f0" strokeOpacity={0.6} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
            <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={56} />
            <Tooltip formatter={v => [etb(Number(v)), 'Usual price']} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
            <Line type="monotone" dataKey="pickupMedian" stroke={BRAND} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
          </LineChart>
        </ChartCard>
      </div>

      <div className="rounded-xl border bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Where transport goes</p>
          <p className="flex flex-wrap gap-3 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-full bg-fuchsia-600" />Markets &amp; shops</span>
            <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-600" />Sites &amp; clients</span>
            <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-full bg-amber-600" />Workshop</span>
            <span className="inline-flex items-center gap-1"><i className="inline-block h-0.5 w-4 bg-blue-600" />Route — thicker = more jobs</span>
          </p>
        </div>
        {pins.length === 0
          ? <p className="py-16 text-center text-sm text-slate-400">No places are pinned yet. <Link to="/locations/tidy" className="text-brand underline">Tidy up places</Link> and drop pins to see routes here.</p>
          : <BaseMap pins={pins} lines={lines} height={440} />}
      </div>
    </div>
  )
}

function ChartCard({ title, empty, children }: { title: string; empty: boolean; children: React.ReactElement }) {
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</p>
      {empty ? <p className="py-16 text-center text-sm text-slate-400">Not enough data yet</p> : (
        <div className="mt-3 h-56"><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>
      )}
    </div>
  )
}

// ── Routes ───────────────────────────────────────────────────────────
function Routes({ routes, loading }: { routes: RouteCost[]; loading: boolean }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: locations = [] } = useLocations()
  const loc = useMemo(() => new Map(locations.map(l => [l.id, l])), [locations])
  const [sel, setSel] = useState<RouteCost | null>(null)
  const [path, setPath] = useState<[number, number][] | null>(null)
  const [working, setWorking] = useState(false)
  const sorted = [...routes].sort((a, b) => b.jobs - a.jobs)
  const missing = routes.filter(r => !r.km_is_road && loc.get(r.pickup_id)?.latitude != null && loc.get(r.dropoff_id)?.latitude != null)

  async function select(r: RouteCost) {
    setSel(r); setPath(null)
    const a = loc.get(r.pickup_id), b = loc.get(r.dropoff_id)
    if (a?.latitude == null || b?.latitude == null) return
    try {
      const res = await roadRoute([a.latitude, a.longitude!], [b.latitude, b.longitude!], true)
      if (res?.path) setPath(res.path)
    } catch { /* the straight line is shown instead */ }
  }

  async function workOutDistances() {
    setWorking(true)
    let n = 0
    for (const r of missing) {
      const a = loc.get(r.pickup_id)!, b = loc.get(r.dropoff_id)!
      try {
        const res = await roadRoute([a.latitude!, a.longitude!], [b.latitude!, b.longitude!])
        if (res) {
          await supabase.from('route_distances').upsert({ from_location_id: r.pickup_id, to_location_id: r.dropoff_id, road_km: res.km, road_minutes: res.minutes, source: 'osrm', computed_at: new Date().toISOString() })
          n++
        }
      } catch { /* try the rest */ }
      await new Promise(res => setTimeout(res, 1100)) // the free router asks for one request a second
    }
    setWorking(false)
    qc.invalidateQueries({ queryKey: ['transport-insights'] })
    toast(`Road distance worked out for ${n} route${n === 1 ? '' : 's'}`, 'success')
  }

  const a = sel ? loc.get(sel.pickup_id) : null, b = sel ? loc.get(sel.dropoff_id) : null
  const selPins: MapPin[] = [a, b].filter((x): x is Location => !!x && x.latitude != null).map((x, i) => ({ id: x.id, name: x.location_name, lat: x.latitude!, lng: x.longitude!, color: i === 0 ? '#c026d3' : '#059669', size: 1.2, label: true }))
  const selLine: MapLine[] = sel && a?.latitude != null && b?.latitude != null ? [{ id: 'sel', from: [a.latitude, a.longitude!], to: [b.latitude, b.longitude!], width: 4, color: BRAND, path: path ?? undefined }] : []

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500 dark:text-slate-400">Hired jobs between two saved places. “Usual” is the middle price paid; the range is the middle half of prices. Click a route to see it on the map.</p>
        {missing.length > 0 && (
          <button onClick={workOutDistances} disabled={working} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200">
            <Wand2 className="h-3.5 w-3.5" /> {working ? 'Working out…' : `Work out road distances (${missing.length})`}
          </button>
        )}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="overflow-x-auto rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-900/40">
              <tr><th className="px-3 py-2 text-left font-medium">Route</th><th className="px-2 py-2 text-right font-medium">Jobs</th><th className="px-2 py-2 text-right font-medium">Usual</th><th className="px-2 py-2 text-right font-medium">Range</th><th className="px-2 py-2 text-right font-medium">Last</th><th className="px-2 py-2 text-right font-medium">Trend</th><th className="px-3 py-2 text-right font-medium">Distance</th></tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-700">
              {loading ? <tr><td colSpan={7} className="py-10 text-center text-slate-400">Loading…</td></tr>
                : sorted.length === 0 ? <tr><td colSpan={7} className="py-10 text-center text-sm text-slate-400">No routes yet — they appear once transport jobs point at saved places. <Link to="/locations/tidy" className="text-brand underline">Tidy up places</Link></td></tr>
                : sorted.map(r => (
                  <tr key={r.pickup_id + r.dropoff_id} onClick={() => void select(r)} className={`cursor-pointer ${sel === r ? 'bg-brand/5' : 'hover:bg-slate-50 dark:hover:bg-slate-700/40'}`}>
                    <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-200">{r.pickup_name} <span className="text-slate-400">→</span> {r.dropoff_name}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.jobs}</td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums">{etb(r.median_price)}</td>
                    <td className="px-2 py-2 text-right text-xs tabular-nums text-slate-500">{etb(r.low_price)}–{etb(r.high_price)}</td>
                    <td className={`px-2 py-2 text-right tabular-nums ${r.last_price > r.high_price ? 'text-red-600' : ''}`}>{etb(r.last_price)}</td>
                    <td className="px-2 py-2 text-right text-xs"><Trend now={r.median_recent} before={r.median_before} /></td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-500">{r.km != null ? <>{r.km} km{r.km_is_road ? '' : ' (straight)'}<br />{etb(r.median_price / Math.max(r.km, 0.5))}/km</> : '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div>
          {sel && selPins.length === 2
            ? <BaseMap pins={selPins} lines={selLine} height={420} />
            : <div className="grid h-[420px] place-items-center rounded-xl border bg-white px-6 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-800">{sel ? 'One end of this route has no pin yet — add it from Locations.' : 'Pick a route to see it on the map.'}</div>}
        </div>
      </div>
    </div>
  )
}

// ── Own vehicle or hire ──────────────────────────────────────────────
function FleetVsHire({ fleet, unassigned }: { fleet: FleetMonth[]; unassigned: JobRow[] }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const vehicles = useMemo(() => {
    const m = new Map<string, FleetMonth[]>()
    for (const f of fleet) m.set(f.vehicle_id, [...(m.get(f.vehicle_id) ?? []), f])
    return [...m.values()].map(rows => rows.sort((a, b) => b.month.localeCompare(a.month)))
  }, [fleet])

  async function setVehicle(jobId: string, vehicleId: string) {
    const { error } = await supabase.from('transportation_requests').update({ vehicle_id: vehicleId }).eq('id', jobId)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['transport-insights'] })
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Running cost is fuel, repairs, penalties and papers plus the assigned driver's salary. “Hiring would have cost” prices each trip at what that route usually costs hired — or the month's usual hired price for that kind of job when the route has no hired history.
      </p>
      {vehicles.length === 0 && <p className="rounded-xl border bg-white py-12 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-800">No vehicle costs or trips recorded yet.</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {vehicles.map(rows => {
          const v = rows[0]
          const tot = rows.reduce((s, r) => ({ trips: s.trips + r.trips, cost: s.cost + Number(r.running_cost), hire: s.hire + Number(r.hire_equivalent ?? 0) }), { trips: 0, cost: 0, hire: 0 })
          const saved = tot.hire - tot.cost
          const breakeven = tot.trips && tot.hire ? Math.ceil(tot.cost / (tot.hire / tot.trips)) : null
          return (
            <div key={v.vehicle_id} className="rounded-xl border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <Link to={`/logistics/vehicles/${v.vehicle_id}`} className="text-sm font-semibold text-slate-800 hover:text-brand dark:text-slate-100">{v.vehicle_name}</Link>
                  <p className="text-[11px] text-slate-400">{v.vehicle_type}{v.plate_number ? ` · ${v.plate_number}` : ''}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${saved >= 0 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'}`}>
                  {saved >= 0 ? `Saves ${etb(saved)}` : `Costs ${etb(-saved)} more than hiring`}
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                {tot.trips} recorded trip{tot.trips === 1 ? '' : 's'} for {etb(tot.cost)} to run{tot.trips ? ` — ${etb(tot.cost / tot.trips)} a trip` : ''}. Hiring the same trips: about {etb(tot.hire)}.
                {breakeven != null && saved < 0 && <> It needs about <b>{breakeven} trips</b> in the same period to pay for itself — record every trip it makes.</>}
              </p>
              <table className="mt-3 w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-slate-400"><tr><th className="py-1 text-left font-medium">Month</th><th className="text-right font-medium">Trips</th><th className="text-right font-medium">Run cost</th><th className="text-right font-medium">Per trip</th><th className="text-right font-medium">Hiring</th></tr></thead>
                <tbody className="divide-y dark:divide-slate-700">
                  {rows.map(r => (
                    <tr key={r.month} title={`Fuel ${etb(r.fuel_etb)} · repairs ${etb(r.repairs_etb)} · other ${etb(r.other_etb)} · driver ${etb(r.driver_etb)}`}>
                      <td className="py-1.5 text-slate-600 dark:text-slate-300">{ec(r.month)}</td>
                      <td className="text-right tabular-nums">{r.trips}</td>
                      <td className="text-right tabular-nums">{etb(r.running_cost)}</td>
                      <td className="text-right tabular-nums">{etb(r.cost_per_trip)}</td>
                      <td className="text-right tabular-nums">{etb(r.hire_equivalent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })}
      </div>

      {unassigned.length > 0 && (
        <div className="rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <p className="border-b px-4 py-2.5 text-sm font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100">Own-fleet trips with no vehicle ({unassigned.length})</p>
          <p className="px-4 pt-2 text-xs text-slate-500">Say which vehicle went — each one makes the comparison above fairer.</p>
          <ul className="divide-y dark:divide-slate-700">
            {unassigned.slice(0, 40).map(j => (
              <li key={j.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                <span className="w-24 shrink-0 text-xs text-slate-400">{formatDateGC(j.job_date)}</span>
                <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">{j.request_name ?? `${j.pickup_label ?? '?'} → ${j.dropoff_label ?? '?'}`}</span>
                <VehiclePick onPick={id => void setVehicle(j.id, id)} options={vehicles.map(r => ({ id: r[0].vehicle_id, name: r[0].vehicle_name }))} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function VehiclePick({ options, onPick }: { options: { id: string; name: string }[]; onPick: (id: string) => void }) {
  return (
    <div className="flex gap-1">
      {options.map(o => (
        <button key={o.id} onClick={() => onPick(o.id)} className="rounded-full border px-2.5 py-1 text-xs text-slate-600 hover:border-brand hover:text-brand dark:border-slate-600 dark:text-slate-300">{o.name}</button>
      ))}
    </div>
  )
}

// ── Projects, areas, carriers ────────────────────────────────────────
function Table({ head, children, empty }: { head: string[]; children: React.ReactNode; empty: boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <table className="w-full min-w-[36rem] text-sm">
        <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-900/40">
          <tr>{head.map((h, i) => <th key={h} className={`px-3 py-2 font-medium ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y dark:divide-slate-700">
          {empty ? <tr><td colSpan={head.length} className="py-10 text-center text-sm text-slate-400">Nothing recorded yet</td></tr> : children}
        </tbody>
      </table>
    </div>
  )
}

function Projects({ rows }: { rows: ProjectRow[] }) {
  const sorted = [...rows].sort((a, b) => (Number(b.paid_out) + Number(b.own_fleet_estimate)) - (Number(a.paid_out) + Number(a.own_fleet_estimate)))
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500 dark:text-slate-400">Transport booked against each project. Own-fleet trips are priced at the fleet's average running cost per trip. Only jobs that name a project are counted — set the project on transport jobs to see the true share.</p>
      <Table empty={!sorted.length} head={['Project', 'Jobs', 'Paid out', 'Own fleet (est.)', 'Share of contract']}>
        {sorted.map(r => (
          <tr key={r.project_id}>
            <td className="px-3 py-2"><Link to={`/projects/${r.project_id}`} className="font-medium text-slate-700 hover:text-brand dark:text-slate-200">{r.project_name}</Link></td>
            <td className="px-3 py-2 text-right tabular-nums">{r.jobs}</td>
            <td className="px-3 py-2 text-right tabular-nums">{etb(r.paid_out)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{r.own_trips ? etb(r.own_fleet_estimate) : '—'}</td>
            <td className={`px-3 py-2 text-right tabular-nums ${Number(r.pct_of_contract) > 3 ? 'font-semibold text-red-600' : ''}`}>{r.pct_of_contract != null ? `${r.pct_of_contract}%` : <span className="text-xs text-slate-400">no contract value</span>}</td>
          </tr>
        ))}
      </Table>
    </div>
  )
}

function Areas({ rows }: { rows: AreaRow[] }) {
  const sorted = [...rows].sort((a, b) => b.pickups - a.pickups)
  const extra = rows.reduce((s, r) => s + r.extra_trips, 0)
  const extraCost = rows.reduce((s, r) => s + r.extra_trips * Number(r.median_price ?? 0), 0)
  return (
    <div className="space-y-2">
      {extra > 0 && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:border-sky-900/50 dark:bg-sky-900/20 dark:text-sky-200">
          <b>{extra} extra trips</b> went to the same place on the same day as another pickup — about <b>{etb(extraCost)}</b> that one combined trip could have saved. Before booking, check the other purchase orders collecting from the same area.
        </div>
      )}
      <Table empty={!sorted.length} head={['Where purchases are collected', 'Pickups', 'Paid', 'Usual price', 'Same-day repeats']}>
        {sorted.map(r => (
          <tr key={r.place}>
            <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-200">{r.place}{!r.saved && <span className="ml-2 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">typed</span>}</td>
            <td className="px-3 py-2 text-right tabular-nums">{r.pickups}</td>
            <td className="px-3 py-2 text-right tabular-nums">{etb(r.spend)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{etb(r.median_price)}</td>
            <td className={`px-3 py-2 text-right tabular-nums ${r.extra_trips ? 'font-semibold text-amber-600' : 'text-slate-400'}`}>{r.extra_trips ? `${r.extra_trips} extra on ${r.days_with_repeat_trips} day${r.days_with_repeat_trips === 1 ? '' : 's'}` : '—'}</td>
          </tr>
        ))}
      </Table>
    </div>
  )
}

function Carriers({ rows }: { rows: CarrierRow[] }) {
  const sorted = [...rows].sort((a, b) => b.jobs - a.jobs)
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500 dark:text-slate-400">Hired transport by who carried it. “Open” are jobs more than a week old that were never closed — close them so the on-time rate means something.</p>
      <Table empty={!sorted.length} head={['Carrier', 'Jobs', 'Paid', 'Usual price', 'On time', 'Open']}>
        {sorted.map(r => {
          const judged = r.on_time + r.late
          return (
            <tr key={r.carrier + (r.vendor_id ?? '')}>
              <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-200">{r.vendor_id ? <Link to={`/vendors/${r.vendor_id}`} className="hover:text-brand">{r.carrier}</Link> : r.carrier}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.jobs}</td>
              <td className="px-3 py-2 text-right tabular-nums">{etb(r.spend)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{etb(r.median_price)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{judged ? `${Math.round((r.on_time / judged) * 100)}% of ${judged}` : <span className="text-xs text-slate-400">not tracked</span>}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${r.still_open ? 'text-amber-600' : 'text-slate-400'}`}>{r.still_open || '—'}</td>
            </tr>
          )
        })}
      </Table>
    </div>
  )
}
