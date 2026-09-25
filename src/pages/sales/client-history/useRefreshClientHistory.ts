import { useQueryClient } from '@tanstack/react-query'

/** Refresh everything the client history page reads for one client. */
export function useRefreshClientHistory(clientId: string) {
  const qc = useQueryClient()
  return () => {
    for (const k of ['client-relationship', 'client-timeline', 'client-contacts', 'client-interactions']) {
      qc.invalidateQueries({ queryKey: [k, clientId] })
    }
    qc.invalidateQueries({ queryKey: ['client-relationships'] })
  }
}
