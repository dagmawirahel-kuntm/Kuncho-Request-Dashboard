import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { buzz, chime, confetti } from '@/lib/celebrate'
import { FEED_KEY, UNREAD_KEY, lookOf, useMarkRead, type AppNotification } from '@/lib/notifications'
import { NotificationItem } from './NotificationItem'

// Listens for this person's new notifications over Supabase Realtime (RLS
// keeps the stream to their own rows) and shows each as a card in the top
// right for a few seconds — hover holds it, a click opens the record.
// Replaces MyExpenseWatcher: the database now says what changed, so the
// "your expense was paid" confetti rides on the real event.

const SHOW_MS = 7000
// Data a notification makes stale, so the screen behind it catches up too.
const STALE_BY_PREFIX: Record<string, string[][]> = {
  expense: [['expenses'], ['expense'], ['my-expense-watch'], ['expense-approval-queue']],
  po: [['sourcing-bundles'], ['sourcing-bundle']],
  delivery: [['sourcing-bundles'], ['sourcing-bundle']],
  request: [['orders'], ['purchase-requests']],
  tax: [['tax-impact']],
}

function celebrate(n: AppNotification) {
  if (n.kind === 'expense.paid') { void confetti('burst'); chime('fanfare'); return }
  if (/\.(approved|decided)$/.test(n.kind) && !/rejected/i.test(n.title)) { chime('success'); return }
  if (n.priority === 'high') { buzz([40, 60, 40]); chime('stamp'); return }
  chime('tap')
}

export function NotificationsLive() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const markRead = useMarkRead()
  const [pops, setPops] = useState<AppNotification[]>([])
  // Per card: its timeout and how long it has left (hover pauses both the
  // timeout and the bar along the bottom, so they stay in step).
  const timers = useRef(new Map<string, { t: number; due: number; left: number }>())

  const dismiss = useCallback((id: string) => {
    window.clearTimeout(timers.current.get(id)?.t)
    timers.current.delete(id)
    setPops(p => p.filter(x => x.id !== id))
  }, [])
  const schedule = useCallback((id: string, ms = SHOW_MS) => {
    window.clearTimeout(timers.current.get(id)?.t)
    timers.current.set(id, { t: window.setTimeout(() => dismiss(id), ms), due: Date.now() + ms, left: ms })
  }, [dismiss])
  const hold = useCallback((id: string) => {
    const x = timers.current.get(id)
    if (!x) return
    window.clearTimeout(x.t)
    timers.current.set(id, { ...x, left: Math.max(800, x.due - Date.now()) })
  }, [])
  const resume = useCallback((id: string) => schedule(id, timers.current.get(id)?.left ?? SHOW_MS), [schedule])

  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        payload => {
          const n = payload.new as AppNotification
          qc.setQueriesData<AppNotification[]>({ queryKey: [FEED_KEY] }, list => (list ? [n, ...list.filter(x => x.id !== n.id)] : list))
          qc.setQueriesData<number>({ queryKey: [UNREAD_KEY] }, c => (typeof c === 'number' ? c + 1 : c))
          qc.invalidateQueries({ queryKey: ['notifications-page'] })
          for (const key of STALE_BY_PREFIX[n.kind.split('.')[0]] ?? []) qc.invalidateQueries({ queryKey: key })
          setPops(p => [n, ...p.filter(x => x.id !== n.id)].slice(0, 3))
          schedule(n.id)
          celebrate(n)
        })
      .subscribe()
    const live = timers.current
    return () => {
      void supabase.removeChannel(channel)
      for (const x of live.values()) window.clearTimeout(x.t)
      live.clear()
    }
  }, [user, qc, schedule])

  if (!pops.length) return null
  return (
    <div className="pointer-events-none fixed right-3 top-16 z-[70] flex w-[23rem] max-w-[calc(100vw-1.5rem)] flex-col gap-2 print:hidden" aria-live="polite">
      {pops.map(n => {
        const look = lookOf(n.kind)
        return (
          <div
            key={n.id}
            role="status"
            onMouseEnter={() => hold(n.id)}
            onMouseLeave={() => resume(n.id)}
            className="notif-pop pointer-events-auto relative overflow-hidden rounded-xl border bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800"
            style={{ '--na': look.light, '--na-dark': look.dark } as React.CSSProperties}
          >
            <NotificationItem n={n} compact onOpen={x => {
              dismiss(x.id)
              void markRead.one(x)
              if (x.link) navigate(x.link)
            }} />
            <button type="button" aria-label="Dismiss" onClick={() => dismiss(n.id)}
              className="absolute right-1 top-1 rounded p-1 text-slate-400 opacity-0 transition-opacity hover:bg-slate-100 hover:text-slate-600 focus-visible:opacity-100 [.notif-pop:hover_&]:opacity-100 dark:hover:bg-slate-700">
              <X className="h-3.5 w-3.5" />
            </button>
            <span className="notif-pop-timer absolute inset-x-0 bottom-0 h-0.5 origin-left" style={{ animationDuration: `${SHOW_MS}ms` }} />
          </div>
        )
      })}
    </div>
  )
}
