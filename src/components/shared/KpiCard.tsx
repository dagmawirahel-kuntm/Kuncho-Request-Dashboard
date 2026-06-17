import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'

interface KpiCardProps {
  label: string
  value: string | number
  sub?: string
  icon: LucideIcon
  color: string
  to?: string
}

export function KpiCard({ label, value, sub, icon: Icon, color, to }: KpiCardProps) {
  const content = (
    <div className="flex items-start justify-between">
      <div>
        <p className="text-sm text-slate-500">{label}</p>
        <p className="mt-1 text-2xl font-bold text-slate-800">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
      </div>
      <span className={`rounded-lg p-2 ${color}`}>
        <Icon className="h-5 w-5" />
      </span>
    </div>
  )
  const cls = 'block rounded-xl border bg-white p-5 transition-all hover:shadow-md hover:-translate-y-0.5'
  return to ? <Link to={to} className={cls}>{content}</Link> : <div className={cls}>{content}</div>
}
