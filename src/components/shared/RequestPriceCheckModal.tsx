import { useState } from 'react'
import { X } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import { useRequestPriceCheck } from '@/hooks/useMarketPrices'
import { useProjects } from '@/hooks/useLookups'
import { SearchableSelect } from '@/components/shared/SearchableSelect'

interface Props {
  stockItem: { id: string; item_name: string }
  onClose: () => void
  defaultProjectId?: string | null
  orderItemId?: string
}

export function RequestPriceCheckModal({ stockItem, onClose, defaultProjectId, orderItemId }: Props) {
  const { toast } = useToast()
  const req = useRequestPriceCheck()
  const { data: projects = [] } = useProjects()
  const [projectId, setProjectId] = useState<string | null>(defaultProjectId ?? null)
  const [reason, setReason] = useState('')
  const [neededBy, setNeededBy] = useState('')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const projectOptions = projects.map((p: any) => ({ id: p.id, label: p.project_name }))

  async function handleSave() {
    try {
      await req.mutateAsync({
        stock_item_id: stockItem.id,
        project_id: projectId,
        reason,
        needed_by: neededBy || undefined,
        order_item_id: orderItemId,
      })
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
            <p className="text-[11px] text-slate-500 mt-0.5">{stockItem.item_name}</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>
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
