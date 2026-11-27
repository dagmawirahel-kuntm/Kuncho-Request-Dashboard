// The festive season's artwork — the Christmas tree, candles, the star, the
// Gena cross and the New Year's sparks (see lib/seasons.ts for when each
// appears). Red, green and gold; Gena brings the tree together with the
// Ethiopian cross and beeswax tapers.
//
// Inline SVG like the Meskel art, coloured from the --season-* variables in
// index.css so it reads in light, dark and gold.

import { useId } from 'react'

const FLAME = '#F59E0B'
const FLAME_2 = '#FDE68A'
const RED = 'var(--season-red)'
const GREEN = 'var(--season-green)'
const GREEN_2 = 'var(--season-green-2)'

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
            stroke={r.i % 3 === 0 ? RED : r.i % 3 === 1 ? GREEN : 'var(--season-star)'}
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

/**
 * A decorated Christmas tree: three tiers of green, red and gold baubles, a
 * gold garland and the star on top; `gifts` puts presents at its foot.
 */
export function ChristmasTreeArt({ gifts = false, className }: { gifts?: boolean; className?: string }) {
  const baubles: [number, number, 'r' | 'g'][] = [[44, 40, 'r'], [57, 47, 'g'], [38, 62, 'g'], [52, 66, 'r'], [64, 60, 'r'], [33, 86, 'r'], [47, 90, 'g'], [61, 88, 'r'], [72, 84, 'g']]
  return (
    <svg viewBox="0 0 100 120" className={className} aria-hidden="true" overflow="visible">
      <ellipse cx={50} cy={116} rx={36} ry={3.2} fill="var(--season-ground)" fillOpacity={0.35} />
      <rect x={45} y={98} width={10} height={14} rx={1.5} fill="var(--season-wood)" />
      <path d="M50 18 L78 54 L62 54 L84 80 L66 80 L90 102 L10 102 L34 80 L16 80 L38 54 L22 54 Z" fill={GREEN} />
      <path d="M50 18 L64 36 L56 36 L50 28 Z M38 54 L62 54 L50 46 Z" fill={GREEN_2} opacity={0.6} />
      <path d="M30 56 Q50 66 70 54 M24 80 Q50 94 78 80" fill="none" stroke="var(--season-star)" strokeWidth={1.6} strokeLinecap="round" />
      {baubles.map(([x, y, c], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r={3.6} fill={c === 'r' ? RED : 'var(--season-star)'} />
          <circle cx={x - 1.1} cy={y - 1.2} r={1} fill="#fff" opacity={0.6} />
        </g>
      ))}
      <path className="festive-twinkle" d={starPath(50, 14, 9.5, 0.42)} fill="var(--season-star)" stroke="var(--season-star-edge)" strokeWidth={0.8} strokeLinejoin="round" />
      {gifts && (
        <g>
          <rect x={14} y={100} width={18} height={14} rx={1} fill={RED} />
          <path d="M23 100 V114 M14 106 H32" stroke="var(--season-star)" strokeWidth={2} />
          <rect x={70} y={103} width={16} height={11} rx={1} fill={GREEN_2} />
          <path d="M78 103 V114 M70 108 H86" stroke="var(--season-star)" strokeWidth={2} />
        </g>
      )}
    </svg>
  )
}

/** The small tree for the logo and the login page. */
export function TreeMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 24" className={className} aria-hidden="true">
      <path d="M10 3 L16 10 L13 10 L18 16 L14 16 L19 21 L1 21 L6 16 L2 16 L7 10 L4 10 Z" fill="var(--season-green)" />
      <circle cx={8} cy={12} r={1.2} fill="var(--season-red)" />
      <circle cx={12.5} cy={17.5} r={1.2} fill="var(--season-red)" />
      <circle cx={7} cy={18} r={1.1} fill="var(--season-star)" />
      <path d={starPath(10, 3, 3.2, 0.42)} fill="var(--season-star)" />
    </svg>
  )
}

/**
 * Gena, both together: the Ethiopian cross under the star, a decorated tree
 * beside it, and a lit beeswax taper — the Christmas season and our own.
 */
export function GenaArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 100" className={className} aria-hidden="true" overflow="visible">
      {/* the tree, left */}
      <g transform="translate(0 6) scale(0.42 0.78)">
        <path d="M50 18 L78 54 L62 54 L84 80 L66 80 L90 102 L10 102 L34 80 L16 80 L38 54 L22 54 Z" fill={GREEN} />
        <rect x={45} y={100} width={10} height={14} rx={1.5} fill="var(--season-wood)" />
        {[[44, 44, 'r'], [58, 64, 'g'], [36, 70, 'r'], [62, 90, 'r'], [40, 92, 'g']].map(([x, y, c], i) => (
          <circle key={i} cx={x as number} cy={y as number} r={4.6} fill={c === 'r' ? RED : 'var(--season-star)'} />
        ))}
        <path d={starPath(50, 14, 10, 0.42)} fill="var(--season-star)" />
      </g>
      {/* the cross with the star above, centre */}
      <path d={starPath(62, 10, 8, 0.42)} fill="var(--season-star)" stroke="var(--season-star-edge)" strokeWidth={0.8} strokeLinejoin="round" />
      <circle cx={62} cy={56} r={22} fill="none" stroke="var(--season-cross)" strokeOpacity={0.35} strokeWidth={0.9} />
      <path d="M62 37v38M43 56h38" stroke="var(--season-cross)" strokeWidth={3} strokeLinecap="round" />
      <g fill="var(--season-cross)">
        {[0, 90, 180, 270].map(r => (
          <g key={r} transform={`rotate(${r} 62 56)`}>
            <circle cx={62} cy={32.6} r={2.5} />
            <circle cx={58.8} cy={36.2} r={2.5} />
            <circle cx={65.2} cy={36.2} r={2.5} />
          </g>
        ))}
      </g>
      <rect x={57.8} y={51.8} width={8.4} height={8.4} transform="rotate(45 62 56)" fill="var(--color-card)" stroke="var(--season-cross)" strokeWidth={1.7} />
      <circle cx={62} cy={56} r={1.6} fill="var(--season-cross)" />
      {/* the taper, right */}
      <rect x={100} y={56} width={6} height={40} rx={1.8} fill="var(--season-wax)" />
      <path d="M100 66 L106 63 M100 80 L106 77" stroke="var(--season-wax-band)" strokeWidth={1.1} />
      <path className="festive-flame" d="M103 38 C107.5 44 108 48 106.8 51 C106 53 104.6 54 103 54 C101.4 54 100 53 99.2 51 C98 48 98.5 44 103 38Z" fill={FLAME} />
      <path className="festive-flame f2" d="M103 44.5 C105 47.4 105.2 49.2 104.6 50.6 C104.2 51.6 103.6 52 103 52 C102.4 52 101.8 51.6 101.4 50.6 C100.8 49.2 101 47.4 103 44.5Z" fill={FLAME_2} />
    </svg>
  )
}
