import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { Panel, Pill, Stat } from '@/components/record/Record'
import {
  FISCAL_MONTHS, SORT_LABEL, againstFor, btnSm as btn, money, ratioText, referenceOf, short,
  useBucketWaiting, useOverheadHistory, useOverheadSummary, useOverheadVariance,
  type OverheadHistory, type OverheadRow, type SortKind, type VarianceRow,
} from '@/lib/buckets'
import { FiscalBars, MonthLines, OwnerQueue, Standouts, VarianceGrid } from '@/components/overhead/OverheadParts'
import { CalendarRange, ChevronDown, ChevronRight, ClipboardList, Layers, Pencil } from 'lucide-react'


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
  // The fiscal year, month by month (503e): fiscal months, Hamle … Sene.
  const { data: variance = [] } = useOverheadVariance()
  const { data: history } = useOverheadHistory()
  const vBy = useMemo(() => new Map(variance.map(v => [v.id ?? 'other', v])), [variance])
  const [showOff, setShowOff] = useState(false)

  const buckets = rows.filter(r => r.id)
  const other = rows.find(r => !r.id)
  const toSort = buckets.filter(r => r.to_sort)
  const inUse = buckets.filter(r => r.in_use && !r.to_sort)
  const offUse = buckets.filter(r => !r.in_use && !r.to_sort)
  const stats = useMemo(() => {
    const cur = variance[0]?.cur_idx ?? 0
    const thisMonth = (v: VarianceRow) => v.months[cur]?.spent ?? 0
    // Each bucket held against its budget, else its usual month.
    const held = variance.filter(v => referenceOf(v))
    return {
      cur,
      month: variance.reduce((s, v) => s + thisMonth(v), 0),
      heldSpent: held.reduce((s, v) => s + thisMonth(v), 0),
      // The month is still running: each reference counts for the share gone.
      heldRef: held.reduce((s, v) => s + againstFor(v.months[cur], v, history, referenceOf(v)!.value), 0),
      fytd: variance.reduce((s, v) => s + v.fytd, 0),
      lastFytd: variance.reduce((s, v) => s + v.last_fytd, 0),
      budgets: rows.filter(r => r.id && r.in_use && Number(r.monthly_budget ?? 0) > 0).length,
      noOwner: rows.filter(r => r.id && r.in_use && !r.to_sort && !r.owner_id).length,
    }
  }, [rows, variance, history])
  // The grid: buckets in use, and any other bucket with spending this year.
  const gridRows = variance.filter(v => !v.id || v.in_use || v.fytd > 0)

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
            <Stat label={`${FISCAL_MONTHS[stats.cur]} so far`} value={money(stats.month)}
              sub={stats.heldRef > 0 ? `${ratioText(stats.heldSpent, stats.heldRef)} the usual month${stats.budgets ? ' or budget' : ''} by now (${money(Math.round(stats.heldRef))})` : 'Nothing to compare with yet'}
              tone={stats.heldRef > 0 && stats.heldSpent > stats.heldRef * 1.1 ? 'red' : undefined} />
            <Stat label={`${history?.fy_label ?? 'This fiscal year'} so far`} value={money(stats.fytd)}
              sub={history?.has_last_year && stats.lastFytd > 0 ? `${ratioText(stats.fytd, stats.lastFytd)} on the same stretch last year` : 'No records last year to compare with'} />
            <Stat label="Waiting for an owner" value={waiting.length} sub="Spending owners haven't approved" tone={waiting.length > 0 ? 'amber' : undefined} />
            <Stat label="Buckets with no owner" value={stats.noOwner} sub="Finance approves those alone" tone={stats.noOwner > 0 ? 'amber' : undefined} />
          </div>

          {waiting.length > 0 && <OwnerQueue />}
          {isFinance && toSort.length > 0 && <SortCard rows={toSort} />}

          {gridRows.length > 0 && (
            <Panel title={`${history?.fy_label ?? 'This fiscal year'}, month by month`} icon={CalendarRange}>
              <div className="space-y-4">
                {stats.budgets === 0 && (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-900/10 dark:text-amber-200">
                    No bucket has a monthly budget yet, so each month is held against the bucket's usual month instead. Set budgets on each bucket's page to compare against them.
                  </p>
                )}
                <Standouts rows={gridRows} history={history} />
                <VarianceGrid rows={gridRows} history={history} />
              </div>
            </Panel>
          )}

          <Panel title="Cost buckets" icon={Layers} count={inUse.length} padded={false}>
            {isLoading ? <p className="p-6 text-center text-sm text-slate-400">Loading…</p> : (
              <ul className="divide-y dark:divide-slate-700">
                {inUse.map(r => <BucketRow key={r.id} r={r} v={vBy.get(r.id!)} history={history} canEdit={isFinance} />)}
                {other && <BucketRow r={other} v={vBy.get('other')} history={history} canEdit={false} />}
              </ul>
            )}
          </Panel>

          {offUse.length > 0 && (
            <section className="overflow-hidden rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <button onClick={() => setShowOff(v => !v)} className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs font-semibold text-slate-500 dark:text-slate-400">
                <span className="inline-flex items-center gap-1.5">{showOff ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} Out of use · {offUse.length}</span>
                <span className="font-normal">Kept, but left out of the pickers</span>
              </button>
              {showOff && <ul className="divide-y border-t dark:divide-slate-700 dark:border-slate-700">{offUse.map(r => <BucketRow key={r.id} r={r} v={vBy.get(r.id!)} history={history} canEdit={isFinance} />)}</ul>}
            </section>
          )}
        </>
      )}
    </div>
  )
}

function BucketRow({ r, v, history, canEdit }: { r: OverheadRow; v: VarianceRow | undefined; history: OverheadHistory | undefined; canEdit: boolean }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [picked, setPicked] = useState<string | null>(null)
  const ref = v ? referenceOf(v) : null
  const cur = v?.cur_idx ?? 0
  const thisMonth = v?.months[cur]?.spent ?? 0
  const lastYear = v?.months[cur]?.last_year ?? 0
  // The month is still running: held against the share of it gone.
  const against = v && ref ? againstFor(v.months[cur], v, history, ref.value) : 0

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
            <Link to={r.id ? `/overhead/${r.id}` : '/overhead/other'} className="hover:text-brand">{r.name}</Link>
            {r.id && !r.in_use && <Pill>Out of use</Pill>}
            {r.waiting_owner > 0 && <Pill tone="amber">{r.waiting_owner} waiting for the owner</Pill>}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {r.id
              ? <>{r.owner_name ? `Owner: ${r.owner_name}` : <span className="text-amber-700 dark:text-amber-400">No owner</span>}
                  {' · '}{r.category_name ? `Category: ${r.category_name}` : 'No default category'}</>
              : 'Recorded as company overhead, with no bucket. Pick a bucket for these where one fits.'}
          </p>
          {!r.id && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Link to="/overhead/other" className={`${btn} text-slate-600 dark:text-slate-300`}><Pencil className="h-3 w-3" /> Open · put them in buckets</Link>
            </div>
          )}
          {canEdit && r.id && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Link to={`/overhead/${r.id}`} className={`${btn} text-slate-600 dark:text-slate-300`}><Pencil className="h-3 w-3" /> Open · settings</Link>
              <button onClick={toggleUse} className={`${btn} text-slate-600 dark:text-slate-300`}>{r.in_use ? 'Take out of use' : 'Put back in use'}</button>
            </div>
          )}
        </div>
        {v && (
          <div className="w-full sm:w-64">
            <FiscalBars row={v} history={history} picked={picked} onPick={m => setPicked(p => (p === m ? null : m))} />
            <div className="mt-0.5 flex justify-between text-[10px] text-slate-400">
              <span>Hamle</span>
              {ref && <span>- - {ref.kind === 'budget' ? 'budget' : 'usual month'} {short(ref.value)}</span>}
              <span>Sene</span>
            </div>
          </div>
        )}
        <div className="grid w-full grid-cols-3 gap-3 text-right text-xs sm:w-72">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-400">{FISCAL_MONTHS[cur]} so far</p>
            <p className={`text-sm font-semibold tabular-nums ${ref && thisMonth > against * (ref.kind === 'budget' ? 1 : 1.4) ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-slate-100'}`}>{short(thisMonth)}</p>
            <p className="text-slate-400">{ref ? `${ratioText(thisMonth, against)} ${ref.kind === 'budget' ? 'budget' : 'usual'}` : 'nothing to compare'}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-400">Last year</p>
            <p className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200">{history?.has_last_year ? short(lastYear) : '—'}</p>
            <p className="text-slate-400">{history?.has_last_year ? (lastYear > 0 ? `${ratioText(thisMonth, lastYear)} now` : 'nothing then') : 'no records'}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-400">Year so far</p>
            <p className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200">{short(v?.fytd ?? 0)}</p>
            <p className="text-slate-400">{r.n_costs} cost{r.n_costs === 1 ? '' : 's'} in 12 months</p>
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
