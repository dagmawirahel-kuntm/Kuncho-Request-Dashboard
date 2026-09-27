import { useMemo, type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'

// A client's "world": the colours their pages are painted in. Read from the
// logo itself when it has one (Brandfetch serves logos with CORS, so the
// pixels can be sampled), otherwise built from the client's hash colour, so
// every client gets a world of its own.

type RGB = [number, number, number]

export interface WorldPalette {
  /** Three accent colours, the logo's strongest first. */
  colors: [string, string, string]
  /** Dark versions of the first two, for the hero behind white text. */
  deep: [string, string]
  /** 'light' when the logo is mostly white (it needs a dark tile). */
  logoTone: 'light' | 'dark'
  fromLogo: boolean
}

export interface ClientWorld {
  name: string
  initials: string
  logo: string | null
  palette: WorldPalette
}

// ── colour maths ────────────────────────────────────────────────────────────
function hexToRgb(hex: string): RGB {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function rgbToHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')
}
function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}
function hslToRgb(h: number, s: number, l: number): RGB {
  h = ((h % 360) + 360) % 360 / 360
  if (s === 0) return [l * 255, l * 255, l * 255]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255]
}
const hsl = (h: number, s: number, l: number) => rgbToHex(hslToRgb(h, s, l))

/** Same hue, pushed dark enough to carry white text. */
function deepen(hex: string): string {
  const [h, s, l] = rgbToHsl(hexToRgb(hex))
  return hsl(h, Math.min(0.78, Math.max(0.35, s)), Math.min(0.34, Math.max(0.2, l * 0.62)))
}
/** Same hue, bright and saturated enough to glow. */
function brighten(hex: string): string {
  const [h, s, l] = rgbToHsl(hexToRgb(hex))
  return hsl(h, Math.max(0.55, Math.min(0.9, s)), Math.min(0.62, Math.max(0.46, l)))
}

/** Hex with alpha, e.g. alpha('#3B82F6', 0.2). */
export function alpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r},${g},${b},${a})`
}

function build(c1: string, c2: string, c3: string, logoTone: 'light' | 'dark', fromLogo: boolean): WorldPalette {
  const colors: [string, string, string] = [brighten(c1), brighten(c2), brighten(c3)]
  return { colors, deep: [deepen(c1), deepen(c2)], logoTone, fromLogo }
}

/** A world from the client's hash colour: the colour and two neighbours. */
export function fallbackPalette(base: string): WorldPalette {
  const [h, s, l] = rgbToHsl(hexToRgb(base))
  return build(base, hsl(h + 38, s, Math.min(0.6, l + 0.06)), hsl(h - 42, s * 0.9, l), 'dark', false)
}

// ── reading the logo ────────────────────────────────────────────────────────
interface Sampled { accents: string[]; logoTone: 'light' | 'dark' }

function sample(url: string): Promise<Sampled | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onerror = () => resolve(null)
    img.onload = () => {
      try {
        const S = 72
        const k = Math.min(S / img.naturalWidth, S / img.naturalHeight, 1) || 1
        const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k))
        const c = document.createElement('canvas')
        c.width = w; c.height = h
        const ctx = c.getContext('2d', { willReadFrequently: true })
        if (!ctx) return resolve(null)
        ctx.drawImage(img, 0, 0, w, h)
        const px = ctx.getImageData(0, 0, w, h).data

        // Hue buckets of the vivid pixels, weighted by saturation.
        const BINS = 24
        const bins = Array.from({ length: BINS }, () => ({ w: 0, r: 0, g: 0, b: 0 }))
        let opaque = 0, light = 0
        for (let i = 0; i < px.length; i += 4) {
          if (px[i + 3] < 160) continue
          opaque++
          const rgb: RGB = [px[i], px[i + 1], px[i + 2]]
          const [hh, ss, ll] = rgbToHsl(rgb)
          if (ll > 0.82) light++
          if (ss < 0.28 || ll < 0.14 || ll > 0.86) continue
          const bin = bins[Math.floor(hh / (360 / BINS)) % BINS]
          const wt = ss * (1 - Math.abs(ll - 0.5))
          bin.w += wt; bin.r += rgb[0] * wt; bin.g += rgb[1] * wt; bin.b += rgb[2] * wt
        }
        if (opaque === 0) return resolve(null)
        const ranked = bins.map((b, i) => ({ ...b, i })).filter(b => b.w > 0).sort((a, b) => b.w - a.w)
        const picked: typeof ranked = []
        for (const b of ranked) {
          if (picked.length === 3) break
          if (b.w < (ranked[0]?.w ?? 0) * 0.12) break
          // Keep accents at least 45° apart so the world has some range.
          if (picked.every(p => Math.min(Math.abs(p.i - b.i), BINS - Math.abs(p.i - b.i)) >= 3)) picked.push(b)
        }
        resolve({
          accents: picked.map(b => rgbToHex([b.r / b.w, b.g / b.w, b.b / b.w])),
          logoTone: light / opaque > 0.55 ? 'light' : 'dark',
        })
      } catch {
        resolve(null) // no CORS: the canvas is tainted
      }
    }
    img.src = url
  })
}

function fromSample(s: Sampled | null | undefined, base: string): WorldPalette {
  if (!s || s.accents.length === 0) {
    const fb = fallbackPalette(base)
    return s ? { ...fb, logoTone: s.logoTone } : fb
  }
  const [a, b, c] = s.accents
  const [h, sat, l] = rgbToHsl(hexToRgb(a))
  return build(
    a,
    b ?? hsl(h + 38, sat, Math.min(0.6, l + 0.08)),
    c ?? hsl(h - 42, sat * 0.9, l),
    s.logoTone, true,
  )
}

/**
 * The world for one client. `base` is its hash colour (clientColor), used
 * until the logo has been read and whenever it can't be.
 */
export function useClientWorld(name: string | null | undefined, logo: string | null | undefined, base: string): ClientWorld {
  const { data } = useQuery({
    queryKey: ['client-logo-palette', logo],
    enabled: !!logo,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
    queryFn: () => sample(logo!),
  })
  const palette = useMemo(() => fromSample(logo ? data : null, base), [data, logo, base])
  const n = name ?? ''
  return useMemo(() => ({ name: n, initials: initialsOf(n), logo: logo ?? null, palette }), [n, logo, palette])
}

function initialsOf(name: string) {
  const w = name.trim().split(/\s+/).filter(Boolean)
  if (w.length === 0) return ''
  return w.length >= 2 ? (w[0][0] + w[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase()
}

/** CSS custom properties that paint a subtree in a client's colours. */
export function worldVars(p: WorldPalette): CSSProperties {
  return {
    '--w1': p.colors[0], '--w2': p.colors[1], '--w3': p.colors[2],
    '--wd1': p.deep[0], '--wd2': p.deep[1],
  } as CSSProperties
}

/** Name shared by a client's logo on every page, so it morphs between them. */
export const emblemTransitionName = (clientId: string) => `client-emblem-${clientId}`

/** Delay for the n-th piece of a hero's staggered entrance (class world-rise). */
export const riseDelay = (i: number) => ({ '--d': `${140 + i * 70}ms` } as CSSProperties)
