import {
  LayoutDashboard, Receipt, ShoppingCart, Truck, FolderKanban,
  Users, DollarSign, CreditCard, TrendingUp, FileText,
  Package, MapPin, Clock, Wallet, BarChart3, Building2,
  Layers, Archive, Shield, Globe2, BookOpen,
  ArrowLeftRight, PieChart, Scale, Warehouse, Wrench, ClipboardList, CalendarDays, Car,
  PenTool, FileSignature, Target, CalendarClock, ClipboardCheck, UserCheck, AlertTriangle,
  HardHat, Network, Send, Hammer, Award, Briefcase, Upload, Landmark, Camera, PackageCheck, Settings, Tag
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useMyManagedProjects, useMySiteForemanProjects } from '@/hooks/useMyStaff'

export interface NavItem {
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
  // Shown to anyone holding the is_tax_officer badge, in addition to `roles`.
  // Same reason as the VRF badge: the tax filing tables read the badge in
  // their RLS, so an officer whose login role is outside the list would hold
  // the access and never see the way in.
  showIfTaxOfficer?: boolean
  // Shown to anyone holding the is_logistics_officer badge, for the same
  // reason: role carries one value, so a person who runs logistics alongside
  // another desk holds the badge rather than the role, and would otherwise
  // lose the entries to the surfaces the badge already lets them use.
  showIfLogisticsOfficer?: boolean
  // Shown to a site foreman with at least one active project assignment. Site
  // foreman lives on staff.role (a job title), not user_profiles.role (system
  // access), so it uses the same "derived, not a stored permission" pattern as
  // PM assignment above.
  showIfSiteForeman?: boolean
  animateIcon?: string
}

export interface NavGroup {
  title: string
  to?: string
  items: NavItem[]
}

export const navGroups: NavGroup[] = [
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
      // Everyone's own dashboard (migration 352): widgets they choose,
      // starting from a default for their role and assignments.
      { label: 'My Dashboard', to: '/home', icon: LayoutDashboard },
      { label: 'General Dashboard', to: '/dashboard', icon: Layers, roles: ['admin', 'operations_manager'] },
      { label: 'My Projects', to: '/pm-view', icon: FolderKanban, roles: ['project_manager'], showIfAssignedProjectManager: true },
      { label: 'Site Petty Cash Requests', to: '/pm/site-petty-cash-requests', icon: Wallet, roles: ['project_manager'], showIfAssignedProjectManager: true },
      { label: 'BOQ Change Orders', to: '/pm/boq-change-orders', icon: FileText, roles: ['project_manager'], showIfAssignedProjectManager: true },
      { label: 'Operations', to: '/ops-manager-view', icon: Briefcase, roles: ['operations_manager'] },
      { label: 'Stock', to: '/stock-manager-view', icon: Warehouse, roles: ['stock_manager'] },
      { label: 'Logistics', to: '/logistics-view', icon: Car, roles: ['logistics_officer'], showIfLogisticsOfficer: true },
      { label: 'Workshop', to: '/workshop-view', icon: Hammer, roles: ['admin', 'executive', 'operations_manager', 'project_manager', 'stock_manager', 'logistics_officer'], showIfLogisticsOfficer: true },
      { label: 'Calendar', to: '/calendar', icon: CalendarDays },
      { label: 'Company Overview', to: '/overview', icon: Globe2, roles: ['admin', 'operations_manager'] },
      { label: 'Executive View', to: '/exec', icon: BarChart3, roles: ['admin', 'executive'] },
      { label: 'BOQ Change Orders', to: '/exec/boq-change-orders', icon: FileText, roles: ['admin', 'executive'] },
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
      { label: 'Log Attendance', to: '/site-foreman/log-attendance', icon: Clock, roles: [], showIfSiteForeman: true },
      { label: 'Log Material Receipt', to: '/site-foreman/log-material-receipt', icon: Package, roles: [], showIfSiteForeman: true },
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
      { label: 'Receipt Collection', to: '/receipt-pickups', icon: PackageCheck, roles: ['admin', 'executive', 'finance', 'logistics_officer', 'operations_manager'], showIfLogisticsOfficer: true },
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
      { label: 'Sales Journey', to: '/sales-journey', icon: Target, roles: ['admin', 'executive', 'finance', 'sales'] },
      // What Kuncho sells, its prices and costs (migration 337).
      { label: 'Services Catalog', to: '/catalog', icon: Package, roles: ['admin', 'executive', 'finance', 'project_manager', 'sales'] },
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
      { label: 'Goods Received', to: '/goods-received', icon: PackageCheck, roles: ['admin', 'executive', 'finance', 'procurement_officer', 'stock_manager', 'logistics_officer'], showIfLogisticsOfficer: true },
      { label: 'General Ledger', to: '/general-ledger', icon: BookOpen, roles: ['admin', 'executive', 'finance', 'procurement_officer'] },
      { label: 'Market Trends', to: '/procurement/market-trends', icon: TrendingUp, roles: ['admin', 'executive', 'finance', 'procurement_officer'] },
      { label: 'Price Check Queue', to: '/procurement/price-check-requests', icon: Clock, roles: ['admin', 'executive', 'procurement_officer'] },
      { label: 'My Price Checks', to: '/procurement/my-price-check-requests', icon: ClipboardList },
      { label: 'Volatility Settings', to: '/procurement/volatility', icon: Settings, roles: ['admin', 'procurement_officer'] },
      { label: 'Item Brands', to: '/procurement/item-brands', icon: Layers, roles: ['admin', 'executive', 'procurement_officer'] },
    ],
  },
  {
    title: 'Finance',
    to: '/finance',
    items: [
      { label: 'Payments', to: '/finance/payments', icon: Send, roles: ['admin', 'executive', 'finance'] },
      { label: 'Ledger & Journal', to: '/finance/ledger', icon: Scale, roles: ['admin', 'executive', 'finance'] },
      { label: 'Vendor Credits', to: '/finance/vendor-credits', icon: Tag, roles: ['admin', 'executive', 'finance'] },
      { label: 'Payment Requests', to: '/finance/payment-requests', icon: FileText, roles: ['admin', 'executive', 'finance'] },
      { label: 'Accounts', to: '/accounts', icon: CreditCard, roles: ['admin', 'executive', 'finance'] },
      { label: 'Transfers', to: '/transfers', icon: ArrowLeftRight, roles: ['admin', 'executive', 'finance'] },
      { label: 'Bank Reconciliation', to: '/bank-statement-import', icon: Upload, roles: ['admin', 'finance'] },
      { label: 'Cash Forecast', to: '/cash-forecast', icon: CalendarClock, roles: ['admin', 'finance'] },
      { label: 'Month-end', to: '/month-end', icon: ClipboardCheck, roles: ['admin', 'finance'] },
      { label: 'Sales', to: '/sales', icon: TrendingUp, roles: ['admin', 'executive', 'finance', 'sales'] },
      { label: 'Clients', to: '/clients', icon: Users, roles: ['admin', 'executive', 'finance'] },
      { label: 'Invoices', to: '/invoices', icon: Receipt, roles: ['admin', 'executive', 'finance'] },
      { label: 'Vendor Receipts (VRF)', to: '/vendor-receipts', icon: ArrowLeftRight, roles: ['admin', 'executive'], showIfVrfManager: true },
      { label: 'Petty Cash', to: '/petty-cash', icon: Wallet, roles: ['admin', 'executive', 'finance', 'project_manager'] },
      { label: 'Site Petty Cash Requests', to: '/finance/site-petty-cash-requests', icon: Wallet, roles: ['admin', 'executive', 'finance'] },
      { label: 'BOQ Change Orders', to: '/finance/boq-change-orders', icon: FileText, roles: ['admin', 'executive', 'finance'] },
      { label: 'Labor Expense Drafts', to: '/finance/labor-expense-drafts', icon: HardHat, roles: ['admin', 'executive', 'finance'] },
      // Read-only for everyone (register + book value), actions gated
      // inside the page itself — no roles restriction here on purpose.
      { label: 'Fixed Assets', to: '/finance/fixed-assets', icon: Archive },
    ],
  },
  {
    // Everything tax in one place. These were spread across Finance, Reports
    // and HR; they now all read Ethiopian periods and the same rate
    // references (migrations 301-313), so they belong together.
    title: 'Tax',
    items: [
      { label: 'Tax Filings', to: '/tax-filings', icon: Landmark, roles: ['admin', 'executive', 'finance'], showIfTaxOfficer: true },
      { label: 'Tax Management', to: '/tax-management', icon: Landmark, roles: ['admin', 'executive', 'finance'] },
      { label: 'Tax Receipts', to: '/tax-receipts', icon: Receipt, roles: ['admin', 'executive', 'finance', 'procurement_officer'] },
      { label: 'VAT Receipt Tracker', to: '/vat-tracker', icon: Camera, roles: ['admin', 'executive', 'finance', 'procurement_officer'] },
      { label: 'Government Statement', to: '/reports/government-statement', icon: FileText, roles: ['admin', 'executive', 'finance'] },
    ],
  },
  {
    title: 'Reports',
    items: [
      { label: 'P&L Report', to: '/reports/pl', icon: PieChart, roles: ['admin', 'executive', 'finance'] },
      { label: 'Balance Sheet', to: '/reports/balance-sheet', icon: Scale, roles: ['admin', 'executive', 'finance'] },
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
      { label: 'Competency Hub', to: '/hr/competency-hub', icon: Award, roles: ['admin', 'executive', 'hr_officer'] },
      { label: 'Tier 2 Candidates', to: '/hr/tier2-candidates', icon: UserCheck, roles: ['admin', 'executive', 'hr_officer'] },
      { label: 'Trade Catalog', to: '/hr/trades', icon: Layers, roles: ['admin', 'executive', 'hr_officer'] },
      { label: 'Payroll', to: '/payroll', icon: Wallet, roles: ['admin', 'executive', 'finance', 'hr_officer'] },
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
      // Matches sdr_pm_read/sdr_exec_all on site_daily_reports — finance
      // has no read grant on that table, so it's left off here.
      { label: 'Site Daily Reports', to: '/site-foreman/reports', icon: ClipboardCheck, roles: ['admin', 'executive', 'project_manager'] },
      { label: 'Subcontracts', to: '/subcontracts', icon: HardHat, roles: ['admin', 'executive', 'finance', 'project_manager'] },
      { label: 'Work Orders', to: '/work-orders', icon: Hammer, roles: ['admin', 'executive', 'finance', 'project_manager', 'operations_manager'] },
      { label: 'Job Descriptions', to: '/ffe-job-descriptions', icon: Award, roles: ['admin', 'executive', 'operations_manager', 'project_manager', 'hr_officer'] },
      { label: 'Rent', to: '/rent', icon: Building2, roles: ['admin', 'executive', 'finance', 'operations_manager'] },
      { label: 'CPO Bonds', to: '/cpo-bonds', icon: Shield, roles: ['admin', 'executive', 'finance', 'project_manager', 'sales'] },
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

// Whether a nav item is open to the signed-in person: their role, or the
// derived access that goes with an assignment or a badge. Shared by the
// sidebar and anything else that lists pages (the dashboard's pinned pages).
export function useNavItemVisible(): (item: NavItem) => boolean {
  const { role, profile } = useAuth()
  const { managesAny } = useMyManagedProjects()
  const { hasAny: isForemanWithProjects } = useMySiteForemanProjects()
  return (item: NavItem) =>
    !item.roles
    || (!!role && item.roles.includes(role))
    // Derived access, alongside the role list: an assigned project
    // manager sees the PM entries whatever their login role. Without
    // this the assignment is invisible to the person who holds it —
    // they'd have to be told the URL.
    || (!!item.showIfAssignedProjectManager && managesAny)
    // VRF badge: a finance user with is_vrf_manager sees the VRF entry.
    || (!!item.showIfVrfManager && !!profile?.is_vrf_manager)
    // Tax-officer badge: same idea, for the tax filings module.
    || (!!item.showIfTaxOfficer && !!profile?.is_tax_officer)
    // Logistics badge: same idea, for whoever runs logistics on a second hat.
    || (!!item.showIfLogisticsOfficer && !!profile?.is_logistics_officer)
    // Site foreman with at least one scoped project.
    || (!!item.showIfSiteForeman && isForemanWithProjects)
}
