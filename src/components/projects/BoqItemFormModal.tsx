import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import type { BoqItem, BoqNodeType } from '@/types/database'
import { X } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'

interface Props {
  boqId: string
  parentItemId: string | null
  item: BoqItem | null // edit mode when set
  nextDisplayOrder: number
  onClose: () => void
  onSaved: () => void
}

export function BoqItemFormModal({ boqId, parentItemId, item, nextDisplayOrder, onClose, onSaved }: Props) {
  const { toast } = useToast()
  const [nodeType, setNodeType] = useState<BoqNodeType>(item?.node_type ?? (parentItemId ? 'line_item' : 'section'))
  const [name, setName] = useState(item?.name ?? '')
  const [notes, setNotes] = useState(item?.notes ?? '')
  const [unit, setUnit] = useState(item?.unit ?? '')
  const [quantity, setQuantity] = useState(item?.quantity != null ? String(item.quantity) : '')
  const [rate, setRate] = useState(item?.unit_rate_etb != null ? String(item.unit_rate_etb) : '')
  const [lumpTotal, setLumpTotal] = useState(item?.total_etb != null ? String(item.total_etb) : '')
  const [isPricedElsewhere, setIsPricedElsewhere] = useState(item?.is_priced_elsewhere ?? false)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!name.trim()) { toast('Name is required', 'error'); return }
    if (nodeType === 'line_item' && !isPricedElsewhere && !rate.trim()) {
      toast('A rate is required unless this item is priced elsewhere', 'error'); return
    }
    if (nodeType === 'line_item' && !quantity.trim()) { toast('Quantity is required', 'error'); return }
    if (nodeType === 'lump_sum' && !lumpTotal.trim()) { toast('A total is required for a lump sum', 'error'); return }

    setSaving(true)
    const payload = {
      node_type: nodeType,
      name: name.trim(),
      notes: notes.trim() || null,
      unit: nodeType === 'line_item' ? (unit.trim() || null) : null,
      quantity: nodeType === 'line_item' ? Number(quantity) : null,
      unit_rate_etb: nodeType === 'line_item' ? (isPricedElsewhere ? 0 : Number(rate)) : null,
      total_etb: nodeType === 'lump_sum' ? Number(lumpTotal) : null,
      is_priced_elsewhere: nodeType === 'line_item' ? isPricedElsewhere : false,
    }

    const { error } = item
      ? await supabase.from('boq_items').update(payload).eq('id', item.id)
      : await supabase.from('boq_items').insert([{ ...payload, boq_id: boqId, parent_item_id: parentItemId, display_order: nextDisplayOrder }])

    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast(item ? 'Item updated' : 'Item added', 'success')
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-800 p-5 shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{item ? 'Edit Item' : 'Add Item'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Type</label>
          <select className={inputCls} value={nodeType} disabled={!!item} onChange={e => setNodeType(e.target.value as BoqNodeType)}>
            <option value="section">Section (grouping only, no cost)</option>
            <option value="line_item">Line Item (qty × rate)</option>
            <option value="lump_sum">Lump Sum (flat total)</option>
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Name</label>
          <input className={inputCls} value={name} onChange={e => setName(e.target.value)} />
        </div>

        {nodeType === 'line_item' && (
          <>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Unit</label>
                <input className={inputCls} value={unit} onChange={e => setUnit(e.target.value)} placeholder="m², pcs…" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Quantity</label>
                <input type="number" className={inputCls} value={quantity} onChange={e => setQuantity(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Rate (ETB)</label>
                <input type="number" className={inputCls} value={rate} onChange={e => setRate(e.target.value)} disabled={isPricedElsewhere} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={isPricedElsewhere} onChange={e => setIsPricedElsewhere(e.target.checked)} />
              Priced elsewhere (quantity tracked here, cost is in a lump sum)
            </label>
          </>
        )}

        {nodeType === 'lump_sum' && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Total (ETB)</label>
            <input type="number" className={inputCls} value={lumpTotal} onChange={e => setLumpTotal(e.target.value)} />
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Notes</label>
          <textarea className={inputCls} rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-md px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-60">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
