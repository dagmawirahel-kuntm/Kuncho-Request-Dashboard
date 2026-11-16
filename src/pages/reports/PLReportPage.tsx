import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import { ETHIOPIAN_MONTHS, toEthiopian, toGregorian } from '@/lib/ethiopianCalendar'
import { LedgerTree, type LedgerRow } from '@/components/reports/LedgerTree'
import { totalUnder } from '@/lib/ledgerTree'
import { Archive } from 'lucide-react'

const GC_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

type CalendarMode = 'GC' | 'ET'

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function StatCard({ label, value, sub, negative }: { label: string; value: number; sub?: string; negative?: boolean }) {
  return (
    <div className="rounded-lg border bg-white p-4 dark:bg-slate-800 dark:border-slate-700">
      <p className="text-xs text-slate-500 uppercase tracking-wide dark:text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-bold ${negative ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-slate-100'}`}>
        {value < 0 && '−'}{formatCurrency(Math.abs(value))}
      </p>
      {sub && <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{sub}</p>}
    </div>
  )
}

// The P&L from the ledger (524): every revenue and expense account under
// its headings, for a Gregorian or an Ethiopian year. Cost counts when the
// ledger books it, so goods paid for and not yet received are not cost yet,
// and equipment bought is a fixed asset, not an expense.
export default function PLReportPage() {
  const currentGCYear = new Date().getFullYear()
  const currentETYear = toEthiopian(new Date()).year

  const [mode, setMode] = useState<CalendarMode>('GC')
  const [gcYear, setGcYear] = useState(currentGCYear)
  const [etYear, setEtYear] = useState(currentETYear)
  const year = mode === 'GC' ? gcYear : etYear

  const { from, to } = useMemo(() => {
    if (mode === 'GC') return { from: `${year}-01-01`, to: `${year}-12-31` }
    const start = toGregorian(year, 1, 1)
    const next = toGregorian(year + 1, 1, 1)
    next.setDate(next.getDate() - 1)
    return { from: iso(start), to: iso(next) }
  }, [mode, year])

  const { data: monthlyRows = [], isLoading: loadingMonthly } = useQuery({
    queryKey: ['pl-ledger-monthly', mode, from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pl_ledger_monthly', { p_from: from, p_to: to, p_calendar: mode === 'GC' ? 'GC' : 'EC' })
      if (error) throw error
      return (data ?? []) as { month: number; revenue: number; expenses: number }[]
    },
  })

  const { data: accounts = [], isLoading: loadingAccounts } = useQuery({
    queryKey: ['pl-ledger', from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pl_ledger', { p_from: from, p_to: to })
      if (error) throw error
      return (data ?? []) as (LedgerRow & { nature: string })[]
    },
  })

  const isLoading = loadingMonthly || loadingAccounts
  const monthNames = mode === 'GC' ? GC_MONTHS : ETHIOPIAN_MONTHS

  const monthlyData = useMemo(() => monthNames.map((name, idx) => {
    const row = monthlyRows.find(r => r.month === idx + 1)
    const revenue = Number(row?.revenue ?? 0)
    const expenses = Number(row?.expenses ?? 0)
    return { name, revenue, expenses, net: revenue - expenses }
  }), [monthlyRows, monthNames])

  const revenueRows = useMemo(() => accounts.filter(a => a.nature === 'Revenue'), [accounts])
  const expenseRows = useMemo(() => accounts.filter(a => a.nature === 'Expense'), [accounts])
  const revenue = revenueRows.reduce((s, r) => s + Number(r.amount), 0)
  const expenses = expenseRows.reduce((s, r) => s + Number(r.amount), 0)
  const projectCost = totalUnder(expenseRows, '5000')
  const gross = revenue - projectCost
  const net = revenue - expenses

  const gcYears = Array.from({ length: 5 }, (_, i) => currentGCYear - i)
  const etYears = Array.from({ length: 5 }, (_, i) => currentETYear - i)
  const yearLabel = mode === 'GC' ? String(year) : `${year} EC`
  const shownMonths = monthlyData.filter(m => m.revenue !== 0 || m.expenses !== 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">P&amp;L Report</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Profit &amp; Loss from the ledger, by account group</p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-md border dark:border-slate-700 overflow-hidden text-sm">
            <button onClick={() => setMode('GC')}
              className={`px-3 py-2 font-medium transition-colors ${mode === 'GC' ? 'bg-brand text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
              Gregorian
            </button>
            <button onClick={() => setMode('ET')}
              className={`px-3 py-2 font-medium transition-colors ${mode === 'ET' ? 'bg-brand text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
              Ethiopian
            </button>
          </div>
          <select
            className="rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100"
            value={year}
            onChange={e => mode === 'GC' ? setGcYear(Number(e.target.value)) : setEtYear(Number(e.target.value))}>
            {(mode === 'GC' ? gcYears : etYears).map(y => <option key={y} value={y}>{mode === 'GC' ? y : `${y} EC`}</option>)}
          </select>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border dark:border-slate-700 px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">
        <Archive className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>
          Read from the ledger, which starts with this financial year (8 Jul 2026). Goods count as cost when they are received on a GRN, not when the bill is paid;
          equipment bought is a fixed asset. For figures before the ledger, see the{' '}
          <Link to="/reports/archive" className="text-brand hover:underline font-medium">Historical Archive</Link>.
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Revenue" value={revenue} sub={yearLabel} />
        <StatCard label="Cost of projects" value={projectCost} sub={revenue ? `${((projectCost / revenue) * 100).toFixed(1)}% of revenue` : undefined} />
        <StatCard label="Gross profit" value={gross} negative={gross < 0} sub={revenue ? `${((gross / revenue) * 100).toFixed(1)}% margin` : undefined} />
        <StatCard label={net >= 0 ? 'Net profit' : 'Net loss'} value={net} negative={net < 0} sub={`after ${formatCurrency(expenses - projectCost)} operating costs`} />
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <div className="rounded-lg border bg-white overflow-hidden dark:bg-slate-800 dark:border-slate-700">
              <div className="px-4 py-3 border-b bg-slate-50 dark:bg-slate-900/60 dark:border-slate-700">
                <h2 className="font-semibold text-slate-700 text-sm dark:text-slate-200">Revenue — {yearLabel}</h2>
              </div>
              <LedgerTree rows={revenueRows} openDepth={1} emptyText="No revenue posted" />
              <div className="border-t px-4 py-3 text-sm font-semibold flex justify-between dark:border-slate-700">
                <span>Total revenue</span><span className="tabular-nums">{formatCurrency(revenue)}</span>
              </div>
            </div>

            <div className="rounded-lg border bg-white overflow-hidden dark:bg-slate-800 dark:border-slate-700">
              <div className="px-4 py-3 border-b bg-slate-50 dark:bg-slate-900/60 dark:border-slate-700 flex items-baseline justify-between gap-2">
                <h2 className="font-semibold text-slate-700 text-sm dark:text-slate-200">Expenses — {yearLabel}</h2>
                <span className="text-[11px] text-slate-400">click a heading to open it · % of all expenses</span>
              </div>
              <LedgerTree rows={expenseRows} openDepth={2} shareOf={expenses} emptyText="No expenses posted" />
              <div className="border-t px-4 py-3 text-sm font-semibold flex justify-between dark:border-slate-700">
                <span>Total expenses</span><span className="tabular-nums">{formatCurrency(expenses)}</span>
              </div>
            </div>
          </div>

          <div className="rounded-lg border bg-white overflow-hidden dark:bg-slate-800 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b dark:bg-slate-900/60 dark:border-slate-700">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-300">{mode === 'GC' ? 'Month' : 'Ethiopian Month'}</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Revenue</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Expenses</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-700">
                {shownMonths.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-xs text-slate-400">Nothing posted in {yearLabel}</td></tr>
                )}
                {shownMonths.map(row => (
                  <tr key={row.name} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                    <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300">{row.name} {yearLabel}</td>
                    <td className="px-4 py-2.5 text-right text-green-700 dark:text-green-400">{formatCurrency(row.revenue)}</td>
                    <td className="px-4 py-2.5 text-right text-red-600 dark:text-red-400">{formatCurrency(row.expenses)}</td>
                    <td className={`px-4 py-2.5 text-right font-medium ${row.net >= 0 ? 'text-slate-800 dark:text-slate-100' : 'text-red-600 dark:text-red-400'}`}>
                      {row.net < 0 && '−'}{formatCurrency(Math.abs(row.net))}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 border-t dark:bg-slate-900/60 dark:border-slate-700">
                <tr className="font-semibold">
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-200">Total {yearLabel}</td>
                  <td className="px-4 py-3 text-right text-green-700 dark:text-green-400">{formatCurrency(revenue)}</td>
                  <td className="px-4 py-3 text-right text-red-600 dark:text-red-400">{formatCurrency(expenses)}</td>
                  <td className={`px-4 py-3 text-right ${net >= 0 ? 'text-slate-800 dark:text-slate-100' : 'text-red-600 dark:text-red-400'}`}>
                    {net < 0 && '−'}{formatCurrency(Math.abs(net))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
