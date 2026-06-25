import { Outlet, useLocation, NavLink } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Sidebar } from './Sidebar'
import { GlobalSearch } from './GlobalSearch'
import { NotificationsBell } from './NotificationsBell'
import { useAuth } from '@/contexts/AuthContext'
import { LogOut, ChevronRight, Menu, Sun, Moon } from 'lucide-react'

const breadcrumbLabels: Record<string, string> = {
  dashboard: 'Dashboard',
  overview: 'Company Overview',
  requests: 'Requests',
  procurement: 'Procurement',
  finance: 'Finance',
  hr: 'HR',
  management: 'Management',
  expenses: 'Expenses',
  orders: 'Orders',
  transportation: 'Transportation',
  'purchase-allocation': 'Purchase Allocation',
  vendors: 'Vendors',
  'general-ledger': 'General Ledger',
  'sub-ledgers': 'Sub Ledgers',
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
  admin: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  manager: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  finance: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  staff: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  procurement_officer: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  hr_officer: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  project_manager: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
}

export function AppShell() {
  const { profile, role, signOut } = useAuth()
  const location = useLocation()
  const segments = location.pathname.split('/').filter(Boolean)

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === '1')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark')

  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', collapsed ? '1' : '0')
  }, [collapsed])

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const root = document.documentElement
    if (dark) { root.classList.add('dark') } else { root.classList.remove('dark') }
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-slate-900">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(c => !c)}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-white px-4 sm:px-6 dark:bg-slate-800 dark:border-slate-700">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 lg:hidden dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Breadcrumb */}
          <nav className="hidden items-center gap-1 text-sm text-slate-500 md:flex dark:text-slate-400">
            <NavLink to="/dashboard" className="hover:text-slate-700 dark:hover:text-slate-200">Home</NavLink>
            {segments.map((seg, i) => (
              <span key={seg} className="flex items-center gap-1">
                <ChevronRight className="h-3.5 w-3.5" />
                <span className={i === segments.length - 1 ? 'font-medium text-slate-800 dark:text-slate-100' : ''}>
                  {breadcrumbLabels[seg] ?? seg}
                </span>
              </span>
            ))}
          </nav>

          <div className="flex flex-1 justify-center px-2 sm:px-4">
            <GlobalSearch />
          </div>

          {/* User info */}
          <div className="flex items-center gap-2 sm:gap-3">
            <NotificationsBell />
            <button
              onClick={() => setDark(d => !d)}
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
              title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            {role && (
              <span className={`hidden rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize sm:inline ${roleBadgeColors[role] ?? 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                {role.replace(/_/g, ' ')}
              </span>
            )}
            <span className="hidden text-sm font-medium text-slate-700 md:inline dark:text-slate-200">{profile?.full_name ?? 'User'}</span>
            <button
              onClick={signOut}
              className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div key={location.pathname} className="animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
