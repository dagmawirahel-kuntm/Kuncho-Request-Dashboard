import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable, type QuickFilter } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Expense, ExpenseType } from '@/types/database'
import { useVendors, useProjects, useCategories } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { OwnRecordsBanner } from '@/components/shared/OwnRecordsBanner'
import { Plus, Pencil, Trash2, Receipt, Package, ArrowLeftRight, Shield } from 'lucide-react'

type TypeMeta = {
  key: ExpenseType | 'all'
  label: string
  icon: React.ReactNode
  color: string
  cardCls: string
}

const TYPE_META: TypeMeta[] = [
  {
    key: 'general',
    label: 'General',
    icon: <Receipt className="h-4 w-4" />,
    color: 'text-slate-600',
    cardCls: 'bg-slate-50 dark:bg-slate-700/30 text-slate-500 dark:text-slate-400',
  },
  {
    key: 'purchase_order',
    label: 'Purchase Order',
    icon: <Package className="h-4 w-4" />,
    color: 'text-blue-600',
    cardCls: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
  },
  {
    key: 'vrf',
    label: 'VRF',
    icon: <ArrowLeftRight className="h-4 w-4" />,
    color: 'text-indigo-600',
    cardCls: 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400',
  },
  {
    key: 'cpo_bond',
    label: 'CPO Bond',
    icon: <Shield className="h-4 w-4" />,
    color: 'text-purple-600',
    cardCls: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
  },
]

const TYPE_LABEL: Record<ExpenseType, string> = {
  general: 'General',
  purchase_order: 'Purchase Order',
  vrf: 'VRF',
  cpo_bond: 'CPO Bond',
}

const TYPE_CLS: Record<ExpenseType, string> = {
  general:        'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  purchase_order: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  vrf:            'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  cpo_bond:       'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
}

const quickFilters: QuickFilter[] = [
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

export default function ExpensesPage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const { role } = useAuth()
  const qc = useQueryClient()
  const { data: vendors = [] } = useVendors()
  const { data: projects = [] } = useProjects()
  const { data: categories = [] } = useCategories()

  const [activeType, setActiveType] = useState<ExpenseType | 'all'>('all')

  const { data = [], isLoading } = useQuery({
    queryKey: ['expenses'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('*, vendors(vendor_name,bank_account,location), projects(project_name), categories(category_name), sub_categories(item_name), accounts(account_name), vendor_receipt_facilitation(record_name), transfers(transfer_id_code), tax_summary(month), locations(location_name)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Expense[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this expense? This cannot be undone.')) return
    const { error } = await supabase.from('expenses').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['expenses'] })
    qc.invalidateQueries({ queryKey: ['expenses-lookup'] })
    toast('Expense deleted', 'success')
  }

  // Per-type totals for stat cards
  const typeSummary = useMemo(() => {
    const summary: Record<string, { count: number; total: number }> = {
      general: { count: 0, total: 0 },
      purchase_order: { count: 0, total: 0 },
      vrf: { count: 0, total: 0 },
      cpo_bond: { count: 0, total: 0 },
    }
    for (const e of data) {
      const t = e.expense_type ?? 'general'
      if (summary[t]) {
        summary[t].count++
        summary[t].total += e.amount_etb ?? 0
      }
    }
    return summary
  }, [data])

  const grandTotal = useMemo(() => data.reduce((s, e) => s + (e.amount_etb ?? 0), 0), [data])

  const filteredData = useMemo(() =>
    activeType === 'all' ? data : data.filter(e => (e.expense_type ?? 'general') === activeType),
    [data, activeType]
  )

  const columns: ColumnDef<Expense>[] = useMemo(() => [
    {
      accessorKey: 'expense_code',
      header: 'Request ID',
      cell: ({ getValue }) => <span className="font-mono text-sm font-bold text-slate-800 dark:text-slate-100">{(getValue() as string) ?? '—'}</span>,
    },
    {
      accessorKey: 'item_service_description',
      header: 'Description',
      cell: ({ getValue }) => <span className="max-w-xs truncate block text-slate-700 dark:text-slate-200">{(getValue() as string) ?? '—'}</span>,
    },
    {
      accessorKey: 'expense_type',
      header: 'Type',
      cell: ({ getValue }) => {
        const t = (getValue() as ExpenseType) ?? 'general'
        return (
          <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${TYPE_CLS[t]}`}>
            {TYPE_LABEL[t]}
          </span>
        )
      },
    },
    { accessorKey: 'amount_etb', header: 'Amount (ETB)', cell: ({ getValue }) => <span className="tabular-nums font-semibold">{formatCurrency(getValue() as number)}</span> },
    { accessorKey: 'date', header: 'Date', cell: ({ getValue }) => formatDate(getValue() as string) },
    {
      id: 'vendor_name',
      header: 'Vendor',
      cell: ({ row }) => (row.original as any).vendors?.vendor_name ?? row.original.vendors_name ?? '—',
    },
    {
      id: 'project_name',
      header: 'Project',
      cell: ({ row }) => (row.original as any).projects?.project_name ?? '—',
    },
    {
      id: 'category_name',
      header: 'General Ledger',
      cell: ({ row }) => (row.original as any).categories?.category_name ?? '—',
    },
    {
      accessorKey: 'approval_status',
      header: 'Approval',
      filterFn: 'equals',
      cell: ({ getValue }) => <StatusBadge status={(getValue() as string) ?? 'pending'} />,
    },
    {
      accessorKey: 'payment_status',
      header: 'Payment',
      filterFn: 'equals',
      cell: ({ getValue }) => <StatusBadge status={getValue() ? 'paid' : 'pending'} />,
    },
    {
      accessorKey: 'requested',
      header: 'Requested',
      cell: ({ getValue }) => <StatusBadge status={getValue() ? 'requested' : 'draft'} />,
    },
    {
      id: 'sub_category_name',
      header: 'Sub Ledger',
      cell: ({ row }) => (row.original as any).sub_categories?.item_name ?? '—',
    },
    {
      id: 'account_name',
      header: 'Account',
      cell: ({ row }) => (row.original as any).accounts?.account_name ?? '—',
    },
    {
      id: 'vendor_receipt_facilitation_name',
      header: 'VRF Record',
      cell: ({ row }) => (row.original as any).vendor_receipt_facilitation?.record_name ?? '—',
    },
    {
      id: 'transfer_name',
      header: 'Transfer',
      cell: ({ row }) => (row.original as any).transfers?.transfer_id_code ?? '—',
    },
    {
      id: 'location_name',
      header: 'Location',
      cell: ({ row }) => (row.original as any).locations?.location_name ?? '—',
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Link to={`/expenses/${row.original.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700" title="Edit">
            <Pencil className="h-3.5 w-3.5" />
          </Link>
          <button onClick={() => handleDelete(row.original.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600" title="Delete">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [vendors, projects, categories])

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Expenses</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            All payment requests — {data.length} records · {formatCurrency(grandTotal)} total
          </p>
        </div>
        <Link to="/expenses/new"
          className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          <Plus className="h-4 w-4" /> New Expense
        </Link>
      </div>

      {role === 'staff' && <OwnRecordsBanner />}

      {/* Type breakdown cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {TYPE_META.map(meta => {
          const s = typeSummary[meta.key as string] ?? { count: 0, total: 0 }
          const isActive = activeType === meta.key
          return (
            <button
              key={meta.key}
              onClick={() => setActiveType(isActive ? 'all' : meta.key as ExpenseType)}
              className={`rounded-xl border text-left p-4 shadow-sm transition-all ${
                isActive
                  ? 'border-brand ring-2 ring-brand/20 bg-white dark:bg-slate-800'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-600'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <div className={`rounded-lg p-1.5 ${meta.cardCls}`}>{meta.icon}</div>
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{meta.label}</span>
              </div>
              <p className="text-xl font-bold text-slate-800 dark:text-slate-100 tabular-nums">{s.count}</p>
              <p className="text-xs text-slate-400 tabular-nums mt-0.5">{formatCurrency(s.total)}</p>
            </button>
          )
        })}
      </div>

      {/* Type filter tabs */}
      <div className="flex items-center gap-1 border-b dark:border-slate-700">
        {(['all', ...TYPE_META.map(t => t.key)] as const).map(key => {
          const label = key === 'all' ? 'All' : TYPE_META.find(t => t.key === key)?.label ?? key
          const count = key === 'all' ? data.length : (typeSummary[key as string]?.count ?? 0)
          return (
            <button
              key={key}
              onClick={() => setActiveType(key as ExpenseType | 'all')}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeType === key
                  ? 'border-brand text-brand'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              {label}
              <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                activeType === key ? 'bg-brand/10 text-brand' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
              }`}>{count}</span>
            </button>
          )
        })}
      </div>

      {/* Table */}
      {isLoading
        ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
        : <DataTable
            columns={columns}
            data={filteredData}
            searchPlaceholder="Search expenses…"
            persistKey="expenses"
            initialGlobalFilter={searchParams.get('q') ?? undefined}
            tableName="expenses"
            queryKeys={['expenses', 'expenses-lookup']}
            quickFilters={quickFilters}
            expandable={{ summaryColumnIds: ['expense_code', 'expense_type', 'amount_etb', 'date', 'approval_status', 'payment_status'] }}
            groupBy={{ columnId: 'date' }}
          />
      }
    </div>
  )
}
