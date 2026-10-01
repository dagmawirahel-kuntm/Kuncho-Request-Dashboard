import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useAccounts, useUserProfiles } from '@/hooks/useLookups'
import type {
  ToPayQueueRow, AccountCashPositionRow, RecentPaymentRow, OpenVendorAdvanceRow,
  ExpensePaymentMethod, AwaitingBankConfirmationRow, AccountStatementSummaryRow,
} from '@/types/database'

// The Payments page's data: one query per stage of
// approve → pay → sent → confirmed, shared by the pipeline strip and the
// tab that works that stage.

export const PAYMENT_METHODS: { value: ExpensePaymentMethod; label: string }[] = [
  { value: 'transfer', label: 'Bank Transfer' },
  { value: 'cpo', label: 'CPO / Cheque Deposit' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'cash', label: 'Cash' },
  { value: 'vrf', label: 'VRF (Vendor Receipt Facilitation)' },
  { value: 'other', label: 'Other' },
]

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  ...Object.fromEntries(PAYMENT_METHODS.map(m => [m.value, m.label])),
  batch_wire: 'Batch Wire',
  // Display-only, deliberately absent from PAYMENT_METHODS: an expense
  // becomes 'vendor_credit' only through settle_expense_with_vendor_credit(),
  // which draws down the credit and posts it.
  vendor_credit: 'Vendor Credit',
}

/** What actually leaves the bank for a to-pay row: after WHT and any vendor credit. */
export const toSend = (r: Pick<ToPayQueueRow, 'cash_to_send' | 'net_payable' | 'amount_etb'>) =>
  Number(r.cash_to_send ?? r.net_payable ?? r.amount_etb ?? 0)

export type WhtToPrepareRow = {
  expense_id: string; expense_code: string | null; vendor_name: string | null; vendor_tin: string | null
  amount_etb: number | null; wht_amount: number | null; net_payable: number | null; paid_date: string | null
}

export function usePaymentsData() {
  const toPay = useQuery({
    queryKey: ['v-to-pay-queue'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_to_pay_queue').select('*').order('finance_approved_at')
      if (error) throw error
      return (data ?? []) as ToPayQueueRow[]
    },
  })
  // What waits for approval, from the approval queue (395): the same rows,
  // with what holds each one up.
  const toApprove = useQuery({
    queryKey: ['expense-approval-queue-summary'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_expense_approval_queue').select('id, amount_etb, age_days, issues')
      if (error) throw error
      return (data ?? []) as { id: string; amount_etb: number; age_days: number; issues: string[] }[]
    },
  })
  const cash = useQuery({
    queryKey: ['v-account-cash-position'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_account_cash_position').select('*').order('account_name')
      if (error) throw error
      return (data ?? []) as AccountCashPositionRow[]
    },
  })
  const awaitingBank = useQuery({
    queryKey: ['v-awaiting-bank-confirmation'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_awaiting_bank_confirmation').select('*').order('payment_state_changed_at')
      if (error) throw error
      return (data ?? []) as AwaitingBankConfirmationRow[]
    },
  })
  const statements = useQuery({
    queryKey: ['v-account-statement-summary'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_account_statement_summary').select('*')
      if (error) throw error
      return (data ?? []) as AccountStatementSummaryRow[]
    },
  })
  const recent = useQuery({
    queryKey: ['v-recent-payments'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_recent_payments').select('*').order('payment_state_changed_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as RecentPaymentRow[]
    },
  })
  const advances = useQuery({
    queryKey: ['v-open-vendor-advances'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_open_vendor_advances').select('*')
      if (error) throw error
      return (data ?? []) as OpenVendorAdvanceRow[]
    },
  })
  const wht = useQuery({
    queryKey: ['v-wht-receipts-to-prepare'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_wht_receipts_to_prepare').select('*').order('paid_date', { ascending: false })
      if (error) throw error
      return (data ?? []) as WhtToPrepareRow[]
    },
  })
  return { toPay, toApprove, cash, awaitingBank, statements, recent, advances, wht }
}

/** The GRN that lets each advance close, by PO. */
export function useAdvanceGrns(advances: OpenVendorAdvanceRow[]) {
  const ids = useMemo(() => advances.map(a => a.sourcing_bundle_id).filter((x): x is string => !!x), [advances])
  return useQuery({
    queryKey: ['advance-grns', ids],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('goods_received_notes')
        .select('sourcing_bundle_id, grn_code, received_at').in('sourcing_bundle_id', ids).order('received_at', { ascending: false })
      if (error) throw error
      const m: Record<string, { grn_code: string | null; received_at: string | null }> = {}
      for (const g of (data ?? []) as { sourcing_bundle_id: string; grn_code: string | null; received_at: string | null }[]) {
        if (!m[g.sourcing_bundle_id]) m[g.sourcing_bundle_id] = { grn_code: g.grn_code, received_at: g.received_at }
      }
      return m
    },
  })
}

export function useIsVrfManager() {
  const { role, user } = useAuth()
  const { data } = useQuery({
    queryKey: ['my-profile-vrf', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase.from('user_profiles').select('is_vrf_manager').eq('id', user!.id).maybeSingle()
      return data as { is_vrf_manager: boolean } | null
    },
  })
  return !!data?.is_vrf_manager || role === 'admin'
}

/** Who may send a payment (finance and admin), and the accounts it can come from. */
export function usePayerAndAccountOptions() {
  const { data: userProfiles = [] } = useUserProfiles()
  const { data: accounts = [] } = useAccounts()
  const payerOptions = useMemo(
    () => (userProfiles as { id: string; full_name: string; role: string }[])
      .filter(u => u.role === 'admin' || u.role === 'finance').map(u => ({ id: u.id, label: u.full_name })),
    [userProfiles])
  const accountOptions = useMemo(
    () => (accounts as { id: string; account_name: string; account_number: string | null }[])
      .map(a => ({ id: a.id, label: a.account_name, sub: a.account_number ?? undefined })),
    [accounts])
  return { payerOptions, accountOptions }
}

export function useRefreshPayments() {
  const qc = useQueryClient()
  return () => {
    for (const k of ['v-to-pay-queue', 'expense-approval-queue-summary', 'v-account-cash-position', 'v-recent-payments',
      'v-open-vendor-advances', 'v-awaiting-bank-confirmation', 'v-account-statement-summary', 'v-wht-receipts-to-prepare',
      'expenses', 'expense-approval-queue']) qc.invalidateQueries({ queryKey: [k] })
  }
}

/** Days → a short age, and the tone it deserves. */
export const ageTone = (d: number | null | undefined, warn = 7, bad = 14) =>
  d == null ? 'slate' as const : d >= bad ? 'red' as const : d >= warn ? 'amber' as const : 'slate' as const
export const ageLabel = (d: number | null | undefined) => d == null ? '—' : d < 1 ? 'today' : `${Math.floor(d)}d`
