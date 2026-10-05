import { useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Bell, CheckCheck, Coffee, Loader2, Settings } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { NotificationItem } from '@/components/notifications/NotificationItem'
import {
  dayLabel, fetchNotificationPage, groupOf, useMarkRead, useUnreadCount, type AppNotification,
} from '@/lib/notifications'

const PAGE = 50

// Everything addressed to you, newest first, by day. Filter to unread, or to
// one group (Expenses, Purchasing…); opening one marks it read.
export default function NotificationsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const unreadOnly = params.get('show') === 'unread'
  const group = params.get('group')
  const { data: unread = 0 } = useUnreadCount()
  const markRead = useMarkRead()

  const q = useInfiniteQuery({
    queryKey: ['notifications-page', user?.id, unreadOnly],
    enabled: !!user,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchNotificationPage(pageParam, unreadOnly, PAGE),
    getNextPageParam: last => (last.length === PAGE ? last[last.length - 1].created_at : undefined),
  })
  const all = useMemo(() => (q.data?.pages ?? []).flat(), [q.data])
  const groups = useMemo(() => [...new Set(all.map(n => groupOf(n.kind)))], [all])
  const shown = group ? all.filter(n => groupOf(n.kind) === group) : all
  const byDay = useMemo(() => {
    const out: { day: string; items: AppNotification[] }[] = []
    for (const n of shown) {
      const day = dayLabel(n.created_at)
      if (out[out.length - 1]?.day !== day) out.push({ day, items: [] })
      out[out.length - 1].items.push(n)
    }
    return out
  }, [shown])

  function set(key: string, value: string | null) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value); else next.delete(key)
    setParams(next, { replace: true })
  }
  function open(n: AppNotification) {
    void markRead.one(n)
    if (n.link) navigate(n.link)
  }

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium transition-colors ${active
      ? 'border-brand bg-brand text-white dark:border-[#D4AF37] dark:bg-[#D4AF37] dark:text-[#1a1100]'
      : 'bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'}`

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Bell className="h-5 w-5 text-slate-400" />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Notifications</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {unread ? `${unread} unread` : 'All read'} · approvals, payments, deliveries and reminders addressed to you
          </p>
        </div>
        {unread > 0 && (
          <button type="button" onClick={() => void markRead.all()}
            className="inline-flex items-center gap-1.5 rounded-lg border bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
            <CheckCheck className="h-4 w-4" /> Mark all read
          </button>
        )}
        <Link to="/settings/notifications"
          className="inline-flex items-center gap-1.5 rounded-lg border bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
          <Settings className="h-4 w-4" /> Settings
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={!unreadOnly} className={chip(!unreadOnly)} onClick={() => set('show', null)}>All</button>
        <button type="button" aria-pressed={unreadOnly} className={chip(unreadOnly)} onClick={() => set('show', 'unread')}>Unread</button>
        {groups.length > 1 && <span className="mx-1 w-px self-stretch bg-slate-200 dark:bg-slate-700" />}
        {groups.length > 1 && groups.map(g => (
          <button key={g} type="button" aria-pressed={group === g} className={chip(group === g)} onClick={() => set('group', group === g ? null : g)}>{g}</button>
        ))}
      </div>

      {q.isLoading ? (
        <div className="space-y-2">{[0, 1, 2, 3].map(i => <div key={i} className="h-16 animate-pulse rounded-xl bg-white/70 dark:bg-slate-800/70" />)}</div>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border bg-white px-6 py-14 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
          <Coffee className="h-7 w-7 text-slate-300" />
          {unreadOnly ? 'Nothing unread — you are caught up.' : 'No notifications yet. They arrive as your requests move and as work is sent to you.'}
        </div>
      ) : (
        byDay.map(({ day, items }) => (
          <section key={day}>
            <h2 className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{day}</h2>
            <div className="divide-y rounded-2xl border bg-white shadow-sm dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800">
              {items.map(n => <NotificationItem key={n.id} n={n} onOpen={open} />)}
            </div>
          </section>
        ))
      )}

      {q.hasNextPage && (
        <div className="flex justify-center">
          <button type="button" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}
            className="inline-flex items-center gap-2 rounded-lg border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
            {q.isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin" />} Show older
          </button>
        </div>
      )}
    </div>
  )
}
