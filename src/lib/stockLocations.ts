import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/**
 * Where stock can be kept: the leased warehouses and workshops (the rent
 * table), plus any location already stored on an item. Free text in the
 * database since migration 366.
 */
export function useStockLocations() {
  return useQuery({
    queryKey: ['stock-locations'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [{ data: props }, { data: used }] = await Promise.all([
        supabase.from('properties').select('property_name').order('property_name'),
        supabase.from('stock_items').select('warehouse_zone').not('warehouse_zone', 'is', null),
      ])
      const names = new Set<string>()
      for (const p of props ?? []) if (p.property_name) names.add(p.property_name)
      for (const u of used ?? []) if (u.warehouse_zone) names.add(u.warehouse_zone)
      return [...names].sort((a, b) => a.localeCompare(b))
    },
  })
}
