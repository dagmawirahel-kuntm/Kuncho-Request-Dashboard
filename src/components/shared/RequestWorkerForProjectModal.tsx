import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { useProjects } from '@/hooks/useLookups'
import { SearchableSelect } from '@/components/shared/SearchableSelect'

interface Props {
  worker: { id: string; employee_name: string; role?: string | null; day_rate?: number | null }
  onClose: () => void
}

// Roster-driven labor request: a PM picks a specific person off the roster
// and hits "Request for project". Backend fills the requisition with
// specific_staff_id — on HR approval the trigger auto-creates a planned
// labor_allocation for that person on that project, so the timesheet →
// rollup → payment pipeline picks them up without any extra manual step.
export function RequestWorkerForProjectModal({ worker, onClose }: Props) {
  const { toast } = useToast()
  const { user } = useAuth()
  const qc = useQueryClient()
  const { data: projects = [] } = useProjects()
  const [projectId, setProjectId] = useState<string | null>(null)
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10))
  const [endDate, setEndDate]     = useState<string>('')
  const [days, setDays]           = useState<string>('7')
  const [basis, setBasis]         = useState<'per_day' | 'per_volume'>('per_day')
  const [dayRate, setDayRate]     = useState<string>(worker.day_rate != null ? String(worker.day_rate) : '')
  const [volumeUnit, setVolumeUnit] = useState('m²')
  const [unitRate, setUnitRate]     = useState<string>('')
  const [notes, setNotes]         = useState('')
  const [saving, setSaving]       = useState(false)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const projectOptions = useMemo(() => projects.map((p: any) => ({ id: p.id, label: p.project_name })), [projects])

  async function handleSave() {
    if (!projectId) { toast('Pick a project', 'error'); return }
    setSaving(true)
    const payload = {
      project_id: projectId,
      specific_staff_id: worker.id,
      role_needed: worker.role ?? 'Worker',
      headcount: 1,
      is_casual_or_new: false,
      start_date: startDate,
      end_date: endDate || null,
      estimated_day_rate: basis === 'per_day' ? Number(dayRate) || 0 : Number(unitRate) || 0,
      estimated_days: days ? Number(days) : null,
      payment_basis: basis,
      payment_model: 'individual',
      pay_cycle: 'weekly',
      volume_unit: basis === 'per_volume' ? volumeUnit : null,
      unit_rate: basis === 'per_volume' ? (Number(unitRate) || null) : null,
      requested_by: user?.id ?? null,
      notes: notes ? `${notes} (roster request for ${worker.employee_name})` : `Roster request for ${worker.employee_name}`,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from('labor_requisitions').insert([payload as any])
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['labor-requisitions'] })
    toast('Request submitted — awaiting HR approval', 'success')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white dark:bg-slate-800 shadow-2xl border dark:border-slate-700 p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Request {worker.employee_name} for a project</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">Creates a labor requisition targeting this specific person. HR approval auto-allocates them.</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>

        <div>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Project *</label>
          <SearchableSelect value={projectId} onChange={setProjectId} options={projectOptions} placeholder="Select project…" />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Start *</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">End</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Est. days</label>
            <input type="number" min="0" value={days} onChange={e => setDays(e.target.value)} className={inputCls} />
          </div>
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
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Day rate (ETB) *</label>
            <input type="number" step="0.01" min="0" value={dayRate} onChange={e => setDayRate(e.target.value)} className={inputCls} />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Volume unit *</label>
              <input value={volumeUnit} onChange={e => setVolumeUnit(e.target.value)} placeholder="m² · pcs · lm" className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Unit rate (ETB/{volumeUnit || 'unit'}) *</label>
              <input type="number" step="0.01" min="0" value={unitRate} onChange={e => setUnitRate(e.target.value)} className={inputCls} />
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
