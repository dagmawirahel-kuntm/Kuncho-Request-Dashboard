import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useChartOfAccounts, useFiscalPeriods } from '@/hooks/useLookups'
import { formatCurrency, formatDate } from '@/lib/utils'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type {
  ChartOfAccounts, JournalEntry, JournalLine, OpeningBalance,
  LedgerPostingFailure, TrialBalanceRow, PlLedgerPreviewRow, BalanceSheetLedgerPreviewRow,
  CashReconciliationCheckRow, SubLedgerBalanceRow,
} from '@/types/database'
import {
  BookOpen, ScrollText, FileSpreadsheet, Scale, AlertTriangle, PieChart, Lock, ChevronDown, ChevronRight, Layers,
} from 'lucide-react'

const TABS = [
  { key: 'trial-balance', label: 'Trial Balance', icon: Scale },
  { key: 'sub-ledgers', label: 'Sub Ledgers', icon: Layers },
  { key: 'journal', label: 'Journal Entries', icon: ScrollText },
  { key: 'opening-balances', label: 'Opening Balances', icon: FileSpreadsheet },
  { key: 'reconciliation', label: 'Reconciliation', icon: BookOpen },
  { key: 'failures', label: 'Posting Failures', icon: AlertTriangle, adminFinanceOnly: true },
  { key: 'preview', label: 'P&L / Balance Sheet', icon: PieChart },
  { key: 'close', label: 'Year-End Close', icon: Lock, adminFinanceOnly: true },
] as const
type TabKey = typeof TABS[number]['key']

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

export default function GeneralLedgerPage() {
  const { role } = useAuth()
  const canManage = role === 'admin' || role === 'finance'
  const [searchParams] = useSearchParams()
  const initialTab = searchParams.get('tab')
  const [tab, setTab] = useState<TabKey>(TABS.some(t => t.key === initialTab) ? (initialTab as TabKey) : 'trial-balance')
  const visibleTabs = TABS.filter(t => !('adminFinanceOnly' in t && t.adminFinanceOnly) || canManage)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Ledger &amp; Journal</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Double-entry ledger, current fiscal year forward.{' '}
          <span className="text-amber-600 dark:text-amber-400">Preview alongside the existing P&amp;L / Balance Sheet reports — not yet the source of truth.</span>
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b dark:border-slate-700 pb-px">
        {visibleTabs.map(t => {
          const Icon = t.icon
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded-t-md px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                active
                  ? 'border-brand text-brand'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'trial-balance' && <TrialBalanceTab />}
      {tab === 'sub-ledgers' && <SubLedgersTab />}
      {tab === 'journal' && <JournalEntriesTab />}
      {tab === 'opening-balances' && <OpeningBalancesTab canManage={canManage} />}
      {tab === 'reconciliation' && <ReconciliationTab />}
      {tab === 'failures' && canManage && <PostingFailuresTab />}
      {tab === 'preview' && <PlBalanceSheetPreviewTab />}
      {tab === 'close' && canManage && <YearEndCloseTab />}
    </div>
  )
}

// ── Trial Balance ──────────────────────────────────────────────────
function TrialBalanceTab() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['v-trial-balance'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_trial_balance').select('*')
      if (error) throw error
      return data as TrialBalanceRow[]
    },
  })

  const withActivity = data.filter(r => r.fiscal_period_id !== null)
  const byPeriod = useMemo(() => {
    const map = new Map<string, TrialBalanceRow[]>()
    for (const r of withActivity) {
      const key = r.fiscal_period_label ?? 'Unknown'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(r)
    }
    return map
  }, [withActivity])

  return (
    <Section title="Trial Balance" sub="Per account, per fiscal period — the fundamental check that the ledger is internally consistent">
      {isLoading ? (
        <Empty>Loading…</Empty>
      ) : byPeriod.size === 0 ? (
        <Empty>No journal activity posted yet — nothing to check.</Empty>
      ) : (
        [...byPeriod.entries()].map(([period, rows]) => {
          const sumDebit = rows.reduce((s, r) => s + r.total_debit, 0)
          const sumCredit = rows.reduce((s, r) => s + r.total_credit, 0)
          const balanced = Math.abs(sumDebit - sumCredit) < 0.01
          return (
            <div key={period} className="border-b last:border-b-0 dark:border-slate-700">
              <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 dark:bg-slate-900/60">
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{period}</span>
                <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${balanced ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'}`}>
                  {balanced ? 'Balanced' : `Off by ${formatCurrency(sumDebit - sumCredit)}`}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-2">Account</th>
                      <th className="px-4 py-2">Nature</th>
                      <th className="px-4 py-2 text-right">Debit</th>
                      <th className="px-4 py-2 text-right">Credit</th>
                      <th className="px-4 py-2 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-slate-700">
                    {rows.map(r => (
                      <tr key={r.chart_of_accounts_id}>
                        <td className="px-4 py-2 text-slate-700 dark:text-slate-200">{r.account_code} — {r.account_name}</td>
                        <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{r.nature}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(r.total_debit)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(r.total_credit)}</td>
                        <td className="px-4 py-2 text-right tabular-nums font-medium">{formatCurrency(r.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t dark:border-slate-700 font-semibold">
                    <tr>
                      <td className="px-4 py-2" colSpan={2}>Total</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(sumDebit)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(sumCredit)}</td>
                      <td className="px-4 py-2"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )
        })
      )}
    </Section>
  )
}

// ── Sub Ledgers ──────────────────────────────────────────────────────
// The subsidiary ledger behind the "Multiple" GL control account.
// Purchase-order expenses still post as ONE line in the main ledger — the
// real category when a PO is genuinely single-category (correcting any
// PR-time misclassification), or the "Multiple" control account when it
// genuinely spans several. This tab is the detail behind that control
// account: the true per-category breakdown from the GRN, and a distinction
// between money that's expectedly consolidated in "Multiple" (normal) vs.
// money posted to neither its own category nor Multiple (a real anomaly).
// Read-only; reconciles to the posted ledger.
function SubLedgersTab() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['v-sub-ledger-balances'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_sub_ledger_balances').select('*')
      if (error) throw error
      return data as SubLedgerBalanceRow[]
    },
  })

  // Group by real (GRN-tagged) category, summing across fiscal periods
  // (the ledger is current-fiscal-year forward, effectively one period).
  const groups = useMemo(() => {
    const byReal = new Map<string, { name: string; total: number; inMultiple: number; misclassified: number }>()
    for (const r of data) {
      const key = r.real_category_id ?? 'unclassified'
      const g = byReal.get(key) ?? { name: r.real_category, total: 0, inMultiple: 0, misclassified: 0 }
      g.total += r.amount
      g.inMultiple += r.in_multiple_control
      g.misclassified += r.misclassified_amount
      byReal.set(key, g)
    }
    return [...byReal.entries()]
      .map(([key, g]) => ({ key, ...g }))
      .sort((a, b) => {
        if (a.key === 'unclassified') return 1
        if (b.key === 'unclassified') return -1
        return b.total - a.total
      })
  }, [data])

  const grandTotal = groups.reduce((s, g) => s + g.total, 0)
  const grandInMultiple = groups.reduce((s, g) => s + g.inMultiple, 0)
  const grandMisclassified = groups.reduce((s, g) => s + g.misclassified, 0)

  return (
    <Section
      title="Sub Ledgers"
      sub="The subsidiary ledger behind the “Multiple” GL control account — true per-category spend, sourced from what the receiver tagged each item as on the GRN. Read-only; reconciles to the posted ledger."
    >
      {isLoading ? (
        <Empty>Loading…</Empty>
      ) : groups.length === 0 ? (
        <Empty>No posted purchase-order expenses with GRN data to break down yet.</Empty>
      ) : (
        <>
          <div className="mx-4 mt-3 space-y-2">
            {grandInMultiple > 0.01 && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
                <span className="font-semibold">{formatCurrency(grandInMultiple)}</span> is consolidated under the “Multiple” control account in the main ledger — expected for any PO spanning more than one category. The breakdown below is its subsidiary detail.
              </div>
            )}
            {grandMisclassified > 0.01 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
                <span className="font-semibold">{formatCurrency(grandMisclassified)}</span> is posted to neither its own category nor “Multiple” — a genuine anomaly worth checking.
              </div>
            ) : (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-300">
                No genuine anomalies — every posted PO expense is either under its own real category or expectedly consolidated in “Multiple”.
              </div>
            )}
          </div>
          <div className="divide-y dark:divide-slate-700">
            {groups.map(g => (
              <div key={g.key} className="flex items-center justify-between gap-2 px-4 py-2.5">
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{g.name}</span>
                  {g.inMultiple > 0.01 && (
                    <span className="text-[11px] rounded-full bg-slate-100 text-slate-600 px-2 py-0.5 dark:bg-slate-700 dark:text-slate-300">
                      {formatCurrency(g.inMultiple)} in Multiple
                    </span>
                  )}
                  {g.misclassified > 0.01 && (
                    <span className="text-[11px] rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 dark:bg-amber-900/30 dark:text-amber-300">
                      {formatCurrency(g.misclassified)} anomaly
                    </span>
                  )}
                </div>
                <span className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200 flex-shrink-0">{formatCurrency(g.total)}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between px-4 py-3 border-t dark:border-slate-700 font-semibold text-sm">
            <span className="text-slate-700 dark:text-slate-200">Total posted PO spend</span>
            <span className="tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(grandTotal)}</span>
          </div>
        </>
      )}
    </Section>
  )
}

// ── Journal Entries ─────────────────────────────────────────────────
function JournalEntriesTab() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['journal-entries'],
    queryFn: async () => {
      const { data, error } = await supabase.from('journal_entries').select('*').order('entry_date', { ascending: false }).limit(200)
      if (error) throw error
      return data as JournalEntry[]
    },
  })
  const { data: allLines = [] } = useQuery({
    queryKey: ['journal-lines-with-accounts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('journal_lines')
        .select('*, chart_of_accounts(account_code, account_name)')
      if (error) throw error
      return data as (JournalLine & { chart_of_accounts: { account_code: string; account_name: string } | null })[]
    },
    enabled: expanded.size > 0,
  })

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  return (
    <Section title="Journal Entries" sub="Every posted entry, traceable back to its originating row via source_table/source_id">
      {isLoading ? (
        <Empty>Loading…</Empty>
      ) : entries.length === 0 ? (
        <Empty>Nothing posted yet — the auto-posting engine only fires on a NEW transition into paid, so expenses/sales/payroll already paid before this migration landed won't retroactively appear here.</Empty>
      ) : (
        <div className="divide-y dark:divide-slate-700">
          {entries.map(e => (
            <div key={e.id}>
              <button onClick={() => toggle(e.id)} className="w-full flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/40 text-left">
                <div className="flex items-center gap-2 min-w-0">
                  {expanded.has(e.id) ? <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{e.description ?? e.id}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500">{formatDate(e.entry_date)} · {e.entry_type}</p>
                  </div>
                </div>
                {e.source_table && (
                  <span className="text-xs text-slate-400 dark:text-slate-500 flex-shrink-0">{e.source_table}</span>
                )}
              </button>
              {expanded.has(e.id) && (
                <div className="px-4 pb-3 pl-10">
                  <table className="w-full text-xs">
                    <tbody className="divide-y dark:divide-slate-700">
                      {allLines.filter(l => l.journal_entry_id === e.id).map(l => (
                        <tr key={l.id}>
                          <td className="py-1.5 text-slate-600 dark:text-slate-300">
                            {l.chart_of_accounts ? `${l.chart_of_accounts.account_code} — ${l.chart_of_accounts.account_name}` : l.account_id}
                          </td>
                          <td className="py-1.5 text-right tabular-nums w-24">{l.debit > 0 ? formatCurrency(l.debit) : ''}</td>
                          <td className="py-1.5 text-right tabular-nums w-24">{l.credit > 0 ? formatCurrency(l.credit) : ''}</td>
                          <td className="py-1.5 pl-3 text-slate-400 dark:text-slate-500 truncate max-w-[200px]">{l.notes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

// ── Opening Balances ─────────────────────────────────────────────────
function OpeningBalancesTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { data: coa = [] } = useChartOfAccounts()
  const bsAccounts = (coa as ChartOfAccounts[]).filter(a => a.nature !== 'Revenue' && a.nature !== 'Expense')
  const coaOptions = bsAccounts.map(a => ({ id: a.id, label: `${a.account_code} — ${a.account_name}` }))

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['opening-balances'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('opening_balances')
        .select('*, chart_of_accounts(account_code, account_name)')
        .order('entered_at')
      if (error) throw error
      return data as (OpeningBalance & { chart_of_accounts: { account_code: string; account_name: string } | null })[]
    },
  })

  const [accountId, setAccountId] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [side, setSide] = useState<'debit' | 'credit'>('debit')
  const [source, setSource] = useState('')
  const [saving, setSaving] = useState(false)
  const [converting, setConverting] = useState(false)

  const totalDebit = rows.filter(r => r.side === 'debit').reduce((s, r) => s + r.amount, 0)
  const totalCredit = rows.filter(r => r.side === 'credit').reduce((s, r) => s + r.amount, 0)
  const balanced = rows.length > 0 && Math.abs(totalDebit - totalCredit) < 0.01

  async function handleAdd() {
    const amt = parseFloat(amount)
    if (!accountId || !amt || amt <= 0 || !source.trim()) {
      toast('Select an account, a positive amount, and a source citation', 'error')
      return
    }
    setSaving(true)
    const { error } = await supabase.from('opening_balances').insert({
      chart_of_accounts_id: accountId, amount: amt, side, source: source.trim(),
    })
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    setAccountId(null); setAmount(''); setSource('')
    qc.invalidateQueries({ queryKey: ['opening-balances'] })
    toast('Row added', 'success')
  }

  async function handleDelete(id: string) {
    const { error } = await supabase.from('opening_balances').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['opening-balances'] })
  }

  async function handleConvert() {
    if (!window.confirm('Convert these opening balances into a journal entry? This is a one-time action.')) return
    setConverting(true)
    const { error } = await supabase.rpc('convert_opening_balances_to_journal_entry')
    setConverting(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Opening balance journal entry created', 'success')
    qc.invalidateQueries({ queryKey: ['journal-entries'] })
    qc.invalidateQueries({ queryKey: ['v-trial-balance'] })
  }

  return (
    <Section title="Opening Balances" sub="ERCA-sourced figures — a human judgment call, mapped by hand, not inferred">
      {canManage && (
        <div className="flex flex-wrap items-end gap-3 border-b dark:border-slate-700 px-4 py-3">
          <div className="w-64">
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Account (Asset/Liability/Equity only)</label>
            <SearchableSelect value={accountId} onChange={setAccountId} options={coaOptions} placeholder="Select account…" />
          </div>
          <div className="w-32">
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Amount</label>
            <input type="number" step="0.01" className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" value={amount} onChange={e => setAmount(e.target.value)} />
          </div>
          <div className="w-28">
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Side</label>
            <select className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" value={side} onChange={e => setSide(e.target.value as 'debit' | 'credit')}>
              <option value="debit">Debit</option>
              <option value="credit">Credit</option>
            </select>
          </div>
          <div className="flex-1 min-w-[220px]">
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Source (e.g. "ERCA Annual Income Tax Return FY2025/26, filed …, ref …")</label>
            <input type="text" className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" value={source} onChange={e => setSource(e.target.value)} />
          </div>
          <button onClick={handleAdd} disabled={saving} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
            {saving ? 'Adding…' : 'Add Row'}
          </button>
        </div>
      )}

      {isLoading ? (
        <Empty>Loading…</Empty>
      ) : rows.length === 0 ? (
        <Empty>Nothing entered yet — structure ready, figures pending from the ERCA filing.</Empty>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/60">
                <tr>
                  <th className="px-4 py-2">Account</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                  <th className="px-4 py-2">Side</th>
                  <th className="px-4 py-2">Source</th>
                  {canManage && <th className="px-4 py-2 w-10"></th>}
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-700">
                {rows.map(r => (
                  <tr key={r.id}>
                    <td className="px-4 py-2 text-slate-700 dark:text-slate-200">{r.chart_of_accounts ? `${r.chart_of_accounts.account_code} — ${r.chart_of_accounts.account_name}` : r.chart_of_accounts_id}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(r.amount)}</td>
                    <td className="px-4 py-2 capitalize text-slate-500 dark:text-slate-400">{r.side}</td>
                    <td className="px-4 py-2 text-xs text-slate-400 dark:text-slate-500 max-w-[280px] truncate" title={r.source}>{r.source}</td>
                    {canManage && (
                      <td className="px-4 py-2">
                        <button onClick={() => handleDelete(r.id)} className="text-red-400 hover:text-red-600 text-xs">Remove</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-4 py-3 border-t dark:border-slate-700">
            <span className="text-sm text-slate-600 dark:text-slate-300">
              Debits {formatCurrency(totalDebit)} · Credits {formatCurrency(totalCredit)} —{' '}
              <span className={balanced ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-red-600 dark:text-red-400 font-medium'}>
                {balanced ? 'balanced' : `off by ${formatCurrency(totalDebit - totalCredit)}`}
              </span>
            </span>
            {canManage && (
              <button
                onClick={handleConvert}
                disabled={!balanced || converting}
                className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                title={!balanced ? 'Must balance before converting' : undefined}
              >
                {converting ? 'Converting…' : 'Convert to Journal Entry'}
              </button>
            )}
          </div>
        </>
      )}
    </Section>
  )
}

// ── Reconciliation ───────────────────────────────────────────────────
function ReconciliationTab() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['v-cash-reconciliation-check'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_cash_reconciliation_check').select('*')
      if (error) throw error
      return data as CashReconciliationCheckRow[]
    },
  })

  return (
    <Section title="Cash Reconciliation" sub="Bank-verified anchor + net movement since, walked forward to compare against the ERCA opening figure">
      {isLoading ? (
        <Empty>Loading…</Empty>
      ) : data.length === 0 ? (
        <Empty>No bank balance anchors on record yet.</Empty>
      ) : (
        <div className="divide-y dark:divide-slate-700">
          {data.map(r => (
            <div key={r.account_id} className="px-4 py-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-800 dark:text-slate-100">{r.account_name}</span>
                <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${
                  r.erca_opening_amount == null ? 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                    : Math.abs(parseFloat(r.gap_vs_erca_figure)) < 0.01 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                }`}>
                  {r.erca_opening_amount == null ? 'No ERCA figure yet' : `Gap: ${formatCurrency(parseFloat(r.gap_vs_erca_figure))}`}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-slate-500 dark:text-slate-400">
                <div>Anchor ({formatDate(r.anchor_date)}): <span className="font-medium text-slate-700 dark:text-slate-200">{formatCurrency(r.anchor_balance)}</span></div>
                <div>Movement since: <span className="font-medium text-slate-700 dark:text-slate-200">{formatCurrency(r.movement_since_anchor)}</span></div>
                <div>Implied today: <span className="font-medium text-slate-700 dark:text-slate-200">{formatCurrency(r.implied_balance_today)}</span></div>
                {r.erca_opening_amount != null && (
                  <div>ERCA figure: <span className="font-medium text-slate-700 dark:text-slate-200">{formatCurrency(r.erca_opening_amount)} ({r.erca_opening_side})</span></div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

// ── Posting Failures ──────────────────────────────────────────────────
function PostingFailuresTab() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [showResolved, setShowResolved] = useState(false)

  const { data = [], isLoading } = useQuery({
    queryKey: ['ledger-posting-failures'],
    queryFn: async () => {
      const { data, error } = await supabase.from('ledger_posting_failures').select('*').order('attempted_at', { ascending: false })
      if (error) throw error
      return data as LedgerPostingFailure[]
    },
  })

  const rows = showResolved ? data : data.filter(r => !r.resolved)

  async function handleResolve(id: string) {
    const { error } = await supabase.from('ledger_posting_failures').update({ resolved: true, resolved_at: new Date().toISOString() }).eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['ledger-posting-failures'] })
  }

  // Auto-posting fires only on a NEW transition into paid, so correcting
  // the general ledger or the payment account afterwards fixed the data
  // but left the journal entry permanently missing — dismissing the
  // failure would hide a payment that still isn't in the books. This
  // re-runs the posting against the row's current state instead.
  const [retrying, setRetrying] = useState<string | null>(null)
  async function handleRetry(f: LedgerPostingFailure) {
    setRetrying(f.id)
    const { data, error } = f.source_table === 'sales'
      ? await supabase.rpc('retry_sale_ledger_posting', { p_sale_id: f.source_id })
      : await supabase.rpc('retry_expense_ledger_posting', { p_expense_id: f.source_id })
    setRetrying(null)
    if (error) { toast(error.message, 'error'); return }
    const result = data as string
    toast(result, result === 'Posted' ? 'success' : 'error')
    qc.invalidateQueries({ queryKey: ['ledger-posting-failures'] })
    qc.invalidateQueries({ queryKey: ['journal-entries'] })
    qc.invalidateQueries({ queryKey: ['trial-balance'] })
  }

  return (
    <Section title="Posting Failures" sub="A caught, non-blocking posting attempt — the underlying transaction still succeeded, only the ledger entry didn't. Fix the record it names, then Retry Posting; Dismiss only clears the notice and leaves the entry unposted.">
      <div className="flex items-center justify-end px-4 py-2 border-b dark:border-slate-700">
        <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <input type="checkbox" checked={showResolved} onChange={e => setShowResolved(e.target.checked)} className="rounded border-slate-300 text-brand focus:ring-brand" />
          Show resolved
        </label>
      </div>
      {isLoading ? (
        <Empty>Loading…</Empty>
      ) : rows.length === 0 ? (
        <Empty>{showResolved ? 'No posting failures on record.' : 'Nothing unresolved — the ledger is keeping up.'}</Empty>
      ) : (
        <div className="divide-y dark:divide-slate-700">
          {rows.map(f => (
            <div key={f.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-xs text-slate-400 dark:text-slate-500">{f.source_table} · {formatDate(f.attempted_at)}</p>
                <p className="text-sm text-slate-700 dark:text-slate-200">{f.error_message}</p>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                {/* Offered on dismissed rows too: "resolved" only ever meant
                    the notice was cleared, so a row can sit resolved with the
                    transaction still absent from the books — precisely the
                    case that needs re-posting. Retrying an entry that did post
                    is harmless, it reports "Already posted". */}
                {(f.source_table === 'expenses' || f.source_table === 'sales') && (
                  <button
                    onClick={() => handleRetry(f)}
                    disabled={retrying === f.id}
                    title="Re-run the posting now that the underlying record has been corrected"
                    className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {retrying === f.id ? 'Posting…' : 'Retry Posting'}
                  </button>
                )}
                {!f.resolved ? (
                  <button onClick={() => handleResolve(f.id)} className="rounded-md border px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700">
                    Dismiss
                  </button>
                ) : (
                  <span className="text-xs text-emerald-600 dark:text-emerald-400">Dismissed</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

// ── P&L / Balance Sheet Preview ────────────────────────────────────
function PlBalanceSheetPreviewTab() {
  const { data: pl = [], isLoading: loadingPl } = useQuery({
    queryKey: ['v-pl-ledger-preview'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_pl_ledger_preview').select('*')
      if (error) throw error
      return data as PlLedgerPreviewRow[]
    },
  })
  const { data: bs = [], isLoading: loadingBs } = useQuery({
    queryKey: ['balance-sheet-ledger-preview'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('balance_sheet_ledger_preview', { p_as_of_date: new Date().toISOString().slice(0, 10) })
      if (error) throw error
      return data as BalanceSheetLedgerPreviewRow[]
    },
  })

  const totalRevenue = pl.filter(r => r.nature === 'Revenue').reduce((s, r) => s + r.amount, 0)
  const totalExpense = pl.filter(r => r.nature === 'Expense').reduce((s, r) => s + r.amount, 0)

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Section title="P&L (Ledger Preview)" sub="Current fiscal period, Revenue and Expense account movement only">
        {loadingPl ? <Empty>Loading…</Empty> : pl.length === 0 ? <Empty>No revenue/expense activity posted this period.</Empty> : (
          <div className="divide-y dark:divide-slate-700">
            {pl.map(r => (
              <div key={r.account_code} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-slate-700 dark:text-slate-200">{r.account_name}</span>
                <span className="tabular-nums font-medium">{formatCurrency(r.amount)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 dark:bg-slate-900/60 font-semibold text-sm">
              <span>Net Income</span>
              <span className={`tabular-nums ${totalRevenue - totalExpense >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                {formatCurrency(totalRevenue - totalExpense)}
              </span>
            </div>
          </div>
        )}
      </Section>
      <Section title="Balance Sheet (Ledger Preview)" sub="As of today — opening balance plus every journal movement since, cumulative">
        {loadingBs ? <Empty>Loading…</Empty> : bs.length === 0 ? <Empty>No Asset/Liability/Equity activity posted yet.</Empty> : (
          <div className="divide-y dark:divide-slate-700">
            {bs.map(r => (
              <div key={r.account_code} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-slate-700 dark:text-slate-200">{r.account_name}</span>
                <span className="tabular-nums font-medium">{formatCurrency(r.balance)}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

// ── Year-End Close ────────────────────────────────────────────────────
function YearEndCloseTab() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { role } = useAuth()
  const { data: periods = [], isLoading } = useFiscalPeriods()
  const [busyId, setBusyId] = useState<string | null>(null)

  async function handleClose(id: string, label: string) {
    if (!window.confirm(`Close ${label}? This zeroes Revenue/Expense into Retained Earnings and blocks further postings into this period until reopened. This is deliberate and not automatic — confirm the period's transactions are actually complete.`)) return
    setBusyId(id)
    const { error } = await supabase.rpc('close_fiscal_period', { p_fiscal_period_id: id })
    setBusyId(null)
    if (error) { toast(error.message, 'error'); return }
    toast(`${label} closed`, 'success')
    qc.invalidateQueries({ queryKey: ['fiscal-periods-lookup'] })
    qc.invalidateQueries({ queryKey: ['v-pl-ledger-preview'] })
  }

  async function handleReopen(id: string, label: string) {
    if (role !== 'admin') { toast('Only admin can reopen a closed period', 'error'); return }
    if (!window.confirm(`Reopen ${label}? This allows new postings into it again.`)) return
    setBusyId(id)
    const { error } = await supabase.rpc('reopen_fiscal_period', { p_fiscal_period_id: id })
    setBusyId(null)
    if (error) { toast(error.message, 'error'); return }
    toast(`${label} reopened`, 'success')
    qc.invalidateQueries({ queryKey: ['fiscal-periods-lookup'] })
  }

  return (
    <Section title="Year-End Close" sub="A deliberate, human-confirmed action — never automatic. Doesn't apply until a fiscal year actually ends.">
      {isLoading ? (
        <Empty>Loading…</Empty>
      ) : (
        <div className="divide-y dark:divide-slate-700">
          {(periods as { id: string; label: string; is_current: boolean }[]).map(p => (
            <div key={p.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <span className="font-medium text-slate-800 dark:text-slate-100">{p.label}</span>
                {p.is_current && <span className="ml-2 text-xs text-brand">Current</span>}
              </div>
              <ClosedStateAction periodId={p.id} label={p.label} busy={busyId === p.id} onClose={handleClose} onReopen={handleReopen} />
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

function ClosedStateAction({
  periodId, label, busy, onClose, onReopen,
}: {
  periodId: string; label: string; busy: boolean
  onClose: (id: string, label: string) => void
  onReopen: (id: string, label: string) => void
}) {
  const { data: closedInfo } = useQuery({
    queryKey: ['fiscal-period-closed', periodId],
    queryFn: async () => {
      const { data, error } = await supabase.from('fiscal_periods').select('closed, closed_at').eq('id', periodId).single()
      if (error) throw error
      return data as { closed: boolean; closed_at: string | null }
    },
  })

  if (!closedInfo) return null

  return closedInfo.closed ? (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500 dark:text-slate-400">Closed {closedInfo.closed_at ? formatDate(closedInfo.closed_at) : ''}</span>
      <button onClick={() => onReopen(periodId, label)} disabled={busy} className="rounded-md border px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50">
        Reopen
      </button>
    </div>
  ) : (
    <button onClick={() => onClose(periodId, label)} disabled={busy} className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
      <Lock className="h-3 w-3" /> Close Period
    </button>
  )
}
