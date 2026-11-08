import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useProjects } from '@/hooks/useLookups'
import { Panel, Pill, Stat } from '@/components/record/Record'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { FiscalBars, FiscalTable, MonthLines } from '@/components/overhead/OverheadParts'
import {
  FISCAL_MONTHS, againstFor, btnSm as btn, gregMonth, isTargetBucket, money, ratioText, referenceOf,
  useOverheadHistory, useOverheadVariance, type PickerProject,
} from '@/lib/buckets'
import { formatDate } from '@/lib/utils'
import { ArrowLeft, ArrowRight, BarChart3, Inbox } from 'lucide-react'

type Unbucketed = {
  id: string; expense_code: string | null; date: string; description: string | null; amount: number; payee: string | null
  category_name: string | null; approval_status: string; payment_state: string | null; requested_by: string | null
  suggested_bucket: string | null; suggested_bucket_name: string | null
}

/**
 * Overhead recorded with no bucket (503): read like a bucket, month by month
 * against its usual month, and emptied into the buckets the spending belongs
 * to. Each expense comes with the bucket its category usually goes to.
 */
export default function OtherOverheadPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { hasRole } = useAuth()
  const canMove = hasRole('admin', 'finance')
  const [picked, setPicked] = useState<string | null>(null)
  const [chosen, setChosen] = useState<Record<string, string | null>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkTo, setBulkTo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const { data: variance = [], isLoading } = useOverheadVariance()
  const { data: history } = useOverheadHistory()
  const v = variance.find(r => r.id === null)
  const { data: rows = [] } = useQuery({
    queryKey: ['overhead-unbucketed'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('overhead_unbucketed', { p_limit: 300 })
      if (error) throw error
      return (data ?? []) as Unbucketed[]
    },
    enabled: hasRole('admin', 'finance', 'executive'),
  })
  const { data: projects = [] } = useProjects()
  const bucketOptions = useMemo(() => (projects as PickerProject[]).filter(isTargetBucket)
    .map(p => ({ id: p.id, label: p.project_name })), [projects])

  if (!hasRole('admin', 'finance', 'executive')) {
    return <p className="py-16 text-center text-sm text-slate-500">Overhead with no bucket is for finance.</p>
  }
  if (isLoading) return <p className="py-16 text-center text-sm text-slate-400">Loading…</p>

  const cur = v?.cur_idx ?? 0
  const thisMonth = v?.months[cur]?.spent ?? 0
  const lastYear = v?.months[cur]?.last_year ?? 0
  const ref = v ? referenceOf(v) : null
  const against = v && ref ? againstFor(v.months[cur], v, history, ref.value) : 0
  const usualMonths = history?.usual_months ?? 0
  const total = rows.reduce((s, r) => s + Number(r.amount), 0)
  const target = (r: Unbucketed) => (r.id in chosen ? chosen[r.id] : r.suggested_bucket)
  const withSuggestion = rows.filter(r => r.suggested_bucket)
  // One click picks every expense suggested for the same bucket.
  const bySuggestion = [...rows.reduce((m, r) => {
    if (r.suggested_bucket) m.set(r.suggested_bucket, { name: r.suggested_bucket_name ?? 'Bucket', ids: [...(m.get(r.suggested_bucket)?.ids ?? []), r.id] })
    return m
  }, new Map<string, { name: string; ids: string[] }>())].sort((a, b) => b[1].ids.length - a[1].ids.length)

  async function move(ids: string[], bucket: string | null, label: string) {
    if (!bucket || ids.length === 0) return
    setBusy(true)
    const { data, error } = await supabase.rpc('expense_move_to_bucket', { p_expenses: ids, p_bucket: bucket })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    const res = data as { moved: number; failed: { code: string | null; error: string }[] }
    if (res.moved) toast(`${res.moved} moved to ${label}`, 'success')
    if (res.failed.length) toast(res.failed.slice(0, 3).map(f => `${f.code ?? 'Expense'}: ${f.error}`).join(' · '), 'error')
    setSelected(new Set())
    for (const k of ['overhead-unbucketed', 'overhead-variance', 'overhead-summary', 'overhead-month-lines']) qc.invalidateQueries({ queryKey: [k] })
  }
  /** Each to the bucket picked for it (or suggested), grouped per bucket. */
  async function moveEachToItsBucket(list: Unbucketed[]) {
    const by = new Map<string, string[]>()
    for (const r of list) { const b = target(r); if (b) by.set(b, [...(by.get(b) ?? []), r.id]) }
    for (const [b, ids] of by) await move(ids, b, bucketOptions.find(o => o.id === b)?.label ?? 'its bucket')
  }

  return (
    <div className="space-y-5">
      <Link to="/overhead" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand"><ArrowLeft className="h-4 w-4" /> Overhead</Link>
      <div className="flex flex-wrap items-start gap-3">
        <div className="rounded-xl bg-slate-100 p-2.5 text-slate-500 dark:bg-slate-700 dark:text-slate-300"><Inbox className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold text-slate-800 dark:text-slate-100">
            Other company overhead <Pill tone="amber">No bucket</Pill>
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Spending marked company overhead but not put in a bucket. Put each in the bucket it belongs to: it then counts in that bucket's months, and its owner sees it.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Waiting for a bucket" value={rows.length} sub={`${money(Math.round(total))} in all${withSuggestion.length ? ` · ${withSuggestion.length} with a suggestion` : ''}`}
          tone={rows.length ? 'amber' : 'green'} />
        <Stat label={`${FISCAL_MONTHS[cur]} so far`} value={money(thisMonth)}
          sub={ref ? `${ratioText(thisMonth, against)} its usual month, for the month so far` : 'Nothing to compare with yet'}
          tone={ref && thisMonth > against * 1.4 ? 'red' : undefined} />
        <Stat label="Usual month" value={ref ? money(ref.value) : '—'} sub={usualMonths ? `The average of the last ${usualMonths} month${usualMonths === 1 ? '' : 's'}` : 'No completed months yet'} />
        <Stat label={`${v?.fy_label ?? 'Year'} so far`} value={money(v?.fytd ?? 0)}
          sub={history?.has_last_year ? (lastYear > 0 ? `Same month last year ${money(lastYear)}` : 'Nothing the same month last year') : `No records last year: they start ${history?.data_from ? gregMonth(history.data_from) : 'this year'}`} />
      </div>

      {v && (
        <Panel title={`${v.fy_label}, month by month`} icon={BarChart3}>
          <FiscalBars row={v} history={history} tall picked={picked} onPick={m => setPicked(p => (p === m ? null : m))} />
          <p className="mt-1 text-xs text-slate-500">Tap a month to see what was spent.</p>
          {picked && <MonthLines bucket={null} name="Other company overhead" month={picked} />}
          <FiscalTable row={v} history={history} />
        </Panel>
      )}

      <Panel title="Put these in their buckets" icon={ArrowRight} count={rows.length} padded={false}>
        {rows.length === 0 ? <p className="p-4 text-sm text-slate-500">Nothing left: every overhead expense is in a bucket.</p> : (
          <>
            {canMove && bySuggestion.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2.5 text-xs dark:border-slate-700">
                <span className="text-slate-500">Pick the ones suggested for</span>
                {bySuggestion.map(([bucket, g]) => (
                  <button key={bucket} onClick={() => { setSelected(new Set(g.ids)); setBulkTo(bucket) }}
                    className={`${btn} text-slate-700 dark:text-slate-200`}>{g.name} <span className="rounded-full bg-slate-100 px-1.5 text-[10px] dark:bg-slate-700">{g.ids.length}</span></button>
                ))}
              </div>
            )}
            {canMove && (
              <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5 text-xs dark:border-slate-700">
                <label className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                  <input type="checkbox" checked={selected.size === rows.length && rows.length > 0}
                    onChange={e => setSelected(e.target.checked ? new Set(rows.map(r => r.id)) : new Set())} />
                  Pick all ({rows.length})
                </label>
                {selected.size > 0 ? (
                  <>
                    <span className="text-slate-400">· {selected.size} picked: move to</span>
                    <div className="w-52"><SearchableSelect value={bulkTo} onChange={setBulkTo} options={bucketOptions} placeholder="Pick a bucket…" /></div>
                    <button onClick={() => move([...selected], bulkTo, bucketOptions.find(o => o.id === bulkTo)?.label ?? 'the bucket')} disabled={busy || !bulkTo}
                      className={`${btn} border-brand bg-brand text-white`}>Move</button>
                    <button onClick={() => moveEachToItsBucket(rows.filter(r => selected.has(r.id)))} disabled={busy}
                      className={`${btn} text-slate-700 dark:text-slate-200`}>Each to its suggested bucket</button>
                  </>
                ) : withSuggestion.length > 0 && (
                  <button onClick={() => moveEachToItsBucket(withSuggestion)} disabled={busy} className={`${btn} text-slate-700 dark:text-slate-200`}>
                    Move the {withSuggestion.length} with a suggestion, each to its bucket
                  </button>
                )}
              </div>
            )}
            <ul className="divide-y text-sm dark:divide-slate-700">
              {rows.map(r => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
                  {canMove && (
                    <input type="checkbox" checked={selected.has(r.id)} aria-label={`Pick ${r.expense_code ?? 'this expense'}`}
                      onChange={e => setSelected(s => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n })} />
                  )}
                  <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                    <p className="truncate text-slate-800 dark:text-slate-100">
                      <Link to={`/expenses/${r.id}`} className="font-mono text-xs text-brand hover:underline">{r.expense_code ?? 'Expense'}</Link>
                      {' '}{r.description ?? '—'}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {formatDate(r.date)}{r.payee ? ` · ${r.payee}` : ''}{r.category_name ? ` · ${r.category_name}` : ' · no category'}
                      {r.approval_status === 'pending' || r.approval_status === 'manager_approved' ? ' · waiting for approval' : ''}
                    </p>
                  </div>
                  <span className="tabular-nums font-semibold text-slate-800 dark:text-slate-100">{money(r.amount)}</span>
                  {canMove ? (
                    <div className="flex w-full items-center gap-1.5 sm:w-auto">
                      <div className="min-w-0 flex-1 sm:w-48 sm:flex-none">
                        <SearchableSelect value={target(r)} onChange={b => setChosen(c => ({ ...c, [r.id]: b }))} options={bucketOptions}
                          placeholder="Which bucket?" />
                      </div>
                      <button onClick={() => move([r.id], target(r), bucketOptions.find(o => o.id === target(r))?.label ?? 'the bucket')}
                        disabled={busy || !target(r)} className={`${btn} shrink-0 text-slate-700 dark:text-slate-200`}>Move</button>
                    </div>
                  ) : r.suggested_bucket_name && <span className="text-xs text-slate-500">Usually {r.suggested_bucket_name}</span>}
                </li>
              ))}
            </ul>
            <p className="px-4 py-2 text-[11px] text-slate-400">
              The suggested bucket is the one set to take this kind of expense, else the one whose default category matches, else where spending in the same category usually goes. Check it before moving.
            </p>
          </>
        )}
      </Panel>
    </div>
  )
}
