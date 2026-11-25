import { useEffect, useRef } from 'react'
import { useSeason } from '@/hooks/useSeason'
import type { SeasonMoment } from '@/lib/seasons'

// Ge'ez / Ethiopic numerals ፩–፻
const GEEZ = ['፩','፪','፫','፬','፭','፮','፯','፰','፱','፲','፳','፴','፵','፶','፷','፸','፹','፺','፻']
// Arabic numerals mixed in
const ARABIC = ['1','2','3','4','5','6','7','8','9','12','24','36','48','60','72','100']
// 2:1 ratio Ge'ez to Arabic — Ge'ez dominates
const POOL = [...GEEZ, ...GEEZ, ...ARABIC]

const N = 42            // particle count
const DIST = 270        // max connection distance (px)
const EMBERS = 80       // Demera embers
const TAPERS = 54       // Gena eve candles
const SPARKS = 22       // per New Year burst

type P = {
  x: number; y: number
  vx: number; vy: number
  char: string; geez: boolean
  size: number; alpha: number
  /** Fixed per particle: it is drawn as a daisy while key < the season's
   *  daisy share. Because the key never changes, a rising share turns more
   *  of the same particles into flowers rather than reshuffling them. */
  key: number
  /** Fixed per particle, for the festive season: a star below 0.55, a
   *  candle flame above — so the mix stays the same as the share grows. */
  kind: number
  rot: number; vr: number
}

type Ember = { x: number; y: number; vy: number; sway: number; sf: number; r: number; c: number; a: number }
type Taper = { x: number; y: number; r: number; sf: number; ph: number }
type Spark = { x: number; y: number; vx: number; vy: number; life: number; c: number }

// Adey Abeba, and the Demera's fire from flame to coal (see seasons.ts).
const PETAL = '#F4C20D'
const PETAL_2 = '#EDB70A'
const DISK = '#7a4410'
const DISK_2 = '#b06a16'
const EMBER_DARK = ['#FDE68A', '#FDBA74', '#FB923C', '#F97316', '#EA580C']
const EMBER_LIGHT = ['#F97316', '#EA580C', '#C2410C', '#D97706', '#EA580C']
// The festive season: beeswax flame and Tahsas gold (see FestiveArt.tsx).
const FLAME = '#F59E0B'
const FLAME_2 = '#FDE68A'
const STAR_DARK = '#F5D36B'
const STAR_LIGHT = '#B8860B'
const SPARK_DARK = ['#FDE68A', '#F5D36B', '#FCD34D', '#FFFFFF']
const SPARK_LIGHT = ['#B8860B', '#D97706', '#CA8A04', '#A16207']

function spawn(w: number, h: number): P {
  const char = POOL[Math.floor(Math.random() * POOL.length)]
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.65,
    vy: (Math.random() - 0.5) * 0.65,
    char,
    geez: GEEZ.includes(char),
    size: 11 + Math.random() * 22,
    alpha: 0.05 + Math.random() * 0.09,
    key: Math.random(),
    kind: Math.random(),
    rot: Math.random() * Math.PI * 2,
    vr: (Math.random() - 0.5) * 0.006,
  }
}

function spawnEmber(w: number, h: number, anywhere: boolean): Ember {
  return {
    x: Math.random() * w,
    y: anywhere ? Math.random() * h : h + Math.random() * 40,
    vy: -(0.35 + Math.random() * 0.95),
    sway: Math.random() * Math.PI * 2,
    sf: 0.6 + Math.random() * 1.4,
    r: 0.9 + Math.random() * 2.2,
    c: Math.floor(Math.random() * 5),
    a: 0.55 + Math.random() * 0.45,
  }
}

export function AnimatedBackground() {
  const ref = useRef<HTMLCanvasElement>(null)
  const season = useSeason()
  // The draw loop is set up once; it reads the season through a ref so a
  // phase change (the Demera lighting at 18:00) reaches it without
  // tearing the canvas down.
  const seasonRef = useRef<SeasonMoment | null>(season)
  const redrawRef = useRef<() => void>(() => {})

  useEffect(() => {
    seasonRef.current = season
    redrawRef.current()
  }, [season])

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let ps: P[] = []
    let embers: Ember[] = []
    let tapers: Taper[] = []
    let sparks: Spark[] = []
    let nextBurst = 0
    let w = 0, h = 0
    let t = 0

    function resize() {
      w = canvas!.width  = window.innerWidth
      h = canvas!.height = window.innerHeight
    }

    function init() {
      ps = Array.from({ length: N }, () => spawn(w, h))
      embers = Array.from({ length: EMBERS }, () => spawnEmber(w, h, true))
      // Candles for Gena eve: held still in the lower part of the window,
      // nearer and larger towards the bottom, like a congregation's tapers.
      tapers = Array.from({ length: TAPERS }, () => {
        const y = h * (0.58 + Math.random() * 0.4)
        return { x: Math.random() * w, y, r: 2.2 + 3.6 * ((y / h - 0.58) / 0.4), sf: 2 + Math.random() * 3, ph: Math.random() * Math.PI * 2 }
      })
      sparks = []
    }

    function daisy(x: number, y: number, r: number, rot: number, a: number) {
      ctx!.save()
      ctx!.translate(x, y)
      ctx!.rotate(rot)
      ctx!.globalAlpha = a
      for (let i = 0; i < 8; i++) {
        ctx!.rotate(Math.PI / 4)
        ctx!.fillStyle = i % 2 ? PETAL_2 : PETAL
        ctx!.beginPath()
        ctx!.ellipse(r * 0.56, 0, r * 0.48, r * 0.2, 0, 0, Math.PI * 2)
        ctx!.fill()
      }
      ctx!.fillStyle = DISK
      ctx!.beginPath(); ctx!.arc(0, 0, r * 0.29, 0, Math.PI * 2); ctx!.fill()
      ctx!.fillStyle = DISK_2
      ctx!.beginPath(); ctx!.arc(0, 0, r * 0.14, 0, Math.PI * 2); ctx!.fill()
      ctx!.restore()
    }

    function star(x: number, y: number, r: number, rot: number, a: number, color: string) {
      ctx!.save()
      ctx!.translate(x, y)
      ctx!.rotate(rot * 0.3)
      ctx!.globalAlpha = a
      ctx!.fillStyle = color
      ctx!.beginPath()
      for (let i = 0; i < 10; i++) {
        const ang = -Math.PI / 2 + (i * Math.PI) / 5
        const rr = i % 2 ? r * 0.42 : r
        if (i === 0) ctx!.moveTo(Math.cos(ang) * rr, Math.sin(ang) * rr)
        else ctx!.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr)
      }
      ctx!.closePath()
      ctx!.fill()
      ctx!.restore()
    }

    /** A candle flame `r` wide at its base, flickering with `flick` (0–1). */
    function flame(x: number, y: number, r: number, a: number, flick: number, isDark: boolean) {
      const hgt = r * (2.6 + 0.5 * flick)
      ctx!.save()
      ctx!.translate(x, y)
      // A soft glow that fades to nothing, so the flame doesn't sit in a disc.
      const halo = ctx!.createRadialGradient(0, -hgt * 0.4, 0, 0, -hgt * 0.4, r * 4)
      halo.addColorStop(0, isDark ? 'rgba(245,158,11,0.28)' : 'rgba(245,158,11,0.16)')
      halo.addColorStop(1, 'rgba(245,158,11,0)')
      ctx!.globalAlpha = a
      ctx!.fillStyle = halo
      ctx!.beginPath(); ctx!.arc(0, -hgt * 0.4, r * 4, 0, Math.PI * 2); ctx!.fill()
      ctx!.fillStyle = FLAME
      ctx!.beginPath()
      ctx!.moveTo(0, -hgt)
      ctx!.bezierCurveTo(r * 1.1, -hgt * 0.55, r * 1.2, -hgt * 0.15, 0, 0)
      ctx!.bezierCurveTo(-r * 1.2, -hgt * 0.15, -r * 1.1, -hgt * 0.55, 0, -hgt)
      ctx!.fill()
      ctx!.fillStyle = FLAME_2
      ctx!.beginPath()
      ctx!.moveTo(0, -hgt * 0.62)
      ctx!.bezierCurveTo(r * 0.55, -hgt * 0.35, r * 0.55, -hgt * 0.1, 0, -hgt * 0.04)
      ctx!.bezierCurveTo(-r * 0.55, -hgt * 0.1, -r * 0.55, -hgt * 0.35, 0, -hgt * 0.62)
      ctx!.fill()
      ctx!.restore()
    }

    function burst() {
      const x = w * (0.1 + Math.random() * 0.8)
      const y = h * (0.12 + Math.random() * 0.5)
      for (let i = 0; i < SPARKS; i++) {
        const ang = (i / SPARKS) * Math.PI * 2 + Math.random() * 0.2
        const sp = 1.1 + Math.random() * 1.6
        sparks.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 1, c: Math.floor(Math.random() * 4) })
      }
    }

    function move() {
      // Organically wander each particle
      for (const p of ps) {
        p.vx += (Math.random() - 0.5) * 0.025
        p.vy += (Math.random() - 0.5) * 0.025
        const spd = Math.hypot(p.vx, p.vy)
        if (spd > 0.95) { p.vx *= 0.97; p.vy *= 0.97 }
        if (spd < 0.08) { p.vx += (Math.random() - 0.5) * 0.18; p.vy += (Math.random() - 0.5) * 0.18 }
        p.x += p.vx; p.y += p.vy
        p.rot += p.vr
        if (p.x < -60) p.x = w + 60
        if (p.x > w + 60) p.x = -60
        if (p.y < -60) p.y = h + 60
        if (p.y > h + 60) p.y = -60
      }
      // New Year: a burst of gold sparks every couple of seconds, falling
      // and fading; none are started outside the New Year phase.
      if (seasonRef.current?.phase === 'newyear' && t > nextBurst) {
        burst()
        nextBurst = t + 1.6 + Math.random() * 1.8
      }
      for (const s of sparks) {
        s.x += s.vx; s.y += s.vy
        s.vx *= 0.985; s.vy = s.vy * 0.985 + 0.018
        s.life -= 0.012
      }
      sparks = sparks.filter(s => s.life > 0)
      // Embers only rise while the Demera burns; otherwise they wait.
      if (seasonRef.current?.phase === 'demera') {
        for (let i = 0; i < embers.length; i++) {
          const e = embers[i]
          e.y += e.vy
          e.x += Math.sin(t * e.sf + e.sway) * 0.4
          if (e.y < -12) embers[i] = spawnEmber(w, h, false)
        }
      }
    }

    function draw() {
      const isDark = document.documentElement.classList.contains('dark')
      const isGold = document.documentElement.classList.contains('gold')
      const season = seasonRef.current

      ctx!.globalAlpha = 1
      // Background fill — matches app bg for whichever of the three themes
      // is active (light / dark / gold; gold is layered on top of dark).
      ctx!.fillStyle = isGold ? '#0c0a07' : isDark ? '#0f172a' : '#f8fafc'
      ctx!.fillRect(0, 0, w, h)

      const numRGB = isDark ? '212,175,55' : '30,41,59'

      // ── Gena eve: numerals fall back, candles glow as at the vigil ──
      if (season?.phase === 'vigil') {
        const g = ctx!.createLinearGradient(0, h, 0, h * 0.4)
        g.addColorStop(0, isDark ? 'rgba(245,158,11,0.2)' : 'rgba(217,119,6,0.09)')
        g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx!.fillStyle = g
        ctx!.fillRect(0, h * 0.4, w, h * 0.6)
        for (const p of ps) {
          ctx!.font = p.geez
            ? `bold ${p.size}px "Noto Serif Ethiopic","Nyala","Ethiopia Jiret",serif`
            : `bold ${p.size}px "SF Mono","Fira Code","Courier New",monospace`
          ctx!.fillStyle = `rgba(${numRGB},${p.alpha * 0.4})`
          ctx!.fillText(p.char, p.x, p.y)
        }
        for (const c of tapers) {
          const flick = 0.5 + 0.5 * Math.sin(t * c.sf + c.ph)
          flame(c.x, c.y, c.r, (isDark ? 0.75 : 0.6) * (0.85 + 0.15 * flick), flick, isDark)
        }
        ctx!.globalAlpha = 1
        return
      }

      // ── Demera: numerals fade back, embers rise from a warm glow ──
      if (season?.phase === 'demera') {
        const pulse = 0.9 + 0.1 * Math.sin(t * 2.1)
        const g = ctx!.createLinearGradient(0, h, 0, h * 0.42)
        g.addColorStop(0, isDark ? `rgba(249,115,22,${0.32 * pulse})` : `rgba(234,88,12,${0.14 * pulse})`)
        g.addColorStop(0.45, isDark ? `rgba(194,65,12,${0.1 * pulse})` : `rgba(234,88,12,${0.05 * pulse})`)
        g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx!.fillStyle = g
        ctx!.fillRect(0, h * 0.42, w, h * 0.58)

        for (const p of ps) {
          ctx!.font = p.geez
            ? `bold ${p.size}px "Noto Serif Ethiopic","Nyala","Ethiopia Jiret",serif`
            : `bold ${p.size}px "SF Mono","Fira Code","Courier New",monospace`
          ctx!.fillStyle = `rgba(${numRGB},${p.alpha * 0.4})`
          ctx!.fillText(p.char, p.x, p.y)
        }

        const pal = isDark ? EMBER_DARK : EMBER_LIGHT
        for (const e of embers) {
          const life = Math.max(0, Math.min(1, e.y / h))
          const flick = 0.65 + 0.35 * Math.sin(t * e.sf * 4 + e.sway)
          const a = Math.max(0, e.a * life * flick * (isDark ? 1 : 0.75))
          ctx!.fillStyle = pal[e.c]
          // A soft halo instead of shadowBlur: the same glow at a fraction
          // of the cost on a full-window canvas.
          ctx!.globalAlpha = a * (isDark ? 0.18 : 0.1)
          ctx!.beginPath(); ctx!.arc(e.x, e.y, e.r * 3.2, 0, Math.PI * 2); ctx!.fill()
          ctx!.globalAlpha = a
          ctx!.beginPath(); ctx!.arc(e.x, e.y, e.r, 0, Math.PI * 2); ctx!.fill()
        }
        ctx!.globalAlpha = 1
        return
      }

      // ── Everything else: the usual constellation, some of it in bloom ──
      const share = season?.ornamentShare ?? 0
      const festive = season?.motif === 'festive'
      const bright = season?.phase === 'meskel' || season?.phase === 'christmas' || season?.phase === 'newyear' || season?.phase === 'gena'
      const lineRGB = bright
        ? (isDark ? '244,194,13' : '146,104,20')
        : (isDark ? '200,155,35' : '51,65,85')
      const lineK = bright ? 0.075 : 0.055

      // Chaotic connecting lines — all pairs within DIST
      ctx!.lineWidth = 0.75
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const d = Math.hypot(ps[j].x - ps[i].x, ps[j].y - ps[i].y)
          if (d < DIST) {
            ctx!.strokeStyle = `rgba(${lineRGB},${(1 - d / DIST) * lineK})`
            ctx!.beginPath()
            ctx!.moveTo(ps[i].x, ps[i].y)
            ctx!.lineTo(ps[j].x, ps[j].y)
            ctx!.stroke()
          }
        }
      }

      // Draw numerals — or, for the share in bloom, Adey Abeba
      for (const p of ps) {
        if (p.key < share) {
          if (!festive) daisy(p.x, p.y, p.size * 0.42, p.rot, (isDark ? 0.42 : 0.58) + p.alpha * 2.2)
          else if (p.kind < 0.55) {
            const tw = 0.7 + 0.3 * Math.sin(t * 1.6 + p.rot * 7)
            star(p.x, p.y, p.size * 0.38, p.rot, ((isDark ? 0.5 : 0.55) + p.alpha * 2) * tw, isDark ? STAR_DARK : STAR_LIGHT)
          } else {
            const flick = 0.5 + 0.5 * Math.sin(t * (2 + p.kind * 3) + p.rot * 5)
            flame(p.x, p.y, p.size * (isDark ? 0.16 : 0.2), (isDark ? 0.6 : 0.7) + p.alpha * 1.5, flick, isDark)
          }
          continue
        }
        ctx!.globalAlpha = 1
        ctx!.font = p.geez
          ? `bold ${p.size}px "Noto Serif Ethiopic","Nyala","Ethiopia Jiret",serif`
          : `bold ${p.size}px "SF Mono","Fira Code","Courier New",monospace`
        ctx!.fillStyle = `rgba(${numRGB},${p.alpha})`
        ctx!.fillText(p.char, p.x, p.y)
      }

      // New Year sparks, over everything else.
      if (sparks.length) {
        const pal = isDark ? SPARK_DARK : SPARK_LIGHT
        for (const s of sparks) {
          ctx!.globalAlpha = Math.max(0, s.life) * (isDark ? 0.9 : 0.85)
          ctx!.fillStyle = pal[s.c]
          ctx!.beginPath(); ctx!.arc(s.x, s.y, (isDark ? 1.1 : 1.5) + s.life * 1.5, 0, Math.PI * 2); ctx!.fill()
        }
      }
      ctx!.globalAlpha = 1
    }

    function tick(now: number) {
      t = now / 1000
      move()
      draw()
      raf = requestAnimationFrame(tick)
    }

    // People who have asked their system for less motion get a still frame:
    // numerals and daisies where they are, embers held in place. It is
    // redrawn whenever the theme, the season or the window size changes.
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    const themeWatch = new MutationObserver(() => { if (reduce.matches) draw() })
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    function start() {
      cancelAnimationFrame(raf)
      if (reduce.matches) draw()
      else raf = requestAnimationFrame(tick)
    }

    redrawRef.current = () => { if (reduce.matches) draw() }

    const onResize = () => { resize(); init(); if (reduce.matches) draw() }
    resize()
    init()
    start()
    window.addEventListener('resize', onResize)
    reduce.addEventListener('change', start)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      reduce.removeEventListener('change', start)
      themeWatch.disconnect()
      redrawRef.current = () => {}
    }
  }, [])

  return <canvas ref={ref} className="pointer-events-none fixed inset-0 z-0 print:hidden" aria-hidden />
}
