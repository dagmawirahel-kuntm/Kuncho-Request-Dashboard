import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchAllRows } from '@/lib/fetchAllRows'
import { formatDate } from '@/lib/utils'
import type { Order } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import {
  Plus, Pencil, Trash2, Package, Zap, AlertCircle, CheckCircle2, Search, ChevronRight, AlertTriangle, XCircle, Clock, X, CircleDashed, Loader,
} from 'lucide-react'

type OrderRow = Order & {
  projects: { project_name: string } | null
  staff: { employee_name: string } | null
}
type OrderWithMeta = OrderRow & {
  _total: number
  _fulfilled: number
  _partial: number
  _blocked: number
  _names: string[]
  _state: FulfillmentState
  _overdueDays: number | null
}

// A line item's own status is the only thing that still reflects real
// progress — approval_status stopped moving once the manager→finance
// ladder was retired (migrations 149/163).
const FULFILLED_ITEM_STATUSES = new Set(['sourced', 'stock_fulfilled'])
const PARTIAL_ITEM_STATUSES = new Set(['partially_sourced', 'stock_pending_dispatch'])

type FulfillmentState = 'rejected' | 'needs_attention' | 'fulfilled' | 'sourcing' | 'not_started'
type Filter = 'open' | FulfillmentState | 'all'

const STATE: Record<FulfillmentState, { label: string; icon: typeof Package; cls: string }> = {
  needs_attention: { label: 'Needs attention', icon: AlertTriangle, cls: 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400' },
  not_started: { label: 'Not started', icon: CircleDashed, cls: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300' },
  sourcing: { label: 'Sourcing', icon: Loader, cls: 'bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-300' },
  fulfilled: { label: 'Fulfilled', icon: CheckCircle2, cls: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' },
  rejected: { label: 'Rejected', icon: XCircle, cls: 'bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500' },
}

const FILTERS: { label: string; value: Filter }[] = [
  { label: 'Open', value: 'open' },
  { label: 'Needs attention', value: 'needs_attention' },
  { label: 'Not started', value: 'not_started' },
  { label: 'Sourcing', value: 'sourcing' },
  { label: 'Fulfilled', value: 'fulfilled' },
  { label: 'Rejected', value: 'rejected' },
  { label: 'All', value: 'all' },
]

const isOpen = (s: FulfillmentState) => s === 'needs_attention' || s === 'not_started' || s === 'sourcing'
const PAGE = 40

function classify(o: { approval_status: string; _blocked: number; _total: number; _fulfilled: number; _partial: number }): FulfillmentState {
  if (o.approval_status === 'rejected') return 'rejected'
  if (o._blocked > 0) return 'needs_attention'
  if (o._total > 0 && o._fulfilled === o._total) return 'fulfilled'
  if (o._fulfilled > 0 || o._partial > 0) return 'sourcing'
  return 'not_started'
}

function daysFromToday(date: string | null): number | null {
  if (!date) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return Math.round((new Date(date).getTime() - today.getTime()) / 86400000)
}

function ago(iso: string): string {
  const d = -(daysFromToday(iso.slice(0, 10)) ?? 0)
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 30 ? `${d} days ago` : formatDate(iso)
}

export default function PurchaseRequestsPage() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { role, user } = useAuth()
  const canCreate = role !== 'procurement_officer'
  // Matches orders' RLS delete grants: admin, or staff on their own request.
  const canDelete = (o: OrderRow) => role === 'admin' || ((role === 'staff' || role === 'technician') && o.requested_by_user_id === user?.id)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('open')
  const [mine, setMine] = useState(false)
  const [shown, setShown] = useState(PAGE)

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('*, projects(project_name), staff(employee_name)')
        .eq('is_archived', false)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as OrderRow[]
    },
  })

  const { data: itemRows = [] } = useQuery({
    queryKey: ['order-item-counts'],
    queryFn: async () => {
      const data = await fetchAllRows((from, to) => supabase.from('order_items').select('order_id, status, item_name')
        .order('id').range(from, to))
      return data as { order_id: string; status: string; item_name: string | null }[]
    },
  })

  // Most requests are raised from a login with no staff record attached, so
  // the requester's name comes from their user profile.
  const requesterIds = useMemo(() => [...new Set(orders.filter(o => !o.staff && o.requested_by_user_id).map(o => o.requested_by_user_id!))], [orders])
  const { data: requesters = [] } = useQuery({
    queryKey: ['order-requesters', requesterIds.length],
    enabled: requesterIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from('user_profiles').select('id, full_name').in('id', requesterIds)
      return (data ?? []) as { id: string; full_name: string | null }[]
    },
  })
  const requesterName = (o: OrderRow) => o.staff?.employee_name ?? requesters.find(r => r.id === o.requested_by_user_id)?.full_name ?? null

  const data: OrderWithMeta[] = useMemo(() => {
    const m: Record<string, { total: number; fulfilled: number; partial: number; blocked: number; names: string[] }> = {}
    for (const row of itemRows) {
      const b = (m[row.order_id] ??= { total: 0, fulfilled: 0, partial: 0, blocked: 0, names: [] })
      if (row.status === 'cancelled') continue
      b.total++
      if (row.item_name) b.names.push(row.item_name)
      if (FULFILLED_ITEM_STATUSES.has(row.status)) b.fulfilled++
      else if (PARTIAL_ITEM_STATUSES.has(row.status)) b.partial++
      else if (row.status === 'unfulfilled') b.blocked++
    }
    return orders.map(o => {
      const c = m[o.id] ?? { total: 0, fulfilled: 0, partial: 0, blocked: 0, names: [] }
      const base = { ...o, _total: c.total, _fulfilled: c.fulfilled, _partial: c.partial, _blocked: c.blocked, _names: c.names }
      const state = classify(base)
      const due = daysFromToday(o.required_by_date)
      return { ...base, _state: state, _overdueDays: isOpen(state) && due != null && due < 0 ? -due : null }
    })
  }, [orders, itemRows])

  const counts = useMemo(() => {
    const open = data.filter(o => isOpen(o._state))
    return {
      open: open.length,
      overdue: open.filter(o => o._overdueDays != null).length,
      notStarted: open.filter(o => o._state === 'not_started').length,
      attention: open.filter(o => o._state === 'needs_attention').length,
      urgent: open.filter(o => o.priority === 'urgent' || o.priority === 'critical').length,
      mine: data.filter(o => o.requested_by_user_id === user?.id && isOpen(o._state)).length,
      byState: Object.fromEntries((['needs_attention', 'not_started', 'sourcing', 'fulfilled', 'rejected'] as FulfillmentState[]).map(s => [s, data.filter(o => o._state === s).length])) as Record<FulfillmentState, number>,
    }
  }, [data, user?.id])

  const filtered = useMemo(() => {
    let list = data
    if (filter === 'open') list = list.filter(o => isOpen(o._state))
    else if (filter !== 'all') list = list.filter(o => o._state === filter)
    if (mine) list = list.filter(o => o.requested_by_user_id === user?.id)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(o =>
        [o.request_code, o.order_name, o.item_service_description, o.projects?.project_name, requesterName(o), ...o._names]
          .some(v => (v ?? '').toLowerCase().includes(q)))
    }
    // Open work: what is late first, then what is due soonest, critical before urgent.
    if (filter === 'open' || filter === 'needs_attention' || filter === 'not_started' || filter === 'sourcing') {
      const rank = (o: OrderWithMeta) => (o.priority === 'critical' ? 0 : o.priority === 'urgent' ? 1 : 2)
      list = [...list].sort((a, b) =>
        (b._overdueDays ?? -1) - (a._overdueDays ?? -1)
        || (a.required_by_date ?? '9999').localeCompare(b.required_by_date ?? '9999')
        || rank(a) - rank(b)
        || b.created_at.localeCompare(a.created_at))
    }
    return list
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, filter, mine, search, user?.id, requesters])

  function pick(f: Filter) { setFilter(f); setShown(PAGE) }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this purchase request? All line items will be removed.')) return
    // RLS deletes 0 rows for a denied request rather than erroring; .select() shows it.
    const { data, error } = await supabase.from('orders').delete().eq('id', id).select('id')
    if (error) { toast(error.message, 'error'); return }
    if (!data || data.length === 0) { toast("You don't have permission to delete this request", 'error'); return }
    qc.invalidateQueries({ queryKey: ['orders'] })
    qc.invalidateQueries({ queryKey: ['order-item-counts'] })
    toast('Purchase request deleted', 'success')
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Purchase requests</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">What has been asked for, and how far each request has got</p>
        </div>
        {canCreate && (
          <Link to="/purchase-requests/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
            <Plus className="h-4 w-4" /> New request
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatButton label="Open" value={counts.open} sub={`${counts.urgent} urgent or critical`} active={filter === 'open'} onClick={() => pick('open')} />
        <StatButton label="Overdue" value={counts.overdue} sub="open, past the date needed" tone={counts.overdue ? 'red' : undefined} active={false} onClick={() => pick('open')} />
        <StatButton label="Not started" value={counts.notStarted} sub="nothing sourced yet" tone={counts.notStarted ? 'amber' : undefined} active={filter === 'not_started'} onClick={() => pick('not_started')} />
        <StatButton label="Needs attention" value={counts.attention} sub="an item could not be sourced" tone={counts.attention ? 'red' : undefined} active={filter === 'needs_attention'} onClick={() => pick('needs_attention')} />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input type="text" placeholder="Code, item, project or person…" value={search} onChange={e => { setSearch(e.target.value); setShown(PAGE) }}
            className="w-full rounded-lg border bg-white py-2 pl-9 pr-8 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400" aria-label="Clear"><X className="h-3.5 w-3.5" /></button>}
        </label>
        <div className="flex gap-1.5 overflow-x-auto pb-1 sm:flex-wrap sm:pb-0">
          {FILTERS.map(f => {
            const n = f.value === 'open' ? counts.open : f.value === 'all' ? data.length : counts.byState[f.value]
            return (
              <button key={f.value} onClick={() => pick(f.value)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${filter === f.value ? 'border-brand bg-brand text-white' : 'bg-white text-slate-600 hover:border-brand dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>
                {f.label} <span className="opacity-60">{n}</span>
              </button>
            )
          })}
          <button onClick={() => { setMine(m => !m); setShown(PAGE) }} aria-pressed={mine}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium ${mine ? 'border-slate-700 bg-slate-700 text-white' : 'bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>
            Mine{counts.mine ? ` · ${counts.mine} open` : ''}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed bg-white py-14 text-center dark:border-slate-700 dark:bg-slate-800">
          <Package className="mx-auto mb-3 h-8 w-8 text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-500">
            {search || mine ? 'No matching requests.' : filter === 'open' ? 'Nothing open — every request is fulfilled or closed.' : 'No requests here.'}
          </p>
          {data.length === 0 && canCreate && (
            <Link to="/purchase-requests/new" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"><Plus className="h-3.5 w-3.5" /> Create the first request</Link>
          )}
        </div>
      ) : (
        <>
          <ul className="divide-y overflow-hidden rounded-xl border bg-white shadow-sm dark:divide-slate-700/60 dark:border-slate-700 dark:bg-slate-800">
            {filtered.slice(0, shown).map(o => (
              <OrderRowItem key={o.id} o={o} requester={requesterName(o)} canDelete={canDelete(o)}
                onOpen={() => navigate(`/purchase-requests/${o.id}`)}
                onEdit={() => navigate(`/purchase-requests/${o.id}/edit`)}
                onDelete={() => handleDelete(o.id)} />
            ))}
          </ul>
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Showing {Math.min(shown, filtered.length)} of {filtered.length}</span>
            {shown < filtered.length && (
              <button onClick={() => setShown(s => s + PAGE)} className="rounded-md border bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
                Show {Math.min(PAGE, filtered.length - shown)} more
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function StatButton({ label, value, sub, tone, active, onClick }: { label: string; value: number; sub: string; tone?: 'red' | 'amber'; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`rounded-xl border bg-white px-3.5 py-2.5 text-left shadow-sm transition-colors hover:border-brand dark:bg-slate-800 ${active ? 'border-brand ring-1 ring-brand' : 'dark:border-slate-700'}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${tone === 'red' ? 'text-red-600 dark:text-red-400' : tone === 'amber' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-800 dark:text-slate-100'}`}>{value}</p>
      <p className="truncate text-[11px] text-slate-400">{sub}</p>
    </button>
  )
}

function OrderRowItem({ o, requester, canDelete, onOpen, onEdit, onDelete }: {
  o: OrderWithMeta; requester: string | null; canDelete: boolean; onOpen: () => void; onEdit: () => void; onDelete: () => void
}) {
  const st = STATE[o._state]
  const open = isOpen(o._state)
  const title = o.order_name?.trim()
    || (o._names.length ? o._names.slice(0, 3).join(', ') + (o._names.length > 3 ? ` +${o._names.length - 3}` : '') : null)
    || o.item_service_description?.slice(0, 80)
    || 'Request with no items yet'
  const due = daysFromToday(o.required_by_date)
  const done = o._fulfilled + o._partial
  return (
    <li className="group cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/30" onClick={onOpen}>
      <div className="flex items-start gap-3 px-3 py-3 sm:px-4">
        <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${st.cls}`} title={st.label}>
          {o.is_new_item && open ? <Zap className="h-4 w-4" /> : <st.icon className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="min-w-0 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</span>
            {open && o.priority === 'critical' && <span className="inline-flex items-center gap-0.5 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-400"><AlertCircle className="h-3 w-3" />Critical</span>}
            {open && o.priority === 'urgent' && <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"><AlertTriangle className="h-3 w-3" />Urgent</span>}
            {o.is_new_item && open && <span className="rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">New item — market search</span>}
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {o.request_code && <span className="font-mono text-slate-400">{o.request_code}</span>}
            {o.projects?.project_name && <> · {o.projects.project_name}</>}
            {requester && <> · {requester}</>}
            <> · {ago(o.created_at)}</>
          </p>
          {/* Progress and due date — also on a phone */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            {o._state === 'rejected'
              ? <span className="font-medium text-slate-400">Rejected{o.rejection_reason ? ` — ${o.rejection_reason}` : ''}</span>
              : o._total === 0 ? <span className="text-slate-400">No items yet</span>
                : (
                  <span className="flex items-center gap-1.5">
                    <span className="flex h-1.5 w-20 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700" aria-hidden>
                      <span className="h-full bg-emerald-500" style={{ width: `${(o._fulfilled / o._total) * 100}%` }} />
                      <span className="h-full bg-sky-400" style={{ width: `${(o._partial / o._total) * 100}%` }} />
                      <span className="h-full bg-red-500" style={{ width: `${(o._blocked / o._total) * 100}%` }} />
                    </span>
                    <span className={o._blocked ? 'font-semibold text-red-600 dark:text-red-400' : 'text-slate-500'}>
                      {o._blocked ? `${o._blocked} could not be sourced · ` : ''}{done} of {o._total} sourced
                    </span>
                  </span>
                )}
            {open && (
              o._overdueDays != null
                ? <span className="inline-flex items-center gap-0.5 font-semibold text-red-600 dark:text-red-400"><Clock className="h-3 w-3" />{o._overdueDays} day{o._overdueDays === 1 ? '' : 's'} late</span>
                : due != null && <span className={due <= 3 ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-slate-500'}>
                    Needed {due === 0 ? 'today' : due === 1 ? 'tomorrow' : formatDate(o.required_by_date!)}
                  </span>
            )}
            {o._state === 'fulfilled' && <span className="font-medium text-emerald-600 dark:text-emerald-400">All sourced</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
          <button onClick={e => { e.stopPropagation(); onEdit() }} title="Edit" aria-label="Edit request"
            className="hidden rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 sm:block dark:hover:bg-slate-700"><Pencil className="h-3.5 w-3.5" /></button>
          {canDelete && (
            <button onClick={e => { e.stopPropagation(); onDelete() }} title="Delete" aria-label="Delete request"
              className="hidden rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 sm:block dark:hover:bg-red-900/20"><Trash2 className="h-3.5 w-3.5" /></button>
          )}
        </div>
        <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" />
      </div>
    </li>
  )
}
