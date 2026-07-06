import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import { Receipt, ShoppingCart, Truck, DollarSign, ArrowRight, Building2, Wallet, FolderKanban } from 'lucide-react'
import { Link } from 'react-router-dom'
import { KpiCard } from '@/components/shared/KpiCard'
import { DepartmentBoard } from '@/components/shared/DepartmentBoard'
import { useAuth } from '@/contexts/AuthContext'
import MyRequestsDashboardPage from './MyRequestsDashboardPage'
import type { UserRole } from '@/types/database'

const sections = [
  { label: 'Requests', to: '/requests', icon: Receipt, color: 'bg-blue-50 text-blue-500', desc: 'Expenses, orders, transportation' },
  { label: 'Procurement', to: '/procurement', icon: Building2, color: 'bg-purple-50 text-purple-500', desc: 'Vendors, categories, receipts', roles: ['admin', 'manager', 'finance', 'procurement_officer'] as UserRole[] },
  { label: 'Finance', to: '/finance', icon: DollarSign, color: 'bg-emerald-50 text-emerald-500', desc: 'Accounts, sales, bonds', roles: ['admin', 'manager', 'finance'] as UserRole[] },
  { label: 'HR', to: '/hr', icon: Wallet, color: 'bg-orange-50 text-orange-500', desc: 'Staff, payroll, advances', roles: ['admin', 'manager', 'finance', 'hr_officer'] as UserRole[] },
  { label: 'Management', to: '/management', icon: FolderKanban, color: 'bg-rose-50 text-rose-500', desc: 'Projects, products, locations', roles: ['admin', 'manager', 'finance', 'project_manager'] as UserRole[] },
]

export default function DashboardPage() {
  const { role } = useAuth()

  // Everyone below the ops roles lands on their personal home, which
  // includes their department board and links into their section.
  if (role === 'staff' || role === 'procurement_officer' || role === 'hr_officer' || role === 'project_manager' || role === 'stock_manager' || role === 'logistics_officer') {
    return <MyRequestsDashboardPage />
  }

  return <GeneralDashboard role={role} />
}

function GeneralDashboard({ role }: { role: UserRole | null }) {
  const visibleSections = sections.filter(s => !s.roles || (role && s.roles.includes(role)))

  const { data: expenseStats } = useQuery({
    queryKey: ['dashboard-expenses'],
    queryFn: async () => {
      // Summed in the DB — client-side sums cap out at 1,000 rows
      const { data } = await supabase
        .from('v_expense_pending_totals')
        .select('pending_count, pending_total_etb')
        .single()
      return { pending: data?.pending_count ?? 0, total: Number(data?.pending_total_etb ?? 0) }
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
          <KpiCard key={stat.label} {...stat} />
        ))}
      </div>

      {/* Company board: calendar, announcements, to-dos */}
      <DepartmentBoard />

      {/* Section Dashboards */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-600 uppercase tracking-wide">Sections</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {visibleSections.map(section => (
            <Link
              key={section.to}
              to={section.to}
              className="group flex flex-col justify-between rounded-xl border bg-white p-5 hover:shadow-md transition-shadow"
            >
              <div>
                <span className={`inline-flex rounded-lg p-2 ${section.color}`}>
                  <section.icon className="h-5 w-5" />
                </span>
                <p className="mt-3 font-semibold text-slate-800">{section.label}</p>
                <p className="mt-0.5 text-xs text-slate-400">{section.desc}</p>
              </div>
              <div className="mt-4 flex items-center gap-1 text-xs font-medium text-slate-500 group-hover:text-slate-800">
                View dashboard <ArrowRight className="h-3.5 w-3.5" />
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-600 uppercase tracking-wide">Quick Actions</h2>
        <div className="flex flex-wrap gap-2">
          <Link to="/expenses" className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
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
