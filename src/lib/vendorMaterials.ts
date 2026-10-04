import type { ElementType } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Zap, Droplets, Layers, Frame, Wrench, PaintBucket, Hammer, BrickWall, Sofa, Package } from 'lucide-react'
import { supabase } from '@/lib/supabase'

// What a vendor supplies, in sections, and vendors like them (migration 416).

export type MaterialSection =
  | 'electrical' | 'plumbing' | 'board' | 'aluminium' | 'hardware'
  | 'paint' | 'tools' | 'construction' | 'decor' | 'other'

export const SECTION: Record<MaterialSection, { label: string; short: string; icon: ElementType }> = {
  construction: { label: 'Stone, ceramic & construction', short: 'Construction', icon: BrickWall },
  board: { label: 'Boards, wood & finishes', short: 'Boards & wood', icon: Layers },
  electrical: { label: 'Electrical & lighting', short: 'Electrical', icon: Zap },
  plumbing: { label: 'Plumbing & sanitary', short: 'Plumbing', icon: Droplets },
  aluminium: { label: 'Aluminium, profiles & glass', short: 'Aluminium & glass', icon: Frame },
  hardware: { label: 'Hardware & fittings', short: 'Hardware', icon: Wrench },
  paint: { label: 'Paint, adhesives & consumables', short: 'Paint & adhesives', icon: PaintBucket },
  tools: { label: 'Tools & equipment', short: 'Tools', icon: Hammer },
  decor: { label: 'Furniture & décor', short: 'Furniture & décor', icon: Sofa },
  other: { label: 'Other', short: 'Other', icon: Package },
}

export const sectionOf = (s: string | null | undefined): MaterialSection => (s && s in SECTION ? s as MaterialSection : 'other')

/** A row of v_vendor_items_bought. */
export interface VendorItem {
  item_key: string; stock_item_id: string | null; item_name: string; unit: string | null; times_bought: number
  total_qty: number; total_value: number; last_price: number; min_price: number; max_price: number; last_bought_on: string
  section: string | null
}

export interface SectionGroup { section: MaterialSection; items: VendorItem[]; spend: number; share: number; last: string | null }

/** Items grouped by section, biggest spend first; "Other" always last. */
export function groupBySection(items: VendorItem[]): SectionGroup[] {
  const total = items.reduce((s, i) => s + Number(i.total_value), 0)
  const map = new Map<MaterialSection, VendorItem[]>()
  for (const it of items) {
    const s = sectionOf(it.section)
    map.set(s, [...(map.get(s) ?? []), it])
  }
  return [...map.entries()]
    .map(([section, list]) => {
      const spend = list.reduce((s, i) => s + Number(i.total_value), 0)
      const last = list.reduce<string | null>((m, i) => (!m || i.last_bought_on > m ? i.last_bought_on : m), null)
      return { section, items: [...list].sort((a, b) => Number(b.total_value) - Number(a.total_value)), spend, share: total ? spend / total : 0, last }
    })
    .sort((a, b) => Number(a.section === 'other') - Number(b.section === 'other') || b.spend - a.spend)
}

export interface SimilarVendor {
  vendor_id: string
  vendor_name: string
  vendor_type: string | null
  category: string | null
  verification_status: string | null
  phone: string | null
  area: string | null
  /** Items both vendors have sold us. */
  shared_items: number
  shared_sample: string[] | null
  /** Their last price ÷ this vendor's last price on those items (median). */
  price_ratio: number | null
  shared_sections: MaterialSection[] | null
  same_category: boolean
  same_area: boolean | null
  last_bought: string | null
  total_bought: number | null
  score: number
}

export function useSimilarVendors(vendorId: string | undefined, limit = 8) {
  return useQuery({
    queryKey: ['similar-vendors', vendorId, limit],
    enabled: !!vendorId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('similar_vendors', { p_vendor: vendorId, p_limit: limit })
      if (error) throw error
      return (data ?? []) as SimilarVendor[]
    },
  })
}

/** "8% cheaper", "about the same price", "12% dearer" — their price against this vendor's. */
export function priceWord(ratio: number | null): { text: string; tone: 'cheaper' | 'same' | 'dearer' | 'apart' } | null {
  if (ratio == null || !isFinite(ratio) || ratio <= 0) return null
  // Half or double the price is more often a different unit (a bale
  // against a piece) than a better deal.
  if (ratio < 0.5 || ratio > 2) return { text: 'far apart', tone: 'apart' }
  const pct = Math.round(Math.abs(1 - ratio) * 100)
  if (pct <= 3) return { text: 'about the same price', tone: 'same' }
  return ratio < 1 ? { text: `${pct}% cheaper`, tone: 'cheaper' } : { text: `${pct}% dearer`, tone: 'dearer' }
}
