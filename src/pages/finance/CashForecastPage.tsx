import { useState } from 'react'
import { useAccountControl } from '@/lib/cashControl'
import { CashForecast } from '@/components/cash/CashForecast'
import { AlertsPanel } from '@/components/cash/AlertsPanel'

/**
 * Daily cash planning: what is in the bank today, what is due to go out
 * (approved payments, payroll, vendor requests) and what should come in
 * (invoices, payment requests), day by day (migration 349).
 */
export default function CashForecastPage() {
  const { data: control = [] } = useAccountControl()
  const main = control.find(c => c.role === 'main')
  // Payments go out of the main account, so that's where planning starts.
  const [scope, setScope] = useState<'main' | 'all'>('main')
  const accountId = scope === 'main' ? main?.account_id : undefined

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Cash Forecast</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Today's balance, then what is due to go out and come in — for planning the day's payments.
          </p>
        </div>
        <div className="flex rounded-md border text-xs dark:border-slate-600">
          <button onClick={() => setScope('main')} disabled={!main}
            className={`px-3 py-1.5 ${scope === 'main' ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700'}`}>
            {main?.account_name ?? 'Main account'}
          </button>
          <button onClick={() => setScope('all')}
            className={`px-3 py-1.5 ${scope === 'all' ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700'}`}>
            All accounts
          </button>
        </div>
      </div>

      {(scope === 'all' || main) && <CashForecast key={scope} accountId={accountId} />}

      <AlertsPanel limit={4} />
    </div>
  )
}
