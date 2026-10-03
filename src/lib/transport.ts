import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { TransportDriver, TransportJobStatus } from '@/types/database'

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

/** The driver list, with trips (v_transport_drivers, migration 410). */
export function useTransportDrivers() {
  return useQuery({
    queryKey: ['transport-drivers'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_transport_drivers').select('*').order('trips', { ascending: false }).order('full_name')
      if (error) throw error
      return (data ?? []) as TransportDriver[]
    },
  })
}

export const HIRED_CLASS_LABEL: Record<string, string> = {
  lada: 'Lada', mini_isuzu: 'Mini Isuzu', isuzu: 'Isuzu', toyota_carryon: 'Toyota with carry-on', other: 'Other',
}

/** How a driver is paid, in a few words — "CBE 1000…", "telebirr 09…", "cash". */
export function payoutLabel(d: Pick<TransportDriver, 'payout_method' | 'bank_name' | 'account_number'>): string | null {
  if (d.payout_method === 'cash') return 'Cash'
  if (!d.account_number) return null
  if (d.payout_method === 'telebirr') return `telebirr ${d.account_number}`
  return `${d.bank_name ? `${d.bank_name} ` : ''}${d.account_number}`
}

/** Where a job's payment stands, from its linked expense (payment_state). */
export type PayStage = 'none' | 'waiting' | 'approved' | 'sent' | 'paid' | 'not_needed'
export const PAY_STAGE: Record<PayStage, { label: string; cls: string }> = {
  none:       { label: 'Not asked',       cls: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400' },
  waiting:    { label: 'Awaiting approval', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  approved:   { label: 'Approved to pay', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  sent:       { label: 'Sent',            cls: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' },
  paid:       { label: 'Paid',            cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  not_needed: { label: 'n/a',             cls: 'text-slate-400' },
}
export function payStageOf(mode: string, expense: { payment_state: string | null } | null | undefined): PayStage {
  if (!expense) return mode === 'own_fleet' ? 'not_needed' : 'none'
  switch (expense.payment_state) {
    case 'paid': return 'paid'
    case 'sent': return 'sent'
    case 'approved_to_pay': return 'approved'
    default: return 'waiting'
  }
}
