import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { WorkerPicker } from '@/components/labour/WorkerPicker'
import type { Candidate } from '@/lib/labourCandidates'
import { RequestWorkerForProjectModal } from './RequestWorkerForProjectModal'

// Quick roster pick from a work order: the casual workers who can do this
// job, best fits first (migration 478 — trade, verified by HR, free today,
// worked on this site before, rating), and request them straight from the
// WO. Multi-select, because a crew is the normal case — five masons for
// one work order is one requisition with five workers, not five.
// Selecting never grants work directly — it hands off into
// RequestWorkerForProjectModal, which only ever creates a labor
// requisition for HR to approve.
export function RosterRequestPickerModal({ projectId, workOrderId, excludeStaffIds, onClose, work }: {
  projectId: string
  workOrderId: string
  excludeStaffIds: Set<string>
  onClose: () => void
  /** What the job is, to suggest the trade. */
  work?: string
}) {
  const [picked, setPicked] = useState<Candidate[]>([])
  const [confirming, setConfirming] = useState(false)

  // Already-requested workers, read from the join table (migration 261):
  // waiting on HR, so not offered again for a duplicate request.
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
  const exclude = useMemo(() => new Set([...excludeStaffIds, ...pendingStaffIds]), [excludeStaffIds, pendingStaffIds])

  if (confirming && picked.length > 0) {
    return (
      <RequestWorkerForProjectModal
        workers={picked.map(c => ({ id: c.staff_id, employee_name: c.name, role: c.trade?.replace(/_/g, ' ') ?? null, day_rate: c.day_rate }))}
        workOrderId={workOrderId}
        defaultProjectId={projectId}
        onClose={onClose}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col space-y-3 overflow-y-auto rounded-xl border bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-800" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Who can do this job?</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">Pick one or more — they go on a single labour request for approval.{pendingStaffIds.size ? ` ${pendingStaffIds.size} already waiting for approval are left out.` : ''}</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>

        <WorkerPicker projectId={projectId} workOrderId={workOrderId} work={work} exclude={exclude}
          picked={picked.map(c => c.staff_id)}
          onToggle={c => setPicked(p => p.some(x => x.staff_id === c.staff_id) ? p.filter(x => x.staff_id !== c.staff_id) : [...p, c])} />

        <div className="flex items-center justify-between gap-2 border-t pt-3 dark:border-slate-700">
          <span className="text-xs text-slate-500 dark:text-slate-400">{picked.length === 0 ? 'No one selected' : `${picked.length} selected`}</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-md border px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">Cancel</button>
            <button onClick={() => setConfirming(true)} disabled={picked.length === 0}
              className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-50">
              Continue{picked.length > 0 ? ` (${picked.length})` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
