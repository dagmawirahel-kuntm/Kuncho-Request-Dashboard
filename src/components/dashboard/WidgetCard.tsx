import type { ElementType, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'

// The frame every widget sits in: a title, an optional count, a "view all"
// link, and the body.
export function WidgetCard({ title, icon: Icon, to, count, action, children }: {
  title: string
  icon: ElementType
  to?: string
  count?: number | null
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex h-full flex-col rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5 dark:border-slate-700">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
          <Icon className="h-4 w-4 shrink-0 text-brand" />
          <span className="truncate">{title}</span>
          {count != null && count > 0 && (
            <span className="rounded-full bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand">{count}</span>
          )}
        </h3>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          {to && (
            <Link to={to} className="flex items-center gap-1 text-xs text-slate-400 hover:text-brand">
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </div>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  )
}

export interface ListRow {
  id: string
  title: string
  subtitle?: string | null
  right?: string | null
  /** A short status or warning shown before the right-hand figure. */
  badge?: { text: string; tone?: 'amber' | 'red' | 'green' | 'slate' } | null
  to?: string | null
}

export interface ListResult {
  rows: ListRow[]
  /** How many there are in all, when more than the rows shown. */
  total?: number | null
  /** One line above the rows, e.g. a sum. */
  summary?: string | null
}

const BADGE: Record<string, string> = {
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
}

export function RowList({ rows, empty }: { rows: ListRow[]; empty: string }) {
  if (rows.length === 0) return <p className="px-4 py-6 text-center text-sm text-slate-400">{empty}</p>
  return (
    <ul className="divide-y dark:divide-slate-700">
      {rows.map(r => {
        const body = (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-slate-800 dark:text-slate-100">{r.title}</span>
              {r.subtitle && <span className="block truncate text-[11px] text-slate-400">{r.subtitle}</span>}
            </span>
            {r.badge && <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${BADGE[r.badge.tone ?? 'slate']}`}>{r.badge.text}</span>}
            {r.right && <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-600 dark:text-slate-300">{r.right}</span>}
          </>
        )
        return (
          <li key={r.id}>
            {r.to
              ? <Link to={r.to} className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/40">{body}</Link>
              : <div className="flex items-center gap-3 px-4 py-2">{body}</div>}
          </li>
        )
      })}
    </ul>
  )
}

/** A widget that is a query and a list: most of them. */
export function QueryListWidget({ title, icon, to, queryKey, fetch, empty, enabled = true }: {
  title: string
  icon: ElementType
  to?: string
  queryKey: unknown[]
  fetch: () => Promise<ListResult>
  empty: string
  enabled?: boolean
}) {
  const { data, isLoading, error } = useQuery({ queryKey: ['dash', ...queryKey], queryFn: fetch, enabled, staleTime: 60_000 })
  const rows = data?.rows ?? []
  return (
    <WidgetCard title={title} icon={icon} to={to} count={data?.total ?? rows.length}>
      {isLoading && enabled ? <p className="px-4 py-6 text-center text-sm text-slate-400">Loading…</p>
      : error ? <p className="px-4 py-6 text-center text-xs text-red-500">{(error as Error).message}</p>
      : (
        <>
          {data?.summary && <p className="border-b px-4 py-1.5 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">{data.summary}</p>}
          <RowList rows={rows} empty={empty} />
        </>
      )}
    </WidgetCard>
  )
}
