import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { formatCurrency } from '@/lib/utils'
import type { PurchaseAllocation } from '@/types/database'

const columns: ColumnDef<PurchaseAllocation>[] = [
  { accessorKey: 'allocation_name', header: 'Allocation', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'quantity', header: 'Qty', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'uom', header: 'UOM', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'unit_price', header: 'Unit Price', cell: ({ getValue }) => formatCurrency(getValue() as number) },
  { accessorKey: 'unit_price_vat_status', header: 'VAT Status', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'notes', header: 'Notes', cell: ({ getValue }) => <span className="text-slate-400">{(getValue() as string) ?? '—'}</span> },
]

export default function PurchaseAllocationPage() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['purchase-allocation'],
    queryFn: async () => {
      const { data, error } = await supabase.from('purchase_allocation').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data as PurchaseAllocation[]
    },
  })

  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold text-slate-800">Purchase Allocation</h1><p className="text-sm text-slate-500">Expense breakdown allocations</p></div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search allocations…" />}
    </div>
  )
}
