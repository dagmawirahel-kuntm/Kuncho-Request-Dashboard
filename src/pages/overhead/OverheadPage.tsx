import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { Panel, Pill, Stat } from '@/components/record/Record'
import { formatCurrency, formatDate } from '@/lib/utils'
import {
  SORT_LABEL, useBucketWaiting, useOverheadSummary,
  type OverheadRow, type SortKind,
} from '@/lib/buckets'
import { ChevronDown, ChevronRight, ClipboardList, Layers, Pencil, UserCheck } from 'lucide-react'

const money = (n: number | null | undefined) => formatCurrency(Number(n ?? 0)).replace(/\.00$/, '')
const short = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)))
const monthName = (iso: string, year = false) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { month: 'short', ...(year ? { year: 'numeric' } : {}) })
const btn = 'inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium disabled:opacity-50 dark:border-slate-600'

/**
 * Overhead (503): the company's running costs, one cost bucket at a time.
 * A bucket never closes: each is read month by month against its monthly
 * budget and the same month last year, and its months lock with the fiscal
 * period. Its owner approves its spending before finance.
 */
export default function OverheadPage() {
  const { hasRole } = useAuth()
  const isFinance = hasRole('admin', 'finance')
  const { data: rows = [], isLoading } = useOverheadSummary()
  const { data: waiting = [] } = useBucketWaiting()
  const [showOff, setShowOff] = useState(false)

  const buckets = rows.filter(r => r.id)
  const other = rows.find(r => !r.id)
  const toSort = buckets.filter(r => r.to_sort)
  const inUse = buckets.filter(r => r.in_use && !r.to_sort)
  const offUse = buckets.filter(r => !r.in_use && !r.to_sort)
  const stats = useMemo(() => {
    const named = rows.filter(r => r.id)
    return {
      month: rows.reduce((s, r) => s + Number(r.this_month), 0),
      year: rows.reduce((s, r) => s + Number(r.last_12), 0),
      budget: named.filter(r => r.in_use).reduce((s, r) => s + Number(r.monthly_budget ?? 0), 0),
      // Only buckets with a budget are held against one.
      budgetedSpent: named.filter(r => r.in_use && Number(r.monthly_budget ?? 0) > 0).reduce((s, r) => s + Number(r.this_month), 0),
      noOwner: named.filter(r => r.in_use && !r.to_sort && !r.owner_id).length,
    }
  }, [rows])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Overhead</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          The company's running costs, by cost bucket, month by month. Buckets never close: each month locks with the fiscal period.
        </p>
      </div>

      {!isLoading && rows.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed bg-white py-14 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800">
          Nothing here for you: no cost bucket is yours to look after.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="This month" value={money(stats.month)}
              sub={stats.budget > 0 ? `Budgeted buckets: ${money(stats.budgetedSpent)} of ${money(stats.budget)}` : 'No monthly budgets set yet'}
              tone={stats.budget > 0 && stats.budgetedSpent > stats.budget ? 'red' : undefined} />
            <Stat label="Last 12 months" value={money(stats.year)} sub="Every bucket, and overhead with none" />
            <Stat label="Waiting for an owner" value={waiting.length} sub="Spending owners haven't approved" tone={waiting.length > 0 ? 'amber' : undefined} />
            <Stat label="Buckets with no owner" value={stats.noOwner} sub="Finance approves those alone" tone={stats.noOwner > 0 ? 'amber' : undefined} />
          </div>

          {waiting.length > 0 && <OwnerQueue />}
          {isFinance && toSort.length > 0 && <SortCard rows={toSort} />}

          <Panel title="Cost buckets" icon={Layers} count={inUse.length} padded={false}>
            {isLoading ? <p className="p-6 text-center text-sm text-slate-400">Loading…</p> : (
              <ul className="divide-y dark:divide-slate-700">
                {inUse.map(r => <BucketRow key={r.id} r={r} canEdit={isFinance} />)}
                {other && <BucketRow r={other} canEdit={false} />}
              </ul>
            )}
          </Panel>

          {offUse.length > 0 && (
            <section className="overflow-hidden rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <button onClick={() => setShowOff(v => !v)} className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs font-semibold text-slate-500 dark:text-slate-400">
                <span className="inline-flex items-center gap-1.5">{showOff ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} Out of use · {offUse.length}</span>
                <span className="font-normal">Kept, but left out of the pickers</span>
              </button>
              {showOff && <ul className="divide-y border-t dark:divide-slate-700 dark:border-slate-700">{offUse.map(r => <BucketRow key={r.id} r={r} canEdit={isFinance} />)}</ul>}
            </section>
          )}
        </>
      )}
    </div>
  )
}

/** Twelve months as bars, with the monthly budget as a line. */
function MonthBars({ r, picked, onPick }: { r: OverheadRow; picked: string | null; onPick: (m: string) => void }) {
  const budget = Number(r.monthly_budget ?? 0)
  const top = Math.max(budget, ...r.months.map(m => Number(m.spent)), 1)
  return (
    <div className="relative flex h-16 items-end gap-1" role="group" aria-label={`${r.name}, month by month`}>
      {budget > 0 && (
        <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-slate-400 dark:border-slate-500" style={{ bottom: `${(budget / top) * 100}%` }} />
      )}
      {r.months.map(m => {
        const spent = Number(m.spent)
        const over = budget > 0 && spent > budget
        return (
          <button key={m.month} type="button" onClick={() => onPick(m.month)} title={`${monthName(m.month, true)}: ${money(spent)}`}
            aria-label={`${monthName(m.month, true)}: ${money(spent)}`}
            className={`flex-1 rounded-t-sm transition-opacity hover:opacity-80 ${picked === m.month ? 'ring-2 ring-brand ring-offset-1 dark:ring-offset-slate-800' : ''} ${spent === 0 ? 'bg-slate-100 dark:bg-slate-700' : over ? 'bg-red-500' : 'bg-sky-500'}`}
            style={{ height: `${spent === 0 ? 4 : Math.max((spent / top) * 100, 6)}%` }} />
        )
      })}
    </div>
  )
}

function BucketRow({ r, canEdit }: { r: OverheadRow; canEdit: boolean }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [picked, setPicked] = useState<string | null>(null)
  const budget = Number(r.monthly_budget ?? 0)
  const pct = budget > 0 ? (Number(r.this_month) / budget) * 100 : null
  const vsLastYear = Number(r.same_month_last_year) > 0 ? ((Number(r.this_month) - Number(r.same_month_last_year)) / Number(r.same_month_last_year)) * 100 : null

  async function toggleUse() {
    const { error } = await supabase.from('projects').update({ active_for_year: !r.in_use }).eq('id', r.id!)
    if (error) { toast(error.message, 'error'); return }
    toast(r.in_use ? `${r.name} is out of use: left out of the pickers` : `${r.name} is back in use`, 'success')
    qc.invalidateQueries({ queryKey: ['overhead-summary'] })
    qc.invalidateQueries({ queryKey: ['projects-lookup'] })
  }

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-[12rem] flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100">
            {r.name}
            {r.id && !r.in_use && <Pill>Out of use</Pill>}
            {r.waiting_owner > 0 && <Pill tone="amber">{r.waiting_owner} waiting for the owner</Pill>}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {r.id
              ? <>{r.owner_name ? `Owner: ${r.owner_name}` : <span className="text-amber-700 dark:text-amber-400">No owner</span>}
                  {' · '}{r.category_name ? `Category: ${r.category_name}` : 'No default category'}</>
              : 'Recorded as company overhead, with no bucket. Pick a bucket for these where one fits.'}
          </p>
          {canEdit && r.id && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Link to={`/projects/${r.id}/edit`} className={`${btn} text-slate-600 dark:text-slate-300`}><Pencil className="h-3 w-3" /> Owner, budget, category</Link>
              <button onClick={toggleUse} className={`${btn} text-slate-600 dark:text-slate-300`}>{r.in_use ? 'Take out of use' : 'Put back in use'}</button>
            </div>
          )}
        </div>
        <div className="w-full sm:w-64">
          <MonthBars r={r} picked={picked} onPick={m => setPicked(p => (p === m ? null : m))} />
          <div className="mt-0.5 flex justify-between text-[10px] text-slate-400">
            <span>{r.months[0] ? monthName(r.months[0].month) : ''}</span>
            {budget > 0 && <span>- - budget {short(budget)}/month</span>}
            <span>{r.months.length ? monthName(r.months[r.months.length - 1].month) : ''}</span>
          </div>
        </div>
        <div className="grid w-full grid-cols-3 gap-3 text-right text-xs sm:w-72">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-400">This month</p>
            <p className={`text-sm font-semibold tabular-nums ${pct != null && pct > 100 ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-slate-100'}`}>{short(Number(r.this_month))}</p>
            <p className="text-slate-400">{pct != null ? `${Math.round(pct)}% of budget` : 'no budget'}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-400">Last year</p>
            <p className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200">{short(Number(r.same_month_last_year))}</p>
            <p className="text-slate-400">{vsLastYear == null ? 'same month' : `${vsLastYear > 0 ? '+' : ''}${Math.round(vsLastYear)}% now`}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-400">12 months</p>
            <p className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200">{short(Number(r.last_12))}</p>
            <p className="text-slate-400">{r.n_costs} cost{r.n_costs === 1 ? '' : 's'}</p>
          </div>
        </div>
      </div>
      {picked && <MonthLines bucket={r.id} name={r.name} month={picked} />}
    </li>
  )
}

function MonthLines({ bucket, name, month }: { bucket: string | null; name: string; month: string }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ['overhead-month-lines', bucket, month],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('overhead_month_lines', { p_project: bucket, p_month: month })
      if (error) throw error
      return (data ?? []) as { id: string; expense_code: string | null; date: string; description: string | null; amount: number; payee: string | null; approval_status: string; payment_state: string | null }[]
    },
  })
  return (
    <div className="mt-2 rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-900/40">
      <p className="mb-1 font-semibold text-slate-700 dark:text-slate-200">{name} · {monthName(month, true)}</p>
      {isLoading ? <p className="text-slate-400">Loading…</p> : data.length === 0 ? <p className="text-slate-400">Nothing spent that month.</p> : (
        <ul className="divide-y dark:divide-slate-700">
          {data.map(l => (
            <li key={l.id} className="flex items-center gap-2 py-1">
              <Link to={`/expenses/${l.id}`} className="shrink-0 whitespace-nowrap font-mono text-brand hover:underline">{l.expense_code ?? 'Expense'}</Link>
              <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">{l.description ?? '—'}{l.payee ? ` · ${l.payee}` : ''}</span>
              {l.approval_status !== 'finance_approved' && <Pill tone="amber">{l.approval_status === 'manager_approved' ? 'Owner approved' : 'Waiting'}</Pill>}
              <span className="shrink-0 tabular-nums font-semibold text-slate-800 dark:text-slate-100">{money(l.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Spending waiting for its bucket's owner (an admin sees every owner's). */
function OwnerQueue() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { data: rows = [] } = useBucketWaiting()
  const [busy, setBusy] = useState<string | null>(null)
  const [no, setNo] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  async function decide(id: string, approve: boolean) {
    setBusy(id)
    const { error } = await supabase.rpc('bucket_expense_decide', { p_expense: id, p_approve: approve, p_reason: approve ? null : reason.trim() })
    setBusy(null)
    if (error) { toast(error.message, 'error'); return }
    toast(approve ? 'Approved: it goes to finance next' : 'Turned down', 'success')
    setNo(null); setReason('')
    qc.invalidateQueries({ queryKey: ['bucket-waiting'] })
    qc.invalidateQueries({ queryKey: ['overhead-summary'] })
    qc.invalidateQueries({ queryKey: ['expense-approval-queue'] })
  }
  return (
    <Panel title="Waiting for the owner" icon={UserCheck} count={rows.length}>
      <p className="mb-2 text-xs text-slate-500">The owner of a bucket approves its spending first; finance approves it for payment after.</p>
      <ul className="divide-y text-sm dark:divide-slate-700">
        {rows.map(w => (
          <li key={w.id} className="py-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                <p className="text-slate-800 dark:text-slate-100">
                  <Link to={`/expenses/${w.id}`} className="font-mono text-xs text-brand hover:underline">{w.expense_code ?? 'Expense'}</Link>
                  {' '}{w.description ?? '—'}
                </p>
                <p className="text-xs text-slate-500">{w.bucket} · {formatDate(w.date)}{w.payee ? ` · ${w.payee}` : ''}{w.requested_by ? ` · raised by ${w.requested_by}` : ''}{w.owner_name ? ` · owner ${w.owner_name}` : ''}</p>
              </div>
              <span className="mr-auto tabular-nums font-semibold text-slate-800 dark:text-slate-100 sm:mr-0">{money(w.amount)}</span>
              <button onClick={() => { setNo(w.id); setReason('') }} disabled={busy === w.id} className={`${btn} text-red-600`}>Turn down</button>
              <button onClick={() => decide(w.id, true)} disabled={busy === w.id} className={`${btn} border-emerald-600 bg-emerald-600 text-white`}>Approve</button>
            </div>
            {no === w.id && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input autoFocus value={reason} onChange={e => setReason(e.target.value)} placeholder="Why is it turned down?" aria-label="Why is it turned down?"
                  className="min-w-[14rem] flex-1 rounded-md border px-2.5 py-1.5 text-base sm:text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                <button onClick={() => setNo(null)} className={`${btn} text-slate-600 dark:text-slate-300`}>Cancel</button>
                <button onClick={() => decide(w.id, false)} disabled={!reason.trim() || busy === w.id} className={`${btn} border-red-600 bg-red-600 text-white`}>Turn it down</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  )
}

/** The one-time sort of the projects marked internal before 503. */
function SortCard({ rows }: { rows: OverheadRow[] }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [choice, setChoice] = useState<Record<string, SortKind>>({})
  const [busy, setBusy] = useState(false)
  const kindOf = (r: OverheadRow) => choice[r.id!] ?? r.suggested_kind ?? 'bucket'
  async function apply(list: OverheadRow[]) {
    const tests = list.filter(r => kindOf(r) === 'test')
    if (tests.length && !window.confirm(`${tests.map(r => r.name).join(', ')} will close as not real projects. Go ahead?`)) return
    setBusy(true)
    let ok = 0
    const failed: string[] = []
    for (const r of list) {
      const { error } = await supabase.rpc('project_sort_kind', { p_project: r.id, p_kind: kindOf(r) })
      if (error) failed.push(`${r.name}: ${error.message}`); else ok++
    }
    setBusy(false)
    if (ok) toast(`${ok} sorted`, 'success')
    if (failed.length) toast(failed.slice(0, 3).join(' · '), 'error')
    for (const k of ['overhead-summary', 'projects', 'projects-lookup', 'project-close-review']) qc.invalidateQueries({ queryKey: [k] })
  }
  return (
    <section className="overflow-hidden rounded-xl border border-amber-200 bg-white shadow-sm dark:border-amber-800/50 dark:bg-slate-800">
      <div className="flex flex-wrap items-start gap-2 bg-amber-50 px-4 py-3 dark:bg-amber-900/15">
        <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Sort the {rows.length} projects marked internal</p>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            "Internal" used to mean both a cost bucket and a job whose client wasn't known. Each is suggested from its name and what's on it; change any that's wrong.
          </p>
        </div>
        <button onClick={() => apply(rows)} disabled={busy} className={`${btn} border-emerald-600 bg-emerald-600 text-white`}>Apply all</button>
      </div>
      <ul className="divide-y dark:divide-slate-700">
        {rows.map(r => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
            <span className="min-w-[10rem] flex-1">
              <Link to={`/projects/${r.id}`} className="font-medium text-slate-800 hover:text-brand dark:text-slate-100">{r.name}</Link>
              <span className="text-xs text-slate-500"> · {r.n_costs ? `${r.n_costs} cost${r.n_costs === 1 ? '' : 's'} in 12 months, ${money(r.last_12)}` : 'nothing spent in 12 months'}</span>
            </span>
            <select value={kindOf(r)} onChange={e => setChoice(c => ({ ...c, [r.id!]: e.target.value as SortKind }))} aria-label={`What ${r.name} is`}
              className={`rounded-md border px-2 py-1 text-base sm:text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 ${kindOf(r) !== r.suggested_kind ? 'border-brand' : ''}`}>
              {(Object.keys(SORT_LABEL) as SortKind[]).map(k => <option key={k} value={k}>{SORT_LABEL[k]}{k === r.suggested_kind ? ' (suggested)' : ''}</option>)}
            </select>
            <button onClick={() => apply([r])} disabled={busy} className={`${btn} text-slate-700 dark:text-slate-200`}>Apply</button>
          </li>
        ))}
      </ul>
    </section>
  )
}
