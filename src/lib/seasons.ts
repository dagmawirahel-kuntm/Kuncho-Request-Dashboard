// Seasonal moments — the app dressing itself for a holiday, on a clock.
//
// A moment is a date window plus a visual mode. Everything that reacts to
// one (the background canvas, the greeting card, the logo mark, the accent
// layer on <html>) reads it from here, so the window is defined once and
// the treatment switches on and off by itself: nobody has to remember to
// take it down.
//
// Two seasons so far, each built to arrive gradually rather than switch on
// for the day.
//
// Meskel 2026 (Adey Abeba daisies, the Demera lit on the eve):
//   bloom   Thu 24 Sep → Sat 26 18:00   daisies join the Ge'ez numerals, a few
//                                        to about a third by Saturday evening
//   demera  Sat 26 18:00 → Sun 27       embers rise from a glow along the bottom
//   meskel  Sun 27                       daisies throughout, the full greeting
//   after   Mon 28                       the daisies thin out, gone by midnight
//
// The festive season 2026–27 (candles and stars, Christmas → New Year → Gena):
//   gathering  Wed 25 Nov → Wed 6 Jan 18:00   candles and gold stars join the
//                                              numerals, from a few on the first
//                                              day to about a third on Gena eve
//   christmas  Thu 24 Dec 18:00 → Sat 26       stars brighten for Christmas
//   newyear    Thu 31 Dec 18:00 → Sat 2 Jan    gold sparks burst here and there
//   vigil      Wed 6 Jan 18:00 → Thu 7          Gena eve: the numerals fall back
//                                              and candles glow along the bottom,
//                                              as at the night-long service
//   gena       Thu 7 Jan (Tahsas 29)            stars and candles throughout,
//                                              the full Amharic greeting
//   after      Fri 8 Jan                        it thins out, gone by midnight
//
// All boundaries are Addis Ababa time (UTC+3, no daylight saving), written
// as absolute instants so the result is the same whatever timezone the
// viewer's machine is set to.

export type SeasonMotif = 'meskel' | 'festive'

export type SeasonPhase =
  | 'bloom' | 'demera' | 'meskel' | 'after'
  | 'gathering' | 'christmas' | 'newyear' | 'vigil' | 'gena' | 'festive-after'

export type SeasonGreetingVariant =
  // Meskel
  | 'countdown' | 'eve' | 'demera' | 'meskel'
  // The festive season
  | 'season-open'
  | 'christmas-soon' | 'christmas-eve' | 'christmas'
  | 'newyear-soon' | 'newyear-eve' | 'newyear'
  | 'gena-soon' | 'gena-eve' | 'gena'

export interface SeasonMoment {
  /** Which holiday, and which year of it — keys greeting dismissals. */
  key: string
  motif: SeasonMotif
  phase: SeasonPhase
  /** Share (0–1) of background particles drawn as the season's ornament:
   *  Adey Abeba for Meskel, candles and stars for the festive season. */
  ornamentShare: number
  /** Whether the accent layer and logo mark are on. */
  festive: boolean
  /** Addis calendar days until the day the greeting is counting down to
   *  (Meskel, Christmas, New Year or Gena): 0 on the day itself. */
  daysTo: number
  /** Which greeting to show, or null for none. Each day's message is its own
   *  variant, so dismissing one day's countdown doesn't hide the next. */
  greeting: SeasonGreetingVariant | null
}

const ADDIS_OFFSET_MS = 3 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const at = (iso: string) => Date.parse(iso)

/** Whole days on the Addis calendar, so "days to go" flips at local midnight. */
function addisDay(ms: number): number {
  return Math.floor((ms + ADDIS_OFFSET_MS) / DAY_MS)
}
const daysBetween = (now: number, target: number) => Math.max(0, addisDay(target) - addisDay(now))

// ── Meskel 2026 ──────────────────────────────────────────────────────────────

const MESKEL_2026 = {
  key: 'meskel-2026',
  start: at('2026-09-24T00:00:00+03:00'),
  demera: at('2026-09-26T18:00:00+03:00'),
  meskel: at('2026-09-27T00:00:00+03:00'),
  after: at('2026-09-28T00:00:00+03:00'),
  end: at('2026-09-29T00:00:00+03:00'),
}
const BLOOM_FROM = 0.08
const BLOOM_TO = 0.35
const MESKEL_SHARE = 0.6

function meskelAt(now: number): SeasonMoment | null {
  const s = MESKEL_2026
  if (now < s.start || now >= s.end) return null
  const daysTo = daysBetween(now, s.meskel)
  const base = { key: s.key, motif: 'meskel' as const, daysTo }
  if (now < s.demera) {
    const p = (now - s.start) / (s.demera - s.start)
    return { ...base, phase: 'bloom', festive: true, ornamentShare: BLOOM_FROM + (BLOOM_TO - BLOOM_FROM) * p, greeting: daysTo <= 1 ? 'eve' : 'countdown' }
  }
  if (now < s.meskel) return { ...base, phase: 'demera', festive: true, ornamentShare: 0, greeting: 'demera' }
  if (now < s.after) return { ...base, phase: 'meskel', festive: true, ornamentShare: MESKEL_SHARE, greeting: 'meskel' }
  const p = (now - s.after) / (s.end - s.after)
  return { ...base, phase: 'after', festive: false, ornamentShare: MESKEL_SHARE * (1 - p), greeting: null }
}

// ── The festive season 2026–27 ───────────────────────────────────────────────

const FESTIVE_2026 = {
  key: 'festive-2026',
  start: at('2026-11-25T00:00:00+03:00'),
  openUntil: at('2026-12-02T00:00:00+03:00'),        // the "season is here" card, first week
  christmasSoon: at('2026-12-22T00:00:00+03:00'),
  christmasEve: at('2026-12-24T18:00:00+03:00'),
  christmas: at('2026-12-25T00:00:00+03:00'),
  christmasEnd: at('2026-12-26T00:00:00+03:00'),
  newyearSoon: at('2026-12-30T00:00:00+03:00'),
  newyearEve: at('2026-12-31T18:00:00+03:00'),
  newyear: at('2027-01-01T00:00:00+03:00'),
  newyearEnd: at('2027-01-02T00:00:00+03:00'),
  genaEve: at('2027-01-06T18:00:00+03:00'),
  gena: at('2027-01-07T00:00:00+03:00'),
  after: at('2027-01-08T00:00:00+03:00'),
  end: at('2027-01-09T00:00:00+03:00'),
}
// The lights gather over six weeks; Christmas, New Year and Gena itself
// are brighter than the build-up around them.
const GATHER_FROM = 0.06
const GATHER_TO = 0.35
const HOLIDAY_SHARE = 0.5
const GENA_SHARE = 0.6

function festiveAt(now: number): SeasonMoment | null {
  const s = FESTIVE_2026
  if (now < s.start || now >= s.end) return null
  const base = { key: s.key, motif: 'festive' as const }
  const gathered = GATHER_FROM + (GATHER_TO - GATHER_FROM) * Math.min(1, (now - s.start) / (s.genaEve - s.start))

  if (now >= s.after) {
    const p = (now - s.after) / (s.end - s.after)
    return { ...base, phase: 'festive-after', festive: false, ornamentShare: GENA_SHARE * (1 - p), daysTo: 0, greeting: null }
  }
  if (now >= s.gena) return { ...base, phase: 'gena', festive: true, ornamentShare: GENA_SHARE, daysTo: 0, greeting: 'gena' }
  if (now >= s.genaEve) return { ...base, phase: 'vigil', festive: true, ornamentShare: 0, daysTo: 1, greeting: 'gena-eve' }

  if (now >= s.newyearEve && now < s.newyearEnd) {
    const day = now >= s.newyear
    return { ...base, phase: 'newyear', festive: true, ornamentShare: Math.max(gathered, HOLIDAY_SHARE), daysTo: daysBetween(now, s.newyear), greeting: day ? 'newyear' : 'newyear-eve' }
  }
  if (now >= s.christmasEve && now < s.christmasEnd) {
    const day = now >= s.christmas
    return { ...base, phase: 'christmas', festive: true, ornamentShare: Math.max(gathered, HOLIDAY_SHARE), daysTo: daysBetween(now, s.christmas), greeting: day ? 'christmas' : 'christmas-eve' }
  }

  // The build-up: which card, if any, depends on what's next.
  let greeting: SeasonGreetingVariant | null = null
  let daysTo: number
  if (now < s.openUntil) { greeting = 'season-open'; daysTo = daysBetween(now, s.gena) }
  else if (now >= s.christmasSoon && now < s.christmasEve) { greeting = 'christmas-soon'; daysTo = daysBetween(now, s.christmas) }
  else if (now >= s.newyearSoon && now < s.newyearEve) { greeting = 'newyear-soon'; daysTo = daysBetween(now, s.newyear) }
  else if (now >= s.newyearEnd && now < s.genaEve) { greeting = 'gena-soon'; daysTo = daysBetween(now, s.gena) }
  else daysTo = daysBetween(now, s.gena)
  return { ...base, phase: 'gathering', festive: true, ornamentShare: gathered, daysTo, greeting }
}

function momentAt(now: number): SeasonMoment | null {
  return festiveAt(now) ?? meskelAt(now)
}

// ── Preview ──────────────────────────────────────────────────────────────────
// Open any page with ?season=<name> to see that moment now, ?season=off to
// see the app with no season, and ?season=auto to go back to the clock. The
// choice is kept for the browser tab, because navigating inside the app
// drops the query string.

const PREVIEW_KEY = 'season-preview'
const PREVIEW_AT: Record<string, number> = {
  // Meskel 2026
  bloom: at('2026-09-25T12:00:00+03:00'),
  demera: at('2026-09-26T20:00:00+03:00'),
  meskel: at('2026-09-27T12:00:00+03:00'),
  after: at('2026-09-28T08:00:00+03:00'),
  // The festive season 2026–27, in order
  'season-open': at('2026-11-26T12:00:00+03:00'),
  gathering: at('2026-12-15T12:00:00+03:00'),
  'christmas-soon': at('2026-12-23T12:00:00+03:00'),
  'christmas-eve': at('2026-12-24T20:00:00+03:00'),
  christmas: at('2026-12-25T12:00:00+03:00'),
  'newyear-soon': at('2026-12-30T12:00:00+03:00'),
  'newyear-eve': at('2026-12-31T21:00:00+03:00'),
  newyear: at('2027-01-01T12:00:00+03:00'),
  'gena-soon': at('2027-01-04T12:00:00+03:00'),
  'gena-eve': at('2027-01-06T20:00:00+03:00'),
  gena: at('2027-01-07T12:00:00+03:00'),
  'festive-after': at('2027-01-08T08:00:00+03:00'),
}
export const PREVIEW_NAMES = Object.keys(PREVIEW_AT)

function readPreview(): string | null {
  try {
    const q = new URLSearchParams(window.location.search).get('season')
    if (q === 'auto') sessionStorage.removeItem(PREVIEW_KEY)
    else if (q === 'off' || (q && q in PREVIEW_AT)) sessionStorage.setItem(PREVIEW_KEY, q)
    const v = sessionStorage.getItem(PREVIEW_KEY)
    return v === 'off' || (v && v in PREVIEW_AT) ? v : null
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
    && a.daysTo === b.daysTo && Math.abs(a.ornamentShare - b.ornamentShare) < 0.01
}

/** For tests and the preview page: the moment at an instant, ignoring any preview. */
export const seasonMomentAt = momentAt
