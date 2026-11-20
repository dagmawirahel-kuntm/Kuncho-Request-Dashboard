// Noticing a new deployment (vite.config.ts writes /version.json per build).
// Pages load their code the first time they're opened; after a deploy the old
// files are gone, so a tab left open would fail to open its next page and
// reload in the middle of whatever was on screen. Instead the tab checks now
// and then, and when a new version is out it moves to the next page with a
// full load — the moment the person is leaving the page anyway.
import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

declare const __BUILD_ID__: string
const CHECK_EVERY = 5 * 60_000

async function latestBuild(): Promise<string | null> {
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) return null
    const j = await r.json() as { build?: string }
    return j.build ?? null
  } catch { return null }
}

export function useSwitchToNewVersion() {
  const location = useLocation()
  const stale = useRef(false)
  const first = useRef(true)

  useEffect(() => {
    if (typeof __BUILD_ID__ === 'undefined' || import.meta.env.DEV) return
    const check = async () => {
      const b = await latestBuild()
      if (b && b !== __BUILD_ID__) stale.current = true
    }
    check()
    const t = setInterval(check, CHECK_EVERY)
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible) }
  }, [])

  // Moving to another page: if a new version is out, load that page fresh.
  const path = location.pathname
  useEffect(() => {
    if (first.current) { first.current = false; return }
    if (stale.current) window.location.assign(window.location.href)
  }, [path])
}
