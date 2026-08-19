import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { X, Search } from 'lucide-react'

interface BoqTreeRow {
  id: string
  node_type: 'section' | 'line_item' | 'lump_sum'
  name: string
  depth: number
  total_etb: number
}

interface Props {
  scheduleId: string
  taskId: string
  boqId: string
  alreadyLinkedIds: string[]
  onClose: () => void
}

export function LinkBoqItemsModal({ scheduleId, taskId, boqId, alreadyLinkedIds, onClose }: Props) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  const { data: tree = [], isLoading } = useQuery({
    queryKey: ['boq-tree', boqId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('v_boq_tree', { p_boq_id: boqId })
      if (error) throw error
      return (data ?? []) as BoqTreeRow[]
    },
  })

  const leaves = useMemo(
    () => tree.filter(n => n.node_type !== 'section' && (!search || n.name.toLowerCase().includes(search.toLowerCase()))),
    [tree, search]
  )

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function handleLink() {
    if (selected.size === 0) { onClose(); return }
    setSaving(true)
    const { error } = await supabase.rpc('link_boq_items_to_task', {
      p_task_id: taskId,
      p_boq_item_ids: Array.from(selected),
    })
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['schedule-task-boq-link-counts', scheduleId] })
    toast(`Linked ${selected.size} item${selected.size === 1 ? '' : 's'}`, 'success')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-lg rounded-xl bg-white dark:bg-slate-800 p-5 shadow-xl space-y-3 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Link BOQ Items</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X className="h-4 w-4" /></button>
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input
            className="w-full rounded-md border pl-8 pr-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
            placeholder="Search items…" value={search} onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="flex-1 overflow-y-auto border rounded-md dark:border-slate-700 divide-y dark:divide-slate-700">
          {isLoading ? (
            <div className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
          ) : leaves.length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">No items found</div>
          ) : (
            leaves.map(item => {
              const alreadyLinked = alreadyLinkedIds.includes(item.id)
              return (
                <label key={item.id}
                  className={`flex items-center gap-2 px-3 py-2 text-sm ${alreadyLinked ? 'opacity-50' : 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40'}`}
                  style={{ paddingLeft: `${8 + (item.depth - 1) * 12}px` }}>
                  <input type="checkbox" disabled={alreadyLinked}
                    checked={alreadyLinked || selected.has(item.id)}
                    onChange={() => toggle(item.id)} />
                  <span className="flex-1 truncate text-slate-700 dark:text-slate-200">{item.name}</span>
                  {alreadyLinked && <span className="text-[11px] text-slate-400">already linked</span>}
                </label>
              )
            })
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-md px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={handleLink} disabled={saving}
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-60">
            {saving ? 'Linking…' : `Link ${selected.size || ''}`.trim()}
          </button>
        </div>
      </div>
    </div>
  )
}
