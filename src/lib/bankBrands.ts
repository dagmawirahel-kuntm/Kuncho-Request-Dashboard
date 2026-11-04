// Each bank's look on the reconciliation screens: its colours and logo, so
// its statement and queue feel like its own website. The defaults below are
// what the app knows of each brand; finance can set an account's exact
// colours and upload its logo (accounts.brand_color / brand_accent /
// brand_logo_url, migration 497), which win over the defaults.
//
// A screen is put in a bank's colours by wrapping it in an element with
// `bank-theme` and `brandVars(brand)`: the app's accent colour (--color-brand)
// becomes the bank's inside it, so its buttons, tabs and highlights follow.

import type { CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface BankBrand {
  key: string
  bank: string
  /** A short mark for the logo tile when there's no logo. */
  short: string
  primary: string
  accent: string
  logoUrl: string | null
  /** The app knows this bank's brand (not the neutral look). */
  known: boolean
  /** Finance set this account's colours or logo themselves. */
  custom: boolean
}

interface Known { key: string; bank: string; short: string; primary: string; accent: string; match: RegExp }

// Matched on the account's name in the app (e.g. "ZMNBNK", "BOA") or the
// bank's name, and on the statement profile's id (profiles.ts).
export const KNOWN_BANKS: Known[] = [
  { key: 'cbe', bank: 'Commercial Bank of Ethiopia', short: 'CBE', primary: '#5B2C83', accent: '#F2B705', match: /commercial bank|^cbe\b/i },
  { key: 'abyssinia', bank: 'Bank of Abyssinia', short: 'BoA', primary: '#F2B200', accent: '#1C1A17', match: /abyssinia|^boa\b/i },
  { key: 'dashen', bank: 'Dashen Bank', short: 'DB', primary: '#0B2F6B', accent: '#E3A21A', match: /dashen/i },
  { key: 'awash', bank: 'Awash Bank', short: 'AB', primary: '#0D3C7A', accent: '#F58220', match: /awash|^awbnk\b/i },
  { key: 'zemen', bank: 'Zemen Bank', short: 'ZB', primary: '#7A1F3D', accent: '#C9A13B', match: /zemen|^zmnbnk\b/i },
  { key: 'coop', bank: 'Cooperative Bank of Oromia', short: 'coop', primary: '#0067B1', accent: '#7DBB42', match: /coop|cooperative bank/i },
]

const NEUTRAL = { primary: '#334155', accent: '#94A3B8' }

export interface BrandSource {
  account_name: string
  brand_color?: string | null
  brand_accent?: string | null
  brand_logo_url?: string | null
}

export function knownBank(nameOrProfile: string | null | undefined): Known | null {
  if (!nameOrProfile) return null
  return KNOWN_BANKS.find(k => k.key === nameOrProfile || k.match.test(nameOrProfile)) ?? null
}

export function brandFor(a: BrandSource): BankBrand {
  const k = knownBank(a.account_name)
  const initials = a.account_name.replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(w => w && !/^(bank|of|the|s\.?c\.?)$/i.test(w))
  return {
    key: k?.key ?? 'other',
    bank: k?.bank ?? a.account_name,
    short: k?.short ?? (initials.length > 1 ? initials.map(w => w[0]).join('').slice(0, 3) : a.account_name.slice(0, 3)).toUpperCase(),
    primary: a.brand_color ?? k?.primary ?? NEUTRAL.primary,
    accent: a.brand_accent ?? k?.accent ?? NEUTRAL.accent,
    logoUrl: a.brand_logo_url ?? null,
    known: !!k,
    custom: !!(a.brand_color || a.brand_accent || a.brand_logo_url),
  }
}

/** The look for a statement's bank, before it's tied to an account. */
export function brandForProfile(profileId: string, bankName: string): BankBrand {
  return brandFor({ account_name: knownBank(profileId)?.bank ?? bankName })
}

// ── Colour sums ─────────────────────────────────────────────────────────
function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}
function toHex([r, g, b]: number[]): string {
  return `#${[r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`
}
export function mix(a: string, b: string, t: number): string {
  const x = rgb(a), y = rgb(b)
  return toHex(x.map((v, i) => v + (y[i] - v) * t))
}
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map(v => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}
/** Text on a colour: white, or near-black when the colour is light (Abyssinia's yellow). */
export function inkOn(hex: string): string {
  return contrast(hex, '#ffffff') >= contrast(hex, '#161616') ? '#ffffff' : '#161616'
}
/**
 * The bank colour buttons, tabs and links use on `bg`: its main colour if it
 * reads there, else its second (Abyssinia's black on white, Dashen's gold in
 * dark mode), else the main colour darkened or lightened until it does.
 */
function uiColor(b: BankBrand, bg: string, toward: string): string {
  const fit = [b.primary, b.accent].find(c => contrast(c, bg) >= 4.5)
  if (fit) return fit
  let c = b.primary
  for (let i = 0; i < 10 && contrast(c, bg) < 4.5; i++) c = mix(c, toward, 0.15)
  return c
}

/** CSS variables that put a screen in the bank's colours (with `bank-theme`). */
export function brandVars(b: BankBrand): CSSProperties {
  const light = uiColor(b, '#ffffff', '#000000')
  const dark = uiColor(b, '#0f172a', '#ffffff')
  return {
    '--bank': b.primary,
    '--bank-deep': mix(b.primary, '#000000', 0.28),
    '--bank-accent': b.accent,
    '--bank-ink': inkOn(b.primary),
    '--bank-accent-ink': inkOn(b.accent),
    '--bank-ui': light,
    '--bank-ui-ink': inkOn(light),
    '--bank-ui-dark': dark,
    '--bank-ui-dark-ink': inkOn(dark),
    '--bank-soft': mix(b.primary, '#ffffff', 0.9),
  } as CSSProperties
}

// ── Accounts' saved looks ───────────────────────────────────────────────
export interface AccountBrandRow {
  id: string
  account_name: string
  account_number: string | null
  holder_name: string | null
  brand_color: string | null
  brand_accent: string | null
  brand_logo_url: string | null
}

export function useAccountBrands() {
  return useQuery({
    queryKey: ['account-brands'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('accounts')
        .select('id, account_name, account_number, holder_name, brand_color, brand_accent, brand_logo_url')
      if (error) throw error
      return new Map(((data ?? []) as AccountBrandRow[]).map(a => [a.id, a]))
    },
  })
}
