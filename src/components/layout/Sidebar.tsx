import { NavLink } from 'react-router-dom'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { navGroups, useNavItemVisible, type NavGroup as NavGroupDef } from './navConfig'
import { cn } from '@/lib/utils'
import type { Theme } from './AppShell'
import { useState, useRef } from 'react'
import { DaisyMark } from '@/components/seasonal/MeskelArt'

function NavGroup({ group, collapsed }: { group: NavGroupDef; collapsed: boolean }) {
  const isVisible = useNavItemVisible()
  const [open, setOpen] = useState(true)

  const visibleItems = group.items.filter(isVisible)
  if (visibleItems.length === 0) return null

  if (collapsed) {
    return (
      <div className="mb-1 space-y-0.5">
        {visibleItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            title={item.label}
            className={({ isActive }) =>
              cn(
                'flex items-center justify-center rounded-md px-2 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-white/10 text-white font-medium'
                  : 'text-slate-300 hover:bg-white/5 hover:text-white',
              )
            }
          >
            <item.icon className={cn('h-4 w-4 shrink-0', item.animateIcon)} />
          </NavLink>
        ))}
      </div>
    )
  }

  return (
    <div className="mb-1">
      <div className="flex w-full items-center justify-between px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
        {group.to ? (
          <NavLink to={group.to} className={({ isActive }) => cn('hover:text-slate-200', isActive && 'text-white')}>
            {group.title}
          </NavLink>
        ) : (
          <span>{group.title}</span>
        )}
        <button onClick={() => setOpen(o => !o)} className="hover:text-slate-300">
          <ChevronDown className={cn('h-3 w-3 transition-transform', !open && '-rotate-90')} />
        </button>
      </div>
      {open && (
        <div className="space-y-0.5">
          {visibleItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-white/10 text-white font-medium'
                    : 'text-slate-300 hover:bg-white/5 hover:text-white',
                )
              }
            >
              <item.icon className={cn('h-4 w-4 shrink-0', item.animateIcon)} />
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

interface SidebarProps {
  collapsed: boolean
  onToggleCollapse: () => void
  mobileOpen: boolean
  onCloseMobile: () => void
  theme: Theme
  onToggleTheme: () => void
  /** A holiday is on (see lib/seasons.ts): the logo wears a daisy. */
  festive?: boolean
}

export function Sidebar({ collapsed, onToggleCollapse, mobileOpen, onCloseMobile, theme, onToggleTheme, festive = false }: SidebarProps) {
  const logoRef = useRef<HTMLSpanElement>(null)

  function handleLogoClick() {
    const el = logoRef.current
    if (el) {
      el.classList.remove('logo-toggle-anim')
      void el.offsetWidth
      el.classList.add('logo-toggle-anim')
      el.addEventListener('animationend', () => el.classList.remove('logo-toggle-anim'), { once: true })
    }
    onToggleTheme()
  }

  return (
    <>
      {mobileOpen && (
        <div
          className="animate-fade-in fixed inset-0 z-30 bg-black/40 lg:hidden print:hidden"
          onClick={onCloseMobile}
        />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex h-screen shrink-0 flex-col bg-sidebar overflow-y-auto transition-all duration-200 print:hidden',
          'lg:static lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          collapsed ? 'w-56 lg:w-16' : 'w-56',
        )}
      >
        <div className={cn('flex h-14 shrink-0 items-center border-b border-white/10', collapsed ? 'justify-center px-2' : 'px-4')}>
          <button
            onClick={handleLogoClick}
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
            {!collapsed && (
              <span className="text-sm font-semibold tracking-widest text-white/60 uppercase">
                Kuncho
              </span>
            )}
          </button>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navGroups.map(group => (
            <NavGroup key={group.title} group={group} collapsed={collapsed} />
          ))}
        </nav>
        <button
          onClick={onToggleCollapse}
          className="hidden shrink-0 items-center justify-center gap-2 border-t border-white/10 py-3 text-slate-400 hover:bg-white/5 hover:text-white lg:flex"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <><ChevronLeft className="h-4 w-4" /><span className="text-xs">Collapse</span></>}
        </button>
      </aside>
    </>
  )
}
