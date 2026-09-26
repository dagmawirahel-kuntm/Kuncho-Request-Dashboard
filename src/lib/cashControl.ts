import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { AccountRole } from '@/types/database'

// v_account_control (migration 347): one row per account — what the app and
// the bank say, how far the statements run, and money waiting to move on.
export interface AccountControl {
  account_id: string
  account_name: string
  role: AccountRole | null
  status: string | null
  type: string | null
  account_number: string | null
  not_opened: boolean
  has_activity: boolean
  app_balance: number
  statement_balance: number | null
  statement_date: string | null
  statement_age_days: number | null
  app_balance_at_statement: number | null
  line_count: number | null
  open_count: number | null
  oldest_open: string | null
  closed_through: string | null
  closed_balance: number | null
  last_import_at: string | null
  awaiting_bank_amount: number
  awaiting_bank_count: number
  waiting_to_move: number
  waiting_since: string | null
  waiting_days: number | null
}

export const ROLE_LABEL: Record<AccountRole, string> = {
  main: 'Main',
  collection: 'Collection',
  wallet: 'Wallet',
  cash: 'Cash',
  other: 'Other',
}

export const ROLE_HINT: Record<AccountRole, string> = {
  main: 'Payments go out from here',
  collection: 'Clients pay in; money moves on to the main account',
  wallet: 'Holds money for vendor requests',
  cash: 'Cash on hand',
  other: '',
}

// How long money may sit in a collection bank before it is flagged (days).
export const SWEEP_AFTER_DAYS = 3

export function useAccountControl() {
  return useQuery({
    queryKey: ['account-control'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_account_control').select('*')
      if (error) throw error
      return (data ?? []) as AccountControl[]
    },
  })
}

// v_bank_alerts (migration 351).
export type AlertSeverity = 'high' | 'medium' | 'low'
export interface BankAlert {
  kind: 'collection_waiting' | 'stale_statement' | 'forecast_short' | 'old_open_lines' | 'large_open_line' | 'sent_not_on_bank' | 'possible_duplicate'
  severity: AlertSeverity
  account_id: string | null
  account_name: string | null
  title: string
  detail: string | null
  amount: number | null
  since: string | null
  link: string | null
  ref_id: string | null
}

const SEVERITY_ORDER: Record<AlertSeverity, number> = { high: 0, medium: 1, low: 2 }

export function useBankAlerts(accountId?: string) {
  return useQuery({
    queryKey: ['bank-alerts', accountId ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('v_bank_alerts').select('*')
      if (accountId) q = q.eq('account_id', accountId)
      const { data, error } = await q
      if (error) throw error
      return ((data ?? []) as BankAlert[]).sort((a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (b.amount ?? 0) - (a.amount ?? 0))
    },
  })
}

// v_cash_forecast_items / cash_forecast() (migration 349).
export type Certainty = 'committed' | 'expected' | 'possible'
export interface ForecastItem {
  kind: 'expense' | 'vrf' | 'payroll' | 'sale' | 'payment_request' | 'milestone'
  source_id: string
  label: string
  detail: string | null
  account_id: string | null
  account_name: string | null
  due_date: string
  expected_date: string
  overdue: boolean
  amount: number
  certainty: Certainty
  stage: string
  link: string | null
}
export interface ForecastDay {
  day: string
  opening: number
  money_in: number
  money_out: number
  closing: number
  item_count: number
}

// v_account_ledger_tieout (migration 350).
export interface LedgerTieout {
  account_id: string
  account_name: string
  role: AccountRole | null
  account_code: string
  statement_date: string | null
  statement_balance: number | null
  ledger_balance: number
  ledger_at_statement: number | null
  difference: number | null
  opening_net: number | null
  open_net: number
  open_count: number
  unposted_net: number
  unposted_count: number
  before_statements: number
  not_on_bank: number
  not_on_bank_count: number
  unexplained: number | null
}

export function useLedgerTieout(accountId?: string) {
  return useQuery({
    queryKey: ['ledger-tieout', accountId ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('v_account_ledger_tieout').select('*')
      if (accountId) q = q.eq('account_id', accountId)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as LedgerTieout[]
    },
  })
}

// month_end_checklist() (migration 350).
export interface ChecklistItem {
  account_id: string | null
  account_name: string | null
  check_key: string
  state: 'ok' | 'todo' | 'warn'
  title: string
  detail: string
  amount: number | null
  item_count: number | null
  link: string | null
}

// bank_line_events (migration 351).
export interface BankLineEvent {
  id: string
  line_id: string
  account_id: string | null
  action: 'matched' | 'explained' | 'unmatched'
  kind: string | null
  target_label: string | null
  auto: boolean
  note: string | null
  actor: string | null
  at: string
}

export function daysAgoLabel(days: number | null | undefined): string {
  if (days == null) return ''
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}
