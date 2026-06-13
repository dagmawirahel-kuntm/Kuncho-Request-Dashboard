import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import { Receipt, ShoppingCart, Truck, DollarSign } from 'lucide-react'
import { Link } from 'react-router-dom'

interface StatCard {
  label: string
  value: string | number
  sub?: string
  icon: React.ElementType
  color: string
  to: string
}

function StatCard({ label, value, sub, icon: Icon, color, to }: StatCard) {
  return (
    <Link to={to} className="block rounded-xl border bg-white p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-bold text-slate-800">{value}</p>
          {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
        </div>
        <span className={`rounded-lg p-2 ${color}`}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
    </Link>
  )
}

export default function DashboardPage() {
  const { data: expenseStats } = useQuery({
    queryKey: ['dashboard-expenses'],
    queryFn: async () => {
      const { data, count } = await supabase
        .from('expenses')
        .select('amount_etb, payment_status', { count: 'exact' })
        .eq('payment_status', false)
      const rows = data as { amount_etb: number | null }[] | null
      const total = rows?.reduce((sum, r) => sum + (r.amount_etb ?? 0), 0) ?? 0
      return { pending: count ?? 0, total }
    },
  })

  const { data: orderStats } = useQuery({
    queryKey: ['dashboard-orders'],
    queryFn: async () => {
      const { count } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending')
      return { pending: count ?? 0 }
    },
  })

  const { data: transportStats } = useQuery({
    queryKey: ['dashboard-transport'],
    queryFn: async () => {
      const { count } = await supabase
        .from('transportation_requests')
        .select('*', { count: 'exact', head: true })
        .eq('payment_status', false)
      return { pending: count ?? 0 }
    },
  })

  const { data: accountStats } = useQuery({
    queryKey: ['dashboard-accounts'],
    queryFn: async () => {
      const { data } = await supabase.from('accounts').select('account_name, status')
      return { count: data?.length ?? 0 }
    },
  })

  const stats: StatCard[] = [
    {
      label: 'Pending Expenses',
      value: expenseStats?.pending ?? '—',
      sub: expenseStats?.total ? `${formatCurrency(expenseStats.total)} unpaid` : undefined,
      icon: Receipt,
      color: 'bg-orange-50 text-orange-500',
      to: '/expenses',
    },
    {
      label: 'Open Orders',
      value: orderStats?.pending ?? '—',
      sub: 'awaiting approval',
      icon: ShoppingCart,
      color: 'bg-blue-50 text-blue-500',
      to: '/orders',
    },
    {
      label: 'Transport Requests',
      value: transportStats?.pending ?? '—',
      sub: 'pending payment',
      icon: Truck,
      color: 'bg-purple-50 text-purple-500',
      to: '/transportation',
    },
    {
      label: 'Accounts',
      value: accountStats?.count ?? '—',
      sub: 'financial accounts',
      icon: DollarSign,
      color: 'bg-green-50 text-green-500',
      to: '/accounts',
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">Overview of operations</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(stat => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-600 uppercase tracking-wide">Quick Actions</h2>
        <div className="flex flex-wrap gap-2">
          <Link to="/expenses" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
            + New Expense
          </Link>
          <Link to="/orders" className="rounded-md border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            + New Order
          </Link>
          <Link to="/transportation" className="rounded-md border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            + Transportation Request
          </Link>
        </div>
      </div>
    </div>
  )
}
