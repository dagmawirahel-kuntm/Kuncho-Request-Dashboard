import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { VendorReceiptFacilitation } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { Plus, Pencil, Trash2 } from 'lucide-react'

export default function VendorReceiptsPage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['vendor-receipts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vendor_receipt_facilitation').select('*, initial:accounts!initial_account_id(account_name), returned:accounts!return_account_id(account_name)').order('created_at', { ascending: false })
      if (error) throw error
      return data as VendorReceiptFacilitation[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this record? This cannot be undone.')) return
    const { error } = await supabase.from('vendor_receipt_facilitation').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['vendor-receipts'] })
    toast('Record deleted', 'success')
  }

  const columns: ColumnDef<VendorReceiptFacilitation>[] = useMemo(() => [
    { accessorKey: 'record_name', header: 'Record', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'trxn_date', header: 'Date', cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'money_returned', header: 'Money Returned', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    { accessorKey: 'net_facilitation_cost', header: 'Net Facilitation Cost', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    { accessorKey: 'notes', header: 'Notes', cell: ({ getValue }) => <span className="text-slate-400 truncate block max-w-xs">{(getValue() as string) ?? '—'}</span> },
    { id: 'initial_account_name', header: 'Initial Account', cell: ({ row }) => (row.original as any).initial?.account_name ?? '—' },
    { id: 'return_account_name', header: 'Return Account', cell: ({ row }) => (row.original as any).returned?.account_name ?? '—' },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Link to={`/vendor-receipts/${row.original.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></Link>
          <button onClick={() => handleDelete(row.original.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800">Vendor Receipts</h1><p className="text-sm text-slate-500">Vendor receipt facilitation records</p></div>
        <Link to="/vendor-receipts/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          <Plus className="h-4 w-4" /> Add Record
        </Link>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search records…" persistKey="vendor-receipts" initialGlobalFilter={searchParams.get('q') ?? undefined} tableName="vendor_receipt_facilitation" queryKeys={['vendor-receipts']} />}
    </div>
  )
}
