import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import { ClipboardCheck, ArrowRight, PackageSearch } from 'lucide-react'

interface PendingSetupRow {
  id: string
  item_name: string
  unit: string
  sub_category_id: string | null
  notes: string | null
  created_at: string
}

export default function StockPendingSetupPage() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['stock-items-pending-setup'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_stock_items_pending_setup')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as PendingSetupRow[]
    },
  })

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Pending Catalog Setup</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Items auto-created from received purchase orders — finish setting each one up before it counts toward stock-on-hand.
        </p>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
      ) : data.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed dark:border-slate-700 bg-white dark:bg-slate-800 py-16 text-center">
          <ClipboardCheck className="mx-auto h-8 w-8 text-slate-300 mb-3" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Nothing pending — every catalog item is fully set up.</p>
        </div>
      ) : (
        <div className="rounded-xl border dark:border-slate-700 overflow-hidden divide-y divide-slate-100 dark:divide-slate-700/60 shadow-sm">
          {data.map(item => (
            <div key={item.id} className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-800">
              <div className="flex-shrink-0 rounded-lg p-2 bg-amber-50 dark:bg-amber-900/20 text-amber-500">
                <PackageSearch className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{item.item_name}</span>
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                    Pending Setup
                  </span>
                  <span className="text-xs text-slate-400">{item.unit}</span>
                </div>
                {item.notes && (
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate">{item.notes}</p>
                )}
                <p className="mt-0.5 text-[11px] text-slate-400">Added {formatDate(item.created_at)}</p>
              </div>
              <Link
                to={`/stock/${item.id}/edit`}
                className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 transition-colors"
              >
                Finish Setup <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
