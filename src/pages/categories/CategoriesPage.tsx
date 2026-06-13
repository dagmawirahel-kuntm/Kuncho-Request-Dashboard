import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import type { Category } from '@/types/database'

const columns: ColumnDef<Category>[] = [
  { accessorKey: 'category_name', header: 'Category' },
  { accessorKey: 'category_type', header: 'Type', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'parent_type', header: 'Parent Type', cell: ({ getValue }) => getValue() ?? '—' },
]

export default function CategoriesPage() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data, error } = await supabase.from('categories').select('*').order('category_name')
      if (error) throw error
      return data as Category[]
    },
  })

  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold text-slate-800">Categories</h1><p className="text-sm text-slate-500">Expense categories and sub-categories</p></div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search categories…" />}
    </div>
  )
}
