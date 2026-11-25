// The festive season's artwork — candles, the star, the Gena cross and the
// New Year's sparks (see lib/seasons.ts for when each appears).
//
// Inline SVG like the Meskel art, coloured from the --season-* variables in
// index.css so it reads in light, dark and gold. No snow, pines or Santa:
// Addis in Tahsas is white netela, beeswax tapers, gold and starlight.

import { useId } from 'react'

const FLAME = '#F59E0B'
const FLAME_2 = '#FDE68A'

/** A five-pointed star centred on (cx, cy), radius r. */
function starPath(cx: number, cy: number, r: number, inner = 0.42) {
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 ? r * inner : r
    pts.push(`${(cx + Math.cos(a) * rr).toFixed(2)},${(cy + Math.sin(a) * rr).toFixed(2)}`)
  }
  return `M${pts.join('L')}Z`
}

/** The small gold star for the logo and calendar. */
export function StarMark({ className }: { className?: string }) {
  return (
    <svg viewBox="-12 -12 24 24" className={className} aria-hidden="true">
      <path d={starPath(0, 0, 11)} fill="var(--season-star)" stroke="var(--season-star-edge)" strokeWidth={0.8} strokeLinejoin="round" />
    </svg>
  )
}

/** A lit taper, small — the logo's mark on Gena eve. */
export function CandleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 24" className={className} aria-hidden="true">
      <path className="festive-flame" d="M6 1 C8.2 4 9 6 8.6 8 C8.2 9.6 7.2 10.4 6 10.4 C4.8 10.4 3.8 9.6 3.4 8 C3 6 3.8 4 6 1Z" fill={FLAME} />
      <path d="M6 5 C7 6.4 7.3 7.4 7.1 8.3 C6.9 9 6.5 9.4 6 9.4 C5.5 9.4 5.1 9 4.9 8.3 C4.7 7.4 5 6.4 6 5Z" fill={FLAME_2} />
      <rect x={4.4} y={10.6} width={3.2} height={12.4} rx={1} fill="var(--season-wax)" />
      <path d="M4.4 14 L7.6 13.2 M4.4 18 L7.6 17.2" stroke="var(--season-wax-band)" strokeWidth={0.8} />
    </svg>
  )
}

/** Five slim beeswax tapers, `lit` of them burning — the countdown to Gena
 *  lights one more each day, all five on the eve. */
export function TapersArt({ lit = 5, className }: { lit?: number; className?: string }) {
  const glowId = useId()
  const xs = [22, 36, 50, 64, 78]
  const heights = [62, 70, 78, 70, 62]
  // Light from the middle outwards, so one candle is the tallest.
  const order = [2, 1, 3, 0, 4]
  const isLit = (i: number) => order.indexOf(i) < lit
  return (
    <svg viewBox="0 0 100 120" className={className} aria-hidden="true" overflow="visible">
      <defs>
        <radialGradient id={glowId} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor={FLAME} stopOpacity={0.35} />
          <stop offset="1" stopColor={FLAME} stopOpacity={0} />
        </radialGradient>
      </defs>
      {lit > 0 && <ellipse cx={50} cy={50} rx={48} ry={34} fill={`url(#${glowId})`} />}
      <ellipse cx={50} cy={116} rx={40} ry={3.5} fill="var(--season-ground)" fillOpacity={0.35} />
      {xs.map((x, i) => {
        const top = 114 - heights[i]
        return (
          <g key={x}>
            <rect x={x - 3.4} y={top} width={6.8} height={heights[i]} rx={2} fill="var(--season-wax)" />
            <path d={`M${x - 3.4} ${top + 12} L${x + 3.4} ${top + 9} M${x - 3.4} ${top + 26} L${x + 3.4} ${top + 23}`} stroke="var(--season-wax-band)" strokeWidth={1.2} />
            <line x1={x} y1={top} x2={x} y2={top - 3} stroke="#57534e" strokeWidth={1} strokeLinecap="round" />
            {isLit(i) && (
              <g>
                <path className="festive-flame" d={`M${x} ${top - 19} C${x + 5} ${top - 12} ${x + 6} ${top - 7} ${x + 4.6} ${top - 4} C${x + 3.6} ${top - 2} ${x + 2} ${top - 1} ${x} ${top - 1} C${x - 2} ${top - 1} ${x - 3.6} ${top - 2} ${x - 4.6} ${top - 4} C${x - 6} ${top - 7} ${x - 5} ${top - 12} ${x} ${top - 19}Z`} fill={FLAME} />
                <path className="festive-flame f2" d={`M${x} ${top - 12} C${x + 2.4} ${top - 8} ${x + 2.8} ${top - 5.6} ${x + 2} ${top - 3.6} C${x + 1.4} ${top - 2.4} ${x + 0.8} ${top - 2} ${x} ${top - 2} C${x - 0.8} ${top - 2} ${x - 1.4} ${top - 2.4} ${x - 2} ${top - 3.6} C${x - 2.8} ${top - 5.6} ${x - 2.4} ${top - 8} ${x} ${top - 12}Z`} fill={FLAME_2} />
              </g>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/** Christmas: the star with its long rays over a quiet scatter of small ones. */
export function NativityStarArt({ className }: { className?: string }) {
  const small: [number, number, number][] = [[18, 26, 3.2], [84, 20, 2.6], [76, 74, 2.8], [22, 78, 2.2], [90, 48, 2], [10, 52, 2.4]]
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true" overflow="visible">
      <g stroke="var(--season-star)" strokeLinecap="round" opacity={0.75}>
        <path d="M50 44 V96" strokeWidth={1.6} />
        <path d="M50 44 L28 86 M50 44 L72 86" strokeWidth={1} />
        <path d="M50 44 L12 62 M50 44 L88 62" strokeWidth={0.8} />
      </g>
      <path d={starPath(50, 40, 21, 0.4)} fill="var(--season-star)" stroke="var(--season-star-edge)" strokeWidth={1.2} strokeLinejoin="round" />
      <circle cx={50} cy={40} r={4} fill="var(--color-card)" opacity={0.85} />
      {small.map(([x, y, r], i) => (
        <path key={i} className="festive-twinkle" style={{ animationDelay: `${i * 0.45}s` }} d={starPath(x, y, r)} fill="var(--season-star)" />
      ))}
    </svg>
  )
}

/** New Year: a burst of gold sparks around the year. */
export function NewYearArt({ year, className }: { year: number; className?: string }) {
  const rays = Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2
    const r1 = 30, r2 = i % 2 ? 40 : 46
    return { x1: 50 + Math.cos(a) * r1, y1: 50 + Math.sin(a) * r1, x2: 50 + Math.cos(a) * r2, y2: 50 + Math.sin(a) * r2, i }
  })
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true" overflow="visible">
      <g stroke="var(--season-star)" strokeLinecap="round">
        {rays.map(r => (
          <line key={r.i} className="festive-twinkle" style={{ animationDelay: `${(r.i % 4) * 0.3}s` }}
            x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2} strokeWidth={r.i % 2 ? 1.6 : 2.4} />
        ))}
      </g>
      {[0, 4, 8, 12].map(i => {
        const a = (i / 16) * Math.PI * 2 + 0.2
        return <path key={i} d={starPath(50 + Math.cos(a) * 49, 50 + Math.sin(a) * 49, 3.4)} fill="var(--season-star)" />
      })}
      <text x={50} y={57} textAnchor="middle" fontSize={21} fontWeight={800} fill="var(--season-cross)" style={{ fontVariantNumeric: 'tabular-nums' }}>{year}</text>
    </svg>
  )
}

/** Gena: an Ethiopian cross, its arms ending in trefoils, under the star,
 *  with two lit tapers either side. */
export function GenaArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true" overflow="visible">
      <path d={starPath(50, 12, 9, 0.42)} fill="var(--season-star)" stroke="var(--season-star-edge)" strokeWidth={0.8} strokeLinejoin="round" />
      <g stroke="var(--season-star)" strokeWidth={0.8} strokeLinecap="round" opacity={0.6}>
        <path d="M50 22 V28 M42 18 L37 22 M58 18 L63 22" />
      </g>
      <circle cx={50} cy={58} r={24} fill="none" stroke="var(--season-cross)" strokeOpacity={0.35} strokeWidth={0.9} />
      <path d="M50 38v40M30 58h40" stroke="var(--season-cross)" strokeWidth={3.2} strokeLinecap="round" />
      <g fill="var(--season-cross)">
        {[0, 90, 180, 270].map(r => (
          <g key={r} transform={`rotate(${r} 50 58)`}>
            <circle cx={50} cy={33.4} r={2.6} />
            <circle cx={46.6} cy={37.2} r={2.6} />
            <circle cx={53.4} cy={37.2} r={2.6} />
          </g>
        ))}
      </g>
      <rect x={45.5} y={53.5} width={9} height={9} transform="rotate(45 50 58)" fill="var(--color-card)" stroke="var(--season-cross)" strokeWidth={1.8} />
      <circle cx={50} cy={58} r={1.7} fill="var(--season-cross)" />
      {[10, 90].map(x => (
        <g key={x}>
          <rect x={x - 2.6} y={70} width={5.2} height={28} rx={1.6} fill="var(--season-wax)" />
          <path className="festive-flame" d={`M${x} 56 C${x + 4} 61 ${x + 4.6} 64.6 ${x + 3.4} 67 C${x + 2.6} 68.6 ${x + 1.4} 69 ${x} 69 C${x - 1.4} 69 ${x - 2.6} 68.6 ${x - 3.4} 67 C${x - 4.6} 64.6 ${x - 4} 61 ${x} 56Z`} fill={FLAME} />
          <path className="festive-flame f2" d={`M${x} 61.5 C${x + 1.8} 64 ${x + 2} 65.6 ${x + 1.4} 66.8 C${x + 1} 67.6 ${x + 0.5} 68 ${x} 68 C${x - 0.5} 68 ${x - 1} 67.6 ${x - 1.4} 66.8 C${x - 2} 65.6 ${x - 1.8} 64 ${x} 61.5Z`} fill={FLAME_2} />
        </g>
      ))}
    </svg>
  )
}
