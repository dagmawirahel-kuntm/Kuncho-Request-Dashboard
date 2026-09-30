import { Link } from 'react-router-dom'
import { ArrowUpRight, Landmark } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { useAccountControl } from '@/lib/cashControl'
import { TONE_CLASSES, useWaitingOn, type WaitingTone } from '@/lib/dashboard/waiting'
import type { WidgetContext } from '@/lib/dashboard/types'

// ETB 4,213,500.00 doesn't fit a tile; ETB 4.21M does (the full figure is
// in the tooltip and one click away).
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 })

function Tile({ to, label, value, title, sub, icon: Icon, tone }: {
  to: string; label: string; value: string; title?: string; sub?: string; icon: React.ElementType; tone: WaitingTone
}) {
  const t = TONE_CLASSES[tone]
  return (
    <Link
      to={to}
      title={title}
      className="group relative flex w-44 shrink-0 snap-start flex-col overflow-hidden rounded-2xl border bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:w-auto dark:border-slate-700 dark:bg-slate-800"
    >
      <span className={`absolute inset-x-0 top-0 h-1 ${t.bar}`} />
      <div className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>
        <span className={`shrink-0 rounded-lg p-1.5 ${t.chip}`}><Icon className="h-4 w-4" /></span>
      </div>
      <p className="mt-2 whitespace-nowrap text-2xl font-bold tabular-nums tracking-tight sm:text-3xl text-slate-900 dark:text-white">{value}</p>
      <p className={`mt-auto flex items-center gap-0.5 pt-1 text-[11px] font-medium ${t.text}`}>
        {sub ?? 'Open'} <ArrowUpRight className="h-3 w-3 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </p>
    </Link>
  )
}

// The main bank account's balance, for the roles that can see it.
function CashTile() {
  const { data: control = [] } = useAccountControl()
  const main = control.find(c => c.role === 'main')
  if (!main) return null
  return (
    <Tile to="/cash-forecast" label={`${main.account_name} balance`} value={`ETB ${compact.format(main.app_balance ?? 0)}`} title={formatCurrency(main.app_balance ?? 0)} sub="Cash forecast" icon={Landmark} tone="emerald" />
  )
}

/**
 * The numbers that matter first: each queue waiting on this person as a big
 * tile (largest first), plus cash for finance and the executives. Swipes
 * sideways on a phone.
 */
export function FocusTiles({ ctx }: { ctx: WidgetContext }) {
  const { items, isLoading } = useWaitingOn(ctx)
  const seesCash = ['admin', 'finance', 'executive'].includes(ctx.role ?? '')
  const tiles = [...items].sort((a, b) => b.n - a.n).slice(0, seesCash ? 3 : 4)

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map(i => <div key={i} className="h-32 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />)}
      </div>
    )
  }
  if (tiles.length === 0 && !seesCash) return null

  return (
    <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-4">
      {seesCash && <CashTile />}
      {tiles.map(i => (
        <Tile key={i.id} to={i.to} label={i.title} value={String(i.n)} icon={i.icon} tone={i.tone} />
      ))}
    </div>
  )
}
