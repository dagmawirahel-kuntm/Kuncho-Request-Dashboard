import { useEffect, useRef, useState } from 'react'
import { Eraser, PenLine } from 'lucide-react'

// A signature drawn with a finger (529). It comes out as a small PNG data
// URL (a few KB) that is saved with the record itself — nothing to upload,
// so it works on a weak signal at the vendor's counter.
const W = 600
const H = 200

export function SignaturePad({ value, onChange, label = 'Sign here' }: {
  value: string | null
  onChange: (dataUrl: string | null) => void
  label?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const ink = useRef(0)          // how much was drawn: a dot is not a signature
  const [empty, setEmpty] = useState(!value)

  useEffect(() => {
    const c = ref.current
    if (!c) return
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, W, H)
    ctx.lineWidth = 2.6
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#0f172a'
    if (value) {
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0, W, H)
      img.src = value
    }
    // draw once on mount; later values come from this pad
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function at(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }
  }
  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    last.current = at(e)
    const ctx = e.currentTarget.getContext('2d')!
    ctx.beginPath()
    ctx.arc(last.current.x, last.current.y, 1.2, 0, Math.PI * 2)
    ctx.fillStyle = '#0f172a'
    ctx.fill()
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !last.current) return
    const p = at(e)
    const ctx = e.currentTarget.getContext('2d')!
    ctx.beginPath()
    ctx.moveTo(last.current.x, last.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    ink.current += Math.hypot(p.x - last.current.x, p.y - last.current.y)
    last.current = p
  }
  function up() {
    if (!drawing.current) return
    drawing.current = false
    last.current = null
    if (ink.current < 40) return
    setEmpty(false)
    onChange(ref.current!.toDataURL('image/png'))
  }
  function clear() {
    const ctx = ref.current!.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, W, H)
    ink.current = 0
    setEmpty(true)
    onChange(null)
  }

  return (
    <div className="space-y-1">
      <div className="relative overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-white dark:border-slate-600">
        <canvas ref={ref} width={W} height={H}
          className="block h-36 w-full touch-none cursor-crosshair sm:h-40"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up}
          aria-label={label} role="img" />
        {empty && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1.5 text-sm text-slate-400">
            <PenLine className="h-4 w-4" /> {label}
          </span>
        )}
        <span className="pointer-events-none absolute inset-x-6 bottom-8 border-b border-slate-200" />
      </div>
      <div className="flex items-center justify-between text-[11px] text-slate-400">
        <span>{empty ? 'Sign with a finger' : 'Signed'}</span>
        {!empty && (
          <button type="button" onClick={clear} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:text-red-500">
            <Eraser className="h-3 w-3" /> Clear and sign again
          </button>
        )}
      </div>
    </div>
  )
}
