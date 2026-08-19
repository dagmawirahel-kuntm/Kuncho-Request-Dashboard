import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useMyStaffId } from '@/hooks/useMyStaff'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { ImportBoqModal } from './ImportBoqModal'
import { BoqItemFormModal } from './BoqItemFormModal'
import { RequestChangeOrderModal } from './RequestChangeOrderModal'
import { BoqVersionHistoryModal } from './BoqVersionHistoryModal'
import type { Boq, BoqItem, BoqTreeRow } from '@/types/database'
import { FileText, Upload, Plus, Pencil, Trash2, ChevronUp, ChevronDown, Lock, AlertTriangle, ListTree, FileEdit, History } from 'lucide-react'

interface Props {
  projectId: string
  projectName: string
}

export function BoqSection({ projectId, projectName }: Props) {
  const { toast } = useToast()
  const { role } = useAuth()
  const { data: myStaff } = useMyStaffId()
  const qc = useQueryClient()

  const [showImport, setShowImport] = useState(false)
  const [addingUnder, setAddingUnder] = useState<string | null | 'root'>(null) // parent_item_id, or 'root'
  const [editingItem, setEditingItem] = useState<BoqItem | null>(null)
  const [approving, setApproving] = useState(false)
  const [creatingManually, setCreatingManually] = useState(false)
  const [showRequestCO, setShowRequestCO] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const { data: boq, isLoading: boqLoading } = useQuery({
    queryKey: ['project-boq', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('boqs')
        .select('*, staff:owner_pm_staff_id(employee_name)')
        .eq('project_id', projectId)
        .order('version_number', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data as (Boq & { staff: { employee_name: string } | null }) | null
    },
  })

  const { data: tree = [] } = useQuery({
    queryKey: ['boq-tree', boq?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('v_boq_tree', { p_boq_id: boq!.id })
      if (error) throw error
      return (data ?? []) as BoqTreeRow[]
    },
    enabled: !!boq?.id,
  })

  const isOwnerPm = !!boq && !!myStaff?.id && myStaff.id === boq.owner_pm_staff_id
  const canManage = !!boq && (role === 'admin' || isOwnerPm) && (boq.status === 'draft' || boq.status === 'internal_review')
  const canCreate = role === 'admin' || role === 'project_manager' || role === 'operations_manager' || role === 'design' || role === 'finance' || role === 'procurement_officer'
  // Matches submit_boq_change_order's own role check exactly (212/9a) --
  // not project-owner-scoped at the RLS layer, so the UI gate isn't either.
  const canRequestCO = !!boq && boq.status === 'approved' &&
    (role === 'admin' || role === 'project_manager' || role === 'operations_manager' || role === 'design')

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ['project-boq', projectId] })
    qc.invalidateQueries({ queryKey: ['boq-tree', boq?.id] })
  }

  async function handleCreateManually() {
    if (!myStaff?.id) { toast('Your account is not linked to a staff record', 'error'); return }
    setCreatingManually(true)
    const { error } = await supabase.from('boqs').insert([{
      project_id: projectId, version_number: 1, title: `${projectName} BOQ`,
      status: 'draft', owner_pm_staff_id: myStaff.id, created_by_staff_id: myStaff.id,
    }])
    setCreatingManually(false)
    if (error) { toast(error.message, 'error'); return }
    invalidateAll()
    toast('Draft BOQ created — start adding sections and items', 'success')
  }

  async function handleApprove() {
    if (!boq || !myStaff?.id) return
    if (!window.confirm('Approve this BOQ? Once approved, items can only be revised via a change order.')) return
    setApproving(true)
    const { error } = await supabase.from('boqs').update({
      status: 'approved', approved_at: new Date().toISOString(), approved_by_staff_id: myStaff.id,
    }).eq('id', boq.id)
    setApproving(false)
    if (error) { toast(error.message, 'error'); return }
    invalidateAll()
    toast('BOQ approved', 'success')
  }

  async function handleDelete(item: BoqTreeRow) {
    const hasChildren = tree.some(t => t.parent_item_id === item.id)
    if (hasChildren) { toast('Delete or move child items first', 'error'); return }
    if (!window.confirm(`Delete "${item.name}"?`)) return
    const { error } = await supabase.from('boq_items').delete().eq('id', item.id)
    if (error) { toast(error.message, 'error'); return }
    invalidateAll()
    toast('Item deleted', 'success')
  }

  async function handleMove(item: BoqTreeRow, direction: 'up' | 'down') {
    const siblings = tree
      .filter(t => t.parent_item_id === item.parent_item_id)
      .sort((a, b) => a.display_order - b.display_order)
    const idx = siblings.findIndex(s => s.id === item.id)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= siblings.length) return
    const other = siblings[swapIdx]
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from('boq_items').update({ display_order: other.display_order }).eq('id', item.id),
      supabase.from('boq_items').update({ display_order: item.display_order }).eq('id', other.id),
    ])
    if (e1 || e2) { toast((e1 ?? e2)!.message, 'error'); return }
    invalidateAll()
  }

  function nextDisplayOrderFor(parentItemId: string | null): number {
    const siblings = tree.filter(t => t.parent_item_id === parentItemId)
    return siblings.length > 0 ? Math.max(...siblings.map(s => s.display_order)) + 1 : 1
  }

  if (boqLoading) {
    return <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm text-sm text-slate-400">Loading BOQ…</div>
  }

  return (
    <div id="boq" className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm space-y-4 scroll-mt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
          <FileText className="h-4 w-4" /> Bill of Quantities
        </h3>
        {boq && (
          <div className="flex items-center gap-2">
            <StatusBadge status={boq.status} />
            <button onClick={() => setShowHistory(true)}
              className="flex items-center gap-1 rounded-md border dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
              <History className="h-3.5 w-3.5" /> History
            </button>
            {canManage && (
              <>
                <button onClick={() => setShowImport(true)}
                  className="flex items-center gap-1 rounded-md border dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
                  <Upload className="h-3.5 w-3.5" /> Re-import
                </button>
                <button onClick={handleApprove} disabled={approving || tree.length === 0}
                  title={tree.length === 0 ? 'Add at least one item first' : undefined}
                  className="flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-60">
                  <Lock className="h-3.5 w-3.5" /> {approving ? 'Approving…' : 'Approve'}
                </button>
              </>
            )}
            {canRequestCO && (
              <button onClick={() => setShowRequestCO(true)}
                className="flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90">
                <FileEdit className="h-3.5 w-3.5" /> Request Change Order
              </button>
            )}
          </div>
        )}
      </div>

      {!boq && (
        <div className="rounded-md border border-dashed dark:border-slate-600 p-6 text-center space-y-3">
          <p className="text-sm text-slate-500 dark:text-slate-400">No BOQ yet for this project.</p>
          {canCreate ? (
            <div className="flex items-center justify-center gap-2">
              <button onClick={() => setShowImport(true)}
                className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
                <Upload className="h-4 w-4" /> Import from Excel
              </button>
              <button onClick={handleCreateManually} disabled={creatingManually}
                className="flex items-center gap-1.5 rounded-md border dark:border-slate-600 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60">
                <ListTree className="h-4 w-4" /> {creatingManually ? 'Creating…' : 'Create Manually'}
              </button>
            </div>
          ) : (
            <p className="text-xs text-slate-400">Only a PM, admin, or contributor role can build one.</p>
          )}
        </div>
      )}

      {boq && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-medium text-slate-700 dark:text-slate-200">{boq.title}</span>
            <span>v{boq.version_number}</span>
            <span>PM: {boq.staff?.employee_name ?? '—'}</span>
            <span className="font-medium text-slate-700 dark:text-slate-200">{formatCurrency(boq.grand_total_etb)}</span>
          </div>

          {boq.status === 'approved' && (
            <div className="rounded-md bg-slate-50 dark:bg-slate-700/30 border dark:border-slate-700 p-3 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                This BOQ is approved and read-only. Revisions go through a change order.
              </p>
            </div>
          )}

          {canManage && (
            <button onClick={() => setAddingUnder('root')}
              className="flex items-center gap-1 text-xs font-medium text-brand hover:underline">
              <Plus className="h-3.5 w-3.5" /> Add Root Section
            </button>
          )}

          {tree.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">No items yet.</p>
          ) : (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-400 dark:text-slate-500 border-b dark:border-slate-700">
                    <th className="py-1.5 px-1 font-medium">Name</th>
                    <th className="py-1.5 px-1 font-medium">Unit</th>
                    <th className="py-1.5 px-1 font-medium text-right">Qty</th>
                    <th className="py-1.5 px-1 font-medium text-right">Rate</th>
                    <th className="py-1.5 px-1 font-medium text-right">Total</th>
                    <th className="py-1.5 px-1 font-medium text-right">Weight</th>
                    <th className="py-1.5 px-1 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-slate-700">
                  {tree.map(item => (
                    <tr key={item.id}>
                      <td className="py-1.5 px-1 text-slate-700 dark:text-slate-200" style={{ paddingLeft: `${4 + (item.depth - 1) * 16}px` }}>
                        <span className={item.node_type === 'section' ? 'font-semibold' : ''}>{item.name}</span>
                        {item.is_priced_elsewhere && <span className="ml-1.5 text-[10px] text-amber-600 dark:text-amber-400">priced elsewhere</span>}
                      </td>
                      <td className="py-1.5 px-1 text-slate-500 dark:text-slate-400">{item.unit ?? '—'}</td>
                      <td className="py-1.5 px-1 text-right text-slate-500 dark:text-slate-400">{item.quantity ?? '—'}</td>
                      <td className="py-1.5 px-1 text-right text-slate-500 dark:text-slate-400">{item.unit_rate_etb != null ? formatCurrency(item.unit_rate_etb) : '—'}</td>
                      <td className="py-1.5 px-1 text-right text-slate-700 dark:text-slate-200">{item.node_type === 'section' ? '—' : formatCurrency(item.total_etb)}</td>
                      <td className="py-1.5 px-1 text-right text-slate-400">{item.node_type === 'section' ? '—' : `${item.weight_pct.toFixed(1)}%`}</td>
                      <td className="py-1.5 px-1">
                        {canManage && (
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => handleMove(item, 'up')} title="Move up" className="text-slate-400 hover:text-brand"><ChevronUp className="h-3.5 w-3.5" /></button>
                            <button onClick={() => handleMove(item, 'down')} title="Move down" className="text-slate-400 hover:text-brand"><ChevronDown className="h-3.5 w-3.5" /></button>
                            {item.node_type === 'section' && (
                              <button onClick={() => setAddingUnder(item.id)} title="Add child" className="text-slate-400 hover:text-brand"><Plus className="h-3.5 w-3.5" /></button>
                            )}
                            <button onClick={() => setEditingItem(item as unknown as BoqItem)} title="Edit" className="text-slate-400 hover:text-brand"><Pencil className="h-3.5 w-3.5" /></button>
                            <button onClick={() => handleDelete(item)} title="Delete" className="text-slate-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {showImport && (
        <ImportBoqModal
          projectId={projectId}
          defaultTitle={boq ? boq.title : `${projectName} BOQ`}
          replaceBoqId={boq && (boq.status === 'draft' || boq.status === 'internal_review') ? boq.id : null}
          onClose={() => setShowImport(false)}
          onImported={() => invalidateAll()}
        />
      )}

      {addingUnder !== null && boq && (
        <BoqItemFormModal
          boqId={boq.id}
          parentItemId={addingUnder === 'root' ? null : addingUnder}
          item={null}
          nextDisplayOrder={nextDisplayOrderFor(addingUnder === 'root' ? null : addingUnder)}
          onClose={() => setAddingUnder(null)}
          onSaved={invalidateAll}
        />
      )}

      {editingItem && boq && (
        <BoqItemFormModal
          boqId={boq.id}
          parentItemId={editingItem.parent_item_id}
          item={editingItem}
          nextDisplayOrder={editingItem.display_order}
          onClose={() => setEditingItem(null)}
          onSaved={invalidateAll}
        />
      )}

      {showRequestCO && boq && (
        <RequestChangeOrderModal
          boqId={boq.id}
          tree={tree}
          onClose={() => setShowRequestCO(false)}
          onSubmitted={invalidateAll}
        />
      )}

      {showHistory && (
        <BoqVersionHistoryModal projectId={projectId} onClose={() => setShowHistory(false)} />
      )}
    </div>
  )
}
