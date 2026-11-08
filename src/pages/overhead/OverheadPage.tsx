import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { Panel, Pill, Stat } from '@/components/record/Record'
import {
  SORT_LABEL, btnSm as btn, money, monthName, short, useBucketWaiting, useOverheadSummary,
  type OverheadRow, type SortKind,
} from '@/lib/buckets'
import { MonthBars, MonthLines, OwnerQueue } from '@/components/overhead/OverheadParts'
import { ChevronDown, ChevronRight, ClipboardList, Layers, Pencil } from 'lucide-react'


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
            {r.id ? <Link to={`/overhead/${r.id}`} className="hover:text-brand">{r.name}</Link> : r.name}
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
              <Link to={`/overhead/${r.id}`} className={`${btn} text-slate-600 dark:text-slate-300`}><Pencil className="h-3 w-3" /> Open · settings</Link>
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
