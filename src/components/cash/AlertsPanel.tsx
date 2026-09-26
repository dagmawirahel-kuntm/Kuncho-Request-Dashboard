import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, BellRing, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react'
import { useBankAlerts, type BankAlert } from '@/lib/cashControl'
import { formatCurrency } from '@/lib/utils'

const TONE: Record<BankAlert['severity'], string> = {
  high: 'border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-900/20',
  medium: 'border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-900/20',
  low: 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800',
}
const ICON_TONE: Record<BankAlert['severity'], string> = {
  high: 'text-red-600 dark:text-red-400',
  medium: 'text-amber-600 dark:text-amber-400',
  low: 'text-slate-500',
}

// What finance should look at today (v_bank_alerts).
export function AlertsPanel({ accountId, limit = 5, title = 'Needs attention' }: {
  accountId?: string
  limit?: number
  title?: string
}) {
  const { data: alerts = [], isLoading } = useBankAlerts(accountId)
  const [all, setAll] = useState(false)
  if (isLoading) return null

  if (alerts.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-300">
        <CheckCircle2 className="h-4 w-4" /> Nothing needs attention.
      </div>
    )
  }

  const shown = all ? alerts : alerts.slice(0, limit)
  return (
    <div className="rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-center gap-2 border-b px-4 py-2.5 dark:border-slate-700">
        <BellRing className="h-4 w-4 text-brand" />
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">{alerts.length}</span>
      </div>
      <ul className="space-y-2 p-3">
        {shown.map((a, i) => (
          <li key={`${a.kind}-${a.ref_id ?? a.account_id ?? ''}-${i}`} className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${TONE[a.severity]}`}>
            <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${ICON_TONE[a.severity]}`} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{a.title}</p>
              {a.detail && <p className="truncate text-xs text-slate-500 dark:text-slate-400" title={a.detail}>{a.detail}</p>}
            </div>
            {a.amount != null && a.kind !== 'forecast_short' && (
              <span className="hidden shrink-0 text-xs font-semibold tabular-nums text-slate-600 dark:text-slate-300 sm:block">{formatCurrency(a.amount)}</span>
            )}
            {a.link && (
              <Link to={a.link} className="shrink-0 text-xs font-medium text-brand hover:underline">Open</Link>
            )}
          </li>
        ))}
      </ul>
      {alerts.length > limit && (
        <button onClick={() => setAll(v => !v)} className="flex w-full items-center justify-center gap-1 border-t py-2 text-xs font-medium text-slate-500 hover:text-slate-700 dark:border-slate-700 dark:text-slate-400">
          {all ? <>Show fewer <ChevronUp className="h-3.5 w-3.5" /></> : <>Show all {alerts.length} <ChevronDown className="h-3.5 w-3.5" /></>}
        </button>
      )}
    </div>
  )
}
