import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { ETHIOPIAN_MONTHS, toEthiopian } from '@/lib/ethiopianCalendar'
import { Archive } from 'lucide-react'

const GC_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

type CalendarMode = 'GC' | 'ET'

function StatCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-lg border bg-white p-4 dark:bg-slate-800 dark:border-slate-700">
      <p className="text-xs text-slate-500 uppercase tracking-wide dark:text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-800 dark:text-slate-100">{formatCurrency(value)}</p>
      {sub && <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{sub}</p>}
    </div>
  )
}

export default function PLReportPage() {
  const currentGCYear = new Date().getFullYear()
  const currentETYear = toEthiopian(new Date()).year

  const [mode, setMode] = useState<CalendarMode>('GC')
  const [gcYear, setGcYear] = useState(currentGCYear)
  const [etYear, setEtYear] = useState(currentETYear)
  const year = mode === 'GC' ? gcYear : etYear

  // Aggregation happens in the database — both the Gregorian views
  // (v_pl_monthly / v_expenses_by_category) and the Ethiopian ones
  // (v_pl_monthly_et / v_expenses_by_category_et, migration 053) so
  // totals stay exact regardless of how many records a year holds, and
  // every Ethiopian month is bucketed from real transaction dates
  // (Ethiopian tax law reports by Ethiopian month) rather than just
  // re-labeled Gregorian buckets.
  const { data: monthlyRows = [], isLoading: loadingMonthly } = useQuery({
    queryKey: ['pl-monthly', mode, year],
    queryFn: async () => {
      if (mode === 'GC') {
        const { data, error } = await supabase
          .from('v_pl_monthly')
          .select('month, revenue, expenses')
          .eq('year', year)
        if (error) throw error
        return data as { month: number; revenue: number; expenses: number }[]
      }
      const { data, error } = await supabase
        .from('v_pl_monthly_et')
        .select('et_month, revenue, expenses')
        .eq('et_year', year)
      if (error) throw error
      return (data as { et_month: number; revenue: number; expenses: number }[])
        .map(r => ({ month: r.et_month, revenue: r.revenue, expenses: r.expenses }))
    },
  })

  const { data: categoryRows = [], isLoading: loadingCategories } = useQuery({
    queryKey: ['pl-categories', mode, year],
    queryFn: async () => {
      const table = mode === 'GC' ? 'v_expenses_by_category' : 'v_expenses_by_category_et'
      const yearCol = mode === 'GC' ? 'year' : 'et_year'
      const { data, error } = await supabase
        .from(table)
        .select(`category_name, total_etb`)
        .eq(yearCol, year)
      if (error) throw error
      return data as { category_name: string; total_etb: number }[]
    },
  })

  const { data: cutoverDate } = useQuery({
    queryKey: ['financials-cutover-date'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('financials_cutover_date')
      if (error) throw error
      return data as string
    },
    staleTime: Infinity,
  })

  const isLoading = loadingMonthly || loadingCategories

  const monthNames = mode === 'GC' ? GC_MONTHS : ETHIOPIAN_MONTHS

  const monthlyData = useMemo(() => {
    return monthNames.map((name, idx) => {
      const row = monthlyRows.find(r => r.month === idx + 1)
      const revenue = Number(row?.revenue ?? 0)
      const expenses = Number(row?.expenses ?? 0)
      return { name, revenue, expenses, net: revenue - expenses }
    })
  }, [monthlyRows, monthNames])

  const totals = useMemo(() => ({
    revenue: monthlyData.reduce((s, m) => s + m.revenue, 0),
    expenses: monthlyData.reduce((s, m) => s + m.expenses, 0),
    net: monthlyData.reduce((s, m) => s + m.net, 0),
  }), [monthlyData])

  const byCategory = useMemo(() => {
    return categoryRows
      .map(r => [r.category_name, Number(r.total_etb)] as [string, number])
      .sort((a, b) => b[1] - a[1])
  }, [categoryRows])

  const gcYears = Array.from({ length: 5 }, (_, i) => currentGCYear - i)
  const etYears = Array.from({ length: 5 }, (_, i) => currentETYear - i)
  const yearLabel = mode === 'GC' ? String(year) : `${year} EC`

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">P&amp;L Report</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Profit &amp; Loss — paid sales vs paid expenses</p>
        </div>

        <div className="flex items-center gap-2">
          {/* Calendar mode toggle — Ethiopian for tax filing, Gregorian for budgeting */}
          <div className="flex rounded-md border dark:border-slate-700 overflow-hidden text-sm">
            <button
              onClick={() => setMode('GC')}
              className={`px-3 py-2 font-medium transition-colors ${mode === 'GC' ? 'bg-brand text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
            >
              Gregorian
            </button>
            <button
              onClick={() => setMode('ET')}
              className={`px-3 py-2 font-medium transition-colors ${mode === 'ET' ? 'bg-brand text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
            >
              Ethiopian
            </button>
          </div>

          <select
            className="rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100"
            value={year}
            onChange={e => mode === 'GC' ? setGcYear(Number(e.target.value)) : setEtYear(Number(e.target.value))}
          >
            {(mode === 'GC' ? gcYears : etYears).map(y => (
              <option key={y} value={y}>{mode === 'GC' ? y : `${y} EC`}</option>
            ))}
          </select>
        </div>
      </div>

      {cutoverDate && (
        <div className="flex items-center gap-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border dark:border-slate-700 px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">
          <Archive className="h-3.5 w-3.5 shrink-0" />
          <span>
            Figures below only reflect activity from {formatDate(cutoverDate)} forward (also excludes capitalized purchases, which show on the Balance Sheet instead). For everything recorded before that, see the{' '}
            <Link to="/reports/archive" className="text-brand hover:underline font-medium">Historical Archive</Link>.
          </span>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total Revenue" value={totals.revenue} sub="Paid sales" />
        <StatCard label="Total Expenses" value={totals.expenses} sub="Paid expenses" />
        <StatCard label={totals.net >= 0 ? 'Net Profit' : 'Net Loss'} value={Math.abs(totals.net)} sub={totals.net >= 0 ? 'Profit for the period' : 'Loss for the period'} />
      </div>

      {isLoading
        ? <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
        : (
          <>
            <div className="rounded-lg border bg-white overflow-hidden dark:bg-slate-800 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b dark:bg-slate-900/60 dark:border-slate-700">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-300">
                      {mode === 'GC' ? 'Month' : 'Ethiopian Month'}
                    </th>
                    <th className="text-right px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Revenue</th>
                    <th className="text-right px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Expenses</th>
                    <th className="text-right px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-slate-700">
                  {monthlyData.map(row => (
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
                    <td className="px-4 py-3 text-right text-green-700 dark:text-green-400">{formatCurrency(totals.revenue)}</td>
                    <td className="px-4 py-3 text-right text-red-600 dark:text-red-400">{formatCurrency(totals.expenses)}</td>
                    <td className={`px-4 py-3 text-right ${totals.net >= 0 ? 'text-slate-800 dark:text-slate-100' : 'text-red-600 dark:text-red-400'}`}>
                      {totals.net < 0 && '−'}{formatCurrency(Math.abs(totals.net))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {byCategory.length > 0 && (
              <div className="rounded-lg border bg-white overflow-hidden dark:bg-slate-800 dark:border-slate-700">
                <div className="px-4 py-3 border-b bg-slate-50 dark:bg-slate-900/60 dark:border-slate-700">
                  <h2 className="font-semibold text-slate-700 text-sm dark:text-slate-200">Expenses by Category — {yearLabel}</h2>
                </div>
                <table className="w-full text-sm">
                  <thead className="border-b dark:border-slate-700">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Category</th>
                      <th className="text-right px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Amount</th>
                      <th className="text-right px-4 py-3 font-medium text-slate-600 dark:text-slate-300">% of Expenses</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-slate-700">
                    {byCategory.map(([name, amount]) => (
                      <tr key={name} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                        <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300">{name}</td>
                        <td className="px-4 py-2.5 text-right text-red-600 dark:text-red-400">{formatCurrency(amount)}</td>
                        <td className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400">
                          {totals.expenses > 0 ? ((amount / totals.expenses) * 100).toFixed(1) : '0.0'}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )
      }
    </div>
  )
}
