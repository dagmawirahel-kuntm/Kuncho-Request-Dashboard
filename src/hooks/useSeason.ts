import { useEffect, useState } from 'react'
import { getSeasonMoment, sameMoment, type SeasonMoment } from '@/lib/seasons'

/**
 * The current seasonal moment, re-read once a minute so phase changes
 * (the Demera lighting at 18:00 on Saturday, say) happen on an open page
 * without a reload. Only publishes a new value when something visible
 * changed, so the shell isn't re-rendered every minute for nothing.
 */
export function useSeason(): SeasonMoment | null {
  const [moment, setMoment] = useState<SeasonMoment | null>(() => getSeasonMoment())
  useEffect(() => {
    const id = window.setInterval(() => {
      const next = getSeasonMoment()
      setMoment(prev => (sameMoment(prev, next) ? prev : next))
    }, 60_000)
    return () => window.clearInterval(id)
  }, [])
  return moment
}
