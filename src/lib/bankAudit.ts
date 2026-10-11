import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Tone } from '@/components/record/Record'
import type {
  BankAuditAccountRow, BankAuditFlagKind, BankAuditFlagRow, BankAuditScoreRow, BankAuditSettings, BankChargeRule, BankFlagSeverity,
} from '@/types/database'

// The bank audit (migrations 440–442): the statement as the last proof of
// what the payment workflow says was paid. Flags are what doesn't agree;
// the scorecard is how much of what was paid by bank the statement confirms.

export const FLAG_META: Record<BankAuditFlagKind, { label: string; short: string; help: string }> = {
  bank_not_recorded: {
    label: 'Paid by the bank, not in the system', short: 'Not recorded',
    help: 'Money left the account and nothing in the system accounts for it. Record the expense it was, or explain the line.',
  },
  money_in_no_sale: {
    label: 'Money in, no sale', short: 'No sale',
    help: 'Money came in and no sale or explanation is behind it. Record the sale, or explain the line.',
  },
  paid_not_in_bank: {
    label: 'Paid in the system, not on the statement', short: 'Not on the statement',
    help: 'Marked paid by bank on a day the statement covers, and the statement doesn’t show it. Match the line it was, or fix the payment.',
  },
  amount_mismatch: {
    label: 'Amount doesn’t tie', short: 'Doesn’t tie',
    help: 'The line and what it pays differ by more than one of the bank’s charges (amount − WHT + charge).',
  },
  duplicate_ref: {
    label: 'Same reference twice', short: 'Reference twice',
    help: 'One FT reference is on more than one payment, and one line doesn’t settle them together.',
  },
}

export const SEVERITY_META: Record<BankFlagSeverity, { label: string; tone: Tone; rank: number }> = {
  red: { label: 'Over a month', tone: 'red', rank: 0 },
  amber: { label: 'Over two weeks', tone: 'amber', rank: 1 },
  open: { label: 'Over a week', tone: 'blue', rank: 2 },
  new: { label: 'This week', tone: 'slate', rank: 3 },
}

/** What apply_bank_line_match calls each kind of payment. */
export const MATCH_KIND: Record<string, string> = {
  expense: 'expense', part: 'expense_part', batch: 'batch', vrf: 'vrf', payroll: 'payroll',
}

export function useBankAuditAccounts() {
  return useQuery({
    queryKey: ['bank-audit-accounts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_bank_audit_accounts').select('*').order('account_name')
      if (error) throw error
      return (data ?? []) as BankAuditAccountRow[]
    },
  })
}

export function useBankAuditFlags() {
  return useQuery({
    queryKey: ['bank-audit-flags'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_bank_audit_flags').select('*')
      if (error) throw error
      return (data ?? []) as BankAuditFlagRow[]
    },
  })
}

export function useBankAuditScorecard(from: string, to: string) {
  return useQuery({
    queryKey: ['bank-audit-scorecard', from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bank_audit_scorecard', { p_from: from, p_to: to })
      if (error) throw error
      return (data ?? []) as BankAuditScoreRow[]
    },
  })
}

export function useBankAuditSettings() {
  return useQuery({
    queryKey: ['bank-audit-settings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('bank_audit_settings').select('*').maybeSingle()
      if (error) throw error
      return data as BankAuditSettings | null
    },
  })
}

export function useBankChargeRules() {
  return useQuery({
    queryKey: ['bank-charge-rules'],
    queryFn: async () => {
      const { data, error } = await supabase.from('bank_charge_rules').select('*').order('amount')
      if (error) throw error
      return (data ?? []) as BankChargeRule[]
    },
  })
}

/** Everything the audit reads, after a match, an undo or a new rule. */
export function useRefreshBankAudit() {
  const qc = useQueryClient()
  return () => {
    for (const k of ['bank-audit-accounts', 'bank-audit-flags', 'bank-audit-scorecard', 'bank-charge-rules', 'bank-audit-settings',
      'bank-lines', 'bank-overview', 'bank-paid-without-line', 'v-payment-bank-check', 'ops-health-items']) {
      qc.invalidateQueries({ queryKey: [k] })
    }
  }
}
