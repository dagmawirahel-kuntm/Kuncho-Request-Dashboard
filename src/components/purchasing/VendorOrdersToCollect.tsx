import { Link } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency } from '@/lib/utils'
import { useGoodsToCollect } from '@/lib/receiving'
import { PackageCheck } from 'lucide-react'

/**
 * Before buying from a vendor again: this vendor's earlier orders that are
 * past their day and not marked collected, each with its Collected button.
 * Finance sees the same orders as a warning before paying ahead again; this
 * is the buyer's side of it (520).
 */
export function VendorOrdersToCollect({ vendorId, exceptBundleId }: { vendorId: string | null | undefined; exceptBundleId?: string }) {
  const { role, profile } = useAuth()
  const canReceive = ['admin', 'procurement_officer', 'logistics_officer', 'stock_manager'].includes(role ?? '') || !!profile?.is_logistics_officer
  const { data: rows = [] } = useGoodsToCollect(!!vendorId && canReceive)
  const open = rows.filter(r => r.vendor_id === vendorId && r.bundle_id !== exceptBundleId && r.days_waiting > 0)
  if (!vendorId || !canReceive || !open.length) return null
  const ahead = open.reduce((n, r) => n + Number(r.paid_ahead ?? 0), 0)
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm dark:border-amber-700/50 dark:bg-amber-900/15">
      <p className="text-amber-900 dark:text-amber-200">
        <PackageCheck className="mr-1 inline h-4 w-4 text-amber-600" />
        {open.length} earlier order{open.length === 1 ? '' : 's'} from {open[0].vendor_name ?? 'this vendor'} {open.length === 1 ? "isn't" : "aren't"} marked collected
        {ahead > 0 && <>, with <b>{formatCurrency(ahead)}</b> paid ahead on them</>}. If the goods came, mark them collected; if not, ask the vendor before buying again.
        Finance sees these when approving.
      </p>
      <ul className="mt-1.5 space-y-1">
        {open.slice(0, 6).map(r => (
          <li key={r.bundle_id} className="flex items-center gap-2 text-xs text-amber-900 dark:text-amber-200">
            <Link to={`/sourcing/${r.bundle_id}`} className="min-w-0 flex-1 truncate">
              <b className="underline">{r.bundle_code}</b> · {formatCurrency(Number(r.total))} · {r.days_waiting} day{r.days_waiting === 1 ? '' : 's'}
              {r.officer_id !== profile?.id && r.officer ? ` · ${r.officer}` : ''}
            </Link>
            <Link to={`/sourcing/${r.bundle_id}/collected`} className="shrink-0 rounded-md bg-brand px-2 py-0.5 font-semibold text-white">Collected</Link>
          </li>
        ))}
        {open.length > 6 && <li className="text-xs text-amber-800 dark:text-amber-300"><Link to="/receiving" className="underline">and {open.length - 6} more on To collect</Link></li>}
      </ul>
    </div>
  )
}
