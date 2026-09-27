import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode, type RefObject } from 'react'
import { ArrowUp } from 'lucide-react'
import { worldVars, type ClientWorld } from '@/lib/clientWorld'
import { useAtmosphereSlot } from './atmosphereSlot'

const SIZES = {
  sm: { box: 'h-9 w-9', radius: 'rounded-lg', text: 'text-xs', pad: 'p-1' },
  md: { box: 'h-12 w-12', radius: 'rounded-xl', text: 'text-base', pad: 'p-1.5' },
  lg: { box: 'h-16 w-16 sm:h-20 sm:w-20', radius: 'rounded-2xl', text: 'text-2xl sm:text-3xl', pad: 'p-2' },
}

/**
 * The client's logo as a living object: on a tile that suits it (a white
 * logo gets a dark tile), with a halo turning in the client's colours, a
 * glint crossing it, a slow float, and a tilt towards the pointer when it
 * sits in a hero. Without a logo it shows the initials on their colours.
 */
export function ClientEmblem({
  world, size = 'md', halo = false, float = false, arrive = false, transitionName, children, className = '',
}: {
  world: ClientWorld
  size?: keyof typeof SIZES
  halo?: boolean
  float?: boolean
  arrive?: boolean
  /** view-transition-name, so the logo morphs between pages. */
  transitionName?: string
  children?: ReactNode
  className?: string
}) {
  const [failedFor, setFailedFor] = useState<string | null>(null)
  const s = SIZES[size]
  const p = world.palette
  const showLogo = !!world.logo && failedFor !== world.logo
  const tile = showLogo
    ? (p.logoTone === 'light' ? '#0f172a' : '#ffffff')
    : `linear-gradient(135deg, ${p.colors[0]}, ${p.colors[1]})`

  return (
    <div className={`relative shrink-0 ${s.box} ${arrive ? 'world-arrive' : ''} ${className}`} style={worldVars(p)}>
      <div className={`h-full w-full ${float ? 'world-float' : ''}`}>
        <div className="world-tilt relative h-full w-full">
          {halo && <><span className={`world-glow ${s.radius}`} /><span className={`world-halo ${s.radius}`} /></>}
          <div className={`relative flex h-full w-full items-center justify-center overflow-hidden ${s.radius} shadow-lg ring-1 ring-white/40`}
            style={{ background: tile, viewTransitionName: transitionName } as CSSProperties}>
            {showLogo ? (
              <img src={world.logo!} alt={world.name} draggable={false} className={`h-full w-full object-contain ${s.pad}`}
                onError={() => setFailedFor(world.logo)} />
            ) : (
              <span className={`font-black tracking-tight text-white drop-shadow ${s.text}`}>{world.initials}</span>
            )}
            <span className="world-glint" aria-hidden />
          </div>
        </div>
      </div>
      {children}
    </div>
  )
}

const esc = (x: string) => x.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
function wallpaper(world: ClientWorld): string {
  if (world.logo) return `url("${world.logo.replace(/"/g, '%22')}")`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="96"><text x="75" y="60" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="40" font-weight="900" fill="#fff">${esc(world.initials)}</text></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

/**
 * A hero in the client's colours: a slowly panning gradient, two glowing
 * orbs, their logo as a drifting wallpaper, and a sheen. Moving the pointer
 * over it shifts the layers apart and tilts the emblem inside.
 */
export function WorldHero({ world, children, footer, style, heroRef }: {
  world: ClientWorld
  children: ReactNode
  footer?: ReactNode
  style?: CSSProperties
  heroRef?: RefObject<HTMLElement | null>
}) {
  const own = useRef<HTMLElement>(null)
  const ref = heroRef ?? own
  function move(e: PointerEvent<HTMLElement>) {
    const el = ref.current
    if (!el || e.pointerType === 'touch') return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--mx', (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3))
    el.style.setProperty('--my', (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3))
  }
  function leave() {
    ref.current?.style.setProperty('--mx', '0')
    ref.current?.style.setProperty('--my', '0')
  }
  return (
    <section ref={ref} onPointerMove={move} onPointerLeave={leave}
      className="world-hero relative overflow-hidden rounded-2xl text-white shadow-xl"
      style={{ ...worldVars(world.palette), ...style }}>
      <div className="world-hero-bg absolute inset-0" />
      <span className="world-orb world-orb-1" />
      <span className="world-orb world-orb-2" />
      <div className="world-wallpaper" style={{ backgroundImage: wallpaper(world) }} />
      <div className="world-sheen absolute inset-0" />
      <div className="relative z-10">{children}</div>
      {footer && <div className="relative z-10">{footer}</div>}
    </section>
  )
}

/**
 * Once the hero has scrolled away, a slim bar in the client's colours
 * slides down so you never lose track of whose world you are in.
 */
export function WorldBar({ world, heroRef, meta }: { world: ClientWorld; heroRef: RefObject<HTMLElement | null>; meta?: ReactNode }) {
  const { scroller } = useAtmosphereSlot()
  const [show, setShow] = useState(false)
  useEffect(() => {
    const el = heroRef.current
    if (!el || !scroller) return
    const io = new IntersectionObserver(([e]) => setShow(!e.isIntersecting && e.boundingClientRect.top < (e.rootBounds?.top ?? 0)),
      { root: scroller, threshold: 0 })
    io.observe(el)
    return () => io.disconnect()
  }, [heroRef, scroller])

  return (
    <div className="sticky -top-4 z-30 h-0 sm:-top-6 print:hidden">
      <div data-show={show} aria-hidden={!show} className="world-bar absolute inset-x-0 top-1 flex items-center gap-3 rounded-xl px-3 py-2 text-white shadow-lg"
        style={worldVars(world.palette)}>
        <ClientEmblem world={world} size="sm" />
        <p className="min-w-0 flex-1 truncate text-sm font-bold">{world.name}</p>
        {meta && <div className="hidden min-w-0 items-center gap-3 truncate text-xs text-white/80 sm:flex">{meta}</div>}
        <button type="button" tabIndex={show ? 0 : -1} onClick={() => scroller?.scrollTo({ top: 0, behavior: 'smooth' })}
          className="rounded-md bg-white/15 p-1.5 hover:bg-white/25" aria-label="Back to the top">
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
