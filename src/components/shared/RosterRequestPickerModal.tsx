import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, Search, Clock, Check } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { RequestWorkerForProjectModal } from './RequestWorkerForProjectModal'

interface RosterMember {
  id: string
  employee_name: string
  trade_tag: string | null
  codename_english: string | null
  codename_amharic: string | null
}

// Quick roster pick from a work order: browse the Tier 2 casual roster
// (not just people already allocated to this project) and request them
// straight from the WO, instead of navigating away to each profile.
// Multi-select, because a crew is the normal case — five masons for one
// work order is one requisition with five workers, not five requisitions.
// Selecting never grants work directly — it hands off into
// RequestWorkerForProjectModal, which only ever creates a labor
// requisition for HR to approve.
export function RosterRequestPickerModal({ projectId, workOrderId, excludeStaffIds, onClose }: {
  projectId: string
  workOrderId: string
  excludeStaffIds: Set<string>
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const [pickedIds, setPickedIds] = useState<string[]>([])
  const [confirming, setConfirming] = useState(false)

  const { data: roster = [], isLoading } = useQuery({
    queryKey: ['tier2-roster-picker'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_staff_directory')
        .select('id, employee_name, trade_tag, codename_english, codename_amharic')
        .eq('employment_type', 'tier_2_casual')
        .eq('status', 'active')
        .order('employee_name')
      if (error) throw error
      return data as RosterMember[]
    },
  })

  // Already-requested workers, read from the join table (migration 261)
  // rather than specific_staff_id — that column is now only set when a
  // requisition happens to have exactly one worker, so reading it would
  // miss everyone in a group request and offer them up for a duplicate.
  const { data: pendingStaffIds = new Set<string>() } = useQuery({
    queryKey: ['tier2-roster-picker-pending', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('labor_requisition_workers')
        .select('staff_id, labor_requisitions!inner(project_id, status)')
        .eq('labor_requisitions.project_id', projectId)
        .eq('labor_requisitions.status', 'pending')
      if (error) throw error
      return new Set((data ?? []).map(r => (r as unknown as { staff_id: string }).staff_id))
    },
  })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return roster
      .filter(m => !excludeStaffIds.has(m.id))
      .filter(m => !q || m.employee_name.toLowerCase().includes(q) || (m.trade_tag ?? '').toLowerCase().includes(q))
  }, [roster, excludeStaffIds, search])

  const pickedWorkers = useMemo(
    () => roster.filter(m => pickedIds.includes(m.id)).map(m => ({
      id: m.id, employee_name: m.employee_name,
    })),
    [roster, pickedIds]
  )

  function toggle(id: string) {
    setPickedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  if (confirming && pickedWorkers.length > 0) {
    return (
      <RequestWorkerForProjectModal
        workers={pickedWorkers}
        workOrderId={workOrderId}
        defaultProjectId={projectId}
        onClose={onClose}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-800 shadow-2xl border dark:border-slate-700 p-5 space-y-3 max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Request from roster</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">Pick one or more Tier 2 casual workers — they go on a single labor requisition for HR to approve.</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or trade…"
            className="w-full rounded-md border pl-8 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
          />
        </div>

        <div className="flex-1 overflow-y-auto divide-y dark:divide-slate-700 -mx-1">
          {isLoading ? (
            <p className="px-1 py-4 text-center text-sm text-slate-400">Loading roster…</p>
          ) : filtered.length === 0 ? (
            <p className="px-1 py-4 text-center text-sm text-slate-400">No matching Tier 2 workers.</p>
          ) : (
            filtered.map(m => {
              const isPending = pendingStaffIds.has(m.id)
              const isPicked = pickedIds.includes(m.id)
              return (
                <button
                  key={m.id}
                  onClick={() => !isPending && toggle(m.id)}
                  disabled={isPending}
                  className="w-full flex items-center gap-3 px-1 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/40 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    isPicked ? 'border-brand bg-brand text-white' : 'border-slate-300 dark:border-slate-600'
                  }`}>
                    {isPicked && <Check className="h-3 w-3" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{m.employee_name}</p>
                    <p className="text-xs text-slate-400 truncate">{m.codename_english ?? m.trade_tag ?? '—'}</p>
                  </div>
                  {isPending && (
                    <span className="flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300 shrink-0">
                      <Clock className="h-3 w-3" /> Waiting on HR
                    </span>
                  )}
                </button>
              )
            })
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t dark:border-slate-700 pt-3">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {pickedIds.length === 0 ? 'No one selected' : `${pickedIds.length} selected`}
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-md border dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
              Cancel
            </button>
            <button
              onClick={() => setConfirming(true)}
              disabled={pickedIds.length === 0}
              className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-50"
            >
              Continue{pickedIds.length > 0 ? ` (${pickedIds.length})` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
