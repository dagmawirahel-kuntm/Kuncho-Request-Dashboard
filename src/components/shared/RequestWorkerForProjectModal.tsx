import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { useProjects } from '@/hooks/useLookups'
import { SearchableSelect } from '@/components/shared/SearchableSelect'

export interface RequestableWorker {
  id: string
  employee_name: string
  role?: string | null
  day_rate?: number | null
}

interface Props {
  /** One or more roster workers — all requested on a single requisition. */
  workers: RequestableWorker[]
  onClose: () => void
  workOrderId?: string
  defaultProjectId?: string
}

// Roster-driven labor request: a PM picks people off the roster and hits
// "Request for project". One requisition covers the whole group — they
// share a project, work order, date window and rate, so splitting them
// into one requisition per person only multiplied the approvals. Each
// selected worker becomes a row in labor_requisition_workers (migration
// 261); on HR approval the trigger creates one labor_allocation per row,
// so the timesheet → rollup → payment pipeline picks them all up without
// any extra manual step. When opened from a work order (workOrderId set),
// the requisition also carries work_order_id so the same approval path
// (218's auto-crew) lands them straight on that work order's crew.
export function RequestWorkerForProjectModal({ workers, onClose, workOrderId, defaultProjectId }: Props) {
  const { toast } = useToast()
  const { user } = useAuth()
  const qc = useQueryClient()
  const { data: projects = [] } = useProjects()
  const [projectId, setProjectId] = useState<string | null>(defaultProjectId ?? null)
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10))
  const [endDate, setEndDate]     = useState<string>('')
  const [days, setDays]           = useState<string>('7')
  const [basis, setBasis]         = useState<'per_day' | 'per_volume'>('per_day')
  // A single worker's own rate prefills the field; a mixed group leaves it
  // blank so each person keeps their own roster rate on allocation.
  const [dayRate, setDayRate]     = useState<string>(
    workers.length === 1 && workers[0].day_rate != null ? String(workers[0].day_rate) : ''
  )
  const [volumeUnit, setVolumeUnit] = useState('m²')
  const [unitRate, setUnitRate]     = useState<string>('')
  const [totalVolume, setTotalVolume] = useState<string>('')
  const [notes, setNotes]         = useState('')
  const [saving, setSaving]       = useState(false)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const projectOptions = useMemo(() => projects.map((p: any) => ({ id: p.id, label: p.project_name })), [projects])

  async function handleSave() {
    if (!projectId) { toast('Pick a project', 'error'); return }
    if (workers.length === 0) { toast('Pick at least one worker', 'error'); return }
    if (basis === 'per_volume' && (!totalVolume || Number(totalVolume) <= 0)) {
      toast('Enter the estimated total volume', 'error'); return
    }
    setSaving(true)
    const names = workers.map(w => w.employee_name).join(', ')
    const payload = {
      project_id: projectId,
      work_order_id: workOrderId ?? null,
      // Denormalised single-worker pointer only; the join table below is
      // authoritative for the group.
      specific_staff_id: workers.length === 1 ? workers[0].id : null,
      role_needed: workers[0].role ?? 'Worker',
      headcount: workers.length,
      is_casual_or_new: false,
      start_date: startDate,
      end_date: endDate || null,
      // Blank day rate is meaningful for a group: each worker is then
      // allocated at their own roster rate.
      estimated_day_rate: basis === 'per_day' ? (dayRate ? Number(dayRate) : null) : null,
      estimated_days: basis === 'per_day' ? (days ? Number(days) : null) : null,
      estimated_total_volume: basis === 'per_volume' ? Number(totalVolume) : null,
      payment_basis: basis,
      payment_model: 'individual',
      pay_cycle: 'weekly',
      volume_unit: basis === 'per_volume' ? volumeUnit : null,
      unit_rate: basis === 'per_volume' ? (Number(unitRate) || null) : null,
      requested_by: user?.id ?? null,
      notes: notes ? `${notes} (roster request for ${names})` : `Roster request for ${names}`,
    }
    const { data, error } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('labor_requisitions').insert([payload as any]).select('id').single()
    if (error || !data) { setSaving(false); toast(error?.message ?? 'Failed to create request', 'error'); return }

    const reqId = (data as { id: string }).id
    const { error: linkErr } = await supabase.from('labor_requisition_workers')
      .insert(workers.map(w => ({ requisition_id: reqId, staff_id: w.id })))
    setSaving(false)
    if (linkErr) { toast(linkErr.message, 'error'); return }

    qc.invalidateQueries({ queryKey: ['labor-requisitions'] })
    qc.invalidateQueries({ queryKey: ['tier2-roster-picker-pending'] })
    toast(
      workers.length === 1
        ? 'Request submitted — awaiting HR approval'
        : `Request submitted for ${workers.length} workers — awaiting HR approval`,
      'success'
    )
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white dark:bg-slate-800 shadow-2xl border dark:border-slate-700 p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {workers.length === 1
                ? `Request ${workers[0].employee_name} for a project`
                : `Request ${workers.length} workers for a project`}
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Creates {workers.length === 1 ? 'a labor requisition targeting this specific person' : 'ONE labor requisition covering all of them'}. HR approval auto-allocates {workers.length === 1 ? 'them' : 'each of them'}.
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>

        <div>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Project *</label>
          {workOrderId ? (
            <p className="mt-1 rounded-md border bg-slate-50 dark:bg-slate-900/40 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 dark:border-slate-600">
              {projectOptions.find(p => p.id === projectId)?.label ?? 'This work order\'s project'}
            </p>
          ) : (
            <SearchableSelect value={projectId} onChange={setProjectId} options={projectOptions} placeholder="Select project…" />
          )}
        </div>

        {workers.length > 1 && (
          <div>
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Workers ({workers.length})</label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {workers.map(w => (
                <span key={w.id} className="rounded-full bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-[11px] text-slate-600 dark:text-slate-300">
                  {w.employee_name}{w.day_rate != null ? ` · ${w.day_rate}` : ''}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className={`grid gap-2 ${basis === 'per_day' ? 'grid-cols-3' : 'grid-cols-2'}`}>
          <div>
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Start *</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">End</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={inputCls} />
          </div>
          {basis === 'per_day' && (
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Est. days</label>
              <input type="number" min="0" value={days} onChange={e => setDays(e.target.value)} className={inputCls} />
            </div>
          )}
        </div>

        <div>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Payment basis</label>
          <div className="flex gap-2 mt-1">
            {(['per_day', 'per_volume'] as const).map(b => (
              <label key={b} className={`flex-1 cursor-pointer rounded-md border px-3 py-2 text-sm text-center capitalize ${basis === b ? 'border-brand bg-brand/5 text-brand dark:bg-brand/10' : 'border-slate-200 text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>
                <input type="radio" name="basis" className="sr-only" checked={basis === b} onChange={() => setBasis(b)} />
                {b.replace('_', ' ')}
              </label>
            ))}
          </div>
        </div>

        {basis === 'per_day' ? (
          <div>
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Day rate (ETB)</label>
            <input type="number" step="0.01" min="0" value={dayRate} onChange={e => setDayRate(e.target.value)} className={inputCls} placeholder="Leave blank to use each worker's own rate" />
            <p className="mt-1 text-[11px] text-slate-400">
              {dayRate
                ? 'Applied to everyone on this request.'
                : `Blank — each worker is allocated at their own roster rate.`}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Volume unit *</label>
              <input value={volumeUnit} onChange={e => setVolumeUnit(e.target.value)} placeholder="m² · pcs · lm" className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Unit rate (ETB/{volumeUnit || 'unit'}) *</label>
              <input type="number" step="0.01" min="0" value={unitRate} onChange={e => setUnitRate(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Total volume *</label>
              <input type="number" step="0.01" min="0" value={totalVolume} onChange={e => setTotalVolume(e.target.value)} className={inputCls} />
            </div>
          </div>
        )}

        <div>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Notes</label>
          <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} className={inputCls} />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-md border dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-60">
            {saving ? 'Submitting…' : 'Submit request'}
          </button>
        </div>
      </div>
    </div>
  )
}

const inputCls = 'w-full mt-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'
