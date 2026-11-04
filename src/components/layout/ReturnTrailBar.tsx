import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { CheckCircle2, Undo2, X } from 'lucide-react'
import { navGroups } from './navConfig'
import {
  canLeaveTrail, clearTrails, isUpFrom, pathOf, popTrailsTo, pushTrail, readTrails, useTrails, workPlaceNote,
} from '@/lib/returnTrail'

const NUDGE_MS = 20_000
const NAV_ITEMS = navGroups.flatMap(g => [...(g.to ? [{ to: g.to, label: g.title }] : []), ...g.items.map(i => ({ to: i.to, label: i.label }))])

/** A page's name when it has no heading: its menu entry, or the nearest one above it. */
function navLabelFor(path: string): string {
  const exact = NAV_ITEMS.find(i => i.to === path)
  if (exact) return exact.label
  const parent = NAV_ITEMS.filter(i => i.to !== '/' && path.startsWith(`${i.to}/`)).sort((a, b) => b.to.length - a.to.length)[0]
  if (parent) return parent.label
  const first = path.split('/').filter(Boolean)[0] ?? 'Home'
  return first.replace(/[-_]+/g, ' ').replace(/^\w/, c => c.toUpperCase())
}

// A page's own "← Approvals" / "‹ Projects" link is a deliberate return.
function isBackLink(el: Element) {
  const icon = el.closest('a, button')?.querySelector(':scope > svg:first-child')
  return !!icon && (icon.classList.contains('lucide-arrow-left') || icon.classList.contains('lucide-chevron-left'))
}

/** The page as it names itself, read when you leave it. */
function pageLabel(path: string): string {
  const h1 = document.querySelector('main h1')?.textContent?.replace(/\s+/g, ' ').trim()
  const label = h1 || navLabelFor(path)
  return label.length > 60 ? `${label.slice(0, 57)}…` : label
}

/**
 * "You came from Bank Reconciliation · CBE Main · 12 Oct · ETB 5,000.00" —
 * over every page after a link inside a page (or the bell's to-do) took you
 * somewhere else, until you go back or close it. After something is done (a
 * success toast) it turns green and asks to go back and finish, so a task
 * doesn't stop halfway because the way back was lost. The sidebar, the top
 * menu and Ctrl K are deliberate moves and leave no trail.
 */
export function ReturnTrailBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { trails, nudgedAt } = useTrails()
  // Where a click that may navigate was made, captured before the next page draws.
  const origin = useRef<{ path: string; label: string; detail: string | null; at: number } | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = e.target as Element | null
      if (!el?.closest) return
      const inPage = el.closest('main, [data-trail]') && !el.closest('[data-no-trail]') && !isBackLink(el)
      if (!inPage) { origin.current = null; return }
      const path = window.location.pathname
      origin.current = { path: path + window.location.search, label: pageLabel(path), detail: workPlaceNote(path), at: Date.now() }
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  useEffect(() => {
    const o = origin.current
    origin.current = null
    // Back at a page on the trail (by the bar, a link or the browser): it
    // and every step after it are done.
    const now = readTrails()
    for (let i = now.length - 1; i >= 0; i--) {
      if (pathOf(now[i].to) === location.pathname) { popTrailsTo(i); return }
    }
    if (!o || Date.now() - o.at > 2000) return
    const from = pathOf(o.path)
    if (from === location.pathname || !canLeaveTrail(from) || isUpFrom(from, location.pathname)) return
    pushTrail({ to: o.path, label: o.label, detail: o.detail })
  }, [location.pathname, location.search])

  // A success elsewhere: say "done here? go back" for a while.
  useEffect(() => {
    if (!nudgedAt) return
    const id = setTimeout(() => setNow(Date.now()), Math.max(0, nudgedAt + NUDGE_MS - Date.now()) + 50)
    return () => clearTimeout(id)
  }, [nudgedAt])
  const nudged = !!nudgedAt && now - nudgedAt < NUDGE_MS

  const trail = trails[trails.length - 1]
  if (!trail || pathOf(trail.to) === location.pathname) return null
  const then = trails.length > 1 ? trails[trails.length - 2].label : null

  return (
    <div className="relative z-20 shrink-0 print:hidden" role="region" aria-label="Where you came from">
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-2 transition-colors sm:px-6 ${nudged
        ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/30'
        : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'}`}>
        {nudged ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden /> : <Undo2 className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />}
        <p className="min-w-0 flex-1 text-sm text-slate-600 dark:text-slate-300">
          {nudged ? <>Done here? <b className="text-slate-900 dark:text-white">Go back to {trail.label}</b> to finish it.</>
            : <>You came from <b className="text-slate-900 dark:text-white">{trail.label}</b>.</>}
          {(trail.detail || then) && (
            <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">
              {trail.detail}{trail.detail && then ? ' · ' : ''}{then ? `then ${then}` : ''}
            </span>
          )}
        </p>
        <button onClick={() => navigate(trail.to)}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 ${nudged
            ? 'bg-emerald-600 ring-2 ring-emerald-300 ring-offset-1 dark:ring-offset-slate-900' : 'bg-brand'}`}>
          <Undo2 className="h-4 w-4" /> Back to it
        </button>
        <button onClick={clearTrails} aria-label="Forget the way back" title="Forget the way back"
          className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
