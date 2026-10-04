import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useProjects } from '@/hooks/useLookups'
import { Stat, Panel, Pill } from '@/components/record/Record'
import { ActionDialog } from '@/components/shared/ActionDialog'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { fieldCls } from '@/lib/formStyles'
import {
  useSubcontractBoard, useSubcontractCandidates, SUBCONTRACT_WRITE_ROLES, NEXT_STEP, STATUS_LABEL,
  type BoardRow, type Candidate, type NextStep,
} from '@/lib/subcontracts'
import { Plus, HardHat, ArrowRight, Search, X, Inbox, CalendarClock, ListChecks } from 'lucide-react'

// Subcontracts as live work: what needs doing next on each job, the jobs
// by stage with their money, and payments that look like subcontracted
// work but never came through here (migration 418).

const etb = (n: number | null | undefined) => n == null ? '—' : formatCurrency(Math.round(Number(n))).replace(/\.00$/, '')
const STEP_ORDER: NextStep[] = ['overdue', 'certify', 'agree', 'start', 'complete', 'update', 'rate']
const COLUMNS: { key: BoardRow['status'][]; label: string; hint: string }[] = [
  { key: ['drafting'], label: 'Drafting', hint: 'not agreed yet' },
  { key: ['agreed'], label: 'Agreed', hint: 'not started' },
  { key: ['in_progress'], label: 'In progress', hint: 'being done' },
  { key: ['completed', 'terminated'], label: 'Done', hint: 'completed or stopped' },
]

export default function SubcontractsPage() {
  const { role } = useAuth()
  const canWrite = !!role && SUBCONTRACT_WRITE_ROLES.includes(role)
  const { data: rows = [], isLoading } = useSubcontractBoard()
  const { data: candidates = [] } = useSubcontractCandidates()
  const [search, setSearch] = useState('')

  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r => [r.vendor_name, r.project_name, r.scope_of_work].some(v => (v ?? '').toLowerCase().includes(q)))
  }, [rows, search])

  const open = rows.filter(r => ['drafting', 'agreed', 'in_progress'].includes(r.status))
  const openValue = open.reduce((s, r) => s + r.agreed_amount, 0)
  const certified = rows.reduce((s, r) => s + r.certified, 0)
  const paid = rows.reduce((s, r) => s + r.paid, 0)
  const uncertified = rows.reduce((s, r) => s + r.uncertified_work, 0)
  const outside = candidates.reduce((s, c) => s + c.amount_etb, 0)
  const steps = rows.filter(r => r.next_step).sort((a, b) => STEP_ORDER.indexOf(a.next_step!) - STEP_ORDER.indexOf(b.next_step!))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Subcontracts</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Work given to outside firms — agreed before it starts, updated as it goes, paid from certificates</p>
        </div>
        {canWrite && (
          <Link to="/subcontracts/new" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
            <Plus className="h-4 w-4" /> New subcontract
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Open work" value={etb(openValue)} sub={`${open.length} job${open.length === 1 ? '' : 's'} agreed or under way`} />
        <Stat label="Certified · paid" value={etb(certified)} sub={`${etb(paid)} paid out`} />
        <Stat label="Done, not certified" value={etb(uncertified)} tone={uncertified > 0 ? 'amber' : undefined} sub="by % complete" />
        <Stat label="Paid outside this page" value={etb(outside)} tone={candidates.length ? 'amber' : undefined} sub={`${candidates.length} payment${candidates.length === 1 ? '' : 's'} in 6 months`} />
      </div>

      {open.length === 0 && rows.length > 0 && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:border-sky-800/50 dark:bg-sky-900/15 dark:text-sky-200">
          <b>Nothing is running here right now.</b> Every job on this page was entered once it was already finished. Record the next printing, signage or fabrication job
          when it is agreed — then progress, certificates and payment follow from one place, and you can see what is still owed.
        </div>
      )}

      {steps.length > 0 && (
        <Panel title="Next steps" icon={ListChecks} count={steps.length} padded={false}>
          <ul className="divide-y dark:divide-slate-700/60">
            {steps.slice(0, 8).map(r => (
              <li key={r.id}>
                <Link to={`/subcontracts/${r.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/30">
                  <Pill tone={NEXT_STEP[r.next_step!].tone}>{NEXT_STEP[r.next_step!].label}</Pill>
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-slate-200">
                    <b className="font-semibold">{r.vendor_name ?? 'Subcontractor'}</b> · {r.project_name ?? '—'}
                    {r.next_step === 'overdue' && r.days_late ? <span className="text-red-600"> · {r.days_late} days late</span> : null}
                    {r.next_step === 'certify' && r.uncertified_work > 0 ? <span className="text-amber-700"> · {etb(r.uncertified_work)} uncertified</span> : null}
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-slate-300" />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[14rem] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Subcontractor, project or scope…"
            className="w-full rounded-lg border bg-white py-2 pl-9 pr-8 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400" aria-label="Clear"><X className="h-3.5 w-3.5" /></button>}
        </label>
      </div>

      {isLoading ? <p className="py-12 text-center text-sm text-slate-400">Loading…</p> : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map(col => {
            const items = list.filter(r => col.key.includes(r.status))
            return (
              <section key={col.label} className="rounded-xl border bg-slate-50/60 p-2 dark:border-slate-700 dark:bg-slate-900/30">
                <div className="flex items-baseline justify-between px-1.5 pb-2 pt-1">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">{col.label} <span className="font-normal text-slate-400">{items.length}</span></p>
                  <p className="text-[11px] text-slate-400">{col.hint}</p>
                </div>
                <div className="space-y-2">
                  {items.length === 0
                    ? <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-slate-400 dark:border-slate-700">None</p>
                    : items.map(r => <JobCard key={r.id} r={r} />)}
                </div>
              </section>
            )
          })}
        </div>
      )}

      <OutsideWork candidates={candidates} canWrite={canWrite} />
    </div>
  )
}

function JobCard({ r }: { r: BoardRow }) {
  const certPct = r.agreed_amount ? Math.min(100, (r.certified / r.agreed_amount) * 100) : 0
  const paidPct = r.agreed_amount ? Math.min(100, (r.paid / r.agreed_amount) * 100) : 0
  return (
    <Link to={`/subcontracts/${r.id}`} className="block rounded-lg border bg-white p-3 shadow-sm transition-colors hover:border-brand dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-sm font-semibold text-slate-800 dark:text-slate-100">{r.vendor_name ?? 'Subcontractor'}</p>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{etb(r.agreed_amount)}</span>
      </div>
      <p className="text-xs text-slate-500">{r.project_name ?? '—'}</p>
      {r.scope_of_work && <p className="mt-1 line-clamp-2 text-xs text-slate-600 dark:text-slate-300">{r.scope_of_work}</p>}
      <div className="mt-2 space-y-1">
        <p className="text-[11px] text-slate-500"><b className="font-semibold text-slate-700 dark:text-slate-200">{Math.round(r.percent_complete)}% done</b></p>
        <p className="text-[11px] tabular-nums text-slate-500">{etb(r.certified)} certified · {etb(r.paid)} paid</p>
        <div className="relative h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700" title={`${Math.round(certPct)}% certified, ${Math.round(paidPct)}% paid`}>
          <div className="absolute inset-y-0 left-0 rounded-full bg-[#2a78d6]/35 dark:bg-[#3987e5]/40" style={{ width: `${certPct}%` }} />
          <div className="absolute inset-y-0 left-0 rounded-full bg-[#2a78d6] dark:bg-[#3987e5]" style={{ width: `${paidPct}%` }} />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        {r.target_completion_date && r.status !== 'completed' && (
          <span className={`inline-flex items-center gap-0.5 ${r.overdue ? 'font-medium text-red-600' : 'text-slate-500'}`}>
            <CalendarClock className="h-3 w-3" /> {r.overdue ? `${r.days_late}d late` : `due ${formatDate(r.target_completion_date)}`}
          </span>
        )}
        {r.status === 'terminated' && <Pill>{STATUS_LABEL.terminated}</Pill>}
        {r.next_step && <Pill tone={NEXT_STEP[r.next_step].tone}>{NEXT_STEP[r.next_step].label}</Pill>}
      </div>
    </Link>
  )
}

// Payments that look like subcontracted work but have no engagement.
function OutsideWork({ candidates, canWrite }: { candidates: Candidate[]; canWrite: boolean }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { data: projects = [] } = useProjects()
  const [adopting, setAdopting] = useState<Candidate | null>(null)
  const [scope, setScope] = useState('')
  const [projectId, setProjectId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const projectOptions = useMemo(() => (projects as { id: string; project_name: string }[]).map(p => ({ id: p.id, label: p.project_name })), [projects])

  if (candidates.length === 0) return null

  function startAdopt(c: Candidate) {
    setAdopting(c); setScope(c.description?.replace(/^PO PO-\d{4}-\d+ — /, '') ?? ''); setProjectId(c.project_id)
  }

  async function adopt() {
    if (!adopting) return
    setBusy(true)
    const { data, error } = await supabase.rpc('adopt_subcontract_expense', { p_expense: adopting.expense_id, p_scope: scope, p_project: projectId })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    for (const k of ['subcontract-board', 'subcontract-candidates', 'subcontractor-engagements']) qc.invalidateQueries({ queryKey: [k] })
    toast('Recorded as a subcontract — rate them when you can', 'success')
    navigate(`/subcontracts/${data}`)
  }

  async function dismiss(c: Candidate) {
    const { error } = await supabase.from('subcontract_candidate_dismissals').insert([{ expense_id: c.expense_id, reason: 'not a subcontract' }])
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['subcontract-candidates'] })
  }

  return (
    <Panel title="Paid outside this page" icon={Inbox} count={candidates.length} padded={false}>
      <p className="border-b px-4 py-2.5 text-xs text-slate-500 dark:border-slate-700">
        Payments of the last six months that look like subcontracted work — printing, signage, fabrication, installation — with no engagement.
        Recording them shows what each firm has done for you and lets you rate them; it doesn't pay anything again.
      </p>
      <ul className="divide-y dark:divide-slate-700/60">
        {candidates.map(c => (
          <li key={c.expense_id} className="flex flex-wrap items-start gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                {c.vendor_name ?? 'No vendor'}
                {c.looks_like && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">{c.looks_like}</span>}
              </p>
              <p className="truncate text-xs text-slate-600 dark:text-slate-300">{c.description ?? '—'}</p>
              <p className="text-[11px] text-slate-400">
                <Link to={`/expenses/${c.expense_id}`} className="hover:text-brand">{c.expense_code ?? 'Expense'}</Link> · {formatDate(c.date)} · {c.project_name ?? <span className="text-amber-600">no project</span>}
                {c.payment_state ? ` · ${c.payment_state.replace(/_/g, ' ')}` : ''}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <span className="text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{etb(c.amount_etb)}</span>
              {canWrite && (
                <div className="flex gap-1.5">
                  <button onClick={() => dismiss(c)} className="rounded-md px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">Not a subcontract</button>
                  {c.vendor_id
                    ? <button onClick={() => startAdopt(c)} className="inline-flex items-center gap-1 rounded-md bg-brand px-2.5 py-1 text-[11px] font-semibold text-white"><HardHat className="h-3 w-3" /> Record it</button>
                    : <Link to={`/expenses/${c.expense_id}`} className="rounded-md border px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:border-slate-600 dark:text-slate-300">Set its vendor first</Link>}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>

      {adopting && (
        <ActionDialog title={`Record ${adopting.vendor_name ?? 'this payment'} as a subcontract`} confirmLabel="Record it" busy={busy}
          canConfirm={!!scope.trim() && !!projectId} onClose={() => setAdopting(null)} onConfirm={adopt}
          description={<>A completed job of {etb(adopting.amount_etb)}, certified in full and matched to {adopting.expense_code ?? 'the payment'} — no new payment request is raised.</>}>
          <label className="block text-xs font-medium text-slate-500">What was the work?
            <textarea rows={3} className={`${fieldCls} mt-1`} value={scope} onChange={e => setScope(e.target.value)} placeholder="e.g. Frosted sticker printing and fixing on the glass partitions" />
          </label>
          <label className="block text-xs font-medium text-slate-500">Project
            <div className="mt-1"><SearchableSelect value={projectId} onChange={setProjectId} options={projectOptions} placeholder="Which project was it for?" /></div>
          </label>
        </ActionDialog>
      )}
    </Panel>
  )
}
