import { useQuery } from '@tanstack/react-query'
import { Navigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import { Receipt, ShoppingCart, Truck, DollarSign, ArrowRight, Building2, Wallet, FolderKanban } from 'lucide-react'
import { Link } from 'react-router-dom'
import { KpiCard } from '@/components/shared/KpiCard'
import { useAuth } from '@/contexts/AuthContext'
import MyRequestsDashboardPage from './MyRequestsDashboardPage'
import type { UserRole } from '@/types/database'

function StaffProfileRedirect() {
  const { user } = useAuth()

  const { data: staffId, isLoading } = useQuery({
    queryKey: ['my-staff-profile-id', user?.id],
    queryFn: async () => {
      const email = user!.email?.toLowerCase() ?? ''
      // Match the logged-in user to their staff record by explicit link (user_id)
      // or, more commonly, by the email they registered/logged in with.
      const orFilter = email
        ? `user_id.eq.${user!.id},email.ilike.${email}`
        : `user_id.eq.${user!.id}`
      const { data } = await supabase
        .from('staff')
        .select('id, user_id, email')
        .or(orFilter)
        .limit(5)
      if (!data || data.length === 0) return null
      // Prefer an explicit user_id link; fall back to an email match.
      const linked = data.find(r => r.user_id === user!.id)
      const byEmail = data.find(r => (r.email ?? '').toLowerCase() === email)
      return (linked ?? byEmail ?? data[0]).id ?? null
    },
    enabled: !!user,
  })

  if (isLoading) {
    return <div className="py-24 text-center text-sm text-slate-400">Loading your profile…</div>
  }
  if (staffId) return <Navigate to={`/staff/${staffId}`} replace />
  return <MyRequestsDashboardPage />
}

const sections = [
  { label: 'Requests', to: '/requests', icon: Receipt, color: 'bg-blue-50 text-blue-500', desc: 'Expenses, orders, transportation' },
  { label: 'Procurement', to: '/procurement', icon: Building2, color: 'bg-purple-50 text-purple-500', desc: 'Vendors, categories, receipts', roles: ['admin', 'manager', 'finance', 'procurement_officer'] as UserRole[] },
  { label: 'Finance', to: '/finance', icon: DollarSign, color: 'bg-emerald-50 text-emerald-500', desc: 'Accounts, sales, bonds', roles: ['admin', 'manager', 'finance'] as UserRole[] },
  { label: 'HR', to: '/hr', icon: Wallet, color: 'bg-orange-50 text-orange-500', desc: 'Staff, payroll, advances', roles: ['admin', 'manager', 'finance', 'hr_officer'] as UserRole[] },
  { label: 'Management', to: '/management', icon: FolderKanban, color: 'bg-rose-50 text-rose-500', desc: 'Projects, products, locations', roles: ['admin', 'manager', 'finance', 'project_manager'] as UserRole[] },
]

export default function DashboardPage() {
  const { role } = useAuth()

  if (role === 'staff') return <StaffProfileRedirect />
  if (role === 'procurement_officer') return <Navigate to="/procurement" replace />
  if (role === 'hr_officer') return <Navigate to="/hr" replace />
  if (role === 'project_manager') return <Navigate to="/management" replace />

  return <GeneralDashboard role={role} />
}

function GeneralDashboard({ role }: { role: UserRole | null }) {
  const visibleSections = sections.filter(s => !s.roles || (role && s.roles.includes(role)))

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
