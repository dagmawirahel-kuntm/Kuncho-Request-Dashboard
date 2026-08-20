import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { StatusBadge } from '@/components/shared/StatusBadge'
import type { Boq, BoqTreeRow } from '@/types/database'
import { X, ChevronRight } from 'lucide-react'

interface Props {
  projectId: string
  onClose: () => void
}

export function BoqVersionHistoryModal({ projectId, onClose }: Props) {
  const [viewingId, setViewingId] = useState<string | null>(null)

  const { data: versions = [], isLoading } = useQuery({
    queryKey: ['boq-version-history', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('boqs').select('*, staff:owner_pm_staff_id(employee_name)')
        .eq('project_id', projectId).order('version_number', { ascending: false })
      if (error) throw error
      return data as (Boq & { staff: { employee_name: string } | null })[]
    },
  })

  const { data: tree = [] } = useQuery({
    queryKey: ['boq-tree', viewingId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('v_boq_tree', { p_boq_id: viewingId! })
      if (error) throw error
      return (data ?? []) as BoqTreeRow[]
    },
    enabled: !!viewingId,
  })

  const viewing = versions.find(v => v.id === viewingId)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-2xl rounded-xl bg-white dark:bg-slate-800 p-5 shadow-xl space-y-3 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            {viewing ? `${viewing.title} — v${viewing.version_number} (read-only)` : 'BOQ Version History'}
          </h3>
          <button onClick={viewing ? () => setViewingId(null) : onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        {!viewing ? (
          isLoading ? (
            <p className="py-6 text-center text-sm text-slate-400">Loading…</p>
          ) : versions.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">No versions yet.</p>
          ) : (
            <div className="flex-1 overflow-y-auto divide-y dark:divide-slate-700">
              {versions.map(v => (
                <button key={v.id} onClick={() => setViewingId(v.id)}
                  className="w-full flex items-center justify-between px-2 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/40">
                  <div>
                    <p className="text-sm text-slate-700 dark:text-slate-200">v{v.version_number} — {v.title}</p>
                    <p className="text-xs text-slate-400">
                      {v.staff?.employee_name ?? '—'} · {formatDate(v.updated_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{formatCurrency(v.grand_total_etb)}</span>
                    <StatusBadge status={v.status} />
                    <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                  </div>
                </button>
              ))}
            </div>
          )
        ) : (
          <div className="flex-1 overflow-y-auto divide-y dark:divide-slate-800 text-xs">
            {tree.map(item => (
              <div key={item.id} className="flex items-center justify-between px-2 py-1.5" style={{ paddingLeft: `${8 + (item.depth - 1) * 14}px` }}>
                <span className={item.node_type === 'section' ? 'font-semibold text-slate-700 dark:text-slate-200' : 'text-slate-600 dark:text-slate-300'}>
                  {item.name}
                </span>
                {item.node_type !== 'section' && <span className="text-slate-400">{formatCurrency(item.total_etb)}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
