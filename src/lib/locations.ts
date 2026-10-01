import type { ElementType } from 'react'
import type { LocationKind } from '@/types/database'
import { HardHat, Store, Building, Hammer, Warehouse, Handshake, MapPin } from 'lucide-react'

// Kinds of saved place, with the icon and colour they show with.
export const LOCATION_KINDS: { value: LocationKind; label: string; icon: ElementType; cls: string }[] = [
  { value: 'site',        label: 'Site',        icon: HardHat,   cls: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' },
  { value: 'workshop',    label: 'Workshop',    icon: Hammer,    cls: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400' },
  { value: 'warehouse',   label: 'Warehouse',   icon: Warehouse, cls: 'bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400' },
  { value: 'office',      label: 'Office',      icon: Building,  cls: 'bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400' },
  { value: 'vendor_shop', label: 'Vendor shop', icon: Store,     cls: 'bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400' },
  { value: 'client',      label: 'Client',      icon: Handshake, cls: 'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400' },
  { value: 'other',       label: 'Other',       icon: MapPin,    cls: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400' },
]
export const LOCATION_KIND = Object.fromEntries(LOCATION_KINDS.map(k => [k.value, k])) as Record<LocationKind, (typeof LOCATION_KINDS)[number]>

// Who may add and change places — the same roles locations' RLS lets write.
export const LOCATION_WRITERS = ['admin', 'executive', 'finance', 'project_manager', 'logistics_officer']
