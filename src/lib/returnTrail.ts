import { useEffect, useState } from 'react'

// Where you were working before a link took you off it — a bank line, the
// approvals queue — so a bar can take you straight back, however many pages
// (approve, edit, save) lie in between. One trail at a time, per browser tab,
// for a few hours.

export interface Trail {
  /** Path and query to go back to. */
  to: string
  /** The place: "Bank reconciliation". */
  label: string
  /** What was open there: "CBE · 12 Oct · 5,000.00 · TRF ABEBE". */
  detail?: string | null
  at: number
  /** Set when something was just done (a success toast) — the bar asks to go back. */
  nudgedAt?: number | null
}

// The pages you work through, and come back to. A link followed from inside
// one of them leaves a trail back.
export const WORK_PLACES: { path: string; label: string }[] = [
  { path: '/bank-statement-import', label: 'Bank reconciliation' },
  { path: '/expenses/approvals', label: 'Approvals queue' },
  { path: '/finance/payments', label: 'Payments' },
  { path: '/batch-payments', label: 'Batch payments' },
  { path: '/expenses', label: 'Expenses' },
]
export const workPlaceOf = (pathname: string) => WORK_PLACES.find(p => p.path === pathname) ?? null

const KEY = 'kuncho:return-trail'
const NOTE_KEY = 'kuncho:work-place-note'
const EVENT = 'kuncho:return-trail'
const MAX_AGE = 3 * 60 * 60_000

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

export function readTrail(): Trail | null {
  const t = read<Trail>(KEY)
  return t && Date.now() - t.at < MAX_AGE ? t : null
}
function save(t: Trail | null) {
  write(KEY, t)
  window.dispatchEvent(new Event(EVENT))
}
export function setTrail(t: Omit<Trail, 'at'>) { save({ ...t, at: Date.now() }) }
export function clearTrail() { save(null) }
/** Something was just done: if a trail is waiting, the bar asks to go back. */
export function nudgeTrail() {
  const t = readTrail()
  if (t) save({ ...t, nudgedAt: Date.now() })
}

/**
 * A work place says what is open on it ("CBE · 12 Oct · 5,000.00"), so a
 * trail left from it can name it. Keyed by path: a stale note never names
 * another page.
 */
export function noteWorkPlace(path: string, detail: string | null) {
  write(NOTE_KEY, detail ? { path, detail } : null)
}
export function workPlaceNote(path: string): string | null {
  const n = read<{ path: string; detail: string }>(NOTE_KEY)
  return n && n.path === path ? n.detail : null
}

export function useTrail(): Trail | null {
  const [trail, setState] = useState<Trail | null>(() => readTrail())
  useEffect(() => {
    const on = () => setState(readTrail())
    window.addEventListener(EVENT, on)
    return () => window.removeEventListener(EVENT, on)
  }, [])
  return trail
}
