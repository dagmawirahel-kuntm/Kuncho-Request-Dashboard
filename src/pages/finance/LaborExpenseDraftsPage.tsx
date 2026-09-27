import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import {
  HardHat, ChevronRight, ChevronDown, Play, Layers, Undo2, AlertTriangle, CheckCircle2, Search, CalendarRange, Coins, Check,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useAccounts } from '@/hooks/useLookups'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { Panel, Pill, Stat, type Tone } from '@/components/record/Record'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { RollupIntegrityRow } from '@/types/database'

// Labour pay. Work recorded on site (attendance, timesheets, volumes) becomes
// a draft expense per requisition and period ("rollup"); finance approves the
// drafts and pays them, one by one or batched. This page shows the three
// stages together: what is owed and not drafted yet, the drafts waiting on
// approval, and what has been approved, sent and paid.

interface Req {
  id: string
  role_needed: string
  project_id: string
  payment_model: string
  payment_basis: string
  pay_cycle: string
  start_date: string
  end_date: string | null
  closed_at: string | null
  estimated_total_cost: number | null
  projects: { project_name: string } | null
  vendors: { vendor_name: string } | null
}

interface OwedWeek {
  labor_requisition_id: string
  week_start: string
  week_end: string
  first_day: string
  last_day: string
  entries: number
  worker_count: number
  total_units: number
  unit_label: string
  total_amount: number
}

interface Draft {
  id: string
  expense_code: string | null
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
  vendors: { vendor_name: string } | null
  paid_to_staff: { employee_name: string } | null
  labor_requisitions: { role_needed: string; payment_basis: string; volume_unit: string | null } | null
}

// One thing to draft: a requisition's week, or a whole engagement for
// requisitions paid at the end.
interface OwedRow {
  key: string
  req: Req | undefined
  reqId: string
  from: string
  to: string
  workers: number
  units: number
  unitLabel: string
  amount: number
  entries: number
  waiting?: string // why it can't be drafted yet
}

type DraftTab = 'approve' | 'approved' | 'sent' | 'paid' | 'rejected'
const TABS: { id: DraftTab; label: string; match: (d: Draft) => boolean }[] = [
  { id: 'approve', label: 'To approve', match: d => d.payment_state === 'unpaid' && d.approval_status !== 'rejected' },
  { id: 'approved', label: 'Approved', match: d => d.payment_state === 'approved_to_pay' },
  { id: 'sent', label: 'Sent', match: d => d.payment_state === 'sent' },
  { id: 'paid', label: 'Paid', match: d => d.payment_state === 'paid' },
  { id: 'rejected', label: 'Rejected', match: d => d.approval_status === 'rejected' || d.payment_state === 'void' },
]

const iso = (d: Date) => d.toISOString().slice(0, 10)
function lastSunday(): string {
  const now = new Date()
  const sun = new Date(now); sun.setDate(now.getDate() - now.getDay())
  return iso(sun)
}
const span = (a: string, b: string) => a === b ? formatDate(a) : `${formatDate(a)} – ${formatDate(b)}`

export default function LaborExpenseDraftsPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { session, role } = useAuth()
  const canApprove = role === 'admin' || role === 'finance' || role === 'executive'

  const [q, setQ] = useState('')
  const [projectFilter, setProjectFilter] = useState<string | null>(null)
  const [tab, setTab] = useState<DraftTab>('approve')

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['labor-expense-drafts'] })
    qc.invalidateQueries({ queryKey: ['labor-owed'] })
    qc.invalidateQueries({ queryKey: ['rollup-integrity-check'] })
  }

  const { data: reqs = [] } = useQuery({
    queryKey: ['labor-pay-requisitions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('labor_requisitions')
        .select('id, role_needed, project_id, payment_model, payment_basis, pay_cycle, start_date, end_date, closed_at, estimated_total_cost, projects(project_name), vendors:gang_leader_vendor_id(vendor_name)')
        .eq('status', 'approved')
      if (error) throw error
      return (data ?? []) as unknown as Req[]
    },
  })
  const reqById = useMemo(() => new Map(reqs.map(r => [r.id, r])), [reqs])

  const { data: owedWeeks = [], isLoading: owedLoading, error: owedError } = useQuery({
    queryKey: ['labor-owed'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('labor_owed_by_week', { p_until: null })
      if (error) throw error
      return ((data ?? []) as OwedWeek[]).map(w => ({ ...w, total_amount: Number(w.total_amount), total_units: Number(w.total_units) }))
    },
  })

  const { data: drafts = [], isLoading: draftsLoading } = useQuery({
    queryKey: ['labor-expense-drafts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('id, expense_code, amount_etb, date, item_service_description, approval_status, payment_state, is_archived, rolled_up_from_requisition_id, rollup_period_start, rollup_period_end, project_id, projects(project_name), vendors(vendor_name), paid_to_staff:staff!expenses_paid_to_staff_id_fkey(employee_name), labor_requisitions:rolled_up_from_requisition_id(role_needed, payment_basis, volume_unit)')
        .not('rolled_up_from_requisition_id', 'is', null)
        .order('rollup_period_end', { ascending: false, nullsFirst: false })
      if (error) throw error
      return (data ?? []) as unknown as Draft[]
    },
  })

  // Standing check for the fan-out class of bug (migration 264): a rollup's
  // recorded days must equal the attendance stamped to it. Empty is healthy.
  const { data: integrityIssues = [] } = useQuery({
    queryKey: ['rollup-integrity-check'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_rollup_integrity_check').select('*')
      if (error) throw error
      return (data ?? []) as RollupIntegrityRow[]
    },
  })

  // ── What is owed ───────────────────────────────────────────────────────
  // Weekly requisitions draft a finished Monday–Sunday week at a time; this
  // week stays open until Sunday. Requisitions paid at the end draft once,
  // when they have ended, over everything recorded.
  const cutoff = lastSunday()
  const { owedRows, thisWeek } = useMemo(() => {
    const rows: OwedRow[] = []
    let running = 0
    const engagement = new Map<string, OwedWeek[]>()
    for (const w of owedWeeks) {
      const req = reqById.get(w.labor_requisition_id)
      if (req?.pay_cycle === 'engagement_end') {
        engagement.set(w.labor_requisition_id, [...(engagement.get(w.labor_requisition_id) ?? []), w])
        continue
      }
      if (w.week_end > cutoff) { running += w.total_amount; continue }
      rows.push({
        key: `${w.labor_requisition_id}:${w.week_start}`, req, reqId: w.labor_requisition_id,
        from: w.week_start, to: w.week_end, workers: w.worker_count, units: w.total_units, unitLabel: w.unit_label,
        amount: w.total_amount, entries: w.entries,
      })
    }
    for (const [reqId, weeks] of engagement) {
      const req = reqById.get(reqId)
      const from = weeks.reduce((m, w) => (w.first_day < m ? w.first_day : m), weeks[0].first_day)
      const lastDay = weeks.reduce((m, w) => (w.last_day > m ? w.last_day : m), weeks[0].last_day)
      const end = req?.end_date ?? null
      const ended = !!end && end <= iso(new Date())
      rows.push({
        key: `${reqId}:engagement`, req, reqId, from, to: ended && end! > lastDay ? end! : lastDay,
        workers: Math.max(...weeks.map(w => w.worker_count)), units: weeks.reduce((s, w) => s + w.total_units, 0),
        unitLabel: weeks[0].unit_label, amount: weeks.reduce((s, w) => s + w.total_amount, 0),
        entries: weeks.reduce((s, w) => s + w.entries, 0),
        waiting: ended ? undefined : `Paid when the engagement ends${end ? ` (${formatDate(end)})` : ''}`,
      })
    }
    return { owedRows: rows, thisWeek: running }
  }, [owedWeeks, reqById, cutoff])

  const matches = (projectId: string | undefined, text: string) =>
    (!projectFilter || projectId === projectFilter) && (!q.trim() || text.toLowerCase().includes(q.trim().toLowerCase()))

  const visibleOwed = owedRows.filter(r => matches(r.req?.project_id, `${r.req?.role_needed ?? ''} ${r.req?.projects?.project_name ?? ''} ${r.req?.vendors?.vendor_name ?? ''}`))
  const draftable = visibleOwed.filter(r => !r.waiting && r.amount > 0)
  const owedTotal = owedRows.filter(r => !r.waiting).reduce((s, r) => s + r.amount, 0)

  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [drafting, setDrafting] = useState<{ done: number; of: number } | null>(null)
  const pickedRows = draftable.filter(r => picked.has(r.key))

  async function draft(rows: OwedRow[]) {
    if (rows.length === 0) return
    setDrafting({ done: 0, of: rows.length })
    let made = 0, total = 0
    const failed: string[] = []
    for (const r of rows) {
      const { error } = await supabase.rpc('rollup_labor_timesheets_to_expense', {
        p_labor_requisition_id: r.reqId, p_period_start: r.from, p_period_end: r.to,
      })
      if (error) failed.push(`${r.req?.role_needed ?? 'Requisition'} (${span(r.from, r.to)}): ${error.message}`)
      else { made++; total += r.amount }
      setDrafting({ done: made + failed.length, of: rows.length })
    }
    setDrafting(null)
    setPicked(new Set())
    refresh()
    if (made) toast(`${made} draft${made === 1 ? '' : 's'} created · ${formatCurrency(total)}`, 'success')
    if (failed.length) toast(`${failed.length} could not be drafted — ${failed[0]}`, 'error')
    if (made) setTab('approve')
  }

  // ── Drafts ────────────────────────────────────────────────────────────
  const visibleDrafts = drafts.filter(d => matches(d.project_id,
    `${d.labor_requisitions?.role_needed ?? ''} ${d.projects?.project_name ?? ''} ${d.vendors?.vendor_name ?? ''} ${d.paid_to_staff?.employee_name ?? ''} ${d.expense_code ?? ''}`))
  const byTab = useMemo(() => {
    const m = {} as Record<DraftTab, Draft[]>
    for (const t of TABS) m[t.id] = visibleDrafts.filter(t.match)
    return m
  }, [visibleDrafts])
  const sum = (ds: Draft[]) => ds.reduce((s, d) => s + Number(d.amount_etb ?? 0), 0)
  const monthStart = iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const paidThisMonth = drafts.filter(d => d.payment_state === 'paid' && (d.rollup_period_end ?? d.date ?? '') >= monthStart)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const tabDrafts = byTab[tab]
  const selectedDrafts = tabDrafts.filter(d => selected.has(d.id))

  async function approve(ids: string[]) {
    const { error } = await supabase.from('expenses').update({ approval_status: 'finance_approved' }).in('id', ids)
    if (error) { toast(error.message, 'error'); return }
    toast(`${ids.length} draft${ids.length === 1 ? '' : 's'} approved — in the to-pay queue`, 'success')
    setSelected(new Set())
    refresh()
  }

  async function undo(d: Draft) {
    if (!window.confirm(`Delete this draft (${formatCurrency(d.amount_etb ?? 0)}) and release its timesheets?\n\nNothing is paid out by this. Fix the timesheets, then draft ${span(d.rollup_period_start ?? '', d.rollup_period_end ?? '')} again.`)) return
    const { data, error } = await supabase.rpc('undo_labor_rollup', { p_expense_id: d.id })
    if (error) { toast(error.message, 'error'); return }
    toast(String(data), 'success')
    refresh()
  }

  async function unapprove(d: Draft) {
    const { data, error } = await supabase.rpc('unapprove_expense', { p_expense_id: d.id })
    if (error) { toast(error.message, 'error'); return }
    toast(String(data), 'success')
    refresh()
  }

  // Batch several drafts into one payment. Unapproved drafts make it a
  // batch for approval; funding is chosen when it is approved.
  const { data: accounts = [] } = useAccounts()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accountOptions = useMemo(() => accounts.map((a: any) => ({ id: a.id, label: a.account_name })), [accounts])
  const [batchAccountId, setBatchAccountId] = useState<string | null>(null)
  const [batchMethod, setBatchMethod] = useState<'batch_wire' | 'cash'>('batch_wire')
  const [batching, setBatching] = useState(false)
  const batchable = selectedDrafts.filter(d => d.payment_state === 'unpaid' || d.payment_state === 'approved_to_pay')
  const preApproval = batchable.some(d => d.payment_state === 'unpaid')

  async function createBatch() {
    if (batchable.length === 0 || !session?.user.id) return
    if (!preApproval && batchMethod !== 'cash' && !batchAccountId) { toast('Choose the account paying this batch', 'error'); return }
    setBatching(true)
    const projects = [...new Set(batchable.map(d => d.projects?.project_name).filter(Boolean))]
    const ends = batchable.map(d => d.rollup_period_end ?? d.date).filter(Boolean).sort() as string[]
    const { data, error } = await supabase.rpc('create_batch_payment', {
      p_expense_ids: batchable.map(d => d.id),
      p_assignee_id: session.user.id,
      p_account_id: preApproval || batchMethod === 'cash' ? null : batchAccountId,
      p_payment_method: batchMethod,
      p_payment_code: `Labor Batch — ${projects.length === 1 ? projects[0] : `${projects.length} projects`} — ${formatDate(ends[ends.length - 1] ?? iso(new Date()))}`,
      p_notes: null,
    })
    setBatching(false)
    if (error) { toast(error.message, 'error'); return }
    setSelected(new Set())
    refresh()
    toast(preApproval ? 'Batch created — approve it to release for payment' : 'Batch payment created', 'success')
    navigate(`/batch-payments/${data}`)
  }

  const projectOptions = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of reqs) m.set(r.project_id, r.projects?.project_name ?? '—')
    for (const d of drafts) if (d.project_id) m.set(d.project_id, d.projects?.project_name ?? '—')
    return [...m].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label))
  }, [reqs, drafts])

  const [customOpen, setCustomOpen] = useState(false)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800 dark:text-slate-100">
          <HardHat className="h-5 w-5 text-amber-500" /> Labour pay
        </h1>
        <p className="max-w-3xl text-sm text-slate-500 dark:text-slate-400">
          Work recorded on site becomes a draft to approve and pay. Draft what is owed, approve it, then pay it on its own or in a batch.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Owed, not drafted" value={formatCurrency(owedTotal)} tone={owedTotal > 0 ? 'amber' : undefined}
          sub={`${owedRows.filter(r => !r.waiting && r.amount > 0).length} to draft${thisWeek > 0 ? ` · ${formatCurrency(thisWeek)} this week so far` : ''}`} />
        <Stat label="To approve" value={formatCurrency(sum(drafts.filter(TABS[0].match)))} sub={`${drafts.filter(TABS[0].match).length} drafts`} />
        <Stat label="Approved, not paid" value={formatCurrency(sum(drafts.filter(d => d.payment_state === 'approved_to_pay' || d.payment_state === 'sent')))}
          sub={`${drafts.filter(d => d.payment_state === 'approved_to_pay' || d.payment_state === 'sent').length} drafts`} />
        <Stat label="Paid this month" value={formatCurrency(sum(paidThisMonth))} tone="green" sub={`${paidThisMonth.length} drafts`} />
      </div>

      {integrityIssues.length > 0 && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 dark:border-red-900/50 dark:bg-red-900/20">
          <p className="flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-300">
            <AlertTriangle className="h-4 w-4" />
            {integrityIssues.length} draft{integrityIssues.length === 1 ? '' : 's'} bill more days than the attendance recorded
          </p>
          <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">Undo and draft it again; if it is already paid, correct it as an adjustment.</p>
          <ul className="mt-2 space-y-1">
            {integrityIssues.map(i => (
              <li key={i.expense_id} className="flex items-center justify-between gap-3 text-xs">
                <Link to={`/expenses/${i.expense_id}`} className="truncate text-red-700 hover:underline dark:text-red-300">
                  {i.expense_code ?? i.expense_id.slice(0, 8)} · {i.project_name ?? '—'} · {i.rollup_period_start} → {i.rollup_period_end}
                </Link>
                <span className="shrink-0 font-medium tabular-nums text-red-700 dark:text-red-300">+{i.extra_days} day{i.extra_days === 1 ? '' : 's'} · {formatCurrency(i.overstated_etb)} over</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[12rem] max-w-sm flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a role, project, gang or worker…"
            className="w-full rounded-md border bg-white py-2 pl-8 pr-3 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div className="w-60">
          <SearchableSelect value={projectFilter} onChange={setProjectFilter} options={projectOptions} placeholder="All projects" />
        </div>
        {projectFilter && <button onClick={() => setProjectFilter(null)} className="text-xs text-slate-500 hover:underline">Clear</button>}
      </div>

      {/* 1. Owed, not drafted */}
      <Panel title="Owed — not drafted yet" icon={Coins} count={visibleOwed.length} padded={false}
        action={draftable.length > 0 && (
          <>
            {pickedRows.length > 0 && (
              <button onClick={() => draft(pickedRows)} disabled={!!drafting}
                className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-60">
                <Play className="h-3 w-3" /> Draft {pickedRows.length} · {formatCurrency(pickedRows.reduce((s, r) => s + r.amount, 0))}
              </button>
            )}
            <button onClick={() => draft(draftable)} disabled={!!drafting}
              className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
              Draft all {draftable.length}
            </button>
          </>
        )}>
        {drafting && (
          <div className="border-b px-4 py-2 text-xs text-slate-500 dark:border-slate-700">
            Drafting {drafting.done} of {drafting.of}…
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
              <div className="h-full bg-brand transition-all" style={{ width: `${(drafting.done / drafting.of) * 100}%` }} />
            </div>
          </div>
        )}
        {owedError ? (
          <p className="px-4 py-6 text-sm text-slate-400">{(owedError as Error).message}</p>
        ) : owedLoading ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">Working out what is owed…</p>
        ) : visibleOwed.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <CheckCircle2 className="mx-auto mb-2 h-7 w-7 text-emerald-400" />
            <p className="text-sm text-slate-500 dark:text-slate-400">Every finished week of recorded work has a draft.</p>
            {thisWeek > 0 && <p className="mt-1 text-xs text-slate-400">{formatCurrency(thisWeek)} recorded so far this week — draft it after Sunday.</p>}
          </div>
        ) : (
          <ul className="divide-y dark:divide-slate-700/60">
            {visibleOwed.map(r => {
              const can = !r.waiting && r.amount > 0
              return (
                <li key={r.key} className="flex items-center gap-3 px-4 py-2.5">
                  <input type="checkbox" disabled={!can} checked={picked.has(r.key)} aria-label="Pick to draft"
                    onChange={() => setPicked(s => { const n = new Set(s); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n })}
                    className="h-4 w-4 shrink-0 rounded border-slate-300 text-brand focus:ring-brand disabled:opacity-30" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                      {r.req?.role_needed ?? 'Requisition'} · <span className="font-normal text-slate-500 dark:text-slate-400">{r.req?.projects?.project_name ?? '—'}</span>
                    </p>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                      <CalendarRange className="mr-1 inline h-3 w-3" />{span(r.from, r.to)}
                      {r.req?.vendors?.vendor_name ? ` · gang: ${r.req.vendors.vendor_name}` : ''}
                      {` · ${r.workers} worker${r.workers === 1 ? '' : 's'} · ${r.units} ${r.unitLabel}`}
                    </p>
                    {r.waiting && <p className="text-[11px] text-slate-400">{r.waiting}</p>}
                    {!r.waiting && r.amount === 0 && <p className="text-[11px] text-amber-600 dark:text-amber-400">Work recorded but no rate or volume to price it — check the timesheets.</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(r.amount)}</p>
                    {can && (
                      <button onClick={() => draft([r])} disabled={!!drafting} className="text-[11px] font-medium text-brand hover:underline disabled:opacity-50">Draft</button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>

      {/* 2. Drafts */}
      <Panel title="Drafts" icon={Layers} padded={false}>
        <div className="flex gap-1 overflow-x-auto border-b px-2 dark:border-slate-700">
          {TABS.map(t => (
            <button key={t.id} onClick={() => { setTab(t.id); setSelected(new Set()) }}
              className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium -mb-px ${tab === t.id ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
              {t.label} <span className="ml-1 text-xs text-slate-400">{byTab[t.id].length}</span>
            </button>
          ))}
        </div>

        {selectedDrafts.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b bg-brand/5 px-4 py-2.5 dark:border-slate-700">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{selectedDrafts.length} selected · {formatCurrency(sum(selectedDrafts))}</span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {canApprove && tab === 'approve' && (
                <button onClick={() => approve(selectedDrafts.map(d => d.id))}
                  className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
                  <Check className="h-3 w-3" /> Approve {selectedDrafts.length}
                </button>
              )}
              {batchable.length > 0 && (
                <>
                  {!preApproval && (
                    <>
                      <select value={batchMethod} onChange={e => setBatchMethod(e.target.value as 'batch_wire' | 'cash')}
                        className="rounded-md border px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                        <option value="batch_wire">Bank / wire</option>
                        <option value="cash">Cash</option>
                      </select>
                      {batchMethod !== 'cash' && (
                        <div className="w-48"><SearchableSelect value={batchAccountId} onChange={setBatchAccountId} options={accountOptions} placeholder="Paying account…" /></div>
                      )}
                    </>
                  )}
                  <button onClick={createBatch} disabled={batching}
                    className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-60">
                    <Layers className="h-3 w-3" /> {batching ? 'Creating…' : preApproval ? 'Batch for approval' : 'Batch for payment'}
                  </button>
                </>
              )}
              <button onClick={() => setSelected(new Set())} className="text-xs text-slate-500 hover:underline">Clear</button>
            </div>
          </div>
        )}

        {draftsLoading ? (
          <p className="py-10 text-center text-sm text-slate-400">Loading…</p>
        ) : tabDrafts.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">{tab === 'approve' ? 'Nothing waiting for approval.' : 'Nothing here.'}</p>
        ) : (
          <>
            {(tab === 'approve' || tab === 'approved') && (
              <div className="flex items-center gap-2 border-b px-4 py-1.5 text-xs text-slate-500 dark:border-slate-700">
                <input type="checkbox" aria-label="Select all"
                  checked={tabDrafts.length > 0 && tabDrafts.every(d => selected.has(d.id))}
                  onChange={e => setSelected(e.target.checked ? new Set(tabDrafts.map(d => d.id)) : new Set())}
                  className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand" />
                Select all · {formatCurrency(sum(tabDrafts))}
              </div>
            )}
            <ul className="divide-y dark:divide-slate-700/60">
              {tabDrafts.map(d => (
                <DraftLine key={d.id} d={d} selectable={tab === 'approve' || tab === 'approved'} selected={selected.has(d.id)}
                  onSelect={() => setSelected(s => { const n = new Set(s); if (n.has(d.id)) n.delete(d.id); else n.add(d.id); return n })}
                  canApprove={canApprove} onApprove={() => approve([d.id])} onUndo={() => undo(d)} onUnapprove={() => unapprove(d)} />
              ))}
            </ul>
          </>
        )}
      </Panel>

      {/* Odd periods: any approved requisition, any dates */}
      <section className="rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800">
        <button onClick={() => setCustomOpen(o => !o)} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-200">
          {customOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
          Draft a custom period
          <span className="text-xs font-normal text-slate-400">— for a requisition and dates that don't fit a week</span>
        </button>
        {customOpen && (
          <div className="divide-y border-t dark:divide-slate-700 dark:border-slate-700">
            {!projectFilter && !q.trim() ? (
              <p className="px-4 py-4 text-xs text-slate-400">Pick a project or search above to list its requisitions.</p>
            ) : reqs.filter(r => matches(r.project_id, `${r.role_needed} ${r.projects?.project_name ?? ''}`))
              .sort((a, b) => (a.projects?.project_name ?? '').localeCompare(b.projects?.project_name ?? '') || a.role_needed.localeCompare(b.role_needed))
              .slice(0, 25)
              .map(r => <CustomPeriodRow key={r.id} req={r} onDone={refresh} />)}
          </div>
        )}
      </section>
    </div>
  )
}

const STATE: Record<string, { label: string; tone: Tone }> = {
  unpaid: { label: 'To approve', tone: 'amber' },
  approved_to_pay: { label: 'Approved', tone: 'blue' },
  sent: { label: 'Sent', tone: 'violet' },
  paid: { label: 'Paid', tone: 'green' },
  void: { label: 'Void', tone: 'slate' },
}

function DraftLine({ d, selectable, selected, onSelect, canApprove, onApprove, onUndo, onUnapprove }: {
  d: Draft; selectable: boolean; selected: boolean; onSelect: () => void
  canApprove: boolean; onApprove: () => void; onUndo: () => void; onUnapprove: () => void
}) {
  const [open, setOpen] = useState(false)
  const rejected = d.approval_status === 'rejected'
  const st = rejected ? { label: 'Rejected', tone: 'red' as Tone } : STATE[d.payment_state] ?? { label: d.payment_state, tone: 'slate' as Tone }
  const isVolume = d.labor_requisitions?.payment_basis === 'per_volume'
  const unitLabel = isVolume ? (d.labor_requisitions?.volume_unit ?? 'units') : 'days'
  const payee = d.vendors?.vendor_name ? `Gang: ${d.vendors.vendor_name}` : d.paid_to_staff?.employee_name ?? null

  const { data: workers = [] } = useQuery({
    queryKey: ['labor-expense-workers', d.id],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.from('labor_expense_workers')
        .select('id, days_worked, day_rate, subtotal, gang_size, gang_member_names, overtime_hours, overtime_amount, staff(employee_name)')
        .eq('expense_id', d.id)
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []) as any[]
    },
  })

  return (
    <li>
      <div className="flex items-center gap-3 px-4 py-2.5">
        {selectable ? (
          <input type="checkbox" checked={selected} onChange={onSelect} aria-label="Select draft"
            className="h-4 w-4 shrink-0 rounded border-slate-300 text-brand focus:ring-brand" />
        ) : <span className="w-4 shrink-0" />}
        <button onClick={() => setOpen(o => !o)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronRight className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
              {d.labor_requisitions?.role_needed ?? d.item_service_description ?? 'Labour'} · <span className="font-normal text-slate-500 dark:text-slate-400">{d.projects?.project_name ?? '—'}</span>
            </p>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
              {d.rollup_period_start && d.rollup_period_end ? span(d.rollup_period_start, d.rollup_period_end) : formatDate(d.date)}
              {payee ? ` · ${payee}` : ''}{d.expense_code ? ` · ${d.expense_code}` : ''}
            </p>
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <Pill tone={st.tone}>{st.label}</Pill>
          <span className="w-28 text-right text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(d.amount_etb ?? 0)}</span>
        </div>
      </div>
      {open && (
        <div className="space-y-2 px-4 pb-3 pl-14">
          <div className="overflow-hidden rounded-lg border dark:border-slate-700">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-900/40">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-slate-500">Worker</th>
                  <th className="px-3 py-2 text-right font-medium capitalize text-slate-500">{unitLabel}</th>
                  <th className="px-3 py-2 text-right font-medium text-slate-500">Rate</th>
                  <th className="px-3 py-2 text-right font-medium text-slate-500">Subtotal</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-700">
                {workers.map(w => (
                  <tr key={w.id}>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">
                      {w.staff?.employee_name ?? '—'}
                      {w.gang_size > 1 && <span className="ml-1.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">Gang of {w.gang_size}</span>}
                      {w.gang_member_names && w.gang_size > 1 && <p className="mt-0.5 text-[10px] text-slate-400">{w.gang_member_names}</p>}
                      {(w.overtime_amount ?? 0) > 0 && <p className="mt-0.5 text-[10px] text-amber-600 dark:text-amber-400">+ overtime {w.overtime_hours ? `${w.overtime_hours}h · ` : ''}{formatCurrency(w.overtime_amount)}</p>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{w.days_worked}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(w.day_rate)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatCurrency(w.subtotal)}</td>
                  </tr>
                ))}
                {workers.length === 0 && <tr><td colSpan={4} className="px-3 py-3 text-center text-slate-400">Loading workers…</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {canApprove && d.payment_state === 'unpaid' && !rejected && (
              <button onClick={onApprove} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 font-medium text-white hover:bg-emerald-700">
                <Check className="h-3 w-3" /> Approve
              </button>
            )}
            {d.approval_status === 'finance_approved' && d.payment_state === 'approved_to_pay' && (
              <button onClick={onUnapprove} title="Withdraw the approval so it can go into a batch"
                className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
                <Undo2 className="h-3 w-3" /> Un-approve
              </button>
            )}
            {(d.payment_state === 'unpaid' || d.payment_state === 'void') && (
              <button onClick={onUndo} title="Delete this draft and release its timesheets, to fix them and draft again"
                className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
                <Undo2 className="h-3 w-3" /> Undo draft
              </button>
            )}
            <Link to={`/expenses/${d.id}`} className="font-medium text-brand hover:underline">Open expense →</Link>
          </div>
        </div>
      )}
    </li>
  )
}

function CustomPeriodRow({ req, onDone }: { req: Req; onDone: () => void }) {
  const { toast } = useToast()
  const [from, setFrom] = useState(req.start_date)
  const [to, setTo] = useState(req.end_date && req.end_date < iso(new Date()) ? req.end_date : lastSunday())
  const [busy, setBusy] = useState(false)
  const { data: preview, isFetching } = useQuery({
    queryKey: ['labor-rollup-preview', req.id, from, to],
    enabled: !!from && !!to && from <= to,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('preview_labor_rollup', { p_labor_requisition_id: req.id, p_period_start: from, p_period_end: to })
      if (error) throw error
      return (data?.[0] ?? null) as { worker_count: number; total_units: number; unit_label: string; total_amount: number } | null
    },
  })
  const owes = Number(preview?.total_amount ?? 0) > 0
  async function run() {
    setBusy(true)
    const { error } = await supabase.rpc('rollup_labor_timesheets_to_expense', { p_labor_requisition_id: req.id, p_period_start: from, p_period_end: to })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Draft created', 'success')
    onDone()
  }
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{req.role_needed} · <span className="font-normal text-slate-500">{req.projects?.project_name ?? '—'}</span></p>
        <p className="text-[11px] text-slate-400">{req.pay_cycle === 'engagement_end' ? 'Paid at the end' : 'Paid weekly'} · {req.payment_basis === 'per_volume' ? 'by volume' : 'by the day'}{req.closed_at ? ' · closed' : ''}</p>
      </div>
      <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="rounded border px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
      <input type="date" value={to} onChange={e => setTo(e.target.value)} className="rounded border px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
      <span className={`w-40 text-right text-xs tabular-nums ${owes ? 'font-semibold text-amber-700 dark:text-amber-300' : 'text-slate-400'}`}>
        {isFetching ? 'Checking…' : owes ? `${formatCurrency(preview!.total_amount)} · ${preview!.worker_count} worker${preview!.worker_count === 1 ? '' : 's'}` : 'Nothing owed'}
      </span>
      <button onClick={run} disabled={busy || !owes}
        className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-40">
        <Play className="h-3 w-3" /> {busy ? 'Drafting…' : 'Draft'}
      </button>
    </div>
  )
}
