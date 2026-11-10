import { useSyncExternalStore } from 'react'

/** Whether a CSS media query matches now, following it as the window changes. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    cb => {
      const mq = window.matchMedia(query)
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}
