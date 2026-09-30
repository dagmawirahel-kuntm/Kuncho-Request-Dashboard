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
    <div className="flex h-full flex-col rounded-2xl border bg-white shadow-sm transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3.5">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <span className="rounded-lg bg-slate-100 p-1.5 text-slate-500 dark:bg-slate-700 dark:text-slate-300"><Icon className="h-3.5 w-3.5 shrink-0" /></span>
          <span className="truncate">{title}</span>
          {count != null && count > 0 && (
            <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-white dark:bg-brand dark:text-brand-foreground">{count}</span>
          )}
        </h3>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          {to && (
            <Link to={to} className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200">
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
  if (rows.length === 0) return <p className="px-4 py-8 text-center text-sm text-slate-400">{empty}</p>
  return (
    <ul className="px-2 pb-2">
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
              ? <Link to={r.to} className="flex items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/40">{body}</Link>
              : <div className="flex items-center gap-3 px-2.5 py-2">{body}</div>}
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
      {isLoading && enabled ? <ListSkeleton />
      : error ? <p className="px-4 py-6 text-center text-xs text-red-500">{(error as Error).message}</p>
      : (
        <>
          {data?.summary && <p className="mx-4 mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">{data.summary}</p>}
          <RowList rows={rows} empty={empty} />
        </>
      )}
    </WidgetCard>
  )
}

/** Grey placeholder rows while a widget loads, shaped like the list to come. */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3 px-4 pb-4 pt-1" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex animate-pulse items-center gap-3">
          <div className="h-8 w-8 shrink-0 rounded-lg bg-slate-100 dark:bg-slate-700" />
          <div className="flex-1 space-y-1.5">
            <div className="h-2.5 rounded bg-slate-100 dark:bg-slate-700" style={{ width: `${70 - i * 9}%` }} />
            <div className="h-2 rounded bg-slate-100 dark:bg-slate-700" style={{ width: `${45 - i * 5}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}
