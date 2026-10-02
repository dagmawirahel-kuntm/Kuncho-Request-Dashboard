import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Product families (migration 405): separate stock items marked as
// versions of one product — a 3 L and a 15 L tin of one Jotun colour, 12 mm
// and 18 mm MDF — so their prices sit side by side instead of reading as a
// price rise. Each keeps its own stock, code and history.

export interface FamilyPriceRow {
  family_id: string
  family_name: string
  base_unit: string | null
  stock_item_id: string
  item_name: string
  item_code: string | null
  unit: string
  variant_label: string | null
  pack_qty: number | null
  catalog_status: string
  latest_price: number | null
  latest_at: string | null
  change_vs_previous_pct: number | null
  min_180d: number | null
  max_180d: number | null
  prices_180d: number | null
  price_per_base: number | null
  family_size: number
}

export interface StockFamily { id: string; name: string; base_unit: string | null }
export interface StockItemLite { id: string; item_name: string; item_code: string | null; unit: string; is_tool: boolean; family_id: string | null }

/** Every variant in every family, for Market Trends. */
export function useAllFamilyPrices(enabled = true) {
  return useQuery({
    queryKey: ['stock-family-prices'],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_stock_item_family_prices').select('*').order('family_name').order('pack_qty', { nullsFirst: false })
      if (error) throw error
      return (data ?? []) as FamilyPriceRow[]
    },
  })
}

/** The variants of one family, cheapest per base unit first. */
export function useFamilyPrices(familyId: string | null | undefined) {
  return useQuery({
    queryKey: ['stock-family-prices', familyId],
    enabled: !!familyId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_stock_item_family_prices').select('*').eq('family_id', familyId!)
      if (error) throw error
      return sortVariants((data ?? []) as FamilyPriceRow[])
    },
  })
}

export function useStockFamilies(enabled = true) {
  return useQuery({
    queryKey: ['stock-families'],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_item_families').select('id, name, base_unit').order('name')
      if (error) throw error
      return (data ?? []) as StockFamily[]
    },
  })
}

/** Active stock items, for picking a sibling or where a price belongs. */
export function useStockItemsLite(enabled = true) {
  return useQuery({
    queryKey: ['stock-items-lite'],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_items').select('id, item_name, item_code, unit, is_tool, family_id').eq('active', true).order('item_name')
      if (error) throw error
      return (data ?? []) as StockItemLite[]
    },
  })
}

export function useRefreshFamilies() {
  const qc = useQueryClient()
  return (stockItemId?: string) => {
    for (const k of ['stock-family-prices', 'stock-families', 'stock-items-lite', 'market-latest-prices']) qc.invalidateQueries({ queryKey: [k] })
    if (stockItemId) qc.invalidateQueries({ queryKey: ['stock-item', stockItemId] })
  }
}

export function useRefreshPrices() {
  const qc = useQueryClient()
  return () => {
    for (const k of ['market-price-history', 'market-latest-prices', 'market-latest-price', 'market-vendor-history', 'stock-family-prices', 'item-variant-prices']) {
      qc.invalidateQueries({ queryKey: [k] })
    }
  }
}

/** Cheapest per base unit first; variants without a size or price last. */
export function sortVariants(rows: FamilyPriceRow[]) {
  return [...rows].sort((a, b) =>
    (a.price_per_base == null ? 1 : 0) - (b.price_per_base == null ? 1 : 0)
    || Number(a.price_per_base ?? 0) - Number(b.price_per_base ?? 0)
    || Number(a.pack_qty ?? 0) - Number(b.pack_qty ?? 0)
    || a.item_name.localeCompare(b.item_name))
}

/** The pack size written into a name — "3L", "15 L", "20kg", "18 mm" — as a first guess. */
export function guessPack(name: string): { qty: number; unit: string } | null {
  const m = name.match(/(\d+(?:[.,]\d+)?)\s*(l|lt|ltr|litre|liter|kg|g|ml|mm|cm|m)\b/i)
  if (!m) return null
  const unit = m[2].toLowerCase()
  const norm = unit.startsWith('l') ? 'L' : unit
  return { qty: Number(m[1].replace(',', '.')), unit: norm }
}

/** The family a stock item belongs to, if any. */
export function useItemFamilyId(stockItemId: string | undefined) {
  return useQuery({
    queryKey: ['stock-family-prices', 'of', stockItemId],
    enabled: !!stockItemId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_items').select('family_id').eq('id', stockItemId!).maybeSingle()
      if (error) throw error
      return (data?.family_id as string | null) ?? null
    },
  })
}
