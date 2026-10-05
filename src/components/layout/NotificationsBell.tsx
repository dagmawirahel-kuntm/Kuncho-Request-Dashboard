import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { Bell, CheckCheck, ChevronRight, Coffee, Settings } from 'lucide-react'
import type { NudgeSummary } from '@/lib/siteReports'
import { canSeeTaxImpact, type TaxImpact } from '@/lib/taxImpact'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useMarkRead, useNotificationFeed, useUnreadCount, type AppNotification } from '@/lib/notifications'
import { NotificationItem } from '@/components/notifications/NotificationItem'

// The bell: two tabs.
//   Updates  news addressed to you (migration 424) — unread first in weight,
//            newest on top, arrives live; the red badge counts these.
//   To do    the queues your role works from, as counts. Each count is only
//            asked for by the roles that act on it.

interface TodoItem { label: string; count: number; to: string }
type Tab = 'updates' | 'todo'

const head = { count: 'exact' as const, head: true }

export function NotificationsBell() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('updates')
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { user, role, profile } = useAuth()
  const taxReader = canSeeTaxImpact(role, profile?.is_tax_officer)
  const { data: unread = 0 } = useUnreadCount()
  const { data: feed = [], isLoading } = useNotificationFeed(30)
  const markRead = useMarkRead()

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const r = role ?? ''
  const is = (...roles: string[]) => roles.includes(r)
  const { data: todo = [] } = useQuery({
    queryKey: ['notifications-todo', user?.id, r, taxReader, profile?.is_vrf_manager],
    enabled: !!user,
    refetchInterval: 120_000,
    queryFn: async () => {
      const none = Promise.resolve({ count: 0 })
      const money = is('admin', 'executive', 'finance')
      const [toApprove, toPay, orders, transport, payroll, emergency, overBudget, vrfToConfirm, siteReports, taxImpact] = await Promise.all([
        money ? supabase.from('expenses').select('id', head).eq('is_archived', false).in('approval_status', ['pending', 'manager_approved']) : none,
        money ? supabase.from('expenses').select('id', head).eq('is_archived', false).eq('payment_state', 'approved_to_pay') : none,
        is('admin', 'procurement_officer') ? supabase.from('orders').select('id', head).eq('is_archived', false).eq('status', 'pending') : none,
        is('admin', 'finance', 'logistics_officer') || profile?.is_logistics_officer
          ? supabase.from('transportation_requests').select('id', head).eq('payment_status', false) : none,
        is('admin', 'finance', 'hr_officer') ? supabase.from('payroll').select('id', head).neq('payment_status', 'paid') : none,
        is('admin', 'finance', 'hr_officer') ? supabase.from('emergency_payroll_summary').select('id', head).neq('payment_status', 'paid') : none,
        is('admin', 'executive', 'finance', 'project_manager', 'operations_manager')
          ? supabase.from('v_project_cost_group_budget').select('*', head).eq('over_budget', true) : none,
        money || profile?.is_vrf_manager
          ? supabase.from('expenses').select('id', head).eq('payment_state', 'sent').eq('payment_method', 'vrf') : none,
        // Days behind on sites this person manages or reports from (migration 421).
        supabase.rpc('site_report_nudge_summary'),
        taxReader ? supabase.rpc('tax_impact_items') : Promise.resolve({ data: null }),
      ])
      const sr = ((siteReports as { data: unknown }).data ?? null) as NudgeSummary | null
      const pmDays = (sr?.as_pm ?? []).reduce((n, s) => n + s.dates.length, 0)
      const myDays = (sr?.as_foreman ?? []).reduce((n, s) => n + s.days.length, 0)
      const ti = ((taxImpact as { data: unknown }).data ?? null) as TaxImpact | null
      const tiSeen = new Set(ti?.seen ?? [])
      const tiCount = (ti?.items ?? []).filter(i => (i.escalated && !tiSeen.has(i.id)) || i.overdue).length
      const c = (x: unknown) => (x as { count?: number | null }).count ?? 0
      // Counts, not alerts: "flagged" means visible here, never that someone was told.
      const items: TodoItem[] = [
        { label: 'Daily site reports you owe', count: myDays, to: '/site-foreman/daily-report' },
        { label: 'Daily site reports not in on your sites', count: pmDays, to: '/site-foreman/reports' },
        { label: 'Expenses waiting for approval', count: c(toApprove), to: '/expenses/approvals' },
        { label: 'Approved, waiting to be paid', count: c(toPay), to: '/finance/payments' },
        { label: 'High tax impact: escalated or overdue', count: tiCount, to: '/tax-impact' },
        { label: 'Purchase requests waiting', count: c(orders), to: '/purchase-requests' },
        { label: 'Transport requests to pay', count: c(transport), to: '/transportation' },
        { label: 'Payroll not paid', count: c(payroll), to: '/payroll' },
        { label: 'Emergency payroll not paid', count: c(emergency), to: '/emergency-payroll' },
        { label: 'Cost groups over budget', count: c(overBudget), to: '/projects' },
        { label: 'VRF payments awaiting confirmation', count: c(vrfToConfirm), to: '/finance/payments' },
      ]
      return items.filter(i => i.count > 0)
    },
  })
  const todoTotal = todo.reduce((s, i) => s + i.count, 0)

  function openItem(n: AppNotification) {
    void markRead.one(n)
    setOpen(false)
    if (n.link) navigate(n.link)
  }

  const tabBtn = (t: Tab, label: string, count: number) => (
    <button type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
      className={`relative flex items-center gap-1.5 px-1 pb-2 pt-1 text-sm font-medium transition-colors ${tab === t ? 'text-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}>
      {label}
      {count > 0 && <span className={`rounded-full px-1.5 text-[10px] font-semibold ${t === 'updates' ? 'bg-red-500 text-white' : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>{count > 99 ? '99+' : count}</span>}
      {tab === t && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-brand" />}
    </button>
  )

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        data-motion="swing"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        className="hdr-icon relative flex items-center justify-center rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
      >
        {/* keyed on the count: it swings once whenever new news arrives */}
        <Bell key={unread} className={`h-4.5 w-4.5 ${unread > 0 ? 'bell-ring' : ''}`} />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : todoTotal > 0 && (
          <span title={`${todoTotal} to do`} className="absolute right-1 top-1 h-2 w-2 rounded-full bg-slate-400 ring-2 ring-white dark:ring-slate-800" />
        )}
      </button>
      {open && (
        <div className="animate-fade-in-up fixed inset-x-2 top-14 z-40 flex max-h-[min(36rem,calc(100vh-5rem))] flex-col overflow-hidden rounded-xl border bg-white shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-1.5 sm:w-[24rem] dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-end justify-between gap-2 border-b px-4 pt-2 dark:border-slate-700">
            <div role="tablist" className="flex gap-4">
              {tabBtn('updates', 'Updates', unread)}
              {tabBtn('todo', 'To do', todoTotal)}
            </div>
            {tab === 'updates' && unread > 0 && (
              <button type="button" onClick={() => void markRead.all()}
                className="mb-1.5 flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-700 dark:hover:text-slate-100">
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {tab === 'updates' ? (
              isLoading ? (
                <div className="space-y-2 p-2">{[0, 1, 2].map(i => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-700/50" />)}</div>
              ) : feed.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-slate-400">
                  <Coffee className="h-6 w-6" />
                  Nothing yet. Approvals, payments, deliveries and reminders for you will show up here.
                </div>
              ) : (
                feed.map(n => <NotificationItem key={n.id} n={n} compact onOpen={openItem} />)
              )
            ) : todo.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-slate-400">
                <Coffee className="h-6 w-6" /> Nothing waiting on your desk.
              </div>
            ) : (
              todo.map(item => (
                <button key={item.label} type="button" onClick={() => { navigate(item.to); setOpen(false) }}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700/50">
                  <span className="flex-1 text-slate-700 dark:text-slate-200">{item.label}</span>
                  <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand dark:bg-[#D4AF37]/15 dark:text-[#D4AF37]">{item.count}</span>
                  <ChevronRight className="h-4 w-4 text-slate-300" />
                </button>
              ))
            )}
          </div>

          <div className="flex items-center justify-between border-t px-3 py-2 text-xs dark:border-slate-700">
            <Link to="/notifications" onClick={() => setOpen(false)} className="font-medium text-slate-600 hover:text-slate-900 hover:underline dark:text-slate-300 dark:hover:text-white">See all notifications</Link>
            <Link to="/settings/notifications" onClick={() => setOpen(false)} className="flex items-center gap-1 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100">
              <Settings className="h-3.5 w-3.5" /> Settings
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
