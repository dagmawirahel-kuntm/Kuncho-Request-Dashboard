import { useEffect, useRef } from 'react'

// Ge'ez / Ethiopic numerals ፩–፻
const GEEZ = ['፩','፪','፫','፬','፭','፮','፯','፰','፱','፲','፳','፴','፵','፶','፷','፸','፹','፺','፻']
// Arabic numerals mixed in
const ARABIC = ['1','2','3','4','5','6','7','8','9','12','24','36','48','60','72','100']
// 2:1 ratio Ge'ez to Arabic — Ge'ez dominates
const POOL = [...GEEZ, ...GEEZ, ...ARABIC]

const N = 42            // particle count
const DIST = 270        // max connection distance (px)

type P = {
  x: number; y: number
  vx: number; vy: number
  char: string; geez: boolean
  size: number; alpha: number
}

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
  }
}

export function AnimatedBackground() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf: number
    let ps: P[] = []
    let w = 0, h = 0

    function resize() {
      w = canvas!.width  = window.innerWidth
      h = canvas!.height = window.innerHeight
    }

    function init() {
      ps = Array.from({ length: N }, () => spawn(w, h))
    }

    function tick() {
      const isDark = document.documentElement.classList.contains('dark')

      // Background fill — matches app bg
      ctx!.fillStyle = isDark ? '#0f172a' : '#f8fafc'
      ctx!.fillRect(0, 0, w, h)

      const numRGB  = isDark ? '212,175,55'  : '30,41,59'
      const lineRGB = isDark ? '200,155,35'  : '51,65,85'

      // Organically wander each particle
      for (const p of ps) {
        p.vx += (Math.random() - 0.5) * 0.025
        p.vy += (Math.random() - 0.5) * 0.025
        const spd = Math.hypot(p.vx, p.vy)
        if (spd > 0.95) { p.vx *= 0.97; p.vy *= 0.97 }
        if (spd < 0.08) { p.vx += (Math.random() - 0.5) * 0.18; p.vy += (Math.random() - 0.5) * 0.18 }
        p.x += p.vx; p.y += p.vy
        if (p.x < -60) p.x = w + 60
        if (p.x > w + 60) p.x = -60
        if (p.y < -60) p.y = h + 60
        if (p.y > h + 60) p.y = -60
      }

      // Chaotic connecting lines — all pairs within DIST
      ctx!.lineWidth = 0.75
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const d = Math.hypot(ps[j].x - ps[i].x, ps[j].y - ps[i].y)
          if (d < DIST) {
            ctx!.strokeStyle = `rgba(${lineRGB},${(1 - d / DIST) * 0.055})`
            ctx!.beginPath()
            ctx!.moveTo(ps[i].x, ps[i].y)
            ctx!.lineTo(ps[j].x, ps[j].y)
            ctx!.stroke()
          }
        }
      }

      // Draw numerals
      for (const p of ps) {
        ctx!.font = p.geez
          ? `bold ${p.size}px "Noto Serif Ethiopic","Nyala","Ethiopia Jiret",serif`
          : `bold ${p.size}px "SF Mono","Fira Code","Courier New",monospace`
        ctx!.fillStyle = `rgba(${numRGB},${p.alpha})`
        ctx!.fillText(p.char, p.x, p.y)
      }

      raf = requestAnimationFrame(tick)
    }

    const onResize = () => { resize(); init() }
    resize()
    init()
    tick()
    window.addEventListener('resize', onResize)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize) }
  }, [])

  return <canvas ref={ref} className="pointer-events-none fixed inset-0 z-0" aria-hidden />
}
