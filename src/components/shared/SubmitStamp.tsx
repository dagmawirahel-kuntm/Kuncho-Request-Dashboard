import { useEffect, useRef, useState } from 'react'
import { confetti, onStamp, type StampDetail } from '@/lib/celebrate'

/**
 * Plays the ቁ seal when a form submits something new (lib/celebrate's
 * submitted()). Mounted once in the app shell, so it keeps playing while
 * the form navigates back to its list.
 */
export function SubmitStampHost() {
  const [shown, setShown] = useState<(StampDetail & { id: number }) | null>(null)
  const seal = useRef<HTMLDivElement>(null)
  const next = useRef(0)

  useEffect(() => onStamp(d => setShown({ ...d, id: ++next.current })), [])

  useEffect(() => {
    if (!shown) return
    // Confetti as the seal lands, from the seal itself.
    const land = window.setTimeout(() => confetti('pop', seal.current), 300)
    const done = window.setTimeout(() => setShown(null), 2200)
    return () => { window.clearTimeout(land); window.clearTimeout(done) }
  }, [shown])

  if (!shown) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-50 flex justify-center px-4 print:hidden" role="status" aria-live="polite">
      <div key={shown.id} className="stamp-card flex items-center gap-4 rounded-2xl bg-[#151a1f] py-3 pl-3 pr-6 text-white shadow-2xl ring-1 ring-[#D4AF37]/40">
        <div ref={seal} className="relative h-14 w-14 shrink-0">
          <span className="stamp-ring absolute inset-0 rounded-full ring-4 ring-[#D4AF37]" />
          <div className="stamp-seal flex h-14 w-14 items-center justify-center rounded-full border-4 border-double border-[#D4AF37]! bg-[#D4AF37]/15 font-ethiopic text-2xl font-bold text-[#D4AF37]">
            ቁ
          </div>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{shown.title}</p>
          {shown.note && <p className="text-xs text-white/65">{shown.note}</p>}
        </div>
      </div>
    </div>
  )
}
