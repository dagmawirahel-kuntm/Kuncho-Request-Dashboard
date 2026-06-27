import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { StockItem, StockMainCategory, WarehouseZone } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { Plus, Pencil, Trash2, Search, Warehouse, Wrench, Package, Flame, ChevronRight } from 'lucide-react'

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

const ZONE_CLS: Record<WarehouseZone, string> = {
  'Zone A': 'bg-amber-50 text-amber-700 dark:bg-amber-900/30',
  'Zone B': 'bg-cyan-50 text-cyan-700 dark:bg-cyan-900/30',
  'Zone C': 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
}

function ZoneBadge({ zone }: { zone: WarehouseZone | null }) {
  if (!zone) return <span className="text-xs text-slate-400">—</span>
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${ZONE_CLS[zone]}`}>{zone}</span>
}

export default function StockItemsPage() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<StockMainCategory | 'all'>('all')
  const [typeFilter, setTypeFilter] = useState<'all' | 'raw_material' | 'tool' | 'consumable'>('all')

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

  const filtered = useMemo(() => {
    let list = data
    if (categoryFilter !== 'all') list = list.filter(i => i.main_category === categoryFilter)
    if (typeFilter !== 'all') list = list.filter(i => i.item_type === typeFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(i =>
        i.item_name.toLowerCase().includes(q) ||
        (i.amharic_name ?? '').includes(q) ||
        (i.quality_grade ?? '').toLowerCase().includes(q) ||
        (i.sub_categories?.item_name ?? '').toLowerCase().includes(q)
      )
    }
    return list
  }, [data, categoryFilter, typeFilter, search])

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
    if (!window.confirm('Delete this stock item?')) return
    const { error } = await supabase.from('stock_items').update({ active: false }).eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['stock-items'] })
    toast('Stock item removed', 'success')
  }

  const stats = useMemo(() => ({
    total: data.length,
    tools: data.filter(i => i.is_tool).length,
    rawMaterial: data.filter(i => i.item_type === 'raw_material').length,
    consumable: data.filter(i => i.item_type === 'consumable').length,
  }), [data])

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Stock Catalog</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Inventory classification and warehouse items</p>
        </div>
        <Link to="/stock/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          <Plus className="h-4 w-4" /> Add Item
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Items', value: stats.total, icon: <Package className="h-4 w-4" /> },
          { label: 'Tools', value: stats.tools, icon: <Wrench className="h-4 w-4" /> },
          { label: 'Raw Materials', value: stats.rawMaterial, icon: <Warehouse className="h-4 w-4" /> },
          { label: 'Consumables', value: stats.consumable, icon: <Flame className="h-4 w-4" /> },
        ].map(s => (
          <div key={s.label} className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-4 flex items-center gap-3 shadow-sm">
            <div className="rounded-lg bg-slate-100 dark:bg-slate-700 p-2 text-slate-500">{s.icon}</div>
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide">{s.label}</p>
              <p className="text-xl font-bold text-slate-800 dark:text-slate-100">{s.value}</p>
            </div>
          </div>
        ))}
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
                {items.map(item => (
                  <div key={item.id}
                    className="group flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors cursor-pointer"
                    onClick={() => navigate(`/stock/${item.id}/edit`)}
                  >
                    <div className={`flex-shrink-0 rounded-lg p-2 ${item.is_tool ? 'bg-purple-50 text-purple-500' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'}`}>
                      {item.is_tool ? <Wrench className="h-4 w-4" /> : <Package className="h-4 w-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{item.item_name}</span>
                        {item.amharic_name && <span className="text-xs text-slate-400">{item.amharic_name}</span>}
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ITEM_TYPE_STYLES[item.item_type].cls}`}>
                          {ITEM_TYPE_STYLES[item.item_type].label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        {item.quality_grade && <span className="text-xs text-slate-400">{item.quality_grade}</span>}
                        {item.sub_categories && <span className="text-xs text-slate-400">GL: {item.sub_categories.item_name}</span>}
                        <span className="text-xs text-slate-400">Unit: {item.unit}</span>
                      </div>
                    </div>
                    <div className="hidden sm:flex items-center gap-3 flex-shrink-0">
                      <ZoneBadge zone={item.warehouse_zone as WarehouseZone | null} />
                    </div>
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      <button onClick={e => { e.stopPropagation(); navigate(`/stock/${item.id}/edit`) }}
                        className="rounded p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 opacity-0 group-hover:opacity-100 transition-all">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={e => { e.stopPropagation(); handleDelete(item.id) }}
                        className="rounded p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 opacity-0 group-hover:opacity-100 transition-all">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                      <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-400 transition-colors" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
