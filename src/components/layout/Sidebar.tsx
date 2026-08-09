import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, Receipt, ShoppingCart, Truck, FolderKanban,
  Users, DollarSign, CreditCard, TrendingUp, FileText,
  Package, MapPin, Clock, Wallet, BarChart3, Building2,
  Layers, Archive, Shield, ChevronDown, ChevronLeft, ChevronRight, Globe2, BookOpen,
  ArrowLeftRight, PieChart, Scale, Warehouse, Wrench, ClipboardList, CalendarDays, Car,
  PenTool, FileSignature, Target, CalendarClock, ClipboardCheck, UserCheck, AlertTriangle,
  HardHat, Network, Send, Hammer, Award, Briefcase, Upload, Landmark, Camera, PackageCheck
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useMyManagedProjects, useMySiteForemanProjects } from '@/hooks/useMyStaff'
import { useState, useRef } from 'react'

interface NavItem {
  label: string
  to: string
  icon: React.ElementType
  roles?: string[]
  // Shown to anyone named on projects.project_manager_id, in addition
  // to `roles` — project management is an assignment, not only a role.
  showIfAssignedProjectManager?: boolean
  // Shown to a finance user holding the is_vrf_manager badge, in addition to
  // `roles` (admin/executive) — VRF access is a badge, not a plain role.
  showIfVrfManager?: boolean
  // Shown to a site foreman with at least one active project assignment. Site
  // foreman lives on staff.role (a job title), not user_profiles.role (system
  // access), so it uses the same "derived, not a stored permission" pattern as
  // PM assignment above.
  showIfSiteForeman?: boolean
  animateIcon?: string
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
      // "My Dashboard" / "Company Overview" (§0.2, §2): the generic,
      // cross-departmental views — hidden from every role except
      // admin/operations_manager, matching the server-side route guards
      // (ProtectedRoute on /overview, and DashboardPage's own in-component
      // gate on its GeneralDashboard branch). Everyone else has their own
      // department/role landing page instead, listed in its own group
      // below (or the Overview sub-items just above for Operations &
      // Construction's role split).
      { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard, roles: ['admin', 'operations_manager'] },
      { label: 'My Projects', to: '/pm-view', icon: FolderKanban, roles: ['project_manager'], showIfAssignedProjectManager: true },
      { label: 'Operations', to: '/ops-manager-view', icon: Briefcase, roles: ['operations_manager'] },
      { label: 'Stock', to: '/stock-manager-view', icon: Warehouse, roles: ['stock_manager'] },
      { label: 'Logistics', to: '/logistics-view', icon: Car, roles: ['logistics_officer'] },
      { label: 'Workshop', to: '/workshop-view', icon: Hammer, roles: ['admin', 'executive', 'operations_manager', 'project_manager', 'stock_manager', 'logistics_officer'] },
      { label: 'Calendar', to: '/calendar', icon: CalendarDays },
      { label: 'Company Overview', to: '/overview', icon: Globe2, roles: ['admin', 'operations_manager'] },
      { label: 'Departments', to: '/departments', icon: Network },
    ],
  },
  {
    // Site Ops: visible only to a site foreman with at least one active
    // project assignment. Every item is gated by showIfSiteForeman + an
    // empty roles array so the "no roles = show to everyone" default in
    // NavGroup doesn't fire — the derived flag must match.
    title: 'Site Ops',
    items: [
      { label: 'Daily Site Report', to: '/site-foreman/daily-report', icon: ClipboardCheck, roles: [], showIfSiteForeman: true },
      { label: 'Log Site Timesheet', to: '/site-foreman/timesheet', icon: Clock, roles: [], showIfSiteForeman: true },
      { label: 'My Site Float Request', to: '/site-foreman/float-request', icon: Wallet, roles: [], showIfSiteForeman: true },
      { label: 'Materials Requested', to: '/site-foreman/materials', icon: Package, roles: [], showIfSiteForeman: true },
      { label: 'HSE Log', to: '/site-foreman/hse', icon: AlertTriangle, roles: [], showIfSiteForeman: true },
      { label: 'Work Orders on My Sites', to: '/site-foreman/work-orders', icon: HardHat, roles: [], showIfSiteForeman: true },
      { label: 'My Projects', to: '/site-foreman/projects', icon: FolderKanban, roles: [], showIfSiteForeman: true },
    ],
  },
  {
    title: 'Requests',
    to: '/requests',
    items: [
      { label: 'Approvals', to: '/expenses', icon: Receipt },
      { label: 'Purchase Requests', to: '/purchase-requests', icon: ShoppingCart },
      { label: 'Transport Jobs', to: '/transportation', icon: Truck },
      { label: 'Fleet & Logistics', to: '/logistics', icon: Car, animateIcon: 'car-twist-anim' },
      { label: 'Vehicle Maintenance', to: '/fleet/maintenance', icon: Wrench },
      { label: 'Traffic Penalties', to: '/fleet/penalties', icon: AlertTriangle },
      { label: 'Receipt Collection', to: '/receipt-pickups', icon: PackageCheck, roles: ['admin', 'executive', 'finance', 'logistics_officer', 'operations_manager'] },
      { label: 'Purchase Allocation', to: '/purchase-allocation', icon: Layers },
      { label: 'Batch Payments', to: '/batch-payments', icon: DollarSign, roles: ['admin', 'executive', 'finance'] },
      { label: 'My Leave', to: '/my-leave', icon: CalendarClock },
    ],
  },
  {
    title: 'Design',
    to: '/design',
    items: [
      { label: 'Design Overview', to: '/design-view', icon: PenTool, roles: ['admin', 'executive', 'design'] },
      { label: 'Design Packages', to: '/design', icon: PenTool },
    ],
  },
  {
    title: 'Business Development',
    items: [
      { label: 'Sales Overview', to: '/sales-view', icon: TrendingUp, roles: ['admin', 'executive', 'sales'] },
      { label: 'Opportunities', to: '/opportunities', icon: Target },
      { label: 'Contracts', to: '/contracts', icon: FileSignature },
    ],
  },
  {
    title: 'Procurement',
    to: '/procurement',
    items: [
      { label: 'Vendors', to: '/vendors', icon: Building2, roles: ['admin', 'executive', 'finance', 'procurement_officer'] },
      { label: 'Sourcing Bundles', to: '/sourcing', icon: ClipboardList, roles: ['admin', 'executive', 'finance', 'procurement_officer'] },
      { label: 'Goods Received', to: '/goods-received', icon: PackageCheck, roles: ['admin', 'executive', 'finance', 'procurement_officer', 'stock_manager', 'logistics_officer'] },
      { label: 'General Ledger', to: '/general-ledger', icon: BookOpen, roles: ['admin', 'executive', 'finance', 'procurement_officer'] },
    ],
  },
  {
    title: 'Finance',
    to: '/finance',
    items: [
      { label: 'Payments', to: '/finance/payments', icon: Send, roles: ['admin', 'executive', 'finance'] },
      { label: 'Ledger & Journal', to: '/finance/ledger', icon: Scale, roles: ['admin', 'executive', 'finance'] },
      { label: 'Accounts', to: '/accounts', icon: CreditCard, roles: ['admin', 'executive', 'finance'] },
      { label: 'Transfers', to: '/transfers', icon: ArrowLeftRight, roles: ['admin', 'executive', 'finance'] },
      { label: 'Bank Statement Import', to: '/bank-statement-import', icon: Upload, roles: ['admin', 'finance'] },
      { label: 'Sales', to: '/sales', icon: TrendingUp, roles: ['admin', 'executive', 'finance', 'sales'] },
      { label: 'Clients', to: '/clients', icon: Users, roles: ['admin', 'executive', 'finance'] },
      { label: 'Invoices', to: '/invoices', icon: Receipt, roles: ['admin', 'executive', 'finance'] },
      { label: 'Vendor Receipts (VRF)', to: '/vendor-receipts', icon: ArrowLeftRight, roles: ['admin', 'executive'], showIfVrfManager: true },
      { label: 'Tax Summary', to: '/tax-summary', icon: BarChart3, roles: ['admin', 'executive', 'finance'] },
      { label: 'Tax Management', to: '/tax-management', icon: Landmark, roles: ['admin', 'executive', 'finance'] },
      { label: 'Tax Receipts', to: '/tax-receipts', icon: Receipt, roles: ['admin', 'executive', 'finance', 'procurement_officer'] },
      { label: 'VAT Receipt Tracker', to: '/vat-tracker', icon: Camera, roles: ['admin', 'executive', 'finance', 'procurement_officer'] },
      { label: 'Petty Cash', to: '/petty-cash', icon: Wallet, roles: ['admin', 'executive', 'finance', 'project_manager'] },
      { label: 'Labor Expense Drafts', to: '/finance/labor-expense-drafts', icon: HardHat, roles: ['admin', 'executive', 'finance'] },
    ],
  },
  {
    title: 'Reports',
    items: [
      { label: 'P&L Report', to: '/reports/pl', icon: PieChart, roles: ['admin', 'executive', 'finance'] },
      { label: 'Balance Sheet', to: '/reports/balance-sheet', icon: Scale, roles: ['admin', 'executive', 'finance'] },
      { label: 'Government Statement', to: '/reports/government-statement', icon: Landmark, roles: ['admin', 'executive', 'finance'] },
      { label: 'Historical Archive', to: '/reports/archive', icon: Archive, roles: ['admin', 'executive', 'finance'] },
    ],
  },
  {
    title: 'HR',
    to: '/hr',
    items: [
      { label: 'HR Overview', to: '/hr-view', icon: Briefcase, roles: ['admin', 'executive', 'hr_officer'] },
      { label: 'Staff', to: '/staff', icon: Users, roles: ['admin', 'executive', 'finance', 'hr_officer'] },
      { label: 'Casual Workers', to: '/hr/casual-workers', icon: HardHat, roles: ['admin', 'executive', 'finance', 'hr_officer'] },
      { label: 'Payroll', to: '/payroll', icon: Wallet, roles: ['admin', 'executive', 'finance', 'hr_officer'] },
      { label: 'Payroll Taxes', to: '/payroll-taxes', icon: FileText, roles: ['admin', 'executive', 'finance', 'hr_officer'] },
      { label: 'Emergency Payroll', to: '/emergency-payroll', icon: Archive, roles: ['admin', 'executive', 'finance', 'hr_officer'] },
      { label: 'Cash Advances', to: '/cash-advances', icon: DollarSign, roles: ['admin', 'executive', 'finance', 'hr_officer'] },
      { label: 'Timesheet', to: '/timesheet', icon: Clock, roles: ['admin', 'executive', 'finance', 'hr_officer'] },
      { label: 'Onboarding', to: '/onboarding-tasks', icon: UserCheck },
      { label: 'Labor Requisitions', to: '/labor-requisitions', icon: HardHat },
      { label: 'Leave Requests', to: '/leave-requests', icon: CalendarClock, roles: ['admin', 'hr_officer'] },
      { label: 'Performance Reviews', to: '/performance-reviews', icon: ClipboardCheck, roles: ['admin', 'hr_officer'] },
      { label: 'Disciplinary Records', to: '/disciplinary-records', icon: AlertTriangle, roles: ['admin', 'hr_officer'] },
    ],
  },
  {
    title: 'HSE',
    items: [
      { label: 'HSE Overview', to: '/hse-view', icon: Shield, roles: ['admin', 'executive', 'hse_officer'] },
      { label: 'Incidents', to: '/hse-incidents', icon: AlertTriangle },
      { label: 'Inductions', to: '/hse-inductions', icon: HardHat },
    ],
  },
  {
    title: 'Management',
    to: '/management',
    items: [
      { label: 'Projects', to: '/projects', icon: FolderKanban, roles: ['admin', 'executive', 'finance', 'project_manager'] },
      { label: 'Subcontracts', to: '/subcontracts', icon: HardHat, roles: ['admin', 'executive', 'finance', 'project_manager'] },
      { label: 'Work Orders', to: '/work-orders', icon: Hammer, roles: ['admin', 'executive', 'finance', 'project_manager', 'operations_manager'] },
      { label: 'Job Descriptions', to: '/ffe-job-descriptions', icon: Award, roles: ['admin', 'executive', 'operations_manager', 'project_manager', 'hr_officer'] },
      { label: 'Rent', to: '/rent', icon: Building2, roles: ['admin', 'executive', 'finance', 'operations_manager'] },
      { label: 'CPO Bonds', to: '/cpo-bonds', icon: Shield, roles: ['admin', 'executive', 'finance', 'project_manager', 'sales'] },
      { label: 'Products', to: '/products', icon: Package, roles: ['admin', 'executive', 'finance', 'project_manager'] },
      { label: 'Locations', to: '/locations', icon: MapPin, roles: ['admin', 'executive', 'finance', 'project_manager'] },
      { label: 'Locations Map', to: '/locations/map', icon: Globe2 },
    ],
  },
  {
    title: 'Stock',
    items: [
      { label: 'Stock Catalog', to: '/stock', icon: Warehouse, roles: ['admin', 'executive', 'stock_manager', 'procurement_officer'] },
      { label: 'Pending Setup', to: '/stock/pending-setup', icon: ClipboardCheck, roles: ['admin', 'executive', 'stock_manager', 'procurement_officer'] },
      { label: 'Dispatch Queue', to: '/stock/dispatch-queue', icon: Truck, roles: ['admin', 'executive', 'stock_manager', 'procurement_officer'] },
      { label: 'Tools', to: '/stock/tools', icon: Wrench, roles: ['admin', 'executive', 'stock_manager'] },
    ],
  },
  {
    title: 'Admin',
    items: [
      { label: 'Users & Roles', to: '/users', icon: Shield, roles: ['admin'] },
    ],
  },
]

function NavGroup({ group, collapsed }: { group: NavGroup; collapsed: boolean }) {
  const { role, profile } = useAuth()
  const { managesAny } = useMyManagedProjects()
  const { hasAny: isForemanWithProjects } = useMySiteForemanProjects()
  const [open, setOpen] = useState(true)

  const visibleItems = group.items.filter(item =>
    !item.roles
    || (role && item.roles.includes(role))
    // Derived access, alongside the role list: an assigned project
    // manager sees the PM entries whatever their login role. Without
    // this the assignment is invisible to the person who holds it —
    // they'd have to be told the URL.
    || (item.showIfAssignedProjectManager && managesAny)
    // VRF badge: a finance user with is_vrf_manager sees the VRF entry.
    || (item.showIfVrfManager && profile?.is_vrf_manager)
    // Site foreman with at least one scoped project.
    || (item.showIfSiteForeman && isForemanWithProjects)
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
            <item.icon className={cn('h-4 w-4 shrink-0', item.animateIcon)} />
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
              <item.icon className={cn('h-4 w-4 shrink-0', item.animateIcon)} />
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
  const logoRef = useRef<HTMLSpanElement>(null)

  function handleLogoClick() {
    const el = logoRef.current
    if (el) {
      el.classList.remove('logo-toggle-anim')
      void el.offsetWidth
      el.classList.add('logo-toggle-anim')
      el.addEventListener('animationend', () => el.classList.remove('logo-toggle-anim'), { once: true })
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
            className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            <span
              ref={logoRef}
              className="inline-block font-black leading-none select-none transition-colors duration-300"
              style={{ fontSize: '2rem', color: isDark ? '#D4AF37' : 'white' }}
            >
              ቁ
            </span>
            {!collapsed && (
              <span className="text-sm font-semibold tracking-widest text-white/60 uppercase">
                Kuncho
              </span>
            )}
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
