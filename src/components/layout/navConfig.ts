import {
  LayoutDashboard, Receipt, ShoppingCart, Truck, FolderKanban, Users, DollarSign, CreditCard, TrendingUp, FileText, Package, MapPin, Clock, Wallet, BarChart3, Building2, Layers, Archive, Shield, Globe2, BookOpen, ArrowLeftRight, PieChart, Scale, Warehouse, Wrench, ClipboardList, CalendarDays, Car, PenTool, FileSignature, Target, CalendarClock, ClipboardCheck, UserCheck, AlertTriangle, HardHat, Network, Send, Hammer, Award, Briefcase, Upload, Landmark, Camera, PackageCheck, Settings, Tag, Copy, ShieldCheck, Activity, History,
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
  // Small heading this item sits under inside its section.
  subgroup?: string
}

export interface NavGroup {
  title: string
  // The section's own icon: the rail, the top bar and the folded sidebar
  // show a section by its icon alone.
  icon: React.ElementType
  // The section's hub page, when it has one.
  to?: string
  items: NavItem[]
}

// Sections follow the work, not the org chart: a page sits where people go
// looking for it. Inside a section, `subgroup` puts a small heading over the
// run of items that share it; items are listed in order, so each subgroup's
// items sit together. Access is unchanged by where an item sits — `roles`
// and the badge flags still decide who sees it.
export const navGroups: NavGroup[] = [
  {
    title: 'Home',
    icon: LayoutDashboard,
    items: [
      // Everyone's own dashboard (migration 352): widgets they choose,
      // starting from a default for their role and assignments.
      { label: 'My Dashboard', to: '/home', icon: LayoutDashboard },
      { label: 'Calendar', to: '/calendar', icon: CalendarDays },
      { label: 'My Leave', to: '/my-leave', icon: CalendarClock },
      { label: 'My Price Checks', to: '/procurement/my-price-check-requests', icon: ClipboardList },
      // The generic, cross-departmental views — hidden from every role except
      // admin/operations_manager, matching the server-side route guards
      // (ProtectedRoute on /overview, and DashboardPage's own in-component
      // gate on its GeneralDashboard branch). Everyone else has their own
      // department/role landing page, listed alongside.
      { subgroup: 'Dashboards', label: 'General Dashboard', to: '/dashboard', icon: Layers, roles: ['admin', 'operations_manager'] },
      { subgroup: 'Dashboards', label: 'Company Overview', to: '/overview', icon: Globe2, roles: ['admin', 'operations_manager'] },
      { subgroup: 'Dashboards', label: 'Executive View', to: '/exec', icon: BarChart3, roles: ['admin', 'executive'] },
      { subgroup: 'Dashboards', label: 'Operations Health', to: '/ops-health', icon: Activity, roles: ['admin', 'executive', 'finance', 'procurement_officer', 'hr_officer', 'operations_manager', 'logistics_officer', 'project_manager', 'stock_manager'], showIfAssignedProjectManager: true, showIfLogisticsOfficer: true },
      { subgroup: 'Dashboards', label: 'My Projects', to: '/pm-view', icon: FolderKanban, roles: ['project_manager'], showIfAssignedProjectManager: true },
      { subgroup: 'Dashboards', label: 'Operations', to: '/ops-manager-view', icon: Briefcase, roles: ['operations_manager'] },
      { subgroup: 'Dashboards', label: 'Stock', to: '/stock-manager-view', icon: Warehouse, roles: ['stock_manager'] },
      { subgroup: 'Dashboards', label: 'Logistics', to: '/logistics-view', icon: Car, roles: ['logistics_officer'], showIfLogisticsOfficer: true },
      { subgroup: 'Dashboards', label: 'Workshop', to: '/workshop-view', icon: Hammer, roles: ['admin', 'executive', 'operations_manager', 'project_manager', 'stock_manager', 'logistics_officer'], showIfLogisticsOfficer: true },
      { subgroup: 'Dashboards', label: 'Design Overview', to: '/design-view', icon: PenTool, roles: ['admin', 'executive', 'design'] },
      { subgroup: 'Dashboards', label: 'Sales Overview', to: '/sales-view', icon: TrendingUp, roles: ['admin', 'executive', 'sales'] },
      { subgroup: 'Dashboards', label: 'HR Overview', to: '/hr-view', icon: Briefcase, roles: ['admin', 'executive', 'hr_officer'] },
      { subgroup: 'Dashboards', label: 'HSE Overview', to: '/hse-view', icon: Shield, roles: ['admin', 'executive', 'hse_officer'] },
      { subgroup: 'Dashboards', label: 'Departments', to: '/departments', icon: Network },
    ],
  },
  {
    title: 'Requests',
    icon: Receipt,
    to: '/requests',
    items: [
      { label: 'Approvals', to: '/expenses', icon: Receipt },
      { label: 'Purchase Requests', to: '/purchase-requests', icon: ShoppingCart },
      { label: 'Transport Jobs', to: '/transportation', icon: Truck },
      { label: 'Purchase Allocation', to: '/purchase-allocation', icon: Layers },
    ],
  },
  {
    title: 'Projects & Sites',
    icon: FolderKanban,
    to: '/management',
    items: [
      { label: 'Projects', to: '/projects', icon: FolderKanban, roles: ['admin', 'executive', 'finance', 'project_manager'] },
      // Matches sdr_pm_read/sdr_exec_all on site_daily_reports — finance
      // has no read grant on that table, so it's left off here.
      { label: 'Site Daily Reports', to: '/site-foreman/reports', icon: ClipboardCheck, roles: ['admin', 'executive', 'project_manager'] },
      { label: 'Subcontracts', to: '/subcontracts', icon: HardHat, roles: ['admin', 'executive', 'finance', 'project_manager'] },
      { label: 'Work Orders', to: '/work-orders', icon: Hammer, roles: ['admin', 'executive', 'finance', 'project_manager', 'operations_manager', 'technician'] },
      { label: 'Design Packages', to: '/design', icon: PenTool },
      // Three queues, one per approval step: the PM's, finance's, then the
      // executive's. Admin sees the last two, so they carry the step.
      { label: 'BOQ Change Orders', to: '/pm/boq-change-orders', icon: FileText, roles: ['project_manager'], showIfAssignedProjectManager: true },
      { label: 'BOQ Change Orders (Finance)', to: '/finance/boq-change-orders', icon: FileText, roles: ['admin', 'executive', 'finance'] },
      { label: 'BOQ Change Orders (Exec)', to: '/exec/boq-change-orders', icon: FileText, roles: ['admin', 'executive'] },
      { subgroup: 'My sites', label: 'Deliveries to Sign', to: '/site-deliveries', icon: PackageCheck, roles: ['project_manager'], showIfAssignedProjectManager: true },
      { subgroup: 'My sites', label: 'Goods Received on My Sites', to: '/goods-received', icon: ClipboardCheck, roles: ['project_manager'], showIfAssignedProjectManager: true },
      { subgroup: 'My sites', label: 'Site Petty Cash Requests', to: '/pm/site-petty-cash-requests', icon: Wallet, roles: ['project_manager'], showIfAssignedProjectManager: true },
      // Site foreman: visible only with at least one active project
      // assignment. Every item is gated by showIfSiteForeman + an empty
      // roles array so the "no roles = show to everyone" default doesn't
      // fire — the derived flag must match.
      { subgroup: 'On site', label: 'Daily Site Report', to: '/site-foreman/daily-report', icon: ClipboardCheck, roles: [], showIfSiteForeman: true },
      { subgroup: 'On site', label: 'Record Labour', to: '/labour/record', icon: Clock, roles: [], showIfSiteForeman: true },
      { subgroup: 'On site', label: 'Log Material Receipt', to: '/site-foreman/log-material-receipt', icon: Package, roles: [], showIfSiteForeman: true },
      { subgroup: 'On site', label: 'My Site Float Request', to: '/site-foreman/float-request', icon: Wallet, roles: [], showIfSiteForeman: true },
      { subgroup: 'On site', label: 'Materials Requested', to: '/site-foreman/materials', icon: Package, roles: [], showIfSiteForeman: true },
      { subgroup: 'On site', label: 'HSE Log', to: '/site-foreman/hse', icon: AlertTriangle, roles: [], showIfSiteForeman: true },
      { subgroup: 'On site', label: 'Work Orders on My Sites', to: '/site-foreman/work-orders', icon: HardHat, roles: [], showIfSiteForeman: true },
      { subgroup: 'On site', label: 'My Projects', to: '/site-foreman/projects', icon: FolderKanban, roles: [], showIfSiteForeman: true },
      { subgroup: 'Places', label: 'Locations', to: '/locations', icon: MapPin, roles: ['admin', 'executive', 'finance', 'project_manager'] },
      { subgroup: 'Places', label: 'Locations Map', to: '/locations/map', icon: Globe2 },
      { subgroup: 'Places', label: 'Rent', to: '/rent', icon: Building2, roles: ['admin', 'executive', 'finance', 'operations_manager'] },
    ],
  },
  {
    title: 'Sales',
    icon: Target,
    items: [
      { label: 'Sales Journey', to: '/sales-journey', icon: Target, roles: ['admin', 'executive', 'finance', 'sales'] },
      { label: 'Opportunities', to: '/opportunities', icon: Target },
      { label: 'Contracts', to: '/contracts', icon: FileSignature },
      // What Kuncho sells, its prices and costs (migration 337).
      { label: 'Services Catalog', to: '/catalog', icon: Package, roles: ['admin', 'executive', 'finance', 'project_manager', 'sales'] },
      { label: 'CPO Bonds', to: '/cpo-bonds', icon: Shield, roles: ['admin', 'executive', 'finance', 'project_manager', 'sales'] },
    ],
  },
  {
    title: 'Supply Chain',
    icon: Truck,
    to: '/procurement',
    items: [
      { subgroup: 'Buying', label: 'Vendors', to: '/vendors', icon: Building2, roles: ['admin', 'executive', 'finance', 'procurement_officer'] },
      { subgroup: 'Buying', label: 'Vendor Review', to: '/vendors/review', icon: ShieldCheck, roles: ['admin', 'executive', 'finance', 'procurement_officer'] },
      { subgroup: 'Buying', label: 'Sourcing Bundles', to: '/sourcing', icon: ClipboardList, roles: ['admin', 'executive', 'finance', 'procurement_officer'] },
      { subgroup: 'Buying', label: 'Price Check Queue', to: '/procurement/price-check-requests', icon: Clock, roles: ['admin', 'executive', 'procurement_officer'] },
      { subgroup: 'Buying', label: 'Market Trends', to: '/procurement/market-trends', icon: TrendingUp, roles: ['admin', 'executive', 'finance', 'procurement_officer'] },
      { subgroup: 'Buying', label: 'Volatility Settings', to: '/procurement/volatility', icon: Settings, roles: ['admin', 'procurement_officer'] },
      { subgroup: 'Buying', label: 'Item Variants', to: '/procurement/item-variants', icon: Layers, roles: ['admin', 'executive', 'procurement_officer'] },
      { subgroup: 'Buying', label: 'Item Brands', to: '/procurement/item-brands', icon: Layers, roles: ['admin', 'executive', 'procurement_officer'] },
      { subgroup: 'Receiving', label: 'Goods Received', to: '/goods-received', icon: PackageCheck, roles: ['admin', 'executive', 'finance', 'procurement_officer', 'stock_manager', 'logistics_officer'], showIfLogisticsOfficer: true },
      { subgroup: 'Receiving', label: 'Site Deliveries', to: '/site-deliveries', icon: Truck, roles: ['admin', 'executive', 'procurement_officer', 'logistics_officer', 'stock_manager'], showIfLogisticsOfficer: true },
      { subgroup: 'Receiving', label: 'Receipt Collection', to: '/receipt-pickups', icon: PackageCheck, roles: ['admin', 'executive', 'finance', 'logistics_officer', 'operations_manager'], showIfLogisticsOfficer: true },
      { subgroup: 'Stock', label: 'Stock Catalog', to: '/stock', icon: Warehouse, roles: ['admin', 'executive', 'stock_manager', 'procurement_officer'] },
      { subgroup: 'Stock', label: 'Issue to a Project', to: '/stock/issue', icon: Send, roles: ['admin', 'executive', 'stock_manager', 'procurement_officer'] },
      { subgroup: 'Stock', label: 'Stock Counts', to: '/stock/counts', icon: ClipboardList, roles: ['admin', 'executive', 'stock_manager', 'procurement_officer'] },
      { subgroup: 'Stock', label: 'Set Up Items', to: '/stock/pending-setup', icon: ClipboardCheck, roles: ['admin', 'executive', 'stock_manager', 'procurement_officer'] },
      { subgroup: 'Stock', label: 'Duplicates', to: '/stock/duplicates', icon: Copy, roles: ['admin', 'executive', 'stock_manager', 'procurement_officer'] },
      { subgroup: 'Stock', label: 'Dispatch Queue', to: '/stock/dispatch-queue', icon: Truck, roles: ['admin', 'executive', 'stock_manager', 'procurement_officer'] },
      { subgroup: 'Stock', label: 'Tools', to: '/stock/tools', icon: Wrench, roles: ['admin', 'executive', 'stock_manager'] },
      { subgroup: 'Fleet', label: 'Fleet & Logistics', to: '/logistics', icon: Car, animateIcon: 'car-twist-anim' },
      { subgroup: 'Fleet', label: 'Vehicle Maintenance', to: '/fleet/maintenance', icon: Wrench },
      { subgroup: 'Fleet', label: 'Traffic Penalties', to: '/fleet/penalties', icon: AlertTriangle },
    ],
  },
  {
    title: 'Money',
    icon: Wallet,
    to: '/finance',
    items: [
      { subgroup: 'Pay', label: 'Payments', to: '/finance/payments', icon: Send, roles: ['admin', 'executive', 'finance'] },
      { subgroup: 'Pay', label: 'Payment Requests', to: '/finance/payment-requests', icon: FileText, roles: ['admin', 'executive', 'finance'] },
      { subgroup: 'Pay', label: 'Batch Payments', to: '/batch-payments', icon: DollarSign, roles: ['admin', 'executive', 'finance'] },
      { subgroup: 'Pay', label: 'Vendor Credits', to: '/finance/vendor-credits', icon: Tag, roles: ['admin', 'executive', 'finance'] },
      { subgroup: 'Pay', label: 'Vendor Receipts (VRF)', to: '/vendor-receipts', icon: ArrowLeftRight, roles: ['admin', 'executive'], showIfVrfManager: true },
      { subgroup: 'Pay', label: 'Petty Cash', to: '/petty-cash', icon: Wallet, roles: ['admin', 'executive', 'finance', 'project_manager'] },
      { subgroup: 'Pay', label: 'Site Petty Cash Requests', to: '/finance/site-petty-cash-requests', icon: Wallet, roles: ['admin', 'executive', 'finance'] },
      { subgroup: 'Pay', label: 'Labour Pay', to: '/finance/labor-expense-drafts', icon: HardHat, roles: ['admin', 'executive', 'finance'] },
      { subgroup: 'Collect', label: 'Sales', to: '/sales', icon: TrendingUp, roles: ['admin', 'executive', 'finance', 'sales'] },
      { subgroup: 'Collect', label: 'Clients', to: '/clients', icon: Users, roles: ['admin', 'executive', 'finance'] },
      { subgroup: 'Collect', label: 'Proformas', to: '/proformas', icon: FileText, roles: ['admin', 'executive', 'finance'] },
      { subgroup: 'Collect', label: 'Invoices', to: '/invoices', icon: Receipt, roles: ['admin', 'executive', 'finance'] },
      { subgroup: 'Collect', label: 'Owed from Last Year', to: '/invoices/carried-forward', icon: History, roles: ['admin', 'executive', 'finance'] },
      { subgroup: 'Books & bank', label: 'Ledger & Journal', to: '/finance/ledger', icon: Scale, roles: ['admin', 'executive', 'finance'] },
      { subgroup: 'Books & bank', label: 'General Ledger', to: '/general-ledger', icon: BookOpen, roles: ['admin', 'executive', 'finance', 'procurement_officer'] },
      { subgroup: 'Books & bank', label: 'Accounts', to: '/accounts', icon: CreditCard, roles: ['admin', 'executive', 'finance'] },
      { subgroup: 'Books & bank', label: 'Transfers', to: '/transfers', icon: ArrowLeftRight, roles: ['admin', 'executive', 'finance'] },
      { subgroup: 'Books & bank', label: 'Bank Reconciliation', to: '/bank-statement-import', icon: Upload, roles: ['admin', 'finance'] },
      { subgroup: 'Books & bank', label: 'Cash Forecast', to: '/cash-forecast', icon: CalendarClock, roles: ['admin', 'finance'] },
      { subgroup: 'Books & bank', label: 'Month-end', to: '/month-end', icon: ClipboardCheck, roles: ['admin', 'finance'] },
      // Read-only for everyone (register + book value), actions gated
      // inside the page itself — no roles restriction here on purpose.
      { subgroup: 'Books & bank', label: 'Fixed Assets', to: '/finance/fixed-assets', icon: Archive },
      // Everything tax in one place: they all read Ethiopian periods and
      // the same rate references (migrations 301-313).
      { subgroup: 'Tax', label: 'Tax Filings', to: '/tax-filings', icon: Landmark, roles: ['admin', 'executive', 'finance'], showIfTaxOfficer: true },
      { subgroup: 'Tax', label: 'Tax Management', to: '/tax-management', icon: Landmark, roles: ['admin', 'executive', 'finance'] },
      { subgroup: 'Tax', label: 'Tax Receipts', to: '/tax-receipts', icon: Receipt, roles: ['admin', 'executive', 'finance', 'procurement_officer'] },
      { subgroup: 'Tax', label: 'VAT Receipt Tracker', to: '/vat-tracker', icon: Camera, roles: ['admin', 'executive', 'finance', 'procurement_officer'] },
      { subgroup: 'Tax', label: 'Government Statement', to: '/reports/government-statement', icon: FileText, roles: ['admin', 'executive', 'finance'] },
      { subgroup: 'Reports', label: 'P&L Report', to: '/reports/pl', icon: PieChart, roles: ['admin', 'executive', 'finance'] },
      { subgroup: 'Reports', label: 'Balance Sheet', to: '/reports/balance-sheet', icon: Scale, roles: ['admin', 'executive', 'finance'] },
      { subgroup: 'Reports', label: 'Historical Archive', to: '/reports/archive', icon: Archive, roles: ['admin', 'executive', 'finance'] },
    ],
  },
  {
    title: 'People & Safety',
    icon: Users,
    to: '/hr',
    items: [
      { subgroup: 'People', label: 'Staff', to: '/staff', icon: Users, roles: ['admin', 'executive', 'finance', 'hr_officer'] },
      { subgroup: 'People', label: 'Casual Workers', to: '/hr/casual-workers', icon: HardHat, roles: ['admin', 'executive', 'finance', 'hr_officer'] },
      { subgroup: 'People', label: 'Onboarding', to: '/onboarding-tasks', icon: UserCheck },
      { subgroup: 'People', label: 'Leave Requests', to: '/leave-requests', icon: CalendarClock, roles: ['admin', 'hr_officer'] },
      { subgroup: 'People', label: 'Performance Reviews', to: '/performance-reviews', icon: ClipboardCheck, roles: ['admin', 'hr_officer'] },
      { subgroup: 'People', label: 'Disciplinary Records', to: '/disciplinary-records', icon: AlertTriangle, roles: ['admin', 'hr_officer'] },
      { subgroup: 'People', label: 'Job Descriptions', to: '/ffe-job-descriptions', icon: Award, roles: ['admin', 'executive', 'operations_manager', 'project_manager', 'hr_officer'] },
      { subgroup: 'Pay & time', label: 'Payroll', to: '/payroll', icon: Wallet, roles: ['admin', 'executive', 'finance', 'hr_officer'] },
      { subgroup: 'Pay & time', label: 'Emergency Payroll', to: '/emergency-payroll', icon: Archive, roles: ['admin', 'executive', 'finance', 'hr_officer'] },
      { subgroup: 'Pay & time', label: 'Cash Advances', to: '/cash-advances', icon: DollarSign, roles: ['admin', 'executive', 'finance', 'hr_officer'] },
      { subgroup: 'Pay & time', label: 'Timesheet', to: '/timesheet', icon: Clock, roles: ['admin', 'executive', 'finance', 'hr_officer'] },
      { subgroup: 'Pay & time', label: 'Labour', to: '/labour', icon: HardHat },
      { subgroup: 'Skills', label: 'Competency Hub', to: '/hr/competency-hub', icon: Award, roles: ['admin', 'executive', 'hr_officer'] },
      { subgroup: 'Skills', label: 'Tier 2 Candidates', to: '/hr/tier2-candidates', icon: UserCheck, roles: ['admin', 'executive', 'hr_officer'] },
      { subgroup: 'Skills', label: 'Trade Catalog', to: '/hr/trades', icon: Layers, roles: ['admin', 'executive', 'hr_officer'] },
      { subgroup: 'Safety', label: 'Incidents', to: '/hse-incidents', icon: AlertTriangle },
      { subgroup: 'Safety', label: 'Inductions', to: '/hse-inductions', icon: HardHat },
    ],
  },
  {
    title: 'Admin',
    icon: Settings,
    items: [
      { label: 'Users & Roles', to: '/users', icon: Shield, roles: ['admin'] },
      { label: 'Company & Documents', to: '/settings/company', icon: Building2, roles: ['admin', 'executive', 'finance'] },
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
