import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, ChevronDown, Pin, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Theme } from './AppShell'
import { Logo } from './Sidebar'
import { NavItemLink } from './NavPieces'
import { openPagePalette, pinnedItems, subgroupRuns, PINNED, type NavData } from './navState'
import { accentVars, sectionOf } from './navAccent'

// A wide menu (four columns) opened from the middle of the bar can run off
// the screen's edge: shift it back in, keeping 8px clear.
function keepOnScreen(el: HTMLDivElement | null) {
  if (!el) return
  el.style.translate = ''
  const r = el.getBoundingClientRect()
  const shift = r.left < 8 ? 8 - r.left : r.right > window.innerWidth - 8 ? window.innerWidth - 8 - r.right : 0
  if (shift) el.style.translate = `${shift}px 0`
}

// The top-bar layout: sections across the top, each opening a menu with its
// subgroups side by side. Desktop only — phones keep the drawer.
export function TopNav({ nav, theme, festive, onToggleTheme }: {
  nav: NavData
  theme: Theme
  festive: boolean
  onToggleTheme: () => void
}) {
  const { groups, active, pins, togglePin } = nav
  const [open, setOpen] = useState<string | null>(null)
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpen(null)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(null) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const entries = [{ title: PINNED, icon: Pin, to: undefined, items: pinnedItems(groups, pins) }, ...groups]
  const close = () => setOpen(null)

  return (
    <div ref={barRef} className="relative z-40 hidden h-14 shrink-0 items-center gap-1 bg-sidebar px-3 lg:flex print:hidden">
      <div className="mr-3 shrink-0">
        <Logo theme={theme} festive={festive} onClick={onToggleTheme} showName />
      </div>
      <nav className="flex min-w-0 flex-1 items-center gap-0.5">
        {entries.map((entry, index) => {
          const isOpen = open === entry.title
          const here = entry.title === active.section
          const runs = subgroupRuns(entry.items)
          const columns = Math.min(Math.max(runs.filter(r => r.heading).length, 1), 4)
          // Menus for the sections on the right open leftwards, so they stay on screen.
          const alignRight = index > entries.length / 2
          const isPinned = entry.title === PINNED
          return (
            <div key={entry.title} className="relative" style={accentVars(entry.title)}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : entry.title)}
                aria-expanded={isOpen}
                title={entry.title}
                data-here={here || undefined}
                className={cn(
                  'nav-top-btn relative flex items-center gap-1.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                  isOpen ? 'bg-white/10 text-white' : here ? 'text-white hover:bg-white/5' : 'text-slate-300 hover:bg-white/5 hover:text-white',
                )}
              >
                <entry.icon className="h-4 w-4 shrink-0" />
                {!isPinned && <span className="hidden whitespace-nowrap xl:inline">{entry.title}</span>}
                {!isPinned && <ChevronDown className={cn('h-3 w-3 text-slate-500 transition-transform', isOpen && 'rotate-180')} />}
                {here && <span className="nav-here-bar absolute inset-x-2.5 -bottom-[9px] h-0.5 rounded-full" />}
              </button>
              {isOpen && (
                <div
                  ref={keepOnScreen}
                  className={cn(
                    'nav-drop absolute top-full mt-2 max-h-[calc(100vh-5rem)] overflow-y-auto rounded-lg border border-white/10 bg-sidebar p-3 shadow-2xl',
                    alignRight ? 'right-0' : 'left-0',
                  )}
                  style={{ width: isPinned ? '16rem' : `${columns * 15}rem` }}
                >
                  <div className="mb-1 flex items-center justify-between px-3 pb-1">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{entry.title}</span>
                    {entry.to && (
                      <Link to={entry.to} onClick={close} className="flex items-center gap-1 text-xs text-slate-400 hover:text-white">
                        Open page <ArrowUpRight className="h-3 w-3" />
                      </Link>
                    )}
                  </div>
                  {entry.items.length === 0 ? (
                    <p className="px-3 py-3 text-xs leading-relaxed text-slate-500">
                      Nothing pinned yet. Hover over any page in a menu and press the pin to keep it here.
                    </p>
                  ) : (
                    <div className="gap-x-2" style={{ columnCount: isPinned ? 1 : columns }}>
                      {runs.map((run, i) => (
                        <div key={`${run.heading ?? ''}-${i}`} className="mb-2 break-inside-avoid space-y-0.5">
                          {run.heading && (
                            <p className="px-3 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{run.heading}</p>
                          )}
                          {run.items.map(item => (
                            <NavItemLink
                              key={`${item.label}-${item.to}`}
                              item={item}
                              active={item.to === active.to}
                              pinned={pins.includes(item.to)}
                              onTogglePin={togglePin}
                              dense
                              onNavigate={close}
                              section={isPinned ? sectionOf(groups, item.to) : undefined}
                            />
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </nav>
      <button
        type="button"
        onClick={openPagePalette}
        className="nav-search flex shrink-0 items-center gap-2 rounded-md bg-white/5 px-3 py-1.5 text-sm text-slate-400 hover:bg-white/10 hover:text-slate-200"
      >
        <Search className="h-4 w-4" />
        <span className="hidden 2xl:inline">Jump to page…</span>
        <kbd className="rounded border border-white/15 px-1 text-[10px] font-sans">Ctrl K</kbd>
      </button>
    </div>
  )
}
