import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable, type QuickFilter } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Sale } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { useFiscalYear } from '@/contexts/FiscalYearContext'
import { Plus, Pencil, Trash2, Eye, Unlink } from 'lucide-react'

const saleQuickFilters: QuickFilter[] = [
  {
    columnId: 'sales_status',
    label: 'Status',
    options: [
      { label: 'Draft', value: 'Draft' },
      { label: 'Invoiced', value: 'Invoiced' },
      { label: 'Paid', value: 'Paid' },
      { label: 'Refunded', value: 'Refunded' },
      { label: 'Cancelled', value: 'Cancelled' },
    ],
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

export default function SalesPage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { role } = useAuth()
  // Manager can read + edit/approve sales (existing RLS), but not create or
  // delete — only admin/finance own that per the RLS policies since 001/047.
  const canDelete = role === 'admin' || role === 'finance'
  const { fiscalPeriodId, current } = useFiscalYear()
  const [missingProjectOnly, setMissingProjectOnly] = useState(false)

  const { data = [], isLoading } = useQuery({
    queryKey: ['sales', fiscalPeriodId],
    queryFn: async () => {
      let q = supabase.from('sales').select('*, clients(client_name), projects(project_name), accounts(account_name), tax_summary(month)').order('created_at', { ascending: false })
      if (fiscalPeriodId) q = q.eq('fiscal_period_id', fiscalPeriodId)
      const { data, error } = await q
      if (error) throw error
      return data as Sale[]
    },
  })

  // Passive visibility, same pattern as the unassigned-staff indicator:
  // always scoped to the CURRENT fiscal year regardless of whatever FY the
  // admin toggle has the table itself showing, since pre-FY2026/27 sales
  // are meant to keep their nulls permanently and should never surface here.
  const missingProjectLinks = useMemo(
    () => current ? data.filter(s => s.is_project_funded && !s.project_id && s.fiscal_period_id === current.id) : [],
    [data, current]
  )
  const rows = missingProjectOnly ? missingProjectLinks : data

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this sale record? This cannot be undone.')) return
    const { error } = await supabase.from('sales').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['sales'] })
    toast('Sale deleted', 'success')
  }

  const columns: ColumnDef<Sale>[] = useMemo(() => [
    { accessorKey: 'invoice_number', header: 'Invoice #', cell: ({ getValue }) => <span className="font-mono text-xs font-bold text-brand">{(getValue() as string) ?? '—'}</span> },
    { accessorKey: 'sales_description', header: 'Description', cell: ({ row }) => <Link to={`/sales/${row.original.id}`} className="max-w-xs truncate block text-slate-800 dark:text-slate-100 hover:text-brand hover:underline font-medium">{row.original.sales_description ?? '—'}</Link> },
    { accessorKey: 'date', header: 'Invoice Date', cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'amount', header: 'Amount (ETB)', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    { accessorKey: 'sales_status', header: 'Status', cell: ({ getValue }) => getValue() ? <StatusBadge status={(getValue() as string).toLowerCase()} /> : '—' },
    { accessorKey: 'product_or_service', header: 'Product/Service', cell: ({ getValue }) => getValue() ?? '—' },
    { id: 'client_name', header: 'Client', cell: ({ row }) => (row.original as any).clients?.client_name ?? '—' },
    { id: 'project_name', header: 'Project', cell: ({ row }) => (row.original as any).projects?.project_name ?? '—' },
    { id: 'account_name', header: 'Account', cell: ({ row }) => (row.original as any).accounts?.account_name ?? '—' },
    { id: 'tax_summary_month', header: 'Tax Month', cell: ({ row }) => (row.original as any).tax_summary?.month ?? '—' },
    { accessorKey: 'approval_status', header: 'Approval', filterFn: 'equals', cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Link to={`/sales/${row.original.id}`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="View"><Eye className="h-3.5 w-3.5" /></Link>
          <Link to={`/sales/${row.original.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></Link>
          {canDelete && <button onClick={() => handleDelete(row.original.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>}
        </div>
      ),
    },
  ], [canDelete])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800">Sales</h1><p className="text-sm text-slate-500">Sales records and invoices</p></div>
        {canDelete && (
          <Link to="/sales/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
            <Plus className="h-4 w-4" /> New Sale
          </Link>
        )}
      </div>
      {missingProjectLinks.length > 0 && (
        <button
          onClick={() => setMissingProjectOnly(m => !m)}
          className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${missingProjectOnly ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
        >
          <span className="flex-shrink-0 rounded-lg bg-amber-100 p-2 text-amber-600"><Unlink className="h-4 w-4" /></span>
          <span>
            <span className="block text-sm font-semibold text-slate-800">{missingProjectLinks.length} sale{missingProjectLinks.length !== 1 ? 's' : ''} missing a project link</span>
            <span className="block text-xs text-slate-400">{missingProjectOnly ? 'Showing only these' : 'This fiscal year · Click to filter'}</span>
          </span>
        </button>
      )}
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={rows} searchPlaceholder="Search sales…" persistKey="sales" initialGlobalFilter={searchParams.get('q') ?? undefined} tableName="sales" queryKeys={['sales']} quickFilters={saleQuickFilters} />}
    </div>
  )
}
