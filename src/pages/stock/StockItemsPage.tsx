import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { StockItem, StockMainCategory, BoothStructureType } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { Plus, Pencil, Trash2, Search, Warehouse, Wrench, Package, ChevronRight, AlertTriangle, ClipboardList, Send, ClipboardCheck } from 'lucide-react'
import { Stat } from '@/components/record/Record'
import { useStockLocations } from '@/lib/stockLocations'

const BOOTH_STRUCTURE_BADGE: Record<BoothStructureType, { label: string; cls: string }> = {
  standalone:  { label: 'Standalone',  cls: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  fixed_part:  { label: 'Fixed Part',  cls: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
}

// ── Quality grade → badge colour ───────────────────────────────────────────────
function qualityTheme(grade: string | null): { cls: string; label: string } | null {
  if (!grade) return null
  const g = grade.toLowerCase()
  if (/^a|excellent|premium|first|grade.?a/i.test(g))  return { cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300', label: grade }
  if (/^b|good|standard|second|grade.?b/i.test(g))      return { cls: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',          label: grade }
  if (/^c|fair|average|third|grade.?c/i.test(g))         return { cls: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',       label: grade }
  if (/^d|poor|low|reject|damaged|grade.?d/i.test(g))    return { cls: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',              label: grade }
  return { cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300', label: grade }
}

// ── Stock level badge ──────────────────────────────────────────────────────────
function stockLevelBadge(current: number | undefined, reorder: number | null): {
  cls: string; label: string; icon?: React.ReactNode
} | null {
  if (current === undefined) return null
  if (current <= 0)
    return { cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300', label: 'Out', icon: <AlertTriangle className="h-2.5 w-2.5" /> }
  if (reorder !== null && current <= reorder)
    return { cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300', label: 'Low', icon: <AlertTriangle className="h-2.5 w-2.5" /> }
  return null  // In stock and above reorder level → no badge needed
}

const MAIN_CATEGORY_LABELS: Record<StockMainCategory, string> = {
  wood_work:     'Wood Work',
  electrical:    'Electrical',
  painting:      'Painting',
  hardware:      'Hardware & Accessories',
  construction:  'Construction Material',
  tools:         'Tools & Equipment',
  booth_return:  'Booth Return',
}

const ITEM_TYPE_STYLES = {
  raw_material: { label: 'Raw Material', cls: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  tool:         { label: 'Tool',         cls: 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
  consumable:   { label: 'Consumable',   cls: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
}

// Warehouse locations are now real property names (migration/#10), an
// open set rather than the fixed Zone A–C, so the badge derives a stable
// colour from the string instead of a hard-coded map that would miss any
// name not in it.
const ZONE_PALETTE = [
  'bg-amber-50 text-amber-700 dark:bg-amber-900/30',
  'bg-cyan-50 text-cyan-700 dark:bg-cyan-900/30',
  'bg-violet-50 text-violet-700 dark:bg-violet-900/30',
  'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30',
  'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
]
function zoneClass(zone: string): string {
  let h = 0
  for (let i = 0; i < zone.length; i++) h = (h * 31 + zone.charCodeAt(i)) >>> 0
  return ZONE_PALETTE[h % ZONE_PALETTE.length]
}

function ZoneBadge({ zone }: { zone: string | null }) {
  if (!zone) return <span className="text-xs text-slate-400">—</span>
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${zoneClass(zone)}`}>{zone}</span>
}

export default function StockItemsPage() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<StockMainCategory | 'all'>('all')
  const [typeFilter, setTypeFilter] = useState<'all' | 'raw_material' | 'tool' | 'consumable'>('all')
  const [stockFilter, setStockFilter] = useState<'all' | 'held' | 'low' | 'pending' | 'sites'>('all')
  const [locationFilter, setLocationFilter] = useState('')
  const { data: locations = [] } = useStockLocations()

  const { data = [], isLoading } = useQuery({
    queryKey: ['stock-items'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stock_items')
        .select('*, sub_categories(item_name, categories(category_name))')
        .eq('active', true)
        .order('main_category, item_name')
      if (error) throw error
      return data as (StockItem & { sub_categories: { item_name: string; categories: { category_name: string } | null } | null })[]
    },
  })

  // Warehouse stock per item, set up or not. Goods delivered straight to a
  // project site are not in the warehouse; they're shown apart (358).
  const { data: levels = [] } = useQuery({
    queryKey: ['stock-levels'],
    queryFn: async () => {
      const { data } = await supabase.from('v_stock_item_usage').select('id, qty_on_hand, qty_delivered_to_sites')
      return (data ?? []) as { id: string; qty_on_hand: number; qty_delivered_to_sites: number }[]
    },
  })

  const levelMap = useMemo(() => {
    const m: Record<string, number> = {}
    for (const l of levels) m[l.id] = Number(l.qty_on_hand ?? 0)
    return m
  }, [levels])
  const siteMap = useMemo(() => {
    const m: Record<string, number> = {}
    for (const l of levels) m[l.id] = Number(l.qty_delivered_to_sites ?? 0)
    return m
  }, [levels])
  // Low or out: a set-up item at or below its reorder level, or empty.
  const isLow = (i: StockItem) => {
    if (i.catalog_status !== 'active') return false
    const q = levelMap[i.id] ?? 0
    return q <= 0 || (i.reorder_level != null && q <= i.reorder_level)
  }

  const filtered = useMemo(() => {
    let list = data
    if (categoryFilter !== 'all') list = list.filter(i => i.main_category === categoryFilter)
    if (typeFilter !== 'all') list = list.filter(i => i.item_type === typeFilter)
    if (locationFilter) list = list.filter(i => i.warehouse_zone === locationFilter)
    if (stockFilter === 'held') list = list.filter(i => (levelMap[i.id] ?? 0) > 0)
    if (stockFilter === 'low') list = list.filter(isLow)
    if (stockFilter === 'pending') list = list.filter(i => i.catalog_status === 'pending_setup')
    if (stockFilter === 'sites') list = list.filter(i => (levelMap[i.id] ?? 0) <= 0 && (siteMap[i.id] ?? 0) > 0)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(i =>
        i.item_name.toLowerCase().includes(q) ||
        (i.amharic_name ?? '').includes(q) ||
        (i.item_code ?? '').toLowerCase().includes(q) ||
        (i.quality_grade ?? '').toLowerCase().includes(q) ||
        (i.sub_categories?.item_name ?? '').toLowerCase().includes(q)
      )
    }
    return list
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, categoryFilter, typeFilter, search, stockFilter, locationFilter, levelMap, siteMap])

  // Group by main category
  const grouped = useMemo(() => {
    const m = new Map<string, typeof filtered>()
    for (const item of filtered) {
      const key = item.main_category ? MAIN_CATEGORY_LABELS[item.main_category] : 'Uncategorized'
      if (!m.has(key)) m.set(key, [])
      m.get(key)!.push(item)
    }
    return Array.from(m.entries())
  }, [filtered])

  async function handleDelete(id: string) {
    if (!window.confirm('Deactivate this stock item? Its history stays; it just stops being offered.')) return
    const { error } = await supabase.from('stock_items').update({ active: false }).eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['stock-items'] })
    toast('Stock item deactivated', 'success')
  }

  const stats = useMemo(() => ({
    total: data.length,
    held: data.filter(i => (levelMap[i.id] ?? 0) > 0).length,
    low: data.filter(isLow).length,
    pending: data.filter(i => i.catalog_status === 'pending_setup').length,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [data, levelMap, siteMap])

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Stock Catalog</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Inventory classification and warehouse items</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/stock/issue" className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand/90">
            <Send className="h-4 w-4" /> Issue to a project
          </Link>
          <Link to="/stock/counts" className="flex items-center gap-1.5 rounded-md border bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
            <ClipboardList className="h-4 w-4" /> Count stock
          </Link>
          {stats.pending > 0 && (
            <Link to="/stock/pending-setup" className="flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-300">
              <ClipboardCheck className="h-4 w-4" /> Set up {stats.pending}
            </Link>
          )}
          <Link to="/stock/new" className="flex items-center gap-1.5 rounded-md border bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
            <Plus className="h-4 w-4" /> Add item
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Items" value={stats.total} />
        <Stat label="Holding stock" value={stats.held} sub="in the warehouse" />
        <Stat label="Low or out" value={stats.low} tone={stats.low ? 'amber' : undefined} />
        <Stat label="Not set up" value={stats.pending} tone={stats.pending ? 'amber' : undefined} sub="not offered from stock" />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {([['all', 'All'], ['held', 'In the warehouse'], ['low', 'Low or out'], ['pending', 'Not set up'], ['sites', 'Only delivered to sites']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setStockFilter(k)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${stockFilter === k ? 'border-brand bg-brand text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
            {label}
          </button>
        ))}
        {locations.length > 0 && (
          <select value={locationFilter} onChange={e => setLocationFilter(e.target.value)} aria-label="Location"
            className="ml-auto rounded-md border bg-white px-2 py-1 text-xs text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <option value="">Every location</option>
            {locations.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <input type="text" placeholder="Search items…" value={search} onChange={e => setSearch(e.target.value)}
            className="w-full rounded-lg border dark:border-slate-600 bg-white dark:bg-slate-800 pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand" />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {(['all', ...Object.keys(ITEM_TYPE_STYLES)] as const).map(t => (
            <button key={t} onClick={() => setTypeFilter(t as any)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                typeFilter === t ? 'bg-brand text-white' : 'bg-white dark:bg-slate-800 border dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-brand'
              }`}>
              {t === 'all' ? 'All types' : ITEM_TYPE_STYLES[t as keyof typeof ITEM_TYPE_STYLES].label}
            </button>
          ))}
        </div>
      </div>

      {/* Category filter chips */}
      <div className="flex gap-1.5 flex-wrap">
        <button onClick={() => setCategoryFilter('all')}
          className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${categoryFilter === 'all' ? 'bg-slate-700 text-white border-slate-700' : 'bg-white dark:bg-slate-800 dark:border-slate-700 text-slate-500 hover:border-slate-400'}`}>
          All categories
        </button>
        {Object.entries(MAIN_CATEGORY_LABELS).map(([k, label]) => (
          <button key={k} onClick={() => setCategoryFilter(k as StockMainCategory)}
            className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${categoryFilter === k ? 'bg-slate-700 text-white border-slate-700' : 'bg-white dark:bg-slate-800 dark:border-slate-700 text-slate-500 hover:border-slate-400'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed dark:border-slate-700 bg-white dark:bg-slate-800 py-16 text-center">
          <Warehouse className="mx-auto h-8 w-8 text-slate-300 mb-3" />
          <p className="text-sm text-slate-500">{search ? 'No matching items.' : 'No stock items yet.'}</p>
          {!search && <Link to="/stock/new" className="mt-3 inline-flex items-center gap-1 text-sm text-brand font-medium hover:underline"><Plus className="h-3.5 w-3.5" /> Add first item</Link>}
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([category, items]) => (
            <div key={category}>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5 px-1">{category}</p>
              <div className="rounded-xl border dark:border-slate-700 overflow-hidden divide-y divide-slate-100 dark:divide-slate-700/60 shadow-sm">
                {items.map(item => {
                  const currentStock = levelMap[item.id]
                  const levelBadge   = stockLevelBadge(currentStock, item.reorder_level ?? null)
                  const qualBadge    = qualityTheme(item.quality_grade)
                  return (
                  <div key={item.id}
                    className={`group flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors cursor-pointer ${
                      levelBadge?.label === 'Out' ? 'border-l-2 border-red-400' :
                      levelBadge?.label === 'Low' ? 'border-l-2 border-amber-400' : ''
                    }`}
                    onClick={() => navigate(`/stock/${item.id}`)}
                  >
                    <div className={`flex-shrink-0 rounded-lg p-2 ${
                      levelBadge?.label === 'Out' ? 'bg-red-50 text-red-400' :
                      item.is_tool ? 'bg-purple-50 text-purple-500' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'
                    }`}>
                      {item.is_tool ? <Wrench className="h-4 w-4" /> : <Package className="h-4 w-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{item.item_name}</span>
                        {item.amharic_name && <span className="text-xs text-slate-400">{item.amharic_name}</span>}
                        {item.item_code && (
                          <span className="rounded px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
                            {item.item_code}
                          </span>
                        )}
                        {item.catalog_status === 'pending_setup' && (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">Not set up</span>
                        )}
                        {levelBadge && (
                          <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold ${levelBadge.cls}`}>
                            {levelBadge.icon}{levelBadge.label}
                          </span>
                        )}
                        {item.main_category === 'booth_return' && item.structure_type && (
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${BOOTH_STRUCTURE_BADGE[item.structure_type].cls}`}>
                            {BOOTH_STRUCTURE_BADGE[item.structure_type].label}
                          </span>
                        )}
                        {qualBadge && (
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${qualBadge.cls}`}>
                            {qualBadge.label}
                          </span>
                        )}
                        {item.main_category !== 'booth_return' && (
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ITEM_TYPE_STYLES[item.item_type].cls}`}>
                            {ITEM_TYPE_STYLES[item.item_type].label}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        {currentStock !== undefined && (
                          <span className={`text-xs font-medium ${
                            currentStock <= 0 ? 'text-red-500' :
                            item.reorder_level && currentStock <= item.reorder_level ? 'text-amber-600' :
                            'text-slate-400'
                          }`}>
                            {currentStock} {item.unit} in warehouse
                          </span>
                        )}
                        {siteMap[item.id] > 0 && (
                          <span className="text-xs text-slate-400">{siteMap[item.id]} {item.unit} delivered to sites</span>
                        )}
                        {item.sub_categories && <span className="text-xs text-slate-400">GL: {item.sub_categories.item_name}</span>}
                        {!currentStock && item.reorder_level && (
                          <span className="text-xs text-slate-400">Reorder at {item.reorder_level}</span>
                        )}
                      </div>
                    </div>
                    <div className="hidden sm:flex items-center gap-3 flex-shrink-0">
                      <ZoneBadge zone={item.warehouse_zone ?? null} />
                    </div>
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      <button onClick={e => { e.stopPropagation(); navigate(`/stock/${item.id}/edit`) }}
                        className="rounded p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={e => { e.stopPropagation(); handleDelete(item.id) }} title="Deactivate"
                        className="rounded p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                      <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-400 transition-colors" />
                    </div>
                  </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
