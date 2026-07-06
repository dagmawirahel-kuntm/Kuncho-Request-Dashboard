import { useEffect, useRef } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import type { Vehicle } from '@/types/database'

// A lightweight, dependency-free CSS-3D vehicle: a small model built from
// shaded boxes, branded with the ቁ mark on its real left/right side faces.
// On cards it idles with a slow spin; on the detail page it's drag-to-orbit.

const MARK_FONT = 'Kefa, Nyala, "Noto Sans Ethiopic", "Abyssinica SIL", sans-serif'

type Col = { top: string; side: string; end: string }
const STEEL:  Col = { top: '#6c7d90', side: '#4a5c70', end: '#3b4b5d' }
const NAVY:   Col = { top: '#3a4a5c', side: '#28323f', end: '#1f2732' }
const GREEN:  Col = { top: '#3ddba3', side: '#12a172', end: '#0c8a60' }
const SILVER: Col = { top: '#c3cbd3', side: '#98a2ac', end: '#828d98' }
const GLASS:  Col = { top: '#a9c6d8', side: '#7ea2b8', end: '#6f94ab' }

function Mark({ d }: { d: number }) {
  return (
    <div style={{
      width: d, height: d, borderRadius: '50%', background: '#151a1f',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: MARK_FONT, fontWeight: 700, color: '#D4AF37', fontSize: d * 0.9, lineHeight: 1,
      boxShadow: 'inset 0 0 0 ' + Math.max(1, d / 12) + 'px #D4AF37',
    }}>ቁ</div>
  )
}

function faceStyle(w: number, h: number, transform: string, bg: string, radius: number): CSSProperties {
  return {
    position: 'absolute', left: '50%', top: '50%', width: w, height: h,
    marginLeft: -w / 2, marginTop: -h / 2, background: bg, borderRadius: radius,
    transform, display: 'flex', alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', boxSizing: 'border-box',
  }
}

// L=length(X), H=height(Y), W=width(Z). ±Z faces are the vehicle's flanks.
function Box({
  L, H, W, x = 0, y = 0, z = 0, col, radius = 0, brand = false, glass = false,
}: {
  L: number; H: number; W: number; x?: number; y?: number; z?: number
  col: Col; radius?: number; brand?: boolean; glass?: boolean
}) {
  const hL = L / 2, hH = H / 2, hW = W / 2
  const flankBg = glass ? `linear-gradient(160deg, ${GLASS.side}, ${col.side})` : col.side
  const mark = brand ? <Mark d={Math.min(H, L) * 0.5} /> : null
  return (
    <div style={{ position: 'absolute', left: '50%', top: '50%', transformStyle: 'preserve-3d', transform: `translate3d(${x}px,${y}px,${z}px)` }}>
      <div style={faceStyle(L, H, `translateZ(${hW}px)`, flankBg, radius)}>{mark}</div>
      <div style={faceStyle(L, H, `rotateY(180deg) translateZ(${hW}px)`, flankBg, radius)}>{mark}</div>
      <div style={faceStyle(W, H, `rotateY(90deg) translateZ(${hL}px)`, glass ? GLASS.end : col.end, radius)} />
      <div style={faceStyle(W, H, `rotateY(-90deg) translateZ(${hL}px)`, col.end, radius)} />
      <div style={faceStyle(L, W, `rotateX(90deg) translateZ(${hH}px)`, col.top, radius)} />
      <div style={faceStyle(L, W, `rotateX(-90deg) translateZ(${hH}px)`, col.top, radius)} />
    </div>
  )
}

const TIRE: Col = { top: '#181b21', side: '#111417', end: '#181b21' }

function Wheel({ x, dia = 30, thick = 14, groundY = 26 }: { x: number; dia?: number; thick?: number; groundY?: number }) {
  const t = thick / 2 + 0.5
  const disc = (size: number, bg: string, tf: string) => (
    <div style={{ position: 'absolute', left: '50%', top: '50%', width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2, background: bg, borderRadius: '50%', transform: tf }} />
  )
  return (
    <>
      <Box L={dia} H={dia} W={thick} x={x} y={groundY} col={TIRE} radius={dia / 2} />
      <div style={{ position: 'absolute', left: '50%', top: '50%', transformStyle: 'preserve-3d', transform: `translate3d(${x}px,${groundY}px,0)` }}>
        {disc(dia * 0.64, '#2b3138', `translateZ(${t}px)`)}
        {disc(dia * 0.34, '#5a6675', `translateZ(${t + 0.4}px)`)}
        {disc(dia * 0.64, '#2b3138', `rotateY(180deg) translateZ(${t}px)`)}
        {disc(dia * 0.34, '#5a6675', `rotateY(180deg) translateZ(${t + 0.4}px)`)}
      </div>
    </>
  )
}

function Model({ type }: { type: Vehicle['vehicle_type'] }) {
  if (type === 'truck') return (
    <>
      <Box L={118} H={66} W={80} x={-26} y={-7} col={STEEL} brand />
      <Box L={52} H={52} W={76} x={64} y={0} col={NAVY} glass />
      <Wheel x={66} /><Wheel x={-58} /><Wheel x={-16} />
    </>
  )
  if (type === 'motorbike') return (
    <>
      <Box L={66} H={11} W={26} x={-2} y={9} col={GREEN} />
      <Box L={30} H={30} W={26} x={-28} y={-6} col={GREEN} brand />
      <Box L={16} H={40} W={22} x={30} y={-12} col={{ top: '#12a172', side: '#0d8a63', end: '#0c7d59' }} />
      <Box L={30} H={7} W={9} x={34} y={-34} col={{ top: '#0c8a60', side: '#0a7050', end: '#0a7050' }} />
      <Wheel x={-40} dia={44} thick={13} groundY={18} /><Wheel x={44} dia={44} thick={13} groundY={18} />
    </>
  )
  if (type === 'van') return (
    <>
      <Box L={150} H={64} W={80} x={0} y={-6} col={STEEL} brand />
      <Box L={30} H={26} W={78} x={64} y={-18} col={NAVY} glass />
      <Wheel x={58} /><Wheel x={-56} />
    </>
  )
  if (type === 'pickup') return (
    <>
      <Box L={52} H={46} W={76} x={44} y={2} col={SILVER} glass brand />
      <Box L={96} H={22} W={80} x={-30} y={14} col={SILVER} />
      <Box L={96} H={6} W={80} x={-30} y={2} col={{ top: '#828d98', side: '#6f7a85', end: '#69747f' }} />
      <Box L={58} H={24} W={74} x={-46} y={-8} col={NAVY} />
      <Wheel x={52} /><Wheel x={-58} />
    </>
  )
  // car / other
  return (
    <>
      <Box L={150} H={34} W={80} x={0} y={14} col={SILVER} />
      <Box L={86} H={30} W={74} x={-4} y={-6} col={SILVER} glass brand />
      <Wheel x={52} /><Wheel x={-52} />
    </>
  )
}

export function Vehicle3D({
  type, size = 1, interactive = false, className, style,
}: {
  type: Vehicle['vehicle_type']; size?: number; interactive?: boolean
  className?: string; style?: CSSProperties
}) {
  const groupRef = useRef<HTMLDivElement>(null)
  const rot = useRef({ x: -14, y: -34 })
  const drag = useRef<null | { px: number; py: number; rx: number; ry: number }>(null)

  function apply() {
    if (groupRef.current) groupRef.current.style.transform = `rotateX(${rot.current.x}deg) rotateY(${rot.current.y}deg)`
  }

  useEffect(() => {
    apply()
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (interactive || reduce) return
    let raf = 0
    let last = performance.now()
    const tick = (t: number) => {
      const dt = Math.min(t - last, 50); last = t
      if (!drag.current) { rot.current.y += dt * 0.014; apply() }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [interactive])

  const onDown = interactive ? (e: ReactPointerEvent) => {
    drag.current = { px: e.clientX, py: e.clientY, rx: rot.current.x, ry: rot.current.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  } : undefined
  const onMove = interactive ? (e: ReactPointerEvent) => {
    if (!drag.current) return
    rot.current.y = drag.current.ry + (e.clientX - drag.current.px) * 0.5
    rot.current.x = Math.max(-60, Math.min(20, drag.current.rx - (e.clientY - drag.current.py) * 0.4))
    apply()
  } : undefined
  const onUp = interactive ? () => { drag.current = null } : undefined

  return (
    <div
      className={className}
      style={{ ...style, position: 'relative', perspective: 640, display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: interactive ? 'none' : undefined, cursor: interactive ? 'grab' : undefined }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
    >
      <div style={{ position: 'absolute', bottom: '16%', left: '50%', width: 150 * size, height: 26 * size, transform: 'translateX(-50%)', background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.45), transparent 70%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative', transformStyle: 'preserve-3d', transform: `scale(${size})` }}>
        <div ref={groupRef} style={{ position: 'relative', transformStyle: 'preserve-3d', willChange: 'transform' }}>
          <Model type={type} />
        </div>
      </div>
    </div>
  )
}
