import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import { formatEthiopian, toEthiopian, toGregorian, isEthiopianLeapYear } from '@/lib/ethiopianCalendar'
import { CalendarDays } from 'lucide-react'

interface SectionProps {
  title: string
  rows: { label: string; value: number }[]
  total: number
  positive?: boolean
}

function Section({ title, rows, total, positive }: SectionProps) {
  const totalColor = positive === undefined
    ? 'text-slate-800 dark:text-slate-100'
    : total >= 0 && positive ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'
  return (
    <div className="rounded-lg border bg-white overflow-hidden dark:bg-slate-800 dark:border-slate-700">
      <div className="px-4 py-3 border-b bg-slate-50 dark:bg-slate-900/60 dark:border-slate-700">
        <h2 className="font-semibold text-slate-700 text-sm dark:text-slate-200">{title}</h2>
      </div>
      <table className="w-full text-sm">
        <tbody className="divide-y dark:divide-slate-700">
          {rows.length === 0
            ? <tr><td colSpan={2} className="px-4 py-4 text-center text-slate-400 dark:text-slate-500 text-xs">No entries</td></tr>
            : rows.map(r => (
              <tr key={r.label} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{r.label}</td>
                <td className="px-4 py-2.5 text-right text-slate-800 dark:text-slate-200">{formatCurrency(r.value)}</td>
              </tr>
            ))
          }
        </tbody>
        <tfoot className="border-t bg-slate-50 dark:bg-slate-900/60 dark:border-slate-700">
          <tr>
            <td className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">Total {title}</td>
            <td className={`px-4 py-3 text-right font-bold ${totalColor}`}>{formatCurrency(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export default function BalanceSheetPage() {
  const today = useMemo(() => new Date(), [])
  const [asOfDate, setAsOfDate] = useState(() => toISODate(today))

  // Quick presets: Ethiopian fiscal year-end (for tax filing) and
  // Gregorian year-end (for budgeting), both computed from "today".
  const gregorianYearEnd = `${today.getFullYear()}-12-31`
  const ethiopianYearNow = toEthiopian(today).year
  const ethiopianYearEnd = useMemo(() => {
    const lastDay = isEthiopianLeapYear(ethiopianYearNow) ? 6 : 5
    return toISODate(toGregorian(ethiopianYearNow, 13, lastDay))
  }, [ethiopianYearNow])

  const { data: balances = [], isLoading: loadingBalances } = useQuery({
    queryKey: ['bs-account-balances-asof', asOfDate],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('account_balances_asof', { p_cutoff: asOfDate })
      if (error) throw error
      return data as { id: string; account_name: string; type: string | null; balance: number }[]
    },
  })

  const { data: arTotal = 0 } = useQuery({
    queryKey: ['bs-ar-asof', asOfDate],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('ar_total_asof', { p_cutoff: asOfDate })
      if (error) throw error
      return Number(data ?? 0)
    },
  })

  const { data: apRows = [] } = useQuery({
    queryKey: ['bs-ap-asof', asOfDate],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('ap_by_category_asof', { p_cutoff: asOfDate })
      if (error) throw error
      return data as { category_name: string; total_etb: number }[]
    },
  })

  const { data: retainedEarnings = 0, isLoading: loadingRE } = useQuery({
    queryKey: ['bs-retained-earnings-asof', asOfDate],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('retained_earnings_asof', { p_cutoff: asOfDate })
      if (error) throw error
      return Number(data ?? 0)
    },
  })

  const isLoading = loadingBalances || loadingRE

  const assetRows = useMemo(() => {
    const rows = balances.map(a => ({
      label: a.type ? `${a.account_name} (${a.type})` : a.account_name,
      value: Number(a.balance ?? 0),
    }))
    if (arTotal > 0) rows.push({ label: 'Accounts Receivable (Invoiced Sales)', value: Number(arTotal) })
    return rows
  }, [balances, arTotal])

  const assetTotal = assetRows.reduce((s, r) => s + r.value, 0)

  const liabRows = useMemo(() => {
    return apRows
      .filter(r => Number(r.total_etb) > 0)
      .sort((a, b) => Number(b.total_etb) - Number(a.total_etb))
      .map(r => ({ label: `Accounts Payable: ${r.category_name}`, value: Number(r.total_etb) }))
  }, [apRows])

  const liabTotal = liabRows.reduce((s, r) => s + r.value, 0)

  const equityRows = [{ label: 'Retained Earnings (cumulative)', value: Number(retainedEarnings) }]
  const equityTotal = Number(retainedEarnings)

  const liabPlusEquity = liabTotal + equityTotal
  const isBalanced = Math.abs(assetTotal - liabPlusEquity) < 0.01

  const isToday = asOfDate === toISODate(today)

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div><h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Balance Sheet</h1></div>
        <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Balance Sheet</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Assets = Liabilities + Equity</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setAsOfDate(gregorianYearEnd)}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${asOfDate === gregorianYearEnd ? 'bg-brand text-white border-brand' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
          >
            Gregorian Year-End
          </button>
          <button
            onClick={() => setAsOfDate(ethiopianYearEnd)}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${asOfDate === ethiopianYearEnd ? 'bg-brand text-white border-brand' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
          >
            Ethiopian Year-End ({ethiopianYearNow} EC)
          </button>
          {!isToday && (
            <button
              onClick={() => setAsOfDate(toISODate(today))}
              className="rounded-md border px-3 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              Today
            </button>
          )}
          <div className="flex items-center gap-1.5 rounded-md border dark:border-slate-700 px-2.5 py-1.5 bg-white dark:bg-slate-800">
            <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
            <input
              type="date"
              value={asOfDate}
              max={toISODate(today)}
              onChange={e => setAsOfDate(e.target.value)}
              className="text-xs outline-none bg-transparent dark:text-slate-100"
            />
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-400 dark:text-slate-500 -mt-3">
        As of {new Date(asOfDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}
        {' · '}{formatEthiopian(asOfDate)} (Ethiopian)
      </p>

      <div className="rounded-lg border bg-white p-4 flex flex-wrap gap-6 text-sm dark:bg-slate-800 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <span className="text-slate-500 dark:text-slate-400">Total Assets</span>
          <span className="font-bold text-slate-800 dark:text-slate-100">{formatCurrency(assetTotal)}</span>
        </div>
        <div className="text-slate-300 dark:text-slate-600">/</div>
        <div className="flex items-center gap-2">
          <span className="text-slate-500 dark:text-slate-400">Liabilities + Equity</span>
          <span className="font-bold text-slate-800 dark:text-slate-100">{formatCurrency(liabPlusEquity)}</span>
        </div>
        <div className="text-slate-300 dark:text-slate-600">/</div>
        <div className={`font-semibold text-sm ${isBalanced ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
          {isBalanced ? 'Balanced' : `Difference: ${formatCurrency(Math.abs(assetTotal - liabPlusEquity))}`}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section title="Assets" rows={assetRows} total={assetTotal} positive />
        <div className="space-y-4">
          <Section title="Liabilities" rows={liabRows} total={liabTotal} positive={false} />
          <Section title="Equity" rows={equityRows} total={equityTotal} positive={equityTotal >= 0} />
        </div>
      </div>
    </div>
  )
}
