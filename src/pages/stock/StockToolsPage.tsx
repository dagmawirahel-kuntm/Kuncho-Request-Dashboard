import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { ToolUnit, ToolCondition } from '@/types/database'
import { Search, Wrench, CheckCircle2, AlertCircle, XCircle, ChevronRight, ArrowRightLeft } from 'lucide-react'

const CONDITION_STYLES: Record<ToolCondition, { label: string; cls: string; icon: React.ReactNode }> = {
  good:    { label: 'Good',    cls: 'text-green-700 bg-green-50 dark:bg-green-900/30',  icon: <CheckCircle2 className="h-3 w-3" /> },
  fair:    { label: 'Fair',    cls: 'text-amber-700 bg-amber-50 dark:bg-amber-900/30',  icon: <AlertCircle className="h-3 w-3" /> },
  damaged: { label: 'Damaged', cls: 'text-red-700 bg-red-50 dark:bg-red-900/30',        icon: <AlertCircle className="h-3 w-3" /> },
  retired: { label: 'Retired', cls: 'text-slate-500 bg-slate-100 dark:bg-slate-700',    icon: <XCircle className="h-3 w-3" /> },
}

type ToolUnitWithMeta = ToolUnit & {
  stock_items: { item_name: string; main_category: string | null } | null
  staff: { employee_name: string } | null
}

export default function StockToolsPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'available' | 'checked_out'>('all')

  const { data = [], isLoading } = useQuery({
    queryKey: ['tool-units'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tool_units')
        .select('*, stock_items(item_name, main_category), staff:current_holder_id(employee_name)')
        .eq('active', true)
        .order('asset_code')
      if (error) throw error
      return data as ToolUnitWithMeta[]
    },
  })

  const filtered = useMemo(() => {
    let list = data
    if (statusFilter === 'available') list = list.filter(t => !t.current_holder_id)
    if (statusFilter === 'checked_out') list = list.filter(t => !!t.current_holder_id)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(t =>
        t.asset_code.toLowerCase().includes(q) ||
        (t.serial_number ?? '').toLowerCase().includes(q) ||
        (t.stock_items?.item_name ?? '').toLowerCase().includes(q) ||
        (t.staff?.employee_name ?? '').toLowerCase().includes(q)
      )
    }
    return list
  }, [data, statusFilter, search])

  const stats = useMemo(() => ({
    total: data.length,
    available: data.filter(t => !t.current_holder_id).length,
    checkedOut: data.filter(t => !!t.current_holder_id).length,
    damaged: data.filter(t => t.condition === 'damaged').length,
  }), [data])

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Tool Inventory</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Individual tool units, asset codes, and check-out status</p>
        </div>
        <Link
          to="/stock/movement/new"
          className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90"
        >
          <ArrowRightLeft className="h-4 w-4" /> Record Movement
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Tools', value: stats.total },
          { label: 'Available', value: stats.available },
          { label: 'Checked Out', value: stats.checkedOut },
          { label: 'Damaged', value: stats.damaged },
        ].map(s => (
          <div key={s.label} className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm">
            <p className="text-xs text-slate-500 uppercase tracking-wide">{s.label}</p>
            <p className="text-2xl font-bold text-slate-800 dark:text-slate-100 mt-0.5">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <input type="text" placeholder="Search asset code, serial, item…" value={search} onChange={e => setSearch(e.target.value)}
            className="w-full rounded-lg border dark:border-slate-600 bg-white dark:bg-slate-800 pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand" />
        </div>
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
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed dark:border-slate-700 bg-white dark:bg-slate-800 py-16 text-center">
          <Wrench className="mx-auto h-8 w-8 text-slate-300 mb-3" />
          <p className="text-sm text-slate-500">{search || statusFilter !== 'all' ? 'No matching tools.' : 'No tool units registered yet.'}</p>
          {!search && statusFilter === 'all' && (
            <p className="text-xs text-slate-400 mt-2">Add tools by going to <Link to="/stock" className="text-brand hover:underline">Stock Catalog</Link> and registering individual units on a tool item.</p>
          )}
        </div>
      ) : (
        <div className="rounded-xl border dark:border-slate-700 overflow-hidden divide-y divide-slate-100 dark:divide-slate-700/60 shadow-sm">
          {filtered.map(tool => {
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
      )}
    </div>
  )
}
