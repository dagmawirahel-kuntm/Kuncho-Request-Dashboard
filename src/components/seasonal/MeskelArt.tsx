// Meskel artwork — the Demera, the cross in Adey Abeba, and the daisy mark.
//
// Drawn as inline SVG rather than images so they stay sharp at any size and
// take the theme from CSS: the wood, binding and cross colours are the
// --season-* variables in index.css, which differ for light and dark.

import { useId, type ReactNode } from 'react'

const PETAL = '#F4C20D'
const PETAL_2 = '#EDB70A'

/** One Adey Abeba flower, centred on (x, y), `size` across. */
function Daisy({ x, y, size }: { x: number; y: number; size: number }) {
  const s = size / 24
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      {Array.from({ length: 8 }, (_, i) => (
        <ellipse key={i} cx={6.2} cy={0} rx={5.4} ry={2.3} fill={i % 2 ? PETAL_2 : PETAL} transform={`rotate(${i * 45})`} />
      ))}
      <circle r={3.5} fill="#7a4410" />
      <circle r={1.7} fill="#b06a16" />
    </g>
  )
}

/** The daisy on its own, for the sidebar and the calendar. */
export function DaisyMark({ className }: { className?: string }) {
  return (
    <svg viewBox="-12 -12 24 24" className={className} aria-hidden="true">
      <Daisy x={0} y={0} size={24} />
    </svg>
  )
}

/** A single tongue of flame — the calendar's marker for Demera. */
export function FlameMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 16" className={className} aria-hidden="true">
      <path d="M6 0 C9 4 12 7 11 11 C10.4 14 8.4 16 6 16 C3.6 16 1.6 14 1 11 C0 7 3 4 6 0Z" fill="#F97316" />
      <path d="M6 6 C7.6 8 8.6 9.6 8.2 11.6 C7.9 13.2 7 14 6 14 C5 14 4.1 13.2 3.8 11.6 C3.4 9.6 4.4 8 6 6Z" fill="#FDE68A" />
    </svg>
  )
}

/**
 * The icon for a calendar entry: a daisy for Meskel and a flame for Demera,
 * recognised by title in either script, otherwise the entry type's icon.
 */
export function SeasonalEventIcon({ title, fallback }: { title: string; fallback: ReactNode }) {
  if (/demera|ደመራ/i.test(title)) return <FlameMark className="h-3.5 w-3.5" />
  if (/meskel|መስቀል/i.test(title)) return <DaisyMark className="h-3.5 w-3.5" />
  return <>{fallback}</>
}

// Where the flowers go on the Demera's two bindings, in the order they are
// added — so a Demera with 3 blooms and one with 7 are the same bundle at
// different points in its dressing.
const BLOOM_SPOTS: [number, number][] = [[50, 73.5], [33, 106], [67, 106], [40, 71], [60, 71], [44, 108.8], [56, 108.8]]

/**
 * The Demera: a cone of bundled sticks with the cross at the top and Adey
 * Abeba tucked into its bindings. `blooms` is how many flowers it carries,
 * which the greeting raises day by day through the week; `lit` sets it
 * burning for the eve.
 */
export function DemeraArt({ lit = false, blooms = 7, className }: { lit?: boolean; blooms?: number; className?: string }) {
  const glowId = useId()
  const sticks = Array.from({ length: 9 }, (_, i) => {
    const bx = 22 + i * 7
    return { bx, tx: 50 + (bx - 50) * 0.12, alt: i % 2 === 1 }
  })
  return (
    <svg viewBox="0 0 100 140" className={className} aria-hidden="true" overflow="visible">
      {lit && (
        <>
          <defs>
            <radialGradient id={glowId} cx="50%" cy="50%" r="50%">
              <stop offset="0" stopColor="#F97316" stopOpacity={0.55} />
              <stop offset="0.6" stopColor="#F97316" stopOpacity={0.18} />
              <stop offset="1" stopColor="#F97316" stopOpacity={0} />
            </radialGradient>
          </defs>
          <circle cx={50} cy={108} r={50} fill={`url(#${glowId})`} />
        </>
      )}
      <ellipse cx={50} cy={134} rx={34} ry={4} fill="var(--season-ground)" fillOpacity={0.35} />
      {sticks.map(s => (
        <line key={s.bx} x1={s.bx} y1={132} x2={s.tx} y2={30}
          stroke={s.alt ? 'var(--season-wood-2)' : 'var(--season-wood)'} strokeWidth={2.4} strokeLinecap="round" />
      ))}
      <path d="M37.6 70 Q50 74.5 62.4 70M28.8 105 Q50 110.5 71.2 105" fill="none" stroke="var(--season-band)" strokeWidth={3} strokeLinecap="round" />
      {BLOOM_SPOTS.slice(0, Math.max(0, Math.min(7, blooms))).map(([x, y]) => (
        <Daisy key={`${x}-${y}`} x={x} y={y} size={9} />
      ))}
      {lit && (
        <>
          <path className="meskel-flame" d="M50 58 C61 77 77 92 71 118 C67 130 58 135 50 135 C42 135 33 130 29 118 C23 92 39 77 50 58Z" fill="#F97316" fillOpacity={0.92} />
          <path className="meskel-flame f2" d="M50 76 C58 91 67 102 63 120 C61 129 55 133 50 133 C45 133 39 129 37 120 C33 102 42 91 50 76Z" fill="#FB923C" />
          <path className="meskel-flame f3" d="M50 95 C55 104 59 111 57 123 C56 129 53 131 50 131 C47 131 44 129 43 123 C41 111 45 104 50 95Z" fill="#FDE68A" />
          <path className="meskel-flame f2" d="M27 108 C31 114 33 119 31 125 C30 128 28 129 26.5 129 C25 129 23 128 22.5 125 C21.5 119 24 114 27 108Z" fill="#FB923C" />
          <path className="meskel-flame f3" d="M73 104 C77 111 79 117 77 123 C76 127 74 128 72.5 128 C71 128 69 127 68.5 123 C67.5 117 70 111 73 104Z" fill="#F97316" />
        </>
      )}
      <g stroke="var(--season-cross)" strokeWidth={2.2} strokeLinecap="round" fill="none">
        <path d="M50 8v26M41 16h18" />
        <circle cx={50} cy={16} r={2.6} />
      </g>
      <g fill="var(--season-cross)">
        <circle cx={50} cy={5.6} r={2.1} />
        <circle cx={39.4} cy={16} r={2.1} />
        <circle cx={60.6} cy={16} r={2.1} />
      </g>
    </svg>
  )
}

/** Meskel day: the cross, its arms ending in trefoils, ringed in Adey Abeba. */
export function MeskelCrossArt({ className }: { className?: string }) {
  const ring = Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2
    return [50 + Math.cos(a) * 39, 50 + Math.sin(a) * 39] as const
  })
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true" overflow="visible">
      <circle cx={50} cy={50} r={30} fill="none" stroke="var(--season-cross)" strokeOpacity={0.35} strokeWidth={0.9} />
      <path d="M50 27v46M27 50h46" stroke="var(--season-cross)" strokeWidth={3.4} strokeLinecap="round" />
      <g fill="var(--season-cross)">
        {[0, 90, 180, 270].map(r => (
          <g key={r} transform={`rotate(${r} 50 50)`}>
            <circle cx={50} cy={21.2} r={2.9} />
            <circle cx={46.2} cy={25.6} r={2.9} />
            <circle cx={53.8} cy={25.6} r={2.9} />
          </g>
        ))}
      </g>
      <rect x={45} y={45} width={10} height={10} transform="rotate(45 50 50)" fill="var(--color-card)" stroke="var(--season-cross)" strokeWidth={2} />
      <circle cx={50} cy={50} r={1.9} fill="var(--season-cross)" />
      {ring.map(([x, y], i) => <Daisy key={i} x={x} y={y} size={13} />)}
    </svg>
  )
}
