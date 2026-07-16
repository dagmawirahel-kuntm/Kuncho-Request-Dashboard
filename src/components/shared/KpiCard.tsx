import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'

interface KpiCardProps {
  label: string
  value: string | number
  /** Full/precise value shown as a hover tooltip — useful when `value` is a shortened form (e.g. "ETB 2.8M"). */
  title?: string
  sub?: string
  icon: LucideIcon
  color: string
  to?: string
}

export function KpiCard({ label, value, title, sub, icon: Icon, color, to }: KpiCardProps) {
  const content = (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-sm text-slate-500 truncate">{label}</p>
        <p className="mt-1 text-lg sm:text-2xl font-bold text-slate-800 truncate" title={title}>{value}</p>
        {sub && <p className="mt-0.5 text-xs text-slate-400 truncate" title={title}>{sub}</p>}
      </div>
      <span className={`rounded-lg p-2 shrink-0 ${color}`}>
        <Icon className="h-5 w-5" />
      </span>
    </div>
  )
  const cls = 'relative block rounded-xl border bg-white p-5 min-w-0 select-none transition-all duration-200 ease-out ' +
    'hover:z-10 hover:-translate-y-0.5 hover:scale-[1.04] hover:shadow-xl hover:shadow-brand/20 hover:ring-1 hover:ring-brand/30 dark:hover:shadow-brand/30 ' +
    'active:z-10 active:-translate-y-0.5 active:scale-[1.04] active:shadow-xl active:shadow-brand/20 active:ring-1 active:ring-brand/30 dark:active:shadow-brand/30'
  // iOS Safari silently skips :active styling on tap unless something in
  // the chain has a touch handler — an empty one is the standard fix.
  return to
    ? <Link to={to} className={cls} onTouchStart={() => {}}>{content}</Link>
    : <div className={cls} onTouchStart={() => {}}>{content}</div>
}
