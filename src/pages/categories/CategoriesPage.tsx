import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import type { Category } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { Plus, Pencil, Trash2 } from 'lucide-react'

export default function CategoriesPage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data, error } = await supabase.from('categories').select('*').order('category_name')
      if (error) throw error
      return data as Category[]
    },
  })

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete category "${name}"? This cannot be undone.`)) return
    const { error } = await supabase.from('categories').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['categories'] })
    qc.invalidateQueries({ queryKey: ['categories-lookup'] })
    toast('Category deleted', 'success')
  }

  const columns: ColumnDef<Category>[] = useMemo(() => [
    { accessorKey: 'category_name', header: 'Category Name' },
    { accessorKey: 'category_type', header: 'Type', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'parent_type', header: 'Parent Type', cell: ({ getValue }) => getValue() ?? '—' },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Link to={`/categories/${row.original.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></Link>
          <button onClick={() => handleDelete(row.original.id, row.original.category_name)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800">Categories</h1><p className="text-sm text-slate-500">Expense and revenue categories</p></div>
        <Link to="/categories/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          <Plus className="h-4 w-4" /> Add Category
        </Link>
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search categories…" persistKey="categories" initialGlobalFilter={searchParams.get('q') ?? undefined} tableName="categories" queryKeys={['categories', 'categories-lookup']} />}
    </div>
  )
}
