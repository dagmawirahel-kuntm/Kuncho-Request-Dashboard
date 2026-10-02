// Grouping the places people typed into transport jobs, so "Merkato",
// "merkato wenber tera" and "Mercato" are tidied once, together.

export interface TypedPlace { place_key: string; place: string; times: number; last_used_at: string | null }

export interface PlaceGroup {
  key: string
  name: string
  spellings: TypedPlace[]
  times: number
  /** Typed as two or more places in one box ("Gerji and Urael"). */
  several: boolean
}

// Spellings of the same Amharic name.
const SAME: [RegExp, string][] = [
  [/\bmercato\b/g, 'merkato'], [/\bpiyassa\b|\bpiasa\b/g, 'piassa'], [/\bemperial\b/g, 'imperial'],
  [/\bmesekel\b/g, 'meskel'], [/\bsky ?ligh(t)?\b/g, 'skylight'], [/\bb(e|i)herawi\b|\bbiherawi\b/g, 'biherawi'],
  [/\btorhayloch\b|\btorhailoch\b/g, 'torhailoch'], [/\bmegenaga\b/g, 'megenagna'], [/\bgolagole\b/g, 'golagol'],
]
// Words that don't change which place it is.
const FILLER = new Set(['the', 'site', 'area', 'around', 'project', 'hotel', 'office', 'old', 'new', 'near', 'at', 'to', 'from', 'tera', 'sefer', 'akababi'])

export function normalisePlace(s: string) {
  let t = s.toLowerCase().replace(/[\n\r]+/g, ' ').replace(/[()\-–_.,;:/]+/g, ' ').replace(/\s+/g, ' ').trim()
  for (const [re, to] of SAME) t = t.replace(re, to)
  return t
}

function core(s: string) {
  return normalisePlace(s).split(' ').filter(w => w && !FILLER.has(w) && !/^\d+$/.test(w)).join(' ')
}

export function looksLikeSeveral(s: string) {
  const t = s.toLowerCase()
  return /\n/.test(s.trim()) || /\s(and|or|&)\s/.test(t) || /,\s*\w/.test(t)
}

function lev(a: string, b: string) {
  if (a === b) return 0
  const m = a.length, n = b.length
  const d = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    let prev = d[0]; d[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = d[j]
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return d[n]
}

/** Same place? Exact core, one starts with the other as whole words, or a small typo. */
export function samePlace(a: string, b: string) {
  const x = core(a), y = core(b)
  if (!x || !y) return false
  if (x === y) return true
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  if (long.startsWith(short + ' ') && short.length >= 4) return true
  const limit = Math.max(1, Math.floor(Math.min(x.length, y.length) / 6))
  return lev(x, y) <= limit
}

export function groupTypedPlaces(rows: TypedPlace[]): PlaceGroup[] {
  const sorted = [...rows].sort((a, b) => b.times - a.times)
  const groups: PlaceGroup[] = []
  for (const r of sorted) {
    if (looksLikeSeveral(r.place)) {
      groups.push({ key: r.place_key, name: r.place.replace(/\s+/g, ' ').trim(), spellings: [r], times: r.times, several: true })
      continue
    }
    const g = groups.find(x => !x.several && samePlace(x.spellings[0].place, r.place))
    if (g) { g.spellings.push(r); g.times += r.times }
    else groups.push({ key: r.place_key, name: tidyName(r.place), spellings: [r], times: r.times, several: false })
  }
  return groups.sort((a, b) => Number(a.several) - Number(b.several) || b.times - a.times)
}

function tidyName(s: string) {
  return normalisePlace(s).split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

/** A saved location this group probably is (by name or other names). */
export function matchSaved<T extends { id: string; location_name: string; aliases?: string[] | null }>(g: PlaceGroup, saved: T[]): T | null {
  for (const l of saved) {
    const names = [l.location_name, ...(l.aliases ?? [])]
    if (g.spellings.some(sp => names.some(n => samePlace(n, sp.place)))) return l
  }
  return null
}
