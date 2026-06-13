import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { VendorReceiptFacilitation } from '@/types/database'

const columns: ColumnDef<VendorReceiptFacilitation>[] = [
  { accessorKey: 'record_name', header: 'Record', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'trxn_date', header: 'Transaction Date', cell: ({ getValue }) => formatDate(getValue() as string) },
  { accessorKey: 'money_returned', header: 'Money Returned', cell: ({ getValue }) => formatCurrency(getValue() as number) },
  { accessorKey: 'net_facilitation_cost', header: 'Net Cost', cell: ({ getValue }) => formatCurrency(getValue() as number) },
  { accessorKey: 'notes', header: 'Notes', cell: ({ getValue }) => <span className="text-slate-400">{(getValue() as string) ?? '—'}</span> },
]

export default function VendorReceiptsPage() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['vendor-receipts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vendor_receipt_facilitation').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data as VendorReceiptFacilitation[]
    },
  })

  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold text-slate-800">Vendor Receipt Facilitation</h1><p className="text-sm text-slate-500">Receipt facilitation records</p></div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search records…" />}
    </div>
  )
}
