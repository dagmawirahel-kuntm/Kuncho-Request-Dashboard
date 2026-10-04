import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useToast } from '@/contexts/ToastContext'
import { useTabParam } from '@/lib/useTabParam'
import { Stat } from '@/components/record/Record'
import { ActionDialog } from '@/components/shared/ActionDialog'
import { SECTION, sectionOf, type MaterialSection } from '@/lib/vendorMaterials'
import {
  useStockCatalog, useOpenCounts, usePendingDispatchCount, daysSince, neverIssued, isLow, type CatalogRow,
} from '@/lib/stockCatalog'
import {
  Plus, Pencil, Trash2, Search, Warehouse, Truck, Library, Send, ClipboardList, ClipboardCheck, AlertTriangle,
  ArrowRight, X, PackageOpen, CheckSquare, Square,
} from 'lucide-react'

// The stock page, split the way the stock actually moves: what the
// warehouse holds (and whether that figure can be trusted — has anything
// been recorded leaving, has it been counted), what is bought straight for
// project sites and never kept, and the whole catalogue (migration 417).

const VIEWS = ['warehouse', 'sites', 'all'] as const
type View = typeof VIEWS[number]
type Sort = 'value' | 'name' | 'moved'

const etb = (n: number | null | undefined) => n == null ? '—' : formatCurrency(Math.round(Number(n))).replace(/\.00$/, '')
const qty = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')

const ITEM_TYPE: Record<CatalogRow['item_type'], string> = { raw_material: 'Raw material', tool: 'Tool', consumable: 'Consumable' }
const FRESH: Record<NonNullable<CatalogRow['price_freshness']>, string> = {
  fresh: 'text-emerald-700 dark:text-emerald-400', aging: 'text-amber-700 dark:text-amber-400', outdated: 'text-red-600 dark:text-red-400',
}

export default function StockItemsPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { toast } = useToast()
  const [view, setView] = useTabParam<View>(VIEWS, 'warehouse')
  const { data: rows = [], isLoading } = useStockCatalog()
  const { data: openCounts = [] } = useOpenCounts()
  const { data: toDispatch = 0 } = usePendingDispatchCount()
  const [search, setSearch] = useState('')
  const [section, setSection] = useState<MaterialSection | null>(null)
  const [sort, setSort] = useState<Sort>('value')
  const [onlyPending, setOnlyPending] = useState(false)
  const [location, setLocation] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [countDialog, setCountDialog] = useState<{ ids: string[]; title: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const held = useMemo(() => rows.filter(r => r.qty_on_hand > 0), [rows])
  const forSites = useMemo(() => rows.filter(r => r.site_qty > 0), [rows])
  const base = view === 'warehouse' ? held : view === 'sites' ? forSites : rows
  const locations = useMemo(() => [...new Set(rows.map(r => r.warehouse_zone).filter(Boolean))] as string[], [rows])

  const sectionCounts = useMemo(() => {
    const m = new Map<MaterialSection, number>()
    for (const r of base) m.set(sectionOf(r.section), (m.get(sectionOf(r.section)) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [base])

  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    let l = base
    if (section) l = l.filter(r => sectionOf(r.section) === section)
    if (location) l = l.filter(r => r.warehouse_zone === location)
    if (view === 'all' && onlyPending) l = l.filter(r => r.catalog_status === 'pending_setup')
    if (q) l = l.filter(r => r.item_name.toLowerCase().includes(q) || (r.amharic_name ?? '').includes(search.trim()) || (r.item_code ?? '').toLowerCase().includes(q))
    const worth = (r: CatalogRow) => view === 'sites' ? r.site_spend : view === 'warehouse' ? r.value_on_hand : r.value_on_hand + r.site_spend
    const moved = (r: CatalogRow) => (view === 'sites' ? r.last_site : r.last_moved) ?? ''
    return [...l].sort((a, b) =>
      sort === 'name' ? a.item_name.localeCompare(b.item_name)
        : sort === 'moved' ? moved(b).localeCompare(moved(a))
          : worth(b) - worth(a))
  }, [base, search, section, location, onlyPending, sort, view])

  // Warehouse figures
  const whValue = held.reduce((s, r) => s + r.value_on_hand, 0)
  const unissued = held.filter(neverIssued)
  const unissuedValue = unissued.reduce((s, r) => s + r.value_on_hand, 0)
  const oldestIn = unissued.reduce<string | null>((m, r) => (r.first_in && (!m || r.first_in < m) ? r.first_in : m), null)
  const uncounted = held.filter(r => !r.is_tool && !r.last_counted)
  const idle = held.filter(r => (daysSince(r.last_moved) ?? 0) >= 30)
  const low = rows.filter(r => r.catalog_status === 'active' && isLow(r))
  const topToCount = held.filter(r => !r.is_tool).sort((a, b) => b.value_on_hand - a.value_on_hand).slice(0, 10)
  const topValue = topToCount.reduce((s, r) => s + r.value_on_hand, 0)
  const sitesSpend = forSites.reduce((s, r) => s + r.site_spend, 0)
  const sitesOnly = forSites.filter(r => r.qty_on_hand <= 0).length
  const lastSite = forSites.reduce<string | null>((m, r) => (r.last_site && (!m || r.last_site > m) ? r.last_site : m), null)
  const sitesStale = forSites.filter(r => r.price_freshness === 'aging' || r.price_freshness === 'outdated').length
  const pending = rows.filter(r => r.catalog_status === 'pending_setup').length

  const pickedRows = rows.filter(r => picked.has(r.id))
  const toggle = (id: string) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const issueLink = (ids: string[]) => `/stock/issue?items=${ids.join(',')}`

  function switchView(v: View) { setView(v); setSection(null); setPicked(new Set()) }

  async function startCount() {
    if (!countDialog) return
    setBusy(true)
    const { data, error } = await supabase.rpc('start_stock_count_items', { p_items: countDialog.ids, p_notes: countDialog.title })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['stock-open-counts'] })
    qc.invalidateQueries({ queryKey: ['stock-catalog'] })
    navigate(`/stock/counts/${data}`)
  }

  async function deactivate(r: CatalogRow) {
    if (!window.confirm(`Deactivate ${r.item_name}? Its history stays; it just stops being offered.`)) return
    const { error } = await supabase.from('stock_items').update({ active: false }).eq('id', r.id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['stock-catalog'] })
    qc.invalidateQueries({ queryKey: ['stock-items'] })
    toast('Stock item deactivated', 'success')
  }

  const tabs: { id: View; label: string; icon: typeof Warehouse; n: number }[] = [
    { id: 'warehouse', label: 'Warehouse', icon: Warehouse, n: held.length },
    { id: 'sites', label: 'Bought for sites', icon: Truck, n: forSites.length },
    { id: 'all', label: 'Whole catalogue', icon: Library, n: rows.length },
  ]

  return (
    <div className="space-y-4 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Stock</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">What the warehouse holds, and what is bought straight for sites</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/stock/issue" className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand/90"><Send className="h-4 w-4" /> Issue to a project</Link>
          <Link to="/stock/counts" className="flex items-center gap-1.5 rounded-md border bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"><ClipboardList className="h-4 w-4" /> Counts</Link>
          {pending > 0 && (
            <Link to="/stock/pending-setup" className="flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-300"><ClipboardCheck className="h-4 w-4" /> Set up {pending}</Link>
          )}
          <Link to="/stock/new" className="flex items-center gap-1.5 rounded-md border bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"><Plus className="h-4 w-4" /> Add item</Link>
        </div>
      </div>

      {openCounts.map(c => (
        <div key={c.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-700/60 dark:bg-amber-900/15">
          <ClipboardList className="h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" />
          <div className="min-w-0 flex-1 text-sm text-amber-900 dark:text-amber-200">
            <p className="font-semibold">Count {c.code} is open — {c.counted} of {c.lines} counted</p>
            <p className="text-xs text-amber-800/90 dark:text-amber-300/90">
              Started {formatDate(c.started_at)}{c.starter ? ` by ${c.starter}` : ''} ({daysSince(c.started_at)} days ago). Until it is posted, the warehouse figures are what the system expects, not what is on the shelf.
            </p>
          </div>
          <Link to={`/stock/counts/${c.id}`} className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700">
            {c.counted === 0 ? 'Start counting' : 'Continue counting'} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ))}

      <div className="flex gap-1 overflow-x-auto border-b dark:border-slate-700">
        {tabs.map(t => (
          <button key={t.id} onClick={() => switchView(t.id)} aria-current={view === t.id}
            className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium ${view === t.id ? 'border-brand text-slate-900 dark:text-white' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
            <t.icon className="h-4 w-4" /> {t.label}
            <span className="rounded-full bg-slate-100 px-1.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">{t.n}</span>
          </button>
        ))}
      </div>

      {view === 'warehouse' && (<>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Warehouse value" value={etb(whValue)} sub={`${held.length} items held`} />
          <Stat label="No issue recorded" value={unissued.length} tone={unissued.length ? 'amber' : undefined} sub={unissued.length ? `${etb(unissuedValue)} came in, nothing out` : 'every item has gone out at least once'} />
          <Stat label="Never counted" value={uncounted.length} tone={uncounted.length ? 'amber' : undefined} sub="of the items held" />
          {low.length > 0
            ? <Stat label="Low" value={low.length} tone="amber" sub="at or under reorder level" />
            : <Stat label="Not moved in 30 days" value={idle.length} sub={idle.length ? etb(idle.reduce((s, r) => s + r.value_on_hand, 0)) : 'everything moved lately'} />}
        </div>

        {unissued.length > 0 && (
          <section className="rounded-xl border border-amber-200 bg-white p-4 shadow-sm dark:border-amber-800/50 dark:bg-slate-800">
            <p className="flex items-start gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              {unissued.length === held.filter(r => !r.is_tool).length ? 'Nothing has been recorded leaving the warehouse' : `${unissued.length} held items have no issue on record`}
            </p>
            <p className="mt-1 pl-6 text-sm text-slate-600 dark:text-slate-300">
              {unissued.length} item{unissued.length === 1 ? '' : 's'} worth {etb(unissuedValue)} came in{oldestIn ? ` from ${formatDate(oldestIn)}` : ''} with nothing issued out since.
              If they have gone to sites or been used, issue them to the project so the warehouse figure is real. If they are still on the shelf, a count confirms it.
            </p>
            <div className="mt-3 flex flex-wrap gap-2 pl-6">
              <Link to={issueLink([...unissued].sort((a, b) => b.value_on_hand - a.value_on_hand).slice(0, 5).map(r => r.id))}
                className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90">
                <Send className="h-3.5 w-3.5" /> Issue the 5 worth most
              </Link>
              <span className="self-center text-xs text-slate-500">or tick items below and issue them together</span>
              {toDispatch > 0 && (
                <Link to="/stock/dispatch-queue" className="inline-flex items-center gap-1 self-center text-xs font-medium text-brand hover:underline">
                  {toDispatch} requested item{toDispatch === 1 ? ' is' : 's are'} waiting to go out <ArrowRight className="h-3 w-3" />
                </Link>
              )}
            </div>
          </section>
        )}

        {openCounts.length === 0 && topToCount.length > 0 && (
          <section className="flex flex-wrap items-center gap-3 rounded-xl border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <ClipboardCheck className="h-5 w-5 shrink-0 text-brand" />
            <p className="min-w-0 flex-1 text-sm text-slate-700 dark:text-slate-200">
              <b>Count the {topToCount.length} items worth the most</b> — {etb(topValue)}, {whValue ? Math.round((topValue / whValue) * 100) : 0}% of the warehouse value.
              <span className="block text-xs text-slate-500">A short count each month of the costly items keeps the figure honest. Tools are checked on the Tools page.</span>
            </p>
            <button onClick={() => setCountDialog({ ids: topToCount.map(r => r.id), title: `Top ${topToCount.length} by value` })}
              className="rounded-md border px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
              Start this count
            </button>
          </section>
        )}
      </>)}

      {view === 'sites' && (<>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Bought for sites" value={etb(sitesSpend)} sub={`${forSites.length} items`} />
          <Stat label="Never kept" value={sitesOnly} sub="only ever went to sites" />
          <Stat label="Last delivery" value={lastSite ? `${daysSince(lastSite)} days ago` : '—'} sub={lastSite ? formatDate(lastSite) : undefined} />
          <Stat label="Prices to refresh" value={sitesStale} tone={sitesStale ? 'amber' : undefined} sub="last price aging or outdated" />
        </div>
        <p className="text-xs text-slate-500">These go straight from the vendor to a project. They are not kept, so they are never low — what matters is what they cost and whether the price is current.</p>
      </>)}

      {view === 'all' && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Items" value={rows.length} />
          <Stat label="Held in the warehouse" value={held.length} />
          <Stat label="Bought for sites" value={forSites.length} />
          <Stat label="Not set up" value={pending} tone={pending ? 'amber' : undefined} sub="not offered from stock" />
        </div>
      )}

      {/* Find and narrow */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[12rem] flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, Amharic name or code…"
              className="w-full rounded-lg border bg-white py-2 pl-9 pr-8 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800" />
            {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400" aria-label="Clear"><X className="h-3.5 w-3.5" /></button>}
          </label>
          <select value={sort} onChange={e => setSort(e.target.value as Sort)} aria-label="Sort"
            className="rounded-md border bg-white px-2 py-2 text-xs text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <option value="value">{view === 'sites' ? 'Most spent first' : 'Worth most first'}</option>
            <option value="moved">{view === 'sites' ? 'Latest delivery first' : 'Moved most recently first'}</option>
            <option value="name">By name</option>
          </select>
          {locations.length > 0 && view !== 'sites' && (
            <select value={location} onChange={e => setLocation(e.target.value)} aria-label="Location"
              className="rounded-md border bg-white px-2 py-2 text-xs text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <option value="">Every location</option>
              {locations.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          )}
          {view === 'all' && pending > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={onlyPending} onChange={e => setOnlyPending(e.target.checked)} /> Only not set up
            </label>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setSection(null)} className={`rounded-full border px-3 py-1 text-xs font-medium ${section == null ? 'border-slate-700 bg-slate-700 text-white' : 'bg-white text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>
            Every section
          </button>
          {sectionCounts.map(([s, n]) => {
            const Icon = SECTION[s].icon
            return (
              <button key={s} onClick={() => setSection(section === s ? null : s)}
                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium ${section === s ? 'border-slate-700 bg-slate-700 text-white' : 'bg-white text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>
                <Icon className="h-3.5 w-3.5" /> {SECTION[s].short} <span className="opacity-60">{n}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* The list */}
      {isLoading ? <p className="py-16 text-center text-sm text-slate-400">Loading…</p>
        : list.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed bg-white py-14 text-center dark:border-slate-700 dark:bg-slate-800">
            <PackageOpen className="mx-auto mb-2 h-8 w-8 text-slate-300" />
            <p className="text-sm text-slate-500">{search || section ? 'Nothing matches.' : view === 'warehouse' ? 'The warehouse holds nothing on record.' : 'Nothing here yet.'}</p>
          </div>
        ) : (
          <ul className="divide-y overflow-hidden rounded-xl border bg-white shadow-sm dark:divide-slate-700/60 dark:border-slate-700 dark:bg-slate-800">
            {list.map(r => view === 'warehouse'
              ? <WarehouseRow key={r.id} r={r} picked={picked.has(r.id)} onPick={() => toggle(r.id)} />
              : view === 'sites'
                ? <SiteRow key={r.id} r={r} />
                : <CatalogueRow key={r.id} r={r} onDeactivate={() => deactivate(r)} />)}
          </ul>
        )}

      {picked.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-white/95 px-4 py-3 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-800/95 sm:left-auto sm:right-6 sm:bottom-6 sm:rounded-xl sm:border">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-700 dark:text-slate-200"><b>{picked.size}</b> selected · {etb(pickedRows.reduce((s, r) => s + r.value_on_hand, 0))}</span>
            <Link to={issueLink(pickedRows.filter(r => !r.is_tool).map(r => r.id))} className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white"><Send className="h-3.5 w-3.5" /> Issue to a project</Link>
            <button onClick={() => setCountDialog({ ids: [...picked], title: `${picked.size} chosen items` })}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200"><ClipboardCheck className="h-3.5 w-3.5" /> Count these</button>
            <button onClick={() => setPicked(new Set())} className="text-xs text-slate-400 hover:text-slate-600">Clear</button>
          </div>
        </div>
      )}

      {countDialog && (
        <ActionDialog title="Start a count" confirmLabel="Start counting" busy={busy} onClose={() => setCountDialog(null)} onConfirm={startCount}
          description={<>Counts {countDialog.ids.length} item{countDialog.ids.length === 1 ? '' : 's'}. What the system holds now is frozen, so movements during the count don't muddle it; differences are booked when you post it.{openCounts.length > 0 ? ` Count ${openCounts[0].code} is still open — finishing it first keeps things simple.` : ''}</>} />
      )}
    </div>
  )
}

function SectionTag({ s }: { s: string | null }) {
  const meta = SECTION[sectionOf(s)]
  const Icon = meta.icon
  return <span className="inline-flex items-center gap-1 text-[11px] text-slate-400"><Icon className="h-3 w-3" />{meta.short}</span>
}

function WarehouseRow({ r, picked, onPick }: { r: CatalogRow; picked: boolean; onPick: () => void }) {
  const since = daysSince(r.first_in)
  const stale = neverIssued(r) && (since ?? 0) >= 14
  return (
    <li className={`flex items-start gap-3 px-3 py-3 sm:px-4 ${picked ? 'bg-brand/5' : ''}`}>
      <button onClick={onPick} aria-pressed={picked} aria-label={`Select ${r.item_name}`} className="mt-0.5 text-slate-400 hover:text-brand">
        {picked ? <CheckSquare className="h-5 w-5 text-brand" /> : <Square className="h-5 w-5" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <Link to={`/stock/${r.id}`} className="font-semibold text-slate-800 hover:text-brand dark:text-slate-100">{r.item_name}</Link>
          {r.item_code && <span className="font-mono text-[10px] text-slate-400">{r.item_code}</span>}
          <SectionTag s={r.section} />
          {isLow(r) && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">Low</span>}
          {r.warehouse_zone && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-700">{r.warehouse_zone}</span>}
        </div>
        <p className="mt-0.5 text-xs text-slate-500">
          <b className="font-semibold text-slate-700 dark:text-slate-200">{qty(r.qty_on_hand)} {r.unit}</b> held
          {r.avg_unit_cost ? <> · avg {etb(r.avg_unit_cost)}/{r.unit}</> : <span className="text-amber-600"> · no cost on record</span>}
        </p>
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
          {r.is_tool
            ? <span className="text-slate-500">Tool — lent and returned on the Tools page</span>
            : r.issues === 0
            ? <span className={stale ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-slate-500'}>In {r.first_in ? formatDate(r.first_in) : '—'} · nothing issued{since != null ? ` in ${since} days` : ''}</span>
            : <span className="text-slate-500">Last out {formatDate(r.last_out)}{r.last_in && r.last_out && r.last_in > r.last_out ? ` · in again ${formatDate(r.last_in)}` : ''}</span>}
          {r.open_count_code
            ? <span className="text-amber-700 dark:text-amber-400">In count {r.open_count_code}</span>
            : r.last_counted ? <span className="text-slate-500">Counted {formatDate(r.last_counted)}</span>
              : <span className="text-slate-400">Never counted</span>}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <span className="text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{etb(r.value_on_hand)}</span>
        {r.is_tool
          ? <Link to="/stock/tools" className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-brand hover:text-brand dark:border-slate-600 dark:text-slate-300">Tools</Link>
          : <Link to={`/stock/issue?items=${r.id}`} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-brand hover:text-brand dark:border-slate-600 dark:text-slate-300">
              <Send className="h-3 w-3" /> Issue
            </Link>}
      </div>
    </li>
  )
}

function SiteRow({ r }: { r: CatalogRow }) {
  return (
    <li className="flex items-start gap-3 px-3 py-3 sm:px-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <Link to={`/stock/${r.id}`} className="font-semibold text-slate-800 hover:text-brand dark:text-slate-100">{r.item_name}</Link>
          {r.item_code && <span className="font-mono text-[10px] text-slate-400">{r.item_code}</span>}
          <SectionTag s={r.section} />
          {r.qty_on_hand > 0 && <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">{qty(r.qty_on_hand)} also in the warehouse</span>}
        </div>
        <p className="mt-0.5 text-xs text-slate-500">
          {qty(r.site_qty)} {r.unit} to {r.site_projects || 'a'} project{r.site_projects === 1 ? '' : 's'}{r.last_site ? ` · last ${formatDate(r.last_site)}` : ''}
        </p>
        {r.last_price != null && (
          <p className="mt-0.5 text-[11px] text-slate-500">
            Last price {etb(r.last_price)}/{r.unit}
            {r.price_freshness && <span className={`ml-1 ${FRESH[r.price_freshness]}`}>· {r.price_freshness}{r.price_at ? `, ${formatDate(r.price_at)}` : ''}</span>}
          </p>
        )}
      </div>
      <div className="shrink-0 text-right">
        <span className="block text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{etb(r.site_spend)}</span>
        <span className="text-[11px] text-slate-400">spent</span>
      </div>
    </li>
  )
}

function CatalogueRow({ r, onDeactivate }: { r: CatalogRow; onDeactivate: () => void }) {
  return (
    <li className="group flex items-start gap-3 px-3 py-3 sm:px-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <Link to={`/stock/${r.id}`} className="font-semibold text-slate-800 hover:text-brand dark:text-slate-100">{r.item_name}</Link>
          {r.amharic_name && <span className="text-xs text-slate-400">{r.amharic_name}</span>}
          {r.item_code && <span className="font-mono text-[10px] text-slate-400">{r.item_code}</span>}
          <SectionTag s={r.section} />
          <span className="text-[11px] text-slate-400">· {ITEM_TYPE[r.item_type]}</span>
          {r.catalog_status === 'pending_setup' && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">Not set up</span>}
        </div>
        <p className="mt-0.5 text-xs text-slate-500">
          {r.qty_on_hand > 0 ? `${qty(r.qty_on_hand)} ${r.unit} in the warehouse` : 'None in the warehouse'}
          {r.site_qty > 0 && ` · ${qty(r.site_qty)} ${r.unit} bought for sites`}
          {r.last_price != null && <> · last price {etb(r.last_price)}{r.price_freshness && <span className={FRESH[r.price_freshness]}> ({r.price_freshness})</span>}</>}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <Link to={`/stock/${r.id}/edit`} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700" aria-label={`Edit ${r.item_name}`}><Pencil className="h-3.5 w-3.5" /></Link>
        <button onClick={onDeactivate} title="Deactivate" aria-label={`Deactivate ${r.item_name}`} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
    </li>
  )
}
