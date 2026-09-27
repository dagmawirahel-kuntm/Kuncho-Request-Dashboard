import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useAtmosphereSlot } from './atmosphereSlot'
import { worldVars, type WorldPalette } from '@/lib/clientWorld'

/** One kind of floating mark: a client's logo, or its initials. */
export interface Mote { key: string; logo: string | null; initials: string; color?: string }

interface Props {
  palette: WorldPalette
  motes: Mote[]
  /** How many marks float at once; they cycle through `motes`. */
  count?: number
  /** A mote key to bring forward (hovering a client on the journey page). */
  focusKey?: string | null
}

/**
 * The client's world behind the page: slow aurora in their colours, their
 * logo drifting at several depths and joined by faint lines (the same
 * constellation as the app's own background), dust rising, a light that
 * follows the pointer, and parallax as the page scrolls. It bursts out from
 * the middle when the page opens. Reduced motion gets one still frame.
 */
export function ClientAtmosphere(props: Props) {
  const { layer, scroller } = useAtmosphereSlot()
  if (!layer) return null
  return createPortal(<Scene {...props} scroller={scroller} />, layer)
}

type RGB = [number, number, number]
const toRgb = (hex: string): RGB => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const rgba = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`

interface P {
  x: number; y: number; vx: number; vy: number
  z: number; size: number; rot: number; vr: number
  mote: number; tint: number; alpha: number; boost: number
}
interface Dust { x: number; y: number; vy: number; r: number; ph: number; tint: number }

const LINK = 230

function Scene({ palette, motes, count, focusKey, scroller }: Props & { scroller: HTMLElement | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const live = useRef({ palette, motes, count, focusKey, scroller })
  const redraw = useRef<() => void>(() => {})
  useEffect(() => {
    live.current = { palette, motes, count, focusKey, scroller }
    redraw.current()
  }, [palette, motes, count, focusKey, scroller])

  useEffect(() => {
    const canvas = canvasRef.current
    const host = canvas?.parentElement
    const ctx = canvas?.getContext('2d')
    if (!canvas || !host || !ctx) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    let w = 0, h = 0, raf = 0, t0 = performance.now(), t = 0
    let ps: P[] = [], dust: Dust[] = []
    let builtFor = ''
    const pointer = { x: -9999, y: -9999, on: false }
    const cur: RGB[] = live.current.palette.colors.map(toRgb)

    // Logos, loaded once, and their silhouettes tinted per colour.
    const images = new Map<string, HTMLImageElement | 'failed'>()
    const tinted = new Map<string, HTMLCanvasElement>()
    function image(url: string) {
      const got = images.get(url)
      if (got) return got === 'failed' ? null : got.complete && got.naturalWidth ? got : null
      const img = new Image()
      img.decoding = 'async'
      img.onload = () => redraw.current()
      img.onerror = () => images.set(url, 'failed')
      img.src = url
      images.set(url, img)
      return null
    }
    function silhouette(url: string, color: string) {
      const key = `${url}|${color}`
      const hit = tinted.get(key)
      if (hit) return hit
      const img = image(url)
      if (!img) return null
      const W = 220
      const c = document.createElement('canvas')
      c.width = W
      c.height = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * W))
      const x = c.getContext('2d')!
      x.drawImage(img, 0, 0, c.width, c.height)
      x.globalCompositeOperation = 'source-in'
      x.fillStyle = color
      x.fillRect(0, 0, c.width, c.height)
      tinted.set(key, c)
      return c
    }

    function build(burst: boolean) {
      const { motes, count } = live.current
      const n = Math.max(1, Math.min(28, count ?? motes.length))
      const cx = w / 2, cy = h * 0.38
      ps = Array.from({ length: motes.length ? n : 0 }, (_, i) => {
        const z = 0.35 + Math.random() * 0.65
        const a = Math.random() * Math.PI * 2
        const sp = burst ? 2.5 + Math.random() * 5 : 0
        return {
          x: burst ? cx : Math.random() * w,
          y: burst ? cy : Math.random() * h,
          vx: Math.cos(a) * sp + (Math.random() - 0.5) * 0.3,
          vy: Math.sin(a) * sp + (Math.random() - 0.5) * 0.3,
          z, size: 26 + z * 58, rot: (Math.random() - 0.5) * 0.5, vr: (Math.random() - 0.5) * 0.0016,
          mote: i % motes.length, tint: i % 3, alpha: 0.11 + z * 0.14, boost: 0,
        }
      })
      dust = Array.from({ length: Math.round((w * h) / 26000) }, () => ({
        x: Math.random() * w, y: Math.random() * h, vy: -(0.08 + Math.random() * 0.3),
        r: 0.6 + Math.random() * 1.6, ph: Math.random() * Math.PI * 2, tint: Math.floor(Math.random() * 3),
      }))
      if (burst) t0 = performance.now()
    }

    function resize() {
      const r = host!.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const grew = !w
      w = r.width; h = r.height
      canvas!.width = Math.round(w * dpr); canvas!.height = Math.round(h * dpr)
      canvas!.style.width = `${w}px`; canvas!.style.height = `${h}px`
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (grew) { build(!reduce.matches); builtFor = motesKey() }
    }
    const motesKey = () => live.current.motes.map(m => `${m.key}:${m.logo ?? ''}`).join(',')

    function step() {
      const { motes, focusKey } = live.current
      const since = (performance.now() - t0) / 1000
      const settle = since < 2.4
      for (const p of ps) {
        // Wander, with the burst's speed bleeding away.
        p.vx += (Math.random() - 0.5) * 0.02
        p.vy += (Math.random() - 0.5) * 0.02
        const sp = Math.hypot(p.vx, p.vy)
        const cap = 0.42 * p.z
        if (sp > cap) { const k = settle ? 0.955 : 0.985; p.vx *= k; p.vy *= k }
        if (sp < 0.05) { p.vx += (Math.random() - 0.5) * 0.1; p.vy += (Math.random() - 0.5) * 0.1 }
        // The pointer pushes marks gently aside.
        if (pointer.on) {
          const dx = p.x - pointer.x, dy = p.y - pointer.y, d = Math.hypot(dx, dy)
          if (d < 160 && d > 0.1) { const f = (1 - d / 160) * 0.35; p.vx += (dx / d) * f; p.vy += (dy / d) * f }
        }
        p.x += p.vx; p.y += p.vy; p.rot += p.vr
        if (p.x < -90) p.x = w + 90
        if (p.x > w + 90) p.x = -90
        if (p.y < -90) p.y = h + 90
        if (p.y > h + 90) p.y = -90
        const want = focusKey && motes[p.mote]?.key === focusKey ? 1 : 0
        p.boost += (want - p.boost) * 0.08
      }
      for (const d of dust) {
        d.y += d.vy
        d.x += Math.sin(t * 0.6 + d.ph) * 0.12
        if (d.y < -6) { d.y = h + 6; d.x = Math.random() * w }
      }
      // Colours ease towards a new palette instead of jumping.
      const target = live.current.palette.colors.map(toRgb)
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cur[i][j] += (target[i][j] - cur[i][j]) * 0.06
    }

    function draw() {
      const { motes, palette } = live.current
      const dark = document.documentElement.classList.contains('dark')
      const since = (performance.now() - t0) / 1000
      const fadeIn = reduce.matches ? 1 : Math.min(1, since / 1.1)
      const scroll = live.current.scroller?.scrollTop ?? 0
      ctx!.clearRect(0, 0, w, h)

      // Positions after scroll parallax: deeper marks move less.
      const span = h + 180
      const py = (p: P) => ((((p.y - scroll * p.z * 0.22) + 90) % span) + span) % span - 90

      // The big, slow mark in the corner.
      const hero = motes[0]
      if (hero) {
        const bx = w * 0.7 + Math.sin(t * 0.07) * 24, by = h * 0.66 + Math.cos(t * 0.05) * 18 - scroll * 0.06
        const a = (dark ? 0.08 : 0.07) * fadeIn
        const sil = hero.logo ? silhouette(hero.logo, palette.colors[0]) : null
        ctx!.save()
        ctx!.globalAlpha = a
        ctx!.translate(bx, by)
        ctx!.rotate(-0.08 + Math.sin(t * 0.04) * 0.03)
        if (sil) {
          const bw = Math.min(w * 0.62, 980), bh = (sil.height / sil.width) * bw
          const k = bh > h * 0.7 ? (h * 0.7) / bh : 1
          ctx!.drawImage(sil, -(bw * k) / 2, -(bh * k) / 2, bw * k, bh * k)
        } else if (!hero.logo || images.get(hero.logo) === 'failed') {
          ctx!.fillStyle = rgba(cur[0], 1)
          ctx!.font = `900 ${Math.round(Math.min(h * 0.62, w * 0.42))}px ui-sans-serif, system-ui, sans-serif`
          ctx!.textAlign = 'center'; ctx!.textBaseline = 'middle'
          ctx!.fillText(hero.initials, 0, 0)
        }
        ctx!.restore()
      }

      // A light where the pointer is.
      if (pointer.on) {
        const g = ctx!.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, 280)
        g.addColorStop(0, rgba(cur[1], dark ? 0.14 : 0.1))
        g.addColorStop(1, rgba(cur[1], 0))
        ctx!.fillStyle = g
        ctx!.fillRect(pointer.x - 280, pointer.y - 280, 560, 560)
      }

      // The constellation.
      ctx!.lineWidth = 0.8
      const ys = ps.map(py)
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const d = Math.hypot(ps[j].x - ps[i].x, ys[j] - ys[i])
          if (d < LINK) {
            ctx!.strokeStyle = rgba(cur[0], (1 - d / LINK) * (dark ? 0.2 : 0.14) * fadeIn)
            ctx!.beginPath(); ctx!.moveTo(ps[i].x, ys[i]); ctx!.lineTo(ps[j].x, ys[j]); ctx!.stroke()
          }
        }
      }

      // Dust.
      for (const d of dust) {
        const tw = 0.5 + 0.5 * Math.sin(t * 1.6 + d.ph)
        ctx!.fillStyle = rgba(cur[d.tint], (dark ? 0.55 : 0.4) * tw * fadeIn)
        ctx!.beginPath(); ctx!.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx!.fill()
      }

      // The marks.
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i], m = motes[p.mote]
        if (!m) continue
        const color = m.color ?? palette.colors[p.tint]
        const a = Math.min(0.9, (p.alpha * (dark ? 1.25 : 1) + p.boost * 0.45) * fadeIn)
        const size = p.size * (1 + p.boost * 0.4)
        ctx!.save()
        ctx!.translate(p.x, ys[i])
        ctx!.rotate(p.rot)
        ctx!.globalAlpha = a
        const sil = m.logo ? silhouette(m.logo, color) : null
        if (sil) {
          const sw = size * 1.5, sh = (sil.height / sil.width) * sw
          const k = sh > size ? size / sh : 1
          ctx!.drawImage(sil, -(sw * k) / 2, -(sh * k) / 2, sw * k, sh * k)
        } else {
          ctx!.strokeStyle = color
          ctx!.lineWidth = 1.2
          ctx!.beginPath(); ctx!.arc(0, 0, size * 0.5, 0, Math.PI * 2); ctx!.stroke()
          ctx!.fillStyle = color
          ctx!.font = `800 ${Math.round(size * 0.36)}px ui-sans-serif, system-ui, sans-serif`
          ctx!.textAlign = 'center'; ctx!.textBaseline = 'middle'
          ctx!.fillText(m.initials, 0, 1)
        }
        ctx!.restore()
      }
    }

    function tick(now: number) {
      t = now / 1000
      const key = motesKey()
      if (key !== builtFor) { build(ps.length === 0); builtFor = key }
      step()
      draw()
      raf = requestAnimationFrame(tick)
    }

    function still() {
      const key = motesKey()
      if (key !== builtFor) { build(false); builtFor = key }
      const target = live.current.palette.colors.map(toRgb)
      for (let i = 0; i < 3; i++) cur[i] = target[i]
      draw()
    }
    function start() {
      cancelAnimationFrame(raf)
      if (reduce.matches) still()
      else raf = requestAnimationFrame(tick)
    }
    redraw.current = () => { if (reduce.matches) still() }

    const onMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect()
      pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top
      pointer.on = pointer.x >= 0 && pointer.y >= 0 && pointer.x <= r.width && pointer.y <= r.height
    }
    const onLeave = () => { pointer.on = false }
    const ro = new ResizeObserver(() => { resize(); if (reduce.matches) still() })
    const themeWatch = new MutationObserver(() => { if (reduce.matches) still() })

    resize()
    start()
    ro.observe(host)
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    window.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerleave', onLeave)
    reduce.addEventListener('change', start)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      themeWatch.disconnect()
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', onLeave)
      reduce.removeEventListener('change', start)
      redraw.current = () => {}
    }
  }, [])

  return (
    <div className="world-atmo absolute inset-0" style={worldVars(palette)}>
      <div className="world-base absolute inset-0" />
      <div className="world-blob world-blob-1" />
      <div className="world-blob world-blob-2" />
      <div className="world-blob world-blob-3" />
      <canvas ref={canvasRef} className="absolute inset-0" />
      <div className="world-vignette absolute inset-0" />
    </div>
  )
}
