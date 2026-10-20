import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { AccountOverview } from '@/lib/bankReconciliation'
import { ImportStatementPanel } from './ImportStatementPanel'
import { ReviewQueue } from './ReviewQueue'
import { StatementsPanel } from './StatementsPanel'
import { AuditPanel } from './AuditPanel'
import { useBankAuditFlags } from '@/lib/bankAudit'
import { inRange } from '@/lib/bankReconciliation'
import { CalendarRange, Landmark, Lock } from 'lucide-react'

type Tab = 'queue' | 'audit' | 'import' | 'statements'
const TABS: Tab[] = ['queue', 'audit', 'import', 'statements']
const dateCls = 'rounded-md border px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'

/**
 * Bank reconciliation: import each account's statements (CSV, Excel, PDF),
 * settle every line against what it paid or brought in — or explain it —
 * and close the period at the bank's balance (migrations 344–346).
 * The audit (440–442) is the statement as the last proof of what the
 * payment workflow says was paid: what doesn't agree, and who paid it.
 */
export default function BankReconciliationPage() {
  // Links from Accounts, alerts and the month-end checklist open an account
  // (?account=), a tab (?tab=) or a line (?line=).
  const [params] = useSearchParams()
  const { role } = useAuth()
  const canAct = role === 'admin' || role === 'finance'
  const [tab, setTab] = useState<Tab | null>(() => {
    const t = params.get('tab') as Tab | null
    return t && TABS.includes(t) ? t : null
  })
  const [accountId, setAccountId] = useState<string | null>(() => params.get('account'))
  // The line the queue opens on: from a link (?line=), or a flag on the audit.
  const [focusLineId, setFocusLineId] = useState<string | null>(() => params.get('line'))
  // The lines (by value date) and the flags (by their date) between two days.
  const [from, setFrom] = useState(() => params.get('from') ?? '')
  const [to, setTo] = useState(() => params.get('to') ?? '')
  const { data: flags = [] } = useBankAuditFlags()
  const flagCount = flags.filter(f => (!accountId || f.account_id === accountId) && inRange(f.ref_date, from, to)).length

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
    { id: 'audit', label: `Audit${flagCount ? ` (${flagCount})` : ''}` },
    { id: 'import', label: 'Import a statement' },
    { id: 'statements', label: 'Statements & closing' },
  ]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Bank Reconciliation</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Import each account's statement, settle every line against the payment or receipt it is — or say what it is — and close the period at the bank's balance.
          The Audit tab shows what the bank and the payments don't agree on.
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

      <div className="flex gap-1 overflow-x-auto border-b dark:border-slate-700">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium ${activeTab === t.id ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
            {t.label}
          </button>
        ))}
        {accountId && (
          <span className="ml-auto self-center text-xs text-slate-500 dark:text-slate-400">
            Showing {overview.find(a => a.account_id === accountId)?.account_name} · <button onClick={() => setAccountId(null)} className="text-brand hover:underline">all accounts</button>
          </span>
        )}
      </div>

      {(activeTab === 'queue' || activeTab === 'audit') && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <CalendarRange className="h-3.5 w-3.5 text-slate-400" />
          <label className="flex items-center gap-1.5">From
            <input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} className={dateCls} />
          </label>
          <label className="flex items-center gap-1.5">to
            <input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} className={dateCls} />
          </label>
          {(from || to) && <button onClick={() => { setFrom(''); setTo('') }} className="text-brand hover:underline">Any date</button>}
        </div>
      )}

      {activeTab === 'queue' && <ReviewQueue key={focusLineId ?? 'queue'} accountId={accountId} accounts={accounts} focusLineId={focusLineId} from={from} to={to} />}
      {activeTab === 'audit' && (
        <AuditPanel accountId={accountId} accounts={accounts} canAct={canAct} isAdmin={role === 'admin'} from={from} to={to}
          onOpenLine={lineId => { setFocusLineId(lineId); setTab('queue') }}
          onImport={acct => { setAccountId(acct); setTab('import') }} />
      )}
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
