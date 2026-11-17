// The dispatch board (530): open transport jobs run by logistics on the
// phone. Hired drivers and vendors don't log in, so every step here is
// taken by our own people; the driver only ever gets a read-only trip sheet.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface DispatchRow {
  id: string
  request_name: string | null
  job_type: string | null
  job_status: 'requested' | 'assigned' | 'in_progress' | 'completed'
  transport_mode: 'hired' | 'own_fleet' | 'ride_hailing' | string
  priority: string | null
  requested_date: string | null
  expected_delivery_date: string | null
  days_late: number | null
  project_name: string | null
  pickup: string | null
  pickup_lat: number | null
  pickup_lng: number | null
  pickup_phone: string | null
  dropoff: string | null
  dropoff_lat: number | null
  dropoff_lng: number | null
  dropoff_phone: string | null
  site_contact: string | null
  vendor_name: string | null
  vendor_phone: string | null
  hired_driver_id: string | null
  hired_driver: string | null
  hired_driver_phone: string | null
  hired_plate: string | null
  driver_blocked: boolean | null
  staff_driver: string | null
  staff_driver_phone: string | null
  vehicle_name: string | null
  vehicle_plate: string | null
  driver_name: string | null
  sourcing_bundle_id: string | null
  bundle_code: string | null
  po_status: string | null
  po_open_lines: number
  amount: number | null
  expense_id: string | null
  delivery_proof: string | null
  delivered_confirmed_at: string | null
  delivered_confirmed_by_name: string | null
  sheet_token: string
  sheet_sent_at: string | null
  last_event: string | null
  last_event_note: string | null
  last_event_at: string | null
  last_event_by: string | null
  buyer_id: string | null       // the PO's buyer — the only one who signs for its goods (531)
  buyer_name: string | null
}

/** How a job's delivery was confirmed, in a few words. */
export const PROOF_LABEL: Record<string, string> = {
  collection_signed: 'signed at collection',
  site_signed: 'site signed',
  goods_received: 'goods received',
  staff_confirmed: 'confirmed by logistics',
  paid_at_gate: 'paid at the gate',
  marked_done: 'marked done',
  cleanup: 'closed at clean-up',
}

export const driverOf = (r: DispatchRow) => ({
  name: r.hired_driver ?? r.staff_driver ?? r.driver_name ?? null,
  phone: r.hired_driver_phone ?? r.staff_driver_phone ?? null,
  plate: r.hired_plate ?? r.vehicle_plate ?? null,
})

export function useDispatchBoard() {
  return useQuery({
    queryKey: ['dispatch-board'],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_dispatch_board').select('*')
        .order('expected_delivery_date', { ascending: true, nullsFirst: false })
      if (error) throw error
      return (data ?? []) as DispatchRow[]
    },
  })
}

export function useDispatchRefresh() {
  const qc = useQueryClient()
  return () => {
    for (const k of ['dispatch-board', 'transportation-requests', 'transport-drivers', 'sourcing-bundles', 'grn-register']) qc.invalidateQueries({ queryKey: [k] })
  }
}

export const sheetUrl = (token: string) => `${window.location.origin}/trip/${token}`

/** The words that go with the link, in English and Amharic. */
export function sheetMessage(r: DispatchRow) {
  const d = driverOf(r)
  return [
    `${d.name ? `${d.name}, ` : ''}your trip / የጉዞ ዝርዝር: ${r.request_name ?? 'Kuncho trip'}`,
    `${r.pickup ?? '?'} → ${r.dropoff ?? '?'}`,
    sheetUrl(r.sheet_token),
  ].join('\n')
}

/** sms: link with the message — opens the phone's messages app. */
export function smsHref(phone: string | null, body: string) {
  const to = (phone ?? '').replace(/[^\d+]/g, '')
  return `sms:${to}?&body=${encodeURIComponent(body)}`
}

export function telegramHref(url: string, text: string) {
  return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`
}

export const mapHref = (lat: number | null, lng: number | null, name?: string | null) =>
  lat != null && lng != null ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
    : name ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}` : null
