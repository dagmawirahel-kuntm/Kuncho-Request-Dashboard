// Seasonal moments — the app dressing itself for a holiday, on a clock.
//
// A moment is a date window plus a visual mode. Everything that reacts to
// one (the background canvas, the greeting card, the sidebar mark, the
// accent layer on <html>) reads it from here, so the window is defined once
// and the treatment switches on and off by itself: nobody has to remember to
// take it down.
//
// Meskel 2026 is the first. It is built to arrive gradually rather than
// switch on for the day:
//
//   bloom   Thu 24 00:00 → Sat 26 18:00   Adey Abeba daisies join the Ge'ez
//                                          numerals, their share growing from
//                                          a few to about a third by Saturday
//                                          evening; the greeting counts down.
//   demera  Sat 26 18:00 → Sun 27 00:00   the Demera is lit: embers rise from
//                                          a glow along the bottom edge.
//   meskel  Sun 27                         daisies throughout, the full greeting.
//   after   Mon 28                         the daisies thin out through the day
//                                          and are gone by midnight.
//
// All boundaries are Addis Ababa time (UTC+3, no daylight saving), written
// as absolute instants so the result is the same whatever timezone the
// viewer's machine is set to.

export type SeasonPhase = 'bloom' | 'demera' | 'meskel' | 'after'

export interface SeasonMoment {
  /** Which holiday, and which year of it — keys greeting dismissals. */
  key: string
  phase: SeasonPhase
  /** Share (0–1) of background particles drawn as Adey Abeba daisies. */
  daisyShare: number
  /** Whether the accent layer, sidebar mark and greeting are on. */
  festive: boolean
  /** Addis calendar days until Meskel: 3 on Thursday, 1 on Saturday, 0 on the day. */
  daysToMeskel: number
  /** Which greeting to show, or null for none. Each day's message is its own
   *  variant, so dismissing Thursday's countdown doesn't hide Friday's. */
  greeting: 'countdown' | 'eve' | 'demera' | 'meskel' | null
}

const ADDIS_OFFSET_MS = 3 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

const MESKEL_2026 = {
  key: 'meskel-2026',
  start: Date.parse('2026-09-24T00:00:00+03:00'),
  demera: Date.parse('2026-09-26T18:00:00+03:00'),
  meskel: Date.parse('2026-09-27T00:00:00+03:00'),
  after: Date.parse('2026-09-28T00:00:00+03:00'),
  end: Date.parse('2026-09-29T00:00:00+03:00'),
}

// Bloom starts sparse and fills in, so the change is noticed as a build-up
// over the week rather than a sudden redecoration.
const BLOOM_FROM = 0.08
const BLOOM_TO = 0.35
const MESKEL_SHARE = 0.6

/** Whole days on the Addis calendar, so "days to go" flips at local midnight. */
function addisDay(ms: number): number {
  return Math.floor((ms + ADDIS_OFFSET_MS) / DAY_MS)
}

function momentAt(now: number): SeasonMoment | null {
  const s = MESKEL_2026
  if (now < s.start || now >= s.end) return null
  const daysToMeskel = Math.max(0, addisDay(s.meskel) - addisDay(now))

  if (now < s.demera) {
    const p = (now - s.start) / (s.demera - s.start)
    return {
      key: s.key, phase: 'bloom', festive: true, daysToMeskel,
      daisyShare: BLOOM_FROM + (BLOOM_TO - BLOOM_FROM) * p,
      greeting: daysToMeskel <= 1 ? 'eve' : 'countdown',
    }
  }
  if (now < s.meskel) {
    return { key: s.key, phase: 'demera', festive: true, daysToMeskel, daisyShare: 0, greeting: 'demera' }
  }
  if (now < s.after) {
    return { key: s.key, phase: 'meskel', festive: true, daysToMeskel: 0, daisyShare: MESKEL_SHARE, greeting: 'meskel' }
  }
  const p = (now - s.after) / (s.end - s.after)
  return { key: s.key, phase: 'after', festive: false, daysToMeskel: 0, daisyShare: MESKEL_SHARE * (1 - p), greeting: null }
}

// ── Preview ──────────────────────────────────────────────────────────────────
// Open any page with ?season=bloom|demera|meskel|after to see that phase now,
// ?season=off to see the app with no season, and ?season=auto to go back to
// the clock. The choice is kept for the browser tab, because navigating
// inside the app drops the query string.

const PREVIEW_KEY = 'season-preview'
const PREVIEW_AT: Record<SeasonPhase, number> = {
  bloom: Date.parse('2026-09-25T12:00:00+03:00'),
  demera: Date.parse('2026-09-26T20:00:00+03:00'),
  meskel: Date.parse('2026-09-27T12:00:00+03:00'),
  after: Date.parse('2026-09-28T08:00:00+03:00'),
}

function readPreview(): SeasonPhase | 'off' | null {
  try {
    const q = new URLSearchParams(window.location.search).get('season')
    if (q === 'auto') sessionStorage.removeItem(PREVIEW_KEY)
    else if (q === 'off' || (q && q in PREVIEW_AT)) sessionStorage.setItem(PREVIEW_KEY, q)
    const v = sessionStorage.getItem(PREVIEW_KEY)
    return v === 'off' || (v && v in PREVIEW_AT) ? (v as SeasonPhase | 'off') : null
  } catch {
    return null
  }
}

export function getSeasonMoment(now: number = Date.now()): SeasonMoment | null {
  const preview = typeof window === 'undefined' ? null : readPreview()
  if (preview === 'off') return null
  if (preview) return momentAt(PREVIEW_AT[preview])
  return momentAt(now)
}

/** Same moment for rendering purposes — lets callers skip no-op updates. */
export function sameMoment(a: SeasonMoment | null, b: SeasonMoment | null): boolean {
  if (!a || !b) return a === b
  return a.key === b.key && a.phase === b.phase && a.greeting === b.greeting
    && a.daysToMeskel === b.daysToMeskel && Math.abs(a.daisyShare - b.daisyShare) < 0.01
}
