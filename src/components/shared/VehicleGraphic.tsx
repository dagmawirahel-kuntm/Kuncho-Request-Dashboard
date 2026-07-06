import type { Vehicle } from '@/types/database'

const MARK_FONT = 'Kefa, Nyala, "Noto Sans Ethiopic", "Abyssinica SIL", sans-serif'

function Mark({ x, y, r }: { x: number; y: number; r: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill="#151a1f" stroke="#D4AF37" strokeWidth={r / 9} />
      <text
        x={x}
        y={y}
        dy={r * 0.36}
        textAnchor="middle"
        fontFamily={MARK_FONT}
        fontWeight={700}
        fontSize={r * 1.25}
        fill="#D4AF37"
      >
        ቁ
      </text>
    </g>
  )
}

function Ground({ cx }: { cx: number }) {
  return <ellipse cx={cx} cy={106} rx={92} ry={7} fill="rgba(0,0,0,0.28)" />
}

function Wheel({ cx, cy = 96, r = 15 }: { cx: number; cy?: number; r?: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="#15181c" />
      <circle cx={cx} cy={cy} r={r * 0.42} fill="#6b7280" />
    </g>
  )
}

function TruckGraphic() {
  return (
    <svg viewBox="0 0 220 120" className="h-full w-full">
      <defs>
        <linearGradient id="truckBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3a4a5c" />
          <stop offset="100%" stopColor="#1e2937" />
        </linearGradient>
        <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#cfe3f0" />
          <stop offset="100%" stopColor="#8fb2c9" />
        </linearGradient>
      </defs>
      <Ground cx={110} />
      <rect x="56" y="24" width="132" height="62" rx="6" fill="url(#truckBody)" />
      <rect x="10" y="44" width="50" height="46" rx="8" fill="url(#truckBody)" />
      <rect x="17" y="50" width="32" height="20" rx="4" fill="url(#glass)" />
      <Mark x={122} y={54} r={19} />
      <Wheel cx={38} />
      <Wheel cx={148} />
      <Wheel cx={172} r={13} />
    </svg>
  )
}

function PickupGraphic() {
  return (
    <svg viewBox="0 0 220 120" className="h-full w-full">
      <defs>
        <linearGradient id="pickupBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d8dde2" />
          <stop offset="100%" stopColor="#9aa4ad" />
        </linearGradient>
        <linearGradient id="canopy" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4b5a68" />
          <stop offset="100%" stopColor="#2c3843" />
        </linearGradient>
        <linearGradient id="glass2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#cfe3f0" />
          <stop offset="100%" stopColor="#8fb2c9" />
        </linearGradient>
      </defs>
      <Ground cx={110} />
      <rect x="14" y="42" width="54" height="48" rx="10" fill="url(#pickupBody)" />
      <rect x="20" y="48" width="34" height="20" rx="4" fill="url(#glass2)" />
      <rect x="64" y="66" width="104" height="24" rx="3" fill="url(#pickupBody)" />
      <rect x="64" y="64" width="104" height="4" fill="#7d8892" />
      <rect x="100" y="46" width="66" height="22" rx="4" fill="url(#canopy)" />
      <Mark x={133} y={57} r={11} />
      <Wheel cx={44} />
      <Wheel cx={152} />
    </svg>
  )
}

function MotorbikeGraphic() {
  return (
    <svg viewBox="0 0 220 120" className="h-full w-full">
      <defs>
        <linearGradient id="bikeBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="100%" stopColor="#0f7a54" />
        </linearGradient>
      </defs>
      <Ground cx={104} />
      <rect x="50" y="82" width="104" height="8" rx="4" fill="url(#bikeBody)" />
      <path d="M52 90 Q46 62 78 56 L120 54 Q134 54 140 62 L150 78 Q152 86 144 90 Z" fill="url(#bikeBody)" />
      <line x1="142" y1="64" x2="160" y2="42" stroke="#0f7a54" strokeWidth="7" strokeLinecap="round" />
      <circle cx="160" cy="42" r="5" fill="#0f7a54" />
      <circle cx="146" cy="70" r="5" fill="#eafff5" />
      <Mark x={96} y={70} r={12} />
      <Wheel cx={54} r={18} />
      <Wheel cx={150} r={18} />
    </svg>
  )
}

function VanGraphic() {
  return (
    <svg viewBox="0 0 220 120" className="h-full w-full">
      <defs>
        <linearGradient id="vanBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5b6b7c" />
          <stop offset="100%" stopColor="#2b3744" />
        </linearGradient>
        <linearGradient id="glass3" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#cfe3f0" />
          <stop offset="100%" stopColor="#8fb2c9" />
        </linearGradient>
      </defs>
      <Ground cx={110} />
      <rect x="20" y="30" width="168" height="56" rx="10" fill="url(#vanBody)" />
      <rect x="28" y="38" width="34" height="20" rx="4" fill="url(#glass3)" />
      <Mark x={128} y={58} r={18} />
      <Wheel cx={50} />
      <Wheel cx={158} />
    </svg>
  )
}

function CarGraphic() {
  return (
    <svg viewBox="0 0 220 120" className="h-full w-full">
      <defs>
        <linearGradient id="carBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8b93a1" />
          <stop offset="100%" stopColor="#4c5563" />
        </linearGradient>
        <linearGradient id="glass4" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#cfe3f0" />
          <stop offset="100%" stopColor="#8fb2c9" />
        </linearGradient>
      </defs>
      <Ground cx={110} />
      <path d="M22 88 Q22 60 55 56 L80 40 Q90 34 105 34 L135 34 Q148 34 156 42 L168 56 Q198 60 198 88 Z" fill="url(#carBody)" />
      <path d="M84 42 L104 40 L132 40 L146 55 L78 55 Z" fill="url(#glass4)" />
      <Mark x={110} y={72} r={13} />
      <Wheel cx={58} />
      <Wheel cx={162} />
    </svg>
  )
}

export function VehicleGraphic({ type, className }: { type: Vehicle['vehicle_type']; className?: string }) {
  const Graphic =
    type === 'truck' ? TruckGraphic :
    type === 'pickup' ? PickupGraphic :
    type === 'motorbike' ? MotorbikeGraphic :
    type === 'van' ? VanGraphic :
    CarGraphic

  return (
    <div className={className} style={{ perspective: '500px' }}>
      <div style={{ height: '100%', width: '100%', transform: 'rotateY(-16deg) rotateX(2deg)', transformStyle: 'preserve-3d' }}>
        <Graphic />
      </div>
    </div>
  )
}
