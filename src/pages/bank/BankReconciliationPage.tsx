import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { AccountOverview } from '@/lib/bankReconciliation'
import { ImportStatementPanel } from './ImportStatementPanel'
import { ReviewQueue } from './ReviewQueue'
import { StatementsPanel } from './StatementsPanel'
import { Landmark, Lock } from 'lucide-react'

type Tab = 'queue' | 'import' | 'statements'

/**
 * Bank reconciliation: import each account's statements (CSV, Excel, PDF),
 * settle every line against what it paid or brought in — or explain it —
 * and close the period at the bank's balance (migrations 344–346).
 */
export default function BankReconciliationPage() {
  // Links from Accounts, alerts and the month-end checklist open an account
  // (?account=), a tab (?tab=) or a line (?line=).
  const [params] = useSearchParams()
  const [tab, setTab] = useState<Tab | null>(() => {
    const t = params.get('tab')
    return t === 'queue' || t === 'import' || t === 'statements' ? t : null
  })
  const [accountId, setAccountId] = useState<string | null>(() => params.get('account'))
  const focusLineId = params.get('line')

  const { data: overview = [], isLoading } = useQuery({
    queryKey: ['bank-overview'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_bank_account_overview').select('*').order('account_name')
      if (error) throw error
      return (data ?? []) as AccountOverview[]
    },
  })
  const withLines = overview.filter(a => a.line_count > 0).sort((a, b) => b.line_count - a.line_count)
  const openTotal = withLines.reduce((s, a) => s + a.open_count, 0)
  const accounts = overview.map(a => ({ id: a.account_id, account_name: a.account_name }))
  // Statements & close work on one account: the chosen one, or the busiest.
  const statementAccount = withLines.find(a => a.account_id === accountId) ?? withLines[0] ?? null
  const activeTab: Tab = tab ?? (isLoading || openTotal > 0 ? 'queue' : 'import')

  const tabs: { id: Tab; label: string }[] = [
    { id: 'queue', label: `To reconcile${openTotal ? ` (${withLines.filter(a => !accountId || a.account_id === accountId).reduce((s, a) => s + a.open_count, 0)})` : ''}` },
    { id: 'import', label: 'Import a statement' },
    { id: 'statements', label: 'Statements & closing' },
  ]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Bank Reconciliation</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Import each account's statement, settle every line against the payment or receipt it is — or say what it is — and close the period at the bank's balance.
        </p>
      </div>

      {withLines.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {withLines.map(a => {
            const selected = accountId === a.account_id
            return (
              <button key={a.account_id} onClick={() => setAccountId(selected ? null : a.account_id)}
                className={`rounded-xl border bg-white p-3 text-left transition dark:bg-slate-800 ${selected ? 'border-brand ring-2 ring-brand/30' : 'hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-500'}`}>
                <div className="flex items-center gap-2">
                  <Landmark className="h-4 w-4 text-slate-400" />
                  <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{a.account_name}</span>
                  {a.open_count > 0
                    ? <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">{a.open_count} to reconcile</span>
                    : <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">all reconciled</span>}
                </div>
                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                  Statements {formatDate(a.first_date)} → {formatDate(a.last_date)}
                  {a.statement_balance != null && <> · bank balance <span className="font-medium text-slate-700 dark:text-slate-200">{formatCurrency(Number(a.statement_balance))}</span></>}
                </p>
                <p className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-400">
                  <Lock className="h-3 w-3" /> {a.closed_through ? `Closed through ${formatDate(a.closed_through)}` : 'Never closed'}
                  {a.oldest_open && <> · oldest open line {formatDate(a.oldest_open)}</>}
                </p>
              </button>
            )
          })}
        </div>
      )}

      <div className="flex gap-1 border-b dark:border-slate-700">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${activeTab === t.id ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
            {t.label}
          </button>
        ))}
        {accountId && (
          <span className="ml-auto self-center text-xs text-slate-500 dark:text-slate-400">
            Showing {overview.find(a => a.account_id === accountId)?.account_name} · <button onClick={() => setAccountId(null)} className="text-brand hover:underline">all accounts</button>
          </span>
        )}
      </div>

      {activeTab === 'queue' && <ReviewQueue accountId={accountId} accounts={accounts} focusLineId={focusLineId} />}
      {activeTab === 'import' && (
        <ImportStatementPanel onImported={acct => { setAccountId(acct); setTab('queue') }} />
      )}
      {activeTab === 'statements' && (
        statementAccount
          ? <StatementsPanel key={statementAccount.account_id} account={statementAccount} />
          : <p className="py-10 text-center text-sm text-slate-400">No statements imported yet.</p>
      )}
    </div>
  )
}
