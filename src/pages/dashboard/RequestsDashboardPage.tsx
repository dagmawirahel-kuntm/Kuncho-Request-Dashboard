import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Receipt, ShoppingCart, Truck, Layers } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, buildMonthlyTrend } from '@/lib/utils'
import { KpiCard } from '@/components/shared/KpiCard'
import { BreakdownBarList } from '@/components/shared/BreakdownBarList'
import { DonutChart } from '@/components/shared/DonutChart'
import { TrendLineChart } from '@/components/shared/TrendLineChart'
import { RecentActivityFeed, type ActivityItem } from '@/components/shared/RecentActivityFeed'

interface ExpenseRow { id: string; amount_etb: number | null; payment_status: boolean; date: string | null; item_service_description: string | null; created_at: string; categories: { category_name: string } | null }
interface OrderRow { id: string; status: string | null; order_name: string | null; created_at: string }
interface TransportRow { id: string; amount: number | null; payment_status: boolean; requested_date: string | null; request_name: string | null; created_at: string }

export default function RequestsDashboardPage() {
  const { data } = useQuery({
    queryKey: ['dashboard-requests'],
    queryFn: async () => {
      const [expenses, orders, transport, allocation] = await Promise.all([
        supabase.from('expenses').select('id, amount_etb, payment_status, date, item_service_description, created_at, categories(category_name)'),
        supabase.from('orders').select('id, status, order_name, created_at'),
        supabase.from('transportation_requests').select('id, amount, payment_status, requested_date, request_name, created_at'),
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

  const recentActivity: ActivityItem[] = [
    ...expenses.map(e => ({ id: `exp-${e.id}`, label: e.item_service_description ?? 'Expense', sub: e.amount_etb ? formatCurrency(e.amount_etb) : undefined, date: e.created_at, to: '/expenses', icon: Receipt })),
    ...orders.map(o => ({ id: `ord-${o.id}`, label: o.order_name ?? 'Order', sub: o.status ?? undefined, date: o.created_at, to: '/orders', icon: ShoppingCart })),
    ...transport.map(t => ({ id: `trn-${t.id}`, label: t.request_name ?? 'Transport Request', sub: t.amount ? formatCurrency(t.amount) : undefined, date: t.created_at, to: '/transportation', icon: Truck })),
  ]

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
        <DonutChart
          title="Orders by Status"
          items={Object.entries(orderStatusCounts).map(([label, value]) => ({ label, value }))}
        />
        <BreakdownBarList
          title="Expenses by Category"
          items={[...categoryTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, value]) => ({ label, value }))}
          formatValue={formatCurrency}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TrendLineChart title="Expense Spend — Last 6 Months" data={trend} formatValue={formatCurrency} />
        <RecentActivityFeed title="Recent Requests" items={recentActivity} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Link to="/expenses" className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">+ New Expense</Link>
        <Link to="/orders" className="rounded-md border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">+ New Order</Link>
        <Link to="/transportation" className="rounded-md border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">+ Transportation Request</Link>
      </div>
    </div>
  )
}
