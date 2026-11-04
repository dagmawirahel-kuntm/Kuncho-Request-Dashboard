import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { CheckCircle2, Undo2, X } from 'lucide-react'
import { clearTrail, readTrail, setTrail, useTrail, workPlaceNote, workPlaceOf } from '@/lib/returnTrail'

const pathOf = (to: string) => to.split('?')[0]
const NUDGE_MS = 20_000

/**
 * "Back to Bank reconciliation · CBE · 12 Oct · 5,000.00" — pinned over every
 * page after a link took you off a work place, until you go back or close
 * it. After something is done (a success toast) it asks plainly to go back
 * and finish, so one task doesn't end halfway because the way back was lost.
 */
export function ReturnTrailBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const trail = useTrail()
  const prev = useRef(location.pathname + location.search)
  const lastContentClick = useRef(0)
  // A clock that ticks only to end the "done here?" moment, 20 s after a nudge.
  const [now, setNow] = useState(() => Date.now())

  // Only links followed inside the page leave a trail; the sidebar and top
  // bar are a deliberate move elsewhere.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.('main')) lastContentClick.current = Date.now()
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  useEffect(() => {
    const here = location.pathname + location.search
    const before = prev.current
    prev.current = here
    const t = readTrail()
    // Back where it leads, by the bar, the browser or a link: done.
    if (t && pathOf(t.to) === location.pathname) { clearTrail(); return }
    const fromPath = pathOf(before)
    const place = workPlaceOf(fromPath)
    if (place && fromPath !== location.pathname && !workPlaceOf(location.pathname)
        && Date.now() - lastContentClick.current < 1500) {
      setTrail({ to: before, label: place.label, detail: workPlaceNote(fromPath) })
    }
  }, [location.pathname, location.search])

  // A success elsewhere: say "done here? go back" for a while.
  const nudgedAt = trail?.nudgedAt ?? null
  useEffect(() => {
    if (!nudgedAt) return
    const id = setTimeout(() => setNow(Date.now()), Math.max(0, nudgedAt + NUDGE_MS - Date.now()) + 50)
    return () => clearTimeout(id)
  }, [nudgedAt])
  const nudged = !!nudgedAt && now - nudgedAt < NUDGE_MS

  if (!trail || pathOf(trail.to) === location.pathname) return null

  function goBack() {
    const to = trail!.to
    clearTrail()
    navigate(to)
  }

  return (
    <div className="relative z-20 shrink-0 print:hidden" role="region" aria-label="Where you were working">
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-2 transition-colors sm:px-6 ${nudged
        ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/30'
        : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'}`}>
        {nudged ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden /> : <Undo2 className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />}
        <p className="min-w-0 flex-1 text-sm text-slate-600 dark:text-slate-300">
          {nudged ? <>Done here? <b className="text-slate-900 dark:text-white">Go back to {trail.label}</b> to finish it.</>
            : <>You were working in <b className="text-slate-900 dark:text-white">{trail.label}</b>.</>}
          {trail.detail && <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">{trail.detail}</span>}
        </p>
        <button onClick={goBack}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 ${nudged
            ? 'bg-emerald-600 ring-2 ring-emerald-300 ring-offset-1 dark:ring-offset-slate-900' : 'bg-brand'}`}>
          <Undo2 className="h-4 w-4" /> Back to it
        </button>
        <button onClick={clearTrail} aria-label="Forget where I was" title="Forget where I was"
          className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
