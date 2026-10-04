import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { DateGroupHeader, groupByDay } from '@/components/shared/DateGroupHeader'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { Pill, Stat } from '@/components/record/Record'
import { PO_STATUS, priceOverEstimate } from '@/lib/purchasing'
import type { SourcingBundle, SourcingBundleStatus } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { Plus, Pencil, Trash2, Truck, Search, ChevronRight, TrendingUp, CalendarClock } from 'lucide-react'
import { canSeePoVatGoal, usePoVatGoal, usePoVatToggle } from '@/lib/poVatGoal'
import { PoVatChip, PoVatSummary, PoVatToggle } from '@/components/purchasing/PoVatGoal'
import { useTaxImpact } from '@/lib/taxImpact'
import { TaxTag } from '@/components/tax/TaxTag'

type BundleRow = SourcingBundle & { vendors: { vendor_name: string } | null }

type ItemRow = {
  bundle_id: string
  unit_price_actual: number | null
  order_items: { unit_price_est: number | null; order_id: string; orders: { request_code: string | null } | null } | null
}

type Enriched = BundleRow & {
  _vendor: string
  _lines: number
  _requests: string[]
  _overEstimate: number
}

const FILTERS: { label: string; value: SourcingBundleStatus | 'all' | 'open' }[] = [
  { label: 'Open',             value: 'open' },
  { label: 'Drafting',         value: 'drafting' },
  { label: 'Awaiting finance', value: 'submitted' },
  { label: 'Approved',         value: 'approved' },
  { label: 'Ordered',          value: 'ordered' },
  { label: 'Received',         value: 'fulfilled' },
  { label: 'Cancelled',        value: 'cancelled' },
  { label: 'All',              value: 'all' },
]
const OPEN = new Set<SourcingBundleStatus>(['drafting', 'submitted', 'approved', 'ordered'])

function DueDate({ date, status }: { date: string | null; status: SourcingBundleStatus }) {
  if (!date) return null
  if (!OPEN.has(status)) return <span>Due {formatDate(date)}</span>
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.round((new Date(date).getTime() - today.getTime()) / 86400000)
  const cls = diff < 0 ? 'font-semibold text-red-600 dark:text-red-400' : diff <= 2 ? 'font-semibold text-amber-600 dark:text-amber-400' : ''
  const label = diff < 0 ? `${Math.abs(diff)}d late` : diff === 0 ? 'Due today' : diff === 1 ? 'Due tomorrow' : `Due ${formatDate(date)}`
  return <span className={`inline-flex items-center gap-1 ${cls}`}><CalendarClock className="h-3 w-3" />{label}</span>
}

// Purchase orders ("sourcing bundles" in the database): one vendor, one
// order, gathered from the lines of one or more purchase requests.
export default function PurchaseOrdersPage() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { role } = useAuth()
  // Same rule as the PO page: admin or an executive, and only while drafting.
  const canDelete = (b: BundleRow) => (role === 'admin' || role === 'executive') && b.status === 'drafting'

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<SourcingBundleStatus | 'all' | 'open'>('open')
  const [vendor, setVendor] = useState<string | null>(null)

  // Admin toggle: what each PO could do for the month's saved VAT goal.
  const vatAllowed = canSeePoVatGoal(role)
  const [vatOn, setVatOn] = usePoVatToggle()
  const [vatPeriod, setVatPeriod] = useState<{ y: number; m: number } | null>(null)
  const showVat = vatAllowed && vatOn
  const { data: vatGoal, isFetching: vatLoading } = usePoVatGoal(showVat, vatPeriod)
  const vatById = useMemo(() => new Map((vatGoal?.pos ?? []).map(p => [p.id, p])), [vatGoal])
  // The PO wears the same T-tag as the expense raised from it (migration 423).
  const { data: impact, byPo: impactByPo } = useTaxImpact()

  const { data: bundles = [], isLoading } = useQuery({
    queryKey: ['sourcing-bundles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sourcing_bundles')
        .select('*, vendors(vendor_name)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as BundleRow[]
    },
  })

  // Each line with the request it came from and that request's estimate, for
  // the "from PR-…" line and the price check.
  const { data: itemRows = [] } = useQuery({
    queryKey: ['bundle-item-summary'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sourcing_bundle_items')
        .select('bundle_id, unit_price_actual, order_items(unit_price_est, order_id, orders(request_code))')
      if (error) throw error
      return (data ?? []) as unknown as ItemRow[]
    },
  })

  const enriched: Enriched[] = useMemo(() => {
    const map: Record<string, { lines: number; requests: Set<string>; over: number }> = {}
    for (const it of itemRows) {
      const m = (map[it.bundle_id] ??= { lines: 0, requests: new Set(), over: 0 })
      m.lines++
      const code = it.order_items?.orders?.request_code
      if (code) m.requests.add(code)
      if (priceOverEstimate(it.order_items?.unit_price_est, it.unit_price_actual) != null) m.over++
    }
    return bundles.map(b => ({
      ...b,
      _vendor: b.vendors?.vendor_name ?? b.vendor_name ?? '',
      _lines: map[b.id]?.lines ?? 0,
      _requests: [...(map[b.id]?.requests ?? [])].sort(),
      _overEstimate: map[b.id]?.over ?? 0,
    }))
  }, [bundles, itemRows])

  const vendorOptions = useMemo(() => {
    const names = [...new Set(enriched.map(b => b._vendor).filter(Boolean))].sort((a, b) => a.localeCompare(b))
    return names.map(n => ({ id: n, label: n, sub: `${enriched.filter(b => b._vendor === n).length} POs` }))
  }, [enriched])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: enriched.length, open: 0 }
    for (const b of enriched) {
      c[b.status] = (c[b.status] ?? 0) + 1
      if (OPEN.has(b.status)) c.open++
    }
    return c
  }, [enriched])

  const filtered = useMemo(() => {
    let list = enriched
    if (filter === 'open') list = list.filter(b => OPEN.has(b.status))
    else if (filter !== 'all') list = list.filter(b => b.status === filter)
    if (vendor) list = list.filter(b => b._vendor === vendor)
    const q = search.trim().toLowerCase()
    if (q) list = list.filter(b =>
      b.bundle_code.toLowerCase().includes(q) ||
      b._vendor.toLowerCase().includes(q) ||
      (b.notes ?? '').toLowerCase().includes(q) ||
      b._requests.some(r => r.toLowerCase().includes(q)))
    return list
  }, [enriched, filter, vendor, search])

  const stats = useMemo(() => {
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    return {
      awaiting: enriched.filter(b => b.status === 'submitted').length,
      awaitingValue: enriched.filter(b => b.status === 'submitted').reduce((s, b) => s + Number(b.total_value ?? 0), 0),
      onOrder: enriched.filter(b => b.status === 'approved' || b.status === 'ordered').length,
      late: enriched.filter(b => OPEN.has(b.status) && b.expected_delivery_date && new Date(b.expected_delivery_date) < today).length,
      month: enriched.filter(b => b.status !== 'cancelled' && new Date(b.created_at) >= monthStart).reduce((s, b) => s + Number(b.total_value ?? 0), 0),
      over: enriched.filter(b => OPEN.has(b.status) && b._overEstimate > 0).length,
    }
  }, [enriched])

  // Grouped by the day each PO was raised, with the day's value in the band.
  const groups = useMemo(() => groupByDay(filtered, b => b.created_at), [filtered])

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    if (!window.confirm('Delete this purchase order? This cannot be undone.')) return
    const { error } = await supabase.from('sourcing_bundles').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['sourcing-bundles'] })
    toast('Purchase order deleted', 'success')
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Purchase orders</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Lines from purchase requests, grouped by vendor into orders</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {vatAllowed && <PoVatToggle on={vatOn} onChange={setVatOn} />}
          <Link to="/sourcing/new"
            className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
            <Plus className="h-4 w-4" /> New purchase order
          </Link>
        </div>
      </div>

      {showVat && <PoVatSummary data={vatGoal} loading={vatLoading} onPick={setVatPeriod} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Awaiting finance" value={stats.awaiting} sub={stats.awaitingValue > 0 ? formatCurrency(stats.awaitingValue) : 'Nothing waiting'} tone={stats.awaiting > 0 ? 'amber' : undefined} />
        <Stat label="On order" value={stats.onOrder} sub={stats.late > 0 ? `${stats.late} past the delivery date` : 'None late'} tone={stats.late > 0 ? 'red' : undefined} />
        <Stat label="Over the estimate" value={stats.over} sub="Open POs with a line 15%+ above the request" tone={stats.over > 0 ? 'amber' : undefined} />
        <Stat label="Ordered this month" value={formatCurrency(stats.month)} sub="Not counting cancelled" />
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="PO, vendor or request code…" value={search} onChange={e => setSearch(e.target.value)}
              className="w-full rounded-lg border bg-white py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800" />
          </div>
          <SearchableSelect value={vendor} onChange={setVendor} options={vendorOptions} placeholder="Any vendor" className="sm:w-56" />
        </div>
      </div>
      <div className="-mt-2 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
        {FILTERS.map(f => (
          <button key={f.value} onClick={() => setFilter(f.value)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === f.value
                ? 'bg-brand text-white'
                : 'border bg-white text-slate-600 hover:border-brand dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
            }`}>
            {f.label}
            {(counts[f.value] ?? 0) > 0 && <span className={`rounded-full px-1.5 text-[10px] ${filter === f.value ? 'bg-white/20' : 'bg-slate-100 dark:bg-slate-700'}`}>{counts[f.value]}</span>}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed bg-white py-16 text-center dark:border-slate-700 dark:bg-slate-800">
          <Truck className="mx-auto mb-3 h-8 w-8 text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-500">{enriched.length ? 'No purchase orders match.' : 'No purchase orders yet.'}</p>
          {!enriched.length && (
            <Link to="/sourcing/new" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
              <Plus className="h-3.5 w-3.5" /> Create the first one
            </Link>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border shadow-sm dark:border-slate-700">
          {groups.map(group => (
            <div key={group.key}>
              <DateGroupHeader
                dateKey={group.key}
                count={group.rows.length}
                total={group.rows.reduce((sum, b) => sum + Number(b.total_value ?? 0), 0)}
                noun="PO"
              />
              <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {group.rows.map(b => {
                  const st = PO_STATUS[b.status]
                  const discount = Number(b.discount_etb ?? 0)
                  return (
                    <div key={b.id} onClick={() => navigate(`/sourcing/${b.id}`)}
                      className="group flex cursor-pointer items-center gap-3 bg-white px-4 py-3 transition-colors hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700/40">
                      <div className="hidden shrink-0 rounded-lg bg-slate-100 p-2 text-slate-400 sm:block dark:bg-slate-700">
                        <Truck className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <TaxTag item={impactByPo.get(b.id)} periodLabel={impact?.period.label} />
                          <span className="whitespace-nowrap font-mono text-xs font-semibold text-brand">{b.bundle_code}</span>
                          <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{b._vendor || 'No vendor yet'}</span>
                          <Pill tone={st.tone}>{st.label}</Pill>
                          {b._overEstimate > 0 && OPEN.has(b.status) && (
                            <Pill tone="amber" icon={TrendingUp} title="Priced 15% or more above the request's estimate">
                              {b._overEstimate} over estimate
                            </Pill>
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-400">
                          <span>{b._lines} line{b._lines === 1 ? '' : 's'}</span>
                          {b._requests.length > 0 && (
                            <span className="truncate">from {b._requests.slice(0, 3).join(', ')}{b._requests.length > 3 ? ` +${b._requests.length - 3}` : ''}</span>
                          )}
                          <DueDate date={b.expected_delivery_date} status={b.status} />
                        </div>
                        {showVat && vatGoal && vatById.has(b.id) && (
                          <div className="mt-1"><PoVatChip e={vatById.get(b.id)} period={vatGoal.period} /></div>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="whitespace-nowrap text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                          {Number(b.total_value) > 0 ? formatCurrency(Number(b.total_value)) : '—'}
                        </p>
                        {discount > 0 && <p className="whitespace-nowrap text-[11px] text-emerald-600 dark:text-emerald-400">after {formatCurrency(discount)} off</p>}
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5" onClick={e => e.stopPropagation()}>
                        {b.status === 'drafting' && (
                          <Link to={`/sourcing/${b.id}/edit`} title="Edit"
                            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700">
                            <Pencil className="h-3.5 w-3.5" />
                          </Link>
                        )}
                        {canDelete(b) && (
                          <button onClick={e => handleDelete(e, b.id)} title="Delete"
                            className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <ChevronRight className="hidden h-4 w-4 text-slate-300 group-hover:text-slate-400 sm:block dark:text-slate-600" />
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
