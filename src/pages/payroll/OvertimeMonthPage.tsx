// Overtime for the whole company, a month at a time: every Overtime run that
// pays for the month together, with the group statement to print.
import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Clock, Printer } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency } from '@/lib/utils'
import { otHoursOf, useOvertimeMonths } from '@/lib/overtimeMonth'
import { printOvertimeMonth } from '@/lib/overtimeMonthPrint'

const KIND = [
  { k: 'working_day', label: 'Working days', cls: 'bg-emerald-600' },
  { k: 'rest_day', label: 'Rest days', cls: 'bg-violet-600' },
  { k: 'holiday', label: 'Holidays', cls: 'bg-amber-600' },
] as const
const hrs = (n: number) => Number(n.toFixed(1)).toLocaleString('en-US')

export default function OvertimeMonthPage() {
  const { toast } = useToast()
  const [params, setParams] = useSearchParams()
  const { data: months = [], isLoading, error } = useOvertimeMonths(8)
  const key = params.get('month') ?? months[0]?.key ?? null
  const i = months.findIndex(m => m.key === key)
  const M = i >= 0 ? months[i] : null
  const before = useMemo(() => (i >= 0 ? months.slice(i + 1) : []), [months, i])

  const t = useMemo(() => {
    if (!M) return null
    const all = M.people.flatMap(p => p.hours)
    const hours = all.reduce((s, x) => s + Number(x.hours), 0)
    return {
      hours,
      take: M.people.reduce((s, p) => s + p.take_home, 0),
      cost: M.people.reduce((s, p) => s + p.cost, 0),
      paye: M.people.reduce((s, p) => s + p.paye, 0),
      kinds: KIND.map(k => ({ ...k, hours: all.filter(x => x.day_kind === k.k).reduce((s, x) => s + Number(x.hours), 0) })),
    }
  }, [M])
  const prevHours = (id: string) => { const p = before[0]?.people.find(x => x.staff_id === id); return p ? otHoursOf(p) : null }
  const maxH = Math.max(...(M?.people.map(otHoursOf) ?? [0]), 1)

  function print() {
    if (!M) return
    if (!printOvertimeMonth(M, before)) toast('Allow pop-ups to print the statement', 'error')
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/payroll" className="rounded-full p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700" aria-label="Back to payroll"><ArrowLeft className="h-5 w-5" /></Link>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800 dark:text-slate-100"><Clock className="h-5 w-5 text-brand" /> Overtime by month</h1>
          <p className="text-sm text-slate-500">The whole company: every overtime run that pays for the month, together.</p>
        </div>
        {months.length > 0 && (
          <select value={key ?? ''} onChange={e => setParams({ month: e.target.value }, { replace: true })} aria-label="Month"
            className="rounded-md border px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800">
            {months.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        )}
        <button type="button" onClick={print} disabled={!M}
          className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
          <Printer className="h-4 w-4" /> Print the month statement
        </button>
      </div>

      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
        : error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{(error as Error).message}</p>
        : !M || !t ? <p className="rounded-xl border p-6 text-center text-sm text-slate-500 dark:border-slate-700">No overtime runs in the last eight months.</p>
        : (
          <>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {M.people.length} people worked <b>{hrs(t.hours)} hours</b> of overtime in {M.label}, costing the company <b>{formatCurrency(t.cost)}</b>
              {before[0] ? <> — {t.hours >= totalsHours(before[0]) ? 'up' : 'down'} {hrs(Math.abs(t.hours - totalsHours(before[0])))} h on {before[0].label}</> : ''}.
              <span className="ml-1 text-slate-400">Runs: {M.runs.map(r => r.record).filter(Boolean).join(', ')}</span>
            </p>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-slate-200 sm:grid-cols-5 dark:border-slate-700 dark:bg-slate-700">
              {[
                ['People', String(M.people.length)], ['Overtime worked', `${hrs(t.hours)} h`], ['Take-home', formatCurrency(t.take)],
                ['Income tax', formatCurrency(t.paye)], ['Cost to company', formatCurrency(t.cost)],
              ].map(([l, v]) => (
                <div key={l} className="bg-white p-3 dark:bg-slate-800"><p className="text-lg font-semibold tabular-nums text-slate-800 dark:text-slate-100">{v}</p><p className="text-xs text-slate-500">{l}</p></div>
              ))}
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-slate-600 dark:text-slate-300">
              {t.kinds.map(k => <span key={k.k} className="flex items-center gap-1.5"><i className={`h-2.5 w-2.5 rounded-sm ${k.cls}`} />{k.label} <b className="tabular-nums">{hrs(k.hours)} h</b></span>)}
            </div>
            <div className="overflow-x-auto rounded-xl border dark:border-slate-700">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-900/40">
                  <tr><th className="px-3 py-2 text-left font-medium">Employee</th><th className="w-1/3 px-3 py-2" /><th className="px-3 py-2 text-right font-medium">Hours</th><th className="px-3 py-2 text-right font-medium">{before[0] ? `vs ${before[0].label}` : 'Change'}</th><th className="px-3 py-2 text-right font-medium">Take-home</th><th className="px-3 py-2 text-right font-medium">Cost</th></tr>
                </thead>
                <tbody className="divide-y dark:divide-slate-700">
                  {M.people.map(p => {
                    const h = otHoursOf(p), ph = prevHours(p.staff_id)
                    return (
                      <tr key={p.staff_id}>
                        <td className="px-3 py-2"><p className="font-medium text-slate-800 dark:text-slate-100">{p.name}</p><p className="text-xs text-slate-500">{p.role ?? ''}{p.typed && !p.hours.length ? <span className="ml-1 rounded bg-slate-100 px-1.5 text-slate-600">amount only</span> : ''}</p></td>
                        <td className="px-3 py-2">
                          <div className="flex h-2.5 overflow-hidden rounded bg-slate-100 dark:bg-slate-700" style={{ width: `${h / maxH * 100}%` }}>
                            {KIND.map(k => { const v = p.hours.filter(x => x.day_kind === k.k).reduce((s, x) => s + Number(x.hours), 0); return <div key={k.k} className={k.cls} style={{ width: `${h ? v / h * 100 : 0}%` }} /> })}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{hrs(h)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${ph == null ? 'text-slate-400' : h > ph ? 'text-amber-700' : h < ph ? 'text-emerald-700' : 'text-slate-400'}`}>{ph == null ? 'new' : `${h - ph >= 0 ? '+' : '−'}${hrs(Math.abs(h - ph))}`}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(p.take_home)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(p.cost)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
    </div>
  )
}

function totalsHours(M: { people: { hours: { hours: number }[] }[] }) {
  return M.people.reduce((s, p) => s + p.hours.reduce((t, x) => t + Number(x.hours), 0), 0)
}
