import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useCategories } from '@/hooks/useLookups'
import { canApproveAsFinance } from '@/lib/expenseAccess'
import { formatCurrency, formatDate } from '@/lib/utils'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { Pill } from '@/components/record/Record'
import { IssueChips, ProjectOrOverheadSelect } from '@/components/expenses/ExpenseFields'
import { AGE_BUCKETS, ISSUE, ageBucket, fromProjectChoice, projectChoice, useApprovalQueue, type ApprovalQueueRow } from '@/lib/expenseQuality'
import { CheckCircle2, Clock, Paperclip, Search, Wrench, X } from 'lucide-react'

// Approval queue (395): everything waiting for finance, oldest first, with
// what holds each one up. A missing project or ledger is fixed in the row,
// then it approves.

type Filter = 'all' | 'ready' | 'fix'
const blocked = (r: ApprovalQueueRow) => r.issues.some(i => ISSUE[i]?.blocksApproval)

export default function ExpenseApprovalQueuePage() {
  const { role } = useAuth()
  const canApprove = canApproveAsFinance(role)
  const { data: rows = [], isLoading } = useApprovalQueue()
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const qc = useQueryClient()
  const { toast } = useToast()

  const needle = q.trim().toLowerCase()
  const shown = rows.filter(r =>
    (filter === 'all' || (filter === 'ready' ? !blocked(r) : blocked(r)))
    && (!needle || `${r.expense_code ?? ''} ${r.item_service_description ?? ''} ${r.payee_name ?? ''} ${r.project_name ?? ''} ${r.requested_by_name ?? ''}`.toLowerCase().includes(needle)))
  const groups = AGE_BUCKETS.map(b => ({ ...b, rows: shown.filter(r => ageBucket(r.age_days).key === b.key) })).filter(g => g.rows.length)

  const total = rows.reduce((s, r) => s + Number(r.amount_etb ?? 0), 0)
  const old = rows.filter(r => r.age_days >= 15).length
  const toFix = rows.filter(blocked).length
  const pickedReady = shown.filter(r => picked.has(r.id) && !blocked(r))

  function refresh() {
    qc.invalidateQueries({ queryKey: ['expense-approval-queue'] })
    qc.invalidateQueries({ queryKey: ['expense-issues'] })
    qc.invalidateQueries({ queryKey: ['expenses'] })
  }

  async function approveMany(list: ApprovalQueueRow[]) {
    setBulkBusy(true)
    let ok = 0
    for (const r of list) {
      const { error } = await supabase.from('expenses').update({ approval_status: 'finance_approved' }).eq('id', r.id)
      if (error) toast(`${r.expense_code ?? 'Expense'}: ${error.message}`, 'error')
      else ok++
    }
    setBulkBusy(false)
    setPicked(new Set())
    refresh()
    if (ok) toast(`${ok} approved for payment`, 'success')
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Approval Queue</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Expenses waiting for finance, oldest first. Fix what's missing in the row, then approve.</p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Waiting" value={String(rows.length)} sub={formatCurrency(total)} />
        <Tile label="Over 2 weeks" value={String(old)} tone={old ? 'red' : undefined} />
        <Tile label="Need fixing first" value={String(toFix)} tone={toFix ? 'amber' : undefined} sub="No project or no ledger" />
        <Tile label="Ready to approve" value={String(rows.length - toFix)} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {([['all', 'All'], ['ready', 'Ready'], ['fix', 'Needs fixing']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${filter === k ? 'border-brand bg-brand/10 text-brand' : 'text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>
            {label}
          </button>
        ))}
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search code, payee, project…"
            className="w-full rounded-lg border py-1.5 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        {canApprove && pickedReady.length > 0 && (
          <button disabled={bulkBusy} onClick={() => approveMany(pickedReady)}
            className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50">
            {bulkBusy ? 'Approving…' : `Approve ${pickedReady.length} selected`}
          </button>
        )}
      </div>

      {isLoading ? <p className="py-12 text-center text-sm text-slate-400">Loading…</p> : groups.length === 0 ? (
        <p className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Nothing waiting here.</p>
      ) : groups.map(g => (
        <section key={g.key} className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <Pill tone={g.tone}>{g.label}</Pill>
            <span className="text-xs font-normal text-slate-400">{g.rows.length} · {formatCurrency(g.rows.reduce((s, r) => s + Number(r.amount_etb ?? 0), 0))}</span>
          </h2>
          <div className="divide-y rounded-xl border bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800">
            {g.rows.map(r => (
              <QueueRow key={r.id} row={r} canApprove={canApprove} onDone={refresh}
                picked={picked.has(r.id)}
                onPick={v => setPicked(p => { const n = new Set(p); if (v) n.add(r.id); else n.delete(r.id); return n })} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'red' | 'amber' }) {
  return (
    <div className="rounded-xl border bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : 'text-slate-800 dark:text-slate-100'}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-400">{sub}</p>}
    </div>
  )
}

function QueueRow({ row: r, canApprove, onDone, picked, onPick }: {
  row: ApprovalQueueRow; canApprove: boolean; onDone: () => void; picked: boolean; onPick: (v: boolean) => void
}) {
  const { toast } = useToast()
  const { data: categories = [] } = useCategories()
  const categoryOptions = useMemo(() => (categories as { id: string; category_name: string }[]).map(c => ({ id: c.id, label: c.category_name })), [categories])
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const isBlocked = blocked(r)

  async function update(patch: Record<string, unknown>, done: string) {
    setBusy(true)
    const { error } = await supabase.from('expenses').update(patch).eq('id', r.id)
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast(done, 'success')
    setRejecting(false)
    onDone()
  }

  return (
    <div className="space-y-2 px-3 py-3">
      <div className="flex items-start gap-3">
        {canApprove && (
          <input type="checkbox" className="mt-1" disabled={isBlocked} checked={picked && !isBlocked} onChange={e => onPick(e.target.checked)}
            title={isBlocked ? 'Fix what is missing first' : 'Select to approve together'} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link to={`/expenses/${r.id}`} className="font-mono text-xs font-bold text-brand hover:underline">{r.expense_code ?? 'Expense'}</Link>
            <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{r.item_service_description ?? '—'}</span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {r.payee_name ?? 'No payee'} · {r.project_name ?? (r.is_overhead ? 'Company overhead' : 'No project')} · {r.category_name ?? 'No ledger'}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{r.age_days} day{r.age_days === 1 ? '' : 's'} waiting</span>
            <span>Dated {formatDate(r.date)}</span>
            {r.requested_by_name && <span>by {r.requested_by_name}</span>}
            {r.receipt_url && <a href={r.receipt_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand hover:underline"><Paperclip className="h-3 w-3" />Receipt</a>}
          </p>
          {r.issues.length > 0 && <div className="mt-1"><IssueChips issues={r.issues} /></div>}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(r.amount_etb)}</p>
          {canApprove && !rejecting && (
            <div className="mt-1 flex justify-end gap-1">
              <button disabled={busy || isBlocked} onClick={() => update({ approval_status: 'finance_approved' }, 'Approved for payment')}
                title={isBlocked ? 'Fix what is missing first' : undefined}
                className="rounded-md bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-40">Approve</button>
              <button disabled={busy} onClick={() => setRejecting(true)} className="rounded-md bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-100">Reject</button>
            </div>
          )}
        </div>
      </div>

      {canApprove && isBlocked && (
        <div className="ml-0 grid grid-cols-1 gap-2 rounded-lg bg-amber-50 p-2 dark:bg-amber-900/10 sm:ml-7 sm:grid-cols-2">
          <p className="flex items-center gap-1 text-[11px] font-medium text-amber-800 dark:text-amber-300 sm:col-span-2"><Wrench className="h-3 w-3" />Fix it here, then approve</p>
          {r.issues.includes('no_project') && (
            <ProjectOrOverheadSelect value={projectChoice(r.project_id, r.is_overhead)}
              onChange={v => v && update(fromProjectChoice(v), 'Project set')} />
          )}
          {r.issues.includes('no_ledger') && (
            <SearchableSelect value={r.category_id} onChange={id => id && update({ category_id: id }, 'Ledger set')} options={categoryOptions} placeholder="Pick the general ledger…" />
          )}
        </div>
      )}

      {rejecting && (
        <div className="flex flex-wrap items-center gap-2 sm:ml-7">
          <input autoFocus value={reason} onChange={e => setReason(e.target.value)} placeholder="Why is it rejected? The requester sees this."
            className="min-w-[200px] flex-1 rounded-md border px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
          <button disabled={busy || !reason.trim()} onClick={() => update({ approval_status: 'rejected', rejection_reason: reason.trim() }, 'Rejected')}
            className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">Reject</button>
          <button onClick={() => setRejecting(false)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
      )}
    </div>
  )
}
