import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, Receipt, ShoppingCart, Truck, FolderKanban,
  Users, DollarSign, CreditCard, TrendingUp, FileText,
  Package, MapPin, Clock, Wallet, BarChart3, Building2,
  Layers, Archive, Shield, ChevronDown, ChevronLeft, ChevronRight, Globe2, BookOpen,
  ArrowLeftRight, PieChart, Scale, Warehouse, Wrench
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useState, useRef } from 'react'

interface NavItem {
  label: string
  to: string
  icon: React.ElementType
  roles?: string[]
}

interface NavGroup {
  title: string
  to?: string
  items: NavItem[]
}

const navGroups: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
      { label: 'Company Overview', to: '/overview', icon: Globe2 },
    ],
  },
  {
    title: 'Requests',
    to: '/requests',
    items: [
      { label: 'Expenses', to: '/expenses', icon: Receipt },
      { label: 'Purchase Requests', to: '/purchase-requests', icon: ShoppingCart },
      { label: 'Transportation', to: '/transportation', icon: Truck },
      { label: 'Purchase Allocation', to: '/purchase-allocation', icon: Layers },
    ],
  },
  {
    title: 'Procurement',
    to: '/procurement',
    items: [
      { label: 'Vendors', to: '/vendors', icon: Building2, roles: ['admin', 'manager', 'finance', 'procurement_officer'] },
      { label: 'General Ledger', to: '/general-ledger', icon: BookOpen, roles: ['admin', 'manager', 'finance', 'procurement_officer'] },
      { label: 'Vendor Receipts', to: '/vendor-receipts', icon: FileText, roles: ['admin', 'manager', 'finance', 'procurement_officer'] },
    ],
  },
  {
    title: 'Finance',
    to: '/finance',
    items: [
      { label: 'Accounts', to: '/accounts', icon: CreditCard, roles: ['admin', 'manager', 'finance'] },
      { label: 'Transfers', to: '/transfers', icon: ArrowLeftRight, roles: ['admin', 'manager', 'finance'] },
      { label: 'Sales', to: '/sales', icon: TrendingUp, roles: ['admin', 'manager', 'finance'] },
      { label: 'Clients', to: '/clients', icon: Users, roles: ['admin', 'manager', 'finance'] },
      { label: 'Tax Summary', to: '/tax-summary', icon: BarChart3, roles: ['admin', 'manager', 'finance'] },
      { label: 'Batch Payments', to: '/batch-payments', icon: DollarSign, roles: ['admin', 'manager', 'finance'] },
      { label: 'CPO Bonds', to: '/cpo-bonds', icon: Shield, roles: ['admin', 'manager', 'finance'] },
    ],
  },
  {
    title: 'Reports',
    items: [
      { label: 'P&L Report', to: '/reports/pl', icon: PieChart, roles: ['admin', 'manager', 'finance'] },
      { label: 'Balance Sheet', to: '/reports/balance-sheet', icon: Scale, roles: ['admin', 'manager', 'finance'] },
    ],
  },
  {
    title: 'HR',
    to: '/hr',
    items: [
      { label: 'Staff', to: '/staff', icon: Users, roles: ['admin', 'manager', 'finance', 'hr_officer'] },
      { label: 'Payroll', to: '/payroll', icon: Wallet, roles: ['admin', 'manager', 'finance', 'hr_officer'] },
      { label: 'Payroll Taxes', to: '/payroll-taxes', icon: FileText, roles: ['admin', 'manager', 'finance', 'hr_officer'] },
      { label: 'Emergency Payroll', to: '/emergency-payroll', icon: Archive, roles: ['admin', 'manager', 'finance', 'hr_officer'] },
      { label: 'Cash Advances', to: '/cash-advances', icon: DollarSign, roles: ['admin', 'manager', 'finance', 'hr_officer'] },
      { label: 'Timesheet', to: '/timesheet', icon: Clock, roles: ['admin', 'manager', 'finance', 'hr_officer'] },
    ],
  },
  {
    title: 'Management',
    to: '/management',
    items: [
      { label: 'Projects', to: '/projects', icon: FolderKanban, roles: ['admin', 'manager', 'finance', 'project_manager'] },
      { label: 'Products', to: '/products', icon: Package, roles: ['admin', 'manager', 'finance', 'project_manager'] },
      { label: 'Locations', to: '/locations', icon: MapPin, roles: ['admin', 'manager', 'finance', 'project_manager'] },
    ],
  },
  {
    title: 'Stock',
    items: [
      { label: 'Stock Catalog', to: '/stock', icon: Warehouse, roles: ['admin', 'manager', 'stock_manager', 'procurement_officer'] },
      { label: 'Tools', to: '/stock/tools', icon: Wrench, roles: ['admin', 'manager', 'stock_manager'] },
    ],
  },
]

function NavGroup({ group, collapsed }: { group: NavGroup; collapsed: boolean }) {
  const { role } = useAuth()
  const [open, setOpen] = useState(true)

  const visibleItems = group.items.filter(item =>
    !item.roles || (role && item.roles.includes(role))
  )
  if (visibleItems.length === 0) return null

  if (collapsed) {
    return (
      <div className="mb-1 space-y-0.5">
        {visibleItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            title={item.label}
            className={({ isActive }) =>
              cn(
                'flex items-center justify-center rounded-md px-2 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-white/10 text-white font-medium'
                  : 'text-slate-300 hover:bg-white/5 hover:text-white',
              )
            }
          >
            <item.icon className="h-4 w-4 shrink-0" />
          </NavLink>
        ))}
      </div>
    )
  }

  return (
    <div className="mb-1">
      <div className="flex w-full items-center justify-between px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
        {group.to ? (
          <NavLink to={group.to} className={({ isActive }) => cn('hover:text-slate-200', isActive && 'text-white')}>
            {group.title}
          </NavLink>
        ) : (
          <span>{group.title}</span>
        )}
        <button onClick={() => setOpen(o => !o)} className="hover:text-slate-300">
          <ChevronDown className={cn('h-3 w-3 transition-transform', !open && '-rotate-90')} />
        </button>
      </div>
      {open && (
        <div className="space-y-0.5">
          {visibleItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-white/10 text-white font-medium'
                    : 'text-slate-300 hover:bg-white/5 hover:text-white',
                )
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

interface SidebarProps {
  collapsed: boolean
  onToggleCollapse: () => void
  mobileOpen: boolean
  onCloseMobile: () => void
  isDark: boolean
  onToggleTheme: () => void
}

export function Sidebar({ collapsed, onToggleCollapse, mobileOpen, onCloseMobile, isDark, onToggleTheme }: SidebarProps) {
  const logoRef = useRef<HTMLImageElement>(null)

  function handleLogoClick() {
    const img = logoRef.current
    if (img) {
      img.classList.remove('logo-toggle-anim')
      void img.offsetWidth // reflow to restart animation
      img.classList.add('logo-toggle-anim')
      img.addEventListener('animationend', () => img.classList.remove('logo-toggle-anim'), { once: true })
    }
    onToggleTheme()
  }

  return (
    <>
      {mobileOpen && (
        <div
          className="animate-fade-in fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={onCloseMobile}
        />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex h-screen shrink-0 flex-col bg-sidebar overflow-y-auto transition-all duration-200',
          'lg:static lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          collapsed ? 'w-56 lg:w-16' : 'w-56',
        )}
      >
        <div className={cn('flex h-14 shrink-0 items-center border-b border-white/10', collapsed ? 'justify-center px-2' : 'px-4')}>
          <button
            onClick={handleLogoClick}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            <img ref={logoRef} src="/kuncho-logo.png" alt="KUNCHO" className="h-9 w-auto opacity-90 hover:opacity-100 transition-opacity" />
          </button>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navGroups.map(group => (
            <NavGroup key={group.title} group={group} collapsed={collapsed} />
          ))}
        </nav>
        <button
          onClick={onToggleCollapse}
          className="hidden shrink-0 items-center justify-center gap-2 border-t border-white/10 py-3 text-slate-400 hover:bg-white/5 hover:text-white lg:flex"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <><ChevronLeft className="h-4 w-4" /><span className="text-xs">Collapse</span></>}
        </button>
      </aside>
    </>
  )
}
