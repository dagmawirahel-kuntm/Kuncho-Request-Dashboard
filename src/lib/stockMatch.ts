import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Matching typed item names to the stock list (migration 354). The
// database does the real matching (match_stock_items); stockNameKey()
// mirrors stock_name_key() so the form can spot two lines of one request
// that are the same item without a round trip.

export type StockMatchKind = 'same' | 'close' | 'partial'

export interface StockMatch {
  id: string
  item_code: string | null
  item_name: string
  unit: string
  catalog_status: 'active' | 'pending_setup' | 'inactive'
  sub_category_id: string | null
  qty_on_hand: number            // in the warehouse (358)
  qty_delivered_to_sites: number // delivered straight to project sites
  last_price: number | null
  last_price_date: string | null
  match: StockMatchKind
  score: number
  alias_name: string | null
}

export interface StockUnit { code: string; label: string; aliases: string[]; sort_order: number }

export interface StockItemBrief {
  id: string
  item_code: string | null
  item_name: string
  unit: string
  catalog_status: 'active' | 'pending_setup' | 'inactive'
  qty_on_hand: number
  qty_delivered_to_sites: number
}

export interface PurchaseHistoryRow {
  bundle_id: string
  bundle_code: string | null
  vendor_name: string | null
  unit_price: number
  quantity: number | null
  unit: string | null
  bought_on: string
  status: string
  item_name: string
}

const FILLER = new Set(['x', 'by', 'for', 'the', 'of', 'and', 'with', 'ye', 'bale'])

export function stockNameKey(name: string): string {
  const words = name.toLowerCase()
    .replace(/([0-9])([a-z])/g, '$1 $2')
    .replace(/([a-z])([0-9])/g, '$1 $2')
    .replace(/[^a-z0-9.]+|(?<![0-9])\.|\.(?![0-9])/g, ' ')
    .trim()
    .split(/\s+/)
    .map(w => (/^[a-z]{4,}s$/.test(w) && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .filter(w => w && !FILLER.has(w))
  return [...new Set(words)].sort().join(' ')
}

// Used while the unit list loads, and if it can't.
export const FALLBACK_UNITS: StockUnit[] = [
  'pcs', 'box', 'pack', 'set', 'pair', 'm', 'm2', 'm3', 'sheet', 'roll', 'bar', 'tube',
  'kg', 'kuntal', 'bag', 'L', 'ml', 'gallon', 'bucket', 'can', 'lot', 'service', 'trip', 'day',
].map((code, i) => ({ code, label: code, aliases: [], sort_order: i }))

export function useStockUnits() {
  return useQuery({
    queryKey: ['stock-units'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stock_units').select('code, label, aliases, sort_order').eq('active', true).order('sort_order')
      if (error) throw error
      return (data ?? []) as StockUnit[]
    },
  })
}

/** The unit code a typed unit belongs to ("Packet" → "pack"), or null. */
export function canonicalUnit(units: StockUnit[], typed: string | null | undefined): string | null {
  const t = (typed ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (!t) return null
  const u = units.find(u => u.code.toLowerCase() === t || u.aliases.includes(t))
  return u?.code ?? null
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const h = setTimeout(() => setV(value), ms)
    return () => clearTimeout(h)
  }, [value, ms])
  return v
}

export function useStockMatches(query: string, opts: { enabled?: boolean; limit?: number } = {}) {
  const q = useDebounced(query.trim(), 250)
  return useQuery({
    queryKey: ['stock-matches', q, opts.limit ?? 8],
    enabled: (opts.enabled ?? true) && q.length >= 2,
    staleTime: 30_000,
    placeholderData: prev => prev,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('match_stock_items', { p_query: q, p_limit: opts.limit ?? 8 })
      if (error) throw error
      return (data ?? []) as StockMatch[]
    },
  })
}

/** Name, unit and stock for one linked item — whatever its catalogue status. */
export function useStockItemBrief(id: string | null | undefined) {
  return useQuery({
    queryKey: ['stock-item-brief', id],
    enabled: !!id,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_stock_item_usage')
        .select('id, item_code, item_name, unit, catalog_status, qty_on_hand, qty_delivered_to_sites')
        .eq('id', id!)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as StockItemBrief | null
    },
  })
}

export function usePurchaseHistory(stockItemId: string | null, name: string, limit = 5) {
  return useQuery({
    queryKey: ['stock-purchase-history', stockItemId, stockItemId ? '' : stockNameKey(name), limit],
    enabled: !!stockItemId || stockNameKey(name).length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('stock_purchase_history', {
        p_stock_item_id: stockItemId, p_name: name, p_limit: limit,
      })
      if (error) throw error
      return (data ?? []) as PurchaseHistoryRow[]
    },
  })
}

export const STOCK_STATUS_LABEL: Record<string, string> = {
  active: 'In catalogue',
  pending_setup: 'Not set up yet',
  inactive: 'Inactive',
}
