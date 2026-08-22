import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, Search, Send, Clock } from 'lucide-react'
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
// (not just people already allocated to this project) and request one
// straight from the WO, instead of navigating away to their profile.
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
  const [picked, setPicked] = useState<RosterMember | null>(null)

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

  const { data: pendingStaffIds = new Set<string>() } = useQuery({
    queryKey: ['tier2-roster-picker-pending', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('labor_requisitions')
        .select('specific_staff_id')
        .eq('project_id', projectId)
        .eq('status', 'pending')
        .not('specific_staff_id', 'is', null)
      if (error) throw error
      return new Set(data.map(r => r.specific_staff_id as string))
    },
  })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return roster
      .filter(m => !excludeStaffIds.has(m.id))
      .filter(m => !q || m.employee_name.toLowerCase().includes(q) || (m.trade_tag ?? '').toLowerCase().includes(q))
  }, [roster, excludeStaffIds, search])

  if (picked) {
    return (
      <RequestWorkerForProjectModal
        worker={{ id: picked.id, employee_name: picked.employee_name }}
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
            <p className="text-[11px] text-slate-500 mt-0.5">Picks a Tier 2 casual worker and creates a labor requisition for HR to approve.</p>
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
              return (
                <button
                  key={m.id}
                  onClick={() => !isPending && setPicked(m)}
                  disabled={isPending}
                  className="w-full flex items-center justify-between gap-3 px-1 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/40 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{m.employee_name}</p>
                    <p className="text-xs text-slate-400 truncate">{m.codename_english ?? m.trade_tag ?? '—'}</p>
                  </div>
                  {isPending ? (
                    <span className="flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300 shrink-0">
                      <Clock className="h-3 w-3" /> Waiting on HR
                    </span>
                  ) : (
                    <Send className="h-3.5 w-3.5 text-slate-300 shrink-0" />
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
