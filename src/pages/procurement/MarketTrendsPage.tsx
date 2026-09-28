import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useLatestPrices, useFreeTextPrices, sourceLabel, FRESHNESS_CLASS, FRESHNESS_LABEL, type LatestPriceRow, type FreeTextPriceRow, type Freshness, type Volatility } from '@/hooks/useMarketPrices'
import { formatCurrency } from '@/lib/utils'
import { LogVerifiedPriceModal } from '@/components/shared/LogVerifiedPriceModal'
import { RequestPriceCheckModal } from '@/components/shared/RequestPriceCheckModal'
import { RecordTabs, Stat } from '@/components/record/Record'
import { ChangeBadge, FreshnessPill, PriceRange } from '@/components/market/MarketBits'
import { PriceDetailDrawer, type PriceTarget } from '@/components/market/PriceDetailDrawer'
import { TrendingUp, TrendingDown, Search, Download, Copy, ArrowRight, Info } from 'lucide-react'

const PROCUREMENT_ROLES = ['admin', 'executive', 'procurement_officer']
/** Who can open stock pages (the stock route guard). */
const STOCK_ROLES = ['admin', 'executive', 'stock_manager', 'procurement_officer']

type Tab = 'stock' | 'free'
type Coverage = 'priced' | 'unpriced' | 'all'
type Sort = 'days_desc' | 'recent' | 'name' | 'price_desc' | 'rise' | 'drop' | 'bought'

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Market Trends: what Kuncho pays for materials. Every approved purchase
 * order adds its prices (migration 367), procurement adds verified quotes,
 * and the proforma's price guide and the catalog's costs read from here.
 */
export default function MarketTrendsPage() {
  const { role } = useAuth()
  const isProcurement = PROCUREMENT_ROLES.includes(role ?? '')
  const canOpenStock = STOCK_ROLES.includes(role ?? '')
  const { data: prices = [], isLoading } = useLatestPrices()
  const { data: freeRows = [], isLoading: freeLoading } = useFreeTextPrices()

  const [tab, setTab] = useState<Tab>('stock')
  const [q, setQ] = useState('')
  const [coverage, setCoverage] = useState<Coverage>('priced')
  const [category, setCategory] = useState('')
  const [freshFilter, setFreshFilter] = useState<Set<Freshness>>(new Set())
  const [volFilter, setVolFilter] = useState<Set<Volatility>>(new Set())
  const [openReqOnly, setOpenReqOnly] = useState(false)
  const [sort, setSort] = useState<Sort>('recent')
  const [target, setTarget] = useState<PriceTarget | null>(null)
  const [logFor, setLogFor] = useState<null | { id: string; item_name: string; unit: string } | 'any'>(null)
  const [reqFor, setReqFor] = useState<null | { id: string; item_name: string } | 'any'>(null)
  const [now] = useState(() => Date.now())

  const { data: openRequests = [] } = useQuery({
    queryKey: ['market-check-requests-open-item-ids'],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('market_price_check_requests').select('stock_item_id').eq('status', 'open')
      if (error) throw error
      return (data ?? []).map(r => r.stock_item_id as string | null).filter(Boolean) as string[]
    },
  })
  const openItemIds = useMemo(() => new Set(openRequests), [openRequests])

  const categories = useMemo(() => [...new Set(prices.map(p => p.main_category).filter(Boolean) as string[])].sort(), [prices])

  const stats = useMemo(() => {
    const priced = prices.filter(p => p.display_price != null)
    const count = (f: Freshness) => priced.filter(p => p.freshness === f).length
    const monthAgo = now - 30 * 86_400_000
    // The same thing kept as several stock items splits its price history.
    const groups = new Map<string, number>()
    for (const p of prices) { const k = norm(p.item_name); if (k) groups.set(k, (groups.get(k) ?? 0) + 1) }
    const dupItems = [...groups.values()].filter(n => n > 1).reduce((s, n) => s + n, 0)
    const movers = priced.filter(p => moveOf(p) != null)
    return {
      total: prices.length, priced: priced.length,
      fresh: count('fresh'), aging: count('aging') + count('stale'), outdated: count('outdated'),
      unpriced: prices.length - priced.length,
      boughtMonth: priced.filter(p => p.last_bought_at && new Date(p.last_bought_at).getTime() >= monthAgo).length,
      dupItems,
      rises: movers.filter(p => moveOf(p)! > 0).sort((a, b) => moveOf(b)! - moveOf(a)!).slice(0, 5),
      drops: movers.filter(p => moveOf(p)! < 0).sort((a, b) => moveOf(a)! - moveOf(b)!).slice(0, 5),
    }
  }, [prices, now])

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase()
    const arr = prices.filter(p => {
      if (coverage === 'priced' && p.display_price == null) return false
      if (coverage === 'unpriced' && p.display_price != null) return false
      if (category && p.main_category !== category) return false
      if (freshFilter.size > 0 && !(p.display_price != null && freshFilter.has(p.freshness))) return false
      if (volFilter.size > 0 && !volFilter.has(p.volatility)) return false
      if (openReqOnly && !openItemIds.has(p.stock_item_id)) return false
      if (ql && !`${p.item_name} ${p.amharic_name ?? ''} ${p.item_code} ${p.sub_category_name ?? ''} ${p.display_vendor_name ?? ''}`.toLowerCase().includes(ql)) return false
      return true
    })
    const t = (s: string | null) => (s ? new Date(s).getTime() : 0)
    arr.sort((a, b) => {
      switch (sort) {
        case 'name': return a.item_name.localeCompare(b.item_name)
        case 'recent': return t(b.display_price_sourced_at) - t(a.display_price_sourced_at)
        case 'price_desc': return (b.display_price ?? 0) - (a.display_price ?? 0)
        case 'rise': return (moveOf(b) ?? -Infinity) - (moveOf(a) ?? -Infinity)
        case 'drop': return (moveOf(a) ?? Infinity) - (moveOf(b) ?? Infinity)
        case 'bought': return b.buys_180d - a.buys_180d
        default: return (b.days_since_display_price ?? -1) - (a.days_since_display_price ?? -1)
      }
    })
    return arr
  }, [prices, coverage, category, freshFilter, volFilter, openReqOnly, q, sort, openItemIds])

  const freeFiltered = useMemo(() => {
    const ql = q.trim().toLowerCase()
    return freeRows.filter(r =>
      (freshFilter.size === 0 || freshFilter.has(r.freshness))
      && (!ql || `${r.name} ${r.sub_category_name ?? ''} ${r.vendor_name ?? ''} ${r.brand ?? ''}`.toLowerCase().includes(ql)))
  }, [freeRows, q, freshFilter])

  function exportCsv() {
    const rows: string[][] = tab === 'stock'
      ? [['Item', 'Code', 'Category', 'Unit', 'Latest price', 'Date', 'Days old', 'Freshness', 'Source', 'Vendor', 'Previous price', 'Change %', 'Low 6mo', 'High 6mo', 'Times bought 6mo'],
        ...filtered.map(p => [p.item_name, p.item_code, p.main_category ?? '', p.unit, String(p.display_price ?? ''), p.display_price_sourced_at?.slice(0, 10) ?? '',
          String(p.days_since_display_price ?? ''), p.display_price != null ? p.freshness : 'no price', sourceLabel(p.display_price_source), p.display_vendor_name ?? '',
          String(p.previous_price ?? ''), String(p.change_vs_previous_pct ?? ''), String(p.min_180d ?? ''), String(p.max_180d ?? ''), String(p.buys_180d)])]
      : [['Name', 'Kind', 'Unit', 'Latest price', 'Date', 'Days old', 'Vendor', 'Low', 'High', 'Times bought'],
        ...freeFiltered.map(r => [r.name, r.is_sub_category_survey ? 'Category survey' : 'Not in stock list', r.unit, String(r.latest_price), r.sourced_at.slice(0, 10),
          String(r.days_old), r.vendor_name ?? '', String(r.min_price), String(r.max_price), String(r.buys)])]
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url; a.download = `market-prices-${tab}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  const openStock = (p: LatestPriceRow) => setTarget({
    kind: 'stock', stockItemId: p.stock_item_id, name: p.item_name, unit: p.unit,
    sub: [p.item_code, p.sub_category_name].filter(Boolean).join(' · '),
    freshness: p.display_price != null ? p.freshness : undefined, volatility: p.volatility,
  })
  const openFree = (r: FreeTextPriceRow) => setTarget({
    kind: 'free', anchorKey: r.anchor_key, name: r.name, unit: r.unit,
    sub: [r.is_sub_category_survey ? 'category survey' : r.sub_category_name, r.brand, r.specification].filter(Boolean).join(' · '), freshness: r.freshness,
  })
  const selectedStock = target?.kind === 'stock' ? prices.find(p => p.stock_item_id === target.stockItemId) : undefined

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-800 dark:text-slate-100">
            <TrendingUp className="h-6 w-6 text-brand" /> Market Trends
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            What we pay for materials. Every approved purchase order adds its prices, and procurement adds verified quotes. Proformas and catalog costs are priced from here.
          </p>
        </div>
        <div className="flex gap-2">
          {isProcurement && (
            <button onClick={() => setLogFor('any')} className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90">Log a price</button>
          )}
          <button onClick={() => setReqFor('any')} className="rounded-md border px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">Ask for a price check</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <StatButton onClick={() => { setTab('stock'); setCoverage('priced'); setFreshFilter(new Set()) }}>
          <Stat label="Stock items priced" value={`${stats.priced} of ${stats.total}`} sub={`${Math.round((stats.priced / Math.max(stats.total, 1)) * 100)}% have a price`} />
        </StatButton>
        <StatButton onClick={() => { setTab('stock'); setCoverage('priced'); setFreshFilter(new Set(['fresh'])) }}>
          <Stat label="Fresh" value={stats.fresh} tone="green" sub="safe to quote from" />
        </StatButton>
        <StatButton onClick={() => { setTab('stock'); setCoverage('priced'); setFreshFilter(new Set(['aging', 'stale', 'outdated'])) }}>
          <Stat label="Getting old" value={stats.aging + stats.outdated} tone={stats.aging + stats.outdated ? 'amber' : undefined}
            sub={stats.outdated ? `${stats.outdated} outdated · check first` : 'check before quoting'} />
        </StatButton>
        <StatButton onClick={() => { setTab('stock'); setCoverage('unpriced'); setFreshFilter(new Set()) }}>
          <Stat label="No price yet" value={stats.unpriced} tone={stats.unpriced ? 'red' : undefined} sub="never bought or quoted" />
        </StatButton>
        <StatButton onClick={() => { setTab('free'); setFreshFilter(new Set()) }}>
          <Stat label="Not in the stock list" value={freeRows.length} sub="bought under a typed name" />
        </StatButton>
      </div>

      {stats.dupItems > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/15 dark:text-amber-200 sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1">
            <Copy className="mr-1.5 inline h-4 w-4 align-[-3px]" />
            <b>{stats.dupItems} stock items</b> share a name with another one, so each purchase starts a new price history instead of adding to one. Merging them turns single prices into trends.
          </p>
          {canOpenStock && (
            <Link to="/stock/duplicates" className="inline-flex shrink-0 items-center justify-center gap-1 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700">
              Merge duplicates <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      )}

      {(stats.rises.length > 0 || stats.drops.length > 0) ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <MoversCard title="Went up" icon={<TrendingUp className="h-4 w-4 text-red-500" />} rows={stats.rises} onOpen={openStock} />
          <MoversCard title="Came down" icon={<TrendingDown className="h-4 w-4 text-emerald-500" />} rows={stats.drops} onOpen={openStock} />
        </div>
      ) : stats.priced > 0 && (
        <p className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <Info className="h-3.5 w-3.5 shrink-0" /> No price changes to show yet: each item has one price so far. Rises and drops appear here once an item is bought or quoted again.
        </p>
      )}

      <div className="rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800">
        <div className="border-b px-4 dark:border-slate-700">
          <RecordTabs<Tab> active={tab} onChange={setTab} tabs={[
            { id: 'stock', label: 'Stock items', count: filtered.length },
            { id: 'free', label: 'Not in the stock list', count: freeFiltered.length },
          ]} />
        </div>

        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[12rem] max-w-md flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder={tab === 'stock' ? 'Item, code, category or vendor…' : 'Name, category or vendor…'}
                className="w-full rounded-md border py-1.5 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            {tab === 'stock' && (
              <>
                <div className="inline-flex rounded-md border p-0.5 text-xs dark:border-slate-600" role="group" aria-label="Which items">
                  {([['priced', 'Priced'], ['unpriced', 'No price yet'], ['all', 'All']] as [Coverage, string][]).map(([c, label]) => (
                    <button key={c} onClick={() => setCoverage(c)} aria-pressed={coverage === c}
                      className={`rounded px-2.5 py-1 font-medium ${coverage === c ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700'}`}>{label}</button>
                  ))}
                </div>
                {categories.length > 1 && (
                  <select value={category} onChange={e => setCategory(e.target.value)} aria-label="Category"
                    className="rounded-md border px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                    <option value="">All categories</option>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
                <select value={sort} onChange={e => setSort(e.target.value as Sort)} aria-label="Sort"
                  className="rounded-md border px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                  <option value="recent">Newest price first</option>
                  <option value="days_desc">Oldest price first</option>
                  <option value="bought">Bought most often</option>
                  <option value="rise">Biggest rise</option>
                  <option value="drop">Biggest drop</option>
                  <option value="price_desc">Highest price</option>
                  <option value="name">Name</option>
                </select>
              </>
            )}
            <button onClick={exportCsv} className="ml-auto flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
              <Download className="h-3.5 w-3.5" /> Export
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(['fresh', 'aging', 'stale', 'outdated'] as Freshness[]).map(f => (
              <Chip key={f} label={FRESHNESS_LABEL[f]} active={freshFilter.has(f)} onClick={() => setFreshFilter(toggleSet(freshFilter, f))} tone={f} />
            ))}
            {tab === 'stock' && (
              <>
                <span className="mx-1 h-6 w-px bg-slate-200 dark:bg-slate-700" />
                {(['volatile', 'moderate', 'stable'] as Volatility[]).map(v => (
                  <Chip key={v} label={v} active={volFilter.has(v)} onClick={() => setVolFilter(toggleSet(volFilter, v))} />
                ))}
                <span className="mx-1 h-6 w-px bg-slate-200 dark:bg-slate-700" />
                <Chip label={`Check requested${openItemIds.size ? ` (${openItemIds.size})` : ''}`} active={openReqOnly} onClick={() => setOpenReqOnly(v => !v)} />
              </>
            )}
          </div>
        </div>

        {tab === 'stock' ? (
          isLoading ? <p className="py-12 text-center text-sm text-slate-400">Loading…</p>
            : filtered.length === 0 ? <p className="py-12 text-center text-sm text-slate-400">No items match.</p>
            : (
              <div className="overflow-x-auto border-t dark:border-slate-700">
                <table className="w-full min-w-[860px] text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-900/40">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Item</th>
                      <th className="px-2 py-2 text-right font-medium">Latest price</th>
                      <th className="px-2 py-2 text-left font-medium">Change</th>
                      <th className="px-2 py-2 text-left font-medium">6-month range</th>
                      <th className="px-2 py-2 text-right font-medium" title="Purchase orders in the last 6 months">Bought</th>
                      <th className="px-2 py-2 text-left font-medium">From</th>
                      <th className="px-2 py-2 text-left font-medium">Age</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-slate-700">
                    {filtered.map(p => (
                      <tr key={p.stock_item_id} onClick={() => openStock(p)} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40">
                        <td className="px-4 py-2">
                          <div className="max-w-[280px] truncate font-medium text-slate-700 dark:text-slate-200">
                            {p.item_name}
                            {openItemIds.has(p.stock_item_id) && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle" title="Price check requested" />}
                          </div>
                          <div className="max-w-[280px] truncate text-[11px] text-slate-400">{[p.item_code, p.sub_category_name ?? p.main_category].filter(Boolean).join(' · ')}</div>
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-right">
                          {p.display_price != null ? (
                            <>
                              <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(p.display_price)}</span>
                              <span className="block text-[10px] text-slate-400">per {p.unit}</span>
                            </>
                          ) : <span className="text-xs text-slate-300 dark:text-slate-600">no price</span>}
                        </td>
                        <td className="px-2 py-2"><ChangeBadge pct={moveOf(p)} title={p.previous_price != null ? `Previous ${formatCurrency(p.previous_price)}` : undefined} /></td>
                        <td className="px-2 py-2"><PriceRange min={p.min_180d} max={p.max_180d} latest={p.display_price} /></td>
                        <td className="px-2 py-2 text-right text-xs tabular-nums text-slate-600 dark:text-slate-300">{p.buys_180d || '—'}</td>
                        <td className="px-2 py-2">
                          <div className="max-w-[180px] truncate text-xs text-slate-600 dark:text-slate-300">{p.display_vendor_name ?? '—'}</div>
                          <div className="text-[10px] text-slate-400">{p.display_price != null ? sourceLabel(p.display_price_source) : ''}</div>
                        </td>
                        <td className="px-2 py-2">{p.display_price != null ? <FreshnessPill freshness={p.freshness} days={p.days_since_display_price} /> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
        ) : (
          freeLoading ? <p className="py-12 text-center text-sm text-slate-400">Loading…</p>
            : freeFiltered.length === 0 ? <p className="py-12 text-center text-sm text-slate-400">Nothing here.</p>
            : (
              <>
                <p className="border-t px-4 py-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  Bought or quoted under a typed name rather than a stock item. They still count in the proforma's price guide{canOpenStock ? <> — <Link to="/stock/pending-setup" className="text-brand hover:underline">set the regular ones up as stock items</Link> to track them properly</> : ''}.
                </p>
                <div className="overflow-x-auto border-t dark:border-slate-700">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-900/40">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium">Name</th>
                        <th className="px-2 py-2 text-right font-medium">Latest price</th>
                        <th className="px-2 py-2 text-left font-medium">Change</th>
                        <th className="px-2 py-2 text-left font-medium">Range</th>
                        <th className="px-2 py-2 text-right font-medium">Prices</th>
                        <th className="px-2 py-2 text-left font-medium">From</th>
                        <th className="px-2 py-2 text-left font-medium">Age</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y dark:divide-slate-700">
                      {freeFiltered.map(r => (
                        <tr key={`${r.anchor_key}|${r.unit}`} onClick={() => openFree(r)} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40">
                          <td className="px-4 py-2">
                            <div className="max-w-[280px] truncate font-medium text-slate-700 dark:text-slate-200">{r.name}</div>
                            <div className="max-w-[280px] truncate text-[11px] text-slate-400">
                              {[r.is_sub_category_survey ? 'category survey' : r.sub_category_name, r.brand, r.specification].filter(Boolean).join(' · ') || 'typed name'}
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-right">
                            <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(r.latest_price, r.currency || 'ETB')}</span>
                            <span className="block text-[10px] text-slate-400">per {r.unit}</span>
                          </td>
                          <td className="px-2 py-2"><ChangeBadge pct={r.change_vs_previous_pct} /></td>
                          <td className="px-2 py-2"><PriceRange min={r.min_price} max={r.max_price} latest={r.latest_price} /></td>
                          <td className="px-2 py-2 text-right text-xs tabular-nums text-slate-600 dark:text-slate-300">{r.prices}</td>
                          <td className="px-2 py-2">
                            <div className="max-w-[180px] truncate text-xs text-slate-600 dark:text-slate-300">{r.vendor_name ?? '—'}</div>
                            <div className="text-[10px] text-slate-400">{sourceLabel(r.source)}</div>
                          </td>
                          <td className="px-2 py-2"><FreshnessPill freshness={r.freshness} days={r.days_old} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )
        )}
      </div>

      {target && (
        <PriceDetailDrawer target={target} onClose={() => setTarget(null)} canOpenStock={canOpenStock}
          actions={target.kind === 'stock' ? (
            <>
              {isProcurement && (
                <button onClick={() => setLogFor({ id: target.stockItemId, item_name: target.name, unit: target.unit })}
                  className="flex-1 rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand/90">Log a verified price</button>
              )}
              <button onClick={() => setReqFor({ id: target.stockItemId, item_name: target.name })}
                disabled={openItemIds.has(target.stockItemId)}
                className="flex-1 rounded-md border px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
                {openItemIds.has(target.stockItemId) ? 'Check already requested' : 'Ask for a price check'}
              </button>
            </>
          ) : undefined}
          footer={selectedStock && selectedStock.display_price == null ? (
            <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">
              This item has never been on an approved purchase order or quoted. Ask procurement for a price check before you quote with it.
            </p>
          ) : undefined} />
      )}

      {logFor && <LogVerifiedPriceModal stockItem={logFor === 'any' ? undefined : logFor} onClose={() => setLogFor(null)} />}
      {reqFor && <RequestPriceCheckModal stockItem={reqFor === 'any' ? undefined : reqFor} onClose={() => setReqFor(null)} />}
    </div>
  )
}

/** Change since the previous price; the 90-day change when that's all there is. */
function moveOf(p: LatestPriceRow): number | null {
  const v = p.change_vs_previous_pct ?? p.price_trend_90d_pct
  return v == null ? null : Number(v)
}

function StatButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className="rounded-xl text-left transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">{children}</button>
}

function MoversCard({ title, icon, rows, onOpen }: { title: string; icon: React.ReactNode; rows: LatestPriceRow[]; onOpen: (r: LatestPriceRow) => void }) {
  return (
    <div className="rounded-xl border bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">{icon}{title}</h3>
      {rows.length === 0 ? <p className="py-2 text-xs text-slate-400">Nothing yet.</p> : (
        <ul className="divide-y dark:divide-slate-700">
          {rows.map(r => (
            <li key={r.stock_item_id}>
              <button onClick={() => onOpen(r)} className="flex w-full items-center justify-between gap-3 py-1.5 text-left text-sm hover:text-brand">
                <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">{r.item_name}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-xs tabular-nums text-slate-500">{formatCurrency(r.previous_price)} → {formatCurrency(r.display_price)}</span>
                  <ChangeBadge pct={moveOf(r)} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Chip({ label, active, onClick, tone }: { label: string; active: boolean; onClick: () => void; tone?: Freshness }) {
  const activeCls = tone ? FRESHNESS_CLASS[tone] : 'bg-brand text-white border-brand'
  return (
    <button onClick={onClick} aria-pressed={active} className={`rounded-full border px-2.5 py-1 text-xs capitalize transition-colors ${
      active ? activeCls : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300'
    }`}>{label}</button>
  )
}

function toggleSet<T>(s: Set<T>, v: T): Set<T> {
  const out = new Set(s); if (out.has(v)) out.delete(v); else out.add(v); return out
}
