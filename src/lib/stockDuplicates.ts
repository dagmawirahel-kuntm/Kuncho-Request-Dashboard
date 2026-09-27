import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { stockNameKey } from '@/lib/stockMatch'

// Stock items that look like one another (v_stock_duplicate_pairs, 354),
// joined into sets: if A looks like B and B like C, all three are shown
// together and the stock manager decides which of them are really one item.

export interface StockUsageRow {
  id: string
  item_code: string | null
  item_name: string
  unit: string
  catalog_status: 'active' | 'pending_setup' | 'inactive'
  is_tool: boolean
  created_at: string
  sub_category_id: string | null
  warehouse_zone: string | null
  request_lines: number
  receipts: number
  issues: number
  tool_units: number
  qty_on_hand: number            // in the warehouse
  qty_delivered_to_sites: number
  from_receipt: boolean
}

export interface DuplicatePair { item_a: string; item_b: string; reason: 'same_name' | 'similar'; score: number }

export interface DuplicateGroup {
  key: string
  members: StockUsageRow[]
  pairs: DuplicatePair[]
  suggestedKeep: string
  exact: boolean        // every member has the same name once tidied
  recent: boolean       // a member was made at goods received in the last 14 days
}

// The one to keep by default: a set-up item over a pending one, then the
// one with the most history, then the oldest.
export function pickKeeper(members: StockUsageRow[]): StockUsageRow {
  return [...members].sort((a, b) =>
    (Number(b.catalog_status === 'active') - Number(a.catalog_status === 'active'))
    || (b.receipts + b.request_lines + b.issues) - (a.receipts + a.request_lines + a.issues)
    || a.created_at.localeCompare(b.created_at))[0]
}

export function groupDuplicates(pairs: DuplicatePair[], items: StockUsageRow[]): DuplicateGroup[] {
  const byId = new Map(items.map(i => [i.id, i]))
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r)!
    parent.set(x, r)
    return r
  }
  for (const p of pairs) {
    if (!byId.has(p.item_a) || !byId.has(p.item_b)) continue
    for (const id of [p.item_a, p.item_b]) if (!parent.has(id)) parent.set(id, id)
    const ra = find(p.item_a), rb = find(p.item_b)
    if (ra !== rb) parent.set(ra, rb)
  }
  const sets = new Map<string, string[]>()
  for (const id of parent.keys()) {
    const r = find(id)
    sets.set(r, [...(sets.get(r) ?? []), id])
  }
  const since = Date.now() - 14 * 86400_000
  const groups: DuplicateGroup[] = []
  for (const [root, ids] of sets) {
    const members = ids.map(id => byId.get(id)!).sort((a, b) => a.item_name.localeCompare(b.item_name))
    const idSet = new Set(ids)
    const keys = new Set(members.map(m => stockNameKey(m.item_name)))
    groups.push({
      key: root,
      members,
      pairs: pairs.filter(p => idSet.has(p.item_a) && idSet.has(p.item_b)),
      suggestedKeep: pickKeeper(members).id,
      exact: keys.size === 1,
      recent: members.some(m => m.from_receipt && new Date(m.created_at).getTime() >= since),
    })
  }
  return groups.sort((a, b) =>
    Number(b.recent) - Number(a.recent) || Number(b.exact) - Number(a.exact) || b.members.length - a.members.length)
}

export function useStockDuplicateGroups() {
  return useQuery({
    queryKey: ['stock-duplicate-groups'],
    queryFn: async () => {
      const [pairsRes, usageRes] = await Promise.all([
        supabase.from('v_stock_duplicate_pairs').select('item_a, item_b, reason, score'),
        supabase.from('v_stock_item_usage').select('*'),
      ])
      if (pairsRes.error) throw pairsRes.error
      if (usageRes.error) throw usageRes.error
      const pairs = (pairsRes.data ?? []) as DuplicatePair[]
      const items = (usageRes.data ?? []) as StockUsageRow[]
      return groupDuplicates(pairs, items)
    },
  })
}

export interface StockMergeRow {
  id: string
  kept_item_id: string | null
  kept_item_name: string
  merged_name: string
  merged_code: string | null
  moved: Record<string, number>
  merged_at: string
  merged_by: string | null
  user_profiles: { full_name: string | null } | null
}

export function useStockMerges(limit = 30) {
  return useQuery({
    queryKey: ['stock-item-merges', limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stock_item_merges')
        .select('id, kept_item_id, kept_item_name, merged_name, merged_code, moved, merged_at, merged_by, user_profiles:merged_by(full_name)')
        .order('merged_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return (data ?? []) as unknown as StockMergeRow[]
    },
  })
}
