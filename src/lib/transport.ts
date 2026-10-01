import { supabase } from '@/lib/supabase'
import type { TransportJobStatus } from '@/types/database'

/**
 * The one next thing to do with a transport job, as a button. A job that
 * was requested can be started straight away — "assigned" is optional, set
 * by whoever plans the day, not a step anyone has to click through.
 */
export const NEXT_STEP: Partial<Record<TransportJobStatus, { to: TransportJobStatus; label: string }>> = {
  requested:   { to: 'in_progress', label: 'Start' },
  assigned:    { to: 'in_progress', label: 'Start' },
  in_progress: { to: 'completed',   label: 'Done' },
}

export const OPEN_JOB_STATUSES: TransportJobStatus[] = ['requested', 'assigned', 'in_progress']

/** Moves jobs on. Completion time and the vehicle's status are set by the database. */
export async function setJobStatus(ids: string[], next: TransportJobStatus) {
  const patch: Record<string, unknown> = { job_status: next }
  if (next === 'completed') patch.actual_delivery_date = new Date().toISOString().slice(0, 10)
  return supabase.from('transportation_requests').update(patch).in('id', ids).select('id')
}
