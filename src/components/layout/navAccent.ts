import type { CSSProperties } from 'react'
import type { NavGroup } from './navConfig'
import { PINNED } from './navState'

// Each nav section's own colour, so a person can tell where they are at a
// glance: the section's icon, the active page's bar, the top bar's underline
// and the header's line all wear it (styles in index.css, NAVIGATION).
// [on the dark nav, on light surfaces like the white header]
const ACCENTS: Record<string, [string, string]> = {
  [PINNED]: ['#D4AF37', '#a57d1c'],
  Home: ['#93c5fd', '#2563eb'],
  Requests: ['#fcd34d', '#b45309'],
  'Projects & Sites': ['#fdba74', '#c2410c'],
  Sales: ['#f9a8d4', '#db2777'],
  'Supply Chain': ['#c4b5fd', '#7c3aed'],
  Money: ['#6ee7b7', '#047857'],
  'People & Safety': ['#67e8f9', '#0e7490'],
  Admin: ['#cbd5e1', '#475569'],
}
const FALLBACK: [string, string] = ['#D4AF37', '#a57d1c']

/** The CSS variables that colour a section: --nav-accent and --nav-accent-deep. */
export function accentVars(section: string | null | undefined): CSSProperties {
  const [onDark, onLight] = (section && ACCENTS[section]) || FALLBACK
  return { '--nav-accent': onDark, '--nav-accent-deep': onLight } as CSSProperties
}

/** The section a page belongs to, for pinned pages shown outside their section. */
export function sectionOf(groups: NavGroup[], to: string): string | null {
  return groups.find(g => g.items.some(i => i.to === to))?.title ?? null
}
