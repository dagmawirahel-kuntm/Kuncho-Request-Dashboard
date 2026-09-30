import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Item variants (migration 372): what tells products of one material
// family apart, and the products themselves, so prices are compared like
// with like.

export type AttributeKind = 'choice' | 'number' | 'text'

export interface FamilyAttribute {
  id: string
  category_id: string
  key: string
  label: string
  kind: AttributeKind
  options: string[]
  unit: string | null
  sort_order: number
  is_draft: boolean
}

export interface ItemVariant {
  id: string
  stock_item_id: string
  attributes: Record<string, string>
  brand: string | null
  pack_qty: number
  base_unit: string | null
  label: string
  active: boolean
  notes: string | null
}

export interface VariantPriceRow {
  variant_id: string
  stock_item_id: string
  label: string
  attributes: Record<string, string>
  brand: string | null
  pack_qty: number
  base_unit: string | null
  active: boolean
  latest_price: number | null
  latest_at: string | null
  latest_source: string | null
  latest_vendor_name: string | null
  latest_price_per_base: number | null
  compare_unit: string | null
  latest_is_outlier: boolean
  previous_price: number | null
  change_vs_previous_pct: number | null
  prices: number
  min_price: number | null
  max_price: number | null
  days_old: number | null
}

export interface ReviewQueueRow {
  price_id: string
  stock_item_id: string
  item_name: string
  item_unit: string | null
  reason: 'untagged' | 'outlier'
  unit_price: number
  unit: string | null
  sourced_at: string
  source: string
  source_reference: string | null
  vendor_name: string | null
  variant_id: string | null
  variant_label: string | null
  variant_median: number | null
  bought_as: string | null
  bought_spec: string | null
  variant_count: number
}

export interface ItemNeedingVariants {
  stock_item_id: string
  item_name: string
  unit: string | null
  family: string | null
  category_id: string | null
  prices: number
  min_price: number
  max_price: number
  spread: number
  bought_as: string | null
}

export function useFamilyAttributes(categoryId?: string | null) {
  return useQuery({
    queryKey: ['family-attributes', categoryId ?? 'all'],
    staleTime: 60_000,
    queryFn: async () => {
      let q = supabase.from('material_family_attributes').select('*').order('sort_order').order('label')
      if (categoryId) q = q.eq('category_id', categoryId)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as FamilyAttribute[]
    },
    enabled: categoryId !== null,
  })
}

/** Active variants of the given stock items, keyed by item. */
export function useVariantsForItems(stockItemIds: (string | null | undefined)[]) {
  const ids = [...new Set(stockItemIds.filter((x): x is string => !!x))].sort()
  return useQuery({
    queryKey: ['item-variants', ids],
    staleTime: 30_000,
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('item_variants').select('*').in('stock_item_id', ids).eq('active', true).order('label')
      if (error) throw error
      const m = new Map<string, ItemVariant[]>()
      for (const v of (data ?? []) as ItemVariant[]) m.set(v.stock_item_id, [...(m.get(v.stock_item_id) ?? []), v])
      return m
    },
  })
}

export function useVariantPrices(stockItemId: string | undefined) {
  return useQuery({
    queryKey: ['item-variant-prices', stockItemId],
    staleTime: 30_000,
    enabled: !!stockItemId,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_item_variant_prices').select('*').eq('stock_item_id', stockItemId!).eq('active', true).order('label')
      if (error) throw error
      return (data ?? []) as VariantPriceRow[]
    },
  })
}

/** Everything that changes when a variant or a price's variant changes. */
export function useInvalidateVariantData() {
  const qc = useQueryClient()
  return () => {
    for (const k of ['item-variants', 'item-variant-prices', 'price-review-queue', 'items-needing-variants',
      'market-latest-prices', 'market-latest-price', 'market-price-history', 'market-free-text-prices', 'market-search']) {
      qc.invalidateQueries({ queryKey: [k] })
    }
  }
}

/** "16 mm · White · Bale · 15 L" — the same reading the database gives the label. */
export function variantPreview(attrs: FamilyAttribute[], values: Record<string, string>, brand: string, packQty: string, baseUnit: string) {
  const parts = attrs
    .filter(a => (values[a.key] ?? '').trim())
    .map(a => `${values[a.key].trim()}${a.kind === 'number' && a.unit ? ` ${a.unit}` : ''}`)
  const extra = Object.entries(values).filter(([k, v]) => !attrs.some(a => a.key === k) && k !== 'brand' && v.trim()).map(([, v]) => v.trim())
  const pack = Number(packQty)
  return [...parts, ...extra, brand.trim(), (pack && pack !== 1) || baseUnit.trim() ? `${pack || 1}${baseUnit.trim() ? ` ${baseUnit.trim()}` : ''}` : '']
    .filter(Boolean).join(' · ') || 'Standard'
}
