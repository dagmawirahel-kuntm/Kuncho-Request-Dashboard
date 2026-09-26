import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Pin, Plus, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { navGroups, useNavItemVisible, type NavItem } from '@/components/layout/navConfig'
import type { WidgetContext, WidgetProps } from '@/lib/dashboard/types'
import { defaultPins } from '@/lib/dashboard/defaults'
import { QueryListWidget, RowList, WidgetCard, type ListRow } from '../WidgetCard'
import { BellRing, ClipboardList, FolderKanban, Hammer, CalendarDays, Wallet, Wrench } from 'lucide-react'

const is = (ctx: WidgetContext, ...roles: string[]) => ctx.role === 'admin' || (!!ctx.role && roles.includes(ctx.role))

async function count(q: PromiseLike<{ count: number | null; error: { message: string } | null }>) {
  const { count: n, error } = await q
  if (error) return 0 // a source this person can't read counts as nothing waiting
  return n ?? 0
}

// ── Waiting on you ────────────────────────────────────────────────────────
// Everything that needs this person's decision or action, from every
// module they work in, as one list of counts.
export function WaitingOnYou({ ctx }: WidgetProps) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['dash', 'waiting', ctx.userId, ctx.role, ctx.staffId, ctx.managesProjects],
    staleTime: 60_000,
    queryFn: async () => {
      const out: ListRow[] = []
      const add = (id: string, n: number, title: string, to: string) => { if (n > 0) out.push({ id, title, right: String(n), to }) }
      const head = { count: 'exact' as const, head: true }

      add('leave-mine', await count(supabase.from('leave_requests').select('id', head).eq('assigned_approver_id', ctx.userId).eq('status', 'pending')),
        'Leave requests to approve', '/leave-requests')
      if (is(ctx, 'finance')) {
        add('fin-approve', await count(supabase.from('v_finance_pending_approval').select('id', head)), 'Expenses awaiting finance approval', '/finance/payments')
        add('fin-pay', await count(supabase.from('v_to_pay_queue').select('id', head)), 'Approved payments to send', '/finance/payments')
        add('fin-bank', await count(supabase.from('v_bank_line_status').select('line_id', head).is('reconciled_as', null)), 'Bank lines to reconcile', '/bank-statement-import')
      }
      if (is(ctx, 'operations_manager', 'executive')) {
        add('po-approve', await count(supabase.from('sourcing_bundles').select('id', head).eq('status', 'submitted')), 'Purchase orders to approve', '/ops-manager-view')
      }
      if (ctx.managesProjects && ctx.staffId) {
        const { data: projects } = await supabase.from('projects').select('id').eq('project_manager_id', ctx.staffId)
        const ids = (projects ?? []).map(p => p.id)
        if (ids.length) {
          add('pm-prs', await count(supabase.from('orders').select('id', head).in('project_id', ids).eq('approval_status', 'pending').eq('is_archived', false)),
            'Purchase requests on your projects', '/purchase-requests')
          add('pm-deliveries', await count(supabase.from('v_stock_delivery_confirmations').select('stock_issue_id', head).in('project_id', ids).eq('is_confirmed', false)),
            'Deliveries to confirm on site', '/pm-view')
        }
      }
      if (is(ctx, 'hr_officer')) {
        add('hr-leave', await count(supabase.from('leave_requests').select('id', head).eq('status', 'pending')), 'Leave requests pending (all)', '/leave-requests')
        add('hr-unassigned', await count(supabase.from('staff').select('id', head).is('department_id', null)), 'Staff with no department', '/staff')
      }
      if (is(ctx, 'stock_manager')) {
        add('stock-grn', await count(supabase.from('sourcing_bundles').select('id', head).eq('status', 'ordered')), 'Orders to receive (GRN)', '/goods-received')
        add('stock-returns', await count(supabase.from('stock_return_requests').select('id', head).eq('status', 'pending')), 'Returns to confirm', '/stock-manager-view')
      }
      if (is(ctx, 'logistics_officer') || ctx.isLogisticsOfficer) {
        add('log-jobs', await count(supabase.from('transportation_requests').select('id', head).eq('job_status', 'requested')), 'Transport jobs to assign', '/logistics-view')
      }
      if (is(ctx, 'procurement_officer')) {
        add('proc-draft', await count(supabase.from('sourcing_bundles').select('id', head).eq('status', 'drafting')), 'Purchase orders being drafted', '/sourcing')
      }
      return out
    },
  })
  return (
    <WidgetCard title="Waiting on you" icon={BellRing} count={rows.reduce((s, r) => s + Number(r.right ?? 0), 0)}>
      {isLoading ? <p className="px-4 py-6 text-center text-sm text-slate-400">Loading…</p>
        : <RowList rows={rows} empty="Nothing is waiting on you." />}
    </WidgetCard>
  )
}

// ── My requests ───────────────────────────────────────────────────────────
const APPROVAL_TONE: Record<string, 'amber' | 'green' | 'red' | 'slate'> = { pending: 'amber', manager_approved: 'amber', finance_approved: 'green', rejected: 'red' }

export function MyRequests({ ctx }: WidgetProps) {
  return (
    <QueryListWidget
      title="My requests" icon={ClipboardList} to="/requests" queryKey={['my-requests', ctx.userId]}
      empty="You have no open requests."
      fetch={async () => {
        const [orders, transport] = await Promise.all([
          supabase.from('orders').select('id, request_code, order_name, item_service_description, approval_status, status, order_date')
            .eq('requested_by_user_id', ctx.userId).eq('is_archived', false).order('order_date', { ascending: false }).limit(8),
          supabase.from('transportation_requests').select('id, request_name, job_status, requested_date')
            .eq('requested_by_id', ctx.userId).in('job_status', ['requested', 'assigned', 'in_progress']).order('requested_date', { ascending: false }).limit(5),
        ])
        const rows: (ListRow & { date: string })[] = []
        for (const o of orders.data ?? []) {
          if (o.approval_status === 'finance_approved' && ['fulfilled', 'completed', 'delivered'].includes(String(o.status ?? '').toLowerCase())) continue
          rows.push({
            id: `o-${o.id}`, date: o.order_date ?? '', title: o.order_name || o.item_service_description || o.request_code || 'Purchase request',
            subtitle: `Purchase request${o.request_code ? ` · ${o.request_code}` : ''} · ${formatDate(o.order_date)}`,
            badge: { text: String(o.approval_status ?? '').replace(/_/g, ' '), tone: APPROVAL_TONE[o.approval_status ?? ''] ?? 'slate' },
            to: `/purchase-requests/${o.id}`,
          })
        }
        for (const t of transport.data ?? []) {
          rows.push({
            id: `t-${t.id}`, date: t.requested_date ?? '', title: t.request_name || 'Transport request',
            subtitle: `Transport · ${formatDate(t.requested_date)}`, badge: { text: String(t.job_status).replace(/_/g, ' '), tone: 'amber' },
            to: `/transportation/${t.id}/edit`,
          })
        }
        rows.sort((a, b) => b.date.localeCompare(a.date))
        return { rows: rows.slice(0, 8), total: rows.length }
      }}
    />
  )
}

// ── My projects ───────────────────────────────────────────────────────────
export function MyProjects({ ctx }: WidgetProps) {
  return (
    <QueryListWidget
      title="My projects" icon={FolderKanban} to="/pm-view" queryKey={['my-projects', ctx.staffId]} enabled={!!ctx.staffId}
      empty="You are not on any project."
      fetch={async () => {
        const [managed, assigned] = await Promise.all([
          supabase.from('projects').select('id, project_name, stage, physical_progress, health').eq('project_manager_id', ctx.staffId!),
          supabase.from('staff_assignments').select('role, projects(id, project_name, stage, physical_progress, health)').eq('staff_id', ctx.staffId!).eq('active', true).not('project_id', 'is', null),
        ])
        type P = { id: string; project_name: string; stage: string | null; physical_progress: number | null; health: string | null }
        const byId = new Map<string, { p: P; how: string }>()
        for (const p of (managed.data ?? []) as P[]) byId.set(p.id, { p, how: 'Project manager' })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const a of (assigned.data ?? []) as any[]) if (a.projects && !byId.has(a.projects.id)) byId.set(a.projects.id, { p: a.projects, how: a.role ?? 'Assigned' })
        const ids = [...byId.keys()]
        const { data: budgets } = ids.length
          ? await supabase.from('v_project_budget_summary').select('project_id, any_group_over_budget, projected_margin_core').in('project_id', ids)
          : { data: [] }
        const b = new Map((budgets ?? []).map(x => [x.project_id, x]))
        const rows: ListRow[] = [...byId.values()].map(({ p, how }) => {
          const over = b.get(p.id)?.any_group_over_budget
          return {
            id: p.id, title: p.project_name,
            subtitle: [how, p.stage, p.physical_progress != null ? `${Math.round(Number(p.physical_progress))}% done` : null].filter(Boolean).join(' · '),
            badge: over ? { text: 'over budget', tone: 'red' } : p.health && p.health !== 'green' ? { text: p.health, tone: 'amber' } : null,
            to: `/projects/${p.id}`,
          }
        })
        return { rows }
      }}
    />
  )
}

// ── My work orders ────────────────────────────────────────────────────────
export function MyWorkOrders({ ctx }: WidgetProps) {
  return (
    <QueryListWidget
      title="My work orders" icon={Hammer} to="/work-orders" queryKey={['my-wos', ctx.staffId]} enabled={!!ctx.staffId}
      empty="No open work orders for you."
      fetch={async () => {
        const [lead, crew] = await Promise.all([
          supabase.from('work_orders').select('id, scope_of_work, status, target_completion_date, current_progress_pct, projects(project_name)')
            .eq('assigned_lead_staff_id', ctx.staffId!).not('status', 'in', '(completed,cancelled)'),
          supabase.from('work_order_crew').select('role_on_wo, work_orders(id, scope_of_work, status, target_completion_date, current_progress_pct, projects(project_name))')
            .eq('staff_id', ctx.staffId!).is('removed_at', null),
        ])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const all = new Map<string, { w: any; how: string }>()
        for (const w of lead.data ?? []) all.set(w.id, { w, how: 'Lead' })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const c of (crew.data ?? []) as any[]) {
          const w = c.work_orders
          if (w && !all.has(w.id) && !['completed', 'cancelled'].includes(w.status)) all.set(w.id, { w, how: c.role_on_wo ?? 'Crew' })
        }
        const rows: ListRow[] = [...all.values()].map(({ w, how }) => {
          const late = w.target_completion_date && w.target_completion_date < new Date().toISOString().slice(0, 10)
          return {
            id: w.id, title: w.scope_of_work || 'Work order',
            subtitle: [how, w.projects?.project_name, w.target_completion_date ? `due ${formatDate(w.target_completion_date)}` : null].filter(Boolean).join(' · '),
            badge: late ? { text: 'late', tone: 'red' } : { text: String(w.status).replace(/_/g, ' '), tone: 'slate' },
            right: w.current_progress_pct != null ? `${Math.round(Number(w.current_progress_pct))}%` : null,
            to: `/work-orders/${w.id}`,
          }
        })
        return { rows }
      }}
    />
  )
}

// ── My leave ──────────────────────────────────────────────────────────────
export function MyLeave({ ctx }: WidgetProps) {
  return (
    <QueryListWidget
      title="My leave" icon={CalendarDays} to="/my-leave" queryKey={['my-leave', ctx.staffId]} enabled={!!ctx.staffId}
      empty="No leave requested."
      fetch={async () => {
        const { data, error } = await supabase.from('leave_requests').select('id, leave_type, start_date, end_date, days, status')
          .eq('staff_id', ctx.staffId!).order('start_date', { ascending: false }).limit(5)
        if (error) throw error
        return {
          rows: (data ?? []).map(l => ({
            id: l.id, title: `${String(l.leave_type ?? 'Leave').replace(/_/g, ' ')} · ${l.days ?? '?'} day${l.days === 1 ? '' : 's'}`,
            subtitle: `${formatDate(l.start_date)} – ${formatDate(l.end_date)}`,
            badge: { text: l.status, tone: l.status === 'approved' ? 'green' as const : l.status === 'rejected' ? 'red' as const : 'amber' as const },
          })),
        }
      }}
    />
  )
}

// ── My pay ────────────────────────────────────────────────────────────────
export function MyPay({ ctx }: WidgetProps) {
  return (
    <QueryListWidget
      title="My pay" icon={Wallet} to="/my-home" queryKey={['my-pay', ctx.staffId]} enabled={!!ctx.staffId}
      empty="No pay recorded yet."
      fetch={async () => {
        const [pay, adv] = await Promise.all([
          supabase.from('payroll_staff').select('net_amount, payroll(id, payroll_record, pay_period, end_date, payment_status)').eq('staff_id', ctx.staffId!),
          supabase.from('cash_advances').select('id, advance_id_code, amount_advanced, date_given, payroll_id').eq('staff_id', ctx.staffId!).eq('is_archived', false).is('payroll_id', null),
        ])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const runs = ((pay.data ?? []) as any[]).filter(r => r.payroll).sort((a, b) => String(b.payroll.end_date).localeCompare(String(a.payroll.end_date))).slice(0, 3)
        const rows: ListRow[] = runs.map(r => ({
          id: `p-${r.payroll.id}`, title: r.payroll.pay_period || r.payroll.payroll_record || 'Payroll',
          subtitle: `Paid run ending ${formatDate(r.payroll.end_date)}`,
          badge: { text: r.payroll.payment_status ?? '', tone: r.payroll.payment_status === 'paid' ? 'green' : 'amber' },
          right: formatCurrency(Number(r.net_amount ?? 0)),
        }))
        for (const a of adv.data ?? []) {
          rows.push({ id: `a-${a.id}`, title: 'Advance to be deducted', subtitle: `${a.advance_id_code ?? ''} · ${formatDate(a.date_given)}`, right: formatCurrency(Number(a.amount_advanced ?? 0)), badge: { text: 'open', tone: 'amber' } })
        }
        return { rows }
      }}
    />
  )
}

// ── Tools I hold ──────────────────────────────────────────────────────────
export function MyTools({ ctx }: WidgetProps) {
  return (
    <QueryListWidget
      title="Tools you hold" icon={Wrench} to="/stock/tools" queryKey={['my-tools', ctx.staffId]} enabled={!!ctx.staffId}
      empty="You have no tools checked out."
      fetch={async () => {
        const { data, error } = await supabase.from('tool_checkouts')
          .select('id, issue_date, expected_return_date, projects(project_name), tool_units(asset_code, stock_items(item_name))')
          .eq('issued_to_staff_id', ctx.staffId!).eq('returned', false).order('issue_date')
        if (error) throw error
        const today = new Date().toISOString().slice(0, 10)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { rows: ((data ?? []) as any[]).map(t => ({
          id: t.id, title: t.tool_units?.stock_items?.item_name ?? t.tool_units?.asset_code ?? 'Tool',
          subtitle: [t.tool_units?.asset_code, t.projects?.project_name, `since ${formatDate(t.issue_date)}`].filter(Boolean).join(' · '),
          badge: t.expected_return_date && t.expected_return_date < today ? { text: 'overdue', tone: 'red' as const } : null,
        })) }
      }}
    />
  )
}

// ── Pinned pages ──────────────────────────────────────────────────────────
// Shortcuts the person picks from the pages they can open, plus a few
// "new …" actions. Defaults follow the role until they change it.
const CREATE_ACTIONS: NavItem[] = [
  { label: 'New purchase request', to: '/purchase-requests/new', icon: Plus },
  { label: 'Request transport', to: '/transportation/new', icon: Plus },
  { label: 'Request leave', to: '/my-leave', icon: Plus },
]

export function PinnedPages({ ctx, item, onItemChange }: WidgetProps) {
  const isVisible = useNavItemVisible()
  const [picking, setPicking] = useState(false)
  const all = useMemo(() => {
    const m = new Map<string, NavItem & { group: string }>()
    for (const a of CREATE_ACTIONS) m.set(a.to, { ...a, group: 'Create' })
    for (const g of navGroups) for (const i of g.items) if (isVisible(i) && !m.has(i.to)) m.set(i.to, { ...i, group: g.title })
    return m
  }, [isVisible])
  const pins = (item.pages ?? defaultPins(ctx)).filter(p => all.has(p))

  function toggle(path: string) {
    const next = pins.includes(path) ? pins.filter(p => p !== path) : [...pins, path]
    onItemChange({ ...item, pages: next })
  }

  return (
    <WidgetCard title="Pinned pages" icon={Pin} action={
      <button onClick={() => setPicking(v => !v)} className="text-xs font-medium text-brand hover:underline">{picking ? 'Done' : 'Edit'}</button>
    }>
      {picking ? (
        <div className="max-h-80 space-y-2 overflow-y-auto p-3">
          {[...new Set([...all.values()].map(i => i.group))].map(group => (
            <div key={group}>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{group}</p>
              <div className="flex flex-wrap gap-1.5">
                {[...all.values()].filter(i => i.group === group).map(i => {
                  const on = pins.includes(i.to)
                  return (
                    <button key={i.to} onClick={() => toggle(i.to)}
                      className={`rounded-full border px-2.5 py-1 text-xs ${on ? 'border-brand bg-brand/10 text-brand' : 'text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700'}`}>
                      {i.label}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      ) : pins.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-slate-400">Pin the pages you open most — press Edit.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3">
          {pins.map(p => {
            const i = all.get(p)!
            return (
              <div key={p} className="group relative">
                <Link to={p} className="flex h-full items-center gap-2 rounded-lg border px-3 py-2.5 text-sm text-slate-700 hover:border-brand hover:text-brand dark:border-slate-600 dark:text-slate-200">
                  <i.icon className="h-4 w-4 shrink-0" /> <span className="truncate">{i.label}</span>
                </Link>
                <button onClick={() => toggle(p)} title="Unpin"
                  className="absolute -right-1.5 -top-1.5 hidden rounded-full bg-slate-200 p-0.5 text-slate-500 group-hover:block dark:bg-slate-600 dark:text-slate-200">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </WidgetCard>
  )
}
