import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency } from '@/lib/utils'
import { computeMilestoneAmounts, type ContractTerms } from '@/lib/milestoneAmounts'
import type { PaymentMilestone } from '@/types/database'
import { X } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'

interface Props {
  contractId: string
  projectId: string
  terms: ContractTerms
  milestone: PaymentMilestone | null
  nextSequence: number
  myStaffId: string | null
  onClose: () => void
  onSaved: () => void
}

export function MilestoneFormModal({
  contractId, projectId, terms, milestone, nextSequence, myStaffId, onClose, onSaved,
}: Props) {
  const { toast } = useToast()
  const [title, setTitle] = useState(milestone?.title ?? '')
  const [sequence, setSequence] = useState<number>(milestone?.sequence_number ?? nextSequence)
  const [percent, setPercent] = useState<string>(
    milestone ? String(milestone.percent_of_contract_value) : ''
  )
  const [saving, setSaving] = useState(false)

  const pct = parseFloat(percent)
  const validPct = !isNaN(pct) && pct > 0 && pct <= 100
  // Preview only — the trigger computes the stored values on save.
  const preview = computeMilestoneAmounts(terms, validPct ? pct : 0)

  async function handleSave() {
    if (!title.trim()) { toast('A title is required', 'error'); return }
    if (!validPct) { toast('Percentage must be greater than 0 and at most 100', 'error'); return }
    setSaving(true)

    const payload = {
      contract_id: contractId,
      project_id: projectId,
      sequence_number: sequence,
      title: title.trim(),
      percent_of_contract_value: pct,
    }

    const { error } = milestone
      ? await supabase.from('payment_milestones').update(payload).eq('id', milestone.id)
      : await supabase.from('payment_milestones').insert([{ ...payload, created_by_staff_id: myStaffId }])

    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast(milestone ? 'Milestone updated' : 'Milestone added', 'success')
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-800 p-5 shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            {milestone ? 'Edit Milestone' : 'Add Milestone'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <label className="text-xs text-slate-500 dark:text-slate-400">Title</label>
            <input className={inputCls} value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Structural Completion" />
          </div>
          <div>
            <label className="text-xs text-slate-500 dark:text-slate-400">Sequence</label>
            <input type="number" min={1} className={inputCls} value={sequence}
              onChange={e => setSequence(parseInt(e.target.value) || 1)} />
          </div>
        </div>

        <div>
          <label className="text-xs text-slate-500 dark:text-slate-400">% of contract value</label>
          <input type="number" step="0.01" min="0.01" max="100" className={inputCls} value={percent}
            onChange={e => setPercent(e.target.value)} placeholder="e.g. 30" />
        </div>

        <div className="rounded-md border dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-3 space-y-1 text-xs">
          <Row label="Gross (invoiced)" value={preview.gross} strong />
          {terms.contract_value_includes_vat && (
            <Row label="Less VAT → base for deductions" value={preview.grossExclVat} muted />
          )}
          <Row label={`Retention (${terms.retention_percent ?? 0}%)`} value={-preview.retention} />
          <Row
            label={preview.whtApplies ? `WHT (${terms.wht_rate ?? 3}%)` : 'WHT (contract under 20,000 — none)'}
            value={-preview.wht}
          />
          <div className="border-t dark:border-slate-700 pt-1">
            <Row label="Net payable" value={preview.net} strong />
          </div>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 pt-1">
            Preview only — final amounts are computed by the database on save.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button onClick={onClose}
            className="rounded-md px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-60">
            {saving ? 'Saving…' : milestone ? 'Save' : 'Add Milestone'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, strong, muted }: { label: string; value: number; strong?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={muted ? 'text-slate-400 dark:text-slate-500' : 'text-slate-500 dark:text-slate-400'}>{label}</span>
      <span className={`tabular-nums ${strong ? 'font-semibold text-slate-800 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300'}`}>
        {formatCurrency(value)}
      </span>
    </div>
  )
}
