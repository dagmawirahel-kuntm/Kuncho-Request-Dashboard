import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { formatDate } from '@/lib/utils'

export interface ActivityItem {
  id: string
  label: string
  sub?: string
  date: string | null
  to: string
  icon: LucideIcon
}

interface RecentActivityFeedProps {
  title: string
  items: ActivityItem[]
  emptyText?: string
  limit?: number
}

export function RecentActivityFeed({ title, items, emptyText = 'No recent activity', limit = 8 }: RecentActivityFeedProps) {
  const sorted = [...items]
    .sort((a, b) => (b.date ? new Date(b.date).getTime() : 0) - (a.date ? new Date(a.date).getTime() : 0))
    .slice(0, limit)

  return (
    <div className="rounded-xl border bg-white p-5">
      <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      {sorted.length === 0 ? (
        <p className="mt-6 text-center text-sm text-slate-400">{emptyText}</p>
      ) : (
        <div className="mt-3 divide-y">
          {sorted.map(item => (
            <Link key={item.id} to={item.to} className="flex items-center gap-3 py-2.5 hover:bg-slate-50 -mx-1 px-1 rounded-md transition-colors">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
                <item.icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-700">{item.label}</p>
                {item.sub && <p className="truncate text-xs text-slate-400">{item.sub}</p>}
              </div>
              <span className="shrink-0 text-xs text-slate-400">{formatDate(item.date)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
