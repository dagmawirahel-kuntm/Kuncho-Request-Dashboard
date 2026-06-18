import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Receipt, Truck, Clock, ArrowRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import { KpiCard } from '@/components/shared/KpiCard'
import { OwnRecordsBanner } from '@/components/shared/OwnRecordsBanner'

export default function MyRequestsDashboardPage() {
  const { data: expenseStats } = useQuery({
    queryKey: ['my-requests-expenses'],
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

  const { data: transportStats } = useQuery({
    queryKey: ['my-requests-transport'],
    queryFn: async () => {
      const { count } = await supabase
        .from('transportation_requests')
        .select('*', { count: 'exact', head: true })
        .eq('payment_status', false)
      return { pending: count ?? 0 }
    },
  })

  const { data: timesheetStats } = useQuery({
    queryKey: ['my-requests-timesheet'],
    queryFn: async () => {
      const { count } = await supabase
        .from('timesheet')
        .select('*', { count: 'exact', head: true })
      return { count: count ?? 0 }
    },
  })

  const stats = [
    {
      label: 'Pending Expenses',
      value: expenseStats?.pending ?? '—',
      sub: expenseStats?.total ? `${formatCurrency(expenseStats.total)} unpaid` : undefined,
      icon: Receipt,
      color: 'bg-orange-50 text-orange-500',
      to: '/expenses',
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
      label: 'Timesheet Entries',
      value: timesheetStats?.count ?? '—',
      sub: 'logged',
      icon: Clock,
      color: 'bg-blue-50 text-blue-500',
      to: '/timesheet',
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">My Requests</h1>
        <p className="mt-1 text-sm text-slate-500">Your expenses, transportation requests &amp; timesheet</p>
      </div>

      <OwnRecordsBanner />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats.map(stat => (
          <KpiCard key={stat.label} {...stat} />
        ))}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-600 uppercase tracking-wide">Quick Actions</h2>
        <div className="flex flex-wrap gap-2">
          <Link to="/expenses/new" className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
            + New Expense
          </Link>
          <Link to="/transportation/new" className="rounded-md border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            + Transportation Request
          </Link>
          <Link to="/timesheet/new" className="rounded-md border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            + Timesheet Entry
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Link to="/expenses" className="group flex flex-col justify-between rounded-xl border bg-white p-5 hover:shadow-md transition-shadow">
          <div>
            <span className="inline-flex rounded-lg p-2 bg-orange-50 text-orange-500">
              <Receipt className="h-5 w-5" />
            </span>
            <p className="mt-3 font-semibold text-slate-800">My Expenses</p>
            <p className="mt-0.5 text-xs text-slate-400">View and submit expense requests</p>
          </div>
          <div className="mt-4 flex items-center gap-1 text-xs font-medium text-slate-500 group-hover:text-slate-800">
            View <ArrowRight className="h-3.5 w-3.5" />
          </div>
        </Link>
        <Link to="/transportation" className="group flex flex-col justify-between rounded-xl border bg-white p-5 hover:shadow-md transition-shadow">
          <div>
            <span className="inline-flex rounded-lg p-2 bg-purple-50 text-purple-500">
              <Truck className="h-5 w-5" />
            </span>
            <p className="mt-3 font-semibold text-slate-800">My Transportation</p>
            <p className="mt-0.5 text-xs text-slate-400">View and submit transportation requests</p>
          </div>
          <div className="mt-4 flex items-center gap-1 text-xs font-medium text-slate-500 group-hover:text-slate-800">
            View <ArrowRight className="h-3.5 w-3.5" />
          </div>
        </Link>
        <Link to="/timesheet" className="group flex flex-col justify-between rounded-xl border bg-white p-5 hover:shadow-md transition-shadow">
          <div>
            <span className="inline-flex rounded-lg p-2 bg-blue-50 text-blue-500">
              <Clock className="h-5 w-5" />
            </span>
            <p className="mt-3 font-semibold text-slate-800">My Timesheet</p>
            <p className="mt-0.5 text-xs text-slate-400">Log and review attendance</p>
          </div>
          <div className="mt-4 flex items-center gap-1 text-xs font-medium text-slate-500 group-hover:text-slate-800">
            View <ArrowRight className="h-3.5 w-3.5" />
          </div>
        </Link>
      </div>
    </div>
  )
}
