import { cn } from '@/lib/utils'

type Variant = 'green' | 'red' | 'yellow' | 'blue' | 'slate' | 'orange'

const variantClasses: Record<Variant, string> = {
  green: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  red: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  yellow: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  orange: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
}

const statusVariantMap: Record<string, Variant> = {
  paid: 'green',
  completed: 'green',
  approved: 'green',
  finance_approved: 'green',
  delivered: 'green',
  active: 'green',
  pending: 'yellow',
  processing: 'yellow',
  manager_approved: 'blue',
  in_transit: 'blue',
  requested: 'blue',
  rejected: 'red',
  overdue: 'red',
  cancelled: 'red',
  refunded: 'orange',
  draft: 'slate',
  invoiced: 'blue',
}

interface StatusBadgeProps {
  status: string
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const variant = statusVariantMap[status.toLowerCase().replace(' ', '_')] ?? 'slate'
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize', variantClasses[variant], className)}>
      {status}
    </span>
  )
}
