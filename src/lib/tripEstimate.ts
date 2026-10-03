import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// What a trip would cost and who is the best deal (migration 413), and
// pickups from the same area that can share a trip (migration 414).

export type TripOption = 'ride_hailing' | 'other' | 'lada' | 'toyota_carryon' | 'mini_isuzu' | 'isuzu' | 'unknown'
export type Confidence = 'quotes' | 'route' | 'good' | 'per_km' | 'rough' | 'thin'

export interface OptionEstimate {
  option: TripOption
  jobs: number
  estimate: number
  low: number | null
  high: number | null
  route_jobs: number
  route_median: number | null
  near_jobs: number
  near_km_low: number | null
  near_km_high: number | null
  confidence: Confidence
  last_price: number | null
  last_date: string | null
  /** Quotes logged lately for this route or distance (migration 415). */
  quotes: number
  quote_median: number | null
  /** What a km costs: all paid ÷ all km, and split into a call-out and a rate. */
  per_km_avg: number | null
  call_out: number | null
  per_km_rate: number | null
  km_trips: number
  max_km: number | null
  by_km: number | null
  /** Past anything we've done — priced by the km. */
  beyond: boolean
}

export interface QuoteRow {
  id: string
  option: TripOption
  price: number
  km: number | null
  quoted_at: string
  who: string | null
  phone: string | null
  note: string | null
  from: string | null
  to: string | null
}

export interface DriverDeal {
  driver_id: string
  name: string
  phone: string | null
  plate: string | null
  option: TripOption
  vehicle_class: string | null
  payout_method: string | null
  trips: number
  last_trip: string | null
  rated_jobs: number
  /** Their price against the going rate for the distance: 0.8 = 20% under. */
  ratio: number
  estimate: number | null
}

export interface FleetCost {
  vehicle: string
  plate: string | null
  month: string
  trips: number
  running_cost: number
  fuel: number
  cost_per_trip: number | null
}

export interface TripEstimate {
  km: number | null
  road_km: number | null
  road_minutes: number | null
  straight_km: number | null
  distance_source: 'road' | 'pins' | 'given'
  options: OptionEstimate[]
  drivers: DriverDeal[]
  own_fleet: FleetCost[]
  /** A place no trip has touched, or well past our longest trip. */
  new_ground: boolean
  new_ground_reason: string | null
  max_km_on_record: number | null
  quotes: QuoteRow[]
}

export function useTripEstimate(km: number | null, pickup: string | null, dropoff: string | null) {
  return useQuery({
    queryKey: ['trip-estimate', km, pickup, dropoff],
    enabled: km != null || (!!pickup && !!dropoff),
    placeholderData: prev => prev,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('transport_trip_estimate', { p_km: km, p_pickup: pickup, p_dropoff: dropoff })
      if (error) throw error
      return data as TripEstimate
    },
  })
}

export const OPTION_LABEL: Record<TripOption, string> = {
  ride_hailing: 'Ride-hailing', other: 'Other hired vehicle', lada: 'Lada', toyota_carryon: 'Toyota with carry-on',
  mini_isuzu: 'Mini Isuzu', isuzu: 'Isuzu', unknown: 'Hired, vehicle not recorded',
}
/** The hired class to put on a job booked from an estimate. */
export const OPTION_CLASS: Partial<Record<TripOption, string>> = {
  other: 'other', lada: 'lada', toyota_carryon: 'toyota_carryon', mini_isuzu: 'mini_isuzu', isuzu: 'isuzu',
}

export type LoadSize = 'small' | 'medium' | 'large' | 'any'
export const LOAD_SIZE: Record<LoadSize, { label: string; hint: string; options: TripOption[] }> = {
  small: { label: 'Small', hint: 'Fits in a car — boxes, fittings, documents', options: ['ride_hailing', 'other', 'lada'] },
  medium: { label: 'Medium', hint: 'Needs a Lada or a pickup — boards, cement, a few sheets', options: ['lada', 'other', 'toyota_carryon'] },
  large: { label: 'Large', hint: 'Needs a truck — bulk timber, many sheets, furniture', options: ['toyota_carryon', 'mini_isuzu', 'isuzu'] },
  any: { label: 'Any', hint: 'Show every kind of vehicle', options: ['ride_hailing', 'other', 'lada', 'toyota_carryon', 'mini_isuzu', 'isuzu', 'unknown'] },
}

export const CONFIDENCE: Record<Confidence, { label: string; cls: string }> = {
  quotes: { label: 'Quotes collected', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  route: { label: 'This route before', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  good: { label: 'Similar trips', cls: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' },
  per_km: { label: 'By the km — rough', cls: 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' },
  rough: { label: 'Rough', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  thin: { label: 'Too few trips', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
}

// ── Pickups that can share a trip ──────────────────────────────────────

export interface BundleItem {
  bundle_id: string
  bundle_code: string | null
  vendor_name: string | null
  status: string
  payment_state: string | null
  ready: boolean
  total_value?: number | null
  since?: string
  job_id: string | null
  job_status: string | null
}

export interface PickupBundle {
  area_id: string
  area_name: string
  orders: number
  trips_if_separate: number
  ready_now: number
  with_job: number
  oldest: string
  newest: string
  items: BundleItem[]
  typical_price: number | null
  saving: number | null
}

export function usePickupBundles() {
  return useQuery({
    queryKey: ['pickup-bundles'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_pickup_bundles').select('*').order('saving', { ascending: false, nullsFirst: false })
      if (error) throw error
      return (data ?? []) as PickupBundle[]
    },
  })
}

export interface PickupAdvice {
  advice: 'combine' | 'wait' | 'go' | 'unknown'
  title: string | null
  detail: string | null
  area_id?: string
  area_name?: string
  others?: BundleItem[]
  orders_12m?: number
  next_day?: number
  next_two_days?: number
  typical_price?: number | null
}

export function usePickupAdvice(bundleId: string | null | undefined, vendorId: string | null | undefined) {
  return useQuery({
    queryKey: ['pickup-advice', bundleId ?? null, vendorId ?? null],
    enabled: !!bundleId || !!vendorId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pickup_area_advice', { p_bundle: bundleId ?? null, p_vendor: bundleId ? null : vendorId ?? null })
      if (error) throw error
      return data as PickupAdvice
    },
  })
}

export const PAYMENT_WORD: Record<string, string> = {
  paid: 'paid', sent: 'payment sent', advance: 'advance paid', approved_to_pay: 'payment approved', unpaid: 'payment requested',
}

/** A new-job link that books one trip for several orders from one area. */
export function combinedJobLink(areaId: string, areaName: string, items: BundleItem[]): string {
  const codes = items.map(i => i.bundle_code).filter(Boolean).join(', ')
  const q = new URLSearchParams({
    bundle_id: items[0].bundle_id,
    pickup: areaId,
    name: `Pickup — ${areaName}: ${codes}`.slice(0, 200),
    notes: `One trip for ${items.length} orders from ${areaName}: ${codes}.`,
  })
  return `/transportation/new?${q.toString()}`
}

// ── Loading and unloading crews on a trip (migration 415) ──────────────

export interface TripCrew {
  id: string
  transport_request_id: string
  stage: 'loading' | 'unloading' | 'both'
  workers: number | null
  basis: 'lump_sum' | 'per_person'
  rate: number | null
  amount: number
  payee_name: string
  payee_phone: string | null
  payout_method: 'bank' | 'telebirr' | 'cash' | null
  account_number: string | null
  note: string | null
  expense_id: string | null
  created_at: string
}

export const CREW_STAGE: Record<TripCrew['stage'], string> = { loading: 'Loading', unloading: 'Unloading', both: 'Loading and unloading' }
