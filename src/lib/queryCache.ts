import type { QueryClient } from '@tanstack/react-query'

/**
 * Drop the cached copy of a record that was just written.
 *
 * Invalidating the record key is NOT enough. React Query keeps an
 * invalidated entry in the cache and still hands it to the next mount —
 * with isLoading already false — while it refetches in the background.
 * Every form page in this app seeds its state with a `useState`
 * initializer, and React runs that exactly once, on first render. So the
 * form freezes the pre-save values it was handed and never picks up the
 * refetch when it lands. The saved change reads back as though it was
 * never written, on the detail page and on the form itself.
 *
 * That is what made ordinary saves look like data loss across the whole
 * system: the write succeeded every time, the read-back was stale.
 * Removing the entry instead forces a genuine load on the next mount.
 *
 * Keys match by prefix, so passing 'staff-member' clears
 * ['staff-member', id] for every id — including the record just saved.
 * Clearing sibling records of the same type is harmless; they refetch on
 * demand.
 */
export function dropRecordCache(qc: QueryClient, ...keys: string[]) {
  for (const key of keys) qc.removeQueries({ queryKey: [key] })
}
