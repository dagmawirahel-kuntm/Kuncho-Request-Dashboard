import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'

// A printable document (letterhead, tables, signatures) shown inside the app.
//
// The frame is sized to the document's full height and the box around it
// scrolls, instead of the frame scrolling itself. iPhone Safari is unreliable
// with frames that scroll inside a fixed pop-up: it would open them part-way
// down or clip the top, so the letterhead (logo, company name, Amharic title,
// document number) never showed and could not be scrolled back to. A frame
// that never scrolls has nothing to get wrong.
export const DocumentFrame = forwardRef<HTMLIFrameElement, {
  html: string
  title: string
  /** Size of the scrolling box, e.g. "h-full" or "h-[80vh]". */
  className?: string
  sandbox?: string
  id?: string
}>(function DocumentFrame({ html, title, className = 'h-full', sandbox, id }, ref) {
  const frame = useRef<HTMLIFrameElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  useImperativeHandle(ref, () => frame.current as HTMLIFrameElement)

  const measure = useCallback(() => {
    const doc = frame.current?.contentDocument
    if (!doc?.documentElement) return
    setHeight(Math.ceil(doc.documentElement.scrollHeight))
  }, [])

  const onLoad = useCallback(() => {
    const doc = frame.current?.contentDocument
    if (!doc) return
    // Documents give the body a full-window minimum height so a file opened
    // on its own looks like a page; here that would only feed back into the
    // measured height.
    const s = doc.createElement('style')
    s.textContent = 'html,body{min-height:0 !important;height:auto !important;overflow:visible !important}'
    doc.head?.appendChild(s)
    measure()
    // Web fonts and images arrive after load and change the height.
    doc.fonts?.ready.then(measure).catch(() => {})
    doc.querySelectorAll('img').forEach(img => { if (!img.complete) img.addEventListener('load', measure, { once: true }) })
    if (typeof ResizeObserver !== 'undefined' && doc.body) {
      const ro = new ResizeObserver(measure)
      ro.observe(doc.body)
      frame.current?.addEventListener('load', () => ro.disconnect(), { once: true })
    }
  }, [measure])

  // A new document starts at its letterhead.
  useEffect(() => { if (box.current) box.current.scrollTop = 0 }, [html])

  // The frame's width follows the box (phone rotation, a resized window).
  useEffect(() => {
    if (!box.current || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => measure())
    ro.observe(box.current)
    return () => ro.disconnect()
  }, [measure])

  return (
    <div ref={box} className={`${className} w-full overflow-y-auto overscroll-contain bg-white [-webkit-overflow-scrolling:touch]`}>
      <iframe
        ref={frame}
        id={id}
        srcDoc={html}
        title={title}
        sandbox={sandbox}
        onLoad={onLoad}
        style={{ height: height || '100%' }}
        className="block w-full border-0 bg-white"
      />
    </div>
  )
})
