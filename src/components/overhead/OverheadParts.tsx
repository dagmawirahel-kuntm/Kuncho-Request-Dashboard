import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { Panel, Pill } from '@/components/record/Record'
import { formatDate } from '@/lib/utils'
import {
  BAND_FILL, BAND_LABEL, FISCAL_MONTHS, ROUTABLE_TYPES, againstFor, useBucketRouting, btnSm as btn, gregMonth, money, monthShare, ratioText, referenceOf, short, useBucketWaiting, varianceBand,
  type CompareWith, type OverheadHistory, type VarianceMonth, type VarianceRow,
} from '@/lib/buckets'
import { UserCheck } from 'lucide-react'

// Pieces shared by the Overhead page and a cost bucket's own page (503).

const SHORT = (i: number) => FISCAL_MONTHS[i].slice(0, 3)
/** The fiscal month a fiscal month's start date falls in (Hamle 0 … Sene 11). */
const fiscalIdxOf = (start: string) => {
  const m = new Date(`${start}T00:00:00`).getMonth() // Hamle starts 8 Jul, Meskerem 11 Sep …
  return (m - 6 + 12) % 12
}
const monthTitle = (m: VarianceMonth) => `${FISCAL_MONTHS[m.idx]} (from ${gregMonth(m.start)})`

/** What a month is held against, in words: "its usual month (ETB 110,661)". */
function againstText(ref: ReturnType<typeof referenceOf>, usualMonths: number) {
  if (!ref) return null
  return ref.kind === 'budget' ? `its budget (${money(ref.value)})` : `its usual month (${money(ref.value)}, the average of ${usualMonths} month${usualMonths === 1 ? '' : 's'})`
}

/**
 * The twelve fiscal months as bars, with the budget, or the usual month where
 * there is no budget, as a dashed line. A month over budget, or 1.4× or more
 * its usual month, is red; months still to come are empty.
 */
export function FiscalBars({ row, history, picked, onPick, tall = false }: {
  row: VarianceRow; history?: OverheadHistory; picked: string | null; onPick: (start: string) => void; tall?: boolean
}) {
  const ref = referenceOf(row)
  const top = Math.max(ref?.value ?? 0, ...row.months.map(m => m.spent), 1)
  const usualMonths = history?.usual_months ?? 0
  const bars = (
    <div className={`relative flex items-end gap-1 ${tall ? 'h-40' : 'h-16'}`} role="group" aria-label={`${row.name}, ${row.fy_label} month by month`}>
      {ref && (
        <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-slate-500 dark:border-slate-400" style={{ bottom: `${(ref.value / top) * 100}%` }} />
      )}
      {row.months.map(m => {
        const future = m.idx > row.cur_idx
        const against = againstFor(m, row, history, ref?.value)
        const band = ref ? varianceBand(m.spent, against) : null
        const over = ref ? (ref.kind === 'budget' ? m.spent > against : (band ?? 0) >= 2) : false
        const vs = ref ? ratioText(m.spent, against) : null
        const label = `${monthTitle(m)}${m.idx === row.cur_idx ? ', so far' : ''}: ${future ? 'still to come' : money(m.spent)}${vs && !future && m.spent > 0 ? `, ${vs} ${ref!.kind === 'budget' ? 'the budget' : 'the usual month'}` : ''}`
        if (future) return <span key={m.idx} className="flex-1 self-end rounded-t-sm border border-dashed border-slate-200 dark:border-slate-700" style={{ height: '4%' }} aria-hidden title={label} />
        return (
          <button key={m.idx} type="button" onClick={() => onPick(m.start)} title={label} aria-label={label}
            className={`flex-1 rounded-t-sm transition-opacity hover:opacity-80 ${picked === m.start ? 'ring-2 ring-brand ring-offset-1 dark:ring-offset-slate-800' : ''} ${m.spent === 0 ? 'bg-slate-100 dark:bg-slate-700' : over ? 'bg-[#e34948] dark:bg-[#c53b3b]' : 'bg-[#3987e5] dark:bg-[#5598e7]'} ${m.idx === row.cur_idx ? 'opacity-70' : ''}`}
            style={{ height: `${m.spent === 0 ? 4 : Math.max((m.spent / top) * 100, 6)}%` }} />
        )
      })}
    </div>
  )
  if (!tall) return bars
  return (
    <div>
      {bars}
      <div className="mt-1 flex gap-1 text-center text-[10px] text-slate-400">
        {row.months.map(m => <span key={m.idx} className={`flex-1 truncate ${m.idx === row.cur_idx ? 'font-semibold text-slate-600 dark:text-slate-300' : ''}`}>{SHORT(m.idx)}</span>)}
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        {ref && <span className="inline-flex items-center gap-1.5"><span className="inline-block w-5 border-t border-dashed border-slate-500" />{ref.kind === 'budget' ? `Budget ${money(ref.value)} a month` : `Usual month ${money(ref.value)} (no budget set; average of ${usualMonths} month${usualMonths === 1 ? '' : 's'})`}</span>}
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#e34948] dark:bg-[#c53b3b]" />{ref?.kind === 'budget' ? 'Over budget' : '1.4× the usual month or more'}</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#3987e5] dark:bg-[#5598e7] opacity-70" />{FISCAL_MONTHS[row.cur_idx]}, so far</span>
      </p>
    </div>
  )
}

/**
 * The fiscal year as a grid: a row per bucket, a column per fiscal month,
 * each month tinted by how far it sits from what it is compared with: the
 * budget, else the bucket's usual month; or the same month last year. The
 * amount is printed in every cell, so the colour is never the only signal;
 * hovering or tapping a month gives the detail, and opens its expenses.
 */
export function VarianceGrid({ rows, history }: { rows: VarianceRow[]; history: OverheadHistory | undefined }) {
  const [mode, setMode] = useState<CompareWith>('reference')
  const [readout, setReadout] = useState<string | null>(null)
  const [picked, setPicked] = useState<{ id: string | null; name: string; start: string } | null>(null)
  const hasLastYear = !!history?.has_last_year
  const usualMonths = history?.usual_months ?? 0
  if (rows.length === 0) return null
  const cur = rows[0].cur_idx
  const months = rows[0].months
  const seg = (on: boolean) => `rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-40 ${on ? 'bg-white text-slate-800 shadow-sm dark:bg-slate-600 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}`

  const share = monthShare(history, cur)
  function detail(r: VarianceRow, m: VarianceMonth) {
    const ref = referenceOf(r)
    const running = m.idx === cur && share < 1
    const parts = [`${r.name} · ${monthTitle(m)}${m.idx === cur ? ', so far' : ''}: ${money(m.spent)}`]
    if (ref) parts.push(`${ratioText(m.spent, againstFor(m, r, history, ref.value))} ${againstText(ref, usualMonths)}${running ? `, pro-rated to the ${Math.round(share * 100)}% of the month gone` : ''}`)
    else parts.push('no budget, and no usual month yet')
    parts.push(hasLastYear ? `same month last year ${money(m.last_year)}${m.last_year > 0 ? ` (${ratioText(m.spent, againstFor(m, r, history, m.last_year))})` : ''}` : 'no records last year')
    return parts.join(' · ')
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500">Compare each month with</span>
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-700/60" role="radiogroup" aria-label="Compare each month with">
          <button role="radio" aria-checked={mode === 'reference'} onClick={() => setMode('reference')} className={seg(mode === 'reference')}>Budget, or its usual month</button>
          <button role="radio" aria-checked={mode === 'last_year'} onClick={() => setMode('last_year')} disabled={!hasLastYear} className={seg(mode === 'last_year')}
            title={hasLastYear ? undefined : 'No records from last fiscal year yet'}>Same month last year</button>
        </div>
        {!hasLastYear && history?.data_from && (
          <span className="text-xs text-slate-400">Records start {gregMonth(history.data_from)}, so last-year comparisons begin next fiscal year.</span>
        )}
      </div>
      <p className="min-h-[2rem] rounded-md bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600 dark:bg-slate-900/40 dark:text-slate-300" aria-live="polite">
        {readout ?? 'Hover or tap a month for the detail; tap it again to list its expenses.'}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-separate border-spacing-[2px] text-[11px]">
          <thead>
            <tr className="text-slate-500 dark:text-slate-400">
              <th scope="col" className="sticky left-0 z-10 bg-white px-1 text-left font-medium dark:bg-slate-800">Bucket</th>
              {months.map(m => (
                <th key={m.idx} scope="col" className={`px-0.5 text-center font-medium ${m.idx === cur ? 'text-slate-800 dark:text-slate-100' : ''}`}>
                  {SHORT(m.idx)}<span className="block text-[9px] font-normal text-slate-400">{m.idx === cur ? 'so far' : gregMonth(m.start)}</span>
                </th>
              ))}
              <th scope="col" className="px-1 text-right font-medium">Year so far</th>
              <th scope="col" className="px-1 text-right font-medium">vs last year</th>
              <th scope="col" className="px-1 text-right font-medium">Compared with</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const ref = referenceOf(r)
              return (
                <tr key={r.id ?? 'other'}>
                  <th scope="row" className="sticky left-0 z-10 max-w-[11rem] truncate bg-white px-1 text-left font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    <Link to={r.id ? `/overhead/${r.id}` : '/overhead/other'} className="hover:text-brand">{r.name}</Link>
                  </th>
                  {r.months.map(m => {
                    const future = m.idx > cur
                    if (future) return <td key={m.idx} className="h-8 rounded border border-dashed border-slate-200 dark:border-slate-700" aria-label={`${FISCAL_MONTHS[m.idx]}: still to come`} />
                    const against = againstFor(m, r, history, mode === 'reference' ? ref?.value : m.last_year)
                    const band = varianceBand(m.spent, against)
                    const isPicked = picked?.id === r.id && picked?.start === m.start
                    return (
                      <td key={m.idx} className="p-0">
                        <button type="button"
                          onMouseEnter={() => setReadout(detail(r, m))} onFocus={() => setReadout(detail(r, m))}
                          onClick={() => { setReadout(detail(r, m)); if (m.spent > 0) setPicked(isPicked ? null : { id: r.id, name: r.name, start: m.start }) }}
                          aria-label={detail(r, m)}
                          className={`h-8 w-full rounded px-0.5 text-center tabular-nums transition-[filter] hover:brightness-95 dark:hover:brightness-125 ${
                            m.spent === 0 ? 'text-slate-300 dark:text-slate-600' : band == null ? 'bg-white text-slate-700 ring-1 ring-inset ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600' : `${BAND_FILL[band]} text-slate-900 dark:text-white`
                          } ${isPicked ? 'ring-2 ring-brand' : ''} ${m.idx === cur ? 'outline outline-1 outline-offset-1 outline-slate-400' : ''}`}>
                          {m.spent === 0 ? '–' : short(m.spent)}
                        </button>
                      </td>
                    )
                  })}
                  <td className="px-1 text-right font-semibold tabular-nums text-slate-800 dark:text-slate-100">{short(r.fytd)}</td>
                  <td className="px-1 text-right tabular-nums text-slate-500">{hasLastYear && r.last_fytd > 0 ? ratioText(r.fytd, r.last_fytd) : '—'}</td>
                  <td className="whitespace-nowrap px-1 text-right text-slate-500">
                    {mode === 'last_year' ? 'Last year' : ref ? `${ref.kind === 'budget' ? 'Budget' : 'Usual'} ${short(ref.value)}` : 'Nothing yet'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500" aria-label="Colour scale">
        {[-3, -2, -1, 0, 1, 2, 3].map(b => (
          <span key={b} className="inline-flex items-center gap-1"><span className={`inline-block h-3 w-3 rounded-sm ${BAND_FILL[b]}`} />{BAND_LABEL[b]}</span>
        ))}
        <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm ring-1 ring-inset ring-slate-300 dark:ring-slate-600" />nothing to compare with</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm border border-dashed border-slate-300 dark:border-slate-600" />still to come</span>
      </div>
      {mode === 'reference' && (
        <p className="text-[11px] text-slate-400">
          With no budget set, a bucket's usual month is the average of the {usualMonths || 'completed'} month{usualMonths === 1 ? '' : 's'} before this one (up to twelve). It firms up as the year goes on.
        </p>
      )}
      {picked && <MonthLines bucket={picked.id} name={picked.name} month={picked.start} />}
    </div>
  )
}

/**
 * What stands out this year: months well above what they are compared with,
 * new spending with nothing to compare it with, and completed months where a
 * regular cost recorded little or nothing (it may not have been entered).
 */
export function Standouts({ rows, history }: { rows: VarianceRow[]; history: OverheadHistory | undefined }) {
  const usualMonths = history?.usual_months ?? 0
  const items: { key: string; tone: 'up' | 'new' | 'down'; text: string; to: string; size: number }[] = []
  for (const r of rows) {
    const ref = referenceOf(r)
    for (const m of r.months) {
      if (m.idx > r.cur_idx) continue
      const where = `${r.name} · ${FISCAL_MONTHS[m.idx]}${m.idx === r.cur_idx ? ' so far' : ''}`
      if (ref) {
        const against = againstFor(m, r, history, ref.value)
        const band = varianceBand(m.spent, against)
        if ((band ?? 0) >= 2 && m.spent - against >= 10000) {
          items.push({ key: `${r.id}-${m.idx}-up`, tone: 'up', size: m.spent - against, to: r.id ? `/overhead/${r.id}` : '/overhead/other',
            text: `${where}: ${money(m.spent)}, ${ratioText(m.spent, against)} ${ref.kind === 'budget' ? 'its budget' : 'its usual month'} (${money(ref.value)}${m.idx === r.cur_idx && against < ref.value ? `, ${money(Math.round(against))} by now` : ''})` })
        } else if (m.idx < r.cur_idx && r.in_use && ref.value >= 20000 && m.spent < ref.value * 0.4) {
          items.push({ key: `${r.id}-${m.idx}-down`, tone: 'down', size: (ref.value - m.spent) / 2, to: r.id ? `/overhead/${r.id}` : '/overhead/other',
            text: `${where}: ${m.spent ? money(m.spent) : 'nothing recorded'}, against a usual ${money(ref.value)}. A regular cost not entered?` })
        }
      } else if (m.idx === r.cur_idx && m.spent >= 50000) {
        items.push({ key: `${r.id}-${m.idx}-new`, tone: 'new', size: m.spent * 0.8, to: r.id ? `/overhead/${r.id}` : '/overhead/other',
          text: `${where}: ${money(m.spent)} of new spending, with no budget or earlier months to compare it with` })
      }
    }
  }
  const top = items.sort((a, b) => b.size - a.size).slice(0, 6)
  if (top.length === 0) return <p className="text-xs text-slate-500">Nothing stands out: every month sits near what it is compared with.</p>
  const icon = { up: '▲', down: '▼', new: '●' }
  const tone = { up: 'text-[#c53b3b] dark:text-[#e66767]', down: 'text-[#2a6fd0] dark:text-[#5598e7]', new: 'text-slate-500' }
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-slate-700 dark:text-slate-200">What stands out{usualMonths ? '' : ' (no usual months yet)'}</p>
      <ul className="space-y-1 text-xs">
        {top.map(i => (
          <li key={i.key} className="flex items-start gap-1.5 text-slate-700 dark:text-slate-200">
            <span className={`mt-px ${tone[i.tone]}`} aria-hidden>{icon[i.tone]}</span>
            <Link to={i.to} className="hover:text-brand">{i.text}</Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function MonthLines({ bucket, name, month }: { bucket: string | null; name: string; month: string }) {
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
      <p className="mb-1 font-semibold text-slate-700 dark:text-slate-200">{name} · {FISCAL_MONTHS[fiscalIdxOf(month)]} (from {gregMonth(month)})</p>
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
export function OwnerQueue({ bucket }: { bucket?: string } = {}) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { data: all = [] } = useBucketWaiting()
  const rows = bucket ? all.filter(w => w.bucket_id === bucket) : all
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
    qc.invalidateQueries({ queryKey: ['bucket-recent'] })
  }
  if (rows.length === 0) return null
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

/** The fiscal year in numbers: each month against its reference and last year. */
export function FiscalTable({ row, history }: { row: VarianceRow; history: OverheadHistory | undefined }) {
  const ref = referenceOf(row)
  const hasLastYear = !!history?.has_last_year
  return (
    <details className="mt-3 text-xs">
      <summary className="cursor-pointer select-none font-medium text-slate-600 dark:text-slate-300">The year in numbers</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[440px] text-right tabular-nums">
          <thead className="text-[11px] text-slate-500">
            <tr>
              <th scope="col" className="py-1 text-left font-medium">Month</th>
              <th scope="col" className="py-1 font-medium">Spent</th>
              <th scope="col" className="py-1 font-medium">vs {ref?.kind === 'budget' ? 'budget' : 'usual'}</th>
              <th scope="col" className="py-1 font-medium">Last year</th>
              <th scope="col" className="py-1 font-medium">vs last year</th>
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-slate-700">
            {row.months.filter(m => m.idx <= row.cur_idx).map(m => {
              const against = againstFor(m, row, history, ref?.value)
              const band = ref ? varianceBand(m.spent, against) : null
              return (
                <tr key={m.idx} className="text-slate-700 dark:text-slate-200">
                  <th scope="row" className="py-1 text-left font-normal">{FISCAL_MONTHS[m.idx]}{m.idx === row.cur_idx ? ' (so far)' : ''} <span className="text-slate-400">· from {gregMonth(m.start)}</span></th>
                  <td className="py-1 font-semibold">{money(m.spent)}</td>
                  <td className="py-1">
                    {ref && m.spent > 0
                      ? <span className={`rounded px-1.5 py-0.5 ${band != null ? `${BAND_FILL[band]} text-slate-900 dark:text-white` : ''}`}>{ratioText(m.spent, against)}</span>
                      : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="py-1">{hasLastYear ? money(m.last_year) : <span className="text-slate-400">—</span>}</td>
                  <td className="py-1">{hasLastYear && m.last_year > 0 ? ratioText(m.spent, againstFor(m, row, history, m.last_year)) : <span className="text-slate-400">—</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </details>
  )
}

/**
 * The kinds of overhead that land in a bucket by themselves when recorded
 * with no project (503k). A kind another bucket already takes is shown, but
 * can't be picked twice.
 */
export function ExpenseTypeChips({ bucketId, value, onChange, disabled }: {
  bucketId: string | null; value: string[]; onChange: (v: string[]) => void; disabled?: boolean
}) {
  const { data: taken } = useBucketRouting()
  return (
    <div className="flex flex-wrap gap-1.5">
      {ROUTABLE_TYPES.map(({ type, label }) => {
        const on = value.includes(type)
        const elsewhere = taken?.get(type)
        const blocked = !on && !!elsewhere && elsewhere.id !== bucketId
        return (
          <button key={type} type="button" disabled={disabled || blocked} aria-pressed={on}
            onClick={() => onChange(on ? value.filter(t => t !== type) : [...value, type])}
            title={blocked ? `${elsewhere!.name} takes these` : undefined}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${on
              ? 'border-brand bg-brand/10 text-brand dark:border-brand dark:text-slate-100'
              : 'text-slate-600 hover:border-slate-400 dark:border-slate-600 dark:text-slate-300'}`}>
            {on ? '✓ ' : ''}{label}{blocked ? ` · ${elsewhere!.name}` : ''}
          </button>
        )
      })}
    </div>
  )
}
