import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link, useNavigate } from 'react-router-dom'
import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable, type QuickFilter } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Expense, ExpenseType, CpoBond } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { FiscalYearFilter, useFiscalYearFilter } from '@/components/shared/FiscalYearFilter'
import {
  Plus, Pencil, Trash2, Receipt, Package, ArrowLeftRight, Shield,
  ChevronRight, Clock, CheckCircle2, TruckIcon, FileText, Banknote,
  ExternalLink, LayoutDashboard, Table2
} from 'lucide-react'

// ── Role helpers ─────────────────────────────────────────────────────────────

function useRoleAccess() {
  const { role, profile } = useAuth()
  const isSuperRole    = role === 'admin' || role === 'manager' || role === 'finance'
  const isProcurement  = role === 'procurement_officer'
  const isPM           = role === 'project_manager'
  const showBundles    = isSuperRole || isProcurement
  const showCPO        = isSuperRole || isPM
  const showVRF        = role === 'admin' || role === 'manager'
  const filterOwn      = !isSuperRole
  const canCreate      = role !== 'procurement_officer'
  const canSeeTable    = isSuperRole
  return { role, profile, isSuperRole, isProcurement, isPM, showBundles, showCPO, showVRF, filterOwn, canCreate, canSeeTable }
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
    label: 'Type',
    options: [
      { label: 'General', value: 'general' },
      { label: 'Purchase Order', value: 'purchase_order' },
      { label: 'VRF', value: 'vrf' },
      { label: 'CPO Bond', value: 'cpo_bond' },
    ],
  },
  { columnId: 'payment_status', label: 'Payment', options: [{ label: 'Paid', value: true }, { label: 'Pending', value: false }] },
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
  const { role, profile, showBundles, showCPO, showVRF, filterOwn, canCreate, canSeeTable } = useRoleAccess()

  const [activeTab, setActiveTab] = useState<'dashboard' | 'records'>('dashboard')

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: expenses = [], isLoading: expLoading } = useQuery({
    queryKey: ['expenses', role, profile?.id],
    queryFn: async () => {
      let q = supabase
        .from('expenses')
        .select('*, projects(project_name), accounts(account_name), vendors(vendor_name)')
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

  // Full expense list for Records tab — the one query on this page that's a
  // "browse history" list rather than active approval work, so it's the only
  // one that gets the fresh-platform current-FY default. The pipeline/
  // dashboard `expenses` query above stays unfiltered — pending approvals
  // must always show regardless of when they're dated.
  const { periods, value: fyValue, setValue: setFyValue, fiscalPeriodId } = useFiscalYearFilter()
  const { data: allExpenses = [], isLoading: allLoading } = useQuery({
    queryKey: ['expenses-all', fiscalPeriodId],
    queryFn: async () => {
      let q = supabase
        .from('expenses')
        .select('*, vendors(vendor_name,bank_account,location), projects(project_name), categories(category_name), sub_categories(item_name), accounts(account_name), vendor_receipt_facilitation(record_name), transfers(transfer_id_code), tax_summary(month), locations(location_name)')
        .order('created_at', { ascending: false })
      if (fiscalPeriodId) q = q.eq('fiscal_period_id', fiscalPeriodId)
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

  const TYPE_CLS: Record<ExpenseType, string> = {
    general:        'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
    purchase_order: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    vrf:            'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
    cpo_bond:       'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
    fuel:           'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  }
  const TYPE_LABEL: Record<ExpenseType, string> = {
    general: 'General', purchase_order: 'Purchase Order', vrf: 'VRF', cpo_bond: 'CPO Bond', fuel: 'Fuel',
  }

  const tableColumns: ColumnDef<Expense>[] = useMemo(() => [
    { accessorKey: 'expense_code', header: 'ID', cell: ({ getValue }) => <span className="font-mono text-xs font-bold text-slate-800 dark:text-slate-100">{(getValue() as string) ?? '—'}</span> },
    { accessorKey: 'item_service_description', header: 'Description', cell: ({ getValue }) => <span className="max-w-xs truncate block">{(getValue() as string) ?? '—'}</span> },
    { accessorKey: 'expense_type', header: 'Type', filterFn: 'equals', cell: ({ getValue }) => {
      const t = (getValue() as ExpenseType) ?? 'general'
      return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${TYPE_CLS[t]}`}>{TYPE_LABEL[t]}</span>
    }},
    { accessorKey: 'amount_etb', header: 'Amount', cell: ({ getValue }) => <span className="tabular-nums font-semibold">{formatCurrency(getValue() as number)}</span> },
    { accessorKey: 'date', header: 'Date', cell: ({ getValue }) => formatDate(getValue() as string) },
    { id: 'vendor', header: 'Vendor', cell: ({ row }) => (row.original as any).vendors?.vendor_name ?? row.original.vendors_name ?? '—' },
    { id: 'project', header: 'Project', cell: ({ row }) => (row.original as any).projects?.project_name ?? '—' },
    { accessorKey: 'approval_status', header: 'Approval', filterFn: 'equals', cell: ({ getValue }) => <StatusBadge status={(getValue() as string) ?? 'pending'} /> },
    { accessorKey: 'payment_status', header: 'Payment', filterFn: 'equals', cell: ({ getValue }) => <StatusBadge status={getValue() ? 'paid' : 'pending'} /> },
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
        <>
          <div className="flex justify-end">
            <FiscalYearFilter periods={periods} value={fyValue} onChange={setFyValue} />
          </div>
          {allLoading
          ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
          : <DataTable
              columns={tableColumns}
              data={allExpenses}
              searchPlaceholder="Search expenses…"
              persistKey="expenses-records"
              initialGlobalFilter={searchParams.get('q') ?? undefined}
              tableName="expenses"
              queryKeys={['expenses-all']}
              quickFilters={tableQuickFilters}
              expandable={{ summaryColumnIds: ['expense_code', 'expense_type', 'amount_etb', 'date', 'approval_status', 'payment_status'] }}
              groupBy={{ columnId: 'date' }}
            />}
        </>
      )}

      {/* ── DASHBOARD TAB ────────────────────────────────────────────────── */}
      {activeTab === 'dashboard' && (
        <div className="space-y-5">
          {isLoading && <div className="py-12 text-center text-sm text-slate-400">Loading…</div>}

          {!isLoading && (
            <>
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
