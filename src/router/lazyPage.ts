import { lazy, type ComponentType } from 'react'

// A page loaded the first time it is opened. If its file can't be fetched —
// usually because a new version was deployed while the tab was open and the
// old file is gone — reload once to pick up the new version instead of
// leaving the page stuck. A second failure in the same tab is shown as an
// error, so a real outage doesn't loop.
const RELOADED = 'kuncho-page-reload'

export function lazyPage<T extends ComponentType<object>>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const m = await load()
      try { sessionStorage.removeItem(RELOADED) } catch { /* private mode */ }
      return m
    } catch (e) {
      let reloaded = false
      try { reloaded = sessionStorage.getItem(RELOADED) === '1'; sessionStorage.setItem(RELOADED, '1') } catch { /* private mode */ }
      if (!reloaded) {
        window.location.reload()
        return new Promise<{ default: T }>(() => {})
      }
      throw e
    }
  })
}
