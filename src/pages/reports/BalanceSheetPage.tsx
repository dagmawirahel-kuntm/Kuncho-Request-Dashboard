import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'

interface SectionProps {
  title: string
  rows: { label: string; value: number }[]
  total: number
  positive?: boolean
}

function Section({ title, rows, total, positive }: SectionProps) {
  const totalColor = positive === undefined
    ? 'text-slate-800'
    : total >= 0 && positive ? 'text-green-700' : 'text-red-600'
  return (
    <div className="rounded-lg border bg-white overflow-hidden">
      <div className="px-4 py-3 border-b bg-slate-50">
        <h2 className="font-semibold text-slate-700 text-sm">{title}</h2>
      </div>
      <table className="w-full text-sm">
        <tbody className="divide-y">
          {rows.length === 0
            ? <tr><td colSpan={2} className="px-4 py-4 text-center text-slate-400 text-xs">No entries</td></tr>
            : rows.map(r => (
              <tr key={r.label} className="hover:bg-slate-50">
                <td className="px-4 py-2.5 text-slate-600">{r.label}</td>
                <td className="px-4 py-2.5 text-right text-slate-800">{formatCurrency(r.value)}</td>
              </tr>
            ))
          }
        </tbody>
        <tfoot className="border-t bg-slate-50">
          <tr>
            <td className="px-4 py-3 font-semibold text-slate-700">Total {title}</td>
            <td className={`px-4 py-3 text-right font-bold ${totalColor}`}>{formatCurrency(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

export default function BalanceSheetPage() {
  const { data: balances = [], isLoading: loadingBalances } = useQuery({
    queryKey: ['account-balances'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_account_balances')
        .select('id, account_name, type, balance')
        .order('account_name')
      if (error) throw error
      return data
    },
  })

  const { data: unpaidSales = [] } = useQuery({
    queryKey: ['bs-unpaid-sales'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales')
        .select('amount')
        .eq('sales_status', 'Invoiced')
      if (error) throw error
      return data
    },
  })

  const { data: unpaidExpenses = [] } = useQuery({
    queryKey: ['bs-unpaid-expenses'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('amount_etb, categories(category_name)')
        .eq('payment_status', false)
      if (error) throw error
      return data
    },
  })

  const { data: paidSalesTotal = 0 } = useQuery({
    queryKey: ['bs-paid-sales-total'],
    queryFn: async () => {
      const { data, error } = await supabase.from('sales').select('amount').eq('sales_status', 'Paid')
      if (error) throw error
      return (data as { amount: number | null }[]).reduce((s, r) => s + (r.amount ?? 0), 0)
    },
  })

  const { data: paidExpensesTotal = 0 } = useQuery({
    queryKey: ['bs-paid-expenses-total'],
    queryFn: async () => {
      const { data, error } = await supabase.from('expenses').select('amount_etb').eq('payment_status', true)
      if (error) throw error
      return (data as { amount_etb: number | null }[]).reduce((s, r) => s + (r.amount_etb ?? 0), 0)
    },
  })

  const assetRows = useMemo(() => {
    const rows = (balances as { account_name: string; type: string | null; balance: number }[]).map(a => ({
      label: a.type ? `${a.account_name} (${a.type})` : a.account_name,
      value: Number(a.balance ?? 0),
    }))
    const arTotal = (unpaidSales as { amount: number | null }[]).reduce((s, r) => s + (r.amount ?? 0), 0)
    if (arTotal > 0) {
      rows.push({ label: 'Accounts Receivable (Invoiced Sales)', value: arTotal })
    }
    return rows
  }, [balances, unpaidSales])

  const assetTotal = assetRows.reduce((s, r) => s + r.value, 0)

  const liabRows = useMemo(() => {
    const map: Record<string, number> = {}
    for (const e of unpaidExpenses as { amount_etb: number | null; categories?: { category_name: string } | null }[]) {
      const name = e.categories?.category_name ?? 'Uncategorized'
      map[name] = (map[name] ?? 0) + (e.amount_etb ?? 0)
    }
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ label: `Accounts Payable: ${label}`, value }))
  }, [unpaidExpenses])

  const liabTotal = liabRows.reduce((s, r) => s + r.value, 0)

  const retainedEarnings = (paidSalesTotal as number) - (paidExpensesTotal as number)
  const equityRows = [{ label: 'Retained Earnings (cumulative)', value: retainedEarnings }]
  const equityTotal = retainedEarnings

  const liabPlusEquity = liabTotal + equityTotal
  const isBalanced = Math.abs(assetTotal - liabPlusEquity) < 0.01

  if (loadingBalances) {
    return (
      <div className="space-y-4">
        <div><h1 className="text-xl font-bold text-slate-800">Balance Sheet</h1></div>
        <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Balance Sheet</h1>
        <p className="text-sm text-slate-500">Assets = Liabilities + Equity (all-time snapshot)</p>
      </div>

      <div className="rounded-lg border bg-white p-4 flex flex-wrap gap-6 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-slate-500">Total Assets</span>
          <span className="font-bold text-slate-800">{formatCurrency(assetTotal)}</span>
        </div>
        <div className="text-slate-300">/</div>
        <div className="flex items-center gap-2">
          <span className="text-slate-500">Liabilities + Equity</span>
          <span className="font-bold text-slate-800">{formatCurrency(liabPlusEquity)}</span>
        </div>
        <div className="text-slate-300">/</div>
        <div className={`font-semibold text-sm ${isBalanced ? 'text-green-600' : 'text-amber-600'}`}>
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
