import type { ElementType } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Banknote, CalendarClock, ClipboardList, Clock, FilePen, PackageCheck, Send, ShoppingCart, Truck, Undo2, Users, UserX,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { WidgetContext } from './types'

export type WaitingTone = 'amber' | 'red' | 'blue' | 'emerald' | 'violet' | 'slate'

/** One queue that needs this person: how many are in it and where to act. */
export interface WaitingItem {
  id: string
  title: string
  n: number
  to: string
  icon: ElementType
  tone: WaitingTone
}

const is = (ctx: WidgetContext, ...roles: string[]) => ctx.role === 'admin' || (!!ctx.role && roles.includes(ctx.role))

async function count(q: PromiseLike<{ count: number | null; error: { message: string } | null }>) {
  const { count: n, error } = await q
  if (error) return 0 // a source this person can't read counts as nothing waiting
  return n ?? 0
}

/**
 * Everything that needs this person's decision or action, from every module
 * they work in, as counts. Shared by the dashboard's header, its focus tiles
 * and the "Needs you now" widget — one query, one cache entry.
 */
export function useWaitingOn(ctx: WidgetContext | null) {
  const query = useQuery({
    queryKey: ['dash', 'waiting', ctx?.userId, ctx?.role, ctx?.staffId, ctx?.managesProjects, ctx?.isLogisticsOfficer],
    enabled: !!ctx,
    staleTime: 60_000,
    queryFn: async () => {
      const c = ctx!
      const out: WaitingItem[] = []
      const add = (item: Omit<WaitingItem, 'n'>, n: number) => { if (n > 0) out.push({ ...item, n }) }
      const head = { count: 'exact' as const, head: true }

      add({ id: 'leave-mine', title: 'Leave requests to approve', to: '/leave-requests', icon: CalendarClock, tone: 'violet' },
        await count(supabase.from('leave_requests').select('id', head).eq('assigned_approver_id', c.userId).eq('status', 'pending')))
      if (is(c, 'finance')) {
        add({ id: 'fin-approve', title: 'Expenses awaiting finance approval', to: '/finance/payments', icon: Clock, tone: 'amber' },
          await count(supabase.from('v_finance_pending_approval').select('id', head)))
        add({ id: 'fin-pay', title: 'Approved payments to send', to: '/finance/payments', icon: Send, tone: 'red' },
          await count(supabase.from('v_to_pay_queue').select('id', head)))
        add({ id: 'fin-bank', title: 'Bank lines to reconcile', to: '/bank-statement-import', icon: Banknote, tone: 'blue' },
          await count(supabase.from('v_bank_line_status').select('line_id', head).is('reconciled_as', null)))
      }
      if (is(c, 'operations_manager', 'executive')) {
        add({ id: 'po-approve', title: 'Purchase orders to approve', to: '/ops-manager-view', icon: ShoppingCart, tone: 'amber' },
          await count(supabase.from('sourcing_bundles').select('id', head).eq('status', 'submitted')))
      }
      if (c.managesProjects && c.staffId) {
        const { data: projects } = await supabase.from('projects').select('id').eq('project_manager_id', c.staffId)
        const ids = (projects ?? []).map(p => p.id)
        if (ids.length) {
          add({ id: 'pm-prs', title: 'Purchase requests on your projects', to: '/purchase-requests', icon: ClipboardList, tone: 'amber' },
            await count(supabase.from('orders').select('id', head).in('project_id', ids).eq('approval_status', 'pending').eq('is_archived', false)))
          add({ id: 'pm-deliveries', title: 'Deliveries to confirm on site', to: '/pm-view', icon: PackageCheck, tone: 'emerald' },
            await count(supabase.from('v_stock_delivery_confirmations').select('stock_issue_id', head).in('project_id', ids).eq('is_confirmed', false)))
        }
      }
      if (is(c, 'hr_officer')) {
        add({ id: 'hr-leave', title: 'Leave requests pending (all)', to: '/leave-requests', icon: Users, tone: 'violet' },
          await count(supabase.from('leave_requests').select('id', head).eq('status', 'pending')))
        add({ id: 'hr-unassigned', title: 'Staff with no department', to: '/staff', icon: UserX, tone: 'slate' },
          await count(supabase.from('staff').select('id', head).is('department_id', null)))
      }
      if (is(c, 'stock_manager')) {
        add({ id: 'stock-grn', title: 'Orders to receive (GRN)', to: '/goods-received', icon: PackageCheck, tone: 'emerald' },
          await count(supabase.from('sourcing_bundles').select('id', head).eq('status', 'ordered')))
        add({ id: 'stock-returns', title: 'Returns to confirm', to: '/stock-manager-view', icon: Undo2, tone: 'amber' },
          await count(supabase.from('stock_return_requests').select('id', head).eq('status', 'pending')))
      }
      if (is(c, 'logistics_officer') || c.isLogisticsOfficer) {
        add({ id: 'log-jobs', title: 'Transport jobs to assign', to: '/logistics-view', icon: Truck, tone: 'blue' },
          await count(supabase.from('transportation_requests').select('id', head).eq('job_status', 'requested')))
      }
      if (is(c, 'procurement_officer')) {
        add({ id: 'proc-draft', title: 'Purchase orders being drafted', to: '/sourcing', icon: FilePen, tone: 'slate' },
          await count(supabase.from('sourcing_bundles').select('id', head).eq('status', 'drafting')))
      }
      return out
    },
  })
  const items = query.data ?? []
  return {
    items,
    total: items.reduce((s, i) => s + i.n, 0),
    isLoading: query.isLoading,
    error: query.error as Error | null,
  }
}

/** Tailwind classes for each tone: a soft chip, a strong accent and a bar. */
export const TONE_CLASSES: Record<WaitingTone, { chip: string; text: string; bar: string }> = {
  amber:   { chip: 'bg-amber-50 text-amber-600 dark:bg-amber-900/25 dark:text-amber-300', text: 'text-amber-600 dark:text-amber-300', bar: 'bg-amber-400' },
  red:     { chip: 'bg-red-50 text-red-600 dark:bg-red-900/25 dark:text-red-300', text: 'text-red-600 dark:text-red-300', bar: 'bg-red-500' },
  blue:    { chip: 'bg-blue-50 text-blue-600 dark:bg-blue-900/25 dark:text-blue-300', text: 'text-blue-600 dark:text-blue-300', bar: 'bg-blue-500' },
  emerald: { chip: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/25 dark:text-emerald-300', text: 'text-emerald-600 dark:text-emerald-300', bar: 'bg-emerald-500' },
  violet:  { chip: 'bg-violet-50 text-violet-600 dark:bg-violet-900/25 dark:text-violet-300', text: 'text-violet-600 dark:text-violet-300', bar: 'bg-violet-500' },
  slate:   { chip: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300', text: 'text-slate-600 dark:text-slate-300', bar: 'bg-slate-400' },
}
