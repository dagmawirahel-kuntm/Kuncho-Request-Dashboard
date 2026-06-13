import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import type { Vendor } from '@/types/database'

const columns: ColumnDef<Vendor>[] = [
  { accessorKey: 'vendor_name', header: 'Vendor' },
  { accessorKey: 'vendor_type', header: 'Type', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'category', header: 'Category', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'tin', header: 'TIN', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'phone_contact', header: 'Phone', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'wth_eligible', header: 'WHT Eligible', cell: ({ getValue }) => (getValue() ? 'Yes' : 'No') },
  { accessorKey: 'active', header: 'Active', cell: ({ getValue }) => (getValue() ? '✓ Active' : 'Inactive') },
]

export default function VendorsPage() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['vendors'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vendors').select('*').order('vendor_name')
      if (error) throw error
      return data as Vendor[]
    },
  })

  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold text-slate-800">Vendors</h1><p className="text-sm text-slate-500">Supplier directory</p></div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search vendors…" />}
    </div>
  )
}
