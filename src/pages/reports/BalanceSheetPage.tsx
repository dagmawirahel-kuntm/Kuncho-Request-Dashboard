import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import { formatEthiopian, toEthiopian, toGregorian, isEthiopianLeapYear } from '@/lib/ethiopianCalendar'
import { LedgerTree, type LedgerRow } from '@/components/reports/LedgerTree'
import { CalendarDays } from 'lucide-react'

// Local date, not UTC: toISOString() can move the day back in East Africa.
function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function Section({ title, rows, total, openDepth = 2 }: { title: string; rows: LedgerRow[]; total: number; openDepth?: number }) {
  return (
    <div className="rounded-lg border bg-white overflow-hidden dark:bg-slate-800 dark:border-slate-700">
      <div className="px-4 py-3 border-b bg-slate-50 dark:bg-slate-900/60 dark:border-slate-700">
        <h2 className="font-semibold text-slate-700 text-sm dark:text-slate-200">{title}</h2>
      </div>
      <LedgerTree rows={rows} openDepth={openDepth} emptyText="No entries" />
      <div className="border-t px-4 py-3 flex justify-between text-sm font-semibold bg-slate-50 dark:bg-slate-900/60 dark:border-slate-700">
        <span className="text-slate-700 dark:text-slate-200">Total {title.toLowerCase()}</span>
        <span className="tabular-nums font-bold text-slate-800 dark:text-slate-100">{formatCurrency(total)}</span>
      </div>
    </div>
  )
}

// The Balance Sheet from the ledger (524): every asset, liability and
// equity account under its headings, as of a date, with the profit not yet
// closed into equity. Opening balances not yet posted to the ledger are
// included, so it balances before and after finance posts them.
export default function BalanceSheetPage() {
  const today = useMemo(() => new Date(), [])
  const [asOfDate, setAsOfDate] = useState(() => toISODate(today))

  const gregorianYearEnd = `${today.getFullYear()}-12-31`
  const ethiopianYearNow = toEthiopian(today).year
  const ethiopianYearEnd = useMemo(() => {
    const lastDay = isEthiopianLeapYear(ethiopianYearNow) ? 6 : 5
    return toISODate(toGregorian(ethiopianYearNow, 13, lastDay))
  }, [ethiopianYearNow])
  // The financial year runs 8 Jul – 7 Jul.
  const financialYearEnd = useMemo(() => {
    const y = today.getMonth() > 6 || (today.getMonth() === 6 && today.getDate() >= 8) ? today.getFullYear() + 1 : today.getFullYear()
    return `${y}-07-07`
  }, [today])

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['balance-sheet-ledger', asOfDate],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('balance_sheet_ledger', { p_as_of: asOfDate })
      if (error) throw error
      return ((data ?? []) as (LedgerRow & { nature: string; balance: number })[]).map(r => ({ ...r, amount: Number(r.balance) }))
    },
  })

  const assets = rows.filter(r => r.nature === 'Asset')
  const liabilities = rows.filter(r => r.nature === 'Liability')
  const equity = rows.filter(r => r.nature === 'Equity')
  const sum = (rs: LedgerRow[]) => rs.reduce((s, r) => s + Number(r.amount), 0)
  const assetTotal = sum(assets)
  const liabTotal = sum(liabilities)
  const equityTotal = sum(equity)
  const liabPlusEquity = liabTotal + equityTotal
  const isBalanced = Math.abs(assetTotal - liabPlusEquity) < 1
  const isToday = asOfDate === toISODate(today)

  const preset = (label: string, date: string) => (
    <button onClick={() => setAsOfDate(date)}
      className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${asOfDate === date ? 'bg-brand text-white border-brand' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
      {label}
    </button>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Balance Sheet</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">From the ledger: Assets = Liabilities + Equity</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {preset('Financial year-end', financialYearEnd)}
          {preset('Gregorian year-end', gregorianYearEnd)}
          {preset(`Ethiopian year-end (${ethiopianYearNow} EC)`, ethiopianYearEnd)}
          {!isToday && (
            <button onClick={() => setAsOfDate(toISODate(today))}
              className="rounded-md border px-3 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700">
              Today
            </button>
          )}
          <div className="flex items-center gap-1.5 rounded-md border dark:border-slate-700 px-2.5 py-1.5 bg-white dark:bg-slate-800">
            <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
            <input type="date" value={asOfDate} onChange={e => e.target.value && setAsOfDate(e.target.value)}
              className="text-xs outline-none bg-transparent dark:text-slate-100" />
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-400 dark:text-slate-500 -mt-3">
        As of {new Date(asOfDate + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}
        {' · '}{formatEthiopian(asOfDate)} (Ethiopian)
        {asOfDate > toISODate(today) && ' · later postings are not in yet'}
      </p>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
      ) : (
        <>
          <div className="rounded-lg border bg-white p-4 flex flex-wrap gap-6 text-sm dark:bg-slate-800 dark:border-slate-700">
            <div className="flex items-center gap-2">
              <span className="text-slate-500 dark:text-slate-400">Total assets</span>
              <span className="font-bold text-slate-800 dark:text-slate-100">{formatCurrency(assetTotal)}</span>
            </div>
            <div className="text-slate-300 dark:text-slate-600">/</div>
            <div className="flex items-center gap-2">
              <span className="text-slate-500 dark:text-slate-400">Liabilities + equity</span>
              <span className="font-bold text-slate-800 dark:text-slate-100">{formatCurrency(liabPlusEquity)}</span>
            </div>
            <div className="text-slate-300 dark:text-slate-600">/</div>
            <div className={`font-semibold text-sm ${isBalanced ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
              {isBalanced ? 'Balanced' : `Difference: ${formatCurrency(Math.abs(assetTotal - liabPlusEquity))}`}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Section title="Assets" rows={assets} total={assetTotal} />
            <div className="space-y-4">
              <Section title="Liabilities" rows={liabilities} total={liabTotal} />
              <Section title="Equity" rows={equity} total={equityTotal} />
            </div>
          </div>
          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            “Profit or loss not yet closed” is revenue less expenses posted so far; it moves into retained earnings when the year is closed.
            Opening balances entered on the Ledger &amp; Journal page are included even before they are posted as a journal entry.
          </p>
        </>
      )}
    </div>
  )
}
