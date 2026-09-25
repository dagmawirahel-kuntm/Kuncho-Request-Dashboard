import type { VrfPaymentState } from '@/types/database'

/** The VRF payment step (migration 326): to pay → approved → sent. */
export const PAYMENT_LABEL: Record<VrfPaymentState, string> = {
  to_pay: 'To pay',
  approved: 'Approved',
  sent: 'Sent',
}

export const PAYMENT_CLS: Record<VrfPaymentState, string> = {
  to_pay:   'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  approved: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  sent:     'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
}
