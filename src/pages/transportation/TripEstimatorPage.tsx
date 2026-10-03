import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowUpDown, Route, Trophy, Phone, Truck, Info, Calculator, ArrowRight, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { useLocations, locationPickerOptions } from '@/hooks/useLookups'
import { roadRoute } from '@/components/map/geo'
import { PickupBundlesPanel } from '@/components/transport/PickupAdvice'
import { KmRates, NewGround, QuoteLog } from '@/components/transport/MarketResearch'
import {
  CONFIDENCE, LOAD_SIZE, OPTION_CLASS, OPTION_LABEL, useTripEstimate,
  type DriverDeal, type LoadSize, type OptionEstimate, type TripEstimate,
} from '@/lib/tripEstimate'

const card = 'rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800'
const etb = (n: number | null | undefined) => n == null ? '—' : formatCurrency(Math.round(n)).replace(/\.00$/, '')

function bookLink(p: { pickup: string | null; dropoff: string | null; option: OptionEstimate['option']; amount: number | null; driver?: string | null; name?: string }) {
  const q = new URLSearchParams()
  if (p.pickup) q.set('pickup', p.pickup)
  if (p.dropoff) q.set('dropoff', p.dropoff)
  q.set('mode', p.option === 'ride_hailing' ? 'ride_hailing' : 'hired')
  const cls = OPTION_CLASS[p.option]
  if (cls) q.set('class', cls)
  if (p.driver) q.set('driver', p.driver)
  if (p.amount) q.set('amount', String(Math.round(p.amount)))
  if (p.name) q.set('name', p.name)
  return `/transportation/new?${q.toString()}`
}

// A mock trip: where from, where to (or just how far), how big the load —
// and what it would likely cost by each kind of vehicle we hire, with the
// drivers who have been the best deal for trips like it (migration 413).
export default function TripEstimatorPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: locations = [] } = useLocations()
  const options = useMemo(() => locationPickerOptions(locations), [locations])
  const [pickup, setPickup] = useState<string | null>(null)
  const [dropoff, setDropoff] = useState<string | null>(null)
  const [kmTyped, setKmTyped] = useState('')
  const [toText, setToText] = useState('')
  const [size, setSize] = useState<LoadSize>('medium')
  const [routing, setRouting] = useState(false)
  const km = kmTyped.trim() && Number(kmTyped) > 0 ? Number(kmTyped) : null
  const { data: est, isFetching, error } = useTripEstimate(km, pickup, dropoff)

  const from = locations.find(l => l.id === pickup)
  const to = locations.find(l => l.id === dropoff)
  const tripName = from && to ? `${from.location_name} → ${to.location_name}` : undefined

  async function workOutRoad() {
    if (!from || !to || from.latitude == null || to.latitude == null) return
    setRouting(true)
    try {
      const res = await roadRoute([from.latitude, from.longitude!], [to.latitude, to.longitude!])
      if (!res) throw new Error('No road route found between these places')
      const { error: e } = await supabase.from('route_distances').upsert({ from_location_id: from.id, to_location_id: to.id, road_km: res.km, road_minutes: res.minutes, source: 'osrm', computed_at: new Date().toISOString() })
      if (e) throw e
      qc.invalidateQueries({ queryKey: ['trip-estimate'] })
      toast(`${res.km} km by road, about ${res.minutes} minutes`, 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally { setRouting(false) }
  }

  const shown = (est?.options ?? []).filter(o => LOAD_SIZE[size].options.includes(o.option))
  // On new ground nothing is a sure best deal until quotes are in.
  const best = shown.find(o => o.confidence === 'quotes' || ((o.confidence === 'route' || o.confidence === 'good') && !est?.new_ground)) ?? null

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <div>
        <Link to="/transportation" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"><ArrowLeft className="h-4 w-4" /> Transport jobs</Link>
        <h1 className="mt-1 flex items-center gap-2 text-xl font-bold text-slate-900 dark:text-white"><Calculator className="h-5 w-5 text-brand" /> Trip estimator</h1>
        <p className="text-sm text-slate-500">Try a trip before booking it: what it would likely cost, and who has been the best deal for trips like it.</p>
      </div>

      <section className={`${card} grid gap-4 p-4 md:grid-cols-[1fr_auto_1fr_10rem]`}>
        <div>
          <p className="mb-1 text-xs font-medium text-slate-500">From</p>
          <SearchableSelect value={pickup} onChange={v => { setPickup(v); setKmTyped('') }} options={options} placeholder="Pickup place…" />
        </div>
        <button type="button" onClick={() => { setPickup(dropoff); setDropoff(pickup) }} className="w-fit justify-self-center rounded-md border p-2 text-slate-500 hover:bg-slate-50 md:mt-5 md:self-start dark:border-slate-600 dark:hover:bg-slate-700" aria-label="Swap from and to">
          <ArrowUpDown className="h-4 w-4 md:rotate-90" />
        </button>
        <div>
          <p className="mb-1 text-xs font-medium text-slate-500">To</p>
          <SearchableSelect value={dropoff} onChange={v => { setDropoff(v); setKmTyped('') }} options={options} placeholder="Drop-off place…" />
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Or just the distance</span>
          <div className="flex items-center gap-1">
            <input type="number" min={0} step={0.5} value={kmTyped} onChange={e => setKmTyped(e.target.value)} placeholder={est?.km != null ? String(est.km) : 'km'}
              className="w-full rounded-md border px-3 py-2 text-sm tabular-nums dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
            <span className="text-sm text-slate-400">km</span>
          </div>
        </label>
        {!dropoff && (
          <label className="block md:col-span-4">
            <span className="mb-1 block text-xs font-medium text-slate-500">Somewhere not on the list? Name it, and type its distance above</span>
            <input value={toText} onChange={e => setToText(e.target.value)} placeholder="e.g. Adama, Bishoftu, a new site at Legetafo"
              className="w-full rounded-md border px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
          </label>
        )}
        <div className="md:col-span-4">
          <p className="mb-1 text-xs font-medium text-slate-500">Load</p>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(LOAD_SIZE) as LoadSize[]).map(s => (
              <button key={s} type="button" onClick={() => setSize(s)} title={LOAD_SIZE[s].hint}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${size === s ? 'border-brand bg-brand/10 text-brand' : 'text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>
                {LOAD_SIZE[s].label}
              </button>
            ))}
            <span className="self-center text-xs text-slate-400">{LOAD_SIZE[size].hint}</span>
          </div>
        </div>
      </section>

      {error && <p className="text-sm text-red-600">{(error as Error).message}</p>}

      {!est ? (
        <div className={`${card} flex flex-col items-center gap-2 px-6 py-10 text-center text-sm text-slate-500`}>
          <Route className="h-8 w-8 text-slate-300" />
          Pick two places, or type a distance, to see what the trip would cost.
        </div>
      ) : (
        <>
          <Distance est={est} from={from?.location_name} to={to?.location_name} busy={isFetching} routing={routing}
            canRoute={!!from && !!to && from.latitude != null && to.latitude != null && est.distance_source === 'pins' && !km} onRoute={workOutRoad} />
          {est.new_ground && <NewGround est={est} size={size} />}
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">What it would cost</h2>
              {shown.length === 0 && <p className="text-sm text-slate-500">No priced trips with that kind of vehicle yet.</p>}
              {shown.map(o => (
                <OptionCard key={o.option} o={o} best={best?.option === o.option} km={est.km}
                  book={bookLink({ pickup, dropoff, option: o.option, amount: o.estimate, name: tripName })} />
              ))}
              <QuoteLog key={`${pickup}-${dropoff}-${est.km}`} est={est} pickup={pickup} dropoff={dropoff} toText={toText} size={size} />
              <KmRates est={est} />
              <OwnFleet est={est} />
            </section>
            <Drivers est={est} size={size} book={(d) => bookLink({ pickup, dropoff, option: d.option, amount: d.estimate, driver: d.driver_id, name: tripName })} />
          </div>
        </>
      )}

      <PickupBundlesPanel />
    </div>
  )
}

function Distance({ est, from, to, busy, routing, canRoute, onRoute }: { est: TripEstimate; from?: string; to?: string; busy: boolean; routing: boolean; canRoute: boolean; onRoute: () => void }) {
  const what = est.distance_source === 'road' ? `${est.km} km by road${est.road_minutes ? `, about ${Math.round(est.road_minutes)} min without traffic` : ''}`
    : est.distance_source === 'pins' ? `about ${est.km} km (from the map pins — the road distance isn't saved yet)`
    : `${est.km} km`
  return (
    <div className={`flex flex-wrap items-center gap-3 text-sm ${busy ? 'opacity-70' : ''}`}>
      <Route className="h-4 w-4 text-brand" />
      <span className="text-slate-700 dark:text-slate-200">{from && to ? <><b>{from}</b> to <b>{to}</b>: </> : 'Trip of '}{what}</span>
      {canRoute && (
        <button onClick={onRoute} disabled={routing} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300">
          {routing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Route className="h-3 w-3" />} Work out the road distance
        </button>
      )}
    </div>
  )
}

function OptionCard({ o, best, km, book }: { o: OptionEstimate; best: boolean; km: number | null; book: string }) {
  const c = CONFIDENCE[o.confidence]
  const basis = o.confidence === 'quotes' ? `${o.quotes} quotes collected lately`
    : o.confidence === 'per_km' ? (o.call_out != null && o.per_km_rate != null
      ? `the km: ${o.call_out > 0 ? `${etb(o.call_out)} call-out + ` : ''}${etb(o.per_km_rate)} a km, from ${o.km_trips} trips (longest ${o.max_km} km)`
      : `the km: ${etb(o.per_km_avg)} a km on average, from ${o.km_trips} trips (longest ${o.max_km} km)`)
    : o.confidence === 'route' ? `${o.route_jobs} trips on this same route`
    : o.near_jobs > 0 ? `${o.near_jobs} trip${o.near_jobs === 1 ? '' : 's'} of ${o.near_km_low === o.near_km_high ? `${o.near_km_low}` : `${o.near_km_low}–${o.near_km_high}`} km`
    : `${o.jobs} trip${o.jobs === 1 ? '' : 's'}, distance not known`
  return (
    <div className={`${card} flex flex-wrap items-center gap-4 p-4 ${best ? 'ring-2 ring-emerald-500/60' : ''}`}>
      <span className="rounded-full bg-slate-100 p-2 text-slate-500 dark:bg-slate-700"><Truck className="h-4 w-4" /></span>
      <div className="min-w-[12rem] flex-1">
        <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-800 dark:text-slate-100">
          {OPTION_LABEL[o.option]}
          {best && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"><Trophy className="h-3 w-3" /> Best deal</span>}
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${c.cls}`}>{c.label}</span>
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          Based on {basis}{km != null && o.estimate && o.confidence !== 'per_km' ? ` · ≈ ${etb(o.estimate / km)} a km` : ''}
          {o.last_price != null && o.last_date && <> · last paid {etb(o.last_price)} on {formatDate(o.last_date)}</>}
        </p>
      </div>
      <div className="text-right">
        <p className="text-xl font-bold tabular-nums text-slate-900 dark:text-white">{etb(o.estimate)}</p>
        {o.low != null && o.high != null && o.low !== o.high && <p className="text-[11px] tabular-nums text-slate-400">usually {etb(o.low)} – {etb(o.high)}</p>}
      </div>
      <Link to={book} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
        Book <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  )
}

function Drivers({ est, size, book }: { est: TripEstimate; size: LoadSize; book: (d: DriverDeal) => string }) {
  const list = est.drivers.filter(d => LOAD_SIZE[size].options.includes(d.option))
  const proven = list.filter(d => d.rated_jobs >= 2 && d.ratio < 1)
  const once = list.filter(d => d.rated_jobs < 2 && d.ratio < 1)
  const Row = ({ d }: { d: DriverDeal }) => (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{d.name}</p>
        <p className="text-[11px] text-slate-500">
          {OPTION_LABEL[d.option]} · {Math.round((1 - d.ratio) * 100)}% under the going rate on {d.rated_jobs} trip{d.rated_jobs === 1 ? '' : 's'}
          {d.phone && <> · <a href={`tel:${d.phone}`} className="inline-flex items-center gap-0.5 text-brand hover:underline"><Phone className="h-2.5 w-2.5" />{d.phone}</a></>}
        </p>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{etb(d.estimate)}</p>
        <Link to={book(d)} className="text-[11px] font-medium text-brand hover:underline">Book</Link>
      </div>
    </li>
  )
  return (
    <section className={`${card} h-fit overflow-hidden`}>
      <div className="border-b px-4 py-3 dark:border-slate-700">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100"><Trophy className="h-4 w-4 text-amber-500" /> Best deals right now</h2>
        <p className="text-xs text-slate-500">Drivers whose prices have been under the going rate for trips of the same length — and what this trip would likely cost with them.</p>
      </div>
      {proven.length === 0 && once.length === 0 && <p className="px-4 py-4 text-sm text-slate-500">No driver has been under the going rate for this kind of vehicle yet.</p>}
      {proven.length > 0 && <ul className="divide-y dark:divide-slate-700">{proven.slice(0, 6).map(d => <Row key={d.driver_id} d={d} />)}</ul>}
      {once.length > 0 && (
        <>
          <p className="border-t bg-slate-50 px-4 py-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:border-slate-700 dark:bg-slate-900/40">One cheap trip so far — worth a call</p>
          <ul className="divide-y dark:divide-slate-700">{once.slice(0, 5).map(d => <Row key={d.driver_id} d={d} />)}</ul>
        </>
      )}
      <p className="flex gap-1.5 border-t px-4 py-2 text-[11px] text-slate-400 dark:border-slate-700"><Info className="mt-0.5 h-3 w-3 shrink-0" /> Add phone numbers on the Drivers page so the best deals can be called straight from here.</p>
    </section>
  )
}

function OwnFleet({ est }: { est: TripEstimate }) {
  const rows = est.own_fleet.filter(f => f.trips > 0 && f.cost_per_trip)
  if (rows.length === 0) return null
  return (
    <div className="rounded-lg bg-slate-50 px-4 py-3 text-xs text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
      <p className="font-medium text-slate-700 dark:text-slate-200">Our own vehicles, last month, everything counted</p>
      <ul className="mt-1 space-y-0.5">
        {rows.map(f => <li key={f.vehicle}>{f.vehicle}{f.plate ? ` (${f.plate})` : ''}: {etb(f.running_cost)} to run for {f.trips} recorded trip{f.trips === 1 ? '' : 's'} — {etb(f.cost_per_trip)} a trip</li>)}
      </ul>
      <p className="mt-1 text-slate-400">The extra cost of one more trip is mostly fuel — but if trips aren't being recorded, a hired trip may well be cheaper.</p>
    </div>
  )
}
