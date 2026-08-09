import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export type Freshness = 'fresh' | 'aging' | 'stale' | 'outdated'
export type Volatility = 'volatile' | 'moderate' | 'stable'

export interface LatestPriceRow {
  stock_item_id: string
  item_name: string
  amharic_name: string | null
  item_code: string
  unit: string
  sub_category_id: string | null
  volatility: Volatility
  latest_any_price: number | null
  latest_any_sourced_at: string | null
  latest_any_source: string | null
  latest_any_vendor_id: string | null
  latest_verified_price: number | null
  latest_verified_sourced_at: string | null
  display_price: number | null
  display_price_source: string | null
  display_price_sourced_at: string | null
  days_since_display_price: number | null
  freshness: Freshness
  price_trend_90d_pct: number | null
}

// Latest price + freshness view — the primary UI surface for Market Trends
// and the order-form price suggestion. Everything computed on read (spec §31).
export function useLatestPrices() {
  return useQuery({
    queryKey: ['market-latest-prices'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_stock_item_latest_price').select('*')
      if (error) throw error
      return (data ?? []) as LatestPriceRow[]
    },
  })
}

export function useLatestPrice(stockItemId: string | undefined) {
  return useQuery({
    enabled: !!stockItemId,
    queryKey: ['market-latest-price', stockItemId],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_stock_item_latest_price')
        .select('*')
        .eq('stock_item_id', stockItemId!)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as LatestPriceRow | null
    },
  })
}

export interface HistoryRow {
  id: string
  unit_price: number
  currency: string
  unit: string
  source: 'po_entry' | 'verified_quote' | 'check_request_response'
  vendor_id: string | null
  vendor_name: string | null
  source_reference: string | null
  sourced_at: string
  sourced_by_staff_id: string | null
  sourced_by_name: string | null
  notes: string | null
}

export function usePriceHistory(stockItemId: string | undefined, fromDate?: string, toDate?: string) {
  return useQuery({
    enabled: !!stockItemId,
    queryKey: ['market-price-history', stockItemId, fromDate, toDate],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('v_market_price_history', {
        p_stock_item_id: stockItemId!, p_from_date: fromDate ?? null, p_to_date: toDate ?? null,
      })
      if (error) throw error
      return (data ?? []) as HistoryRow[]
    },
  })
}

export interface VendorHistoryRow {
  stock_item_id: string
  vendor_id: string
  vendor_name: string | null
  quotes_count: number
  average_price: number
  last_sourced_at: string
  latest_price: number
}

export function useVendorHistory(stockItemId: string | undefined) {
  return useQuery({
    enabled: !!stockItemId,
    queryKey: ['market-vendor-history', stockItemId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_stock_item_vendor_history')
        .select('*')
        .eq('stock_item_id', stockItemId!)
        .order('last_sourced_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as VendorHistoryRow[]
    },
  })
}

export function useFreshnessConfig() {
  return useQuery({
    queryKey: ['market-freshness-config'],
    staleTime: 600_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('market_price_freshness_config').select('*')
      if (error) throw error
      return (data ?? []) as { volatility: Volatility; fresh_days_max: number; aging_days_max: number; stale_days_max: number }[]
    },
  })
}

export function useLogVerifiedPrice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: {
      stock_item_id?: string | null; unit_price: number; vendor_id?: string | null;
      notes?: string; source_reference?: string;
      sub_category_id?: string | null; item_description?: string | null; unit?: string | null;
      brand?: string | null; specification?: string | null;
    }) => {
      const { data, error } = await supabase.rpc('log_verified_market_price', {
        p_stock_item_id: p.stock_item_id ?? null,
        p_unit_price: p.unit_price,
        p_vendor_id: p.vendor_id ?? null,
        p_notes: p.notes ?? null,
        p_source_reference: p.source_reference ?? null,
        p_sub_category_id: p.sub_category_id ?? null,
        p_item_description: p.item_description ?? null,
        p_unit: p.unit ?? null,
        p_brand: p.brand ?? null,
        p_specification: p.specification ?? null,
      })
      if (error) throw error
      return data as string
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['market-latest-prices'] })
      if (vars.stock_item_id) {
        qc.invalidateQueries({ queryKey: ['market-latest-price', vars.stock_item_id] })
        qc.invalidateQueries({ queryKey: ['market-price-history', vars.stock_item_id] })
        qc.invalidateQueries({ queryKey: ['market-vendor-history', vars.stock_item_id] })
      }
      qc.invalidateQueries({ queryKey: ['sub-category-latest-price'] })
    },
  })
}

export interface SubCategoryPriceRow {
  id: string
  sub_category_id: string
  sub_category_name: string
  item_description: string | null
  brand: string | null
  specification: string | null
  unit_price: number
  currency: string
  unit: string
  source: string
  vendor_name: string | null
  source_reference: string | null
  sourced_at: string
  sourced_by_name: string | null
  notes: string | null
  days_since_sourced: number
}

export interface BrandRow {
  id: string
  stock_item_id: string | null
  sub_category_id: string | null
  brand_name: string
  specification: string | null
  notes: string | null
  active: boolean
  created_at: string
}

// Brands for a specific stock_item OR sub_category. Item-scoped brands are
// added onto category-scoped brands so a datalist shows both.
export function useItemBrands(anchor: { stock_item_id?: string | null; sub_category_id?: string | null }) {
  return useQuery({
    enabled: !!(anchor.stock_item_id || anchor.sub_category_id),
    queryKey: ['item-brands', anchor.stock_item_id ?? null, anchor.sub_category_id ?? null],
    staleTime: 60_000,
    queryFn: async () => {
      const filters: string[] = []
      if (anchor.stock_item_id)   filters.push(`stock_item_id.eq.${anchor.stock_item_id}`)
      if (anchor.sub_category_id) filters.push(`sub_category_id.eq.${anchor.sub_category_id}`)
      const { data, error } = await supabase.from('item_brands').select('*').eq('active', true).or(filters.join(','))
      if (error) throw error
      return (data ?? []) as BrandRow[]
    },
  })
}

export function useAllBrands() {
  return useQuery({
    queryKey: ['item-brands-all'],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('item_brands')
        .select('*, stock_items(item_name, item_code), sub_categories(item_name)')
        .order('brand_name')
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []) as any[]
    },
  })
}

export function useSubCategoryLatestPrices() {
  return useQuery({
    queryKey: ['sub-category-latest-price'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_sub_category_latest_price').select('*').order('sourced_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as SubCategoryPriceRow[]
    },
  })
}

export interface CheckRequestRow {
  id: string
  stock_item_id: string
  requested_by_staff_id: string
  project_id: string | null
  order_item_id: string | null
  reason: string | null
  needed_by: string | null
  status: 'open' | 'fulfilled' | 'cancelled'
  fulfilled_by_market_price_id: string | null
  fulfilled_at: string | null
  cancelled_reason: string | null
  cancelled_at: string | null
  created_at: string
}

export function useCheckRequests(scope: 'all_open' | 'mine' | 'all') {
  return useQuery({
    queryKey: ['market-check-requests', scope],
    staleTime: 30_000,
    queryFn: async () => {
      let q = supabase
        .from('market_price_check_requests')
        .select('*, stock_items(item_name, unit, item_code), sub_categories(item_name), requester:staff!market_price_check_requests_requested_by_staff_id_fkey(employee_name), projects(project_name)')
      if (scope === 'all_open') q = q.eq('status', 'open')
      const { data, error } = await q.order('needed_by', { ascending: true, nullsFirst: false }).order('created_at')
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []) as any[]
    },
  })
}

export function useRequestPriceCheck() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: {
      stock_item_id?: string | null; project_id?: string | null;
      reason?: string; needed_by?: string; order_item_id?: string;
      sub_category_id?: string | null; item_description?: string | null;
      brand?: string | null; specification?: string | null;
    }) => {
      const { data, error } = await supabase.rpc('request_market_price_check', {
        p_stock_item_id: p.stock_item_id ?? null,
        p_project_id: p.project_id ?? null,
        p_reason: p.reason ?? null,
        p_needed_by: p.needed_by ?? null,
        p_order_item_id: p.order_item_id ?? null,
        p_sub_category_id: p.sub_category_id ?? null,
        p_item_description: p.item_description ?? null,
        p_brand: p.brand ?? null,
        p_specification: p.specification ?? null,
      })
      if (error) throw error
      return data as string
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['market-check-requests'] }) },
  })
}

export function useFulfillPriceCheck() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: { request_id: string; unit_price: number; vendor_id?: string | null; notes?: string; brand?: string | null; specification?: string | null }) => {
      const { data, error } = await supabase.rpc('fulfill_market_price_check', {
        p_request_id: p.request_id, p_unit_price: p.unit_price,
        p_vendor_id: p.vendor_id ?? null, p_notes: p.notes ?? null,
        p_brand: p.brand ?? null, p_specification: p.specification ?? null,
      })
      if (error) throw error
      return data as string
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['market-check-requests'] })
      qc.invalidateQueries({ queryKey: ['market-latest-prices'] })
      qc.invalidateQueries({ queryKey: ['sub-category-latest-price'] })
    },
  })
}

export function useCancelPriceCheck() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: { request_id: string; reason?: string }) => {
      const { error } = await supabase.rpc('cancel_market_price_check', {
        p_request_id: p.request_id, p_reason: p.reason ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['market-check-requests'] }) },
  })
}

// Frontend helper — freshness → tailwind class
export const FRESHNESS_CLASS: Record<Freshness, string> = {
  fresh:    'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300',
  aging:    'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300',
  stale:    'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300',
  outdated: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300',
}

export const FRESHNESS_LABEL: Record<Freshness, string> = {
  fresh: 'Fresh', aging: 'Aging', stale: 'Stale', outdated: 'Outdated',
}
