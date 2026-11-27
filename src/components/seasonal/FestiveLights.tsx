// String lights along the top of the app through the festive season (see
// lib/seasons.ts): a dark wire swagging between hooks, red, green and gold
// bulbs twinkling out of step. Drawn once as SVG and repeated across the
// width; it never takes a click.

const COLORS = ['var(--season-red)', 'var(--season-star)', 'var(--season-green)']

export function FestiveLights() {
  // One repeat: 160px of wire with five bulbs hanging from it.
  const bulbs = [12, 44, 80, 116, 148].map((x, i) => {
    const y = 4 + Math.sin((x / 160) * Math.PI) * 7
    return { x, y, c: COLORS[i % 3], d: (i * 0.37) % 1.4 }
  })
  return (
    <div className="festive-lights pointer-events-none fixed inset-x-0 top-0 z-[60] h-6 overflow-hidden print:hidden" aria-hidden="true">
      <svg width="100%" height="24" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="festive-lights" width="160" height="24" patternUnits="userSpaceOnUse">
            <path d="M0 3 Q80 17 160 3" fill="none" stroke="var(--season-wire)" strokeWidth="1.3" />
            {bulbs.map((b, i) => (
              <g key={i}>
                <rect x={b.x - 1.6} y={b.y} width={3.2} height={2.6} rx={0.6} fill="var(--season-wire)" />
                <ellipse className="festive-bulb" style={{ animationDelay: `${b.d}s` }} cx={b.x} cy={b.y + 6.4} rx={2.8} ry={3.9} fill={b.c} />
              </g>
            ))}
          </pattern>
        </defs>
        <rect width="100%" height="24" fill="url(#festive-lights)" />
      </svg>
    </div>
  )
}
