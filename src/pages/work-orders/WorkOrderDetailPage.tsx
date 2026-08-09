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
import { useStaffDirectory } from '@/hooks/useLookups'
import { useMyStaffId } from '@/hooks/useMyStaff'
import {
  useWorkOrderTeam, useWorkOrderRatings, useUpsertWorkOrderRating, useDeleteWorkOrderRating,
  type WorkOrderRatingRow,
} from '@/hooks/useWorkOrderRatings'
import type { WorkOrder, WorkOrderCostRow, LaborAllocation, StockIssue } from '@/types/database'
import { ArrowLeft, Pencil, Plus, Star, Trash2, X } from 'lucide-react'

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
      {lower(wo.status) === 'completed' && (
        <TeamRatings workOrderId={wo.id} leadStaffId={wo.assigned_lead_staff_id ?? null} />
      )}
    </div>
  )
}

function lower(s: string | null | undefined): string { return (s ?? '').toLowerCase() }

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
