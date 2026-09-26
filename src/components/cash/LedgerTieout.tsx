import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, ChevronDown, ChevronRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { LedgerTieout } from '@/lib/cashControl'

function signed(n: number | null | undefined) {
  const v = Number(n ?? 0)
  return `${v < 0 ? '−' : v > 0 ? '+' : ''}${formatCurrency(Math.abs(v))}`
}

type Drill = 'unposted' | 'not_on_bank' | null

// Bank balance vs the general ledger's cash account, at the statement date,
// and what makes up the difference (v_account_ledger_tieout, migration 350).
export function LedgerTieoutCard({ row }: { row: LedgerTieout }) {
  const [drill, setDrill] = useState<Drill>(null)
  if (row.statement_date == null) {
    return (
      <div className="rounded-xl border bg-white p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
        <p className="font-semibold text-slate-700 dark:text-slate-200">{row.account_name} · ledger {row.account_code}</p>
        <p className="mt-1">Ledger balance {formatCurrency(row.ledger_balance)}. Import a statement to tie it to the bank.</p>
      </div>
    )
  }
  const unexplained = Number(row.unexplained ?? 0)
  const parts: { key: string; label: string; hint: string; amount: number; count?: number; drill?: Drill; link?: string }[] = [
    { key: 'opening', label: 'Balance the statements started from', hint: 'Not a ledger entry — an opening balance journal would carry it.', amount: Number(row.opening_net ?? 0) },
    { key: 'open', label: 'Bank lines not explained yet', hint: 'Match or explain them and they reach the ledger.', amount: row.open_net, count: row.open_count,
      link: `/bank-statement-import?account=${row.account_id}` },
    { key: 'unposted', label: 'Explained, but no ledger entry', hint: 'Matched to a record that never posted (payroll, say).', amount: row.unposted_net, count: row.unposted_count, drill: 'unposted' },
    { key: 'not_on_bank', label: 'In the ledger, not on the bank', hint: 'Posted to this bank but no statement line stands behind it.', amount: -row.not_on_bank, count: row.not_on_bank_count, drill: 'not_on_bank' },
  ]
  if (Math.abs(row.before_statements) > 0.005) {
    parts.push({ key: 'before', label: 'Ledger entries before the first statement', hint: 'Import older statements to cover them.', amount: -row.before_statements })
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-3 dark:border-slate-700">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <BookOpen className="h-4 w-4 text-brand" /> {row.account_name} <span className="font-normal text-slate-400">· ledger {row.account_code}</span>
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">at {formatDate(row.statement_date)}</p>
      </div>
      <div className="grid grid-cols-3 divide-x text-center dark:divide-slate-700">
        <Figure label="Bank" value={formatCurrency(row.statement_balance)} />
        <Figure label="Ledger" value={formatCurrency(row.ledger_at_statement)} />
        <Figure label="Difference" value={signed(row.difference)} tone={Math.abs(Number(row.difference ?? 0)) < 0.01 ? 'ok' : 'warn'} />
      </div>
      <div className="divide-y border-t text-xs dark:divide-slate-700 dark:border-slate-700">
        {parts.map(p => (
          <div key={p.key}>
            <div className="flex items-center gap-3 px-4 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-slate-700 dark:text-slate-200">
                  {p.label}{p.count ? <span className="text-slate-400"> · {p.count}</span> : null}
                </p>
                <p className="text-[11px] text-slate-400">{p.hint}</p>
              </div>
              {p.drill && (p.count ?? 0) > 0 && (
                <button onClick={() => setDrill(drill === p.drill ? null : p.drill!)} className="flex items-center gap-0.5 text-[11px] font-medium text-brand hover:underline">
                  {drill === p.drill ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} Show
                </button>
              )}
              {p.link && (p.count ?? 0) > 0 && <Link to={p.link} className="text-[11px] font-medium text-brand hover:underline">Reconcile</Link>}
              <span className="w-32 text-right tabular-nums text-slate-700 dark:text-slate-200">{signed(p.amount)}</span>
            </div>
            {drill === p.drill && p.drill && <DrillList accountId={row.account_id} drill={p.drill} statementDate={row.statement_date!} />}
          </div>
        ))}
        <div className={`flex items-center gap-3 px-4 py-2 font-semibold ${Math.abs(unexplained) < 1 ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
          <div className="flex-1">
            Left unexplained
            <p className="text-[11px] font-normal text-slate-400">Amounts that differ between an entry and its bank line, or an entry on the wrong bank.</p>
          </div>
          <span className="w-32 text-right tabular-nums">{signed(unexplained)}</span>
        </div>
      </div>
    </div>
  )
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' }) {
  const cls = tone === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-800 dark:text-slate-100'
  return (
    <div className="px-2 py-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-sm font-bold tabular-nums sm:text-base ${cls}`}>{value}</p>
    </div>
  )
}

const SOURCE_LINK: Record<string, (id: string) => string> = {
  expenses: id => `/expenses/${id}`,
  sales: id => `/sales/${id}`,
  payroll: id => `/payroll/${id}`,
  vendor_receipt_facilitation: id => `/vendor-receipts/${id}`,
}

function DrillList({ accountId, drill, statementDate }: { accountId: string; drill: 'unposted' | 'not_on_bank'; statementDate: string }) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['ledger-drill', accountId, drill, statementDate],
    queryFn: async () => {
      if (drill === 'unposted') {
        const { data, error } = await supabase.from('v_bank_line_ledger')
          .select('line_id, value_date, narration, reference, signed_amount, reconciled_as, ledger_gap')
          .eq('account_id', accountId).eq('in_ledger', false).not('reconciled_as', 'is', null).neq('reconciled_as', 'opening_balance')
          .order('value_date')
        if (error) throw error
        return (data ?? []).map((r: { line_id: string; value_date: string; narration: string | null; reference: string | null; signed_amount: number; ledger_gap: string }) => ({
          key: r.line_id, date: r.value_date, text: r.narration || r.reference || '—', note: r.ledger_gap, amount: r.signed_amount,
          link: `/bank-statement-import?account=${accountId}&tab=queue&line=${r.line_id}`,
        }))
      }
      const { data, error } = await supabase.from('v_cash_ledger_lines')
        .select('journal_line_id, entry_date, description, source_table, source_id, amount')
        .eq('account_id', accountId).eq('on_bank', false).lte('entry_date', statementDate)
        .order('entry_date')
      if (error) throw error
      return (data ?? []).map((r: { journal_line_id: string; entry_date: string; description: string | null; source_table: string; source_id: string; amount: number }) => ({
        key: r.journal_line_id, date: r.entry_date, text: r.description ?? r.source_table, note: r.source_table.replace(/_/g, ' '), amount: r.amount,
        link: (SOURCE_LINK[r.source_table] ?? (r.source_table.startsWith('expense') ? SOURCE_LINK.expenses : null))?.(r.source_id) ?? null,
      }))
    },
  })
  return (
    <div className="max-h-72 overflow-y-auto bg-slate-50 dark:bg-slate-900/40">
      {isLoading ? <p className="px-4 py-3 text-slate-400">Loading…</p> : rows.map(r => (
        <div key={r.key} className="flex items-center gap-3 px-6 py-1.5">
          <span className="w-20 shrink-0 text-slate-500">{formatDate(r.date)}</span>
          <span className="min-w-0 flex-1 truncate">
            {r.link ? <Link to={r.link} className="text-brand hover:underline">{r.text}</Link> : r.text}
            <span className="text-slate-400"> · {r.note}</span>
          </span>
          <span className="w-28 text-right tabular-nums">{signed(r.amount)}</span>
        </div>
      ))}
    </div>
  )
}
