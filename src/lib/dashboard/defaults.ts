import type { LayoutItem, WidgetContext, WidgetSize } from './types'

// What a person's dashboard shows until they change it: the things that
// wait on them first, then their role's queues, then their own records.

const W = (key: string, size: WidgetSize = 'half'): LayoutItem => ({ key, size })

export function defaultLayout(ctx: WidgetContext): LayoutItem[] {
  const out: LayoutItem[] = [W('waiting_on_you'), W('pinned_pages')]
  const add = (...items: LayoutItem[]) => { for (const i of items) if (!out.some(o => o.key === i.key)) out.push(i) }

  switch (ctx.role) {
    case 'admin':
      add(W('cash_position'), W('bank_alerts'), W('portfolio'), W('po_approvals'), W('payments_to_send'), W('leave_approvals'))
      break
    case 'executive':
      add(W('cash_position'), W('portfolio'), W('sales_pipeline'), W('po_approvals'), W('payment_requests_out'))
      break
    case 'finance':
      add(W('cash_position'), W('payments_to_send'), W('finance_approvals'), W('awaiting_bank'), W('bank_alerts'), W('month_end'))
      break
    case 'operations_manager':
      add(W('po_approvals'), W('variations'), W('portfolio'), W('fleet_maintenance'), W('transport_jobs'))
      break
    case 'procurement_officer':
      add(W('po_pipeline'), W('grn_queue'), W('low_stock'))
      break
    case 'stock_manager':
      add(W('grn_queue'), W('pending_dispatch'), W('low_stock'), W('my_tools'))
      break
    case 'logistics_officer':
      add(W('transport_jobs'), W('fleet_maintenance'))
      break
    case 'hr_officer':
      add(W('leave_approvals'), W('unassigned_staff'))
      break
    case 'hse_officer':
      add(W('open_incidents'))
      break
    case 'design':
      add(W('design_packages'))
      break
    case 'sales':
      add(W('sales_pipeline'), W('payment_requests_out'))
      break
  }
  if (ctx.isLogisticsOfficer) add(W('transport_jobs'))
  // Assignments, whatever the login role.
  if (ctx.managesProjects || ctx.isSiteForeman || ctx.role === 'project_manager') add(W('my_projects'), W('my_work_orders'))
  // Everyone's own records last; tools and work orders for people in the
  // field, pay for staff logins (office roles can add them).
  add(W('my_requests'))
  const field = !ctx.role || ['staff', 'project_manager', 'stock_manager', 'logistics_officer'].includes(ctx.role) || ctx.isSiteForeman
  if (field) add(W('my_work_orders'), W('my_tools'))
  add(W('my_leave'))
  if (!ctx.role || ctx.role === 'staff') add(W('my_pay'))
  return out
}

export function defaultPins(ctx: WidgetContext): string[] {
  const r = ctx.role
  if (r === 'finance') return ['/finance/payments', '/bank-statement-import', '/cash-forecast', '/accounts', '/month-end']
  if (r === 'procurement_officer') return ['/sourcing', '/procurement', '/vendors', '/goods-received']
  if (r === 'stock_manager') return ['/stock', '/goods-received', '/stock/dispatch-queue', '/stock/tools']
  if (r === 'hr_officer') return ['/staff', '/leave-requests', '/payroll', '/hr/casual-workers']
  if (r === 'logistics_officer') return ['/transportation', '/fleet/maintenance', '/logistics']
  if (r === 'sales') return ['/opportunities', '/clients', '/proformas', '/contracts']
  if (r === 'design') return ['/design', '/projects']
  if (r === 'hse_officer') return ['/hse-incidents', '/hse-inductions']
  if (r === 'admin' || r === 'executive') return ['/exec', '/projects', '/finance/payments', '/accounts', '/staff']
  if (ctx.managesProjects || r === 'project_manager') return ['/pm-view', '/projects', '/purchase-requests/new', '/work-orders']
  return ['/purchase-requests/new', '/transportation/new', '/my-leave', '/calendar']
}
