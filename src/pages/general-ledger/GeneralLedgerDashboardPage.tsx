import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, cn } from '@/lib/utils'
import { useToast } from '@/contexts/ToastContext'
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight, Search, BookOpen } from 'lucide-react'
import type { Category, SubCategory } from '@/types/database'

const NATURE_ORDER = ['Asset', 'Liability', 'Equity', 'Revenue', 'Expense'] as const
const UNCLASSIFIED = 'Unclassified'

const NATURE_STYLES: Record<string, string> = {
  Asset: 'bg-blue-50 text-blue-700 border-blue-200',
  Liability: 'bg-red-50 text-red-700 border-red-200',
  Equity: 'bg-purple-50 text-purple-700 border-purple-200',
  Revenue: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Expense: 'bg-orange-50 text-orange-700 border-orange-200',
  [UNCLASSIFIED]: 'bg-slate-100 text-slate-600 border-slate-200',
}

interface ExpenseCostRow { id: string; category_id: string | null; sub_category_id: string | null; amount_etb: number | null }
interface AllocationCostRow { parent_purchase_id: string | null; sub_category_id: string | null; quantity: number | null; unit_price: number | null }

export default function GeneralLedgerDashboardPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [expandedNatures, setExpandedNatures] = useState<Set<string>>(new Set<string>([...NATURE_ORDER, UNCLASSIFIED]))
  const [expandedLedgers, setExpandedLedgers] = useState<Set<string>>(new Set())

  const { data, isLoading } = useQuery({
    queryKey: ['general-ledger'],
    queryFn: async () => {
      const [categories, subCategories, expenses, allocations] = await Promise.all([
        supabase.from('categories').select('*').order('category_name'),
        supabase.from('sub_categories').select('*').order('item_name'),
        supabase.from('expenses').select('id, category_id, sub_category_id, amount_etb'),
        supabase.from('purchase_allocation').select('parent_purchase_id, sub_category_id, quantity, unit_price'),
      ])
      if (categories.error) throw categories.error
      if (subCategories.error) throw subCategories.error
      if (expenses.error) throw expenses.error
      if (allocations.error) throw allocations.error
      return {
        categories: (categories.data ?? []) as Category[],
        subCategories: (subCategories.data ?? []) as SubCategory[],
        expenses: (expenses.data ?? []) as ExpenseCostRow[],
        allocations: (allocations.data ?? []) as AllocationCostRow[],
      }
    },
  })

  const categories = data?.categories ?? []
  const subCategories = data?.subCategories ?? []
  const expenses = data?.expenses ?? []
  const allocations = data?.allocations ?? []

  const tree = useMemo(() => {
    // Bulk purchases get broken down into Purchase Allocation line items, each tied to
    // its own sub ledger. Once a purchase is allocated, its parent expense's amount_etb
    // is just the bulk total — the line items below carry the real per-ledger cost, so
    // the parent is excluded here to avoid double-counting.
    const allocatedParentIds = new Set(allocations.map(a => a.parent_purchase_id).filter((id): id is string => !!id))
    const subCategoryParent = new Map(subCategories.map(s => [s.id, s.parent_category_id]))

    const costByCategory = new Map<string, number>()
    const costBySubCategory = new Map<string, number>()

    for (const e of expenses) {
      if (allocatedParentIds.has(e.id)) continue
      const amt = e.amount_etb ?? 0
      if (e.category_id) costByCategory.set(e.category_id, (costByCategory.get(e.category_id) ?? 0) + amt)
      if (e.sub_category_id) costBySubCategory.set(e.sub_category_id, (costBySubCategory.get(e.sub_category_id) ?? 0) + amt)
    }

    for (const a of allocations) {
      if (!a.sub_category_id) continue
      const amt = (a.quantity ?? 0) * (a.unit_price ?? 0)
      costBySubCategory.set(a.sub_category_id, (costBySubCategory.get(a.sub_category_id) ?? 0) + amt)
      const parentCategoryId = subCategoryParent.get(a.sub_category_id)
      if (parentCategoryId) costByCategory.set(parentCategoryId, (costByCategory.get(parentCategoryId) ?? 0) + amt)
    }

    const subsByParent = new Map<string, SubCategory[]>()
    for (const s of subCategories) {
      const key = s.parent_category_id ?? 'none'
      if (!subsByParent.has(key)) subsByParent.set(key, [])
      subsByParent.get(key)!.push(s)
    }

    const q = search.trim().toLowerCase()
    const matchesLedger = (c: Category) => !q || c.category_name.toLowerCase().includes(q)
    const matchesSub = (s: SubCategory) => !q || s.item_name.toLowerCase().includes(q)

    const byNature = new Map<string, Category[]>()
    for (const c of categories) {
      const subs = subsByParent.get(c.id) ?? []
      const ledgerMatches = matchesLedger(c) || subs.some(matchesSub)
      if (!ledgerMatches) continue
      const key = c.nature && NATURE_ORDER.includes(c.nature as typeof NATURE_ORDER[number]) ? c.nature : UNCLASSIFIED
      if (!byNature.has(key)) byNature.set(key, [])
      byNature.get(key)!.push(c)
    }

    const natureGroups = [...NATURE_ORDER, UNCLASSIFIED]
      .filter(n => byNature.has(n))
      .map(nature => {
        const ledgers = byNature.get(nature)!.map(c => {
          const subs = (subsByParent.get(c.id) ?? []).filter(s => !q || matchesLedger(c) || matchesSub(s))
          const ledgerCost = costByCategory.get(c.id) ?? 0
          return { category: c, subs, ledgerCost }
        })
        const natureTotal = ledgers.reduce((sum, l) => sum + l.ledgerCost, 0)
        return { nature, ledgers, natureTotal }
      })

    return { natureGroups, costBySubCategory }
  }, [categories, subCategories, expenses, allocations, search])

  function toggleNature(nature: string) {
    setExpandedNatures(prev => {
      const next = new Set(prev)
      next.has(nature) ? next.delete(nature) : next.add(nature)
      return next
    })
  }

  function toggleLedger(id: string) {
    setExpandedLedgers(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleDeleteLedger(id: string, name: string) {
    if (!window.confirm(`Delete general ledger "${name}"? Sub ledgers under it will be orphaned. This cannot be undone.`)) return
    const { error } = await supabase.from('categories').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['general-ledger'] })
    qc.invalidateQueries({ queryKey: ['categories-lookup'] })
    toast('General ledger deleted', 'success')
  }

  async function handleDeleteSub(id: string, name: string) {
    if (!window.confirm(`Delete sub ledger "${name}"? This cannot be undone.`)) return
    const { error } = await supabase.from('sub_categories').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['general-ledger'] })
    qc.invalidateQueries({ queryKey: ['sub-categories-lookup'] })
    toast('Sub ledger deleted', 'success')
  }

  const grandTotal = tree.natureGroups.reduce((sum, g) => sum + g.natureTotal, 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">General Ledger</h1>
          <p className="text-sm text-slate-500">Chart of accounts &mdash; ledgers and sub ledgers classified by nature (Assets = Liabilities + Owner&rsquo;s Equity)</p>
        </div>
        <Link to="/general-ledger/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          <Plus className="h-4 w-4" /> New Ledger
        </Link>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl border bg-white p-4">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search ledgers or sub ledgers…"
            className="w-full rounded-md border py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand"
          />
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-400">Total recorded cost</p>
          <p className="text-lg font-bold text-slate-800">{formatCurrency(grandTotal)}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
      ) : tree.natureGroups.length === 0 ? (
        <div className="rounded-xl border bg-white py-12 text-center text-sm text-slate-400">No general ledgers found.</div>
      ) : (
        <div className="space-y-3">
          {tree.natureGroups.map(({ nature, ledgers, natureTotal }) => {
            const open = expandedNatures.has(nature)
            return (
              <div key={nature} className="overflow-hidden rounded-xl border bg-white">
                <button
                  type="button"
                  onClick={() => toggleNature(nature)}
                  className={cn('flex w-full items-center justify-between border-b px-4 py-3 text-left', NATURE_STYLES[nature])}
                >
                  <span className="flex items-center gap-2 font-semibold">
                    {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <BookOpen className="h-4 w-4" />
                    {nature}
                    <span className="rounded-full bg-white/60 px-2 py-0.5 text-xs font-medium">{ledgers.length} ledger{ledgers.length === 1 ? '' : 's'}</span>
                  </span>
                  <span className="font-semibold">{formatCurrency(natureTotal)}</span>
                </button>
                {open && (
                  <div className="divide-y">
                    {ledgers.map(({ category, subs, ledgerCost }) => {
                      const ledgerOpen = expandedLedgers.has(category.id)
                      return (
                        <div key={category.id}>
                          <div className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50">
                            <button
                              type="button"
                              onClick={() => toggleLedger(category.id)}
                              className="flex flex-1 items-center gap-2 text-left min-w-0"
                            >
                              {subs.length > 0 ? (
                                ledgerOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                              ) : (
                                <span className="w-3.5 shrink-0" />
                              )}
                              <span className="truncate text-sm font-medium text-slate-800">{category.category_name}</span>
                              {category.parent_type && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">{category.parent_type}</span>}
                              {subs.length > 0 && <span className="shrink-0 text-xs text-slate-400">{subs.length} sub ledger{subs.length === 1 ? '' : 's'}</span>}
                            </button>
                            <span className="shrink-0 text-sm text-slate-600">{formatCurrency(ledgerCost)}</span>
                            <div className="flex shrink-0 items-center gap-1">
                              <Link to={`/general-ledger/sub-ledgers/new?parent=${category.id}`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Add Sub Ledger"><Plus className="h-3.5 w-3.5" /></Link>
                              <Link to={`/general-ledger/${category.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></Link>
                              <button onClick={() => handleDeleteLedger(category.id, category.category_name)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                            </div>
                          </div>
                          {ledgerOpen && subs.length > 0 && (
                            <div className="space-y-0.5 bg-slate-50/60 py-1 pl-10 pr-4">
                              {subs.map(sub => (
                                <div key={sub.id} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-white">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <span className="truncate text-sm text-slate-700">{sub.item_name}</span>
                                    {!sub.active && <span className="shrink-0 rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-500">Inactive</span>}
                                  </div>
                                  <div className="flex shrink-0 items-center gap-3">
                                    <span className="text-xs text-slate-500">{formatCurrency(tree.costBySubCategory.get(sub.id) ?? 0)}</span>
                                    <div className="flex items-center gap-1">
                                      <Link to={`/general-ledger/sub-ledgers/${sub.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><Pencil className="h-3 w-3" /></Link>
                                      <button onClick={() => handleDeleteSub(sub.id, sub.item_name)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 className="h-3 w-3" /></button>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
