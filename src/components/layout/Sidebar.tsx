import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, Receipt, ShoppingCart, Truck, FolderKanban,
  Users, DollarSign, CreditCard, TrendingUp, FileText,
  Package, MapPin, Clock, Wallet, BarChart3, Building2,
  Layers, Tag, Archive, Shield, ChevronDown
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useState } from 'react'

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
    ],
  },
  {
    title: 'Requests',
    to: '/requests',
    items: [
      { label: 'Expenses', to: '/expenses', icon: Receipt },
      { label: 'Orders', to: '/orders', icon: ShoppingCart },
      { label: 'Transportation', to: '/transportation', icon: Truck },
      { label: 'Purchase Allocation', to: '/purchase-allocation', icon: Layers },
    ],
  },
  {
    title: 'Procurement',
    to: '/procurement',
    items: [
      { label: 'Vendors', to: '/vendors', icon: Building2 },
      { label: 'Categories', to: '/categories', icon: Tag },
      { label: 'Vendor Receipts', to: '/vendor-receipts', icon: FileText },
    ],
  },
  {
    title: 'Finance',
    to: '/finance',
    items: [
      { label: 'Accounts', to: '/accounts', icon: CreditCard, roles: ['admin', 'manager', 'finance'] },
      { label: 'Sales', to: '/sales', icon: TrendingUp, roles: ['admin', 'manager', 'finance'] },
      { label: 'Tax Summary', to: '/tax-summary', icon: BarChart3, roles: ['admin', 'manager', 'finance'] },
      { label: 'Batch Payments', to: '/batch-payments', icon: DollarSign, roles: ['admin', 'manager', 'finance'] },
      { label: 'CPO Bonds', to: '/cpo-bonds', icon: Shield, roles: ['admin', 'manager', 'finance'] },
    ],
  },
  {
    title: 'HR',
    to: '/hr',
    items: [
      { label: 'Staff', to: '/staff', icon: Users, roles: ['admin', 'manager', 'finance'] },
      { label: 'Payroll', to: '/payroll', icon: Wallet, roles: ['admin', 'manager', 'finance'] },
      { label: 'Payroll Taxes', to: '/payroll-taxes', icon: FileText, roles: ['admin', 'manager', 'finance'] },
      { label: 'Emergency Payroll', to: '/emergency-payroll', icon: Archive, roles: ['admin', 'manager', 'finance'] },
      { label: 'Cash Advances', to: '/cash-advances', icon: DollarSign, roles: ['admin', 'manager', 'finance'] },
      { label: 'Timesheet', to: '/timesheet', icon: Clock, roles: ['admin', 'manager', 'finance'] },
    ],
  },
  {
    title: 'Management',
    to: '/management',
    items: [
      { label: 'Projects', to: '/projects', icon: FolderKanban, roles: ['admin', 'manager', 'finance'] },
      { label: 'Products', to: '/products', icon: Package, roles: ['admin', 'manager', 'finance'] },
      { label: 'Locations', to: '/locations', icon: MapPin, roles: ['admin', 'manager', 'finance'] },
    ],
  },
]

function NavGroup({ group }: { group: NavGroup }) {
  const { role } = useAuth()
  const [open, setOpen] = useState(true)

  const visibleItems = group.items.filter(item =>
    !item.roles || (role && item.roles.includes(role))
  )
  if (visibleItems.length === 0) return null

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

export function Sidebar() {
  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col bg-slate-900 overflow-y-auto">
      <div className="flex h-14 shrink-0 items-center border-b border-white/10 px-4">
        <span className="font-bold text-white tracking-tight">KUNCH</span>
        <span className="ml-1.5 rounded bg-blue-500 px-1.5 py-0.5 text-xs font-semibold text-white">10</span>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {navGroups.map(group => (
          <NavGroup key={group.title} group={group} />
        ))}
      </nav>
    </aside>
  )
}
