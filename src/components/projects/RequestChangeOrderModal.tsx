import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency } from '@/lib/utils'
import type { BoqTreeRow, BoqCoItemAction, BoqNodeType } from '@/types/database'
import { X, Plus, Trash2 } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-brand focus:border-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'

interface DiffRow {
  key: string
  action: BoqCoItemAction
  existingItemId: string | null
  parentItemId: string | null // existing item id this new node hangs under (add only)
  nodeType: BoqNodeType
  name: string
  unit: string
  quantity: string
  rate: string // line_item rate, or lump_sum's flat amount -- same field-reuse convention finalize_change_order uses
  notes: string
  isPricedElsewhere: boolean
}

function emptyRow(action: BoqCoItemAction): DiffRow {
  return {
    key: crypto.randomUUID(), action, existingItemId: null, parentItemId: null,
    nodeType: 'line_item', name: '', unit: '', quantity: '', rate: '', notes: '', isPricedElsewhere: false,
  }
}

// Approval tiers mirror set_boq_co_approval_level's live thresholds -- a
// client-side preview only; the trigger is the actual authority.
function tierFor(deltaAbs: number): { level: string; label: string } {
  if (deltaAbs <= 50000) return { level: 'pm_only', label: 'PM only' }
  if (deltaAbs <= 500000) return { level: 'pm_finance', label: 'PM + Finance' }
  return { level: 'pm_finance_exec', label: 'PM + Finance + Exec + client sign-off' }
}

interface Props {
  boqId: string
  tree: BoqTreeRow[]
  onClose: () => void
  onSubmitted: () => void
}

export function RequestChangeOrderModal({ boqId, tree, onClose, onSubmitted }: Props) {
  const { toast } = useToast()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [requestedByClient, setRequestedByClient] = useState(true)
  const [rows, setRows] = useState<DiffRow[]>([])
  const [submitting, setSubmitting] = useState(false)

  const itemById = useMemo(() => new Map(tree.map(t => [t.id, t])), [tree])
  const nonSectionItems = useMemo(() => tree.filter(t => t.node_type !== 'section'), [tree])
  const sectionItems = useMemo(() => tree.filter(t => t.node_type === 'section'), [tree])

  function addRow(action: BoqCoItemAction) {
    setRows(r => [...r, emptyRow(action)])
  }
  function updateRow(key: string, patch: Partial<DiffRow>) {
    setRows(r => r.map(row => row.key === key ? { ...row, ...patch } : row))
  }
  function removeRow(key: string) {
    setRows(r => r.filter(row => row.key !== key))
  }

  function rowDelta(row: DiffRow): number {
    if (row.action === 'add') {
      if (row.nodeType === 'line_item') return (Number(row.quantity) || 0) * (Number(row.rate) || 0)
      if (row.nodeType === 'lump_sum') return Number(row.rate) || 0
      return 0
    }
    const existing = row.existingItemId ? itemById.get(row.existingItemId) : null
    if (!existing) return 0
    const oldTotal = existing.total_etb ?? 0
    if (row.action === 'remove') return -oldTotal
    // modify
    if (existing.node_type === 'line_item') {
      const q = row.quantity !== '' ? Number(row.quantity) : (existing.quantity ?? 0)
      const rt = row.rate !== '' ? Number(row.rate) : (existing.unit_rate_etb ?? 0)
      return q * rt - oldTotal
    }
    if (existing.node_type === 'lump_sum') {
      const amt = row.rate !== '' ? Number(row.rate) : oldTotal
      return amt - oldTotal
    }
    return 0
  }

  const costDelta = rows.reduce((sum, r) => sum + rowDelta(r), 0)
  const tier = tierFor(Math.abs(costDelta))

  async function handleSubmit() {
    if (!title.trim()) { toast('A title is required', 'error'); return }
    if (rows.length === 0) { toast('Add at least one change', 'error'); return }
    for (const row of rows) {
      if (row.action !== 'add' && !row.existingItemId) { toast('Every modify/remove row needs a target item', 'error'); return }
      if (row.action === 'add' && !row.name.trim()) { toast('Every added item needs a name', 'error'); return }
    }

    setSubmitting(true)
    const items = rows.map(row => ({
      action: row.action,
      existing_item_id: row.action === 'add' ? null : row.existingItemId,
      parent_item_id: row.action === 'add' ? row.parentItemId : null,
      new_name: row.action === 'remove' ? null : (row.name.trim() || null),
      new_unit: row.action !== 'remove' && row.nodeType === 'line_item' ? (row.unit.trim() || null) : null,
      new_quantity: row.action !== 'remove' && row.nodeType === 'line_item' && row.quantity !== '' ? Number(row.quantity) : null,
      new_unit_rate_etb: row.action !== 'remove' && row.rate !== '' ? Number(row.rate) : null,
      new_notes: row.action === 'remove' ? null : (row.notes.trim() || null),
      new_node_type: row.action === 'add' ? row.nodeType : null,
      new_display_order: null,
      new_is_priced_elsewhere: row.action !== 'remove' ? row.isPricedElsewhere : null,
    }))

    const { error } = await supabase.rpc('submit_boq_change_order', {
      p_boq_id: boqId, p_title: title.trim(), p_description: description.trim() || null,
      p_requested_by_client: requestedByClient, p_cost_delta_etb: costDelta, p_items: items,
    })
    setSubmitting(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Change order submitted', 'success')
    onSubmitted()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-3xl rounded-xl bg-white dark:bg-slate-800 p-5 shadow-xl space-y-3 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Request Change Order</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X className="h-4 w-4" /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Title</label>
            <input className={inputCls} value={title} onChange={e => setTitle(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 self-end pb-1.5">
            <input type="checkbox" checked={requestedByClient} onChange={e => setRequestedByClient(e.target.checked)} />
            Client-initiated request
          </label>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Description</label>
          <textarea className={inputCls} rows={2} value={description} onChange={e => setDescription(e.target.value)} />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Item Changes</span>
          <div className="flex items-center gap-1.5">
            <button onClick={() => addRow('add')} className="flex items-center gap-1 text-xs text-brand hover:underline"><Plus className="h-3 w-3" /> Add</button>
            <button onClick={() => addRow('modify')} className="flex items-center gap-1 text-xs text-brand hover:underline"><Plus className="h-3 w-3" /> Modify</button>
            <button onClick={() => addRow('remove')} className="flex items-center gap-1 text-xs text-brand hover:underline"><Plus className="h-3 w-3" /> Remove</button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
          {rows.length === 0 && <p className="py-4 text-center text-xs text-slate-400">No changes added yet.</p>}
          {rows.map(row => (
            <div key={row.key} className="rounded-md border dark:border-slate-700 p-2.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{row.action}</span>
                <button onClick={() => removeRow(row.key)} className="text-slate-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>

              {row.action !== 'add' && (
                <select className={inputCls} value={row.existingItemId ?? ''} onChange={e => updateRow(row.key, { existingItemId: e.target.value || null })}>
                  <option value="">Select item…</option>
                  {nonSectionItems.map(i => (
                    <option key={i.id} value={i.id}>{'—'.repeat(i.depth - 1)} {i.name} ({formatCurrency(i.total_etb)})</option>
                  ))}
                </select>
              )}

              {row.action === 'add' && (
                <>
                  <select className={inputCls} value={row.parentItemId ?? ''} onChange={e => updateRow(row.key, { parentItemId: e.target.value || null })}>
                    <option value="">Parent section…</option>
                    {sectionItems.map(i => (
                      <option key={i.id} value={i.id}>{'—'.repeat(i.depth - 1)} {i.name}</option>
                    ))}
                  </select>
                  <select className={inputCls} value={row.nodeType} onChange={e => updateRow(row.key, { nodeType: e.target.value as BoqNodeType })}>
                    <option value="section">Section</option>
                    <option value="line_item">Line Item</option>
                    <option value="lump_sum">Lump Sum</option>
                  </select>
                </>
              )}

              {row.action !== 'remove' && (
                <>
                  <input className={inputCls} placeholder="Name (leave blank to keep current, if modifying)" value={row.name} onChange={e => updateRow(row.key, { name: e.target.value })} />
                  {(row.action === 'add' ? row.nodeType === 'line_item' : itemById.get(row.existingItemId ?? '')?.node_type === 'line_item') && (
                    <div className="grid grid-cols-3 gap-1.5">
                      <input className={inputCls} placeholder="Unit" value={row.unit} onChange={e => updateRow(row.key, { unit: e.target.value })} />
                      <input type="number" className={inputCls} placeholder="Qty" value={row.quantity} onChange={e => updateRow(row.key, { quantity: e.target.value })} />
                      <input type="number" className={inputCls} placeholder="Rate" value={row.rate} onChange={e => updateRow(row.key, { rate: e.target.value })} />
                    </div>
                  )}
                  {(row.action === 'add' ? row.nodeType === 'lump_sum' : itemById.get(row.existingItemId ?? '')?.node_type === 'lump_sum') && (
                    <input type="number" className={inputCls} placeholder="Total amount" value={row.rate} onChange={e => updateRow(row.key, { rate: e.target.value })} />
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-slate-400">Effect on cost: {formatCurrency(rowDelta(row))}</span>
                  </div>
                </>
              )}
              {row.action === 'remove' && (
                <span className="text-[11px] text-slate-400">Effect on cost: {formatCurrency(rowDelta(row))}</span>
              )}
            </div>
          ))}
        </div>

        <div className="rounded-md bg-slate-50 dark:bg-slate-700/30 border dark:border-slate-700 p-3 flex items-center justify-between text-xs">
          <span className="text-slate-500 dark:text-slate-400">Net cost delta</span>
          <div className="text-right">
            <p className={`font-semibold ${costDelta > 0 ? 'text-red-600 dark:text-red-400' : costDelta < 0 ? 'text-green-600 dark:text-green-400' : 'text-slate-700 dark:text-slate-200'}`}>
              {costDelta >= 0 ? '+' : ''}{formatCurrency(costDelta)}
            </p>
            <p className="text-slate-400">Requires: {tier.label}</p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-md px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={handleSubmit} disabled={submitting}
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-60">
            {submitting ? 'Submitting…' : 'Submit Change Order'}
          </button>
        </div>
      </div>
    </div>
  )
}
