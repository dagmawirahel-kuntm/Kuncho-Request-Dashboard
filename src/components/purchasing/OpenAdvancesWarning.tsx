import { Link } from 'react-router-dom'
import { formatCurrency } from '@/lib/utils'
import { useVendorOpenAdvances } from '@/lib/receiving'
import { AlertTriangle } from 'lucide-react'

/**
 * Before paying a vendor ahead again: the advances already with them for
 * goods nobody has received, a week or more after ordering (520). A warning,
 * not a block; finance decides.
 */
export function OpenAdvancesWarning({ vendorId, exceptBundleId, exceptExpenseId }: { vendorId: string | null | undefined; exceptBundleId?: string; exceptExpenseId?: string }) {
  const { data: open = [] } = useVendorOpenAdvances(vendorId, { bundleId: exceptBundleId, expenseId: exceptExpenseId })
  if (!open.length) return null
  const total = open.reduce((n, a) => n + Number(a.paid_ahead ?? 0), 0)
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm dark:border-amber-700/50 dark:bg-amber-900/15">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <div className="min-w-0 text-amber-900 dark:text-amber-200">
        <p>
          This vendor already has <b>{formatCurrency(total)}</b> paid ahead on {open.length} order{open.length === 1 ? '' : 's'} with nothing received:
        </p>
        <p className="mt-0.5 text-xs">
          {open.slice(0, 6).map((a, i) => (
            <span key={a.bundle_id}>{i > 0 && ', '}<Link to={`/sourcing/${a.bundle_id}`} className="font-medium underline">{a.bundle_code}</Link> {formatCurrency(Number(a.paid_ahead))} ({a.days} days)</span>
          ))}
          {open.length > 6 && ` and ${open.length - 6} more`}
        </p>
      </div>
    </div>
  )
}
