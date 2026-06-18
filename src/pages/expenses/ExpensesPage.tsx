import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable, type QuickFilter } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Expense } from '@/types/database'
import { useVendors, useProjects, useCategories } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { OwnRecordsBanner } from '@/components/shared/OwnRecordsBanner'
import { Plus, Pencil, Trash2 } from 'lucide-react'

const expenseQuickFilters: QuickFilter[] = [
  { columnId: 'payment_status', label: 'Payment', options: [{ label: 'Paid', value: true }, { label: 'Pending', value: false }] },
]

export default function ExpensesPage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const { role } = useAuth()
  const qc = useQueryClient()
  const { data: vendors = [] } = useVendors()
  const { data: projects = [] } = useProjects()
  const { data: categories = [] } = useCategories()

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

  const columns: ColumnDef<Expense>[] = useMemo(() => [
    { accessorKey: 'expense_code', header: 'Code', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'item_service_description', header: 'Description', cell: ({ getValue }) => (
      <span className="max-w-xs truncate block">{(getValue() as string) ?? '—'}</span>
    )},
    { accessorKey: 'amount_etb', header: 'Amount (ETB)', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    { accessorKey: 'date', header: 'Date', cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'expense_type', header: 'Type', cell: ({ getValue }) => getValue() ?? '—' },
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
    { accessorKey: 'payment_status', header: 'Payment', filterFn: 'equals', cell: ({ getValue }) => <StatusBadge status={getValue() ? 'paid' : 'pending'} /> },
    { accessorKey: 'requested', header: 'Requested', cell: ({ getValue }) => <StatusBadge status={getValue() ? 'requested' : 'draft'} /> },
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
      header: 'Vendor Receipt Facilitation',
      cell: ({ row }) => (row.original as any).vendor_receipt_facilitation?.record_name ?? '—',
    },
    {
      id: 'transfer_name',
      header: 'Transfer',
      cell: ({ row }) => (row.original as any).transfers?.transfer_id_code ?? '—',
    },
    {
      id: 'tax_summary_month',
      header: 'Tax Month',
      cell: ({ row }) => (row.original as any).tax_summary?.month ?? '—',
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
          <Link to={`/expenses/${row.original.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit">
            <Pencil className="h-3.5 w-3.5" />
          </Link>
          <button onClick={() => handleDelete(row.original.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [vendors, projects, categories])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800">Expenses</h1><p className="text-sm text-slate-500">Manage all expense records</p></div>
        <Link to="/expenses/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          <Plus className="h-4 w-4" /> New Expense
        </Link>
      </div>
      {role === 'staff' && <OwnRecordsBanner />}
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search expenses…" persistKey="expenses" initialGlobalFilter={searchParams.get('q') ?? undefined} tableName="expenses" queryKeys={['expenses', 'expenses-lookup']} quickFilters={expenseQuickFilters} />}
    </div>
  )
}
