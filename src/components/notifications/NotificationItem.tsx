import type { CSSProperties } from 'react'
import { lookOf, timeAgo, type AppNotification } from '@/lib/notifications'

// One notification: a chip in its section's colour, the title (bold while
// unread), two lines of detail, when, and an unread dot. Urgent ones get a
// red edge. Used by the bell and the full list.
export function NotificationItem({ n, onOpen, compact = false }: {
  n: AppNotification
  onOpen: (n: AppNotification) => void
  compact?: boolean
}) {
  const look = lookOf(n.kind)
  const Icon = look.icon
  const unread = !n.read_at
  return (
    <button
      type="button"
      onClick={() => onOpen(n)}
      data-unread={unread || undefined}
      data-priority={n.priority}
      className={`notif-item group relative flex w-full items-start gap-3 rounded-lg text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/50 ${compact ? 'px-2.5 py-2' : 'px-3 py-3'}`}
      style={{ '--na': look.light, '--na-dark': look.dark } as CSSProperties}
    >
      <span className="notif-chip mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={`min-w-0 flex-1 text-sm leading-snug ${unread ? 'font-semibold text-slate-900 dark:text-slate-50' : 'text-slate-600 dark:text-slate-300'}`}>
            {n.title}
          </span>
          <span className="shrink-0 text-[11px] text-slate-400" title={new Date(n.created_at).toLocaleString()}>{timeAgo(n.created_at)}</span>
        </span>
        {n.body && (
          <span className={`mt-0.5 block text-xs leading-relaxed text-slate-500 dark:text-slate-400 ${compact ? 'line-clamp-2' : 'line-clamp-3'}`}>
            {n.body}
          </span>
        )}
      </span>
      {unread && <span aria-label="Unread" className="notif-dot mt-2 h-2 w-2 shrink-0 rounded-full" />}
    </button>
  )
}
