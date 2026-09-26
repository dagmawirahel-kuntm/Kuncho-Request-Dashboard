import {
  BellRing, Briefcase, CalendarCheck, CalendarDays, ClipboardCheck, ClipboardList, Clock, FileText, FolderKanban,
  GitPullRequestArrow, Hammer, Handshake, HardHat, Landmark, Package, PackageCheck, PenTool, Pin, Send, ShoppingCart,
  Truck, Users, UserX, Wallet, Wrench, Banknote, AlertTriangle,
} from 'lucide-react'
import {
  WaitingOnYou, MyRequests, MyProjects, MyWorkOrders, MyLeave, MyPay, MyTools, PinnedPages,
} from '@/components/dashboard/widgets/personal'
import {
  PaymentsToSend, FinanceApprovals, AwaitingBank, CashPosition, BankAlerts, MonthEndStatus,
} from '@/components/dashboard/widgets/finance'
import {
  Portfolio, PoApprovals, Variations, TransportJobs, FleetMaintenance, OpenIncidents, PoPipeline, GrnQueue, LowStock,
  PendingDispatch, LeaveApprovals, UnassignedStaff, SalesPipeline, PaymentRequestsOut, DesignPackages,
} from '@/components/dashboard/widgets/operations'
import type { WidgetContext, WidgetDef } from './types'

const everyone = () => true
const hasStaff = (c: WidgetContext) => !!c.staffId
const role = (...roles: string[]) => (c: WidgetContext) => c.role === 'admin' || (!!c.role && roles.includes(c.role))

// Every widget a dashboard can hold. `available` decides what "Add widget"
// offers a person; row-level security still decides what data they see.
export const WIDGETS: WidgetDef[] = [
  // For you
  { key: 'waiting_on_you', title: 'Waiting on you', description: 'Approvals and queues that need your action, from every module you work in.', icon: BellRing, group: 'For you', defaultSize: 'half', available: everyone, component: WaitingOnYou },
  { key: 'pinned_pages', title: 'Pinned pages', description: 'Shortcuts to the pages you open most.', icon: Pin, group: 'For you', defaultSize: 'half', available: everyone, component: PinnedPages },
  { key: 'my_requests', title: 'My requests', description: 'Your purchase and transport requests still in progress.', icon: ClipboardList, group: 'For you', defaultSize: 'half', available: everyone, component: MyRequests },
  { key: 'my_projects', title: 'My projects', description: 'Projects you manage or are assigned to, with budget warnings.', icon: FolderKanban, group: 'For you', defaultSize: 'half', available: hasStaff, component: MyProjects },
  { key: 'my_work_orders', title: 'My work orders', description: 'Open work orders you lead or are on the crew of.', icon: Hammer, group: 'For you', defaultSize: 'half', available: hasStaff, component: MyWorkOrders },
  { key: 'my_tools', title: 'Tools you hold', description: 'Tools checked out to you, and any overdue.', icon: Wrench, group: 'For you', defaultSize: 'half', available: hasStaff, component: MyTools },
  { key: 'my_leave', title: 'My leave', description: 'Your recent and upcoming leave.', icon: CalendarDays, group: 'For you', defaultSize: 'half', available: hasStaff, component: MyLeave },
  { key: 'my_pay', title: 'My pay', description: 'Your last payroll runs and advances to be deducted.', icon: Wallet, group: 'For you', defaultSize: 'half', available: hasStaff, component: MyPay },

  // Finance
  { key: 'cash_position', title: 'Cash position', description: 'CBE today, what goes out today, the week\'s lowest point, and money waiting in collection banks.', icon: Landmark, group: 'Finance', defaultSize: 'half', available: role('finance', 'executive'), component: CashPosition },
  { key: 'payments_to_send', title: 'Approved, to pay', description: 'Payments approved and waiting to be sent.', icon: Send, group: 'Finance', defaultSize: 'half', available: role('finance'), component: PaymentsToSend },
  { key: 'finance_approvals', title: 'Awaiting finance approval', description: 'Expenses waiting for a finance sign-off.', icon: Clock, group: 'Finance', defaultSize: 'half', available: role('finance'), component: FinanceApprovals },
  { key: 'awaiting_bank', title: 'Sent, not on the bank yet', description: 'Payments sent that no statement line confirms yet.', icon: Banknote, group: 'Finance', defaultSize: 'half', available: role('finance'), component: AwaitingBank },
  { key: 'bank_alerts', title: 'Bank & cash alerts', description: 'Money waiting to move, stale statements, possible double payments, and more.', icon: AlertTriangle, group: 'Finance', defaultSize: 'half', available: role('finance'), component: BankAlerts },
  { key: 'month_end', title: 'Month-end', description: 'How far last month\'s close has got.', icon: CalendarCheck, group: 'Finance', defaultSize: 'half', available: role('finance'), component: MonthEndStatus },

  // Projects & operations
  { key: 'portfolio', title: 'Projects at risk', description: 'Projects over budget or not in good health.', icon: Briefcase, group: 'Projects & operations', defaultSize: 'half', available: role('executive', 'operations_manager', 'finance'), component: Portfolio },
  { key: 'po_approvals', title: 'Purchase orders to approve', description: 'Purchase orders submitted for approval.', icon: ShoppingCart, group: 'Projects & operations', defaultSize: 'half', available: role('executive', 'operations_manager'), component: PoApprovals },
  { key: 'variations', title: 'Budget variations', description: 'Budget variation requests waiting for sign-off.', icon: GitPullRequestArrow, group: 'Projects & operations', defaultSize: 'half', available: role('executive', 'operations_manager'), component: Variations },
  { key: 'transport_jobs', title: 'Open transport jobs', description: 'Transport jobs requested, assigned or on the road.', icon: Truck, group: 'Projects & operations', defaultSize: 'half', available: c => role('logistics_officer', 'operations_manager')(c) || c.isLogisticsOfficer, component: TransportJobs },
  { key: 'fleet_maintenance', title: 'Vehicle maintenance', description: 'Maintenance requests not done yet.', icon: Wrench, group: 'Projects & operations', defaultSize: 'half', available: c => role('logistics_officer', 'operations_manager')(c) || c.isLogisticsOfficer, component: FleetMaintenance },
  { key: 'open_incidents', title: 'Open HSE incidents', description: 'Incidents not closed yet.', icon: HardHat, group: 'Projects & operations', defaultSize: 'half', available: role('hse_officer', 'operations_manager', 'executive'), component: OpenIncidents },

  // Procurement & stock
  { key: 'po_pipeline', title: 'Purchase order pipeline', description: 'Purchase orders by stage, with their value.', icon: ClipboardCheck, group: 'Procurement & stock', defaultSize: 'half', available: role('procurement_officer', 'operations_manager', 'executive', 'finance'), component: PoPipeline },
  { key: 'grn_queue', title: 'Orders to receive', description: 'Ordered goods not received yet, and late deliveries.', icon: PackageCheck, group: 'Procurement & stock', defaultSize: 'half', available: role('procurement_officer', 'stock_manager', 'operations_manager'), component: GrnQueue },
  { key: 'low_stock', title: 'Low stock', description: 'Items at or below their reorder level.', icon: Package, group: 'Procurement & stock', defaultSize: 'half', available: role('procurement_officer', 'stock_manager', 'operations_manager'), component: LowStock },
  { key: 'pending_dispatch', title: 'To dispatch from stock', description: 'Requested items waiting to go out of the store.', icon: AlertTriangle, group: 'Procurement & stock', defaultSize: 'half', available: role('stock_manager', 'operations_manager'), component: PendingDispatch },

  // People
  { key: 'leave_approvals', title: 'Leave requests pending', description: 'Every leave request waiting for a decision.', icon: Users, group: 'People', defaultSize: 'half', available: role('hr_officer', 'executive'), component: LeaveApprovals },
  { key: 'unassigned_staff', title: 'Staff with no department', description: 'Active staff not placed in a department.', icon: UserX, group: 'People', defaultSize: 'half', available: role('hr_officer'), component: UnassignedStaff },

  // Sales & design
  { key: 'sales_pipeline', title: 'Open opportunities', description: 'Leads, qualified and quoted opportunities.', icon: Handshake, group: 'Sales & design', defaultSize: 'half', available: role('sales', 'executive'), component: SalesPipeline },
  { key: 'payment_requests_out', title: 'Client payment requests out', description: 'Payment requests issued to clients and not invoiced yet.', icon: FileText, group: 'Sales & design', defaultSize: 'half', available: role('sales', 'finance', 'executive'), component: PaymentRequestsOut },
  { key: 'design_packages', title: 'Open design packages', description: 'Design packages in progress or with the client.', icon: PenTool, group: 'Sales & design', defaultSize: 'half', available: role('design', 'executive', 'operations_manager'), component: DesignPackages },
]

export const WIDGET_BY_KEY = new Map(WIDGETS.map(w => [w.key, w]))
