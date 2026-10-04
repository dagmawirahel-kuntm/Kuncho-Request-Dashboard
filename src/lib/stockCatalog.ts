import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { StockMainCategory, BoothStructureType } from '@/types/database'

// One row per catalogue item: what the warehouse holds and what it's worth,
// when it last moved and was counted, and what was bought straight for
// sites (migration 417).

export interface CatalogRow {
  id: string
  item_name: string
  amharic_name: string | null
  item_code: string | null
  unit: string
  main_category: StockMainCategory | null
  item_type: 'raw_material' | 'tool' | 'consumable'
  is_tool: boolean
  catalog_status: 'active' | 'pending_setup' | 'inactive'
  warehouse_zone: string | null
  reorder_level: number | null
  quality_grade: string | null
  sub_category_id: string | null
  structure_type: BoothStructureType | null
  section: string | null
  qty_on_hand: number
  avg_unit_cost: number | null
  value_on_hand: number
  first_in: string | null
  last_in: string | null
  last_out: string | null
  issues: number
  last_moved: string | null
  last_counted: string | null
  open_count_id: string | null
  open_count_code: string | null
  site_qty: number
  site_spend: number
  site_projects: number
  last_site: string | null
  last_price: number | null
  price_at: string | null
  price_freshness: 'fresh' | 'aging' | 'outdated' | null
}

export function useStockCatalog() {
  return useQuery({
    queryKey: ['stock-catalog'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_stock_catalog').select('*').order('item_name')
      if (error) throw error
      return (data ?? []).map(r => ({
        ...r,
        qty_on_hand: Number(r.qty_on_hand ?? 0), value_on_hand: Number(r.value_on_hand ?? 0),
        site_qty: Number(r.site_qty ?? 0), site_spend: Number(r.site_spend ?? 0),
      })) as CatalogRow[]
    },
  })
}

export interface OpenCount {
  id: string; code: string; count_date: string; started_at: string
  starter: string | null; lines: number; counted: number
}

/** Counts started and not yet posted — the warehouse figures wait on them. */
export function useOpenCounts() {
  return useQuery({
    queryKey: ['stock-open-counts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_counts')
        .select('id, code, count_date, started_at, started_by, stock_count_lines(counted_qty)')
        .eq('status', 'counting').order('started_at')
      if (error) throw error
      const rows = (data ?? []) as { id: string; code: string; count_date: string; started_at: string; started_by: string | null; stock_count_lines: { counted_qty: number | null }[] }[]
      const ids = [...new Set(rows.map(r => r.started_by).filter(Boolean))] as string[]
      const { data: people } = ids.length
        ? await supabase.from('user_profiles').select('id, full_name').in('id', ids)
        : { data: [] as { id: string; full_name: string | null }[] }
      return rows.map(r => ({
        id: r.id, code: r.code, count_date: r.count_date, started_at: r.started_at,
        starter: people?.find(p => p.id === r.started_by)?.full_name ?? null,
        lines: r.stock_count_lines.length, counted: r.stock_count_lines.filter(l => l.counted_qty != null).length,
      })) as OpenCount[]
    },
  })
}

export function usePendingDispatchCount() {
  return useQuery({
    queryKey: ['stock-pending-dispatch-count'],
    staleTime: 60_000,
    queryFn: async () => {
      const { count } = await supabase.from('v_stock_pending_dispatch').select('order_item_id', { count: 'exact', head: true })
      return count ?? 0
    },
  })
}

/** Whole days between a date and today. */
export function daysSince(d: string | null | undefined): number | null {
  if (!d) return null
  return Math.floor((Date.parse(new Date().toISOString().slice(0, 10)) - Date.parse(d.slice(0, 10))) / 86_400_000)
}

/** Held, and nothing recorded going out since it came in. Tools are lent
 *  and come back (the Tools page), so they are never "issued". */
export const neverIssued = (r: CatalogRow) => !r.is_tool && r.qty_on_hand > 0 && r.issues === 0

/** At or under its reorder level — only items that have one. */
export const isLow = (r: CatalogRow) => r.reorder_level != null && r.qty_on_hand <= r.reorder_level
