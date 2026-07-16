import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { formatDateGC } from '@/lib/utils'
import type { PerformanceReview } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { Plus, Pencil, Trash2 } from 'lucide-react'

type PerformanceReviewRow = PerformanceReview & {
  staff: { employee_name: string } | null
  reviewer: { employee_name: string } | null
}

export default function PerformanceReviewsPage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const { role } = useAuth()
  const qc = useQueryClient()
  const canManage = role === 'hr_officer' || role === 'admin'

  const { data = [], isLoading } = useQuery({
    queryKey: ['performance-reviews'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('performance_reviews')
        .select('*, staff:staff_id(employee_name), reviewer:reviewer_staff_id(employee_name)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as PerformanceReviewRow[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this performance review? This cannot be undone.')) return
    const { error } = await supabase.from('performance_reviews').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['performance-reviews'] })
    toast('Performance review deleted', 'success')
  }

  const columns: ColumnDef<PerformanceReviewRow>[] = useMemo(() => [
    { id: 'staff_name', header: 'Staff', cell: ({ row }) => row.original.staff?.employee_name ?? '—' },
    { accessorKey: 'review_period', header: 'Review Period', cell: ({ getValue }) => getValue() ?? '—' },
    { id: 'reviewer_name', header: 'Reviewer', cell: ({ row }) => row.original.reviewer?.employee_name ?? '—' },
    { accessorKey: 'overall_rating', header: 'Overall Rating', cell: ({ getValue }) => getValue() ?? '—' },
    { accessorKey: 'review_date', header: 'Review Date', cell: ({ getValue }) => formatDateGC(getValue() as string) },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        canManage ? (
          <div className="flex items-center gap-1">
            <Link to={`/performance-reviews/${row.original.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></Link>
            <button onClick={() => handleDelete(row.original.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ) : null
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [canManage])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Performance Reviews</h1><p className="text-sm text-slate-500 dark:text-slate-400">Staff performance evaluations</p></div>
        {canManage && (
          <Link to="/performance-reviews/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
            <Plus className="h-4 w-4" /> New Review
          </Link>
        )}
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search reviews…" persistKey="performance-reviews" initialGlobalFilter={searchParams.get('q') ?? undefined} tableName={canManage ? 'performance_reviews' : undefined} queryKeys={['performance-reviews']} />}
    </div>
  )
}
