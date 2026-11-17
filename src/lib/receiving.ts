import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { DeliveryPhoto } from '@/types/database'

// Receiving where the goods are (520): the buyer records what was collected,
// the site has three days to say something is wrong, and every order still
// waiting for its goods is on one list.

export type DeliveryMode = 'collect' | 'vendor_delivers'

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

/** Who took the goods and their signature (529); a photo or this is enough. */
export interface CollectionSigned { signature: string; name: string; phone?: string; driverId?: string | null; plate?: string }

export async function recordCollection(bundleId: string, lines: CollectedLine[], photos: DeliveryPhoto[], notes?: string, vendorReceipt?: string, signed?: CollectionSigned | null) {
  const { data, error } = await supabase.rpc('record_collection', {
    p_bundle: bundleId, p_lines: lines, p_photos: photos, p_notes: notes || null, p_vendor_receipt: vendorReceipt || null,
    p_signature: signed?.signature ?? null, p_signed_by: signed?.name.trim() || null, p_signed_phone: signed?.phone?.trim() || null,
    p_driver: signed?.driverId ?? null, p_plate: signed?.plate?.trim() || null,
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
  return mode === 'vendor_delivers' ? `The vendor delivers${d ? ` on ${d}` : ''}` : `We collect it${d ? ` on ${d}` : ''}`
}
