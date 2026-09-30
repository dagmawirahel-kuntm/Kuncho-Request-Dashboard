import { CalendarPlus, ShoppingCart, Truck } from 'lucide-react'
import type { NavItem } from '@/components/layout/navConfig'

// The "start something" actions everyone has: on the dashboard header, the
// phone action bar, and the pinned-pages picker.
export const QUICK_ACTIONS: NavItem[] = [
  { label: 'New purchase request', to: '/purchase-requests/new', icon: ShoppingCart },
  { label: 'Request transport', to: '/transportation/new', icon: Truck },
  { label: 'Request leave', to: '/my-leave', icon: CalendarPlus },
]
