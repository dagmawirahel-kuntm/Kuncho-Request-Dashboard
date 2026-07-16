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
  const cls = 'block rounded-xl border bg-white p-5 transition-all hover:shadow-md hover:-translate-y-0.5 min-w-0'
  return to ? <Link to={to} className={cls}>{content}</Link> : <div className={cls}>{content}</div>
}
