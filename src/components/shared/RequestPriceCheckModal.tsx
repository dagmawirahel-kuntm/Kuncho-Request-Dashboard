import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { useRequestPriceCheck } from '@/hooks/useMarketPrices'
import { useProjects } from '@/hooks/useLookups'
import { SearchableSelect } from '@/components/shared/SearchableSelect'

type Mode = 'stock_item' | 'sub_category' | 'new_item'

interface Props {
  // When called from an item detail panel, the stock_item is already pinned
  // and only stock_item mode is available. When called generically (Market
  // Trends header), all three modes are offered.
  stockItem?: { id: string; item_name: string }
  onClose: () => void
  defaultProjectId?: string | null
  orderItemId?: string
}

// Three modes, sharing the same request table:
//   * stock_item   → existing (pinned when opened from an item card)
//   * sub_category → survey the category (e.g. "paint") without a specific item
//   * new_item     → free-text description + sub-category — Procurement logs a
//                    quote without adding the item to the stock catalog
export function RequestPriceCheckModal({ stockItem, onClose, defaultProjectId, orderItemId }: Props) {
  const { toast } = useToast()
  const req = useRequestPriceCheck()
  const { data: projects = [] } = useProjects()
  const [mode, setMode] = useState<Mode>(stockItem ? 'stock_item' : 'sub_category')
  const [projectId, setProjectId] = useState<string | null>(defaultProjectId ?? null)
  const [reason, setReason] = useState('')
  const [neededBy, setNeededBy] = useState('')
  // For sub_category / new_item modes:
  const [subCategoryId, setSubCategoryId] = useState<string | null>(null)
  const [itemDescription, setItemDescription] = useState('')
  // For a stock_item picker when not pre-pinned:
  const [stockItemId, setStockItemId] = useState<string | null>(stockItem?.id ?? null)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const projectOptions = projects.map((p: any) => ({ id: p.id, label: p.project_name }))

  const { data: subCats = [] } = useQuery({
    enabled: mode !== 'stock_item',
    queryKey: ['sub-categories-active'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('sub_categories').select('id, item_name').eq('active', true).order('item_name')
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return data as any[]
    },
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subCatOptions = subCats.map((s: any) => ({ id: s.id, label: s.item_name }))

  const { data: stockItems = [] } = useQuery({
    enabled: mode === 'stock_item' && !stockItem,
    queryKey: ['stock-items-picker'],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_items').select('id, item_name, item_code').eq('active', true).order('item_name')
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return data as any[]
    },
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stockItemOptions = stockItems.map((s: any) => ({ id: s.id, label: s.item_name, sub: s.item_code }))

  async function handleSave() {
    try {
      if (mode === 'stock_item') {
        const id = stockItem?.id ?? stockItemId
        if (!id) { toast('Pick an item', 'error'); return }
        await req.mutateAsync({ stock_item_id: id, project_id: projectId, reason, needed_by: neededBy || undefined, order_item_id: orderItemId })
      } else if (mode === 'sub_category') {
        if (!subCategoryId) { toast('Pick a sub-category', 'error'); return }
        await req.mutateAsync({ sub_category_id: subCategoryId, project_id: projectId, reason, needed_by: neededBy || undefined })
      } else {
        if (!subCategoryId) { toast('Pick a sub-category for the new item', 'error'); return }
        if (!itemDescription.trim()) { toast('Describe the item', 'error'); return }
        await req.mutateAsync({
          sub_category_id: subCategoryId,
          item_description: itemDescription.trim(),
          project_id: projectId,
          reason, needed_by: neededBy || undefined,
        })
      }
      toast('Price check requested', 'success')
      onClose()
    } catch (e) { toast((e as Error).message, 'error') }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-800 shadow-xl border dark:border-slate-700 p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Request market price check</h3>
            {stockItem && <p className="text-[11px] text-slate-500 mt-0.5">{stockItem.item_name}</p>}
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>

        {/* Mode selector — only when the modal isn't pinned to a specific item */}
        {!stockItem && (
          <div className="grid grid-cols-3 gap-1.5">
            {(['stock_item', 'sub_category', 'new_item'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`text-xs rounded-md border px-2 py-1.5 capitalize ${
                  mode === m ? 'border-brand bg-brand/5 text-brand dark:bg-brand/10' : 'border-slate-200 text-slate-600 dark:border-slate-600 dark:text-slate-300'
                }`}
              >{m.replace('_', ' ')}</button>
            ))}
          </div>
        )}

        {mode === 'stock_item' && !stockItem && (
          <div>
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Stock item *</label>
            <SearchableSelect value={stockItemId} onChange={setStockItemId} options={stockItemOptions} placeholder="Search catalog…" />
          </div>
        )}

        {(mode === 'sub_category' || mode === 'new_item') && (
          <div>
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Sub-category *</label>
            <SearchableSelect value={subCategoryId} onChange={setSubCategoryId} options={subCatOptions} placeholder="Pick category…" />
          </div>
        )}

        {mode === 'new_item' && (
          <div>
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Item description *</label>
            <input value={itemDescription} onChange={e => setItemDescription(e.target.value)}
              placeholder="e.g. Nippon 20L water-based ivory paint"
              className="w-full mt-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
            <p className="mt-1 text-[10px] text-slate-400">Free-text — this quote lives on the request, not the stock catalog.</p>
          </div>
        )}

        <div>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Project</label>
          <SearchableSelect value={projectId} onChange={setProjectId} options={projectOptions} placeholder="Optional — which project needs this…" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Reason</label>
          <textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder="Why do you want a fresh check?"
            className="w-full mt-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Needed by</label>
          <input type="date" value={neededBy} onChange={e => setNeededBy(e.target.value)}
            className="w-full mt-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-md border dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={handleSave} disabled={req.isPending} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-60">
            {req.isPending ? 'Sending…' : 'Send request'}
          </button>
        </div>
      </div>
    </div>
  )
}
