import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { countDownstream } from '@/lib/scheduleTree'
import type { ScheduleTask, ScheduleTaskStatus } from '@/types/database'
import { X, AlertTriangle } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'
const STATUS_OPTIONS: ScheduleTaskStatus[] = ['not_started', 'in_progress', 'completed', 'blocked', 'on_hold']

interface Props {
  scheduleId: string
  task: ScheduleTask | null // null = creating a new task
  allTasks: ScheduleTask[]
  nextDisplayOrder: number
  onClose: () => void
  onSaved: () => void
}

export function ScheduleTaskFormModal({ scheduleId, task, allTasks, nextDisplayOrder, onClose, onSaved }: Props) {
  const { toast } = useToast()
  const isEdit = !!task
  const [title, setTitle] = useState(task?.title ?? '')
  const [notes, setNotes] = useState(task?.notes ?? '')
  const [startDate, setStartDate] = useState(task?.current_start_date ?? new Date().toISOString().slice(0, 10))
  const [durationDays, setDurationDays] = useState(task?.current_duration_days ?? 1)
  const [endDate, setEndDate] = useState(task?.current_end_date ?? '')
  const [predecessorId, setPredecessorId] = useState<string | null>(task?.predecessor_task_id ?? null)
  const [lagDays, setLagDays] = useState(task?.lag_days ?? 0)
  const [status, setStatus] = useState<ScheduleTaskStatus>(task?.status ?? 'not_started')
  const [autoCascade, setAutoCascade] = useState(task?.auto_cascade ?? true)
  const [saving, setSaving] = useState(false)
  const [confirmedShift, setConfirmedShift] = useState(false)

  // Any of the three fields changing moves current_end_date once the DB's
  // sync trigger resolves it (start-only moves preserve duration and shift
  // end; duration-only moves shift end from the same start; explicit end
  // edits are used as-is) — all three paths fire the cascade trigger the
  // same way, so the warning has to cover all three, not just a direct
  // edit to the end-date field.
  const willMoveEndDate = isEdit && (
    startDate !== task!.current_start_date
    || durationDays !== task!.current_duration_days
    || endDate !== task!.current_end_date
  )
  const downstreamCount = willMoveEndDate ? countDownstream(allTasks, task!.id) : 0
  const needsShiftConfirm = willMoveEndDate && downstreamCount > 0 && !confirmedShift

  const predecessorOptions = allTasks
    .filter(t => t.id !== task?.id)
    .map(t => ({ id: t.id, label: t.title }))

  async function handleSave() {
    if (!title.trim()) { toast('A title is required', 'error'); return }
    if (needsShiftConfirm) return // caller must hit the confirm button first

    setSaving(true)
    if (isEdit) {
      const { error } = await supabase
        .from('schedule_tasks')
        .update({
          title: title.trim(),
          notes: notes.trim() || null,
          current_start_date: startDate,
          current_duration_days: durationDays,
          current_end_date: endDate,
          predecessor_task_id: predecessorId,
          lag_days: lagDays,
          status,
          auto_cascade: autoCascade,
        })
        .eq('id', task!.id)
      setSaving(false)
      if (error) { toast(error.message, 'error'); return }
      toast('Task updated', 'success')
    } else {
      const { error } = await supabase.from('schedule_tasks').insert([{
        schedule_id: scheduleId,
        display_order: nextDisplayOrder,
        title: title.trim(),
        notes: notes.trim() || null,
        current_start_date: startDate,
        current_duration_days: durationDays,
        predecessor_task_id: predecessorId,
        lag_days: lagDays,
        status,
        auto_cascade: autoCascade,
      }])
      setSaving(false)
      if (error) { toast(error.message, 'error'); return }
      toast('Task added', 'success')
    }
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-lg rounded-xl bg-white dark:bg-slate-800 p-5 shadow-xl space-y-3 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{isEdit ? 'Edit Task' : 'Add Task'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Title</label>
          <input className={inputCls} value={title} onChange={e => setTitle(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Start Date</label>
            <input type="date" className={inputCls} value={startDate} onChange={e => { setStartDate(e.target.value); setConfirmedShift(false) }} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Duration (working days)</label>
            <input type="number" min={1} className={inputCls} value={durationDays}
              onChange={e => { setDurationDays(Math.max(1, Number(e.target.value) || 1)); setConfirmedShift(false) }} />
          </div>
        </div>

        {isEdit && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">End Date</label>
            <input type="date" className={inputCls} value={endDate} onChange={e => { setEndDate(e.target.value); setConfirmedShift(false) }} />
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              Change duration OR end date — whichever you edit takes effect; the other recalculates once saved.
            </p>
          </div>
        )}

        {needsShiftConfirm && (
          <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 space-y-2">
            <p className="text-xs text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              This will also shift {downstreamCount} downstream task{downstreamCount === 1 ? '' : 's'} that depend on this one.
            </p>
            <button onClick={() => setConfirmedShift(true)}
              className="text-xs font-medium rounded-md bg-amber-600 px-3 py-1.5 text-white hover:bg-amber-700">
              Confirm, I understand
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Predecessor</label>
            <SearchableSelect value={predecessorId} onChange={setPredecessorId} options={predecessorOptions} placeholder="None" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Lag (working days)</label>
            <input type="number" min={0} className={inputCls} value={lagDays}
              disabled={!predecessorId} onChange={e => setLagDays(Math.max(0, Number(e.target.value) || 0))} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 items-end">
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Status</label>
            <select className={inputCls} value={status} onChange={e => setStatus(e.target.value as ScheduleTaskStatus)}>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 pb-1.5">
            <input type="checkbox" checked={autoCascade} onChange={e => setAutoCascade(e.target.checked)} />
            Auto-cascade dependents
          </label>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Notes</label>
          <textarea className={inputCls} rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-md px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={handleSave} disabled={saving || needsShiftConfirm}
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-60">
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Task'}
          </button>
        </div>
      </div>
    </div>
  )
}
