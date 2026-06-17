import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { formatCurrency } from '@/lib/utils'
import type { Product } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { Plus, Pencil, Trash2, Check } from 'lucide-react'

export default function ProductsPage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('*').order('product_name')
      if (error) throw error
      return data as Product[]
    },
  })

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete product "${name}"? This cannot be undone.`)) return
    const { error } = await supabase.from('products').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['products'] })
    toast('Product deleted', 'success')
  }

  const columns: ColumnDef<Product>[] = useMemo(() => [
    { accessorKey: 'product_name', header: 'Product Name' },
    { accessorKey: 'category', header: 'Category', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'unit_price', header: 'Unit Price', cell: ({ getValue }) => formatCurrency(getValue() as number) },
    {
      accessorKey: 'active',
      header: 'Active',
      cell: ({ getValue }) => getValue() ? <Check className="h-4 w-4 text-green-500" /> : <span className="text-slate-300">—</span>,
    },
    { accessorKey: 'description', header: 'Description', cell: ({ getValue }) => <span className="text-slate-400 truncate block max-w-xs">{(getValue() as string) ?? '—'}</span> },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Link to={`/products/${row.original.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></Link>
          <button onClick={() => handleDelete(row.original.id, row.original.product_name)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800">Products</h1><p className="text-sm text-slate-500">Product and service catalog</p></div>
        <Link to="/products/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          <Plus className="h-4 w-4" /> Add Product
        </Link>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search products…" persistKey="products" initialGlobalFilter={searchParams.get('q') ?? undefined} tableName="products" queryKeys={['products']} />}
    </div>
  )
}
