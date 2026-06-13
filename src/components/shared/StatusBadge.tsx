import { cn } from '@/lib/utils'

type Variant = 'green' | 'red' | 'yellow' | 'blue' | 'slate' | 'orange'

const variantClasses: Record<Variant, string> = {
  green: 'bg-green-100 text-green-700',
  red: 'bg-red-100 text-red-700',
  yellow: 'bg-yellow-100 text-yellow-700',
  blue: 'bg-blue-100 text-blue-700',
  slate: 'bg-slate-100 text-slate-600',
  orange: 'bg-orange-100 text-orange-700',
}

const statusVariantMap: Record<string, Variant> = {
  paid: 'green',
  completed: 'green',
  approved: 'green',
  delivered: 'green',
  active: 'green',
  pending: 'yellow',
  processing: 'yellow',
  in_transit: 'blue',
  requested: 'blue',
  rejected: 'red',
  overdue: 'red',
  cancelled: 'red',
  draft: 'slate',
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
