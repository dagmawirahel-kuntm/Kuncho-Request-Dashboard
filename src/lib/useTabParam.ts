import { useCallback } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'

/**
 * The open tab of a record page, kept in the URL (?tab=) so a link, a
 * refresh or the back button lands on the same tab. An old #anchor link
 * (e.g. /projects/:id#boq) opens the tab of that name.
 */
export function useTabParam<T extends string>(tabs: readonly T[], fallback: T): [T, (t: T) => void] {
  const [params, setParams] = useSearchParams()
  const { hash } = useLocation()
  const fromUrl = params.get('tab') ?? hash.replace('#', '')
  const tab = (tabs as readonly string[]).includes(fromUrl) ? (fromUrl as T) : fallback
  const setTab = useCallback((t: T) => {
    setParams(p => {
      const next = new URLSearchParams(p)
      if (t === fallback) next.delete('tab'); else next.set('tab', t)
      return next
    }, { replace: true })
  }, [setParams, fallback])
  return [tab, setTab]
}
