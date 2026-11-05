import { useEffect, useState } from 'react'

// The way back. A link followed from inside a page — a suggestion, a nudge,
// "Open to approve", a to-do in the bell — leaves a trail to the page it was
// followed from, named by that page's own heading. Trails stack: bank line →
// expense → vendor, and back unwinds one step at a time. Kept per browser
// tab for a few hours; a bar (ReturnTrailBar) shows the latest.

export interface Trail {
  /** Path and query to go back to. */
  to: string
  /** The page, as it names itself: "Bank Reconciliation", "GEN-LABO-20261012-01". */
  label: string
  /** What was open there: "CBE Main · 12 Oct · ETB 5,000.00 · TRF …". */
  detail?: string | null
  /** Where the page was in the browser's history, so going back can step back to it rather than add a page. */
  idx?: number | null
  at: number
}
interface Store { trails: Trail[]; nudgedAt?: number | null }

const KEY = 'kuncho:return-trail'
const NOTE_KEY = 'kuncho:work-place-note'
const EVENT = 'kuncho:return-trail'
const MAX_AGE = 3 * 60 * 60_000
const MAX_DEPTH = 5

export const pathOf = (to: string) => to.split('?')[0]

function read<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch { return null }
}
function write(key: string, value: unknown) {
  try {
    if (value == null) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, JSON.stringify(value))
  } catch { /* private mode: the bar just won't show */ }
}

function readStore(): Store {
  const s = read<Store>(KEY)
  const trails = (s?.trails ?? []).filter(t => Date.now() - t.at < MAX_AGE)
  return { trails, nudgedAt: trails.length ? s?.nudgedAt ?? null : null }
}
function save(s: Store) {
  write(KEY, s.trails.length ? s : null)
  window.dispatchEvent(new Event(EVENT))
}

export const readTrails = () => readStore().trails

/** Leave a trail back to a page. Following links on the same page again only refreshes it. */
export function pushTrail(t: Omit<Trail, 'at'>) {
  const { trails } = readStore()
  const top = trails[trails.length - 1]
  const rest = top && pathOf(top.to) === pathOf(t.to) ? trails.slice(0, -1) : trails
  save({ trails: [...rest, { ...t, at: Date.now() }].slice(-MAX_DEPTH), nudgedAt: null })
}
/** Arrived back at trails[index]: it and everything after it are done. */
export function popTrailsTo(index: number) {
  const s = readStore()
  save({ trails: s.trails.slice(0, index), nudgedAt: null })
}
export function clearTrails() { save({ trails: [] }) }
/** Something was just done: if a trail is waiting, the bar asks to go back. */
export function nudgeTrail() {
  const s = readStore()
  if (s.trails.length) save({ ...s, nudgedAt: Date.now() })
}

export function useTrails(): Store {
  const [store, setStore] = useState<Store>(() => readStore())
  useEffect(() => {
    const on = () => setStore(readStore())
    window.addEventListener(EVENT, on)
    return () => window.removeEventListener(EVENT, on)
  }, [])
  return store
}

/**
 * A page says what is open on it ("CBE · 12 Oct · 5,000.00"), so a trail
 * left from it can name it. Keyed by path: a stale note never names another page.
 */
export function noteWorkPlace(path: string, detail: string | null) {
  write(NOTE_KEY, detail ? { path, detail } : null)
}
export function workPlaceNote(path: string): string | null {
  const n = read<{ path: string; detail: string }>(NOTE_KEY)
  return n && n.path === path ? n.detail : null
}

/** A form is never a way back: after saving, the trail points before it. */
export const canLeaveTrail = (path: string) => !/\/(new|edit)(\/|$)|^\/login/.test(path)

/** Going up to a page's own list ("← Approvals") is a deliberate return, not a detour. */
export const isUpFrom = (from: string, to: string) => to !== '/' && from.startsWith(`${to}/`)
