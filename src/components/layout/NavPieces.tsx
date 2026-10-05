import { NavLink } from 'react-router-dom'
import { Pin, PinOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { NavItem } from './navConfig'
import { subgroupRuns } from './navState'
import { accentVars } from './navAccent'

// One page link, with a pin toggle that shows on hover. The toggle sits
// beside the link, not inside it, so pinning never follows the link.
export function NavItemLink({ item, active, pinned, onTogglePin, dense = false, onNavigate, section }: {
  item: NavItem
  // Worked out once for the whole nav (useActiveNav), so only the closest
  // match lights up — /stock/counts is "Stock Counts", not also "Stock".
  active: boolean
  pinned: boolean
  onTogglePin: (to: string) => void
  dense?: boolean
  onNavigate?: () => void
  /** Its section, when shown outside it (pinned): the item wears that section's colour. */
  section?: string | null
}) {
  return (
    <div className="group/item relative" style={section !== undefined ? accentVars(section) : undefined}>
      <NavLink
        to={item.to}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'nav-item flex items-center gap-2.5 rounded-md pl-3 pr-7 text-sm',
          dense ? 'py-1.5' : 'py-2',
          active
            ? 'bg-white/10 text-white font-medium'
            : 'text-slate-300 hover:bg-white/5 hover:text-white',
        )}
      >
        <item.icon className={cn('h-4 w-4 shrink-0', item.animateIcon)} />
        <span className="truncate">{item.label}</span>
      </NavLink>
      <button
        type="button"
        onClick={() => onTogglePin(item.to)}
        title={pinned ? 'Unpin' : 'Pin to the top'}
        aria-label={pinned ? `Unpin ${item.label}` : `Pin ${item.label}`}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 opacity-0 hover:bg-white/10 hover:text-white focus-visible:opacity-100 group-hover/item:opacity-100"
      >
        {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}

// A section's items, each run under its subgroup heading.
export function SectionItems({ items, activeTo, pins, onTogglePin, dense, onNavigate }: {
  items: NavItem[]
  activeTo: string | null
  pins: string[]
  onTogglePin: (to: string) => void
  dense?: boolean
  onNavigate?: () => void
}) {
  return (
    <div className="space-y-0.5">
      {subgroupRuns(items).map((run, i) => (
        <div key={`${run.heading ?? ''}-${i}`} className="space-y-0.5">
          {run.heading && (
            <p className="px-3 pb-0.5 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {run.heading}
            </p>
          )}
          {run.items.map(item => (
            <NavItemLink
              key={`${item.label}-${item.to}`}
              item={item}
              active={item.to === activeTo}
              pinned={pins.includes(item.to)}
              onTogglePin={onTogglePin}
              dense={dense}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
