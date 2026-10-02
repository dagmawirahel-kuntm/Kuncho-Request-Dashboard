import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useMyStaffId } from '@/hooks/useMyStaff'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { ImportBoqModal } from './ImportBoqModal'
import { BoqSheet } from './BoqSheet'
import { BoqStart } from './BoqStart'
import { BoqVersionHistoryModal } from './BoqVersionHistoryModal'
import { downloadCsv } from '@/lib/csvExport'
import type { Boq, BoqTreeRow, BoqFlatRow, BoqProcurementSpecRow } from '@/types/database'
import { FileText, Upload, Lock, AlertTriangle, ListTree, FileEdit, History, Table2, PackageSearch, Download } from 'lucide-react'

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
  const [approving, setApproving] = useState(false)
  const [creatingManually, setCreatingManually] = useState(false)
  const [proposing, setProposing] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [viewMode, setViewMode] = useState<'tree' | 'flat' | 'procurement'>('tree')

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

  // v_boq_items_flat / v_boq_procurement_spec (PR 9a) only carry rows for
  // approved BOQs -- these two view modes are only offered once approved.
  const { data: flatRows = [] } = useQuery({
    queryKey: ['boq-flat', boq?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_boq_items_flat').select('*').eq('boq_id', boq!.id).order('name')
      if (error) throw error
      return (data ?? []) as BoqFlatRow[]
    },
    enabled: !!boq?.id && boq?.status === 'approved' && viewMode === 'flat',
  })

  const { data: procurementRows = [] } = useQuery({
    queryKey: ['boq-procurement-spec', boq?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_boq_procurement_spec').select('*').eq('boq_id', boq!.id).order('name')
      if (error) throw error
      return (data ?? []) as BoqProcurementSpecRow[]
    },
    enabled: !!boq?.id && boq?.status === 'approved' && viewMode === 'procurement',
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
    // ScheduleSection reads the approved BOQ under its own key to stamp
    // schedules.boq_id when a schedule is built. Without this, approving a
    // BOQ here left that query holding a stale null, and a schedule built
    // moments later recorded no BOQ at all — which silently zeroed the
    // whole physical-progress chain (see migration 235).
    qc.invalidateQueries({ queryKey: ['project-approved-boq', projectId] })
    qc.invalidateQueries({ queryKey: ['project-boq-status'] })
    qc.invalidateQueries({ queryKey: ['project-boq-schedule-link', projectId] })
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
    const unpriced = tree.filter(t => (t.node_type === 'line_item' && (!Number(t.quantity) || !Number(t.unit_rate_etb))) || (t.node_type === 'lump_sum' && !Number(t.total_etb))).length
    if (!window.confirm(`${unpriced ? `${unpriced} line${unpriced === 1 ? ' has' : 's have'} no quantity, rate or amount yet.\n\n` : ''}Approve this BOQ? After approval, changes go through a change order — edit the sheet and send it for approval.`)) return
    setApproving(true)
    const { error } = await supabase.from('boqs').update({
      status: 'approved', approved_at: new Date().toISOString(), approved_by_staff_id: myStaff.id,
    }).eq('id', boq.id)
    setApproving(false)
    if (error) { toast(error.message, 'error'); return }
    invalidateAll()
    toast('BOQ approved', 'success')
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
            {canRequestCO && !proposing && (
              <button onClick={() => { setViewMode('tree'); setProposing(true) }}
                className="flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90">
                <FileEdit className="h-3.5 w-3.5" /> Change the BOQ
              </button>
            )}
          </div>
        )}
      </div>

      {!boq && (canCreate ? (
        <BoqStart projectId={projectId} projectName={projectName} onCreated={invalidateAll}
          onImportFile={() => setShowImport(true)} onBlank={handleCreateManually} creatingBlank={creatingManually} />
      ) : (
        <div className="rounded-md border border-dashed dark:border-slate-600 p-6 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">No BOQ yet for this project.</p>
          <p className="text-xs text-slate-400">A project manager, admin, design, finance or procurement can start one.</p>
        </div>
      ))}

      {boq && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-medium text-slate-700 dark:text-slate-200">{boq.title}</span>
            <span>v{boq.version_number}</span>
            <span>PM: {boq.staff?.employee_name ?? '—'}</span>
            <span className="font-medium text-slate-700 dark:text-slate-200">{formatCurrency(boq.grand_total_etb)}</span>
          </div>

          {boq.status === 'approved' && (
            <div className={`rounded-md border p-3 flex items-start gap-2 ${proposing ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20' : 'bg-slate-50 dark:bg-slate-700/30 dark:border-slate-700'}`}>
              <AlertTriangle className={`h-4 w-4 mt-0.5 shrink-0 ${proposing ? 'text-amber-600' : 'text-slate-400'}`} />
              <p className="text-xs text-slate-600 dark:text-slate-300">
                {proposing
                  ? 'Change quantities, rates or lines below. Nothing is saved until the change is approved — the bar at the bottom shows the difference and who has to approve it.'
                  : <>This BOQ is approved.{canRequestCO && <> To change it, press <b>Change the BOQ</b>, edit the sheet, and send it for approval.</>}</>}
              </p>
            </div>
          )}

          {boq.status === 'approved' && !proposing && (
            <div className="flex items-center rounded-md border dark:border-slate-600 overflow-hidden w-fit">
              <button onClick={() => setViewMode('tree')}
                className={`flex items-center gap-1 px-2 py-1 text-xs ${viewMode === 'tree' ? 'bg-brand text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
                <ListTree className="h-3 w-3" /> Tree
              </button>
              <button onClick={() => setViewMode('flat')}
                className={`flex items-center gap-1 px-2 py-1 text-xs border-l dark:border-slate-600 ${viewMode === 'flat' ? 'bg-brand text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
                <Table2 className="h-3 w-3" /> Flat
              </button>
              <button onClick={() => setViewMode('procurement')}
                className={`flex items-center gap-1 px-2 py-1 text-xs border-l dark:border-slate-600 ${viewMode === 'procurement' ? 'bg-brand text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
                <PackageSearch className="h-3 w-3" /> Procurement Spec
              </button>
            </div>
          )}


          {viewMode === 'flat' && (
            <div className="space-y-2">
              <button onClick={() => downloadCsv(
                `${boq.title.replace(/[^a-z0-9]+/gi, '_')}_flat.csv`,
                ['Room', 'Category', 'Sub-category', 'Name', 'Unit', 'Qty', 'Rate', 'Total', 'Priced Elsewhere'],
                flatRows.map(r => [r.room, r.category, r.sub_category, r.name, r.unit, r.quantity, r.unit_rate_etb, r.total_etb, r.is_priced_elsewhere ? 'Yes' : 'No'])
              )} className="flex items-center gap-1 text-xs font-medium text-brand hover:underline">
                <Download className="h-3.5 w-3.5" /> Export CSV
              </button>
              {flatRows.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">No items.</p>
              ) : (
                <div className="overflow-x-auto -mx-1">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-slate-400 dark:text-slate-500 border-b dark:border-slate-700">
                        <th className="py-1.5 px-1 font-medium">Room / Category</th>
                        <th className="py-1.5 px-1 font-medium">Name</th>
                        <th className="py-1.5 px-1 font-medium">Unit</th>
                        <th className="py-1.5 px-1 font-medium text-right">Qty</th>
                        <th className="py-1.5 px-1 font-medium text-right">Rate</th>
                        <th className="py-1.5 px-1 font-medium text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y dark:divide-slate-700">
                      {flatRows.map(r => (
                        <tr key={r.item_id}>
                          <td className="py-1.5 px-1 text-slate-500 dark:text-slate-400">{[r.room, r.category, r.sub_category].filter(Boolean).join(' / ') || '—'}</td>
                          <td className="py-1.5 px-1 text-slate-700 dark:text-slate-200">
                            {r.name}
                            {r.is_priced_elsewhere && <span className="ml-1.5 text-[10px] text-amber-600 dark:text-amber-400">priced elsewhere</span>}
                          </td>
                          <td className="py-1.5 px-1 text-slate-500 dark:text-slate-400">{r.unit ?? '—'}</td>
                          <td className="py-1.5 px-1 text-right text-slate-500 dark:text-slate-400">{r.quantity ?? '—'}</td>
                          <td className="py-1.5 px-1 text-right text-slate-500 dark:text-slate-400">{r.unit_rate_etb != null ? formatCurrency(r.unit_rate_etb) : '—'}</td>
                          <td className="py-1.5 px-1 text-right text-slate-700 dark:text-slate-200">{formatCurrency(r.total_etb)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {viewMode === 'procurement' && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Items whose quantity is tracked here but whose cost is absorbed into a lump sum elsewhere — what Procurement needs to plan sourcing for.
              </p>
              <button onClick={() => downloadCsv(
                `${boq.title.replace(/[^a-z0-9]+/gi, '_')}_procurement_spec.csv`,
                ['Room', 'Category', 'Sub-category', 'Name', 'Unit', 'Qty', 'Absorbed By'],
                procurementRows.map(r => [r.room, r.category, r.sub_category, r.name, r.unit, r.quantity, r.absorbed_by_name])
              )} className="flex items-center gap-1 text-xs font-medium text-brand hover:underline">
                <Download className="h-3.5 w-3.5" /> Export CSV
              </button>
              {procurementRows.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">No priced-elsewhere items.</p>
              ) : (
                <div className="overflow-x-auto -mx-1">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-slate-400 dark:text-slate-500 border-b dark:border-slate-700">
                        <th className="py-1.5 px-1 font-medium">Room / Category</th>
                        <th className="py-1.5 px-1 font-medium">Name</th>
                        <th className="py-1.5 px-1 font-medium">Unit</th>
                        <th className="py-1.5 px-1 font-medium text-right">Qty</th>
                        <th className="py-1.5 px-1 font-medium">Absorbed By</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y dark:divide-slate-700">
                      {procurementRows.map(r => (
                        <tr key={r.item_id}>
                          <td className="py-1.5 px-1 text-slate-500 dark:text-slate-400">{[r.room, r.category, r.sub_category].filter(Boolean).join(' / ') || '—'}</td>
                          <td className="py-1.5 px-1 text-slate-700 dark:text-slate-200">{r.name}</td>
                          <td className="py-1.5 px-1 text-slate-500 dark:text-slate-400">{r.unit ?? '—'}</td>
                          <td className="py-1.5 px-1 text-right text-slate-500 dark:text-slate-400">{r.quantity ?? '—'}</td>
                          <td className="py-1.5 px-1 text-slate-500 dark:text-slate-400">{r.absorbed_by_name ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {viewMode === 'tree' && (
            <BoqSheet boqId={boq.id} tree={tree} onChanged={invalidateAll}
              mode={canManage ? 'edit' : proposing ? 'propose' : 'view'} onCancelProposal={() => setProposing(false)} />
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

      {showHistory && (
        <BoqVersionHistoryModal projectId={projectId} onClose={() => setShowHistory(false)} />
      )}
    </div>
  )
}
