import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Receipt, ShoppingCart, Truck, Layers } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, buildMonthlyTrend } from '@/lib/utils'
import { KpiCard } from '@/components/shared/KpiCard'
import { BreakdownBarList } from '@/components/shared/BreakdownBarList'
import { TrendLineChart } from '@/components/shared/TrendLineChart'

interface ExpenseRow { amount_etb: number | null; payment_status: boolean; date: string | null; categories: { category_name: string } | null }
interface OrderRow { status: string | null }
interface TransportRow { amount: number | null; payment_status: boolean; requested_date: string | null }

export default function RequestsDashboardPage() {
  const { data } = useQuery({
    queryKey: ['dashboard-requests'],
    queryFn: async () => {
      const [expenses, orders, transport, allocation] = await Promise.all([
        supabase.from('expenses').select('amount_etb, payment_status, date, categories(category_name)'),
        supabase.from('orders').select('status'),
        supabase.from('transportation_requests').select('amount, payment_status, requested_date'),
        supabase.from('purchase_allocation').select('id'),
      ])
      return {
        expenses: (expenses.data ?? []) as unknown as ExpenseRow[],
        orders: (orders.data ?? []) as OrderRow[],
        transport: (transport.data ?? []) as TransportRow[],
        allocationCount: allocation.data?.length ?? 0,
      }
    },
  })

  const expenses = data?.expenses ?? []
  const orders = data?.orders ?? []
  const transport = data?.transport ?? []

  const pendingExpenses = expenses.filter(e => !e.payment_status)
  const pendingExpenseTotal = pendingExpenses.reduce((sum, e) => sum + (e.amount_etb ?? 0), 0)
  const pendingOrders = orders.filter(o => o.status === 'pending').length
  const pendingTransport = transport.filter(t => !t.payment_status).length

  const orderStatusCounts: Record<string, number> = {}
  for (const o of orders) {
    const key = o.status ?? 'unspecified'
    orderStatusCounts[key] = (orderStatusCounts[key] ?? 0) + 1
  }

  const categoryTotals = new Map<string, number>()
  for (const e of expenses) {
    const name = e.categories?.category_name ?? 'Uncategorized'
    categoryTotals.set(name, (categoryTotals.get(name) ?? 0) + (e.amount_etb ?? 0))
  }

  const trend = buildMonthlyTrend(expenses.map(e => ({ date: e.date, value: e.amount_etb ?? 0 })))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Requests</h1>
        <p className="mt-1 text-sm text-slate-500">Expenses, orders, transportation &amp; purchase allocation</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Pending Expenses" value={pendingExpenses.length} sub={pendingExpenseTotal ? `${formatCurrency(pendingExpenseTotal)} unpaid` : undefined} icon={Receipt} color="bg-orange-50 text-orange-500" to="/expenses" />
        <KpiCard label="Open Orders" value={pendingOrders} sub="awaiting approval" icon={ShoppingCart} color="bg-blue-50 text-blue-500" to="/orders" />
        <KpiCard label="Transport Requests" value={pendingTransport} sub="pending payment" icon={Truck} color="bg-purple-50 text-purple-500" to="/transportation" />
        <KpiCard label="Purchase Allocations" value={data?.allocationCount ?? '—'} sub="line items to allocate" icon={Layers} color="bg-emerald-50 text-emerald-500" to="/purchase-allocation" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BreakdownBarList
          title="Orders by Status"
          items={Object.entries(orderStatusCounts).map(([label, value]) => ({ label, value }))}
        />
        <BreakdownBarList
          title="Expenses by Category"
          items={[...categoryTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, value]) => ({ label, value }))}
          formatValue={formatCurrency}
        />
      </div>

      <TrendLineChart title="Expense Spend — Last 6 Months" data={trend} formatValue={formatCurrency} />

      <div className="flex flex-wrap gap-2">
        <Link to="/expenses" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">+ New Expense</Link>
        <Link to="/orders" className="rounded-md border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">+ New Order</Link>
        <Link to="/transportation" className="rounded-md border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">+ Transportation Request</Link>
      </div>
    </div>
  )
}
