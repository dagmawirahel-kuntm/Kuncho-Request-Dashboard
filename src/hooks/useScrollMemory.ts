import { useEffect, useRef } from 'react'

// Remembers how far down a page was scrolled, per tab of the browser, and
// puts it back when the person returns (after saving an expense, say) —
// once the page's data has loaded, so there is something to scroll to.
// The app scrolls inside <main>, not the window.
export function useScrollMemory(key: string, ready: boolean) {
  const restored = useRef(false)
  const storageKey = `scroll:${key}`

  useEffect(() => { restored.current = false }, [storageKey])

  useEffect(() => {
    const main = document.querySelector('main')
    if (!main) return
    if (ready && !restored.current) {
      restored.current = true
      let y = 0
      try { y = Number(sessionStorage.getItem(storageKey) ?? 0) } catch { /* storage blocked */ }
      if (y > 0) requestAnimationFrame(() => requestAnimationFrame(() => { main.scrollTop = y }))
    }
    let t = 0
    const onScroll = () => {
      window.clearTimeout(t)
      t = window.setTimeout(() => { try { sessionStorage.setItem(storageKey, String(Math.round(main.scrollTop))) } catch { /* storage blocked */ } }, 150)
    }
    main.addEventListener('scroll', onScroll, { passive: true })
    return () => { window.clearTimeout(t); main.removeEventListener('scroll', onScroll) }
  }, [storageKey, ready])
}
