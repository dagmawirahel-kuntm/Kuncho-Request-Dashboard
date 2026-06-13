import { Outlet, useLocation, NavLink } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { useAuth } from '@/contexts/AuthContext'
import { LogOut, ChevronRight } from 'lucide-react'

const breadcrumbLabels: Record<string, string> = {
  dashboard: 'Dashboard',
  expenses: 'Expenses',
  orders: 'Orders',
  transportation: 'Transportation',
  'purchase-allocation': 'Purchase Allocation',
  vendors: 'Vendors',
  categories: 'Categories',
  'vendor-receipts': 'Vendor Receipts',
  accounts: 'Accounts',
  sales: 'Sales',
  'tax-summary': 'Tax Summary',
  'batch-payments': 'Batch Payments',
  'cpo-bonds': 'CPO Bonds',
  staff: 'Staff',
  payroll: 'Payroll',
  'payroll-taxes': 'Payroll Taxes',
  'emergency-payroll': 'Emergency Payroll',
  'cash-advances': 'Cash Advances',
  timesheet: 'Timesheet',
  projects: 'Projects',
  products: 'Products',
  locations: 'Locations',
}

const roleBadgeColors: Record<string, string> = {
  admin: 'bg-red-100 text-red-700',
  manager: 'bg-blue-100 text-blue-700',
  finance: 'bg-green-100 text-green-700',
  staff: 'bg-slate-100 text-slate-600',
}

export function AppShell() {
  const { profile, role, signOut } = useAuth()
  const location = useLocation()
  const segments = location.pathname.split('/').filter(Boolean)

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b bg-white px-6">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-1 text-sm text-slate-500">
            <NavLink to="/dashboard" className="hover:text-slate-700">Home</NavLink>
            {segments.map((seg, i) => (
              <span key={seg} className="flex items-center gap-1">
                <ChevronRight className="h-3.5 w-3.5" />
                <span className={i === segments.length - 1 ? 'font-medium text-slate-800' : ''}>
                  {breadcrumbLabels[seg] ?? seg}
                </span>
              </span>
            ))}
          </nav>

          {/* User info */}
          <div className="flex items-center gap-3">
            {role && (
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${roleBadgeColors[role] ?? 'bg-slate-100 text-slate-600'}`}>
                {role}
              </span>
            )}
            <span className="text-sm font-medium text-slate-700">{profile?.full_name ?? 'User'}</span>
            <button
              onClick={signOut}
              className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
