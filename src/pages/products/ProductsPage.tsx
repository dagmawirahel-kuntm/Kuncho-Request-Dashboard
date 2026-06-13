import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { formatCurrency } from '@/lib/utils'
import type { Product } from '@/types/database'

const columns: ColumnDef<Product>[] = [
  { accessorKey: 'product_name', header: 'Product' },
  { accessorKey: 'category', header: 'Category', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'unit_price', header: 'Unit Price', cell: ({ getValue }) => formatCurrency(getValue() as number) },
  { accessorKey: 'active', header: 'Active', cell: ({ getValue }) => (getValue() ? '✓ Active' : 'Inactive') },
  { accessorKey: 'description', header: 'Description', cell: ({ getValue }) => <span className="text-slate-400">{(getValue() as string) ?? '—'}</span> },
]

export default function ProductsPage() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('*').order('product_name')
      if (error) throw error
      return data as Product[]
    },
  })

  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold text-slate-800">Products</h1><p className="text-sm text-slate-500">Products and services catalog</p></div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search products…" />}
    </div>
  )
}
