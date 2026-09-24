import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import type { GovExpenseRow } from '@/types/database'
import { Landmark, Info } from 'lucide-react'

// #7: the government/tax expense view. In the app's own books an Asset-nature
// category sits on the balance sheet until consumed. Tax statements don't work
// that way — consumable inventories are an expense at the point of purchase.
// This report reclassifies them so, alongside ordinary operating expenses.
//
// Grouped by fiscal year (Hamle-Sene) and Ethiopian month (migration 313).
// It used to group by Gregorian month, which lines up with neither the
// monthly returns nor the annual profit-tax return this statement feeds --
// the fiscal-year total here is the "deductible expenses" figure shown on
// the Schedule C filing.
export default function GovernmentStatementPage() {
  const { data: allRows = [], isLoading } = useQuery({
    queryKey: ['government-expense-statement-ec'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_government_expense_statement_by_ec_period')
        .select('*')
        .order('ec_year', { ascending: false })
        .order('ec_month', { ascending: false })
      if (error) throw error
      return data as GovExpenseRow[]
    },
  })

  const years = useMemo(() => {
    const seen = new Map<string, string>()
    for (const r of allRows) seen.set(r.fiscal_period_id ?? 'none', r.fiscal_year ?? 'Outside any fiscal year')
    return Array.from(seen.entries())
  }, [allRows])
  const [yearKey, setYearKey] = useState<string | null>(null)
  const activeYear = yearKey ?? years[0]?.[0] ?? null
  const rows = allRows.filter(r => (r.fiscal_period_id ?? 'none') === activeYear)

  const byMonth = useMemo(() => {
    const m = new Map<string, GovExpenseRow[]>()
    for (const r of rows) {
      const list = m.get(r.period_label) ?? []
      list.push(r)
      m.set(r.period_label, list)
    }
    return Array.from(m.entries())
  }, [rows])

  const grandTotal = rows.reduce((s, r) => s + Number(r.amount), 0)
  const consumableTotal = rows.filter(r => r.gov_treatment === 'consumable_inventory').reduce((s, r) => s + Number(r.amount), 0)

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Landmark className="h-5 w-5 text-brand" /> Government Expense Statement
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Expenses as a tax authority sees them — consumable inventory counted as expense at the point of purchase, not when used
          </p>
        </div>
        {years.length > 0 && (
          <select
            value={activeYear ?? ''}
            onChange={e => setYearKey(e.target.value)}
            className="rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          >
            {years.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        )}
      </div>

      <div className="flex items-start gap-2 rounded-lg border dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>
          This differs from the Balance Sheet on purpose: there, an Asset-nature ledger flagged as Inventory (e.g. Steel) is capitalized;
          here it's expensed on purchase. {consumableTotal > 0 && <>Consumables reclassified this way: <span className="font-semibold">{formatCurrency(consumableTotal)}</span>.</>}
        </span>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="py-12 text-center text-sm text-slate-400">No paid expenses recorded yet.</div>
      ) : (
        <>
          <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm px-4 py-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Total expensed for government purposes · fiscal year</span>
            <span className="text-lg font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(grandTotal)}</span>
          </div>

          {byMonth.map(([month, list]) => {
            const monthTotal = list.reduce((s, r) => s + Number(r.amount), 0)
            return (
              <div key={month} className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm overflow-hidden">
                <div className="px-4 py-2.5 border-b dark:border-slate-700 flex items-center justify-between">
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{month}</p>
                  <p className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(monthTotal)}</p>
                </div>
                <div className="divide-y dark:divide-slate-700">
                  {list.map((r, i) => (
                    <div key={`${month}-${i}`} className="flex items-center justify-between gap-2 px-4 py-2">
                      <div className="min-w-0">
                        <p className="text-sm text-slate-700 dark:text-slate-200 truncate">{r.category_name}</p>
                        <p className="text-xs text-slate-400">
                          {r.gov_treatment === 'consumable_inventory'
                            ? `Consumable inventory · expensed at purchase (${r.line_count} line${r.line_count > 1 ? 's' : ''})`
                            : `Operating expense (${r.line_count} line${r.line_count > 1 ? 's' : ''})`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {r.gov_treatment === 'consumable_inventory' && (
                          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">consumable</span>
                        )}
                        <span className="text-sm font-medium tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(Number(r.amount))}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
