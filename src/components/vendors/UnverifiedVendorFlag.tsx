import { Link } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { useUnverifiedVendorIds } from '@/lib/vendors'

// Shown next to a payee wherever money is prepared: this vendor's TIN or
// bank details were entered or changed and the other department hasn't
// checked them yet (migration 356).
export function UnverifiedVendorFlag({ vendorId, compact, plain }: { vendorId: string | null | undefined; compact?: boolean; plain?: boolean }) {
  const { data: ids } = useUnverifiedVendorIds()
  if (!vendorId || !ids?.has(vendorId)) return null
  const cls = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700 ring-1 ring-red-200 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-300 dark:ring-red-800'
  const title = "This vendor's TIN or bank details were entered or changed and haven't been checked by the other department yet. Check them before sending money."
  // Inside another link (a list row that is itself a link) it can't be a link too.
  if (plain) return <span className={cls} title={title}><ShieldAlert className="h-3 w-3" />{compact ? 'Unverified' : 'Bank details not verified'}</span>
  return (
    <Link to={`/vendors/review?vendor=${vendorId}`} onClick={e => e.stopPropagation()}
      title={title} className={cls}>
      <ShieldAlert className="h-3 w-3" />{compact ? 'Unverified' : 'Bank details not verified'}
    </Link>
  )
}
