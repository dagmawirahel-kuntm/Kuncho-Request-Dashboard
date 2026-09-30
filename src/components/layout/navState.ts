import { useCallback, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { navGroups, useNavItemVisible, type NavGroup, type NavItem } from './navConfig'

// Browser storage can be missing or throw (private windows, blocked site
// data); the nav must still work, it just forgets between visits.
function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
function writeJson(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* nothing to do */ }
}

// ── Layout ────────────────────────────────────────────────────────────────
// Each person picks how the navigation sits: a sidebar of folding sections,
// an icon rail with one section open beside it, or a bar across the top.
// Phones always get the sidebar drawer — the other two need the width.
export type NavLayout = 'sidebar' | 'rail' | 'top'
export const NAV_LAYOUTS: { value: NavLayout; label: string }[] = [
  { value: 'sidebar', label: 'Sidebar' },
  { value: 'rail', label: 'Icon rail' },
  { value: 'top', label: 'Top bar' },
]

export function useNavLayout(): [NavLayout, (next: NavLayout) => void] {
  const [layout, setLayout] = useState<NavLayout>(() => {
    const saved = readJson<string>('nav-layout', 'sidebar')
    return saved === 'rail' || saved === 'top' ? saved : 'sidebar'
  })
  const set = useCallback((next: NavLayout) => {
    setLayout(next)
    writeJson('nav-layout', next)
  }, [])
  return [layout, set]
}

// ── Visible sections ──────────────────────────────────────────────────────
// The sections as the signed-in person sees them: items they can't open are
// dropped, and a section left empty is dropped with them.
export function useVisibleNav(): NavGroup[] {
  const isVisible = useNavItemVisible()
  return useMemo(
    () => navGroups
      .map(g => ({ ...g, items: g.items.filter(isVisible) }))
      .filter(g => g.items.length > 0),
    [isVisible],
  )
}

export interface ActiveNav { section: string | null; to: string | null }

// The section and item for the current page: the item whose path is the
// longest prefix of the URL, so /stock/counts/12 lights up "Stock Counts",
// not "Stock Catalog".
export function useActiveNav(groups: NavGroup[]): ActiveNav {
  const { pathname } = useLocation()
  return useMemo(() => {
    let best: ActiveNav = { section: null, to: null }
    let bestLen = -1
    for (const g of groups) {
      const candidates = g.to ? [...g.items.map(i => i.to), g.to] : g.items.map(i => i.to)
      for (const to of candidates) {
        const hit = pathname === to || pathname.startsWith(to + '/')
        if (hit && to.length > bestLen) {
          best = { section: g.title, to: g.items.some(i => i.to === to) ? to : null }
          bestLen = to.length
        }
      }
    }
    return best
  }, [groups, pathname])
}

// ── Open sections ─────────────────────────────────────────────────────────
// A section someone opened or closed stays that way between visits. One
// they haven't touched is open only while they're on one of its pages. And
// arriving in a section opens it again, even if it was closed last time —
// otherwise the page you're on hides inside a folded section.
export function useOpenSections(active: string | null) {
  const [state, setState] = useState<Record<string, boolean>>(() => readJson('nav-open-sections', {}))
  const [seenActive, setSeenActive] = useState(active)
  if (active !== seenActive) {
    setSeenActive(active)
    if (active && state[active] === false) {
      const next = { ...state }
      delete next[active]
      setState(next)
      writeJson('nav-open-sections', next)
    }
  }
  const isOpen = useCallback((title: string) => state[title] ?? title === active, [state, active])
  const toggle = useCallback((title: string) => {
    setState(prev => {
      const next = { ...prev, [title]: !(prev[title] ?? title === active) }
      writeJson('nav-open-sections', next)
      return next
    })
  }, [active])
  return { isOpen, toggle }
}

// ── Pins ──────────────────────────────────────────────────────────────────
// The few pages someone opens most, kept at the top of the nav. Per person
// on this browser; a pin to a page they can no longer open is skipped.
export function usePins() {
  const { user } = useAuth()
  const key = `nav-pins:${user?.id ?? 'anon'}`
  const [store, setStore] = useState<{ key: string; pins: string[] }>(() => ({ key, pins: readJson(key, ['/home']) }))
  // Signing in as someone else on the same browser swaps in their pins.
  let pins = store.pins
  if (store.key !== key) {
    pins = readJson(key, ['/home'])
    setStore({ key, pins })
  }
  const toggle = useCallback((to: string) => {
    setStore(prev => {
      const next = prev.pins.includes(to) ? prev.pins.filter(p => p !== to) : [...prev.pins, to]
      writeJson(prev.key, next)
      return { key: prev.key, pins: next }
    })
  }, [])
  return { pins, toggle }
}

// Everything the nav layouts draw from, worked out once in the shell so the
// sidebar, the phone drawer and the top bar agree (a pin made in one shows
// in the others straight away).
export interface NavData {
  groups: NavGroup[]
  active: ActiveNav
  pins: string[]
  togglePin: (to: string) => void
}
export function useNavData(): NavData {
  const groups = useVisibleNav()
  const active = useActiveNav(groups)
  const { pins, toggle } = usePins()
  return { groups, active, pins, togglePin: toggle }
}

// The pseudo-section holding someone's pins, shown ahead of the real ones.
export const PINNED = 'Pinned'

// The pinned paths, turned back into items the person can still open.
export function pinnedItems(groups: NavGroup[], pins: string[]): NavItem[] {
  const byPath = new Map<string, NavItem>()
  for (const g of groups) for (const i of g.items) if (!byPath.has(i.to)) byPath.set(i.to, i)
  return pins.map(p => byPath.get(p)).filter((i): i is NavItem => !!i)
}

// Runs of items under their subgroup heading, in config order.
export function subgroupRuns(items: NavItem[]): { heading?: string; items: NavItem[] }[] {
  const runs: { heading?: string; items: NavItem[] }[] = []
  for (const item of items) {
    const last = runs[runs.length - 1]
    if (last && last.heading === item.subgroup) last.items.push(item)
    else runs.push({ heading: item.subgroup, items: [item] })
  }
  return runs
}

// ── Page palette ──────────────────────────────────────────────────────────
// Anything can open the "jump to page" palette without holding a reference
// to it; the palette listens for this event (and Ctrl/⌘ K).
export const OPEN_PALETTE_EVENT = 'kuncho:open-page-palette'
export function openPagePalette() {
  window.dispatchEvent(new Event(OPEN_PALETTE_EVENT))
}
