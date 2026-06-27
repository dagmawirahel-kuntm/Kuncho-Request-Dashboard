import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { StockItem, StockMainCategory, ToolUnit, ToolCondition } from '@/types/database'
import {
  Search, Wrench, CheckCircle2, AlertCircle, XCircle,
  ChevronRight, ArrowRightLeft, Package, Layers, Hash,
} from 'lucide-react'

const CONDITION_STYLES: Record<ToolCondition, { label: string; cls: string; icon: React.ReactNode }> = {
  good:    { label: 'Good',    cls: 'text-green-700 bg-green-50 dark:bg-green-900/30',  icon: <CheckCircle2 className="h-3 w-3" /> },
  fair:    { label: 'Fair',    cls: 'text-amber-700 bg-amber-50 dark:bg-amber-900/30',  icon: <AlertCircle className="h-3 w-3" /> },
  damaged: { label: 'Damaged', cls: 'text-red-700 bg-red-50 dark:bg-red-900/30',        icon: <AlertCircle className="h-3 w-3" /> },
  retired: { label: 'Retired', cls: 'text-slate-500 bg-slate-100 dark:bg-slate-700',    icon: <XCircle className="h-3 w-3" /> },
}

const CAT_LABEL: Record<StockMainCategory, string> = {
  wood_work:    'Wood Work',
  electrical:   'Electrical',
  painting:     'Painting',
  hardware:     'Hardware',
  construction: 'Construction',
  tools:        'Tools & Equipment',
  booth_return: 'Booth Return',
}

type Tab = 'catalog' | 'units'

type ToolItemRow = StockItem & { current_stock?: number }
type ToolUnitRow = ToolUnit & {
  stock_items: { item_name: string; item_code: string | null; main_category: string | null } | null
  staff: { employee_name: string } | null
}

export default function StockToolsPage() {
  const navigate = useNavigate()
  const [tab, setTab]           = useState<Tab>('catalog')
  const [search, setSearch]     = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'available' | 'checked_out'>('all')

  // ── Tool catalog items ────────────────────────────────────────────────────
  const { data: toolItems = [], isLoading: loadingItems } = useQuery({
    queryKey: ['stock-items-tools'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stock_items')
        .select('*')
        .eq('is_tool', true)
        .eq('active', true)
        .order('main_category, item_name')
      if (error) throw error
      return data as StockItem[]
    },
  })

  // ── Stock levels (graceful if view not yet applied) ───────────────────────
  const { data: levels = [] } = useQuery({
    queryKey: ['stock-levels-tools'],
    queryFn: async () => {
      const { data } = await supabase
        .from('v_stock_levels')
        .select('id, current_stock')
      return (data ?? []) as { id: string; current_stock: number }[]
    },
  })
  const levelMap = useMemo(() => {
    const m: Record<string, number> = {}
    for (const l of levels) m[l.id] = Number(l.current_stock)
    return m
  }, [levels])

  // ── Individual tool units ─────────────────────────────────────────────────
  const { data: toolUnits = [], isLoading: loadingUnits } = useQuery({
    queryKey: ['tool-units'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tool_units')
        .select('*, stock_items(item_name, item_code, main_category), staff:current_holder_id(employee_name)')
        .eq('active', true)
        .order('asset_code')
      if (error) throw error
      return data as ToolUnitRow[]
    },
  })

  // ── Filtered tool items ───────────────────────────────────────────────────
  const filteredItems = useMemo(() => {
    if (!search.trim()) return toolItems
    const q = search.toLowerCase()
    return toolItems.filter(i =>
      i.item_name.toLowerCase().includes(q) ||
      (i.amharic_name ?? '').includes(q) ||
      (i.item_code ?? '').toLowerCase().includes(q)
    )
  }, [toolItems, search])

  // ── Filtered tool units ───────────────────────────────────────────────────
  const filteredUnits = useMemo(() => {
    let list = toolUnits
    if (statusFilter === 'available')   list = list.filter(t => !t.current_holder_id)
    if (statusFilter === 'checked_out') list = list.filter(t => !!t.current_holder_id)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(t =>
        t.asset_code.toLowerCase().includes(q) ||
        (t.serial_number ?? '').toLowerCase().includes(q) ||
        (t.stock_items?.item_name ?? '').toLowerCase().includes(q) ||
        (t.staff?.employee_name ?? '').toLowerCase().includes(q) ||
        (t.stock_items?.item_code ?? '').toLowerCase().includes(q)
      )
    }
    return list
  }, [toolUnits, statusFilter, search])

  const stats = useMemo(() => ({
    totalItems:  toolItems.length,
    totalUnits:  toolUnits.length,
    available:   toolUnits.filter(t => !t.current_holder_id).length,
    checkedOut:  toolUnits.filter(t => !!t.current_holder_id).length,
    damaged:     toolUnits.filter(t => t.condition === 'damaged').length,
  }), [toolItems, toolUnits])

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Tool Inventory</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">All tools in catalog and individual unit tracking</p>
        </div>
        <Link
          to="/stock/movement/new"
          className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90"
        >
          <ArrowRightLeft className="h-4 w-4" /> Record Movement
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Tool Types',   value: stats.totalItems  },
          { label: 'Total Units',  value: stats.totalUnits  },
          { label: 'Available',    value: stats.available   },
          { label: 'Checked Out',  value: stats.checkedOut  },
          { label: 'Damaged',      value: stats.damaged     },
        ].map(s => (
          <div key={s.label} className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm">
            <p className="text-xs text-slate-500 uppercase tracking-wide">{s.label}</p>
            <p className="text-2xl font-bold text-slate-800 dark:text-slate-100 mt-0.5">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs + search row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        {/* Tabs */}
        <div className="flex gap-1 border-b dark:border-slate-700 w-full sm:w-auto">
          <button
            onClick={() => setTab('catalog')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === 'catalog'
                ? 'border-brand text-brand'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            <Package className="h-3.5 w-3.5" /> Tool Catalog
          </button>
          <button
            onClick={() => setTab('units')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === 'units'
                ? 'border-brand text-brand'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            <Layers className="h-3.5 w-3.5" /> Individual Units
            {stats.totalUnits > 0 && (
              <span className="ml-1 rounded-full bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:text-slate-300">
                {stats.totalUnits}
              </span>
            )}
          </button>
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-sm sm:ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <input
            type="text"
            placeholder={tab === 'catalog' ? 'Search tools…' : 'Search asset code, serial, item…'}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-lg border dark:border-slate-600 bg-white dark:bg-slate-800 pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand"
          />
        </div>

        {/* Units filter (only shown on units tab) */}
        {tab === 'units' && (
          <div className="flex gap-1.5">
            {(['all', 'available', 'checked_out'] as const).map(f => (
              <button key={f} onClick={() => setStatusFilter(f)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  statusFilter === f ? 'bg-brand text-white' : 'bg-white dark:bg-slate-800 border dark:border-slate-700 text-slate-600 hover:border-brand'
                }`}>
                {f === 'all' ? 'All' : f === 'available' ? 'Available' : 'Checked Out'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Tab: Tool Catalog ─────────────────────────────────────── */}
      {tab === 'catalog' && (
        loadingItems ? (
          <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
        ) : filteredItems.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed dark:border-slate-700 bg-white dark:bg-slate-800 py-16 text-center">
            <Wrench className="mx-auto h-8 w-8 text-slate-300 mb-3" />
            <p className="text-sm text-slate-500">{search ? 'No matching tools.' : 'No tools in catalog.'}</p>
            {!search && (
              <Link to="/stock/new" className="mt-3 inline-flex items-center gap-1 text-sm text-brand font-medium hover:underline">
                Add a tool to the catalog
              </Link>
            )}
          </div>
        ) : (
          <div className="rounded-xl border dark:border-slate-700 overflow-hidden divide-y divide-slate-100 dark:divide-slate-700/60 shadow-sm">
            {filteredItems.map(item => {
              const currentStock = levelMap[item.id]
              const isLow = currentStock !== undefined && item.reorder_level != null && currentStock > 0 && currentStock <= item.reorder_level
              const isOut = currentStock !== undefined && currentStock <= 0
              return (
                <div
                  key={item.id}
                  className={`group flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors cursor-pointer ${
                    isOut ? 'border-l-2 border-red-400' : isLow ? 'border-l-2 border-amber-400' : ''
                  }`}
                  onClick={() => navigate(`/stock/${item.id}`)}
                >
                  <div className={`flex-shrink-0 rounded-lg p-2 ${isOut ? 'bg-red-50 text-red-400' : 'bg-purple-50 text-purple-500'}`}>
                    <Wrench className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{item.item_name}</span>
                      {item.amharic_name && <span className="text-xs text-slate-400">{item.amharic_name}</span>}
                      {item.item_code && (
                        <span className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-slate-100 dark:bg-slate-700 text-slate-500">
                          <Hash className="h-2.5 w-2.5" />{item.item_code}
                        </span>
                      )}
                      {isOut && <span className="rounded-full px-2 py-0.5 text-[10px] font-bold bg-red-100 text-red-700">Out</span>}
                      {isLow && !isOut && <span className="rounded-full px-2 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-700">Low</span>}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-400 flex-wrap">
                      {item.main_category && <span>{CAT_LABEL[item.main_category]}</span>}
                      {currentStock !== undefined && (
                        <span className={isOut ? 'text-red-500 font-medium' : isLow ? 'text-amber-600 font-medium' : ''}>
                          {currentStock} {item.unit}
                        </span>
                      )}
                      {item.quality_grade && <span>{item.quality_grade}</span>}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-400 flex-shrink-0 transition-colors" />
                </div>
              )
            })}
          </div>
        )
      )}

      {/* ── Tab: Individual Units ─────────────────────────────────── */}
      {tab === 'units' && (
        loadingUnits ? (
          <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
        ) : filteredUnits.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed dark:border-slate-700 bg-white dark:bg-slate-800 py-16 text-center">
            <Layers className="mx-auto h-8 w-8 text-slate-300 mb-3" />
            <p className="text-sm text-slate-500">{search || statusFilter !== 'all' ? 'No matching units.' : 'No individual tool units registered yet.'}</p>
            {!search && statusFilter === 'all' && (
              <p className="text-xs text-slate-400 mt-2">
                Register individual units (with serial numbers) from a tool item's detail page in the{' '}
                <button onClick={() => setTab('catalog')} className="text-brand hover:underline">Tool Catalog</button>.
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-xl border dark:border-slate-700 overflow-hidden divide-y divide-slate-100 dark:divide-slate-700/60 shadow-sm">
            {filteredUnits.map(tool => {
              const cond = CONDITION_STYLES[tool.condition]
              return (
                <div
                  key={tool.id}
                  className="group flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors cursor-pointer"
                  onClick={() => navigate(`/stock/${tool.stock_item_id}`)}
                >
                  <div className={`flex-shrink-0 rounded-lg p-2 ${tool.current_holder_id ? 'bg-amber-50 text-amber-500' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'}`}>
                    <Wrench className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-semibold text-brand">{tool.asset_code}</span>
                      <span className="text-sm text-slate-700 dark:text-slate-200">{tool.stock_items?.item_name ?? '—'}</span>
                      {tool.stock_items?.item_code && (
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-mono bg-slate-100 dark:bg-slate-700 text-slate-500">
                          {tool.stock_items.item_code}
                        </span>
                      )}
                      <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${cond.cls}`}>
                        {cond.icon}{cond.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-400 flex-wrap">
                      {tool.serial_number && <span>S/N: {tool.serial_number}</span>}
                      {tool.current_holder_id
                        ? <span className="text-amber-600 dark:text-amber-400">With: {tool.staff?.employee_name ?? '—'} since {tool.checked_out_since ?? '?'}</span>
                        : <span className="text-green-600 dark:text-green-400">Available in stock</span>
                      }
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-400 flex-shrink-0 transition-colors" />
                </div>
              )
            })}
          </div>
        )
      )}
    </div>
  )
}
