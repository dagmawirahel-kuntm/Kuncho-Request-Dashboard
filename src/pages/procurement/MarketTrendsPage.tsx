import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useLatestPrices, useVendorHistory, usePriceHistory, useSubCategoryLatestPrices, FRESHNESS_CLASS, FRESHNESS_LABEL, type LatestPriceRow, type Freshness, type Volatility } from '@/hooks/useMarketPrices'
import { formatCurrency, formatDate } from '@/lib/utils'
import { LogVerifiedPriceModal } from '@/components/shared/LogVerifiedPriceModal'
import { RequestPriceCheckModal } from '@/components/shared/RequestPriceCheckModal'
import { TrendingUp, TrendingDown, Search, Download, X, Package, AlertTriangle, Clock } from 'lucide-react'

const PROCUREMENT_ROLES = ['admin', 'executive', 'procurement_officer']

// Market Trends — Procurement's single-pane view of every tracked item's
// latest price, freshness, and 90-day movement. Row-click opens a slide-out
// with the price chart and per-vendor quote history.
export default function MarketTrendsPage() {
  const { role } = useAuth()
  const isProcurement = PROCUREMENT_ROLES.includes(role ?? '')
  const { data: prices = [], isLoading } = useLatestPrices()

  const [q, setQ] = useState('')
  const [freshFilter, setFreshFilter] = useState<Set<Freshness>>(new Set())
  const [volFilter, setVolFilter]     = useState<Set<Volatility>>(new Set())
  const [openReqOnly, setOpenReqOnly] = useState(false)
  const [sort, setSort] = useState<'name' | 'days_desc' | 'trend_desc' | 'trend_asc' | 'price_desc'>('days_desc')
  const [selected, setSelected] = useState<LatestPriceRow | null>(null)
  const [logOpen, setLogOpen] = useState(false)
  const [reqOpen, setReqOpen] = useState(false)

  // Open-request set — one query used by both the header count and the row filter.
  const { data: openRequests = [] } = useQuery({
    queryKey: ['market-check-requests-open-item-ids'],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('market_price_check_requests')
        .select('stock_item_id')
        .eq('status', 'open')
      if (error) throw error
      return (data ?? []).map(r => r.stock_item_id as string)
    },
  })
  const openItemIds = useMemo(() => new Set(openRequests), [openRequests])

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase()
    const arr = prices.filter(p => {
      if (freshFilter.size > 0 && !freshFilter.has(p.freshness)) return false
      if (volFilter.size > 0 && !volFilter.has(p.volatility)) return false
      if (openReqOnly && !openItemIds.has(p.stock_item_id)) return false
      if (ql) {
        const hay = `${p.item_name} ${p.amharic_name ?? ''} ${p.item_code}`.toLowerCase()
        if (!hay.includes(ql)) return false
      }
      return true
    })
    arr.sort((a, b) => {
      if (sort === 'name')       return a.item_name.localeCompare(b.item_name)
      if (sort === 'trend_desc') return (b.price_trend_90d_pct ?? -Infinity) - (a.price_trend_90d_pct ?? -Infinity)
      if (sort === 'trend_asc')  return (a.price_trend_90d_pct ??  Infinity) - (b.price_trend_90d_pct ??  Infinity)
      if (sort === 'price_desc') return (b.display_price ?? 0) - (a.display_price ?? 0)
      // days_desc default
      return (b.days_since_display_price ?? -1) - (a.days_since_display_price ?? -1)
    })
    return arr
  }, [prices, freshFilter, volFilter, openReqOnly, q, sort, openItemIds])

  // Dashboard stats
  const stats = useMemo(() => {
    const withPrice = prices.filter(p => p.display_price != null)
    const outdated  = prices.filter(p => p.freshness === 'outdated').length
    const openReqs  = openItemIds.size
    const movers    = withPrice
      .filter(p => p.price_trend_90d_pct != null)
      .map(p => ({ ...p, absPct: Math.abs(Number(p.price_trend_90d_pct)) }))
    const gainers = [...withPrice].filter(p => (p.price_trend_90d_pct ?? 0) > 0)
      .sort((a, b) => Number(b.price_trend_90d_pct) - Number(a.price_trend_90d_pct)).slice(0, 5)
    const losers = [...withPrice].filter(p => (p.price_trend_90d_pct ?? 0) < 0)
      .sort((a, b) => Number(a.price_trend_90d_pct) - Number(b.price_trend_90d_pct)).slice(0, 5)
    return { tracked: withPrice.length, outdated, openReqs, moversCount: movers.length, gainers, losers }
  }, [prices, openItemIds])

  function exportCsv() {
    const rows = [['Item', 'Unit', 'Latest Price', 'Sourced At', 'Days Old', 'Freshness', 'Volatility', 'Trend 90d %', 'Source']]
    for (const p of filtered) {
      rows.push([
        p.item_name, p.unit,
        String(p.display_price ?? ''), p.display_price_sourced_at ?? '',
        String(p.days_since_display_price ?? ''), p.freshness, p.volatility,
        p.price_trend_90d_pct != null ? String(p.price_trend_90d_pct) : '',
        p.display_price_source ?? '',
      ])
    }
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url; a.download = `market-trends-${new Date().toISOString().slice(0, 10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <TrendingUp className="h-6 w-6 text-brand" /> Market Trends
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Every stock item's latest verified price, freshness signal, and 90-day movement. Verified quotes beat PO-derived prices while they're still fresh.
        </p>
      </div>

      {/* Header stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Tracked (with price)" value={stats.tracked} icon={<Package className="h-4 w-4" />} />
        <StatCard label="Outdated" value={stats.outdated} tone="red" icon={<AlertTriangle className="h-4 w-4" />} onClick={() => setFreshFilter(new Set(['outdated']))} />
        <StatCard label="Open check requests" value={stats.openReqs} tone="amber" icon={<Clock className="h-4 w-4" />} onClick={() => setOpenReqOnly(true)} />
        <StatCard label="Items with 90d trend" value={stats.moversCount} icon={<TrendingUp className="h-4 w-4" />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <MoversCard title="Biggest gainers (90d)" icon={<TrendingUp className="h-4 w-4 text-red-500" />} rows={stats.gainers} onOpen={setSelected} />
        <MoversCard title="Biggest drops (90d)"    icon={<TrendingDown className="h-4 w-4 text-emerald-500" />} rows={stats.losers}  onOpen={setSelected} />
      </div>

      {/* Filter strip */}
      <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search item name, amharic name, or code…"
              className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 focus:ring-2 focus:ring-brand outline-none" />
          </div>
          <select value={sort} onChange={e => setSort(e.target.value as typeof sort)} className="text-sm rounded-md border dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 px-2 py-1.5">
            <option value="days_desc">Oldest price first</option>
            <option value="name">Name</option>
            <option value="trend_desc">Biggest gainers</option>
            <option value="trend_asc">Biggest drops</option>
            <option value="price_desc">Highest price</option>
          </select>
          <button onClick={exportCsv} className="flex items-center gap-1.5 rounded-md border dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(['fresh', 'aging', 'stale', 'outdated'] as Freshness[]).map(f => (
            <Chip key={f} label={FRESHNESS_LABEL[f]} active={freshFilter.has(f)} onClick={() => setFreshFilter(toggleSet(freshFilter, f))} tone={f} />
          ))}
          <span className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-1" />
          {(['volatile', 'moderate', 'stable'] as Volatility[]).map(v => (
            <Chip key={v} label={v} active={volFilter.has(v)} onClick={() => setVolFilter(toggleSet(volFilter, v))} />
          ))}
          <span className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-1" />
          <Chip label="With open check request" active={openReqOnly} onClick={() => setOpenReqOnly(v => !v)} />
        </div>
      </div>

      {/* Main table */}
      <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 overflow-hidden">
        {isLoading ? (
          <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-400">No items match your filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 border-b dark:border-slate-700">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-slate-500">Item</th>
                  <th className="text-left px-2 py-2 font-medium text-slate-500">Unit</th>
                  <th className="text-right px-2 py-2 font-medium text-slate-500">Latest Price</th>
                  <th className="text-left px-2 py-2 font-medium text-slate-500">Days Old</th>
                  <th className="text-left px-2 py-2 font-medium text-slate-500">Freshness</th>
                  <th className="text-left px-2 py-2 font-medium text-slate-500">90d Trend</th>
                  <th className="text-left px-2 py-2 font-medium text-slate-500">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-700">
                {filtered.map(p => (
                  <tr key={p.stock_item_id} onClick={() => setSelected(p)} className="hover:bg-slate-50 dark:hover:bg-slate-700/40 cursor-pointer">
                    <td className="px-4 py-2">
                      <div className="text-slate-700 dark:text-slate-200 font-medium truncate max-w-[280px]">{p.item_name}</div>
                      {p.amharic_name && <div className="text-[10px] text-slate-400">{p.amharic_name}</div>}
                    </td>
                    <td className="px-2 py-2 text-xs text-slate-500">{p.unit}</td>
                    <td className="px-2 py-2 text-right tabular-nums font-medium text-slate-700 dark:text-slate-200">
                      {p.display_price != null ? formatCurrency(p.display_price) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-2 py-2 text-xs text-slate-500">
                      {p.days_since_display_price != null ? `${p.days_since_display_price}d` : '—'}
                      {openItemIds.has(p.stock_item_id) && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-500" title="Open check request" />}
                    </td>
                    <td className="px-2 py-2">
                      <span className={`inline-block text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border ${FRESHNESS_CLASS[p.freshness]}`}>
                        {FRESHNESS_LABEL[p.freshness]}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-xs tabular-nums">
                      {p.price_trend_90d_pct == null ? <span className="text-slate-300">—</span> :
                        <span className={Number(p.price_trend_90d_pct) > 0 ? 'text-red-600' : 'text-emerald-600'}>
                          {Number(p.price_trend_90d_pct) > 0 ? '↑' : '↓'} {Math.abs(Number(p.price_trend_90d_pct)).toFixed(1)}%
                        </span>}
                    </td>
                    <td className="px-2 py-2 text-[11px] text-slate-500 capitalize">{(p.display_price_source ?? '—').replace(/_/g, ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Slide-out detail panel */}
      {selected && (
        <ItemDetailPanel
          item={selected}
          onClose={() => setSelected(null)}
          isProcurement={isProcurement}
          onLogVerified={() => setLogOpen(true)}
          onRequestCheck={() => setReqOpen(true)}
        />
      )}

      {logOpen && selected && (
        <LogVerifiedPriceModal stockItem={{ id: selected.stock_item_id, item_name: selected.item_name, unit: selected.unit }} onClose={() => setLogOpen(false)} />
      )}
      {reqOpen && selected && (
        <RequestPriceCheckModal stockItem={{ id: selected.stock_item_id, item_name: selected.item_name }} onClose={() => setReqOpen(false)} />
      )}

      <SubCategorySurveys isProcurement={isProcurement} />
    </div>
  )
}

// Category-level and free-text quotes (rows without a stock_item_id). Shows
// the latest quote per (sub_category, item_description) pair so a repeated
// survey of the same category updates in place instead of stacking.
function SubCategorySurveys({ isProcurement }: { isProcurement: boolean }) {
  const { data: rows = [], isLoading } = useSubCategoryLatestPrices()
  const [logOpen, setLogOpen] = useState(false)
  const [reqOpen, setReqOpen] = useState(false)

  return (
    <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 overflow-hidden">
      <div className="px-4 py-3 border-b dark:border-slate-700 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Sub-category surveys & new-item quotes</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">Category-level prices and free-text quotes for items not in the stock catalog.</p>
        </div>
        <div className="flex gap-2">
          {isProcurement && <button onClick={() => setLogOpen(true)} className="text-xs rounded-md bg-brand text-white px-2.5 py-1 hover:bg-brand/90">Log category price</button>}
          <button onClick={() => setReqOpen(true)} className="text-xs rounded-md border dark:border-slate-600 text-slate-600 dark:text-slate-300 px-2.5 py-1 hover:bg-slate-50 dark:hover:bg-slate-700">Request survey</button>
        </div>
      </div>
      {isLoading ? (
        <div className="py-8 text-center text-sm text-slate-400">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-400">No sub-category surveys yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/40 border-b dark:border-slate-700">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-slate-500">Anchor</th>
                <th className="text-left px-2 py-2 font-medium text-slate-500">Unit</th>
                <th className="text-right px-2 py-2 font-medium text-slate-500">Latest Price</th>
                <th className="text-left px-2 py-2 font-medium text-slate-500">Vendor</th>
                <th className="text-left px-2 py-2 font-medium text-slate-500">When</th>
                <th className="text-left px-2 py-2 font-medium text-slate-500">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-700">
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="px-4 py-2 text-slate-700 dark:text-slate-200">
                    {r.item_description
                      ? <><span className="font-medium">{r.item_description}</span><span className="block text-[10px] text-slate-400">new item · {r.sub_category_name}</span></>
                      : <><span className="font-medium">{r.sub_category_name}</span><span className="block text-[10px] text-slate-400">sub-category survey</span></>
                    }
                    {(r.brand || r.specification) && (
                      <span className="block text-[10px] text-brand mt-0.5">{[r.brand, r.specification].filter(Boolean).join(' · ')}</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-xs text-slate-500">{r.unit}</td>
                  <td className="px-2 py-2 text-right tabular-nums font-medium text-slate-700 dark:text-slate-200">
                    {r.unit_price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {r.currency}
                  </td>
                  <td className="px-2 py-2 text-xs text-slate-500">{r.vendor_name ?? '—'}</td>
                  <td className="px-2 py-2 text-xs text-slate-500">{r.days_since_sourced}d ago</td>
                  <td className="px-2 py-2 text-[11px] text-slate-500 capitalize">{(r.source ?? '—').replace(/_/g, ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {logOpen && <LogVerifiedPriceModal onClose={() => setLogOpen(false)} />}
      {reqOpen && <RequestPriceCheckModal onClose={() => setReqOpen(false)} />}
    </div>
  )
}

function StatCard({ label, value, tone, icon, onClick }: { label: string; value: number; tone?: 'red' | 'amber'; icon: React.ReactNode; onClick?: () => void }) {
  const cls = tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : 'text-slate-700 dark:text-slate-200'
  return (
    <button onClick={onClick} disabled={!onClick} className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4 text-left disabled:cursor-default hover:shadow-sm transition-shadow">
      <div className="flex items-center gap-2 text-slate-400 text-[11px] uppercase tracking-wide font-medium">{icon} {label}</div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${cls}`}>{value}</div>
    </button>
  )
}

function MoversCard({ title, icon, rows, onOpen }: { title: string; icon: React.ReactNode; rows: LatestPriceRow[]; onOpen: (r: LatestPriceRow) => void }) {
  return (
    <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2 mb-2">{icon}{title}</h3>
      {rows.length === 0 ? <p className="text-xs text-slate-400 py-2">No movement data yet.</p> : (
        <ul className="divide-y dark:divide-slate-700">
          {rows.map(r => (
            <li key={r.stock_item_id} className="py-1.5 flex items-center justify-between text-sm">
              <button onClick={() => onOpen(r)} className="text-slate-700 dark:text-slate-200 hover:text-brand truncate max-w-[220px] text-left">{r.item_name}</button>
              <span className={`tabular-nums text-xs ${Number(r.price_trend_90d_pct) > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                {Number(r.price_trend_90d_pct) > 0 ? '↑' : '↓'} {Math.abs(Number(r.price_trend_90d_pct)).toFixed(1)}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Chip({ label, active, onClick, tone }: { label: string; active: boolean; onClick: () => void; tone?: Freshness }) {
  const activeCls = tone && FRESHNESS_CLASS[tone]
    ? FRESHNESS_CLASS[tone]
    : 'bg-brand text-white border-brand'
  return (
    <button onClick={onClick} className={`text-xs px-2.5 py-1 rounded-full border transition-colors capitalize ${
      active ? activeCls : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600'
    }`}>{label}</button>
  )
}

function toggleSet<T>(s: Set<T>, v: T): Set<T> {
  const out = new Set(s); if (out.has(v)) out.delete(v); else out.add(v); return out
}

function ItemDetailPanel({ item, onClose, isProcurement, onLogVerified, onRequestCheck }: {
  item: LatestPriceRow; onClose: () => void; isProcurement: boolean;
  onLogVerified: () => void; onRequestCheck: () => void;
}) {
  const { data: history = [] } = usePriceHistory(item.stock_item_id)
  const { data: vendors = [] } = useVendorHistory(item.stock_item_id)

  // Cheap sparkline — last 12 points, no external library. SVG polyline.
  const chartPoints = useMemo(() => {
    const pts = [...history].reverse().slice(-24)
    if (pts.length < 2) return null
    const min = Math.min(...pts.map(p => p.unit_price))
    const max = Math.max(...pts.map(p => p.unit_price))
    const range = max - min || 1
    const w = 320, h = 80, pad = 4
    const step = (w - pad * 2) / Math.max(1, pts.length - 1)
    return pts.map((p, i) => `${pad + i * step},${pad + (h - pad * 2) * (1 - (p.unit_price - min) / range)}`).join(' ')
  }, [history])

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="w-full max-w-xl h-full overflow-y-auto bg-white dark:bg-slate-800 shadow-2xl border-l dark:border-slate-700" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b dark:border-slate-700 flex items-start justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">{item.item_name}</h3>
            {item.amharic_name && <p className="text-xs text-slate-500 mt-0.5">{item.amharic_name}</p>}
            <p className="text-[11px] text-slate-400 mt-1">{item.item_code} · {item.unit} · volatility: <span className="capitalize">{item.volatility}</span></p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="rounded-xl border dark:border-slate-700 p-4">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">Current display price</p>
            <div className="flex items-baseline gap-3 mt-1 flex-wrap">
              <span className="text-3xl font-bold text-slate-800 dark:text-slate-100 tabular-nums">
                {item.display_price != null ? formatCurrency(item.display_price) : '—'}
              </span>
              <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border ${FRESHNESS_CLASS[item.freshness]}`}>{FRESHNESS_LABEL[item.freshness]}</span>
              {item.days_since_display_price != null && <span className="text-xs text-slate-500">{item.days_since_display_price} days old</span>}
              {item.price_trend_90d_pct != null && (
                <span className={`text-xs tabular-nums ${Number(item.price_trend_90d_pct) > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {Number(item.price_trend_90d_pct) > 0 ? '↑' : '↓'} {Math.abs(Number(item.price_trend_90d_pct)).toFixed(1)}% vs 90d
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 mt-1 capitalize">Source: {(item.display_price_source ?? '—').replace(/_/g, ' ')}</p>
          </div>

          {chartPoints && (
            <div className="rounded-xl border dark:border-slate-700 p-4">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">Last 24 data points</p>
              <svg viewBox="0 0 320 80" className="w-full h-20">
                <polyline fill="none" stroke="currentColor" strokeWidth="2" points={chartPoints} className="text-brand" />
              </svg>
            </div>
          )}

          <div className="rounded-xl border dark:border-slate-700 overflow-hidden">
            <div className="px-4 py-2 bg-slate-50 dark:bg-slate-900/40 text-xs font-semibold text-slate-700 dark:text-slate-200 border-b dark:border-slate-700">
              Vendors ({vendors.length})
            </div>
            {vendors.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-400">No vendor history yet.</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-white dark:bg-slate-800 border-b dark:border-slate-700">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-slate-500">Vendor</th>
                    <th className="text-right px-3 py-2 font-medium text-slate-500">Latest</th>
                    <th className="text-right px-3 py-2 font-medium text-slate-500">Avg</th>
                    <th className="text-right px-3 py-2 font-medium text-slate-500">Quotes</th>
                    <th className="text-right px-3 py-2 font-medium text-slate-500">Last</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-slate-700">
                  {vendors.map(v => (
                    <tr key={v.vendor_id}>
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{v.vendor_name ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(v.latest_price)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">{formatCurrency(v.average_price)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{v.quotes_count}</td>
                      <td className="px-3 py-2 text-right text-slate-500">{formatDate(v.last_sourced_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="rounded-xl border dark:border-slate-700 overflow-hidden">
            <div className="px-4 py-2 bg-slate-50 dark:bg-slate-900/40 text-xs font-semibold text-slate-700 dark:text-slate-200 border-b dark:border-slate-700">
              History ({history.length})
            </div>
            {history.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-400">No prices logged yet.</p>
            ) : (
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <tbody className="divide-y dark:divide-slate-700">
                    {history.map(h => (
                      <tr key={h.id}>
                        <td className="px-3 py-2 text-slate-500">{formatDate(h.sourced_at)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-700 dark:text-slate-200">{formatCurrency(h.unit_price)}</td>
                        <td className="px-3 py-2 text-[10px] capitalize text-slate-500">{h.source.replace(/_/g, ' ')}</td>
                        <td className="px-3 py-2 text-slate-500 truncate max-w-[160px]">{h.vendor_name ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-2">
            {isProcurement && (
              <button onClick={onLogVerified} className="flex-1 rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand/90">
                Log verified price
              </button>
            )}
            <button onClick={onRequestCheck} className="flex-1 rounded-md border dark:border-slate-600 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700">
              Request check
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
