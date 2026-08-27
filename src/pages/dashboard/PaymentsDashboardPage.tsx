import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { RoleViewSwitcher } from '@/components/shared/RoleViewSwitcher'
import { useToast } from '@/contexts/ToastContext'
import { useUserProfiles, useAccounts } from '@/hooks/useLookups'
import { FileUpload } from '@/components/shared/FileUpload'
import { formatCurrency, formatDate } from '@/lib/utils'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { KpiCard } from '@/components/shared/KpiCard'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { BankReferenceInput } from '@/components/shared/BankReferenceInput'
import type {
  ToPayQueueRow, FinancePendingApprovalRow, AccountCashPositionRow, RecentPaymentRow, OpenVendorAdvanceRow,
  ExpensePaymentMethod, AwaitingBankConfirmationRow, AccountStatementSummaryRow, MatchableRow,
} from '@/types/database'
import {
  Clock, CheckCircle2, Send, Landmark, Layers, X, AlertTriangle, Receipt, HandCoins,
  ChevronDown, FileClock, Tag,
} from 'lucide-react'

const PAYMENT_METHODS: { value: ExpensePaymentMethod; label: string }[] = [
  { value: 'transfer', label: 'Bank Transfer' },
  { value: 'cpo', label: 'CPO / Cheque Deposit' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'cash', label: 'Cash' },
  { value: 'vrf', label: 'VRF (Vendor Receipt Facilitation)' },
  { value: 'other', label: 'Other' },
]

const PAYMENT_METHOD_LABEL: Record<string, string> = Object.fromEntries(PAYMENT_METHODS.map(m => [m.value, m.label]))
PAYMENT_METHOD_LABEL['batch_wire'] = 'Batch Wire'

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 overflow-hidden">
      <div className="px-4 py-3 border-b dark:border-slate-700">
        <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">{title}</h2>
        {sub && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{sub}</p>}
      </div>
      {children}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-8 text-center text-sm text-slate-400 dark:text-slate-500">{children}</div>
}

// ── Cash ticker board ──────────────────────────────────────────────
// Replaces the old 34-row Cash Position table. 33 of 34 accounts are
// dormant zeros; a table of them is a scroll wall. This shows only
// accounts with statement activity as tiles, collapses the rest into a
// single chip, and reads like a trading board pinned to the top.
function CashTicker({ positions, loading, summaries, awaiting }: {
  positions: AccountCashPositionRow[]
  loading: boolean
  summaries: Record<string, AccountStatementSummaryRow>
  awaiting: Record<string, { count: number; total: number }>
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const funded = positions.filter(p => p.total_credits !== 0 || p.total_debits !== 0)
  const dormant = positions.length - funded.length
  const total = positions.reduce((s, p) => s + p.cash_position, 0)
  const openAcct = funded.find(a => a.account_id === expanded)
  const openSummary = expanded ? summaries[expanded] : undefined
  const openAwaiting = expanded ? awaiting[expanded] : undefined
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100 overflow-hidden">
      <div className="flex items-center gap-2 mb-3">
        <span className="h-1.5 w-1.5 rounded-full bg-teal-300 shadow-[0_0_0_3px_rgba(94,234,212,0.25)]" />
        <span className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-slate-400">Cash position</span>
        <div className="ml-auto text-right">
          <p className={`text-base font-bold tabular-nums ${total < 0 ? 'text-red-300' : ''}`}>{formatCurrency(total)}</p>
          <p className="text-[9.5px] uppercase tracking-[0.12em] text-slate-400">net across {positions.length} accounts</p>
        </div>
      </div>
      {loading ? (
        <p className="py-3 text-center text-xs text-slate-500">Loading…</p>
      ) : positions.length === 0 ? (
        <p className="py-3 text-center text-xs text-slate-500">No accounts with statement activity yet.</p>
      ) : (
        <div className="flex gap-2.5 overflow-x-auto pb-0.5">
          {funded.map(a => {
            const neg = a.cash_position < 0
            const summ = summaries[a.account_id]
            const unmatched = summ?.unmatched_lines ?? 0
            const isOpen = expanded === a.account_id
            return (
              <button
                key={a.account_id}
                onClick={() => setExpanded(p => (p === a.account_id ? null : a.account_id))}
                className={`flex-shrink-0 min-w-[230px] text-left rounded-[11px] border px-3 py-2.5 transition-colors ${isOpen ? 'border-teal-400/60 bg-white/[0.06]' : 'border-slate-700 bg-white/[0.03] hover:bg-white/[0.05]'}`}
              >
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <Landmark className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                  <span className="truncate">{a.account_name}</span>
                  <ChevronDown className={`ml-auto h-3.5 w-3.5 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </div>
                <div className={`mt-1.5 text-lg font-bold tabular-nums tracking-tight ${neg ? 'text-red-300' : ''}`}>
                  {formatCurrency(a.cash_position)}
                </div>
                <div className="mt-1 flex gap-3 text-[10.5px] tabular-nums">
                  <span className="text-emerald-300">+{formatCurrency(a.total_credits)} in</span>
                  <span className="text-red-300">−{formatCurrency(a.total_debits)} out</span>
                </div>
                {unmatched > 0 && (
                  <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-sky-400/[0.15] px-1.5 py-1 text-[10px] font-medium text-sky-300">
                    <FileClock className="h-2.5 w-2.5 flex-shrink-0" />{unmatched} line{unmatched !== 1 ? 's' : ''} to reconcile
                  </div>
                )}
              </button>
            )
          })}
          {dormant > 0 && (
            <div className="flex-shrink-0 min-w-[130px] rounded-[11px] border border-dashed border-slate-700 px-3 py-2.5 flex flex-col justify-center text-slate-500">
              <div className="text-2xl font-bold tabular-nums text-slate-400">{dormant}</div>
              <div className="text-[10.5px] leading-tight">dormant accounts<br />no statement activity</div>
            </div>
          )}
        </div>
      )}

      {openAcct && (
        <div className="mt-3 rounded-[11px] border border-slate-700 bg-black/20 px-3.5 py-3">
          <div className="flex items-center justify-between gap-2 mb-2.5">
            <span className="text-xs font-semibold text-slate-200">{openAcct.account_name}</span>
            <span className="text-[10px] text-slate-500">
              {openSummary?.last_import_at ? `last import ${formatDate(openSummary.last_import_at)}` : 'never imported'}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-slate-200">
            <div><p className="text-[9.5px] uppercase tracking-wide text-slate-500">Statement lines</p><p className="text-sm font-bold tabular-nums">{openSummary?.committed_lines ?? 0}</p></div>
            <div><p className="text-[9.5px] uppercase tracking-wide text-slate-500">Matched</p><p className="text-sm font-bold tabular-nums text-emerald-300">{openSummary?.matched_lines ?? 0}</p></div>
            <div><p className="text-[9.5px] uppercase tracking-wide text-slate-500">Unmatched</p><p className={`text-sm font-bold tabular-nums ${(openSummary?.unmatched_lines ?? 0) > 0 ? 'text-sky-300' : ''}`}>{openSummary?.unmatched_lines ?? 0}</p></div>
            <div><p className="text-[9.5px] uppercase tracking-wide text-slate-500">Payments waiting</p><p className={`text-sm font-bold tabular-nums ${(openAwaiting?.count ?? 0) > 0 ? 'text-amber-300' : ''}`}>{openAwaiting?.count ?? 0}</p></div>
          </div>
          <div className="mt-2.5 flex items-center justify-between gap-2 flex-wrap">
            {openAcct.cash_position < 0 && (
              <span className="inline-flex items-center gap-1.5 text-[10px] text-amber-300">
                <AlertTriangle className="h-2.5 w-2.5" /> Net of imported lines only — opening balance not loaded
              </span>
            )}
            <Link to="/bank-statement-import" className="ml-auto inline-flex items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-sky-700">
              <Landmark className="h-3 w-3" /> Reconcile in bank import
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Vendor advances hero ───────────────────────────────────────────
// Money already out the door with no goods confirmed — the single
// biggest exposure finance carries. Promoted from a modest list to a
// hero with the total, an aging breakdown, and the largest vendor.
function AdvancesHero({ advances, canAct, onClose, closingId, grnByBundle, onRecordCredit }: {
  advances: OpenVendorAdvanceRow[]
  canAct: boolean
  onClose: (id: string) => void
  closingId: string | null
  grnByBundle: Record<string, { grn_code: string | null; received_at: string | null }>
  onRecordCredit: (advance: OpenVendorAdvanceRow) => void
}) {
  const total = advances.reduce((s, a) => s + (a.amount_etb ?? 0), 0)
  const bucket = (d: number | null) => (d == null ? 'fresh' : d >= 14 ? 'aging' : d >= 7 ? 'watch' : 'fresh')
  const sums = { fresh: 0, watch: 0, aging: 0 }
  const counts = { fresh: 0, watch: 0, aging: 0 }
  for (const a of advances) {
    const b = bucket(a.days_open) as keyof typeof sums
    sums[b] += a.amount_etb ?? 0; counts[b] += 1
  }
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0)
  const sorted = [...advances].sort((x, y) => (y.amount_etb ?? 0) - (x.amount_etb ?? 0))
  const top = sorted.slice(0, 3)
  const rest = sorted.slice(3)
  const restTotal = rest.reduce((s, a) => s + (a.amount_etb ?? 0), 0)
  const largest = sorted[0]
  const agePill = (d: number | null) => {
    if (d == null || d < 1) return <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:text-slate-400">today</span>
    const cls = d >= 14 ? 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400'
      : d >= 7 ? 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
      : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
    return <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{Math.floor(d)}d open</span>
  }

  return (
    <div className="rounded-xl border border-amber-200 dark:border-amber-800/50 overflow-hidden bg-gradient-to-b from-amber-50 to-white dark:from-amber-900/15 dark:to-slate-800">
      <div className="flex flex-wrap gap-4 items-start px-4 pt-4 pb-3">
        <div className="flex-1 min-w-[220px]">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
            <HandCoins className="h-3.5 w-3.5" /> Money out, goods not yet in
          </div>
          <div className="mt-1 text-3xl font-extrabold tracking-tight tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(total)}</div>
          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {advances.length} vendor advance{advances.length !== 1 ? 's' : ''} open — paid before delivery, waiting on a GRN to close
          </div>
          <div className="mt-3 flex h-2 rounded-full overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900/40">
            {sums.fresh > 0 && <span className="h-full bg-emerald-500" style={{ width: `${pct(sums.fresh)}%` }} />}
            {sums.watch > 0 && <span className="h-full bg-amber-500" style={{ width: `${pct(sums.watch)}%` }} />}
            {sums.aging > 0 && <span className="h-full bg-red-500" style={{ width: `${pct(sums.aging)}%` }} />}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-3.5 text-[10.5px] text-slate-500 dark:text-slate-400">
            <span><span className="inline-block w-2 h-2 rounded-sm bg-emerald-500 mr-1.5 align-middle" />Fresh &lt; 7d · <b className="text-slate-700 dark:text-slate-200">{counts.fresh}</b></span>
            <span><span className="inline-block w-2 h-2 rounded-sm bg-amber-500 mr-1.5 align-middle" />Watch 7–13d · <b className="text-slate-700 dark:text-slate-200">{counts.watch}</b></span>
            <span><span className="inline-block w-2 h-2 rounded-sm bg-red-500 mr-1.5 align-middle" />Aging 14d+ · <b className="text-slate-700 dark:text-slate-200">{counts.aging}</b></span>
          </div>
        </div>
        {largest && (
          <div className="w-[210px] flex-shrink-0">
            <div className="text-[10px] uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">Largest exposure</div>
            <div className="mt-0.5 font-bold text-slate-800 dark:text-slate-100 truncate">{largest.vendor_name ?? largest.expense_code ?? '—'}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{largest.bundle_code ?? '—'} · <span className="tabular-nums">{formatCurrency(largest.amount_etb ?? 0)}</span></div>
            {total > 0 && (
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {Math.round(((largest.amount_etb ?? 0) / total) * 100)}% of all open advances sits with one vendor.
              </div>
            )}
          </div>
        )}
      </div>
      <div className="border-t border-amber-200 dark:border-amber-800/40">
        {top.map(a => {
          const grn = a.sourcing_bundle_id ? grnByBundle[a.sourcing_bundle_id] : undefined
          return (
          <div key={a.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-amber-100 dark:border-slate-700/60 last:border-b-0">
            <div className="min-w-0">
              <Link to={`/expenses/${a.id}`} className="font-semibold text-sm text-slate-800 dark:text-slate-100 hover:text-brand hover:underline">
                {a.vendor_name ?? a.item_service_description ?? a.expense_code}
              </Link>
              <div className="mt-0.5 flex items-center gap-2 flex-wrap text-xs text-slate-500 dark:text-slate-400">
                <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 text-[10px]">{a.bundle_code ?? '—'}</span>
                {agePill(a.days_open)}
                {grn ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="h-2.5 w-2.5" />
                    {grn.grn_code ?? 'GRN'}{grn.received_at ? ` · ${formatDate(grn.received_at)}` : ''}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                    <Clock className="h-2.5 w-2.5" /> waiting on GRN
                  </span>
                )}
              </div>
            </div>
            <div className="ml-auto font-bold text-sm tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(a.amount_etb ?? 0)}</div>
            {canAct && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => onRecordCredit(a)}
                  title="Reduce this advance for a vendor discount agreed after ordering — the difference stays as a credit with this vendor"
                  className="flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  <Tag className="h-3 w-3" /> Credit
                </button>
                <button
                  onClick={() => onClose(a.id)}
                  disabled={closingId === a.id || !grn}
                  title={grn ? undefined : 'A GRN must be recorded for this PO before the advance can close'}
                  className="flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <CheckCircle2 className="h-3 w-3" /> {closingId === a.id ? 'Closing…' : grn ? 'Close on GRN' : 'Close'}
                </button>
              </div>
            )}
          </div>
          )
        })}
        {rest.length > 0 && (
          <div className="px-4 py-2.5 text-center text-xs text-slate-500 dark:text-slate-400">
            + {rest.length} more open advance{rest.length !== 1 ? 's' : ''} · <b className="text-slate-700 dark:text-slate-200 tabular-nums">{formatCurrency(restTotal)}</b>
          </div>
        )}
      </div>
    </div>
  )
}

export default function PaymentsDashboardPage() {
  const { role, user } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const canAct = role === 'admin' || role === 'finance'

  // VRF payments are confirmed by the VRF-manager badge holder (or admin).
  const { data: me } = useQuery({
    queryKey: ['my-profile-vrf', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('user_profiles').select('is_vrf_manager').eq('id', user!.id).maybeSingle()
      return data as { is_vrf_manager: boolean } | null
    },
    enabled: !!user?.id,
  })
  const isVrfManager = !!me?.is_vrf_manager || role === 'admin'

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [splitting, setSplitting] = useState<any | null>(null)

  const { data: toPayQueue = [], isLoading: loadingQueue } = useQuery({
    queryKey: ['v-to-pay-queue'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_to_pay_queue').select('*').order('finance_approved_at')
      if (error) throw error
      return data as ToPayQueueRow[]
    },
  })

  const { data: pendingApproval = [], isLoading: loadingPending } = useQuery({
    queryKey: ['v-finance-pending-approval'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_finance_pending_approval').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data as FinancePendingApprovalRow[]
    },
  })

  const { data: cashPositions = [], isLoading: loadingCash } = useQuery({
    queryKey: ['v-account-cash-position'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_account_cash_position').select('*').order('account_name')
      if (error) throw error
      return data as AccountCashPositionRow[]
    },
  })

  // Every sent bank payment still waiting on a matched statement line —
  // any age, oldest first — so a statement imported weeks after payment
  // can still reach them. Time-boxed "This Week" never could.
  const { data: awaitingConfirmation = [] } = useQuery({
    queryKey: ['v-awaiting-bank-confirmation'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_awaiting_bank_confirmation').select('*').order('payment_state_changed_at')
      if (error) throw error
      return data as AwaitingBankConfirmationRow[]
    },
  })

  const { data: accountSummaries = [] } = useQuery({
    queryKey: ['v-account-statement-summary'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_account_statement_summary').select('*')
      if (error) throw error
      return data as AccountStatementSummaryRow[]
    },
  })
  const summaryByAccount = useMemo(
    () => Object.fromEntries(accountSummaries.map(s => [s.account_id, s])) as Record<string, AccountStatementSummaryRow>,
    [accountSummaries]
  )
  const awaitingByAccount = useMemo(() => {
    const m: Record<string, { count: number; total: number }> = {}
    for (const a of awaitingConfirmation) {
      const k = a.account_id ?? '—'
      if (!m[k]) m[k] = { count: 0, total: 0 }
      m[k].count += 1; m[k].total += a.net_payable ?? a.amount_etb ?? 0
    }
    return m
  }, [awaitingConfirmation])

  const { data: recentPayments = [], isLoading: loadingRecent } = useQuery({
    queryKey: ['v-recent-payments'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_recent_payments').select('*').order('payment_state_changed_at', { ascending: false })
      if (error) throw error
      return data as RecentPaymentRow[]
    },
  })

  const { data: openAdvances = [] } = useQuery({
    queryKey: ['v-open-vendor-advances'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_open_vendor_advances').select('*')
      if (error) throw error
      return data as OpenVendorAdvanceRow[]
    },
  })

  // The GRN is what closes an advance — link paid money to the receipt
  // that clears it. An advance can only be closed once its PO has a GRN,
  // so surfacing that status turns "waiting on a GRN" into a live cue and
  // makes the Close button honest about whether it will actually work.
  const advanceBundleIds = useMemo(
    () => openAdvances.map(a => a.sourcing_bundle_id).filter((x): x is string => !!x),
    [openAdvances]
  )
  const { data: grnByBundle = {} } = useQuery({
    queryKey: ['advance-grns', advanceBundleIds],
    queryFn: async () => {
      if (advanceBundleIds.length === 0) return {} as Record<string, { grn_code: string | null; received_at: string | null }>
      const { data, error } = await supabase
        .from('goods_received_notes')
        .select('sourcing_bundle_id, grn_code, received_at')
        .in('sourcing_bundle_id', advanceBundleIds)
        .order('received_at', { ascending: false })
      if (error) throw error
      const m: Record<string, { grn_code: string | null; received_at: string | null }> = {}
      for (const g of (data ?? []) as { sourcing_bundle_id: string; grn_code: string | null; received_at: string | null }[]) {
        if (!m[g.sourcing_bundle_id]) m[g.sourcing_bundle_id] = { grn_code: g.grn_code, received_at: g.received_at }
      }
      return m
    },
    enabled: advanceBundleIds.length > 0,
  })

  // Paid payments that levied WHT and still need a withholding receipt — a cue
  // for the paying finance and the tax officer.
  const { data: whtToPrepare = [] } = useQuery({
    queryKey: ['v-wht-receipts-to-prepare'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_wht_receipts_to_prepare').select('*').order('paid_date', { ascending: false })
      if (error) throw error
      return data as { expense_id: string; expense_code: string | null; vendor_name: string | null; vendor_tin: string | null; amount_etb: number | null; wht_amount: number | null; net_payable: number | null; paid_date: string | null }[]
    },
  })
  async function markWhtPrepared(expenseId: string) {
    const { error } = await supabase.rpc('mark_wht_receipt_prepared', { p_expense_id: expenseId, p_receipt_url: null, p_receipt_name: null })
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['v-wht-receipts-to-prepare'] })
    toast('Withholding receipt marked prepared', 'success')
  }

  const { data: userProfiles = [] } = useUserProfiles()
  const payerOptions = useMemo(
    () => (userProfiles as { id: string; full_name: string; role: string }[])
      .filter(u => u.role === 'admin' || u.role === 'finance')
      .map(u => ({ id: u.id, label: u.full_name })),
    [userProfiles]
  )

  const { data: accounts = [] } = useAccounts()
  const accountOptions = useMemo(
    () => (accounts as { id: string; account_name: string; account_number: string | null }[])
      .map(a => ({ id: a.id, label: a.account_name, sub: a.account_number ?? undefined })),
    [accounts]
  )

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ['v-to-pay-queue'] })
    qc.invalidateQueries({ queryKey: ['v-finance-pending-approval'] })
    qc.invalidateQueries({ queryKey: ['v-account-cash-position'] })
    qc.invalidateQueries({ queryKey: ['v-recent-payments'] })
    qc.invalidateQueries({ queryKey: ['v-open-vendor-advances'] })
    qc.invalidateQueries({ queryKey: ['v-awaiting-bank-confirmation'] })
    qc.invalidateQueries({ queryKey: ['v-account-statement-summary'] })
    qc.invalidateQueries({ queryKey: ['expenses'] })
  }

  // ── To-Pay Queue: selection + actions ──────────────────────────────
  const [selectedQueue, setSelectedQueue] = useState<Set<string>>(new Set())
  const [payerId, setPayerId] = useState<string | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<ExpensePaymentMethod>('transfer')
  const [sendingBulk, setSendingBulk] = useState(false)
  const [batchModalOpen, setBatchModalOpen] = useState(false)
  const [advancingRow, setAdvancingRow] = useState<ToPayQueueRow | null>(null)

  // Pay-in-advance rows need a different action (payment_state = 'advance',
  // not 'sent') — bulk "Mark as Sent" would leave them stranded, since the
  // DB won't let a pattern-B expense reach 'paid' except by way of
  // 'advance' first. Kept out of the bulk-selectable set entirely rather
  // than relying on everyone remembering not to select them.
  const bulkSelectableQueue = useMemo(() => toPayQueue.filter(r => r.payment_pattern !== 'pay_in_advance'), [toPayQueue])

  function toggleQueueRow(id: string) {
    setSelectedQueue(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function toggleQueueAll() {
    setSelectedQueue(prev => (prev.size === bulkSelectableQueue.length ? new Set() : new Set(bulkSelectableQueue.map(r => r.id))))
  }

  const selfApprovedConflict = useMemo(() => {
    if (!payerId) return []
    return toPayQueue.filter(r => selectedQueue.has(r.id) && r.finance_approved_by === payerId)
  }, [toPayQueue, selectedQueue, payerId])

  async function handleMarkSent() {
    if (selectedQueue.size === 0) return
    if (!payerId) { toast('Select who is sending this payment', 'error'); return }
    if (selfApprovedConflict.length > 0) {
      toast(`Payer approved ${selfApprovedConflict.length} of these — pick someone else, or have a different approver re-check`, 'error')
      return
    }
    setSendingBulk(true)
    const { error } = await supabase
      .from('expenses')
      .update({ payment_state: 'sent', disbursed_by: payerId, payment_method: paymentMethod })
      .in('id', Array.from(selectedQueue))
    setSendingBulk(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`Marked ${selectedQueue.size} expense(s) as sent`, 'success')
    setSelectedQueue(new Set())
    invalidateAll()
  }

  // ── Pending Approval: approve action ───────────────────────────────
  async function handleApprove(id: string) {
    const { error } = await supabase.from('expenses').update({ approval_status: 'finance_approved' }).eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    toast('Approved — moved to the to-pay queue', 'success')
    invalidateAll()
  }

  // ── Recent Payments: match to bank line / VRF / confirm cash ────────
  const [matching, setMatching] = useState<MatchableRow | null>(null)
  const [linkingVrf, setLinkingVrf] = useState<RecentPaymentRow | null>(null)
  const [confirmingCash, setConfirmingCash] = useState<string | null>(null)
  const [methodFilter, setMethodFilter] = useState<string>('all')

  const filteredRecentPayments = useMemo(
    () => methodFilter === 'all' ? recentPayments : recentPayments.filter(r => (r.payment_method ?? 'unset') === methodFilter),
    [recentPayments, methodFilter]
  )

  async function handleConfirmCash(id: string) {
    setConfirmingCash(id)
    const { error } = await supabase.rpc('confirm_expense_cash_payment', { p_expense_id: id })
    setConfirmingCash(null)
    if (error) { toast(error.message, 'error'); return }
    toast('Cash payment confirmed', 'success')
    invalidateAll()
  }

  const [closingAdvanceId, setClosingAdvanceId] = useState<string | null>(null)
  async function handleCloseAdvance(id: string) {
    setClosingAdvanceId(id)
    const { error } = await supabase.rpc('close_vendor_advance', { p_expense_id: id })
    setClosingAdvanceId(null)
    // The RPC itself is the source of truth on whether this is legal (e.g.
    // "no GRN exists yet") — surfacing its own message rather than
    // duplicating that check client-side.
    if (error) { toast(error.message, 'error'); return }
    toast('Advance closed — expense is now paid', 'success')
    invalidateAll()
  }

  const [creditingAdvance, setCreditingAdvance] = useState<OpenVendorAdvanceRow | null>(null)

  const kpis = {
    // Net payable is what actually leaves the bank (VAT in, WHT withheld) —
    // the figure on the PO. Falls back to gross when there's no net.
    toPayTotal: toPayQueue.reduce((s, r) => s + (r.net_payable ?? r.amount_etb ?? 0), 0),
    pendingCount: pendingApproval.length,
    advancesTotal: openAdvances.reduce((s, r) => s + (r.amount_etb ?? 0), 0),
    paidThisWeek: recentPayments.filter(r => r.payment_state === 'paid').reduce((s, r) => s + (r.net_payable ?? r.amount_etb ?? 0), 0),
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Payments</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Approve → to-pay → sent → confirmed against the bank statement</p>
      </div>

      {/* This is the landing page for finance, and a finance user can
          also be the named PM on projects. Renders nothing for anyone
          without an assignment. */}
      <RoleViewSwitcher mode="assigned-pm" role={role} />

      {/* KPI summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="To-Pay Queue" value={formatCurrency(kpis.toPayTotal)} sub={`${toPayQueue.length} approved · net payable`} icon={Send} color="bg-amber-50 text-amber-500" />
        <KpiCard label="Pending Approval" value={kpis.pendingCount} sub="awaiting finance sign-off" icon={Clock} color="bg-slate-100 text-slate-500" />
        <KpiCard label="Vendor Advances" value={formatCurrency(kpis.advancesTotal)} sub={`${openAdvances.length} open · paid, goods not in`} icon={HandCoins} color="bg-amber-50 text-amber-600" />
        <KpiCard label="Paid This Week" value={formatCurrency(kpis.paidThisWeek)} sub="confirmed against bank statement" icon={CheckCircle2} color="bg-emerald-50 text-emerald-500" />
      </div>

      {/* Cash board — replaces the old 34-row table; only funded accounts show */}
      <CashTicker positions={cashPositions} loading={loadingCash} summaries={summaryByAccount} awaiting={awaitingByAccount} />

      {/* Vendor advances — the biggest exposure on the page, up top */}
      {openAdvances.length > 0 && (
        <AdvancesHero advances={openAdvances} canAct={canAct} onClose={handleCloseAdvance} closingId={closingAdvanceId} grnByBundle={grnByBundle} onRecordCredit={setCreditingAdvance} />
      )}

      {/* ── 1. To-Pay Queue (headline) ───────────────────────────────── */}
      <Section title="To-Pay Queue" sub="Finance-approved, awaiting payment. Amounts are the net that reaches the vendor (VAT in, WHT withheld) — the figure on the PO. A bank method settles by matching a bank line; VRF hands it to the VRF badge holder.">

        {canAct && toPayQueue.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-b bg-brand/5 dark:bg-brand/10 dark:border-slate-700 px-4 py-3">
            {selectedQueue.size > 0 && (
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{selectedQueue.size} selected</span>
            )}
            <div className="w-56">
              <SearchableSelect value={payerId} onChange={setPayerId} options={payerOptions} placeholder="Who is paying?" />
            </div>
            <select
              className="rounded-md border px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              value={paymentMethod}
              onChange={e => setPaymentMethod(e.target.value as ExpensePaymentMethod)}
            >
              {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            {selectedQueue.size > 0 && (
              <>
                <button
                  onClick={handleMarkSent}
                  disabled={sendingBulk}
                  className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" /> Mark as Sent
                </button>
                <button
                  onClick={() => setBatchModalOpen(true)}
                  disabled={!payerId}
                  className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
                  title={!payerId ? 'Select a payer first' : undefined}
                >
                  <Layers className="h-3.5 w-3.5" /> Create Batch Payment
                </button>
                {selfApprovedConflict.length > 0 && (
                  <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                    <AlertTriangle className="h-3.5 w-3.5" /> Payer approved {selfApprovedConflict.length} of these
                  </span>
                )}
                <button onClick={() => setSelectedQueue(new Set())} className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
                  Clear selection
                </button>
              </>
            )}
            {selectedQueue.size === 0 && bulkSelectableQueue.length === 0 && (
              <span className="text-xs text-slate-400">Set the payer above, then use Record Advance on any row below.</span>
            )}
          </div>
        )}
        {loadingQueue ? (
          <Empty>Loading…</Empty>
        ) : toPayQueue.length === 0 ? (
          <Empty>Nothing waiting to be paid.</Empty>
        ) : (
          <>
            {/* Desktop/tablet: real table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/60 text-left text-xs text-slate-500 dark:text-slate-400">
                  <tr>
                    {canAct && (
                      <th className="px-4 py-2 w-8">
                        <input type="checkbox" checked={bulkSelectableQueue.length > 0 && selectedQueue.size === bulkSelectableQueue.length} onChange={toggleQueueAll} className="rounded border-slate-300 text-brand focus:ring-brand" />
                      </th>
                    )}
                    <th className="px-4 py-2">Vendor</th>
                    <th className="px-4 py-2">Project / Cost Group</th>
                    <th className="px-4 py-2 text-right">To vendor (net)</th>
                    <th className="px-4 py-2 text-center">WHT</th>
                    <th className="px-4 py-2 text-right">Age</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-slate-700">
                  {toPayQueue.map(r => {
                    const isAdvance = r.payment_pattern === 'pay_in_advance'
                    return (
                    <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      {canAct && (
                        <td className="px-4 py-2.5">
                          {!isAdvance && (
                            <input type="checkbox" checked={selectedQueue.has(r.id)} onChange={() => toggleQueueRow(r.id)} className="rounded border-slate-300 text-brand focus:ring-brand" />
                          )}
                        </td>
                      )}
                      <td className="px-4 py-2.5">
                        <Link to={`/expenses/${r.id}`} className="font-medium text-slate-800 dark:text-slate-100 hover:text-brand hover:underline">
                          {r.vendor_name ?? r.item_service_description ?? r.expense_code}
                        </Link>
                        {isAdvance && (
                          <span className="ml-1.5 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">Advance</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">
                        {r.project_name ?? '—'}{r.cost_group_name ? ` · ${r.cost_group_name}` : ''}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(r.net_payable ?? r.amount_etb ?? 0)}</div>
                        {(r.wht_amount ?? 0) > 0 && (
                          <div className="text-[10px] text-slate-400 dark:text-slate-500 tabular-nums">
                            gross <span className="line-through">{formatCurrency(r.amount_etb ?? 0)}</span> · WHT −{formatCurrency(r.wht_amount ?? 0)}
                          </div>
                        )}
                        {canAct && (
                          <button onClick={() => setSplitting(r)} className="block ml-auto text-[10px] font-medium text-brand hover:underline">
                            pay part
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {r.verify_wht && <span className="inline-block rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">WHT</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                        {r.days_since_approval != null ? `${Math.floor(r.days_since_approval)}d` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {canAct && isAdvance && (
                          <button
                            onClick={() => setAdvancingRow(r)}
                            className="flex items-center gap-1 rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700"
                          >
                            <HandCoins className="h-3 w-3" /> Record Advance
                          </button>
                        )}
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile: stacked cards — vendor + amount as the header, everything
                else as a compact secondary line. The checkbox is its own
                44px tappable area, never a hover-revealed affordance. */}
            <div className="sm:hidden divide-y dark:divide-slate-700">
              {canAct && (
                <label className="flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/60">
                  <span className="flex h-11 w-11 -my-3 flex-shrink-0 items-center justify-center">
                    <input type="checkbox" checked={bulkSelectableQueue.length > 0 && selectedQueue.size === bulkSelectableQueue.length} onChange={toggleQueueAll} className="h-5 w-5 rounded border-slate-300 text-brand focus:ring-brand" />
                  </span>
                  Select all
                </label>
              )}
              {toPayQueue.map(r => {
                const isAdvance = r.payment_pattern === 'pay_in_advance'
                return (
                <div key={r.id} className="flex items-start gap-1 px-2 py-2">
                  {canAct && (
                    <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center">
                      {!isAdvance && (
                        <input type="checkbox" checked={selectedQueue.has(r.id)} onChange={() => toggleQueueRow(r.id)} className="h-5 w-5 rounded border-slate-300 text-brand focus:ring-brand" />
                      )}
                    </span>
                  )}
                  <Link to={`/expenses/${r.id}`} className="min-w-0 flex-1 py-2 pr-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-slate-800 dark:text-slate-100 truncate">{r.vendor_name ?? r.item_service_description ?? r.expense_code}</span>
                      <span className="flex-shrink-0 text-right">
                        <span className="block font-semibold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(r.net_payable ?? r.amount_etb ?? 0)}</span>
                        {(r.wht_amount ?? 0) > 0 && (
                          <span className="block text-[10px] text-slate-400 dark:text-slate-500 tabular-nums">net · gross {formatCurrency(r.amount_etb ?? 0)}</span>
                        )}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="truncate">{r.project_name ?? '—'}{r.cost_group_name ? ` · ${r.cost_group_name}` : ''}</span>
                      {r.verify_wht && <span className="flex-shrink-0 rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">WHT</span>}
                      <span className="ml-auto flex-shrink-0 tabular-nums">{r.days_since_approval != null ? `${Math.floor(r.days_since_approval)}d` : '—'}</span>
                    </div>
                    {isAdvance && (
                      <div className="mt-1.5 flex items-center gap-2">
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">Advance</span>
                        {canAct && (
                          <button
                            onClick={e => { e.preventDefault(); setAdvancingRow(r) }}
                            className="flex items-center gap-1 rounded-md bg-amber-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-amber-700"
                          >
                            <HandCoins className="h-2.5 w-2.5" /> Record Advance
                          </button>
                        )}
                      </div>
                    )}
                  </Link>
                </div>
                )
              })}
            </div>
          </>
        )}
      </Section>

      {/* Open Vendor Advances now render as the hero band near the top. */}

      {/* ── 1c. Withholding receipts to prepare ────────────────────── */}
      {whtToPrepare.length > 0 && (
        <Section title="Withholding Receipts to Prepare" sub="Paid payments that levied WHT — finance and the tax officer should issue the withholding receipt">
          <div className="divide-y dark:divide-slate-700">
            {whtToPrepare.map(w => (
              <div key={w.expense_id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <Link to={`/expenses/${w.expense_id}`} className="font-medium text-slate-800 dark:text-slate-100 hover:text-brand hover:underline">
                    {w.vendor_name ?? w.expense_code ?? 'Payment'}
                  </Link>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {w.vendor_tin ? `TIN ${w.vendor_tin} · ` : 'No TIN · '}
                    WHT {formatCurrency(w.wht_amount ?? 0)} of {formatCurrency(w.amount_etb ?? 0)} · net {formatCurrency(w.net_payable ?? 0)}
                    {w.paid_date ? ` · paid ${formatDate(w.paid_date)}` : ''}
                  </p>
                </div>
                {canAct && (
                  <button
                    onClick={() => markWhtPrepared(w.expense_id)}
                    className="flex items-center gap-1 rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white hover:bg-brand/90 shrink-0"
                  >
                    <Receipt className="h-3 w-3" /> Mark Prepared
                  </button>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── 1d. VRF tunnel — sent as VRF, awaiting the badge holder ──── */}
      {(() => {
        const vrfAwaiting = recentPayments.filter(r => r.payment_state === 'sent' && r.payment_method === 'vrf')
        if (vrfAwaiting.length === 0) return null
        return (
          <Section title="VRF Tunnel — Awaiting Badge Holder" sub="Sent via VRF — the VRF badge holder pays these from a settled VRF fund and attaches a certificate">
            <div className="divide-y dark:divide-slate-700">
              {vrfAwaiting.map(r => (
                <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <Link to={`/expenses/${r.id}`} className="font-medium text-slate-800 dark:text-slate-100 hover:text-brand hover:underline">
                      {r.vendor_name ?? r.item_service_description ?? r.expense_code}
                    </Link>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{formatCurrency(r.amount_etb ?? 0)}</p>
                  </div>
                  {isVrfManager ? (
                    <button onClick={() => setLinkingVrf(r)} className="shrink-0 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700">
                      Pay via VRF
                    </button>
                  ) : (
                    <span className="shrink-0 text-[11px] text-amber-600 dark:text-amber-400">awaiting VRF Manager</span>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )
      })()}

      {/* ── 2. Pending Approval ─────────────────────────────────────── */}
      <Section title="Pending Approval" sub="Awaiting a finance sign-off before it can join the to-pay queue">
        {loadingPending ? (
          <Empty>Loading…</Empty>
        ) : pendingApproval.length === 0 ? (
          <Empty>Nothing waiting on finance.</Empty>
        ) : (
          <>
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/60 text-left text-xs text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-2">Vendor</th>
                    <th className="px-4 py-2">Project</th>
                    <th className="px-4 py-2 text-right">Amount</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2 w-32"></th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-slate-700">
                  {pendingApproval.map(r => (
                    <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-4 py-2.5">
                        <Link to={`/expenses/${r.id}`} className="font-medium text-slate-800 dark:text-slate-100 hover:text-brand hover:underline">
                          {r.vendor_name ?? r.item_service_description ?? r.expense_code}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{r.project_name ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(r.amount_etb ?? 0)}</td>
                      <td className="px-4 py-2.5"><StatusBadge status={r.approval_status} /></td>
                      <td className="px-4 py-2.5 text-right">
                        {r.approval_status === 'manager_approved' && canAct ? (
                          <button
                            onClick={() => handleApprove(r.id)}
                            className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 ml-auto"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                          </button>
                        ) : r.approval_status === 'pending' ? (
                          <span className="text-xs text-slate-400 dark:text-slate-500">Awaiting manager</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="sm:hidden divide-y dark:divide-slate-700">
              {pendingApproval.map(r => (
                <div key={r.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <Link to={`/expenses/${r.id}`} className="min-w-0 font-medium text-slate-800 dark:text-slate-100 truncate">
                      {r.vendor_name ?? r.item_service_description ?? r.expense_code}
                    </Link>
                    <span className="flex-shrink-0 font-semibold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(r.amount_etb ?? 0)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 min-w-0">
                      <span className="truncate">{r.project_name ?? '—'}</span>
                      <StatusBadge status={r.approval_status} />
                    </div>
                    {r.approval_status === 'manager_approved' && canAct ? (
                      <button
                        onClick={() => handleApprove(r.id)}
                        className="flex-shrink-0 flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-xs font-medium text-white hover:opacity-90"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                      </button>
                    ) : r.approval_status === 'pending' ? (
                      <span className="flex-shrink-0 text-xs text-slate-400 dark:text-slate-500">Awaiting manager</span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Section>

      {/* ── Awaiting bank confirmation — all ages, not just this week ── */}
      {awaitingConfirmation.length > 0 && (
        <Section
          title="Awaiting Bank Confirmation"
          sub={`${awaitingConfirmation.length} sent bank payment${awaitingConfirmation.length !== 1 ? 's' : ''} with no matched statement line — any age, oldest first. Match them as statements are imported.`}
        >
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-left text-xs text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2">Vendor</th>
                  <th className="px-4 py-2">Method · Account</th>
                  <th className="px-4 py-2 text-right">To vendor (net)</th>
                  <th className="px-4 py-2 text-right">Waiting</th>
                  <th className="px-4 py-2 w-40"></th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-700">
                {awaitingConfirmation.map(r => {
                  const stale = (r.days_waiting ?? 0) >= 14
                  return (
                    <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-4 py-2.5">
                        <Link to={`/expenses/${r.id}`} className="font-medium text-slate-800 dark:text-slate-100 hover:text-brand hover:underline">
                          {r.vendor_name ?? r.item_service_description ?? r.expense_code}
                        </Link>
                        {r.batch_payment_id && <span className="ml-1.5 text-[10px] text-slate-400">in a batch</span>}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">
                        {r.payment_method ? (PAYMENT_METHOD_LABEL[r.payment_method] ?? r.payment_method) : '—'}
                        {r.account_name ? ` · ${r.account_name}` : ''}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(r.net_payable ?? r.amount_etb ?? 0)}</td>
                      <td className={`px-4 py-2.5 text-right text-xs tabular-nums ${stale ? 'font-semibold text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`}>
                        {r.days_waiting != null ? `${Math.floor(r.days_waiting)}d` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {canAct && (
                          <button onClick={() => setMatching(r)} className="flex items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-700 ml-auto">
                            <Landmark className="h-3 w-3" /> Match to bank line
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="sm:hidden divide-y dark:divide-slate-700">
            {awaitingConfirmation.map(r => {
              const stale = (r.days_waiting ?? 0) >= 14
              return (
                <div key={r.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <Link to={`/expenses/${r.id}`} className="min-w-0 font-medium text-slate-800 dark:text-slate-100 truncate">
                      {r.vendor_name ?? r.item_service_description ?? r.expense_code}
                    </Link>
                    <span className="flex-shrink-0 font-semibold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(r.net_payable ?? r.amount_etb ?? 0)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {r.payment_method ? (PAYMENT_METHOD_LABEL[r.payment_method] ?? r.payment_method) : '—'}
                      {r.days_waiting != null && <span className={stale ? 'ml-2 font-semibold text-red-600 dark:text-red-400' : 'ml-2'}>· {Math.floor(r.days_waiting)}d</span>}
                    </span>
                    {canAct && (
                      <button onClick={() => setMatching(r)} className="flex-shrink-0 flex items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-sky-700">
                        <Landmark className="h-3 w-3" /> Match
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </Section>
      )}

      <div>
        {/* ── Recent Payments (cash position now lives in the top board) ── */}
        <Section title="This Week's Payments" sub="Sent this week. A bank payment is confirmed only when it matches an imported statement line — cash and VRF are the two exceptions.">
          {loadingRecent ? (
            <Empty>Loading…</Empty>
          ) : recentPayments.length === 0 ? (
            <Empty>Nothing sent or paid this week yet.</Empty>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b dark:border-slate-700 px-4 py-2">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Payment method</span>
                <select
                  className="rounded-md border px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  value={methodFilter}
                  onChange={e => setMethodFilter(e.target.value)}
                >
                  <option value="all">All methods</option>
                  {Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                  <option value="unset">Not set yet</option>
                </select>
              </div>
              <div className="divide-y dark:divide-slate-700">
                {filteredRecentPayments.map(r => (
                  <div key={r.id} className="flex items-center justify-between gap-2 px-4 py-3">
                    <div className="min-w-0">
                      <Link to={`/expenses/${r.id}`} className="font-medium text-slate-800 dark:text-slate-100 hover:text-brand hover:underline block truncate">
                        {r.vendor_name ?? r.item_service_description ?? r.expense_code}
                      </Link>
                      <p className="text-xs text-slate-400 dark:text-slate-500">
                        {formatDate(r.payment_state_changed_at)} · {r.payment_method ? (PAYMENT_METHOD_LABEL[r.payment_method] ?? r.payment_method) : '—'}
                        {r.transfer_id_code && ` · ${r.transfer_id_code}`}
                        {r.vrf_record_name && ` · ${r.vrf_record_name}`}
                        {r.batch_payment_id && !r.transfer_id_code && ' · in a batch'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-right">
                        <span className="block font-semibold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(r.net_payable ?? r.amount_etb ?? 0)}</span>
                        <span className="block text-[10px] text-slate-400 dark:text-slate-500 tabular-nums">
                          {(r.wht_amount ?? 0) > 0 ? `to vendor · gross ${formatCurrency(r.amount_etb ?? 0)}` : 'to vendor'}
                        </span>
                      </span>
                      <StatusBadge status={r.payment_state} />
                      {/* Bank statement match is the confirmation for bank
                          methods — the primary action, filled and prominent. */}
                      {canAct && r.payment_state === 'sent' && r.payment_method === 'transfer' && !r.transfer_id && (
                        <button
                          onClick={() => setMatching(r)}
                          className="flex items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-700"
                        >
                          <Landmark className="h-3 w-3" /> Match to bank line
                        </button>
                      )}
                      {/* A sent VRF payment is paid by the VRF Manager, who draws it from
                          a settled VRF fund and attaches a payment certificate. */}
                      {r.payment_state === 'sent' && r.payment_method === 'vrf' && (
                        isVrfManager ? (
                          <button
                            onClick={() => setLinkingVrf(r)}
                            className="rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700"
                          >
                            Pay via VRF
                          </button>
                        ) : (
                          <span className="text-[10px] text-amber-600 dark:text-amber-400" title="Waiting for the VRF Manager to confirm">awaiting VRF Manager</span>
                        )
                      )}
                      {canAct && r.payment_state === 'sent' && r.payment_method === 'cash' && (
                        <button
                          onClick={() => handleConfirmCash(r.id)}
                          disabled={confirmingCash === r.id}
                          className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
                        >
                          <Receipt className="h-3 w-3" /> {confirmingCash === r.id ? 'Confirming…' : 'Confirm Cash Payment'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Section>
      </div>

      {splitting && (
        <PartialSplitModal
          row={splitting}
          defaultPayerId={payerId}
          payerOptions={payerOptions}
          onClose={() => setSplitting(null)}
          onDone={() => {
            setSplitting(null)
            qc.invalidateQueries({ queryKey: ['v-to-pay-queue'] })
            qc.invalidateQueries({ queryKey: ['expenses'] })
            toast('Partial payment split — paid portion retired, remainder re-queued', 'success')
          }}
        />
      )}

      {batchModalOpen && payerId && (
        <CreateBatchModal
          expenseIds={Array.from(selectedQueue)}
          payerId={payerId}
          onClose={() => setBatchModalOpen(false)}
          onCreated={() => {
            setBatchModalOpen(false)
            setSelectedQueue(new Set())
            toast('Batch payment created', 'success')
            invalidateAll()
          }}
          onError={msg => toast(msg, 'error')}
        />
      )}

      {creditingAdvance && (
        <RecordVendorCreditModal
          advance={creditingAdvance}
          onClose={() => setCreditingAdvance(null)}
          onRecorded={() => {
            setCreditingAdvance(null)
            toast('Vendor credit recorded', 'success')
            invalidateAll()
            qc.invalidateQueries({ queryKey: ['v-vendor-credits'] })
          }}
          onError={msg => toast(msg, 'error')}
        />
      )}

      {matching && (
        <MatchTransferModal
          row={matching}
          onClose={() => setMatching(null)}
          onMatched={() => {
            setMatching(null)
            toast('Matched to bank line', 'success')
            invalidateAll()
          }}
          onError={msg => toast(msg, 'error')}
        />
      )}

      {linkingVrf && (
        <VrfPayModal
          row={linkingVrf}
          onClose={() => setLinkingVrf(null)}
          onLinked={() => {
            setLinkingVrf(null)
            toast('Paid via VRF — fund drawn down', 'success')
            invalidateAll()
          }}
          onError={msg => toast(msg, 'error')}
        />
      )}

      {advancingRow && (
        <RecordAdvanceModal
          row={advancingRow}
          defaultPayerId={payerId}
          defaultMethod={paymentMethod}
          payerOptions={payerOptions}
          accountOptions={accountOptions}
          onClose={() => setAdvancingRow(null)}
          onDone={() => {
            setAdvancingRow(null)
            toast('Advance payment recorded', 'success')
            invalidateAll()
          }}
          onError={msg => toast(msg, 'error')}
        />
      )}
    </div>
  )
}

// #5: record a vendor advance (pay-in-advance PO). The old flow was a blind
// one-click that reused the queue's shared payer/method and silently dropped
// the expense's own account. This opens a small form pre-populated from the
// approved expense — payer, paying account, method, and the amount — so Finance
// confirms real figures instead of retyping or losing the account.
function RecordAdvanceModal({
  row, defaultPayerId, defaultMethod, payerOptions, accountOptions, onClose, onDone, onError,
}: {
  row: ToPayQueueRow
  defaultPayerId: string | null
  defaultMethod: ExpensePaymentMethod
  payerOptions: { id: string; label: string }[]
  accountOptions: { id: string; label: string; sub?: string }[]
  onClose: () => void
  onDone: () => void
  onError: (msg: string) => void
}) {
  const [payerId, setPayerId] = useState<string | null>(defaultPayerId)
  const [accountId, setAccountId] = useState<string | null>(null)
  const [method, setMethod] = useState<ExpensePaymentMethod>(defaultMethod)
  const [saving, setSaving] = useState(false)

  // The approved expense already carries the paying account, method, and amount
  // — pull them so the form opens filled in rather than blank.
  const { data: exp } = useQuery({
    queryKey: ['advance-expense-prefill', row.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('account_id, payment_method, amount_etb')
        .eq('id', row.id)
        .single()
      if (error) throw error
      return data as { account_id: string | null; payment_method: ExpensePaymentMethod | null; amount_etb: number | null }
    },
  })

  useEffect(() => {
    if (!exp) return
    setAccountId(prev => prev ?? exp.account_id)
    if (exp.payment_method) setMethod(prev => (prev === defaultMethod ? exp.payment_method! : prev))
    // defaultMethod intentionally excluded — only seed from the expense once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exp])

  const amount = exp?.amount_etb ?? row.amount_etb ?? 0

  async function confirm() {
    if (!payerId) { onError('Select who is sending this advance'); return }
    if (!accountId) { onError('Select the account the advance is paid from'); return }
    setSaving(true)
    const { error } = await supabase
      .from('expenses')
      .update({ payment_state: 'advance', disbursed_by: payerId, payment_method: method, account_id: accountId })
      .eq('id', row.id)
    setSaving(false)
    if (error) { onError(error.message); return }
    onDone()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-800 p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="mb-1 flex items-center gap-2">
          <HandCoins className="h-4 w-4 text-amber-600" />
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">Record Advance Payment</h3>
        </div>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          {row.vendor_name ?? row.item_service_description ?? row.expense_code} · money sent before goods arrive.
          It moves to Open Vendor Advances until a GRN closes it.
        </p>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Who is sending it</label>
            <SearchableSelect value={payerId} onChange={setPayerId} options={payerOptions} placeholder="Select payer…" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Paid from account</label>
            <SearchableSelect value={accountId} onChange={setAccountId} options={accountOptions} placeholder="Select account…" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Method</label>
            <select
              value={method}
              onChange={e => setMethod(e.target.value as ExpensePaymentMethod)}
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            >
              {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div className="rounded-lg border dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 px-3 py-2">
            <p className="text-xs text-slate-500 dark:text-slate-400">Advance amount (full approved)</p>
            <p className="text-lg font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(amount)}</p>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-3 py-2 text-sm text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
          <button
            onClick={confirm}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            <HandCoins className="h-3.5 w-3.5" /> {saving ? 'Recording…' : 'Record Advance'}
          </button>
        </div>
      </div>
    </div>
  )
}

// #5: pay part of an expense. The paid portion is retired (the original
// becomes a paid expense at that amount) and the unpaid remainder becomes
// a new expense back in the queue — all in one RPC so the two rows always
// sum to the original.
function PartialSplitModal({
  row, defaultPayerId, payerOptions, onClose, onDone,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}: { row: any; defaultPayerId: string | null; payerOptions: { id: string; label: string }[]; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast()
  const full = Number(row.amount_etb ?? 0)
  const [paid, setPaid] = useState('')
  const [payerId, setPayerId] = useState<string | null>(defaultPayerId)
  const [saving, setSaving] = useState(false)
  const paidNum = parseFloat(paid)
  const valid = !isNaN(paidNum) && paidNum > 0 && paidNum < full
  const remainder = valid ? full - paidNum : null

  async function submit() {
    if (!valid) { toast('Enter a paid amount between 0 and the full amount', 'error'); return }
    if (!payerId) { toast('Select who is paying this portion', 'error'); return }
    setSaving(true)
    // The paid portion settles now, so it needs a payer (disbursed_by) — must be
    // an admin/finance user other than the one who finance-approved the expense.
    const { error } = await supabase.rpc('split_expense_partial_payment', { p_expense_id: row.id, p_paid_amount: paidNum, p_disbursed_by: payerId })
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    onDone()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl bg-white dark:bg-slate-800 p-5 shadow-xl space-y-3" onClick={e => e.stopPropagation()}>
        <h2 className="font-bold text-slate-800 dark:text-slate-100">Pay Part of This Expense</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {row.vendor_name ?? row.item_service_description ?? row.expense_code} · full {formatCurrency(full)}
        </p>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Amount paid now (ETB)</label>
          <input type="number" min="0" step="0.01" autoFocus value={paid} onChange={e => setPaid(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Who is paying this portion</label>
          <SearchableSelect value={payerId} onChange={setPayerId} options={payerOptions} placeholder="Select payer…" />
          <p className="mt-1 text-[11px] text-slate-400">Must be an admin/finance user, and not the person who approved this expense.</p>
        </div>
        {remainder != null && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Paid <span className="font-semibold text-emerald-600 dark:text-emerald-400">{formatCurrency(paidNum)}</span> is retired ·
            remainder <span className="font-semibold text-amber-600 dark:text-amber-400">{formatCurrency(remainder)}</span> becomes a new expense back in the queue.
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-md border px-3 py-1.5 text-sm text-slate-600 dark:border-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={submit} disabled={!valid || saving} className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50">
            {saving ? 'Splitting…' : 'Split & Retire Paid Part'}
          </button>
        </div>
      </div>
    </div>
  )
}

function CreateBatchModal({
  expenseIds, payerId, onClose, onCreated, onError,
}: {
  expenseIds: string[]
  payerId: string
  onClose: () => void
  onCreated: () => void
  onError: (msg: string) => void
}) {
  const [code, setCode] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleCreate() {
    setSaving(true)
    const { error } = await supabase.rpc('create_batch_payment', {
      p_expense_ids: expenseIds,
      p_assignee_id: payerId,
      p_payment_code: code.trim() || null,
      p_notes: notes.trim() || null,
    })
    setSaving(false)
    if (error) { onError(error.message); return }
    onCreated()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl max-w-md w-full overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b dark:border-slate-700 flex items-center justify-between">
          <h2 className="font-bold text-slate-800 dark:text-slate-100">Create Batch Payment</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">{expenseIds.length} expense(s) will be linked to one wire and moved to Sent.</p>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Payment Code (optional)</label>
            <input className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" value={code} onChange={e => setCode(e.target.value)} placeholder="e.g. BATCH-2026-014" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Notes (optional)</label>
            <textarea rows={2} className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>
        <div className="px-5 py-4 border-t dark:border-slate-700 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={handleCreate} disabled={saving} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
            {saving ? 'Creating…' : 'Create Batch'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Records a vendor discount/credit agreed after a PO was already ordered.
// Only reachable while the advance is still open (payment_state=advance),
// which is exactly when no ledger posting is needed: the money is already
// sitting in Vendor Advances, so the credit is just subtracted from what
// the advance will close for — the difference stays behind in that same
// account as an unclaimed balance, applicable to a future order via the
// Vendor Credits page.
function RecordVendorCreditModal({
  advance, onClose, onRecorded, onError,
}: {
  advance: OpenVendorAdvanceRow
  onClose: () => void
  onRecorded: () => void
  onError: (msg: string) => void
}) {
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const current = advance.amount_etb ?? 0
  const parsedAmount = parseFloat(amount) || 0
  const remainingAdvance = current - parsedAmount
  const valid = parsedAmount > 0 && parsedAmount < current && reason.trim().length > 0

  async function handleSave() {
    if (!valid) return
    setSaving(true)
    const { error } = await supabase.rpc('create_vendor_credit', {
      p_source_expense_id: advance.id,
      p_amount_etb: parsedAmount,
      p_reason: reason.trim(),
      p_notes: notes.trim() || null,
    })
    setSaving(false)
    if (error) { onError(error.message); return }
    onRecorded()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl max-w-md w-full overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b dark:border-slate-700 flex items-center justify-between">
          <h2 className="font-bold text-slate-800 dark:text-slate-100">Record Vendor Credit</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {advance.vendor_name ?? advance.expense_code} · {advance.bundle_code ?? '—'} · currently <b className="text-slate-700 dark:text-slate-200">{formatCurrency(current)}</b> open
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Credit Amount (ETB) *</label>
            <input
              type="number" step="0.01" autoFocus
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              value={amount} onChange={e => setAmount(e.target.value)}
            />
            {parsedAmount > 0 && (
              <p className={`mt-1 text-xs ${remainingAdvance > 0 ? 'text-slate-500 dark:text-slate-400' : 'text-red-500'}`}>
                {remainingAdvance > 0
                  ? `Advance will close at ${formatCurrency(remainingAdvance)} once goods are received; ${formatCurrency(parsedAmount)} stays as an open credit with this vendor.`
                  : 'Must be less than the current advance amount.'}
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Reason *</label>
            <input
              type="text" placeholder="e.g. Vendor discount on wire pricing, agreed after ordering"
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              value={reason} onChange={e => setReason(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Notes</label>
            <textarea
              rows={2}
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              value={notes} onChange={e => setNotes(e.target.value)}
            />
          </div>
        </div>
        <div className="px-5 py-4 border-t dark:border-slate-700 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={handleSave} disabled={saving || !valid} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
            {saving ? 'Recording…' : 'Record Credit'}
          </button>
        </div>
      </div>
    </div>
  )
}

function MatchTransferModal({
  row, onClose, onMatched, onError,
}: {
  row: MatchableRow
  onClose: () => void
  onMatched: () => void
  onError: (msg: string) => void
}) {
  const [transferId, setTransferId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleMatch() {
    if (!transferId) { onError('Enter a bank reference or pick a bank line'); return }
    setSaving(true)
    const { error } = row.batch_payment_id
      ? await supabase.rpc('match_batch_to_transfer', { p_batch_payment_id: row.batch_payment_id, p_transfer_id: transferId })
      : await supabase.rpc('match_expense_to_transfer', { p_expense_id: row.id, p_transfer_id: transferId })
    setSaving(false)
    if (error) { onError(error.message); return }
    onMatched()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl max-w-md w-full overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b dark:border-slate-700 flex items-center justify-between">
          <h2 className="font-bold text-slate-800 dark:text-slate-100">Match to Bank Line</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {row.batch_payment_id
              ? 'This expense is part of a batch — matching applies to every expense in that batch.'
              : `Matching ${formatCurrency(row.amount_etb ?? 0)} to a CBE statement line.`}
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Bank Reference</label>
            <BankReferenceInput value={transferId} onChange={setTransferId} />
          </div>
        </div>
        <div className="px-5 py-4 border-t dark:border-slate-700 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={handleMatch} disabled={saving || !transferId} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
            {saving ? 'Matching…' : 'Match'}
          </button>
        </div>
      </div>
    </div>
  )
}

// The VRF Manager pays an approved VRF-method expense from a settled VRF's
// returned fund. Only settled VRFs with enough available balance are offered,
// and a payment confirmation certificate is required before it can be paid.
function VrfPayModal({
  row, onClose, onLinked, onError,
}: {
  row: RecentPaymentRow
  onClose: () => void
  onLinked: () => void
  onError: (msg: string) => void
}) {
  const amount = Number(row.amount_etb ?? 0)
  const [vrfId, setVrfId] = useState<string | null>(null)
  const [certUrl, setCertUrl] = useState<string | null>(null)
  const [certName, setCertName] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const { data: funds = [] } = useQuery({
    queryKey: ['vrf-funds-settled'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_vrf_fund_status')
        .select('vrf_id, record_name, facilitator_name, fund_available')
        .eq('status', 'settled')
        .order('fund_available', { ascending: false })
      if (error) throw error
      return data as { vrf_id: string; record_name: string | null; facilitator_name: string | null; fund_available: number }[]
    },
  })

  const options = funds.map(f => ({
    id: f.vrf_id,
    label: `${f.record_name ?? f.facilitator_name ?? f.vrf_id.slice(0, 8)} — ${formatCurrency(Number(f.fund_available))} available`,
    disabled: Number(f.fund_available) < amount,
  }))
  const selected = funds.find(f => f.vrf_id === vrfId)
  const insufficient = selected != null && Number(selected.fund_available) < amount

  async function handlePay() {
    if (!vrfId) { onError('Select the settled VRF to pay from'); return }
    if (insufficient) { onError('That VRF fund does not have enough available'); return }
    if (!certUrl) { onError('Attach a payment confirmation certificate'); return }
    setSaving(true)
    const { error } = await supabase.rpc('confirm_vrf_payment', {
      p_expense_id: row.id, p_vrf_id: vrfId, p_certificate_url: certUrl, p_certificate_name: certName,
    })
    setSaving(false)
    if (error) { onError(error.message); return }
    onLinked()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl max-w-md w-full overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b dark:border-slate-700 flex items-center justify-between">
          <h2 className="font-bold text-slate-800 dark:text-slate-100">Pay via VRF</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Paying <span className="font-semibold text-slate-700 dark:text-slate-200">{formatCurrency(amount)}</span> from a settled VRF's returned fund. This marks it paid and draws the fund down.
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Settled VRF (fund)</label>
            <SearchableSelect value={vrfId} onChange={setVrfId} options={options} placeholder="Select a settled VRF…" />
            {insufficient && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">Not enough available in this fund.</p>}
            {funds.length === 0 && <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">No settled VRF funds available.</p>}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Payment Confirmation Certificate *</label>
            <FileUpload
              bucket="documents" folder="vrf-certificates" privateBucket
              fileUrl={certUrl} fileName={certName}
              onUpload={(url, name) => { setCertUrl(url); setCertName(name) }}
              onClear={() => { setCertUrl(null); setCertName(null) }}
              label="Upload certificate"
            />
          </div>
        </div>
        <div className="px-5 py-4 border-t dark:border-slate-700 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={handlePay} disabled={saving || !vrfId || !certUrl || insufficient} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
            {saving ? 'Paying…' : 'Mark Paid via VRF'}
          </button>
        </div>
      </div>
    </div>
  )
}
