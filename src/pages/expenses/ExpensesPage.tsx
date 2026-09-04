import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link, useNavigate } from 'react-router-dom'
import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable, type QuickFilter } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Expense, ExpenseType, CpoBond, ExpensePaymentState } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { useFiscalYear } from '@/contexts/FiscalYearContext'
import {
  Plus, Pencil, Trash2, Receipt, Package, ArrowLeftRight, Shield,
  ChevronRight, Clock, CheckCircle2, TruckIcon, FileText, Banknote,
  ExternalLink, LayoutDashboard, Table2
} from 'lucide-react'

// ── Role helpers ─────────────────────────────────────────────────────────────

function useRoleAccess() {
  const { role, profile } = useAuth()
  const isSuperRole    = role === 'admin' || role === 'executive' || role === 'finance'
  const isProcurement  = role === 'procurement_officer'
  const isPM           = role === 'project_manager'
  const showBundles    = isSuperRole || isProcurement
  const showCPO        = isSuperRole || isPM
  const showVRF        = role === 'admin' || role === 'executive'
  const filterOwn      = !isSuperRole
  const canCreate      = role !== 'procurement_officer'
  const canSeeTable    = isSuperRole
  return { role, profile, isSuperRole, isProcurement, isPM, showBundles, showCPO, showVRF, filterOwn, canCreate, canSeeTable }
}

// Shared by the records table and the approvals queue, so a type reads the
// same in both. Module scope because the queue builds before the table does.
const TYPE_CLS: Record<ExpenseType, string> = {
  general:        'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  purchase_order: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  vrf:            'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  cpo_bond:       'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  fuel:           'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  subcontract:    'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
  maintenance:    'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  property_rent:  'bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-300',
  labor_payment:  'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  transportation: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
}
const TYPE_LABEL: Record<ExpenseType, string> = {
  general: 'General', purchase_order: 'Purchase Order', vrf: 'VRF', cpo_bond: 'CPO Bond', fuel: 'Fuel',
  subcontract: 'Subcontract', maintenance: 'Maintenance', property_rent: 'Property Rent', labor_payment: 'Labor Payment',
  transportation: 'Transportation',
}

// The states money actually moves through. 'void' is deliberately absent from
// the filter list — nothing is in it, and offering a filter that always
// returns nothing is worse than not offering it.
const PAYMENT_STATE_LABEL: Record<Exclude<ExpensePaymentState, 'void'>, string> = {
  unpaid:          'Unpaid',
  approved_to_pay: 'Approved to pay',
  sent:            'Sent',
  advance:         'Advance',
  paid:            'Paid',
}
const PAYMENT_STATE_CLS: Record<Exclude<ExpensePaymentState, 'void'>, string> = {
  unpaid:          'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  approved_to_pay: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  sent:            'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  advance:         'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  paid:            'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
}

const vendorOf = (e: Expense) => (e as any).vendors?.vendor_name ?? e.vendors_name ?? '—'
const projectOf = (e: Expense) => (e as any).projects?.project_name ?? '—'

// The cuts the Records tab can be analysed by. One selector drives both the
// summary panel and the table's own grouping, so the totals above and the
// rows below are always the same cut of the same data.
const RECORD_DIMENSIONS = {
  date:    { label: 'Date',    groupBy: { columnId: 'date' },                          key: (e: Expense) => (e.date ? String(e.date).slice(0, 10) : '—') },
  project: { label: 'Project', groupBy: { columnId: 'project', kind: 'text' as const }, key: projectOf },
  vendor:  { label: 'Vendor',  groupBy: { columnId: 'vendor', kind: 'text' as const },  key: vendorOf },
  type:    { label: 'Type',    groupBy: { columnId: 'expense_type', kind: 'text' as const }, key: (e: Expense) => TYPE_LABEL[(e.expense_type ?? 'general') as ExpenseType] ?? 'General' },
} as const
type RecordDim = keyof typeof RECORD_DIMENSIONS

/** Totals for the selected cut, so the tab answers "how much, by what" without
 *  anyone exporting to a spreadsheet to find out.
 *
 *  `rows` are the ones the table is actually showing, filters and search
 *  applied — a panel that ignored them would quietly contradict the list
 *  directly beneath it. `totalCount` is the unfiltered size, only so the
 *  header can say when the view is narrowed. */
function RecordsSummary({ rows, totalCount, dim, onDim }: {
  rows: Expense[]
  totalCount: number
  dim: RecordDim
  onDim: (d: RecordDim) => void
}) {
  const isFiltered = rows.length !== totalCount
  // Rows with no date carry no fiscal period, so they sit outside the year
  // this list is scoped to. They are shown rather than hidden, and counted
  // here so the scope line stays true instead of claiming they are the year.
  const unassigned = rows.filter(r => !r.fiscal_period_id).length
  const buckets = useMemo(() => {
    const key = RECORD_DIMENSIONS[dim].key
    const map = new Map<string, { count: number; total: number }>()
    for (const r of rows) {
      const k = key(r) || '—'
      const b = map.get(k) ?? { count: 0, total: 0 }
      b.count++; b.total += Number(r.amount_etb ?? 0)
      map.set(k, b)
    }
    return Array.from(map, ([label, v]) => ({ label, ...v })).sort((a, b) => b.total - a.total)
  }, [rows, dim])

  const grand = useMemo(() => buckets.reduce((s, b) => s + b.total, 0), [buckets])
  const top = buckets.slice(0, 8)
  const rest = buckets.slice(8)
  const restTotal = rest.reduce((s, b) => s + b.total, 0)

  return (
    <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 overflow-hidden">
      <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-3 border-b dark:border-slate-700">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Totals by</span>
          <div className="flex items-center gap-1">
            {(Object.keys(RECORD_DIMENSIONS) as RecordDim[]).map(d => (
              <button key={d} onClick={() => onDim(d)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  d === dim
                    ? 'bg-brand text-white'
                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}>
                {RECORD_DIMENSIONS[d].label}
              </button>
            ))}
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(grand)}</p>
          <p className="text-[11px] text-slate-400">
            {rows.length} record{rows.length === 1 ? '' : 's'}
            {isFiltered ? ` · filtered from ${totalCount}` : ' · this fiscal year'}
            {unassigned > 0 ? ` · incl. ${unassigned} undated` : ''}
          </p>
        </div>
      </div>

      {buckets.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-slate-400">Nothing to total.</p>
      ) : (
        <div className="divide-y dark:divide-slate-700">
          {top.map(b => (
            <div key={b.label} className="flex items-center gap-3 px-4 py-2">
              <span className={`min-w-0 flex-1 truncate text-sm ${b.label === '—' ? 'italic text-slate-400' : 'text-slate-700 dark:text-slate-200'}`}>
                {/* An unassigned bucket is a finding, not a rendering gap —
                    72% of spend by value currently carries no project — so it
                    says what it is rather than showing a bare dash. */}
                {b.label === '—'
                  ? `No ${RECORD_DIMENSIONS[dim].label.toLowerCase()}`
                  : dim === 'date' ? formatDate(b.label) : b.label}
              </span>
              {/* Share of the total, so a long list still reads at a glance. */}
              <span className="hidden sm:block h-1.5 w-24 shrink-0 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                <span className="block h-full rounded-full bg-brand" style={{ width: `${grand > 0 ? Math.max(2, (b.total / grand) * 100) : 0}%` }} />
              </span>
              <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-slate-400">{b.count}</span>
              <span className="w-32 shrink-0 text-right text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                {formatCurrency(b.total)}
              </span>
            </div>
          ))}
          {rest.length > 0 && (
            <div className="flex items-center gap-3 px-4 py-2 bg-slate-50 dark:bg-slate-900/30">
              <span className="min-w-0 flex-1 truncate text-sm text-slate-500 dark:text-slate-400">
                {rest.length} more {RECORD_DIMENSIONS[dim].label.toLowerCase()}{rest.length === 1 ? '' : 's'}
              </span>
              <span className="w-32 shrink-0 text-right text-sm font-semibold tabular-nums text-slate-500 dark:text-slate-400">
                {formatCurrency(restTotal)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Approvals queue ──────────────────────────────────────────────────────────

type QueueItem = {
  id: string
  kind: 'expense' | 'batch' | 'bundle' | 'labor_req'
  badge: string
  badgeCls: string
  code: string
  title: string
  meta: string | null
  amount: number
  /** When it started waiting — drives the age chip. */
  since: string | null
  to: string
}

/** How long something has been waiting. A backlog is invisible when every row
 *  looks equally fresh, so anything past a week is coloured.
 *
 *  `now` is passed in rather than read here: reading the clock during render
 *  makes the output depend on when React happens to re-render. The page pins
 *  it once per mount, which is ample for a figure quoted in whole days. */
function AgeChip({ since, now }: { since: string | null; now: number }) {
  if (!since) return null
  const days = Math.floor((now - new Date(since).getTime()) / 86_400_000)
  if (!Number.isFinite(days) || days < 0) return null
  const cls = days >= 14
    ? 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-300'
    : days >= 7
      ? 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-300'
      : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${cls}`}>
      {days === 0 ? 'today' : `${days}d`}
    </span>
  )
}

function QueueRow({ item, now }: { item: QueueItem; now: number }) {
  return (
    <Link
      to={item.to}
      className="flex items-center gap-3 px-5 py-3 border-b last:border-0 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors"
    >
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${item.badgeCls}`}>{item.badge}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-slate-700 dark:text-slate-200">{item.title}</p>
        <p className="truncate text-[11px] text-slate-400">
          <span className="font-mono">{item.code}</span>{item.meta ? ` · ${item.meta}` : ''}
        </p>
      </div>
      <AgeChip since={item.since} now={now} />
      <span className="shrink-0 text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">
        {formatCurrency(item.amount)}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" />
    </Link>
  )
}

// ── Pipeline strip ───────────────────────────────────────────────────────────

type Stage = { label: string; count: number; cls: string; icon?: React.ReactNode }

function PipelineStrip({ stages }: { stages: Stage[] }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {stages.map((s, i) => (
        <div key={s.label} className="flex items-center gap-1">
          <div className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${s.cls}`}>
            {s.icon}
            <span className="text-sm font-bold tabular-nums">{s.count}</span>
            <span className="text-xs font-medium opacity-80">{s.label}</span>
          </div>
          {i < stages.length - 1 && <ChevronRight className="h-3 w-3 text-slate-300 dark:text-slate-600 shrink-0" />}
        </div>
      ))}
    </div>
  )
}

// ── Section wrapper ──────────────────────────────────────────────────────────

function Section({
  icon, title, subtitle, badge, pipeline, viewAll, children
}: {
  icon: React.ReactNode
  title: string
  subtitle?: string
  badge?: React.ReactNode
  pipeline?: React.ReactNode
  viewAll?: { label: string; to: string }
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b dark:border-slate-700 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="rounded-lg p-2 bg-slate-100 dark:bg-slate-700">{icon}</div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">{title}</h2>
              {badge}
            </div>
            {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {viewAll && (
          <Link to={viewAll.to}
            className="flex items-center gap-1 text-xs text-brand hover:underline font-medium shrink-0">
            {viewAll.label} <ExternalLink className="h-3 w-3" />
          </Link>
        )}
      </div>
      {pipeline && <div className="px-5 py-3 bg-slate-50 dark:bg-slate-700/30 border-b dark:border-slate-700">{pipeline}</div>}
      <div>{children}</div>
    </div>
  )
}

function ViewOnly() {
  return (
    <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
      View only
    </span>
  )
}

// ── Expense rows ─────────────────────────────────────────────────────────────

function ExpenseRow({ e, onDelete, canDelete }: { e: Expense; onDelete: (id: string) => void; canDelete: boolean }) {
  const nav = useNavigate()
  return (
    <div
      onClick={() => nav(`/expenses/${e.id}`)}
      className="flex items-center gap-3 px-5 py-3 border-b dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors cursor-pointer"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-bold text-brand">{e.expense_code ?? '—'}</span>
          <StatusBadge status={e.approval_status ?? 'pending'} />
        </div>
        <p className="text-sm text-slate-700 dark:text-slate-200 truncate mt-0.5">
          {e.item_service_description ?? '—'}
        </p>
        <p className="text-xs text-slate-400 mt-0.5">
          {e.date ? formatDate(e.date) : ''}
          {(e as any).projects?.project_name ? ` · ${(e as any).projects.project_name}` : ''}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
          {e.amount_etb != null ? formatCurrency(e.amount_etb) : '—'}
        </p>
        <StatusBadge status={e.payment_status ? 'paid' : 'pending'} />
      </div>
      {canDelete && (
        <div className="flex items-center gap-1 shrink-0" onClick={ev => ev.stopPropagation()}>
          <Link to={`/expenses/${e.id}/edit`}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700">
            <Pencil className="h-3.5 w-3.5" />
          </Link>
          <button onClick={() => onDelete(e.id)}
            className="rounded p-1 text-slate-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

// ── Bundle rows ───────────────────────────────────────────────────────────────

const BUNDLE_STATUS_CLS: Record<string, string> = {
  drafting:  'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  submitted: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  approved:  'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  ordered:   'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  fulfilled: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  cancelled: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
}

const BUNDLE_STATUS_LABEL: Record<string, string> = {
  drafting: 'Drafting', submitted: 'Awaiting Finance', approved: 'Finance Approved',
  ordered: 'Ordered', fulfilled: 'Fulfilled', cancelled: 'Cancelled',
}

function BundleRow({ b, navigate }: { b: any; navigate: (to: string) => void }) {
  return (
    <div
      onClick={() => navigate(`/sourcing/${b.id}`)}
      className="flex items-center gap-3 px-5 py-3 border-b dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors cursor-pointer">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-bold text-brand">{b.bundle_code}</span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${BUNDLE_STATUS_CLS[b.status] ?? ''}`}>
            {BUNDLE_STATUS_LABEL[b.status] ?? b.status}
          </span>
        </div>
        <p className="text-sm text-slate-700 dark:text-slate-200 truncate mt-0.5">
          {b.vendors?.vendor_name ?? b.vendor_name ?? '—'}
        </p>
        <p className="text-xs text-slate-400 mt-0.5">{formatDate(b.created_at)}</p>
      </div>
      <ChevronRight className="h-4 w-4 text-slate-300 dark:text-slate-600 shrink-0" />
    </div>
  )
}

// ── CPO Bond rows ─────────────────────────────────────────────────────────────

function CpoRow({ b }: { b: CpoBond }) {
  return (
    <div className="flex items-center gap-3 px-5 py-3 border-b dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-bold text-purple-600 dark:text-purple-400">{b.bond_id_ref ?? '—'}</span>
          {b.bond_status && (
            <span className="rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-2 py-0.5 text-[11px] font-semibold">
              {b.bond_status}
            </span>
          )}
        </div>
        <p className="text-sm text-slate-700 dark:text-slate-200 truncate mt-0.5">{b.project ?? '—'}</p>
        <p className="text-xs text-slate-400 mt-0.5">{formatDate(b.created_at)}</p>
      </div>
      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 tabular-nums shrink-0">
        {b.total_bond_amount != null ? formatCurrency(b.total_bond_amount) : '—'}
      </p>
    </div>
  )
}

// ── VRF rows ──────────────────────────────────────────────────────────────────

function VrfRow({ v, navigate }: { v: any; navigate: (to: string) => void }) {
  return (
    <div
      onClick={() => navigate(`/vendor-receipts/${v.id}`)}
      className="flex items-center gap-3 px-5 py-3 border-b dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors cursor-pointer">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{v.record_name ?? '—'}</p>
        <p className="text-xs text-slate-400 mt-0.5">
          {v.facilitator_name ?? ''}
          {v.status && ` · ${v.status}`}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200">
          {v.amount_transferred != null ? formatCurrency(v.amount_transferred) : '—'}
        </p>
      </div>
      <ChevronRight className="h-4 w-4 text-slate-300 dark:text-slate-600 shrink-0" />
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return <p className="px-5 py-8 text-center text-sm text-slate-400">{message}</p>
}

// ── Table quickFilters (Records tab) ─────────────────────────────────────────

const tableQuickFilters: QuickFilter[] = [
  {
    columnId: 'expense_type',
    // Every type, not the five this listed: labor_payment alone is 57 rows
    // that could not be filtered to at all, and fuel, subcontract,
    // maintenance and property_rent were equally unreachable.
    label: 'Type',
    options: (Object.keys(TYPE_LABEL) as ExpenseType[]).map(t => ({ label: TYPE_LABEL[t], value: t })),
  },
  {
    // payment_status is a boolean that is only true for 'paid', so filtering
    // on it put 158 rows and 19.2M ETB into one "Pending" bucket — money
    // already sent looked identical to money nothing had happened to.
    columnId: 'payment_state',
    label: 'Payment',
    options: (Object.keys(PAYMENT_STATE_LABEL) as (keyof typeof PAYMENT_STATE_LABEL)[])
      .map(s => ({ label: PAYMENT_STATE_LABEL[s], value: s })),
  },
  {
    columnId: 'approval_status',
    label: 'Approval',
    options: [
      { label: 'Pending', value: 'pending' },
      { label: 'Manager Approved', value: 'manager_approved' },
      { label: 'Finance Approved', value: 'finance_approved' },
      { label: 'Rejected', value: 'rejected' },
    ],
  },
]

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ExpensesPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { role, profile, isSuperRole, showBundles, showCPO, showVRF, filterOwn, canCreate, canSeeTable } = useRoleAccess()

  const [activeTab, setActiveTab] = useState<'dashboard' | 'records'>('dashboard')
  const [recordDim, setRecordDim] = useState<RecordDim>('date')
  // What the Records table is actually showing after its own search and
  // filters. Null until the table first reports, so the panel falls back to
  // the full set rather than flashing an empty total on mount.
  const [filteredRecords, setFilteredRecords] = useState<Expense[] | null>(null)
  // Pinned once per mount: ages are quoted in whole days, and reading the
  // clock during render would make them shift on unrelated re-renders.
  const [now] = useState(() => Date.now())

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: expenses = [], isLoading: expLoading } = useQuery({
    queryKey: ['expenses', role, profile?.id],
    queryFn: async () => {
      let q = supabase
        .from('expenses')
        .select('*, projects(project_name), accounts(account_name), vendors(vendor_name)')
        .eq('is_archived', false)
        .order('created_at', { ascending: false })
      if (filterOwn && profile?.id) q = (q as any).eq('purchaser_user_id', profile.id)
      const { data, error } = await q
      if (error) throw error
      return data as Expense[]
    },
  })

  const { data: bundles = [], isLoading: bundleLoading } = useQuery({
    queryKey: ['sourcing-bundles-dashboard', role, profile?.id],
    queryFn: async () => {
      let q = supabase
        .from('sourcing_bundles')
        .select('*, vendors(vendor_name)')
        .order('created_at', { ascending: false })
        .limit(10)
      if (role === 'procurement_officer' && profile?.id) {
        q = (q as any).eq('procurement_officer_id', profile.id)
      }
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: showBundles,
  })

  const { data: cpoBonds = [], isLoading: cpoLoading } = useQuery({
    queryKey: ['cpo-bonds-dashboard'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cpo_bonds')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(8)
      if (error) throw error
      return (data ?? []) as CpoBond[]
    },
    enabled: showCPO,
  })

  const { data: vrfRecords = [], isLoading: vrfLoading } = useQuery({
    queryKey: ['vrf-dashboard'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vendor_receipt_facilitation')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(8)
      if (error) throw error
      return data ?? []
    },
    enabled: showVRF,
  })

  // ── Unified approvals queue ────────────────────────────────────────────────
  // Every section on this page covers one slice, and the pipeline strip counts
  // only expense_type 'general' — 17 of 237 unarchived expenses, and 1 of the
  // 59 actually awaiting approval. Labor rollups, purchase orders, transport,
  // fuel, whole batch payments and submitted sourcing bundles had no screen
  // showing they were waiting at all. This is that screen: one queue, every
  // source, largest money first.

  // Batches are fetched with their member expenses so a draft sitting inside
  // one is counted under the batch rather than listed twice — 15 of the 59
  // pending expenses are in a batch, and the batch is the thing approved.
  const { data: queueBatches = [] } = useQuery({
    queryKey: ['approval-queue-batches'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('batch_payments')
        .select('id, payment_code, created_at, transfer_id, batch_payment_expenses(expense_id, expenses(amount_etb, payment_state))')
        .is('transfer_id', null)
      if (error) throw error
      return (data ?? []) as unknown as {
        id: string; payment_code: string | null; created_at: string | null
        batch_payment_expenses: { expense_id: string; expenses: { amount_etb: number | null; payment_state: string | null } | null }[]
      }[]
    },
    enabled: isSuperRole,
  })

  const { data: queueBundles = [] } = useQuery({
    queryKey: ['approval-queue-bundles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sourcing_bundles')
        .select('id, bundle_code, vendor_name, total_value, submitted_at, vendors(vendor_name)')
        .eq('status', 'submitted')
      if (error) throw error
      return (data ?? []) as unknown as {
        id: string; bundle_code: string | null; vendor_name: string | null
        total_value: number | null; submitted_at: string | null
        vendors: { vendor_name: string } | null
      }[]
    },
    enabled: isSuperRole,
  })

  const { data: queueLaborReqs = [] } = useQuery({
    queryKey: ['approval-queue-labor-reqs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('labor_requisitions')
        .select('id, role_needed, estimated_total_cost, payment_basis, headcount, estimated_day_rate, estimated_days, unit_rate, estimated_total_volume, created_at, projects(project_name)')
        .eq('status', 'pending')
      if (error) throw error
      return (data ?? []) as unknown as {
        id: string; role_needed: string | null; estimated_total_cost: number | null
        payment_basis: string | null; headcount: number | null
        estimated_day_rate: number | null; estimated_days: number | null
        unit_rate: number | null; estimated_total_volume: number | null
        created_at: string | null; projects: { project_name: string } | null
      }[]
    },
    enabled: isSuperRole,
  })

  // Purchase requests are item-level asks with their own page and their own
  // volume (an order of magnitude more rows than everything else here), so
  // they're surfaced as a count to click through to rather than inlined.
  const { data: pendingOrderCount = 0 } = useQuery({
    queryKey: ['approval-queue-order-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('approval_status', 'pending')
        .eq('is_archived', false)
      if (error) throw error
      return count ?? 0
    },
    enabled: isSuperRole,
  })

  // Full expense list for Records tab — the one query on this page that's a
  // "browse history" list rather than active approval work, so it's the only
  // one that gets the fresh-platform current-FY default. The pipeline/
  // dashboard `expenses` query above stays unfiltered — pending approvals
  // must always show regardless of when they're dated.
  const { fiscalPeriodId } = useFiscalYear()
  const { data: allExpenses = [], isLoading: allLoading } = useQuery({
    queryKey: ['expenses-all', fiscalPeriodId],
    queryFn: async () => {
      let q = supabase
        .from('expenses')
        // vendor_receipt_facilitation is embedded through an explicit foreign
        // key because expenses has two of them to that table — vrf_id and
        // vendor_receipt_facilitation_id. An unqualified embed is ambiguous,
        // so PostgREST rejected the whole request (PGRST201) and the tab
        // rendered "No records found" for every row rather than for none.
        // vendor_receipt_facilitation_id is the live column: it is set on 13
        // rows, vrf_id on none.
        .select('*, vendors(vendor_name,bank_account,location), projects(project_name), categories(category_name), sub_categories(item_name), accounts(account_name), vendor_receipt_facilitation:vendor_receipt_facilitation_id(record_name), transfers(transfer_id_code), tax_summary(month), locations(location_name)')
        .eq('is_archived', false)
        .order('created_at', { ascending: false })
      // fiscal_period_id is stamped by trg_set_fiscal_period as
      // fiscal_period_for_date(date), so an expense with no date gets no
      // fiscal period — and filtering on the period alone made it invisible
      // here with nothing to explain why. That is how a 3,000 ETB
      // finance-approved, unpaid fuel expense (GEN-FUEL-20260805-01) came to
      // be missing from a list titled "All Records". Unassigned rows are
      // included alongside the selected year rather than silently dropped;
      // they are flagged in the summary so they are not mistaken for it.
      if (fiscalPeriodId) q = q.or(`fiscal_period_id.eq.${fiscalPeriodId},fiscal_period_id.is.null`)
      const { data, error } = await q
      if (error) throw error
      return data as Expense[]
    },
    enabled: canSeeTable && activeTab === 'records',
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this expense?')) return
    const { error } = await supabase.from('expenses').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['expenses'] })
    qc.invalidateQueries({ queryKey: ['expenses-all'] })
    toast('Expense deleted', 'success')
  }

  // ── Computed pipeline values ───────────────────────────────────────────────

  const generalExpenses = useMemo(() => expenses.filter(e => (e.expense_type ?? 'general') === 'general'), [expenses])
  const recentGeneral   = useMemo(() => generalExpenses.slice(0, 5), [generalExpenses])

  // Everything awaiting a decision, from every source, in one list. Sorted by
  // amount because the question an approver is answering is "what is the
  // biggest thing I'm holding up", not "what came in last".
  const approvalQueue: QueueItem[] = useMemo(() => {
    const batchable = queueBatches
      .map(b => {
        const lines = b.batch_payment_expenses ?? []
        const unpaid = lines.filter(l => l.expenses?.payment_state === 'unpaid')
        return { b, lines, unpaid }
      })
      .filter(x => x.unpaid.length > 0)

    // Expense ids covered by a batch that is itself still awaiting approval.
    const inBatch = new Set(batchable.flatMap(x => x.lines.map(l => l.expense_id)))

    const items: QueueItem[] = []

    for (const e of expenses) {
      if (e.approval_status !== 'pending' || inBatch.has(e.id)) continue
      const t = (e.expense_type ?? 'general') as ExpenseType
      items.push({
        id: e.id,
        kind: 'expense',
        badge: TYPE_LABEL[t] ?? 'Expense',
        badgeCls: TYPE_CLS[t] ?? TYPE_CLS.general,
        code: e.expense_code ?? '—',
        title: e.item_service_description ?? '—',
        meta: [(e as any).projects?.project_name, (e as any).vendors?.vendor_name ?? e.vendors_name].filter(Boolean).join(' · ') || null,
        amount: Number(e.amount_etb ?? 0),
        since: e.date ?? e.created_at ?? null,
        to: `/expenses/${e.id}`,
      })
    }

    for (const { b, lines } of batchable) {
      items.push({
        id: b.id,
        kind: 'batch',
        badge: 'Batch',
        badgeCls: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
        code: 'BATCH',
        title: b.payment_code ?? 'Batch payment',
        meta: `${lines.length} draft${lines.length === 1 ? '' : 's'} approved as one total`,
        amount: lines.reduce((s, l) => s + Number(l.expenses?.amount_etb ?? 0), 0),
        since: b.created_at,
        to: `/batch-payments/${b.id}`,
      })
    }

    for (const b of queueBundles) {
      items.push({
        id: b.id,
        kind: 'bundle',
        badge: 'Sourcing PO',
        badgeCls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
        code: b.bundle_code ?? '—',
        title: b.vendors?.vendor_name ?? b.vendor_name ?? 'Sourcing bundle',
        meta: 'Submitted for finance approval',
        amount: Number(b.total_value ?? 0),
        since: b.submitted_at,
        to: '/sourcing',
      })
    }

    for (const r of queueLaborReqs) {
      items.push({
        id: r.id,
        kind: 'labor_req',
        badge: 'Labor Req',
        badgeCls: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
        code: '—',
        title: r.role_needed ?? 'Labor requisition',
        meta: r.projects?.project_name ?? null,
        // estimated_total_cost is a generated column that only knows how to
        // multiply a day rate by days, so every per_volume requisition stores
        // 0.00 — a 250,000 birr painting job would sort to the bottom of the
        // queue reading "ETB 0.00". Same fallback v_work_order_cost uses.
        amount: Number(r.estimated_total_cost) ||
          (r.payment_basis === 'per_volume'
            ? Number(r.unit_rate ?? 0) * Number(r.estimated_total_volume ?? 0)
            : Number(r.estimated_day_rate ?? 0) * Number(r.estimated_days ?? 0) * Number(r.headcount ?? 1)),
        since: r.created_at,
        to: `/labor-requisitions/${r.id}`,
      })
    }

    return items.sort((a, b) => b.amount - a.amount)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses, queueBatches, queueBundles, queueLaborReqs])

  const queueTotal = useMemo(() => approvalQueue.reduce((s, i) => s + i.amount, 0), [approvalQueue])

  // Where the money stands, by the state it is actually in. The pipeline strip
  // above this counts approval status for one expense type; this counts birr
  // across all of them, which is the question the page title implies.
  const moneyStates = useMemo(() => {
    const order: (keyof typeof PAYMENT_STATE_LABEL)[] = ['unpaid', 'approved_to_pay', 'sent', 'advance', 'paid']
    return order.map(state => {
      const rows = expenses.filter(e => e.payment_state === state)
      return {
        state,
        label: PAYMENT_STATE_LABEL[state],
        cls: PAYMENT_STATE_CLS[state],
        count: rows.length,
        total: rows.reduce((s, e) => s + Number(e.amount_etb ?? 0), 0),
      }
    }).filter(s => s.count > 0)
  }, [expenses])

  // Money that left the account and was never confirmed as paid. It is the one
  // state on this page where the risk grows with age rather than shrinking:
  // an unpaid bill is a decision outstanding, an unconfirmed send is cash gone
  // with no landing recorded.
  const unconfirmedSends = useMemo(() => {
    const cutoff = now - 30 * 86_400_000
    return expenses
      .filter(e => e.payment_state === 'sent')
      .map(e => ({ e, at: new Date(e.date ?? e.created_at ?? now).getTime() }))
      .filter(x => Number.isFinite(x.at) && x.at < cutoff)
      .sort((a, b) => a.at - b.at)
  }, [expenses, now])
  const unconfirmedTotal = useMemo(
    () => unconfirmedSends.reduce((s, x) => s + Number(x.e.amount_etb ?? 0), 0),
    [unconfirmedSends],
  )

  const expensePipeline: Stage[] = useMemo(() => [
    { label: 'Pending',          count: generalExpenses.filter(e => e.approval_status === 'pending').length,          cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300', icon: <Clock className="h-3 w-3" /> },
    { label: 'Mgr Approved',     count: generalExpenses.filter(e => e.approval_status === 'manager_approved').length, cls: 'bg-amber-50 text-amber-600 dark:bg-amber-900/20',                   icon: <CheckCircle2 className="h-3 w-3" /> },
    { label: 'Finance Approved', count: generalExpenses.filter(e => e.approval_status === 'finance_approved' && !e.payment_status).length, cls: 'bg-blue-50 text-blue-600 dark:bg-blue-900/20', icon: <CheckCircle2 className="h-3 w-3" /> },
    { label: 'Paid',             count: generalExpenses.filter(e => e.payment_status).length,                         cls: 'bg-green-50 text-green-600 dark:bg-green-900/20',                   icon: <Banknote className="h-3 w-3" /> },
  ], [generalExpenses])

  const bundlePipeline: Stage[] = useMemo(() => [
    { label: 'Drafting',  count: bundles.filter(b => b.status === 'drafting').length,  cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',  icon: <FileText className="h-3 w-3" /> },
    { label: 'Submitted', count: bundles.filter(b => b.status === 'submitted').length, cls: 'bg-amber-50 text-amber-600 dark:bg-amber-900/20',                    icon: <Clock className="h-3 w-3" /> },
    { label: 'Approved',  count: bundles.filter(b => b.status === 'approved').length,  cls: 'bg-blue-50 text-blue-600 dark:bg-blue-900/20',                       icon: <CheckCircle2 className="h-3 w-3" /> },
    { label: 'Ordered',   count: bundles.filter(b => b.status === 'ordered').length,   cls: 'bg-purple-50 text-purple-600 dark:bg-purple-900/20',                  icon: <TruckIcon className="h-3 w-3" /> },
    { label: 'Fulfilled', count: bundles.filter(b => b.status === 'fulfilled').length, cls: 'bg-green-50 text-green-600 dark:bg-green-900/20',                    icon: <Package className="h-3 w-3" /> },
  ], [bundles])

  // ── Records tab columns ───────────────────────────────────────────────────

  const tableColumns: ColumnDef<Expense>[] = useMemo(() => [
    { accessorKey: 'expense_code', header: 'ID', cell: ({ getValue }) => <span className="font-mono text-xs font-bold text-slate-800 dark:text-slate-100">{(getValue() as string) ?? '—'}</span> },
    { accessorKey: 'item_service_description', header: 'Description', cell: ({ getValue }) => <span className="max-w-xs truncate block">{(getValue() as string) ?? '—'}</span> },
    { accessorKey: 'expense_type', header: 'Type', filterFn: 'equals', cell: ({ getValue }) => {
      const t = (getValue() as ExpenseType) ?? 'general'
      return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${TYPE_CLS[t]}`}>{TYPE_LABEL[t]}</span>
    }},
    { accessorKey: 'amount_etb', header: 'Amount', cell: ({ getValue }) => <span className="tabular-nums font-semibold">{formatCurrency(getValue() as number)}</span> },
    { accessorKey: 'date', header: 'Date', cell: ({ getValue }) => formatDate(getValue() as string) },
    // accessorFn rather than a cell-only column: without a value the table
    // cannot group or sort by these, and grouping by vendor/project is half
    // the point of the Records tab.
    { id: 'vendor', header: 'Vendor', accessorFn: (r: Expense) => vendorOf(r), cell: ({ getValue }) => (getValue() as string) },
    { id: 'project', header: 'Project', accessorFn: (r: Expense) => projectOf(r), cell: ({ getValue }) => (getValue() as string) },
    { accessorKey: 'approval_status', header: 'Approval', filterFn: 'equals', cell: ({ getValue }) => <StatusBadge status={(getValue() as string) ?? 'pending'} /> },
    { accessorKey: 'payment_state', header: 'Payment', filterFn: 'equals', cell: ({ getValue }) => {
      const s = getValue() as keyof typeof PAYMENT_STATE_LABEL
      const label = PAYMENT_STATE_LABEL[s]
      if (!label) return <span className="text-slate-400">—</span>
      return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${PAYMENT_STATE_CLS[s]}`}>{label}</span>
    }},
    { id: 'actions', header: '', cell: ({ row }) => (
      <div className="flex items-center gap-1">
        <Link to={`/expenses/${row.original.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700"><Pencil className="h-3.5 w-3.5" /></Link>
        <button onClick={() => handleDelete(row.original.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
    )},
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [])

  const isLoading = expLoading || (showBundles && bundleLoading) || (showCPO && cpoLoading) || (showVRF && vrfLoading)

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Approval Dashboard</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Track the progress of your requests through finance approval
          </p>
        </div>
        {canCreate && (
          <Link to="/expenses/new"
            className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
            <Plus className="h-4 w-4" /> New Expense
          </Link>
        )}
      </div>

      {/* Tabs (Records tab only available to finance/manager/admin) */}
      {canSeeTable && (
        <div className="flex items-center gap-1 border-b dark:border-slate-700">
          {([
            { key: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-3.5 w-3.5" /> },
            { key: 'records',   label: 'All Records', icon: <Table2 className="h-3.5 w-3.5" /> },
          ] as const).map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab.key
                  ? 'border-brand text-brand'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}>
              {tab.icon}{tab.label}
            </button>
          ))}
        </div>
      )}

      {/* ── RECORDS TAB ──────────────────────────────────────────────────── */}
      {activeTab === 'records' && canSeeTable && (
        allLoading
          ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
          : <div className="space-y-4">
            <RecordsSummary
              rows={filteredRecords ?? allExpenses}
              totalCount={allExpenses.length}
              dim={recordDim}
              onDim={setRecordDim}
            />
            <DataTable
              columns={tableColumns}
              data={allExpenses}
              searchPlaceholder="Search expenses…"
              persistKey="expenses-records"
              initialGlobalFilter={searchParams.get('q') ?? undefined}
              tableName="expenses"
              queryKeys={['expenses-all']}
              quickFilters={tableQuickFilters}
              expandable={{ summaryColumnIds: ['expense_code', 'expense_type', 'amount_etb', 'date', 'approval_status', 'payment_state'] }}
      groupBy={RECORD_DIMENSIONS[recordDim].groupBy}
              onFilteredRowsChange={setFilteredRecords}
            />
          </div>
      )}

      {/* ── DASHBOARD TAB ────────────────────────────────────────────────── */}
      {activeTab === 'dashboard' && (
        <div className="space-y-5">
          {isLoading && <div className="py-12 text-center text-sm text-slate-400">Loading…</div>}

          {!isLoading && (
            <>
              {/* Where the money stands. The queue below is what needs a
                  decision; this is what has already been decided and where it
                  has got to. */}
              {isSuperRole && moneyStates.length > 0 && (
                <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 overflow-hidden">
                  <div className="px-5 py-3 border-b dark:border-slate-700 flex items-center gap-2">
                    <Banknote className="h-4 w-4 text-slate-500" />
                    <div>
                      <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Where the money is</h2>
                      <p className="text-[11px] text-slate-400">Every expense by the state it is actually in</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-x divide-y sm:divide-y-0 dark:divide-slate-700">
                    {moneyStates.map(s => (
                      <div key={s.state} className="px-4 py-3">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${s.cls}`}>{s.label}</span>
                        <p className="mt-1.5 text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(s.total)}</p>
                        <p className="text-[11px] text-slate-400">{s.count} record{s.count === 1 ? '' : 's'}</p>
                      </div>
                    ))}
                  </div>

                  {unconfirmedSends.length > 0 && (
                    <div className="border-t dark:border-slate-700 bg-amber-50/60 dark:bg-amber-900/10">
                      <div className="flex items-center justify-between gap-3 flex-wrap px-5 py-2.5">
                        <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                          {formatCurrency(unconfirmedTotal)} sent over 30 days ago and never confirmed paid
                        </p>
                        <span className="text-[11px] text-amber-600/80 dark:text-amber-400/80">
                          {unconfirmedSends.length} payment{unconfirmedSends.length === 1 ? '' : 's'} · oldest first
                        </span>
                      </div>
                      {unconfirmedSends.slice(0, 5).map(({ e, at }) => (
                        <Link key={e.id} to={`/expenses/${e.id}`}
                          className="flex items-center gap-3 px-5 py-2 border-t border-amber-100 dark:border-amber-900/30 hover:bg-amber-100/50 dark:hover:bg-amber-900/20">
                          <span className="min-w-0 flex-1 truncate text-xs text-slate-700 dark:text-slate-200">
                            <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{e.expense_code ?? '—'}</span>
                            {' · '}{e.item_service_description ?? '—'}
                          </span>
                          <span className="shrink-0 text-[11px] tabular-nums text-amber-600 dark:text-amber-400">
                            {Math.floor((now - at) / 86_400_000)}d
                          </span>
                          <span className="shrink-0 text-xs font-bold tabular-nums text-slate-800 dark:text-slate-100">
                            {formatCurrency(e.amount_etb ?? 0)}
                          </span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Everything awaiting a decision, across every source. The
                  sections below each cover one slice; this covers the lot. */}
              {isSuperRole && (
                <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 overflow-hidden">
                  <div className="flex items-center justify-between gap-3 flex-wrap px-5 py-3 border-b dark:border-slate-700">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-amber-500" />
                      <div>
                        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Awaiting Approval</h2>
                        <p className="text-[11px] text-slate-400">
                          Expenses, batch payments, sourcing bundles and labor requisitions — largest first
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(queueTotal)}</p>
                      <p className="text-[11px] text-slate-400">{approvalQueue.length} item{approvalQueue.length === 1 ? '' : 's'}</p>
                    </div>
                  </div>

                  {approvalQueue.length === 0
                    ? <EmptyState message="Nothing is waiting on an approval decision." />
                    : approvalQueue.map(item => <QueueRow key={`${item.kind}:${item.id}`} item={item} now={now} />)
                  }

                  {pendingOrderCount > 0 && (
                    <Link
                      to="/purchase-requests"
                      className="flex items-center justify-between gap-2 px-5 py-3 border-t dark:border-slate-700 bg-slate-50 dark:bg-slate-700/20 hover:bg-slate-100 dark:hover:bg-slate-700/40"
                    >
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-semibold text-slate-700 dark:text-slate-200">{pendingOrderCount}</span> purchase requests also awaiting approval
                      </span>
                      <span className="flex items-center gap-1 text-xs font-medium text-brand">
                        Review <ExternalLink className="h-3 w-3" />
                      </span>
                    </Link>
                  )}
                </div>
              )}

              {/* General Expenses */}
              <Section
                icon={<Receipt className="h-4 w-4 text-slate-500" />}
                title="General Expenses"
                subtitle={filterOwn ? 'Your submitted expense requests' : 'All submitted expense requests'}
                pipeline={<PipelineStrip stages={expensePipeline} />}
              >
                {recentGeneral.length === 0
                  ? <EmptyState message="No general expenses yet." />
                  : recentGeneral.map(e => (
                      <ExpenseRow key={e.id} e={e} onDelete={handleDelete} canDelete={!filterOwn} />
                    ))
                }
                {generalExpenses.length > 5 && (
                  <div className="px-5 py-3 border-t dark:border-slate-700 bg-slate-50 dark:bg-slate-700/20">
                    <p className="text-xs text-slate-400">{generalExpenses.length - 5} more records — use the Records tab to view all</p>
                  </div>
                )}
              </Section>

              {/* Purchase Orders (Sourcing Bundles) */}
              {showBundles && (
                <Section
                  icon={<Package className="h-4 w-4 text-blue-600" />}
                  title="Purchase Orders"
                  subtitle={role === 'procurement_officer' ? 'Your sourcing bundles submitted for finance approval' : 'Sourcing bundles across all procurement officers'}
                  pipeline={<PipelineStrip stages={bundlePipeline} />}
                  viewAll={{ label: 'View all bundles', to: '/sourcing' }}
                >
                  {bundles.length === 0
                    ? <EmptyState message="No sourcing bundles yet." />
                    : bundles.slice(0, 5).map(b => <BundleRow key={b.id} b={b} navigate={navigate} />)
                  }
                </Section>
              )}

              {/* CPO Bonds */}
              {showCPO && (
                <Section
                  icon={<Shield className="h-4 w-4 text-purple-600" />}
                  title="CPO Bond Qualifications"
                  subtitle="Bonds purchased to qualify for tenders — indicators of potential incoming projects"
                  badge={role === 'project_manager' ? <ViewOnly /> : undefined}
                  viewAll={{ label: 'View all bonds', to: '/cpo-bonds' }}
                >
                  {cpoBonds.length === 0
                    ? <EmptyState message="No CPO bonds on record." />
                    : cpoBonds.map(b => <CpoRow key={b.id} b={b} />)
                  }
                </Section>
              )}

              {/* VRF — manager & admin only */}
              {showVRF && (
                <Section
                  icon={<ArrowLeftRight className="h-4 w-4 text-indigo-600" />}
                  title="Vendor Receipt Facilitation (VRF)"
                  subtitle="Cash transfers to personal accounts for site and workshop purchases"
                  viewAll={{ label: 'Manage VRF records', to: '/vendor-receipts' }}
                >
                  {vrfRecords.length === 0
                    ? <EmptyState message="No VRF records." />
                    : vrfRecords.map((v: any) => <VrfRow key={v.id} v={v} navigate={navigate} />)
                  }
                </Section>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
