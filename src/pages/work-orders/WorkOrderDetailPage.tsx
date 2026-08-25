import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { StarRating } from '@/components/shared/StarRating'
import { FileUpload } from '@/components/shared/FileUpload'
import { useStaffDirectory } from '@/hooks/useLookups'
import { useMyStaffId, useMySiteForemanProjects } from '@/hooks/useMyStaff'
import { useTradeRoster, useAllRolling } from '@/hooks/useTier2Workers'
import { RosterRequestPickerModal } from '@/components/shared/RosterRequestPickerModal'
import {
  useWorkOrderTeam, useWorkOrderRatings, useUpsertWorkOrderRating, useDeleteWorkOrderRating,
  type WorkOrderRatingRow,
} from '@/hooks/useWorkOrderRatings'
import type { WorkOrder, WorkOrderCostRow, LaborAllocation, StockIssue, WorkOrderCrew, WoAttendanceLog, WoProgressUpdate, SiteMaterialReceipt } from '@/types/database'
import { ArrowLeft, Pencil, Plus, Star, Trash2, X, Users, Clock, TrendingUp, Package, Camera, AlertTriangle, UserMinus, UserPlus2, Send } from 'lucide-react'

type WorkOrderDetail = WorkOrder & {
  projects: { project_name: string } | null
}

const WRITE_ROLES = ['admin', 'executive', 'operations_manager', 'project_manager']

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
  const staffDirectoryById = useMemo(() => new Map(staffDirectory.map((s: any) => [s.id, s])), [staffDirectory])

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
              <p className="text-sm text-slate-700 dark:text-slate-300">{formatDate(wo.target_completion_date)} {daysRemainingLabel(wo.target_completion_date, wo.status)}</p>
            </div>
          </div>
          <StatusBadge status={wo.status} />
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-medium text-slate-600 dark:text-slate-300">Progress</span>
            <span className="text-slate-400">{wo.current_progress_pct}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${Math.min(100, wo.current_progress_pct)}%` }} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t dark:border-slate-700">
          <div>
            <p className="text-xs text-slate-400">Labor Cost</p>
            <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{formatCurrency(cost?.labor_cost ?? 0)}</p>
            <p className="text-[11px] text-slate-400">Est. {formatCurrency(cost?.labor_cost_estimated ?? 0)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Materials Cost</p>
            <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{formatCurrency(cost?.materials_cost ?? 0)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Total Cost (Actual)</p>
            <p className="text-lg font-bold text-brand">{formatCurrency(cost?.total_cost ?? 0)}</p>
            <p className="text-[11px] text-slate-400">Est. {formatCurrency(cost?.total_cost_estimated ?? 0)}</p>
          </div>
        </div>
        <p className="text-[11px] text-slate-400">Actual = real work logged in attendance below. Estimated = budget from the linked labor requisition(s). Materials derived entirely from linked stock issues — never entered directly.</p>
      </div>

      <CrewSection workOrderId={wo.id} projectId={wo.project_id} canWrite={canWrite} leadStaffId={wo.assigned_lead_staff_id ?? null} staffNameById={staffNameById} staffDirectoryById={staffDirectoryById} />
      <TodayActivitySection workOrderId={wo.id} staffNameById={staffNameById} />
      <ProgressSection workOrderId={wo.id} canWrite={canWrite} />
      <MaterialReceiptsSection workOrderId={wo.id} projectId={wo.project_id} canWrite={canWrite} />
      <BlockersPanel projectId={wo.project_id} />
      <PhotosGrid workOrderId={wo.id} />

      <LinkedLabor workOrderId={wo.id} projectId={wo.project_id} canWrite={canWrite} staffNameById={staffNameById} />
      <LinkedMaterials workOrderId={wo.id} projectId={wo.project_id} canWrite={canWrite} />
      {lower(wo.status) === 'completed' && (
        <TeamRatings workOrderId={wo.id} leadStaffId={wo.assigned_lead_staff_id ?? null} />
      )}
    </div>
  )
}

function lower(s: string | null | undefined): string { return (s ?? '').toLowerCase() }

function daysRemainingLabel(targetDate: string | null, status: string): string {
  if (!targetDate || status === 'completed' || status === 'cancelled') return ''
  const days = Math.ceil((new Date(targetDate).getTime() - Date.now()) / 86_400_000)
  if (days < 0) return `· ${Math.abs(days)}d overdue`
  if (days === 0) return '· due today'
  return `· ${days}d remaining`
}

// Anyone in WRITE_ROLES, or a site foreman scoped to this specific
// project (RLS on work_order_crew/wo_attendance_log/wo_progress_updates/
// site_material_receipts is the real gate — this just avoids showing
// controls that would fail for a foreman on a different site).
function useCanWriteWoOps(projectId: string, canWrite: boolean): boolean {
  const { projects } = useMySiteForemanProjects()
  return canWrite || projects.some(p => p.id === projectId)
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

// ── Team Ratings (only when WO is completed) ─────────────────────────
// Renders one row per person on the WO team (labor rows ∪ assigned lead).
// The person's rating card shows the caller's own rating if they've filed
// one — a foreman/lead/PM/admin/exec who can rate opens a modal to file or
// edit it. RLS decides visibility for the OTHERS' ratings; when the caller
// is the ratee themselves, their card never shows raw comments (RLS
// filters those rows out) and offers no "Rate" button (self-rating is
// blocked at the DB regardless).
function TeamRatings({ workOrderId, leadStaffId }: { workOrderId: string; leadStaffId: string | null }) {
  const { data: team = [], isLoading: teamLoading } = useWorkOrderTeam(workOrderId, leadStaffId)
  const { data: ratings = [] } = useWorkOrderRatings(workOrderId)
  const { data: mySelf } = useMyStaffId()
  const myStaffId = mySelf?.id ?? null
  const [editing, setEditing] = useState<{ rated: { id: string; employee_name: string }; existing: WorkOrderRatingRow | null } | null>(null)

  // Group ratings by ratee so counts are cheap.
  const ratingsByRatee = useMemo(() => {
    const map = new Map<string, WorkOrderRatingRow[]>()
    for (const r of ratings) {
      const arr = map.get(r.rated_staff_id) ?? []
      arr.push(r)
      map.set(r.rated_staff_id, arr)
    }
    return map
  }, [ratings])

  return (
    <div className="rounded-xl border bg-white p-5 dark:bg-slate-800 dark:border-slate-700 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Team Ratings</h2>
          <p className="text-[11px] text-slate-400 mt-0.5">Feeds each person's rolling performance score (6-month half-life). Comments are private to the rater, PM, HR, and executives.</p>
        </div>
      </div>

      {teamLoading ? (
        <div className="py-6 text-center text-sm text-slate-400">Loading team…</div>
      ) : team.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">No labor logged against this WO — nothing to rate.</p>
      ) : (
        <div className="divide-y dark:divide-slate-700">
          {team.map(person => {
            const forThisPerson = ratingsByRatee.get(person.id) ?? []
            const mine = myStaffId ? forThisPerson.find(r => r.rater_staff_id === myStaffId) ?? null : null
            const others = forThisPerson.filter(r => r.rater_staff_id !== myStaffId)
            const isSelf = person.id === myStaffId
            const overall = (mine && ((mine.score_quality + mine.score_timeliness + mine.score_safety + mine.score_teamwork) / 4)) ?? null
            return (
              <div key={person.id} className="py-3 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{person.employee_name}</p>
                    {person.id === leadStaffId && (
                      <span className="rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300 text-[10px] px-1.5 py-0.5 font-semibold">Lead</span>
                    )}
                    {isSelf && <span className="text-[10px] text-slate-400">(you)</span>}
                  </div>
                  {mine ? (
                    <div className="flex items-center gap-3 mt-1">
                      <StarRating score={overall} size="sm" />
                      <span className="text-[11px] text-slate-500">Your rating · {mine.comment ? `"${mine.comment}"` : 'no comment'}</span>
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-400 mt-1">You haven't rated this person on this WO.</p>
                  )}
                  {others.length > 0 && (
                    <p className="text-[11px] text-slate-400 mt-0.5">{others.length} other rating{others.length === 1 ? '' : 's'} on file</p>
                  )}
                </div>
                <div className="flex-shrink-0">
                  {!isSelf && (
                    <button
                      onClick={() => setEditing({ rated: { id: person.id, employee_name: person.employee_name }, existing: mine })}
                      className="flex items-center gap-1.5 rounded-md border dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                    >
                      <Star className="h-3.5 w-3.5" /> {mine ? 'Edit' : 'Rate'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editing && myStaffId && (
        <RatingModal
          workOrderId={workOrderId}
          ratedStaffId={editing.rated.id}
          ratedName={editing.rated.employee_name}
          raterStaffId={myStaffId}
          existing={editing.existing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function RatingModal({
  workOrderId, ratedStaffId, ratedName, raterStaffId, existing, onClose,
}: {
  workOrderId: string
  ratedStaffId: string
  ratedName: string
  raterStaffId: string
  existing: WorkOrderRatingRow | null
  onClose: () => void
}) {
  const { toast } = useToast()
  const upsert = useUpsertWorkOrderRating()
  const del = useDeleteWorkOrderRating()
  const [q, setQ] = useState<number>(existing?.score_quality    ?? 4)
  const [t, setT] = useState<number>(existing?.score_timeliness ?? 4)
  const [s, setS] = useState<number>(existing?.score_safety     ?? 4)
  const [tm, setTm] = useState<number>(existing?.score_teamwork ?? 4)
  const [comment, setComment] = useState<string>(existing?.comment ?? '')

  async function handleSave() {
    try {
      await upsert.mutateAsync({
        work_order_id: workOrderId,
        rated_staff_id: ratedStaffId,
        rater_staff_id: raterStaffId,
        score_quality: q, score_timeliness: t, score_safety: s, score_teamwork: tm,
        comment: comment.trim() ? comment.trim() : null,
      })
      toast(existing ? 'Rating updated' : 'Rating filed', 'success')
      onClose()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  async function handleDelete() {
    if (!existing) return
    if (!confirm('Remove your rating for this WO?')) return
    try {
      await del.mutateAsync({ id: existing.id, work_order_id: workOrderId, rated_staff_id: ratedStaffId })
      toast('Rating removed', 'success')
      onClose()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const busy = upsert.isPending || del.isPending

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-800 shadow-xl border dark:border-slate-700 p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Rate {ratedName}</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">Your rating is private to you, project managers, HR, and executives.</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>

        <RatingRow label="Quality"     value={q}  onChange={setQ} />
        <RatingRow label="Timeliness"  value={t}  onChange={setT} />
        <RatingRow label="Safety"      value={s}  onChange={setS} />
        <RatingRow label="Teamwork"    value={tm} onChange={setTm} />

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Comment (optional)</label>
          <textarea
            rows={3}
            value={comment}
            onChange={e => setComment(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
            placeholder="What went well? What could have been better?"
          />
        </div>

        <div className="flex items-center justify-between pt-1">
          <div>
            {existing && (
              <button onClick={handleDelete} disabled={busy} className="text-xs text-red-500 hover:underline disabled:opacity-60">
                Remove rating
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} disabled={busy} className="rounded-md border dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60">Cancel</button>
            <button onClick={handleSave} disabled={busy} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-60">
              {busy ? 'Saving…' : existing ? 'Update' : 'Submit'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function RatingRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{label}</span>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map(i => (
          <button
            key={i}
            type="button"
            onClick={() => onChange(i)}
            className="p-0.5"
            aria-label={`${label} ${i} stars`}
          >
            <Star className={`h-5 w-5 ${i <= value ? 'fill-amber-400 text-amber-400' : 'text-slate-300 dark:text-slate-600'}`} />
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Crew section: work_order_crew (Tier 1 + Tier 2 assignment layer) ──
type CrewRow = WorkOrderCrew & { staff: { employee_name: string; employment_type: string | null; trade_tag: string | null; codename_amharic: string | null; codename_english: string | null } | null }

function Tier2MiniBadge({ employeeName, tradeTag, codenameAmharic, codenameEnglish, score }: { employeeName: string | null; tradeTag: string | null; codenameAmharic: string | null; codenameEnglish: string | null; score: number | null }) {
  const { data: roster = [] } = useTradeRoster()
  const trade = roster.find(t => t.trade_tag === tradeTag)
  const accent = trade?.color_accent ?? '#7a7f8c'
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] dark:border-slate-600" style={{ borderColor: accent }}>
      <span>{trade?.icon_emoji ?? '🛠️'}</span>
      <span className="font-medium text-slate-700 dark:text-slate-200">{employeeName ?? codenameAmharic ?? trade?.codename_amharic ?? codenameEnglish ?? 'Tier 2'}</span>
      <span className="text-slate-400">{codenameAmharic ?? trade?.codename_amharic ?? codenameEnglish ?? ''}</span>
      <span className="font-mono text-slate-400">{score != null ? `${score}/100` : '—'}</span>
    </span>
  )
}

function CrewSection({ workOrderId, projectId, canWrite, leadStaffId, staffNameById, staffDirectoryById }: {
  workOrderId: string; projectId: string; canWrite: boolean; leadStaffId: string | null; staffNameById: Map<string, string>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  staffDirectoryById: Map<string, any>
}) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: mySelf } = useMyStaffId()
  const canManage = useCanWriteWoOps(projectId, canWrite)
  const [showAdd, setShowAdd] = useState(false)
  const [showRosterPicker, setShowRosterPicker] = useState(false)
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null)
  const [roleOnWo, setRoleOnWo] = useState('')
  const [saving, setSaving] = useState(false)
  const { data: rolling = [] } = useAllRolling()
  const rollingByStaff = useMemo(() => new Map(rolling.map(r => [r.staff_id, r.overall_score_100])), [rolling])

  const { data: crew = [], isLoading } = useQuery({
    queryKey: ['work-order-crew', workOrderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_order_crew')
        .select('*, staff!work_order_crew_staff_id_fkey(employee_name, employment_type, trade_tag, codename_amharic, codename_english)')
        .eq('work_order_id', workOrderId)
        .is('removed_at', null)
      if (error) throw error
      return data as unknown as CrewRow[]
    },
  })

  const { data: candidatePool = [] } = useQuery({
    queryKey: ['wo-crew-candidates', projectId],
    queryFn: async () => {
      const [assignments, allocations] = await Promise.all([
        supabase.from('staff_assignments').select('staff_id, staff:staff_id(employee_name)').eq('project_id', projectId).eq('active', true),
        supabase.from('labor_allocations').select('staff_id, staff:staff_id(employee_name)').eq('project_id', projectId).eq('status', 'active'),
      ])
      if (assignments.error) throw assignments.error
      if (allocations.error) throw allocations.error
      const merged = new Map<string, string>()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const r of [...(assignments.data ?? []), ...(allocations.data ?? [])] as any[]) {
        if (r.staff_id) merged.set(r.staff_id, r.staff?.employee_name ?? staffNameById.get(r.staff_id) ?? '—')
      }
      return Array.from(merged.entries()).map(([id, label]) => ({ id, label }))
    },
    enabled: showAdd,
  })

  const alreadyOnCrew = new Set(crew.map(c => c.staff_id))
  const addOptions = candidatePool.filter(o => !alreadyOnCrew.has(o.id))

  async function handleAdd() {
    if (!selectedStaffId) return
    setSaving(true)
    const { error } = await supabase.from('work_order_crew').insert([{
      work_order_id: workOrderId, staff_id: selectedStaffId, role_on_wo: roleOnWo.trim() || null,
      assigned_by_staff_id: mySelf?.id ?? null,
    }])
    setSaving(false)
    if (error) {
      // 23505 = unique_violation on uq_wo_crew_active — someone else's
      // recent add hadn't reached this browser's cached crew list yet.
      // Refetch so the dropdown drops the stale option, and say so
      // plainly instead of surfacing the raw constraint name.
      qc.invalidateQueries({ queryKey: ['work-order-crew', workOrderId] })
      toast(error.code === '23505' ? 'This person is already on the crew for this work order' : error.message, 'error')
      return
    }
    qc.invalidateQueries({ queryKey: ['work-order-crew', workOrderId] })
    setSelectedStaffId(null); setRoleOnWo(''); setShowAdd(false)
    toast('Crew member added', 'success')
  }

  async function handleRemove(rowId: string) {
    const { error } = await supabase.from('work_order_crew')
      .update({ removed_at: new Date().toISOString(), removed_by_staff_id: mySelf?.id ?? null })
      .eq('id', rowId)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['work-order-crew', workOrderId] })
    toast('Removed from crew', 'success')
  }

  return (
    <div className="rounded-xl border bg-white p-5 dark:bg-slate-800 dark:border-slate-700 space-y-3">
      {showRosterPicker && (
        <RosterRequestPickerModal
          projectId={projectId} workOrderId={workOrderId}
          excludeStaffIds={alreadyOnCrew}
          onClose={() => setShowRosterPicker(false)}
        />
      )}
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-300"><Users className="h-4 w-4" /> Crew ({crew.length})</h2>
        {canManage && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowRosterPicker(true)}
              className="flex items-center gap-1.5 rounded-md border dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              <Send className="h-3.5 w-3.5" /> Request from Roster
            </button>
            <Link to={`/labor-requisitions/new?project_id=${projectId}&work_order_id=${workOrderId}`} className="flex items-center gap-1.5 rounded-md border dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
              <UserPlus2 className="h-3.5 w-3.5" /> Request New/Casual Labor
            </Link>
            <button
              onClick={() => {
                if (!showAdd) qc.invalidateQueries({ queryKey: ['work-order-crew', workOrderId] })
                setShowAdd(s => !s)
              }}
              className="flex items-center gap-1.5 rounded-md border dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              {showAdd ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} {showAdd ? 'Cancel' : 'Add Crew'}
            </button>
          </div>
        )}
      </div>
      {showAdd && (
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1"><SearchableSelect value={selectedStaffId} onChange={setSelectedStaffId} options={addOptions} placeholder="Select staff allocated to this project…" /></div>
          <input value={roleOnWo} onChange={e => setRoleOnWo(e.target.value)} placeholder="Role on WO (optional)" className="rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 sm:w-48" />
          <button onClick={handleAdd} disabled={saving || !selectedStaffId} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-60">{saving ? 'Adding…' : 'Add'}</button>
        </div>
      )}
      {isLoading ? (
        <div className="py-6 text-center text-sm text-slate-400">Loading…</div>
      ) : crew.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">No crew assigned yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {crew.map(c => {
            const fallback = staffDirectoryById.get(c.staff_id)
            const employmentType = c.staff?.employment_type ?? fallback?.employment_type ?? null
            return (
            <div key={c.id} className="flex items-center gap-2 rounded-full border px-2.5 py-1.5 dark:border-slate-600">
              {employmentType === 'tier_2_casual' ? (
                <Tier2MiniBadge
                  employeeName={c.staff?.employee_name ?? fallback?.employee_name ?? staffNameById.get(c.staff_id) ?? null}
                  tradeTag={c.staff?.trade_tag ?? fallback?.trade_tag ?? null}
                  codenameAmharic={c.staff?.codename_amharic ?? fallback?.codename_amharic ?? null}
                  codenameEnglish={c.staff?.codename_english ?? fallback?.codename_english ?? null}
                  score={rollingByStaff.get(c.staff_id) ?? null}
                />
              ) : (
                <span className="text-sm text-slate-700 dark:text-slate-200">{c.staff?.employee_name ?? staffNameById.get(c.staff_id) ?? '—'}</span>
              )}
              {c.staff_id === leadStaffId && <span className="rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300 text-[9px] px-1.5 py-0.5 font-semibold">Lead</span>}
              {c.role_on_wo && <span className="text-[10px] text-slate-400">{c.role_on_wo}</span>}
              {canManage && (
                <button onClick={() => handleRemove(c.id)} className="text-slate-400 hover:text-red-500" title="Remove"><UserMinus className="h-3.5 w-3.5" /></button>
              )}
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Today's activity: hours logged today + who logged in ────────────
function TodayActivitySection({ workOrderId, staffNameById }: { workOrderId: string; staffNameById: Map<string, string> }) {
  const today = new Date().toISOString().slice(0, 10)
  const { data: rows = [] } = useQuery({
    queryKey: ['wo-attendance-today', workOrderId, today],
    queryFn: async () => {
      const { data, error } = await supabase.from('wo_attendance_log').select('*, staff:staff_id(employee_name)').eq('work_order_id', workOrderId).eq('log_date', today)
      if (error) throw error
      return data as unknown as (WoAttendanceLog & { staff: { employee_name: string } | null })[]
    },
  })
  const totalHours = rows.reduce((sum, r) => sum + Number(r.hours_logged), 0)

  return (
    <div className="rounded-xl border bg-white p-5 dark:bg-slate-800 dark:border-slate-700 space-y-2">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-300"><Clock className="h-4 w-4" /> Today's Activity</h2>
      <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{totalHours} hrs <span className="text-xs font-normal text-slate-400">logged today</span></p>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">No hours logged yet today.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {rows.map(r => (
            <span key={r.id} className="rounded-full bg-slate-100 dark:bg-slate-700 px-2.5 py-1 text-xs text-slate-600 dark:text-slate-300">
              {r.staff?.employee_name ?? staffNameById.get(r.staff_id) ?? '—'} · {r.hours_logged}h
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Progress: current %, update modal, history ───────────────────────
function ProgressSection({ workOrderId, canWrite }: { workOrderId: string; canWrite: boolean }) {
  const qc = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)
  const { data: history = [], isLoading } = useQuery({
    queryKey: ['wo-progress-updates', workOrderId],
    queryFn: async () => {
      const { data, error } = await supabase.from('wo_progress_updates').select('*, staff:updated_by_staff_id(employee_name)').eq('work_order_id', workOrderId).order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as (WoProgressUpdate & { staff: { employee_name: string } | null })[]
    },
  })

  return (
    <div className="rounded-xl border bg-white p-5 dark:bg-slate-800 dark:border-slate-700 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-300"><TrendingUp className="h-4 w-4" /> Progress History</h2>
        {canWrite && (
          <button onClick={() => setModalOpen(true)} className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90">
            <Plus className="h-3.5 w-3.5" /> Update Progress
          </button>
        )}
      </div>
      {isLoading ? (
        <div className="py-4 text-center text-sm text-slate-400">Loading…</div>
      ) : history.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">No progress updates yet.</p>
      ) : (
        <div className="divide-y dark:divide-slate-700">
          {history.map(h => (
            <div key={h.id} className="py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-brand">{h.progress_pct}%</span>
                <span className="text-xs text-slate-400">{formatDate(h.created_at)} · {h.staff?.employee_name ?? '—'}</span>
              </div>
              {h.note && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{h.note}</p>}
            </div>
          ))}
        </div>
      )}
      {modalOpen && (
        <ProgressUpdateModal
          workOrderId={workOrderId}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['wo-progress-updates', workOrderId] })
            qc.invalidateQueries({ queryKey: ['work-order-detail'] })
            setModalOpen(false)
          }}
        />
      )}
    </div>
  )
}

function ProgressUpdateModal({ workOrderId, onClose, onSaved }: { workOrderId: string; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast()
  const { data: mySelf } = useMyStaffId()
  const [pct, setPct] = useState(50)
  const [note, setNote] = useState('')
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photoName, setPhotoName] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!mySelf?.id) return
    setSaving(true)
    const { error } = await supabase.from('wo_progress_updates').insert([{
      work_order_id: workOrderId, progress_pct: pct, note: note.trim() || null, updated_by_staff_id: mySelf.id,
      photos: photoUrl ? [photoUrl] : null,
    }])
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Progress updated', 'success')
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl bg-white dark:bg-slate-800 shadow-xl border dark:border-slate-700 p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Update Progress</h3>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="text-slate-600 dark:text-slate-300">Progress</span>
            <span className="font-semibold text-brand">{pct}%</span>
          </div>
          <input type="range" min={0} max={100} step={5} value={pct} onChange={e => setPct(Number(e.target.value))} className="w-full accent-brand" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Note (optional)</label>
          <textarea rows={3} value={note} onChange={e => setNote(e.target.value)} className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" placeholder="What changed?" />
        </div>
        <FileUpload bucket="documents" folder="wo-progress-photos" fileUrl={photoUrl} fileName={photoName} onUpload={(url, name) => { setPhotoUrl(url); setPhotoName(name) }} onClear={() => { setPhotoUrl(null); setPhotoName(null) }} accept="image/*" label="Photo (optional)" />
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} disabled={saving} className="rounded-md border dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-60">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Direct-to-site material receipts ─────────────────────────────────
function MaterialReceiptsSection({ workOrderId, projectId, canWrite }: { workOrderId: string; projectId: string; canWrite: boolean }) {
  const qc = useQueryClient()
  const canManage = useCanWriteWoOps(projectId, canWrite)
  const [modalOpen, setModalOpen] = useState(false)
  const { data: receipts = [], isLoading } = useQuery({
    queryKey: ['wo-material-receipts', workOrderId],
    queryFn: async () => {
      const { data, error } = await supabase.from('site_material_receipts').select('*').eq('work_order_id', workOrderId).order('received_at', { ascending: false })
      if (error) throw error
      return data as SiteMaterialReceipt[]
    },
  })

  return (
    <div className="rounded-xl border bg-white p-5 dark:bg-slate-800 dark:border-slate-700 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-300"><Package className="h-4 w-4" /> Direct-to-Site Materials</h2>
        {canManage && (
          <button onClick={() => setModalOpen(true)} className="flex items-center gap-1.5 rounded-md border dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
            <Plus className="h-3.5 w-3.5" /> Log Material Receipt
          </button>
        )}
      </div>
      <p className="text-[11px] text-slate-400">Booked as consumed against this WO — never enters warehouse stock.</p>
      {isLoading ? (
        <div className="py-4 text-center text-sm text-slate-400">Loading…</div>
      ) : receipts.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">No direct-to-site receipts logged yet.</p>
      ) : (
        <div className="divide-y dark:divide-slate-700">
          {receipts.map(r => (
            <div key={r.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-slate-700 dark:text-slate-200">{r.item_description}</p>
                <p className="text-xs text-slate-400">{r.quantity} {r.unit} · {formatDate(r.received_at)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      {modalOpen && (
        <MaterialReceiptModal
          workOrderId={workOrderId}
          projectId={projectId}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['wo-material-receipts', workOrderId] })
            setModalOpen(false)
          }}
        />
      )}
    </div>
  )
}

function MaterialReceiptModal({ workOrderId, projectId, onClose, onSaved }: {
  workOrderId: string; projectId: string; onClose: () => void; onSaved: () => void
}) {
  const { toast } = useToast()
  const { data: mySelf } = useMyStaffId()
  const [itemDescription, setItemDescription] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState('')
  const [notes, setNotes] = useState('')
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photoName, setPhotoName] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!mySelf?.id) return
    if (!itemDescription.trim() || !quantity || !unit.trim()) { toast('Item, quantity, and unit are required', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('site_material_receipts').insert([{
      project_id: projectId, work_order_id: workOrderId,
      item_description: itemDescription.trim(), quantity: parseFloat(quantity), unit: unit.trim(),
      notes: notes.trim() || null, received_by_staff_id: mySelf.id,
      photo_evidence: photoUrl ? [photoUrl] : null,
    }])
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Material receipt logged', 'success')
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl bg-white dark:bg-slate-800 shadow-xl border dark:border-slate-700 p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Log Material Receipt</h3>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Item *</label>
          <input value={itemDescription} onChange={e => setItemDescription(e.target.value)} className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" placeholder="e.g. Cement 50kg bags" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Quantity *</label>
            <input type="number" step="0.01" min="0" value={quantity} onChange={e => setQuantity(e.target.value)} className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Unit *</label>
            <input value={unit} onChange={e => setUnit(e.target.value)} className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" placeholder="bags, pcs, m³…" />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Notes</label>
          <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" placeholder="optional" />
        </div>
        <FileUpload bucket="documents" folder="site-material-receipts" fileUrl={photoUrl} fileName={photoName} onUpload={(url, name) => { setPhotoUrl(url); setPhotoName(name) }} onClear={() => { setPhotoUrl(null); setPhotoName(null) }} accept="image/*" label="Delivery photo (optional)" />
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} disabled={saving} className="rounded-md border dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-60">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Blockers panel: open HSE incidents today + pending purchase requests ──
function BlockersPanel({ projectId }: { projectId: string }) {
  const today = new Date().toISOString().slice(0, 10)
  const { data: incidents = [] } = useQuery({
    queryKey: ['wo-blockers-hse', projectId, today],
    queryFn: async () => {
      const { data, error } = await supabase.from('hse_incidents').select('id, incident_type, severity, description').eq('project_id', projectId).eq('status', 'open').eq('incident_date', today)
      if (error) throw error
      return data as { id: string; incident_type: string; severity: string; description: string | null }[]
    },
  })
  // A purchase request still blocks the WO only while its lines haven't
  // actually arrived. orders.status is a vestigial column — set once at
  // PR creation and never updated by anything, GRN included — so it
  // can't tell "material arrived" from "material never even ordered".
  // The real signal is the sourcing chain: an order_item still blocks
  // if it isn't cancelled AND either hasn't been put into a PO yet, or
  // its PO's linked bundle hasn't been marked fulfilled (which only
  // happens once a GRN is actually recorded against it).
  const { data: pendingOrders = [] } = useQuery({
    queryKey: ['wo-blockers-orders', projectId],
    queryFn: async () => {
      const { data: orders, error: ordersErr } = await supabase
        .from('orders')
        .select('id, order_name, item_service_description')
        .eq('project_id', projectId)
      if (ordersErr) throw ordersErr
      if (!orders || orders.length === 0) return []

      const { data: items, error: itemsErr } = await supabase
        .from('order_items')
        .select('id, order_id, status, sourcing_bundle_items(sourcing_bundles(status))')
        .in('order_id', orders.map(o => o.id))
      if (itemsErr) throw itemsErr

      const stillBlocking = new Set<string>()
      for (const item of items ?? []) {
        if (item.status === 'cancelled') continue
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bundleLinks = (item as any).sourcing_bundle_items as { sourcing_bundles: { status: string } | null }[]
        const anyFulfilled = bundleLinks.some(l => l.sourcing_bundles?.status === 'fulfilled')
        if (!anyFulfilled) stillBlocking.add(item.order_id)
      }
      return orders.filter(o => stillBlocking.has(o.id))
    },
  })

  if (incidents.length === 0 && pendingOrders.length === 0) return null

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900/50 dark:bg-amber-900/10 space-y-3">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-amber-800 dark:text-amber-300"><AlertTriangle className="h-4 w-4" /> Blockers</h2>
      {incidents.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">Open HSE Incidents Today</p>
          <ul className="space-y-1">
            {incidents.map(i => (
              <li key={i.id} className="text-sm text-amber-900 dark:text-amber-200">
                <span className="font-semibold capitalize">{i.incident_type.replace('_', ' ')}</span> ({i.severity}) {i.description && `— ${i.description}`}
              </li>
            ))}
          </ul>
        </div>
      )}
      {pendingOrders.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">Pending Purchase Requests</p>
          <ul className="space-y-1">
            {pendingOrders.map(o => (
              <li key={o.id} className="text-sm text-amber-900 dark:text-amber-200">{o.order_name ?? o.item_service_description ?? 'Untitled request'}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ── Photos grid: progress-update photos + material-receipt photos ────
function PhotosGrid({ workOrderId }: { workOrderId: string }) {
  const { data: progressPhotos = [] } = useQuery({
    queryKey: ['wo-photos-progress', workOrderId],
    queryFn: async () => {
      const { data, error } = await supabase.from('wo_progress_updates').select('photos, created_at').eq('work_order_id', workOrderId).not('photos', 'is', null).order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []).flatMap(r => (r.photos as string[] | null) ?? [])
    },
  })
  const { data: materialPhotos = [] } = useQuery({
    queryKey: ['wo-photos-materials', workOrderId],
    queryFn: async () => {
      const { data, error } = await supabase.from('site_material_receipts').select('photo_evidence, received_at').eq('work_order_id', workOrderId).not('photo_evidence', 'is', null).order('received_at', { ascending: false })
      if (error) throw error
      return (data ?? []).flatMap(r => (r.photo_evidence as string[] | null) ?? [])
    },
  })
  const photos = [...progressPhotos, ...materialPhotos]
  if (photos.length === 0) return null

  return (
    <div className="rounded-xl border bg-white p-5 dark:bg-slate-800 dark:border-slate-700 space-y-3">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-300"><Camera className="h-4 w-4" /> Photos</h2>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {photos.map((url, i) => (
          <a key={`${url}-${i}`} href={url} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-md border dark:border-slate-700 bg-slate-100 dark:bg-slate-700">
            <img src={url} alt="" className="h-full w-full object-cover" />
          </a>
        ))}
      </div>
    </div>
  )
}
