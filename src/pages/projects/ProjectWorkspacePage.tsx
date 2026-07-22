import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatCurrencyCompact, formatDate } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { KpiCard } from '@/components/shared/KpiCard'
import { BudgetGroupBar } from '@/components/shared/BudgetGroupBar'
import { ProgressVsSpendCard } from '@/components/shared/ProgressVsSpendCard'
import { RecentActivityFeed, type ActivityItem } from '@/components/shared/RecentActivityFeed'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { useStaff } from '@/hooks/useLookups'
import type {
  Project, ProjectStage, ProjectHealth, ProjectCostGroupBudget, ProjectBudgetSummary,
  CostGroup, BudgetVariation, BudgetCheckMode, LaborAllocation, LaborAllocationInsert, LaborAllocationStatus,
} from '@/types/database'
import {
  ChevronLeft, Building2, User, CalendarClock, Wallet, Receipt,
  Clock3, TrendingUp, TrendingDown, ShieldCheck, AlertTriangle, Package, TruckIcon, ClipboardCheck,
  Handshake, PenTool, ClipboardList, HardHat, CheckCircle2, FileCheck2, Pencil, X, Plus, History, Check,
  Trash2, UserPlus,
} from 'lucide-react'

type ProjectDetail = Project & {
  staff: { employee_name: string } | null
  clients: { client_name: string } | null
  locations: { location_name: string } | null
}

const HEALTH_CLS: Record<string, string> = {
  'On Track':  'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  'At Risk':   'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  'Off Track': 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
}

// Operations manual §6.1 — seven lifecycle gates, in order
const STAGE_STEPS: { stage: ProjectStage; label: string; icon: React.ReactNode }[] = [
  { stage: 'business_development',          label: 'Business Dev',    icon: <Handshake className="h-3.5 w-3.5" /> },
  { stage: 'design_approvals',               label: 'Design',          icon: <PenTool className="h-3.5 w-3.5" /> },
  { stage: 'pre_construction_mobilization',  label: 'Mobilization',    icon: <ClipboardList className="h-3.5 w-3.5" /> },
  { stage: 'procurement_logistics',          label: 'Procurement',     icon: <Package className="h-3.5 w-3.5" /> },
  { stage: 'site_execution',                 label: 'Site Execution',  icon: <HardHat className="h-3.5 w-3.5" /> },
  { stage: 'quality_snagging_handover',      label: 'Snagging',        icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  { stage: 'closeout_final_accounts',        label: 'Closeout',        icon: <FileCheck2 className="h-3.5 w-3.5" /> },
]
const STAGE_ORDER: ProjectStage[] = STAGE_STEPS.map(s => s.stage)
const HEALTH_OPTIONS: ProjectHealth[] = ['On Track', 'At Risk', 'Off Track']

const inputCls = 'w-full rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  const diff = new Date(dateStr).getTime() - new Date().setHours(0, 0, 0, 0)
  return Math.round(diff / 86400000)
}

// ── Labor Tier 1: routine staff assignment, no approval ─────────────────────
// Deliberately as fast as logging a verbal assignment — a PM/site lead adds a
// row directly, no gate to route around, per the two-tier labor design.
const ALLOCATION_STATUSES: LaborAllocationStatus[] = ['planned', 'active', 'completed', 'cancelled']

function LaborAllocationsSection({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const { toast } = useToast()
  const { profile } = useAuth()
  const qc = useQueryClient()
  const { data: staff = [] } = useStaff()
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<Partial<LaborAllocationInsert>>({ status: 'active' })

  const staffOptions = staff.map((s: any) => ({ id: s.id, label: s.employee_name }))

  const { data = [], isLoading } = useQuery({
    queryKey: ['project-labor-allocations', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('labor_allocations')
        .select('*, staff(employee_name)')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as (LaborAllocation & { staff: { employee_name: string } | null })[]
    },
  })

  function set(key: keyof LaborAllocationInsert, value: unknown) { setForm(f => ({ ...f, [key]: value })) }
  function resetForm() { setForm({ status: 'active' }) }

  async function handleAdd() {
    if (!form.staff_id || !form.start_date) { toast('Staff member and start date are required', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('labor_allocations').insert([{
      ...form, project_id: projectId, assigned_by: profile?.id ?? null,
    }])
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['project-labor-allocations', projectId] })
    qc.invalidateQueries({ queryKey: ['project-budget-groups', projectId] })
    toast('Staff assigned', 'success')
    resetForm()
    setShowAdd(false)
  }

  async function handleDelete(allocId: string) {
    if (!window.confirm('Remove this labor allocation? This cannot be undone.')) return
    const { error } = await supabase.from('labor_allocations').delete().eq('id', allocId)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['project-labor-allocations', projectId] })
    qc.invalidateQueries({ queryKey: ['project-budget-groups', projectId] })
    toast('Allocation removed', 'success')
  }

  const STATUS_CLS: Record<LaborAllocationStatus, string> = {
    planned:   'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
    active:    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    cancelled: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
  }

  return (
    <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
          <HardHat className="h-4 w-4" /> Labor Assignments
        </h3>
        <div className="flex items-center gap-2">
          {canManage && (
            <Link to="/labor-requisitions/new"
              className="text-xs text-slate-400 hover:text-brand transition-colors">
              Need new/casual labor? Request it →
            </Link>
          )}
          {canManage && (
            <button
              onClick={() => setShowAdd(s => !s)}
              className="flex items-center gap-1.5 rounded-md border dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              {showAdd ? <X className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />} {showAdd ? 'Cancel' : 'Assign Staff'}
            </button>
          )}
        </div>
      </div>

      {showAdd && (
        <div className="rounded-lg border dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Staff Member *</label>
              <SearchableSelect value={form.staff_id ?? null} onChange={v => set('staff_id', v)} options={staffOptions} placeholder="Select staff…" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Start Date *</label>
              <input type="date" className={inputCls} value={form.start_date ?? ''} onChange={e => set('start_date', e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">End Date</label>
              <input type="date" className={inputCls} value={form.end_date ?? ''} onChange={e => set('end_date', e.target.value || null)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Status</label>
              <select className={inputCls} value={form.status ?? 'active'} onChange={e => set('status', e.target.value as LaborAllocationStatus)}>
                {ALLOCATION_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="col-span-2 sm:col-span-3">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Notes</label>
              <input type="text" className={inputCls} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => { setShowAdd(false); resetForm() }} className="rounded-md px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
            <button onClick={handleAdd} disabled={saving} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-60">
              {saving ? 'Saving…' : 'Assign'}
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
      ) : data.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">No staff assigned to this project yet</p>
      ) : (
        <div className="divide-y dark:divide-slate-700">
          {data.map(a => (
            <div key={a.id} className="py-2.5 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm text-slate-700 dark:text-slate-200">
                  <span className="font-medium">{a.staff?.employee_name ?? '—'}</span>
                  {a.day_rate_snapshot != null && <span className="text-xs text-slate-400"> · {formatCurrency(a.day_rate_snapshot)}/day</span>}
                </p>
                <p className="text-xs text-slate-400">
                  {formatDate(a.start_date)} – {a.end_date ? formatDate(a.end_date) : 'ongoing'}
                  {a.notes && <> · {a.notes}</>}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${STATUS_CLS[a.status]}`}>{a.status}</span>
                {canManage && (
                  <button onClick={() => handleDelete(a.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20" title="Remove">
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

export default function ProjectWorkspacePage() {
  const { id } = useParams<{ id: string }>()
  const { role, profile } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const canManageBudget = role === 'admin' || role === 'manager' || role === 'finance'
  // Matches labor_allocations' RLS write policy (093)
  const canManageLabor = role === 'admin' || role === 'manager' || role === 'project_manager' || role === 'operations_manager'

  const { data: project, isLoading: loadingProject, error: projectError } = useQuery({
    queryKey: ['project-workspace', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('*, staff(employee_name), clients(client_name), locations!location_id(location_name)')
        .eq('id', id!)
        .single()
      if (error) throw error
      return data as unknown as ProjectDetail
    },
    enabled: !!id,
  })

  const { data: summary } = useQuery({
    queryKey: ['project-budget-summary', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_project_budget_summary').select('*').eq('project_id', id!).maybeSingle()
      if (error) throw error
      return data as ProjectBudgetSummary | null
    },
    enabled: !!id,
  })

  const { data: groups = [] } = useQuery({
    queryKey: ['project-budget-groups', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_project_cost_group_budget')
        .select('*')
        .eq('project_id', id!)
        .order('sort_order')
      if (error) throw error
      return data as ProjectCostGroupBudget[]
    },
    enabled: !!id,
  })

  const { data: costGroups = [] } = useQuery({
    queryKey: ['cost-groups'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cost_groups').select('*').order('sort_order')
      if (error) throw error
      return data as CostGroup[]
    },
  })

  const { data: checkMode } = useQuery({
    queryKey: ['budget-check-mode'],
    queryFn: async () => {
      const { data, error } = await supabase.from('budget_check_mode').select('*').maybeSingle()
      if (error) throw error
      return data as BudgetCheckMode | null
    },
  })

  const { data: variations = [] } = useQuery({
    queryKey: ['project-budget-variations', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('budget_variations')
        .select('*, cost_groups(name), requester:user_profiles!budget_variations_requested_by_fkey(full_name), approver:user_profiles!budget_variations_approved_by_fkey(full_name)')
        .eq('project_id', id!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as (BudgetVariation & { cost_groups: { name: string } | null; requester: { full_name: string } | null; approver: { full_name: string } | null })[]
    },
    enabled: !!id,
  })

  const { data: recentExpenses = [] } = useQuery({
    queryKey: ['project-workspace-expenses', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('id, expense_code, item_service_description, amount_etb, date, payment_status')
        .eq('project_id', id!)
        .order('date', { ascending: false })
        .limit(8)
      if (error) throw error
      return data
    },
    enabled: !!id,
  })

  const { data: openBundles = [] } = useQuery({
    queryKey: ['project-workspace-bundles', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sourcing_bundle_items')
        .select('bundle_id, sourcing_bundles(id, bundle_code, status, created_at), order_items!inner(orders!inner(project_id))')
        .eq('order_items.orders.project_id', id!)
      if (error) throw error
      const seen = new Map<string, { id: string; bundle_code: string; status: string; created_at: string }>()
      for (const row of data as any[]) {
        const b = row.sourcing_bundles
        if (b && !seen.has(b.id)) seen.set(b.id, b)
      }
      return [...seen.values()]
    },
    enabled: !!id,
  })

  const { data: transportJobs = [] } = useQuery({
    queryKey: ['project-workspace-transport', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transportation_requests')
        .select('id, request_name, job_status, requested_date')
        .eq('project_id', id!)
        .order('requested_date', { ascending: false })
        .limit(8)
      if (error) throw error
      return data
    },
    enabled: !!id,
  })

  const { data: pendingGrns = [] } = useQuery({
    queryKey: ['project-workspace-grns', id],
    queryFn: async () => {
      const bundleIds = openBundles.filter(b => b.status === 'ordered').map(b => b.id)
      if (bundleIds.length === 0) return []
      const { data, error } = await supabase
        .from('goods_received_notes')
        .select('id, grn_code, sourcing_bundle_id, received_at')
        .in('sourcing_bundle_id', bundleIds)
      if (error) throw error
      return data
    },
    enabled: !!id && openBundles.length > 0,
  })

  // ── Project details edit (contract value, handover date, progress, health) ──
  const [editingDetails, setEditingDetails] = useState(false)
  const [detailsForm, setDetailsForm] = useState<{ contract_value: string; target_handover_date: string; physical_progress: string; health: ProjectHealth | '' }>({
    contract_value: '', target_handover_date: '', physical_progress: '', health: '',
  })
  const [savingDetails, setSavingDetails] = useState(false)

  function openDetailsEditor() {
    if (!project) return
    setDetailsForm({
      contract_value: project.contract_value != null ? String(project.contract_value) : '',
      target_handover_date: project.target_handover_date ?? '',
      physical_progress: project.physical_progress != null ? String(project.physical_progress) : '',
      health: project.health ?? '',
    })
    setEditingDetails(true)
  }

  async function saveDetails() {
    setSavingDetails(true)
    const { error } = await supabase.from('projects').update({
      contract_value: detailsForm.contract_value ? parseFloat(detailsForm.contract_value) : null,
      target_handover_date: detailsForm.target_handover_date || null,
      physical_progress: detailsForm.physical_progress ? parseFloat(detailsForm.physical_progress) : null,
      health: detailsForm.health || null,
    }).eq('id', id!)
    setSavingDetails(false)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['project-workspace', id] })
    toast('Project details updated', 'success')
    setEditingDetails(false)
  }

  // ── Stage editor ──
  const [pendingStage, setPendingStage] = useState<ProjectStage | ''>('')
  const [confirmLockOpen, setConfirmLockOpen] = useState(false)
  const [savingStage, setSavingStage] = useState(false)

  async function applyStageChange(nextStage: ProjectStage) {
    setSavingStage(true)
    const { error } = await supabase.from('projects').update({ stage: nextStage }).eq('id', id!)
    setSavingStage(false)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['project-workspace', id] })
    qc.invalidateQueries({ queryKey: ['project-budget-summary', id] })
    qc.invalidateQueries({ queryKey: ['project-budget-groups', id] })
    toast('Project stage updated', 'success')
    setPendingStage('')
    setConfirmLockOpen(false)
  }

  function handleStageSelect(nextStage: ProjectStage) {
    if (!project) return
    const isLockGate = project.stage === 'pre_construction_mobilization' && nextStage === 'procurement_logistics'
    if (isLockGate && !project.budget_baseline_locked_at) {
      setPendingStage(nextStage)
      setConfirmLockOpen(true)
    } else {
      applyStageChange(nextStage)
    }
  }

  // ── Budget editor (per cost group, unlocked only) ──
  const [editingBudget, setEditingBudget] = useState(false)
  const [budgetForm, setBudgetForm] = useState<Record<string, string>>({})
  const [savingBudget, setSavingBudget] = useState(false)

  function openBudgetEditor() {
    const next: Record<string, string> = {}
    for (const g of costGroups) {
      const row = groups.find(r => r.cost_group_id === g.id)
      next[g.id] = row ? String(row.budgeted_amount) : '0'
    }
    setBudgetForm(next)
    setEditingBudget(true)
  }

  async function saveBudget() {
    if (!project) return
    setSavingBudget(true)
    const rows = costGroups.map(g => ({
      project_id: id!,
      cost_group_id: g.id,
      budgeted_amount: parseFloat(budgetForm[g.id] || '0') || 0,
      version: project.budget_version,
      created_by: profile?.id ?? null,
    }))
    const { error } = await supabase.from('project_budgets').upsert(rows, { onConflict: 'project_id,cost_group_id,version' })
    setSavingBudget(false)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['project-budget-groups', id] })
    qc.invalidateQueries({ queryKey: ['project-budget-summary', id] })
    toast('Budget saved', 'success')
    setEditingBudget(false)
  }

  // ── Variation request ──
  const [variationGroup, setVariationGroup] = useState<ProjectCostGroupBudget | null>(null)
  const [variationDelta, setVariationDelta] = useState('')
  const [variationReason, setVariationReason] = useState('')
  const [savingVariation, setSavingVariation] = useState(false)

  async function submitVariation() {
    if (!variationGroup?.cost_group_id || !variationDelta || !variationReason.trim()) { toast('Enter an amount and a reason', 'error'); return }
    setSavingVariation(true)
    const { error } = await supabase.from('budget_variations').insert([{
      project_id: id!,
      cost_group_id: variationGroup.cost_group_id,
      requested_amount_delta: parseFloat(variationDelta),
      reason: variationReason.trim(),
      requested_by: profile?.id ?? null,
    }])
    setSavingVariation(false)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['project-budget-variations', id] })
    toast('Variation requested', 'success')
    setVariationGroup(null)
    setVariationDelta('')
    setVariationReason('')
  }

  async function decideVariation(variationId: string, status: 'approved' | 'rejected') {
    const { error } = await supabase.from('budget_variations').update({ status, approved_by: profile?.id ?? null }).eq('id', variationId)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['project-budget-variations', id] })
    qc.invalidateQueries({ queryKey: ['project-budget-groups', id] })
    qc.invalidateQueries({ queryKey: ['project-budget-summary', id] })
    qc.invalidateQueries({ queryKey: ['project-workspace', id] })
    toast(`Variation ${status}`, status === 'approved' ? 'success' : 'error')
  }

  if (loadingProject) return <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
  if (projectError) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm font-medium text-red-500">Couldn't load this project</p>
        <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">{(projectError as { message?: string }).message ?? String(projectError)}</p>
      </div>
    )
  }
  if (!project) return <div className="py-16 text-center text-sm text-slate-400">Project not found.</div>

  const daysLeft = daysUntil(project.target_handover_date)
  const budgetUsedPct = summary && summary.total_budget > 0
    ? ((summary.total_actual_core + summary.total_committed_core) / summary.total_budget) * 100
    : null
  const isLocked = !!project.budget_baseline_locked_at

  const activityItems: ActivityItem[] = [
    ...recentExpenses.map(e => ({
      id: `exp-${e.id}`,
      label: e.item_service_description ?? e.expense_code ?? 'Expense',
      sub: `${e.expense_code ?? ''} · ${e.amount_etb != null ? formatCurrency(e.amount_etb) : ''} · ${e.payment_status ? 'Paid' : 'Unpaid'}`,
      date: e.date,
      to: `/expenses/${e.id}`,
      icon: Receipt,
    })),
    ...openBundles.map(b => ({
      id: `po-${b.id}`,
      label: b.bundle_code,
      sub: `Purchase Order · ${b.status}`,
      date: b.created_at,
      to: `/sourcing/${b.id}`,
      icon: Package,
    })),
    ...pendingGrns.map(g => ({
      id: `grn-${g.id}`,
      label: g.grn_code,
      sub: 'Goods Received Note',
      date: g.received_at,
      to: `/sourcing/${g.sourcing_bundle_id}`,
      icon: ClipboardCheck,
    })),
    ...transportJobs.map(t => ({
      id: `tr-${t.id}`,
      label: t.request_name ?? 'Transport job',
      sub: `Transport · ${t.job_status.replace('_', ' ')}`,
      date: t.requested_date,
      to: `/transportation/${t.id}/edit`,
      icon: TruckIcon,
    })),
  ]

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Link to="/projects" className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">{project.project_name}</h1>
              {project.health && (
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${HEALTH_CLS[project.health] ?? ''}`}>
                  {project.health}
                </span>
              )}
              {summary?.budget_baseline_locked_at && (
                <span className="flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-700 px-2.5 py-0.5 text-[11px] font-medium text-slate-500 dark:text-slate-300">
                  <ShieldCheck className="h-3 w-3" /> Baseline locked {formatDate(summary.budget_baseline_locked_at)}
                </span>
              )}
              {checkMode && (
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${checkMode.enforcing ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                  Budget checks: {checkMode.enforcing ? 'enforcing' : 'preview only'}
                </span>
              )}
              {canManageBudget && (
                <button onClick={openDetailsEditor} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-600" title="Edit project details">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-3 flex-wrap mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /> {project.clients?.client_name ?? '—'}</span>
              <span className="flex items-center gap-1"><User className="h-3.5 w-3.5" /> {project.staff?.employee_name ?? '—'}</span>
              {project.target_handover_date && (
                <span className="flex items-center gap-1">
                  <CalendarClock className="h-3.5 w-3.5" /> {formatDate(project.target_handover_date)}
                  {daysLeft != null && (
                    <span className={daysLeft < 0 ? 'text-red-500 font-medium' : ''}>
                      {' '}({daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d left`})
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Project details editor */}
      {editingDetails && (
        <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Edit Project Details</h3>
            <button onClick={() => setEditingDetails(false)} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Contract Value (ETB)</label>
              <input type="number" step="0.01" className={inputCls} value={detailsForm.contract_value} onChange={e => setDetailsForm(f => ({ ...f, contract_value: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Target Handover</label>
              <input type="date" className={inputCls} value={detailsForm.target_handover_date} onChange={e => setDetailsForm(f => ({ ...f, target_handover_date: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Physical Progress (%)</label>
              <input type="number" min={0} max={100} className={inputCls} value={detailsForm.physical_progress} onChange={e => setDetailsForm(f => ({ ...f, physical_progress: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Health</label>
              <select className={inputCls} value={detailsForm.health} onChange={e => setDetailsForm(f => ({ ...f, health: e.target.value as ProjectHealth }))}>
                <option value="">— Select —</option>
                {HEALTH_OPTIONS.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={saveDetails} disabled={savingDetails} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-60">
              {savingDetails ? 'Saving…' : 'Save Details'}
            </button>
          </div>
        </div>
      )}

      {/* Stage timeline + editor */}
      {project.stage && (
        <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 px-5 py-4 shadow-sm space-y-3">
          <div className="flex items-center gap-0">
            {STAGE_STEPS.map((step, i) => {
              const stageIdx = STAGE_ORDER.indexOf(project.stage!)
              const stepIdx = STAGE_ORDER.indexOf(step.stage)
              const isComplete = stageIdx > stepIdx
              const isCurrent = stageIdx === stepIdx
              return (
                <div key={step.stage} className="flex items-center flex-1 min-w-0">
                  <div className={`flex items-center gap-1.5 shrink-0 ${
                    isComplete ? 'text-green-500' : isCurrent ? 'text-brand' : 'text-slate-300 dark:text-slate-600'
                  }`}>
                    <div className={`rounded-full p-1.5 ${
                      isComplete ? 'bg-green-50 dark:bg-green-900/20' : isCurrent ? 'bg-brand/10' : 'bg-slate-100 dark:bg-slate-700'
                    }`}>
                      {step.icon}
                    </div>
                    <span className={`text-[10px] font-medium hidden sm:block whitespace-nowrap ${
                      isCurrent ? 'text-brand' : isComplete ? 'text-green-600 dark:text-green-400' : ''
                    }`}>{step.label}</span>
                  </div>
                  {i < STAGE_STEPS.length - 1 && (
                    <div className={`h-px flex-1 mx-2 ${isComplete ? 'bg-green-300 dark:bg-green-700' : 'bg-slate-200 dark:bg-slate-700'}`} />
                  )}
                </div>
              )
            })}
          </div>
          {canManageBudget && (
            <div className="flex items-center gap-2 pt-2 border-t dark:border-slate-700">
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Change stage:</label>
              <select
                className={`${inputCls} max-w-xs`}
                value=""
                disabled={savingStage}
                onChange={e => { if (e.target.value) handleStageSelect(e.target.value as ProjectStage) }}
              >
                <option value="">— Select new stage —</option>
                {STAGE_STEPS.filter(s => s.stage !== project.stage).map(s => (
                  <option key={s.stage} value={s.stage}>{s.label}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Stage 3->4 lock confirmation */}
      {confirmLockOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white dark:bg-slate-800 p-5 shadow-xl space-y-3">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-amber-500" /> Lock Budget?
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              This locks the approved budget for {project.project_name}. Budgets can only change afterward through a variation order. Continue?
            </p>
            <div className="flex items-center gap-2 justify-end pt-1">
              <button onClick={() => { setConfirmLockOpen(false); setPendingStage('') }} className="rounded-md px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">
                Cancel
              </button>
              <button
                onClick={() => pendingStage && applyStageChange(pendingStage)}
                disabled={savingStage}
                className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
              >
                {savingStage ? 'Locking…' : 'Lock Budget & Continue'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Summary band — compact currency notation (full value on hover/tap-hold) so tiles don't overflow on phone-width screens.
          Order: Remaining and Committed lead (top row on the grid-cols-2 mobile reflow) since those are what a PM checking
          their phone mid-day needs first; Contract Value and Projected Margin trail, reachable one scroll further down. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard
          label="Remaining"
          value={summary ? formatCurrencyCompact(summary.total_budget - summary.total_actual_core - summary.total_committed_core) : '—'}
          title={summary ? formatCurrency(summary.total_budget - summary.total_actual_core - summary.total_committed_core) : undefined}
          icon={summary?.any_group_over_budget ? AlertTriangle : Wallet}
          color={summary?.any_group_over_budget ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-600'}
        />
        <KpiCard
          label="Committed"
          value={summary ? formatCurrencyCompact(summary.total_committed_core) : '—'}
          title={summary ? formatCurrency(summary.total_committed_core) : undefined}
          sub={summary ? `${formatCurrencyCompact(summary.total_committed_with_labor)} incl. labor` : undefined}
          icon={Clock3} color="bg-amber-50 text-amber-600"
        />
        <KpiCard
          label="Cost Budget"
          value={summary ? formatCurrencyCompact(summary.total_budget) : '—'}
          title={summary ? formatCurrency(summary.total_budget) : undefined}
          icon={Wallet} color="bg-slate-100 text-slate-600"
        />
        <KpiCard
          label="Actual (Paid)"
          value={summary ? formatCurrencyCompact(summary.total_actual_core) : '—'}
          title={summary ? formatCurrency(summary.total_actual_core) : undefined}
          sub={summary ? `${formatCurrencyCompact(summary.total_actual_with_labor)} incl. labor` : undefined}
          icon={Receipt} color="bg-emerald-50 text-emerald-600"
        />
        <KpiCard
          label="Contract Value"
          value={project.contract_value != null ? formatCurrencyCompact(project.contract_value) : '—'}
          title={project.contract_value != null ? formatCurrency(project.contract_value) : undefined}
          icon={Wallet} color="bg-blue-50 text-blue-600"
        />
        <KpiCard
          label="Projected Margin"
          value={summary?.projected_margin_core != null ? `${(summary.projected_margin_core * 100).toFixed(1)}%` : '—'}
          sub={summary?.bid_margin != null ? `bid ${(summary.bid_margin * 100).toFixed(1)}%` : undefined}
          icon={summary?.projected_margin_core != null && summary.bid_margin != null && summary.projected_margin_core < summary.bid_margin ? TrendingDown : TrendingUp}
          color="bg-purple-50 text-purple-600"
        />
      </div>

      {/* Budget vs actual by cost group + progress vs spend */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-3">
          <BudgetGroupBar title="Budget vs Actual by Cost Group" groups={groups} />
          {canManageBudget && (
            <div className="flex items-center gap-2 flex-wrap">
              {!isLocked && (
                <button onClick={editingBudget ? saveBudget : openBudgetEditor} disabled={savingBudget}
                  className="flex items-center gap-1.5 rounded-md border dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60">
                  <Pencil className="h-3.5 w-3.5" /> {savingBudget ? 'Saving…' : editingBudget ? 'Save Budget' : 'Set Budget'}
                </button>
              )}
              {groups.filter(g => g.cost_group_id).map(g => (
                <button key={g.cost_group_id} onClick={() => { setVariationGroup(g); setVariationDelta(''); setVariationReason('') }}
                  className="flex items-center gap-1 rounded-full border dark:border-slate-600 px-2.5 py-1 text-[11px] text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700">
                  <Plus className="h-3 w-3" /> Vary {g.cost_group_name}
                </button>
              ))}
            </div>
          )}
          {editingBudget && !isLocked && (
            <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm space-y-2">
              {costGroups.map(g => (
                <div key={g.id} className="flex items-center justify-between gap-3">
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-300 w-28 shrink-0">{g.name}</label>
                  <input type="number" step="0.01" className={inputCls} value={budgetForm[g.id] ?? ''} onChange={e => setBudgetForm(f => ({ ...f, [g.id]: e.target.value }))} />
                </div>
              ))}
            </div>
          )}
        </div>
        <ProgressVsSpendCard physicalProgress={project.physical_progress} budgetUsedPct={budgetUsedPct} />
      </div>

      {/* Variation request modal */}
      {variationGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white dark:bg-slate-800 p-5 shadow-xl space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Request Variation — {variationGroup.cost_group_name}</h3>
              <button onClick={() => setVariationGroup(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Current Remaining: <span className="font-medium text-slate-700 dark:text-slate-200">{formatCurrency(variationGroup.remaining_amount)}</span>
              {variationDelta && !isNaN(parseFloat(variationDelta)) && (
                <> → Proposed: <span className="font-medium text-slate-700 dark:text-slate-200">{formatCurrency(variationGroup.remaining_amount + parseFloat(variationDelta))}</span></>
              )}
            </p>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Amount Change (ETB, negative to reduce)</label>
              <input type="number" step="0.01" className={inputCls} value={variationDelta} onChange={e => setVariationDelta(e.target.value)} placeholder="e.g. 25000" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Reason *</label>
              <textarea rows={2} className={inputCls} value={variationReason} onChange={e => setVariationReason(e.target.value)} placeholder="Why this change is needed…" />
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button onClick={() => setVariationGroup(null)} className="rounded-md px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
              <button onClick={submitVariation} disabled={savingVariation} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-60">
                {savingVariation ? 'Submitting…' : 'Submit Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Variation history */}
      {variations.length > 0 && (
        <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
            <History className="h-4 w-4" /> Variation History
          </h3>
          <div className="mt-3 divide-y dark:divide-slate-700">
            {variations.map(v => (
              <div key={v.id} className="py-2.5 flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm text-slate-700 dark:text-slate-200">
                    <span className="font-medium">{v.cost_groups?.name ?? '—'}</span>
                    {' '}{v.requested_amount_delta >= 0 ? '+' : ''}{formatCurrency(v.requested_amount_delta)}
                    {v.resulting_version && <span className="text-slate-400 text-xs"> · v{v.resulting_version}</span>}
                  </p>
                  <p className="text-xs text-slate-400 truncate max-w-md">{v.reason} — {v.requester?.full_name ?? 'unknown'}, {formatDate(v.created_at)}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {v.status === 'pending' && canManageBudget ? (
                    <>
                      <button onClick={() => decideVariation(v.id, 'approved')} className="flex items-center gap-1 rounded-md bg-green-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-green-700">
                        <Check className="h-3 w-3" /> Approve
                      </button>
                      <button onClick={() => decideVariation(v.id, 'rejected')} className="flex items-center gap-1 rounded-md border border-red-200 dark:border-red-800/40 px-2.5 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
                        <X className="h-3 w-3" /> Reject
                      </button>
                    </>
                  ) : (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${
                      v.status === 'approved' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                      : v.status === 'rejected' ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                      : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                    }`}>{v.status}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Labor Tier 1: routine assignment, no approval */}
      <LaborAllocationsSection projectId={id!} canManage={canManageLabor} />

      {/* Activity */}
      <RecentActivityFeed title="Recent Activity" items={activityItems} emptyText="No activity recorded for this project yet" />
    </div>
  )
}
