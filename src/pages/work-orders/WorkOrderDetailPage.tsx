import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { useStaffDirectory } from '@/hooks/useLookups'
import type { WorkOrder, WorkOrderCostRow, LaborAllocation, StockIssue } from '@/types/database'
import { ArrowLeft, Pencil, Plus, Trash2, X } from 'lucide-react'

type WorkOrderDetail = WorkOrder & {
  projects: { project_name: string } | null
}

const WRITE_ROLES = ['admin', 'manager', 'operations_manager', 'project_manager']

export default function WorkOrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { role } = useAuth()
  const canWrite = !!role && WRITE_ROLES.includes(role)

  const { data: wo, isLoading, error } = useQuery({
    queryKey: ['work-order-detail', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_orders')
        .select('*, projects(project_name)')
        .eq('id', id!)
        .single()
      if (error) throw error
      return data as unknown as WorkOrderDetail
    },
    enabled: !!id,
  })

  // v_staff_directory, not a raw `staff` embed — operations_manager /
  // project_manager (this page's core write roles) have no RLS read
  // access to `staff` at all.
  const { data: staffDirectory = [] } = useStaffDirectory()
  const staffNameById = useMemo(() => new Map(staffDirectory.map((s: any) => [s.id, s.employee_name])), [staffDirectory])

  const { data: cost } = useQuery({
    queryKey: ['work-order-cost', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_work_order_cost').select('*').eq('work_order_id', id!).maybeSingle()
      if (error) throw error
      return data as WorkOrderCostRow | null
    },
    enabled: !!id,
  })

  if (isLoading) {
    return <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
  }

  if (error || !wo) {
    return (
      <div className="space-y-4">
        <Link to="/work-orders" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand transition-colors">
          <ArrowLeft className="h-4 w-4" />Back
        </Link>
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error instanceof Error ? error.message : 'Work order not found'}
        </div>
      </div>
    )
  }

  return (
    <div className="animate-fade-in-up space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <Link to="/work-orders" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand transition-colors flex-shrink-0">
            <ArrowLeft className="h-4 w-4" />Back
          </Link>
          <span className="text-slate-300 dark:text-slate-600 flex-shrink-0">/</span>
          <h1 className="text-base font-bold text-slate-800 dark:text-slate-100 truncate">{wo.scope_of_work}</h1>
        </div>
        {canWrite && (
          <Link to={`/work-orders/${wo.id}/edit`} className="flex items-center gap-1.5 rounded-md border dark:border-slate-600 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex-shrink-0">
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Link>
        )}
      </div>

      <div className="rounded-xl border bg-white p-6 dark:bg-slate-800 dark:border-slate-700 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Project</p>
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{wo.projects?.project_name ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Type</p>
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100 capitalize">{wo.work_type}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Lead</p>
              <p className="text-sm text-slate-700 dark:text-slate-300">{(wo.assigned_lead_staff_id && staffNameById.get(wo.assigned_lead_staff_id)) ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Target Completion</p>
              <p className="text-sm text-slate-700 dark:text-slate-300">{formatDate(wo.target_completion_date)}</p>
            </div>
          </div>
          <StatusBadge status={wo.status} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t dark:border-slate-700">
          <div>
            <p className="text-xs text-slate-400">Labor Cost</p>
            <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{formatCurrency(cost?.labor_cost ?? 0)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Materials Cost</p>
            <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{formatCurrency(cost?.materials_cost ?? 0)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Total Cost</p>
            <p className="text-lg font-bold text-brand">{formatCurrency(cost?.total_cost ?? 0)}</p>
          </div>
        </div>
        <p className="text-[11px] text-slate-400">Derived entirely from linked labor allocations and stock issues below — never entered directly.</p>
      </div>

      <LinkedLabor workOrderId={wo.id} projectId={wo.project_id} canWrite={canWrite} staffNameById={staffNameById} />
      <LinkedMaterials workOrderId={wo.id} projectId={wo.project_id} canWrite={canWrite} />
    </div>
  )
}

// ── Linked labor allocations ─────────────────────────────────────────
function LinkedLabor({ workOrderId, projectId, canWrite, staffNameById }: { workOrderId: string; projectId: string; canWrite: boolean; staffNameById: Map<string, string> }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const { data = [], isLoading } = useQuery({
    queryKey: ['work-order-labor', workOrderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_order_labor')
        .select('id, labor_allocation_id, labor_allocations(id, staff_id, start_date, end_date, day_rate_snapshot)')
        .eq('work_order_id', workOrderId)
      if (error) throw error
      return data as unknown as { id: string; labor_allocation_id: string; labor_allocations: LaborAllocation | null }[]
    },
  })

  const { data: linkedIds = [] } = useQuery({
    queryKey: ['all-linked-labor-allocation-ids'],
    queryFn: async () => {
      const { data, error } = await supabase.from('work_order_labor').select('labor_allocation_id')
      if (error) throw error
      return (data ?? []).map(r => r.labor_allocation_id)
    },
  })

  const { data: projectAllocations = [] } = useQuery({
    queryKey: ['project-labor-allocations', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('labor_allocations')
        .select('id, staff_id, start_date, end_date, day_rate_snapshot')
        .eq('project_id', projectId)
      if (error) throw error
      return data as LaborAllocation[]
    },
  })

  const availableOptions = useMemo(
    () => projectAllocations
      .filter(a => !linkedIds.includes(a.id))
      .map(a => ({ id: a.id, label: `${staffNameById.get(a.staff_id) ?? 'Staff'} — ${formatDate(a.start_date)} to ${a.end_date ? formatDate(a.end_date) : 'open'}` })),
    [projectAllocations, linkedIds, staffNameById]
  )

  async function handleLink() {
    if (!selectedId) return
    setSaving(true)
    const { error } = await supabase.from('work_order_labor').insert([{ work_order_id: workOrderId, labor_allocation_id: selectedId }])
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['work-order-labor', workOrderId] })
    qc.invalidateQueries({ queryKey: ['all-linked-labor-allocation-ids'] })
    qc.invalidateQueries({ queryKey: ['work-order-cost', workOrderId] })
    qc.invalidateQueries({ queryKey: ['work-order-costs'] })
    setSelectedId(null)
    setShowAdd(false)
    toast('Labor allocation linked', 'success')
  }

  async function handleUnlink(linkId: string) {
    const { error } = await supabase.from('work_order_labor').delete().eq('id', linkId)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['work-order-labor', workOrderId] })
    qc.invalidateQueries({ queryKey: ['all-linked-labor-allocation-ids'] })
    qc.invalidateQueries({ queryKey: ['work-order-cost', workOrderId] })
    qc.invalidateQueries({ queryKey: ['work-order-costs'] })
    toast('Unlinked', 'success')
  }

  return (
    <div className="rounded-xl border bg-white p-5 dark:bg-slate-800 dark:border-slate-700 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Linked Labor</h2>
        {canWrite && (
          <button onClick={() => setShowAdd(s => !s)} className="flex items-center gap-1.5 rounded-md border dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
            {showAdd ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} {showAdd ? 'Cancel' : 'Link Allocation'}
          </button>
        )}
      </div>
      {showAdd && (
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <SearchableSelect value={selectedId} onChange={setSelectedId} options={availableOptions} placeholder="Select this project's staff time…" />
          </div>
          <button onClick={handleLink} disabled={saving || !selectedId} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-60">
            {saving ? 'Linking…' : 'Link'}
          </button>
        </div>
      )}
      {isLoading ? (
        <div className="py-6 text-center text-sm text-slate-400">Loading…</div>
      ) : data.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">No labor allocations linked yet</p>
      ) : (
        <div className="divide-y dark:divide-slate-700">
          {data.map(row => {
            const la = row.labor_allocations
            const days = la ? Math.max(1, (new Date(la.end_date ?? new Date().toISOString()).getTime() - new Date(la.start_date).getTime()) / 86400000 + 1) : 0
            const lineCost = la ? days * (la.day_rate_snapshot ?? 0) : 0
            return (
              <div key={row.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <p className="font-medium text-slate-700 dark:text-slate-200">{(la && staffNameById.get(la.staff_id)) ?? '—'}</p>
                  <p className="text-xs text-slate-400">{la ? `${formatDate(la.start_date)} – ${la.end_date ? formatDate(la.end_date) : 'open'}` : ''}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(lineCost)}</span>
                  {canWrite && (
                    <button onClick={() => handleUnlink(row.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20" title="Unlink">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Linked materials (stock issues) ──────────────────────────────────
function LinkedMaterials({ workOrderId, projectId, canWrite }: { workOrderId: string; projectId: string; canWrite: boolean }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const { data = [], isLoading } = useQuery({
    queryKey: ['work-order-materials', workOrderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_order_materials')
        .select('id, stock_issue_id, stock_issues(id, quantity, total_cost, issued_date, stock_items(item_name))')
        .eq('work_order_id', workOrderId)
      if (error) throw error
      return data as unknown as { id: string; stock_issue_id: string; stock_issues: (StockIssue & { total_cost: number; stock_items: { item_name: string } | null }) | null }[]
    },
  })

  const { data: linkedIds = [] } = useQuery({
    queryKey: ['all-linked-stock-issue-ids'],
    queryFn: async () => {
      const { data, error } = await supabase.from('work_order_materials').select('stock_issue_id')
      if (error) throw error
      return (data ?? []).map(r => r.stock_issue_id)
    },
  })

  const { data: projectIssues = [] } = useQuery({
    queryKey: ['project-stock-issues', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stock_issues')
        .select('id, quantity, total_cost, issued_date, stock_items(item_name)')
        .eq('project_id', projectId)
      if (error) throw error
      return data as unknown as { id: string; quantity: number; total_cost: number; issued_date: string; stock_items: { item_name: string } | null }[]
    },
  })

  const availableOptions = useMemo(
    () => projectIssues
      .filter(i => !linkedIds.includes(i.id))
      .map(i => ({ id: i.id, label: `${i.stock_items?.item_name ?? 'Item'} — ${i.quantity} · ${formatCurrency(i.total_cost)}` })),
    [projectIssues, linkedIds]
  )

  async function handleLink() {
    if (!selectedId) return
    setSaving(true)
    const { error } = await supabase.from('work_order_materials').insert([{ work_order_id: workOrderId, stock_issue_id: selectedId }])
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['work-order-materials', workOrderId] })
    qc.invalidateQueries({ queryKey: ['all-linked-stock-issue-ids'] })
    qc.invalidateQueries({ queryKey: ['work-order-cost', workOrderId] })
    qc.invalidateQueries({ queryKey: ['work-order-costs'] })
    setSelectedId(null)
    setShowAdd(false)
    toast('Stock issue linked', 'success')
  }

  async function handleUnlink(linkId: string) {
    const { error } = await supabase.from('work_order_materials').delete().eq('id', linkId)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['work-order-materials', workOrderId] })
    qc.invalidateQueries({ queryKey: ['all-linked-stock-issue-ids'] })
    qc.invalidateQueries({ queryKey: ['work-order-cost', workOrderId] })
    qc.invalidateQueries({ queryKey: ['work-order-costs'] })
    toast('Unlinked', 'success')
  }

  return (
    <div className="rounded-xl border bg-white p-5 dark:bg-slate-800 dark:border-slate-700 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Linked Materials</h2>
        {canWrite && (
          <button onClick={() => setShowAdd(s => !s)} className="flex items-center gap-1.5 rounded-md border dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
            {showAdd ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} {showAdd ? 'Cancel' : 'Link Stock Issue'}
          </button>
        )}
      </div>
      {showAdd && (
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <SearchableSelect value={selectedId} onChange={setSelectedId} options={availableOptions} placeholder="Select this project's material issued from stock…" />
          </div>
          <button onClick={handleLink} disabled={saving || !selectedId} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-60">
            {saving ? 'Linking…' : 'Link'}
          </button>
        </div>
      )}
      {isLoading ? (
        <div className="py-6 text-center text-sm text-slate-400">Loading…</div>
      ) : data.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">No materials linked yet</p>
      ) : (
        <div className="divide-y dark:divide-slate-700">
          {data.map(row => (
            <div key={row.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <div>
                <p className="font-medium text-slate-700 dark:text-slate-200">{row.stock_issues?.stock_items?.item_name ?? '—'}</p>
                <p className="text-xs text-slate-400">{row.stock_issues ? `${row.stock_issues.quantity} · ${formatDate(row.stock_issues.issued_date)}` : ''}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(row.stock_issues?.total_cost ?? 0)}</span>
                {canWrite && (
                  <button onClick={() => handleUnlink(row.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20" title="Unlink">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
