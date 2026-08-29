import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { HardHat, RefreshCw, ChevronRight, Play, Coins, Layers, Undo2, AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useAccounts } from '@/hooks/useLookups'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { RollupIntegrityRow } from '@/types/database'

interface RollupPreview {
  worker_count: number
  total_units: number
  unit_label: string
  total_amount: number
}

interface DraftRow {
  id: string
  amount_etb: number | null
  date: string | null
  item_service_description: string | null
  approval_status: string
  payment_state: string
  is_archived: boolean
  rolled_up_from_requisition_id: string
  rollup_period_start: string | null
  rollup_period_end: string | null
  project_id: string
  projects: { project_name: string } | null
  vendor_id: string | null
  vendors: { vendor_name: string } | null
  paid_to_staff_id: string | null
  paid_to_staff: { employee_name: string } | null
  labor_requisitions: { payment_basis: string; volume_unit: string | null } | null
}

interface RequisitionRow {
  id: string
  role_needed: string
  project_id: string
  payment_model: string
  pay_cycle: string
  start_date: string
  end_date: string | null
  estimated_total_cost: number | null
  projects: { project_name: string } | null
}

// Finance's rollup review page. Lists the auto-generated draft expenses from
// `rollup_labor_timesheets_to_expense` and offers a "Roll up now" launcher for
// the approved requisitions that don't have coverage for the last week yet.
export default function LaborExpenseDraftsPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { session } = useAuth()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batching, setBatching] = useState(false)
  const [batchAccountId, setBatchAccountId] = useState<string | null>(null)
  const [batchPaymentMethod, setBatchPaymentMethod] = useState<'batch_wire' | 'cash'>('batch_wire')
  const { data: accounts = [] } = useAccounts()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accountOptions = useMemo(() => accounts.map((a: any) => ({ id: a.id, label: a.account_name })), [accounts])

  // Settled rollups are archived rather than deleted (migration 263) — the
  // queue is for what finance still has to act on, but the history stays
  // reachable behind the toggle.
  const [showArchived, setShowArchived] = useState(false)
  const [projectFilter, setProjectFilter] = useState<string | null>(null)

  const { data: drafts = [], isLoading } = useQuery({
    queryKey: ['labor-expense-drafts', showArchived],
    queryFn: async () => {
      let q = supabase
        .from('expenses')
        .select('id, amount_etb, date, item_service_description, approval_status, payment_state, is_archived, rolled_up_from_requisition_id, rollup_period_start, rollup_period_end, project_id, projects(project_name), vendor_id, vendors(vendor_name), paid_to_staff_id, paid_to_staff:staff!expenses_paid_to_staff_id_fkey(employee_name), labor_requisitions:rolled_up_from_requisition_id(payment_basis, volume_unit)')
        .not('rolled_up_from_requisition_id', 'is', null)
      if (!showArchived) q = q.eq('is_archived', false)
      const { data, error } = await q.order('date', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as DraftRow[]
    },
  })

  // Standing check for the fan-out class of bug (migration 264): a rollup's
  // recorded days must equal the attendance stamped to it. Empty is healthy,
  // and it stays invisible in that case — this only appears when something
  // is genuinely wrong, because that failure mode inflates money silently.
  const { data: integrityIssues = [] } = useQuery({
    queryKey: ['rollup-integrity-check'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_rollup_integrity_check').select('*')
      if (error) throw error
      return (data ?? []) as RollupIntegrityRow[]
    },
  })

  const { data: activeReqs = [] } = useQuery({
    queryKey: ['approved-labor-requisitions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('labor_requisitions')
        .select('id, role_needed, project_id, payment_model, pay_cycle, start_date, end_date, estimated_total_cost, projects(project_name)')
        .eq('status', 'approved')
        .order('start_date', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as RequisitionRow[]
    },
  })

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  function toggle(id: string) {
    setExpanded(s => { const o = new Set(s); if (o.has(id)) o.delete(id); else o.add(id); return o })
  }

  async function runRollup(requisitionId: string, from: string, to: string) {
    const { data, error } = await supabase.rpc('rollup_labor_timesheets_to_expense', {
      p_labor_requisition_id: requisitionId,
      p_period_start: from,
      p_period_end: to,
    })
    if (error) { toast(error.message, 'error'); return }
    toast(`Rollup complete → expense ${String(data).slice(0, 8)}`, 'success')
    qc.invalidateQueries({ queryKey: ['labor-expense-drafts'] })
    qc.invalidateQueries({ queryKey: ['labor-rollup-preview', requisitionId] })
  }

  // Undo a draft rollup so the timesheets behind it can be corrected and
  // rolled up again — the rollup itself is idempotent per requisition +
  // period, so without this a bad draft can never be rebuilt.
  async function undoRollup(draft: DraftRow) {
    if (!window.confirm(
      `Delete this rollup draft (${formatCurrency(draft.amount_etb ?? 0)}) and release its timesheets?\n\n` +
      `Nothing is paid out by this — it removes the draft expense and its worker breakdown, so you can fix the ` +
      `timesheet data and run the rollup for ${draft.rollup_period_start} → ${draft.rollup_period_end} again.`
    )) return
    const { data, error } = await supabase.rpc('undo_labor_rollup', { p_expense_id: draft.id })
    if (error) { toast(error.message, 'error'); return }
    toast(String(data), 'success')
    setSelectedIds(s => { const o = new Set(s); o.delete(draft.id); return o })
    qc.invalidateQueries({ queryKey: ['labor-expense-drafts'] })
    qc.invalidateQueries({ queryKey: ['labor-rollup-preview', draft.rolled_up_from_requisition_id] })
  }

  function toggleSelect(id: string) {
    setSelectedIds(s => { const o = new Set(s); if (o.has(id)) o.delete(id); else o.add(id); return o })
  }

  const selectedDrafts = useMemo(() => drafts.filter(d => selectedIds.has(d.id)), [drafts, selectedIds])
  const selectedTotal = useMemo(() => selectedDrafts.reduce((sum, d) => sum + (d.amount_etb ?? 0), 0), [selectedDrafts])

  async function createBatch() {
    if (selectedDrafts.length === 0 || !session?.user.id) return
    if (!batchAccountId && batchPaymentMethod !== 'cash') { toast('Select which account is funding this batch payment', 'error'); return }
    setBatching(true)
    const projectNames = Array.from(new Set(selectedDrafts.map(d => d.projects?.project_name).filter(Boolean)))
    const dates = selectedDrafts.map(d => d.rollup_period_end ?? d.date).filter(Boolean) as string[]
    const scope = projectNames.length === 1 ? projectNames[0] : `${projectNames.length} projects`
    const paymentCode = `Labor Batch — ${scope} — ${formatDate(dates.sort()[dates.length - 1] ?? new Date().toISOString())}`
    const { data, error } = await supabase.rpc('create_batch_payment', {
      p_expense_ids: Array.from(selectedIds),
      p_assignee_id: session.user.id,
      p_account_id: batchPaymentMethod === 'cash' ? null : batchAccountId,
      p_payment_method: batchPaymentMethod,
      p_payment_code: paymentCode,
      p_notes: null,
    })
    setBatching(false)
    if (error) { toast(error.message, 'error'); return }
    setSelectedIds(new Set())
    setBatchAccountId(null)
    qc.invalidateQueries({ queryKey: ['labor-expense-drafts'] })
    toast('Batch payment created', 'success')
    navigate(`/batch-payments/${data}`)
  }

  // Project options come from what's actually on this page — drafts and
  // approved requisitions — so the filter can never offer an empty project.
  const projectOptions = useMemo(() => {
    const m = new Map<string, string>()
    for (const d of drafts) if (d.project_id) m.set(d.project_id, d.projects?.project_name ?? '—')
    for (const r of activeReqs) if (r.project_id) m.set(r.project_id, r.projects?.project_name ?? '—')
    return [...m.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label))
  }, [drafts, activeReqs])

  const visibleDrafts = useMemo(
    () => projectFilter ? drafts.filter(d => d.project_id === projectFilter) : drafts,
    [drafts, projectFilter]
  )
  const visibleReqs = useMemo(
    () => projectFilter ? activeReqs.filter(r => r.project_id === projectFilter) : activeReqs,
    [activeReqs, projectFilter]
  )

  const draftsByReq = useMemo(() => {
    const m = new Map<string, DraftRow[]>()
    for (const d of visibleDrafts) {
      const arr = m.get(d.rolled_up_from_requisition_id) ?? []
      arr.push(d); m.set(d.rolled_up_from_requisition_id, arr)
    }
    return m
  }, [visibleDrafts])

  // Default rollup window for the launcher — last week (Mon → Sun).
  const now = new Date()
  const day = now.getDay() // 0=Sun
  const lastSun = new Date(now); lastSun.setDate(now.getDate() - day)
  const lastMon = new Date(lastSun); lastMon.setDate(lastSun.getDate() - 6)
  const defaultFrom = lastMon.toISOString().slice(0, 10)
  const defaultTo   = lastSun.toISOString().slice(0, 10)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <HardHat className="h-6 w-6 text-amber-500" /> Labor Expense Drafts
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Draft expenses generated by timesheet rollup — one row per (requisition, period). Approve to send them into the To-Pay Queue.
        </p>
      </div>

      {integrityIssues.length > 0 && (
        <div className="rounded-xl border border-red-300 bg-red-50 dark:border-red-900/50 dark:bg-red-900/20 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-300">
            <AlertTriangle className="h-4 w-4" />
            {integrityIssues.length} rollup{integrityIssues.length === 1 ? '' : 's'} do not match their timesheets
          </p>
          <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">
            The days billed don't equal the attendance actually recorded against them — the rollup is overstated.
            Undo and re-run it; if it's already paid, correct it as an adjustment.
          </p>
          <ul className="mt-2 space-y-1">
            {integrityIssues.map(i => (
              <li key={i.expense_id} className="flex items-center justify-between gap-3 text-xs">
                <Link to={`/expenses/${i.expense_id}`} className="text-red-700 dark:text-red-300 hover:underline truncate">
                  {i.expense_code ?? i.expense_id.slice(0, 8)} · {i.project_name ?? '—'} · {i.rollup_period_start} → {i.rollup_period_end}
                </Link>
                <span className="shrink-0 tabular-nums font-medium text-red-700 dark:text-red-300">
                  +{i.extra_days} day{i.extra_days === 1 ? '' : 's'} · {formatCurrency(i.overstated_etb)} over
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Filters — apply to both the rollup launcher and the drafts list, so
          working one project at a time doesn't mean scrolling past the rest. */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 px-4 py-3">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Project</span>
        <div className="w-64">
          <SearchableSelect
            value={projectFilter}
            onChange={setProjectFilter}
            options={projectOptions}
            placeholder="All projects"
          />
        </div>
        {projectFilter && (
          <button onClick={() => setProjectFilter(null)} className="text-xs text-slate-500 hover:underline">Clear</button>
        )}
        <label className="ml-auto flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <input
            type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300 text-brand focus:ring-brand"
          />
          Show archived (paid)
        </label>
      </div>

      {/* Launcher: manual rollup for any approved requisition */}
      <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
            <RefreshCw className="h-4 w-4" /> Run rollup
          </h2>
          <span className="text-[11px] text-slate-400">
            Default window: last week ({defaultFrom} → {defaultTo}). Scheduled runs need pg_cron enabled.
          </span>
        </div>
        {visibleReqs.length === 0 ? (
          <p className="text-xs text-slate-400 py-4 text-center">
            {projectFilter ? 'No approved requisitions on this project.' : 'No approved requisitions yet.'}
          </p>
        ) : (
          <div className="divide-y dark:divide-slate-700">
            {visibleReqs.map(r => (
              <ReqRollupRow key={r.id} req={r} defaultFrom={defaultFrom} defaultTo={defaultTo} onRun={runRollup} />
            ))}
          </div>
        )}
      </div>

      {/* Batch payment bar — combine several approved drafts (e.g. every
          trade on one work order) into a single Payment Request. */}
      {selectedIds.size > 0 && (
        <div className="sticky top-2 z-10 flex items-center justify-between gap-3 rounded-xl border border-brand/30 bg-brand/5 dark:bg-brand/10 px-4 py-3 shadow-sm flex-wrap">
          <div className="flex items-center gap-2 text-sm">
            <Layers className="h-4 w-4 text-brand" />
            <span className="font-medium text-slate-700 dark:text-slate-200">{selectedIds.size} draft{selectedIds.size === 1 ? '' : 's'} selected</span>
            <span className="text-slate-400">· {formatCurrency(selectedTotal)} total</span>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={batchPaymentMethod}
              onChange={e => setBatchPaymentMethod(e.target.value as 'batch_wire' | 'cash')}
              className="rounded-md border px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="batch_wire">Bank / Wire</option>
              <option value="cash">Cash</option>
            </select>
            {batchPaymentMethod !== 'cash' && (
              <div className="w-48">
                <SearchableSelect value={batchAccountId} onChange={setBatchAccountId} options={accountOptions} placeholder="Funding account…" />
              </div>
            )}
            <button onClick={() => setSelectedIds(new Set())} className="text-xs text-slate-500 hover:underline">Clear</button>
            <button
              onClick={createBatch}
              disabled={batching || (batchPaymentMethod !== 'cash' && !batchAccountId)}
              className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-60"
            >
              {batching ? 'Creating…' : 'Create Batch Payment'}
            </button>
          </div>
        </div>
      )}

      {/* Drafts list */}
      <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 overflow-hidden">
        <div className="px-4 py-3 border-b dark:border-slate-700 text-sm font-semibold text-slate-700 dark:text-slate-200">
          Generated drafts ({visibleDrafts.length}) <span className="font-normal text-slate-400">— select multiple approved drafts to combine into one Payment Request</span>
        </div>
        {isLoading ? (
          <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
        ) : visibleDrafts.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-400">
            {projectFilter
              ? 'No rollup drafts on this project.'
              : showArchived ? 'No rollup drafts yet. Run one above.'
              : 'Nothing outstanding — every rollup draft is paid and archived. Tick "Show archived" to see them.'}
          </div>
        ) : (
          <div>
            {[...draftsByReq.entries()].map(([reqId, rows]) => (
              <div key={reqId} className="border-b dark:border-slate-700 last:border-0">
                <div className="px-4 py-2 bg-slate-50 dark:bg-slate-900/40 text-xs text-slate-500">
                  Requisition <span className="font-mono">{reqId.slice(0, 8)}</span> · {rows[0].projects?.project_name ?? '—'} · {rows.length} draft{rows.length === 1 ? '' : 's'}
                </div>
                {rows.map(d => (
                  <DraftRow key={d.id} draft={d} expanded={expanded.has(d.id)} onToggle={() => toggle(d.id)} selected={selectedIds.has(d.id)} onToggleSelect={() => toggleSelect(d.id)} onUndo={undoRollup} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ReqRollupRow({ req, defaultFrom, defaultTo, onRun }: {
  req: RequisitionRow; defaultFrom: string; defaultTo: string;
  onRun: (id: string, from: string, to: string) => Promise<void>
}) {
  const [from, setFrom] = useState(defaultFrom)
  const [to, setTo]     = useState(defaultTo)
  const [busy, setBusy] = useState(false)

  const { data: preview, isFetching: previewLoading } = useQuery({
    queryKey: ['labor-rollup-preview', req.id, from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('preview_labor_rollup', {
        p_labor_requisition_id: req.id, p_period_start: from, p_period_end: to,
      })
      if (error) throw error
      return (data?.[0] ?? null) as RollupPreview | null
    },
    enabled: !!from && !!to,
  })

  const owes = (preview?.total_amount ?? 0) > 0

  return (
    <div className="py-3 flex items-center gap-3 flex-wrap">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{req.role_needed} · {req.projects?.project_name ?? '—'}</p>
        <p className="text-[11px] text-slate-400">
          {req.payment_model} · {req.pay_cycle} · est. {req.estimated_total_cost != null ? formatCurrency(req.estimated_total_cost) : '—'}
        </p>
      </div>
      <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="text-xs rounded border dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 px-2 py-1" />
      <input type="date" value={to}   onChange={e => setTo(e.target.value)}   className="text-xs rounded border dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 px-2 py-1" />
      <div className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium tabular-nums ${
        previewLoading ? 'text-slate-400' : owes ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300' : 'text-slate-400'
      }`}>
        <Coins className="h-3 w-3" />
        {previewLoading ? 'Checking…' : owes
          ? <>Owes {formatCurrency(preview!.total_amount)} <span className="font-normal text-[10px] opacity-80">· {preview!.worker_count} worker{preview!.worker_count === 1 ? '' : 's'} · {preview!.total_units} {preview!.unit_label}</span></>
          : 'Nothing owed in this window'}
      </div>
      <button
        onClick={async () => { setBusy(true); try { await onRun(req.id, from, to) } finally { setBusy(false) } }}
        disabled={busy || previewLoading || !owes}
        className="flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-40"
      >
        <Play className="h-3 w-3" /> {busy ? 'Rolling…' : 'Roll up'}
      </button>
    </div>
  )
}

function DraftRow({ draft, expanded, onToggle, selected, onToggleSelect, onUndo }: {
  draft: DraftRow; expanded: boolean; onToggle: () => void; selected: boolean; onToggleSelect: () => void
  onUndo: (draft: DraftRow) => Promise<void>
}) {
  const isVolume = draft.labor_requisitions?.payment_basis === 'per_volume'
  const batchable = draft.payment_state === 'approved_to_pay'
  const unitLabel = isVolume ? (draft.labor_requisitions?.volume_unit ?? 'units') : 'days'
  // A rollup is idempotent on requisition + period, so "Roll up now" hands
  // back this same expense forever — correcting the timesheets behind it
  // means deleting the draft first. Only offered while it's genuinely a
  // draft; the RPC re-checks (and also rejects bank-matched, ledger-posted
  // and batched rollups) server-side.
  const undoable = draft.payment_state === 'unpaid' || draft.payment_state === 'void'
  const [undoing, setUndoing] = useState(false)

  const { data: workers = [] } = useQuery({
    queryKey: ['labor-expense-workers', draft.id],
    enabled: expanded,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('labor_expense_workers')
        .select('id, staff_id, days_worked, day_rate, subtotal, gang_size, gang_member_names, overtime_hours, overtime_amount, staff(employee_name)')
        .eq('expense_id', draft.id)
      if (error) throw error
      return data ?? []
    },
  })

  const totalHeadcount = useMemo(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (workers as any[]).reduce((sum, w) => sum + Math.max(w.gang_size ?? 1, 1), 0),
    [workers],
  )

  return (
    <div>
      <div className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/40">
        {batchable ? (
          <input
            type="checkbox" checked={selected} onChange={onToggleSelect}
            className="h-4 w-4 shrink-0 rounded border-slate-300 text-brand focus:ring-brand"
            title="Include in a batch payment"
          />
        ) : <span className="w-4 shrink-0" />}
        <button onClick={onToggle} className="flex flex-1 min-w-0 items-center gap-3 text-left">
          <ChevronRight className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-slate-700 dark:text-slate-200 truncate">{draft.item_service_description ?? '—'}</p>
            <p className="text-[11px] text-slate-400">
              {draft.rollup_period_start} → {draft.rollup_period_end}
              {draft.vendors?.vendor_name ? ` · Gang: ${draft.vendors.vendor_name}` : ''}
              {draft.paid_to_staff?.employee_name ? ` · Payee: ${draft.paid_to_staff.employee_name}` : ''}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100 tabular-nums">{formatCurrency(draft.amount_etb ?? 0)}</p>
            <p className="text-[11px] text-slate-400 capitalize">
              {draft.approval_status} · {draft.payment_state}
              {draft.is_archived && <span className="ml-1.5 normal-case rounded-full bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-500 dark:text-slate-400">Archived</span>}
            </p>
          </div>
        </button>
        {undoable && (
          <button
            onClick={async () => { setUndoing(true); try { await onUndo(draft) } finally { setUndoing(false) } }}
            disabled={undoing}
            title="Delete this draft and release its timesheets, so you can fix the data and roll up again"
            className="flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 shrink-0"
          >
            <Undo2 className="h-3 w-3" /> {undoing ? 'Undoing…' : 'Undo'}
          </button>
        )}
        <Link to={`/expenses/${draft.id}`} className="text-[11px] text-brand hover:underline shrink-0">
          Open expense →
        </Link>
      </div>
      {expanded && (
        <div className="px-8 pb-3">
          <div className="rounded-lg border dark:border-slate-700 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-900/40">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-slate-500">Worker</th>
                  <th className="text-right px-3 py-2 font-medium text-slate-500 capitalize">{unitLabel}</th>
                  <th className="text-right px-3 py-2 font-medium text-slate-500">Rate</th>
                  <th className="text-right px-3 py-2 font-medium text-slate-500">Subtotal</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-700">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {(workers as any[]).map(w => (
                  <tr key={w.id}>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">
                      {w.staff?.employee_name ?? '—'}
                      {w.gang_size > 1 && (
                        <>
                          <span className="ml-1.5 rounded-full bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                            Gang of {w.gang_size}
                          </span>
                          {w.gang_member_names && (
                            <p className="mt-0.5 text-[10px] font-normal text-slate-400">{w.gang_member_names}</p>
                          )}
                        </>
                      )}
                      {(w.overtime_amount ?? 0) > 0 && (
                        <p className="mt-0.5 text-[10px] font-normal text-amber-600 dark:text-amber-400">
                          + OT {w.overtime_hours ? `${w.overtime_hours}h · ` : ''}{formatCurrency(w.overtime_amount)}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{w.days_worked}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(w.day_rate)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatCurrency(w.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-slate-400 mt-2">
            {totalHeadcount} worker{totalHeadcount === 1 ? '' : 's'} covered · Timesheets covered by this draft have <span className="font-mono">rolled_up_expense_id = {draft.id.slice(0, 8)}</span> and won't roll up again.
          </p>
        </div>
      )}
    </div>
  )
}
