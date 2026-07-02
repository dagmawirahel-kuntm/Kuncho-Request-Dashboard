import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

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
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)

  // Aggregation happens in the database (v_pl_monthly / v_expenses_by_category)
  // so totals stay exact regardless of how many records a year holds.
  const { data: monthlyRows = [], isLoading: loadingMonthly } = useQuery({
    queryKey: ['pl-monthly', year],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_pl_monthly')
        .select('month, revenue, expenses')
        .eq('year', year)
      if (error) throw error
      return data as { month: number; revenue: number; expenses: number }[]
    },
  })

  const { data: categoryRows = [], isLoading: loadingCategories } = useQuery({
    queryKey: ['pl-categories', year],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_expenses_by_category')
        .select('category_name, total_etb')
        .eq('year', year)
      if (error) throw error
      return data as { category_name: string; total_etb: number }[]
    },
  })

  const isLoading = loadingMonthly || loadingCategories

  const monthlyData = useMemo(() => {
    return MONTHS.map((name, idx) => {
      const row = monthlyRows.find(r => r.month === idx + 1)
      const revenue = Number(row?.revenue ?? 0)
      const expenses = Number(row?.expenses ?? 0)
      return { name, revenue, expenses, net: revenue - expenses }
    })
  }, [monthlyRows])

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

  const years = Array.from({ length: 5 }, (_, i) => currentYear - i)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">P&amp;L Report</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Profit &amp; Loss — paid sales vs paid expenses</p>
        </div>
        <select className="rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100" value={year} onChange={e => setYear(Number(e.target.value))}>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

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
                    <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Month</th>
                    <th className="text-right px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Revenue</th>
                    <th className="text-right px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Expenses</th>
                    <th className="text-right px-4 py-3 font-medium text-slate-600 dark:text-slate-300">Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-slate-700">
                  {monthlyData.map(row => (
                    <tr key={row.name} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                      <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300">{row.name} {year}</td>
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
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-200">Total {year}</td>
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
                  <h2 className="font-semibold text-slate-700 text-sm dark:text-slate-200">Expenses by Category — {year}</h2>
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
