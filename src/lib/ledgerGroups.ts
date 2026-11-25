// General ledgers and the sub ledgers inside them (547). Procurement picks
// the general ledger on a PO ("Construction materials"); finance picks the
// sub ledger inside it ("Gypsum", "Cement"), with the group as the clue.
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export type LedgerGroup = { id: string; code: string; name: string; subs: { id: string; name: string }[] }

export function useLedgerGroups() {
  const q = useQuery({
    queryKey: ['ledger-groups'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data: cats, error } = await supabase.from('categories').select('id, category_name, ledger_group_id').not('ledger_group_id', 'is', null)
      if (error) throw error
      const ids = [...new Set((cats ?? []).map(c => c.ledger_group_id as string))]
      const { data: accts, error: e2 } = ids.length
        ? await supabase.from('chart_of_accounts').select('id, account_code, account_name').in('id', ids)
        : { data: [] as { id: string; account_code: string; account_name: string }[], error: null }
      if (e2) throw e2
      const groups: LedgerGroup[] = (accts ?? []).map(a => ({
        id: a.id, code: a.account_code, name: a.account_name,
        subs: (cats ?? []).filter(c => c.ledger_group_id === a.id && c.category_name !== 'Multiple')
          .map(c => ({ id: c.id as string, name: (c.category_name as string).trim() })).sort((x, y) => x.name.localeCompare(y.name)),
      })).sort((x, y) => x.code.localeCompare(y.code))
      return groups
    },
  })
  const groups = useMemo(() => q.data ?? [], [q.data])
  const groupOf = useMemo(() => {
    const m = new Map<string, LedgerGroup>()
    for (const g of groups) for (const s of g.subs) m.set(s.id, g)
    return m
  }, [groups])
  return { groups, groupOf, isLoading: q.isLoading }
}

/** General ledger options for procurement: "5150 · Construction materials". */
export const groupOptions = (groups: LedgerGroup[]) =>
  groups.map(g => ({ id: g.id, label: g.name, sub: `${g.code} · ${g.subs.slice(0, 4).map(s => s.name).join(', ')}${g.subs.length > 4 ? '…' : ''}` }))

/**
 * Sub ledger options for finance: the ones inside procurement's general
 * ledger first, labelled with it, then everything else.
 */
export function subLedgerOptions(
  groups: LedgerGroup[], all: { id: string; category_name: string }[], groupId: string | null | undefined,
) {
  const g = groups.find(x => x.id === groupId)
  const inside = new Set(g?.subs.map(s => s.id) ?? [])
  const first = (g?.subs ?? []).map(s => ({ id: s.id, label: s.name, sub: `In ${g!.name} — procurement's pick` }))
  const rest = all.filter(c => !inside.has(c.id)).map(c => ({ id: c.id, label: c.category_name }))
  return [...first, ...rest]
}
