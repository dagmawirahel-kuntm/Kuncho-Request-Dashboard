import { Link } from 'react-router-dom'
import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, Pin, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Theme } from './AppShell'
import { useEffect, useRef, useState } from 'react'
import { DaisyMark } from '@/components/seasonal/MeskelArt'
import type { NavGroup } from './navConfig'
import { NavItemLink, SectionItems } from './NavPieces'
import { openPagePalette, pinnedItems, useOpenSections, PINNED, type ActiveNav, type NavData, type NavLayout } from './navState'
import { accentVars, sectionOf } from './navAccent'

export function Logo({ theme, festive, onClick, showName }: { theme: Theme; festive: boolean; onClick: () => void; showName: boolean }) {
  const logoRef = useRef<HTMLSpanElement>(null)

  function handleClick() {
    const el = logoRef.current
    if (el) {
      el.classList.remove('logo-toggle-anim')
      void el.offsetWidth
      el.classList.add('logo-toggle-anim')
      el.addEventListener('animationend', () => el.classList.remove('logo-toggle-anim'), { once: true })
    }
    onClick()
  }

  return (
    <button
      onClick={handleClick}
      title={theme === 'light' ? 'Switch to dark mode' : theme === 'dark' ? 'Switch to gold theme' : 'Switch to light mode'}
      className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
    >
      <span className="relative inline-block">
        <span
          ref={logoRef}
          className="inline-block font-black leading-none select-none transition-colors duration-300"
          style={{ fontSize: '2rem', color: theme === 'light' ? 'white' : festive ? '#F4C20D' : '#D4AF37' }}
        >
          ቁ
        </span>
        {festive && <DaisyMark className="pointer-events-none absolute -right-2.5 -top-1.5 h-4 w-4 animate-fade-in" />}
      </span>
      {showName && (
        <span className="text-sm font-semibold tracking-widest text-white/60 uppercase">
          Kuncho
        </span>
      )}
    </button>
  )
}

function SearchButton() {
  return (
    <button
      type="button"
      onClick={openPagePalette}
      className="nav-search mb-2 flex w-full items-center gap-2 rounded-md bg-white/5 px-3 py-2 text-sm text-slate-400 hover:bg-white/10 hover:text-slate-200"
    >
      <Search className="h-4 w-4 shrink-0" />
      <span className="flex-1 text-left">Jump to page…</span>
      <kbd className="rounded border border-white/15 px-1 text-[10px] font-sans text-slate-400">Ctrl K</kbd>
    </button>
  )
}

// ── Sidebar: every section in one column, folding ────────────────────────
function SectionTree({ groups, active, pins, togglePin, onNavigate }: NavData & { onNavigate?: () => void }) {
  const { isOpen, toggle } = useOpenSections(active.section)
  const pinned = pinnedItems(groups, pins)

  return (
    <nav className="flex-1 space-y-0.5 p-3">
      <SearchButton />
      {pinned.length > 0 && (
        <div className="mb-2" style={accentVars(PINNED)}>
          <p className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
            <Pin className="h-3 w-3" /> {PINNED}
          </p>
          <div className="space-y-0.5">
            {pinned.map(item => (
              <NavItemLink
                key={item.to}
                item={item}
                active={item.to === active.to}
                pinned
                onTogglePin={togglePin}
                onNavigate={onNavigate}
                section={sectionOf(groups, item.to)}
              />
            ))}
          </div>
        </div>
      )}
      {groups.map(group => {
        const open = isOpen(group.title)
        const here = group.title === active.section
        return (
          <div key={group.title} style={accentVars(group.title)}>
            <div className="group/section relative">
              <button
                type="button"
                onClick={() => toggle(group.title)}
                aria-expanded={open}
                data-here={here || undefined}
                className={cn(
                  'nav-section flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors hover:bg-white/5',
                  here ? 'text-white font-medium' : 'text-slate-300 hover:text-white',
                )}
              >
                <group.icon className="h-4 w-4 shrink-0" />
                <span className="flex-1 truncate text-left">{group.title}</span>
                <span className={cn('rounded-full bg-white/5 px-1.5 text-[10px] text-slate-500', group.to && 'group-hover/section:invisible')}>
                  {group.items.length}
                </span>
                <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform', !open && '-rotate-90')} />
              </button>
              {group.to && (
                <Link
                  to={group.to}
                  onClick={onNavigate}
                  title={`Open the ${group.title} page`}
                  className="absolute right-7 top-1/2 hidden -translate-y-1/2 rounded p-1 text-slate-500 hover:bg-white/10 hover:text-white group-hover/section:block"
                >
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>
            {open && (
              <div className="nav-branch mb-1 ml-[1.1rem] border-l border-white/10 pl-1.5">
                <SectionItems
                  items={group.items}
                  activeTo={active.to}
                  pins={pins}
                  onTogglePin={togglePin}
                  dense
                  onNavigate={onNavigate}
                />
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}

// ── Icon rail: one icon per section, one section's pages at a time ────────
function Rail({ groups, active, selected, onSelect, theme, festive, onToggleTheme, onToggleCollapse, collapsed }: {
  groups: NavGroup[]
  active: ActiveNav
  selected: string | null
  onSelect: (title: string) => void
  theme: Theme
  festive: boolean
  onToggleTheme: () => void
  onToggleCollapse: () => void
  collapsed: boolean
}) {
  const entries = [{ title: PINNED, icon: Pin }, ...groups]
  return (
    <div className="flex h-full w-16 shrink-0 flex-col items-center bg-black/20">
      <div className="flex h-14 shrink-0 items-center">
        <Logo theme={theme} festive={festive} onClick={onToggleTheme} showName={false} />
      </div>
      <div className="flex w-full flex-1 flex-col items-center gap-1 overflow-y-auto px-1.5 py-2">
        <button
          type="button"
          onClick={openPagePalette}
          title="Jump to page (Ctrl K)"
          className="nav-search mb-1 flex w-full justify-center rounded-md py-2 text-slate-400 hover:bg-white/5 hover:text-white"
        >
          <Search className="h-4 w-4" />
        </button>
        {entries.map(e => {
          const isSelected = e.title === selected
          const here = e.title === active.section
          return (
            <button
              key={e.title}
              type="button"
              onClick={() => onSelect(e.title)}
              title={e.title}
              aria-pressed={isSelected}
              data-here={here || undefined}
              style={accentVars(e.title)}
              className={cn(
                'nav-rail-btn relative flex w-full flex-col items-center gap-1 rounded-md px-0.5 py-1.5 text-[9.5px] leading-tight transition-colors',
                isSelected ? 'bg-white/10 text-white' : here ? 'text-white hover:bg-white/5' : 'text-slate-400 hover:bg-white/5 hover:text-white',
              )}
            >
              {here && <span className="nav-here-bar absolute left-0 top-2 bottom-2 w-0.5 rounded-full" />}
              <e.icon className="h-[18px] w-[18px]" />
              <span className="w-full truncate text-center">{e.title.split(' ')[0]}</span>
            </button>
          )
        })}
      </div>
      <button
        type="button"
        onClick={onToggleCollapse}
        title={collapsed ? 'Expand' : 'Hide the section panel'}
        className="nav-collapse flex w-full shrink-0 justify-center border-t border-white/10 py-3 text-slate-400 hover:bg-white/5 hover:text-white"
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </button>
    </div>
  )
}

// One section's pages beside the rail — docked in the rail layout, floating
// when the nav is folded down to icons.
function SectionPanel({ title, groups, active, pins, togglePin, onNavigate }: NavData & { title: string; onNavigate?: () => void }) {
  const group = groups.find(g => g.title === title)
  const items = title === PINNED ? pinnedItems(groups, pins) : group?.items ?? []
  return (
    <div className="flex h-full w-64 flex-col bg-sidebar" style={accentVars(title)}>
      <div className="nav-panel-head flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-4">
        <span className="flex min-w-0 items-center gap-2 truncate text-sm font-semibold text-white"><span className="nav-dot" />{title}</span>
        {group?.to && (
          <Link to={group.to} onClick={onNavigate} title={`Open the ${title} page`} className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white">
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {items.length === 0 ? (
          <p className="px-3 py-4 text-xs leading-relaxed text-slate-500">
            Nothing pinned yet. Hover over any page in a section and press the pin to keep it here.
          </p>
        ) : (
          title === PINNED
            ? <div className="space-y-0.5">{items.map(item => (
                <NavItemLink key={item.to} item={item} active={item.to === active.to} pinned onTogglePin={togglePin}
                  onNavigate={onNavigate} section={sectionOf(groups, item.to)} />
              ))}</div>
            : <SectionItems items={items} activeTo={active.to} pins={pins} onTogglePin={togglePin} onNavigate={onNavigate} />
        )}
      </div>
    </div>
  )
}

interface SidebarProps {
  nav: NavData
  layout: NavLayout
  collapsed: boolean
  onToggleCollapse: () => void
  mobileOpen: boolean
  onCloseMobile: () => void
  theme: Theme
  onToggleTheme: () => void
  /** A holiday is on (see lib/seasons.ts): the logo wears a daisy. */
  festive?: boolean
}

export function Sidebar({ nav: data, layout, collapsed, onToggleCollapse, mobileOpen, onCloseMobile, theme, onToggleTheme, festive = false }: SidebarProps) {
  const { groups, active } = data

  // The rail's chosen section: whatever was clicked, until the person moves
  // to a page in another section — then that section is the one shown.
  const [picked, setPicked] = useState<string | null>(null)
  const [pickedFor, setPickedFor] = useState(active.section)
  if (pickedFor !== active.section) {
    setPickedFor(active.section)
    setPicked(null)
  }
  const selected = picked ?? active.section ?? groups[0]?.title ?? null

  // Folded to icons, a click opens that section as a flyout instead.
  const [flyout, setFlyout] = useState<string | null>(null)
  const flyoutRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!flyout) return
    function onDown(e: MouseEvent) {
      if (flyoutRef.current && !flyoutRef.current.contains(e.target as Node)) setFlyout(null)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setFlyout(null) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [flyout])

  const railOnly = collapsed || layout === 'rail'

  return (
    <>
      {/* Phones and small tablets: the folding sidebar as a drawer, whatever the layout. */}
      {mobileOpen && (
        <div
          className="animate-fade-in fixed inset-0 z-30 bg-black/40 lg:hidden print:hidden"
          onClick={onCloseMobile}
        />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex h-screen w-72 flex-col overflow-y-auto bg-sidebar transition-transform duration-200 lg:hidden print:hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 shrink-0 items-center border-b border-white/10 px-4">
          <Logo theme={theme} festive={festive} onClick={onToggleTheme} showName />
        </div>
        <SectionTree {...data} onNavigate={onCloseMobile} />
      </aside>

      {/* Desktop */}
      {layout !== 'top' && (
        <aside className="relative hidden h-screen shrink-0 bg-sidebar lg:flex print:hidden" ref={flyoutRef}>
          {railOnly ? (
            <>
              <Rail
                groups={groups}
                active={active}
                selected={collapsed ? flyout : selected}
                onSelect={title => {
                  if (collapsed) setFlyout(f => (f === title ? null : title))
                  else setPicked(title)
                }}
                theme={theme}
                festive={festive}
                onToggleTheme={onToggleTheme}
                onToggleCollapse={() => { setFlyout(null); onToggleCollapse() }}
                collapsed={collapsed}
              />
              {!collapsed && selected && (
                <div className="border-l border-white/10">
                  <SectionPanel {...data} title={selected} />
                </div>
              )}
              {collapsed && flyout && (
                <div className="animate-fade-in absolute inset-y-0 left-16 z-50 border-l border-white/10 shadow-2xl">
                  <SectionPanel {...data} title={flyout} onNavigate={() => setFlyout(null)} />
                </div>
              )}
            </>
          ) : (
            <div className="flex w-64 flex-col">
              <div className="flex h-14 shrink-0 items-center border-b border-white/10 px-4">
                <Logo theme={theme} festive={festive} onClick={onToggleTheme} showName />
              </div>
              <div className="flex-1 overflow-y-auto">
                <SectionTree {...data} />
              </div>
              <button
                onClick={onToggleCollapse}
                className="nav-collapse flex shrink-0 items-center justify-center gap-2 border-t border-white/10 py-3 text-slate-400 hover:bg-white/5 hover:text-white"
              >
                <ChevronLeft className="h-4 w-4" /><span className="text-xs">Collapse</span>
              </button>
            </div>
          )}
        </aside>
      )}
    </>
  )
}
