import { useEffect, useState } from 'react'

// Small moments of delight — confetti, the submit stamp, a phone buzz — all
// pass through here so one switch turns them off. They stay off for anyone
// whose device asks for reduced motion, and for anyone who flips "Fun
// effects" off in the header. The words (toasts) always still show; only
// the motion goes.

const KEY = 'fun-effects'
const CHANGE = 'fun-effects-change'
const GOLD = ['#D4AF37', '#E8C547', '#a57d1c', '#151a1f']

function readSwitch() {
  try { return localStorage.getItem(KEY) !== 'off' } catch { return true }
}

function reducedMotion() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/** Whether a celebration may play right now. */
export function effectsAllowed() {
  return readSwitch() && !reducedMotion()
}

/** The header switch: [on, set]. */
export function useFunEffects(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(readSwitch)
  useEffect(() => {
    const sync = () => setOn(readSwitch())
    window.addEventListener(CHANGE, sync)
    window.addEventListener('storage', sync)
    return () => { window.removeEventListener(CHANGE, sync); window.removeEventListener('storage', sync) }
  }, [])
  return [on, (next: boolean) => {
    try { localStorage.setItem(KEY, next ? 'on' : 'off') } catch { /* nothing to do */ }
    window.dispatchEvent(new Event(CHANGE))
  }]
}

// ── Sounds ───────────────────────────────────────────────────────────
// Off unless someone turns them on (offices are quiet places). Small
// tones made with Web Audio, so there are no files to download.

const SOUND_KEY = 'fun-sounds'

function readSounds() {
  try { return localStorage.getItem(SOUND_KEY) === 'on' } catch { return false }
}

/** The header's second switch: [on, set]. Off by default. */
export function useFunSounds(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(readSounds)
  useEffect(() => {
    const sync = () => setOn(readSounds())
    window.addEventListener(CHANGE, sync)
    window.addEventListener('storage', sync)
    return () => { window.removeEventListener(CHANGE, sync); window.removeEventListener('storage', sync) }
  }, [])
  return [on, (next: boolean) => {
    try { localStorage.setItem(SOUND_KEY, next ? 'on' : 'off') } catch { /* nothing to do */ }
    window.dispatchEvent(new Event(CHANGE))
  }]
}

export type Chime = 'tap' | 'stamp' | 'success' | 'fanfare'

// Notes (Hz) and when each starts (s): short, soft, major-key.
const TUNES: Record<Chime, [number, number][]> = {
  tap: [[880, 0]],
  stamp: [[392, 0], [587.3, 0.09]],
  success: [[523.3, 0], [659.3, 0.08], [784, 0.16]],
  fanfare: [[523.3, 0], [659.3, 0.1], [784, 0.2], [1046.5, 0.32]],
}

let audio: AudioContext | null = null

/** A soft chime, when sounds are on. */
export function chime(kind: Chime) {
  if (!readSounds()) return
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    audio ??= new Ctx()
    const ctx = audio
    if (ctx.state === 'suspended') void ctx.resume()
    const t0 = ctx.currentTime + 0.01
    for (const [freq, at] of TUNES[kind]) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, t0 + at)
      gain.gain.linearRampToValueAtTime(0.12, t0 + at + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.35)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t0 + at)
      osc.stop(t0 + at + 0.4)
    }
  } catch { /* no audio here — fine */ }
}

export type ConfettiSize = 'pop' | 'burst' | 'big'

/**
 * Gold confetti. `from` is the element it bursts out of (the page centre
 * when left out). canvas-confetti is loaded on first use, so no page pays
 * for it until something is worth celebrating.
 */
export async function confetti(size: ConfettiSize = 'burst', from?: Element | null) {
  if (!effectsAllowed()) return
  const { default: fire } = await import('canvas-confetti')
  let origin = { x: 0.5, y: 0.45 }
  const r = from?.getBoundingClientRect()
  // A hidden element (the ring is hidden on phones) has no box: use the centre.
  if (r && r.width > 0) {
    origin = { x: (r.left + r.width / 2) / window.innerWidth, y: (r.top + r.height / 2) / window.innerHeight }
  }
  const base = { origin, colors: GOLD, disableForReducedMotion: true, zIndex: 60 }
  if (size === 'pop') { fire({ ...base, particleCount: 40, spread: 55, startVelocity: 28, scalar: 0.8 }); return }
  fire({ ...base, particleCount: 90, spread: 75, startVelocity: 38 })
  if (size === 'big') {
    window.setTimeout(() => fire({ ...base, particleCount: 70, angle: 60, spread: 60, origin: { x: 0, y: 0.7 } }), 180)
    window.setTimeout(() => fire({ ...base, particleCount: 70, angle: 120, spread: 60, origin: { x: 1, y: 0.7 } }), 300)
  }
}

/** A burst of one emoji — hearts for thanks received, say. */
export async function emojiBurst(emoji: string, from?: Element | null) {
  if (!effectsAllowed()) return
  const { default: fire } = await import('canvas-confetti')
  const r = from?.getBoundingClientRect()
  const origin = r && r.width > 0
    ? { x: (r.left + r.width / 2) / window.innerWidth, y: (r.top + r.height / 2) / window.innerHeight }
    : { x: 0.5, y: 0.5 }
  const shape = fire.shapeFromText({ text: emoji, scalar: 2 })
  fire({ origin, shapes: [shape], scalar: 2, particleCount: 28, spread: 80, startVelocity: 30, gravity: 0.7, ticks: 160, flat: true, disableForReducedMotion: true, zIndex: 60 })
}

/** A short buzz on phones that support it. */
export function buzz(pattern: number | number[] = 30) {
  if (!effectsAllowed()) return
  try { navigator.vibrate?.(pattern) } catch { /* not supported */ }
}

/**
 * True the first time it is asked for `key` on a given day, false after —
 * so a celebration tied to a state (queue at zero) plays once, not on every
 * visit to the page.
 */
export function firstTimeToday(key: string, day = new Date().toISOString().slice(0, 10)) {
  const k = `celebrated:${key}`
  try {
    if (localStorage.getItem(k) === day) return false
    localStorage.setItem(k, day)
    return true
  } catch { return false }
}

// ── The submit stamp ────────────────────────────────────────────────
// A form that creates something calls submitted(); the stamp host in the
// app shell plays it, so it survives the form navigating away.

const STAMP = 'kuncho-stamp'
export interface StampDetail { title: string; note?: string }

/**
 * Says a new record went in: the ቁ stamp when effects are on, the plain
 * toast otherwise.
 */
export function submitted(toast: (message: string, type?: 'success') => void, title: string, note?: string) {
  if (!effectsAllowed()) { toast(note ? `${title}. ${note}` : title, 'success'); chime('stamp'); return }
  window.dispatchEvent(new CustomEvent<StampDetail>(STAMP, { detail: { title, note } }))
  buzz(25)
  chime('stamp')
}

export function onStamp(handler: (d: StampDetail) => void) {
  const listener = (e: Event) => handler((e as CustomEvent<StampDetail>).detail)
  window.addEventListener(STAMP, listener)
  return () => window.removeEventListener(STAMP, listener)
}
