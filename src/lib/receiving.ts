import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { DeliveryPhoto } from '@/types/database'

// Receiving where the goods are (520): the buyer records what was collected,
// the site has three days to say something is wrong, and every order still
// waiting for its goods is on one list.

/** How a PO's goods travel (531). 'collect' is the old value and reads as a hired truck. */
export type DeliveryMode = 'hired' | 'own_truck' | 'vendor_delivers' | 'collect'
export const DELIVERY_MODES: { value: DeliveryMode; label: string; hint: string }[] = [
  { value: 'hired', label: 'Hired truck', hint: 'Found on the day — the buyer records the driver and fare when marking it collected' },
  { value: 'own_truck', label: 'Our truck', hint: 'Book our truck ahead from this order' },
  { value: 'vendor_delivers', label: 'The vendor delivers', hint: 'No transport from us — the site signs the delivery note' },
]
export const isFetched = (m: DeliveryMode | null | undefined) => m !== 'vendor_delivers'

export interface ToCollect {
  bundle_id: string
  bundle_code: string
  vendor_name: string | null
  vendor_id: string | null
  officer_id: string | null
  officer: string | null
  ordered_on: string | null
  due: string | null
  delivery_mode: DeliveryMode
  days_waiting: number
  total: number
  paid_ahead: number
  bank_paid: boolean
  received_any: boolean
  lines_out: number
  projects: string | null
  trip: string | null
  open_problems: number
}

export type ProblemKind = 'not_arrived' | 'short' | 'damaged' | 'wrong' | 'other'
export const PROBLEM_KIND: Record<ProblemKind, string> = {
  not_arrived: "It didn't arrive",
  short: 'Less came',
  damaged: 'It came damaged',
  wrong: 'The wrong goods came',
  other: 'Something else',
}

export interface ReceiptProblem {
  id: string
  grn_id: string
  sourcing_bundle_id: string | null
  kind: ProblemKind
  note: string
  photos: DeliveryPhoto[]
  raised_by: string | null
  raised_by_name: string | null
  raised_at: string
  resolved_at: string | null
  resolved_by_name: string | null
  resolution: string | null
  goods_received_notes?: { grn_code: string | null } | null
  sourcing_bundles?: { bundle_code: string; vendor_name: string | null } | null
}

export interface OpenAdvance { bundle_id: string; bundle_code: string; ordered_on: string; days: number; paid_ahead: number }

/** The site has this many days after a receipt to report a problem with it. */
export const PROBLEM_DAYS = 3

export function useGoodsToCollect(enabled = true) {
  return useQuery({
    queryKey: ['goods-to-collect'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('goods_to_collect')
      if (error) throw error
      return (data ?? []) as ToCollect[]
    },
  })
}

export function useOpenReceiptProblems(enabled = true) {
  return useQuery({
    queryKey: ['receipt-problems', 'open'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('goods_receipt_problems')
        .select('*, goods_received_notes(grn_code), sourcing_bundles(bundle_code, vendor_name)')
        .is('resolved_at', null).order('raised_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as ReceiptProblem[]
    },
  })
}

export function useReceiptProblems(grnId: string | undefined) {
  return useQuery({
    queryKey: ['receipt-problems', grnId],
    enabled: !!grnId,
    queryFn: async () => {
      const { data, error } = await supabase.from('goods_receipt_problems').select('*').eq('grn_id', grnId!).order('raised_at')
      if (error) throw error
      return (data ?? []) as ReceiptProblem[]
    },
  })
}

export function useVendorOpenAdvances(vendorId: string | null | undefined, except: { bundleId?: string; expenseId?: string } = {}) {
  return useQuery({
    queryKey: ['vendor-open-advances', vendorId, except.bundleId ?? null, except.expenseId ?? null],
    enabled: !!vendorId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('vendor_open_advances', {
        p_vendor: vendorId!, p_except_bundle: except.bundleId ?? null, p_except_expense: except.expenseId ?? null,
      })
      if (error) throw error
      return (data ?? []) as OpenAdvance[]
    },
  })
}

export function useStockToCheckAfterCleanup(enabled = true) {
  return useQuery({
    queryKey: ['stock-to-check-after-cleanup'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('stock_to_check_after_cleanup')
      if (error) throw error
      return (data ?? []) as { stock_item_id: string; item_name: string; unit: string | null; warehouse_zone: string | null; added: number; added_on: string }[]
    },
  })
}

export type CollectedLine = { id: string; received: number; damaged?: number; note?: string }

/** How it travelled (531): a hired truck carries its driver and fare. */
export interface CollectionTruck { kind: 'hired' | 'own' | 'vendor'; driverId?: string | null; driverPhone?: string; plate?: string; fare?: number | null }

/** The buyer's signature (only the PO's buyer may sign) or a photo, and the truck. */
export async function recordCollection(bundleId: string, lines: CollectedLine[], photos: DeliveryPhoto[], notes?: string, vendorReceipt?: string,
  signature?: string | null, truck?: CollectionTruck | null) {
  const { data, error } = await supabase.rpc('record_collection', {
    p_bundle: bundleId, p_lines: lines, p_photos: photos, p_notes: notes || null, p_vendor_receipt: vendorReceipt || null,
    p_signature: signature ?? null, p_truck: truck?.kind ?? null,
    p_driver: truck?.kind === 'hired' ? truck.driverId ?? null : null,
    p_driver_phone: truck?.driverPhone?.trim() || null, p_plate: truck?.plate?.trim() || null,
    p_fare: truck?.kind === 'hired' ? truck.fare ?? null : null,
  })
  if (error) throw error
  return data as string
}

export async function reportReceiptProblem(grnId: string, kind: ProblemKind, note: string, photos: DeliveryPhoto[]) {
  const { error } = await supabase.rpc('report_receipt_problem', { p_grn: grnId, p_kind: kind, p_note: note, p_photos: photos })
  if (error) throw error
}

export async function resolveReceiptProblem(id: string, note: string) {
  const { error } = await supabase.rpc('resolve_receipt_problem', { p_id: id, p_note: note })
  if (error) throw error
}

export async function setPoDelivery(bundleId: string, mode: DeliveryMode, date: string) {
  const { error } = await supabase.rpc('set_po_delivery', { p_bundle: bundleId, p_mode: mode, p_date: date })
  if (error) throw error
}

/** "We collect on Mon 16 Nov" / "The vendor delivers on …" */
export function deliveryWords(mode: DeliveryMode | null | undefined, date: string | null | undefined) {
  const d = date ? new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : null
  return mode === 'vendor_delivers' ? `The vendor delivers${d ? ` on ${d}` : ''}`
    : mode === 'own_truck' ? `Our truck collects it${d ? ` on ${d}` : ''}`
    : `We collect it with a hired truck${d ? ` on ${d}` : ''}`
}

export const EMPTY_TRUCK: CollectionTruck = { kind: 'hired', driverId: null, driverPhone: '', plate: '', fare: null }

/** What still has to be filled in about the truck, or null when it's ready. */
export function truckProblem(t: CollectionTruck): string | null {
  if (t.kind !== 'hired') return null
  if (!t.driverId) return 'Pick the driver who carried it (or add him)'
  if (!(Number(t.fare) > 0)) return 'Enter the fare agreed with the driver'
  return null
}
