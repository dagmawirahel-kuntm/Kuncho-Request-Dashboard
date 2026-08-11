import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { useAccounts } from '@/hooks/useLookups'
import { formatCurrency, formatDate } from '@/lib/utils'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { parseBankStatementCsv, type ParsedStatement } from '@/lib/bankStatementParser'
import type { BankStatementImport, BankStatementLine } from '@/types/database'
import { Upload, AlertTriangle, CheckCircle2, X, ChevronDown, ChevronRight, RefreshCw, Link2 } from 'lucide-react'

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

const MATCH_STATUS_LABEL: Record<string, string> = {
  unmatched: 'Unmatched',
  matched_expense: 'Matched',
  duplicate: 'Duplicate',
  manual: 'Manually resolved',
}
const MATCH_STATUS_CLS: Record<string, string> = {
  unmatched: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  matched_expense: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  duplicate: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  manual: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
}

export default function BankStatementImportPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: accounts = [] } = useAccounts()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accountOptions = (accounts as any[]).map(a => ({ id: a.id, label: a.account_name }))

  const [accountId, setAccountId] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParsedStatement | null>(null)
  const [creating, setCreating] = useState(false)
  const [activeImportId, setActiveImportId] = useState<string | null>(null)
  const [expandedImportId, setExpandedImportId] = useState<string | null>(null)

  const { data: imports = [], isLoading: loadingImports } = useQuery({
    queryKey: ['bank-statement-imports'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bank_statement_imports')
        .select('*, accounts(account_name)')
        .order('uploaded_at', { ascending: false })
      if (error) throw error
      return data as (BankStatementImport & { accounts: { account_name: string } | null })[]
    },
  })

  const { data: activeLines = [] } = useQuery({
    queryKey: ['bank-statement-lines', activeImportId],
    enabled: !!activeImportId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bank_statement_lines')
        .select('*, expenses:matched_expense_id (expense_code, item_service_description)')
        .eq('import_id', activeImportId!)
        .order('line_no')
      if (error) throw error
      return data as (BankStatementLine & { expenses: { expense_code: string | null; item_service_description: string | null } | null })[]
    },
  })

  const { data: expandedLines = [] } = useQuery({
    queryKey: ['bank-statement-lines', expandedImportId],
    enabled: !!expandedImportId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bank_statement_lines')
        .select('*, expenses:matched_expense_id (expense_code, item_service_description)')
        .eq('import_id', expandedImportId!)
        .order('line_no')
      if (error) throw error
      return data as (BankStatementLine & { expenses: { expense_code: string | null; item_service_description: string | null } | null })[]
    },
  })

  function handleFile(file: File) {
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = () => {
      const text = reader.result as string
      setParsed(parseBankStatementCsv(text))
    }
    reader.readAsText(file)
  }

  async function handleCreateImport() {
    if (!accountId || !parsed) { toast('Select an account and a CSV file first', 'error'); return }
    if (parsed.lines.length === 0) { toast('No transaction rows found in this file', 'error'); return }
    setCreating(true)

    const { data: importRow, error: importErr } = await supabase
      .from('bank_statement_imports')
      .insert([{
        account_id: accountId,
        file_name: fileName,
        period_start: parsed.periodStart,
        period_end: parsed.periodEnd,
        starting_balance: parsed.startingBalance,
        ending_balance: parsed.endingBalance,
      }])
      .select()
      .single()

    if (importErr || !importRow) { setCreating(false); toast(importErr?.message ?? 'Failed to create import', 'error'); return }

    const { error: linesErr } = await supabase.from('bank_statement_lines').insert(
      parsed.lines.map(l => ({
        import_id: importRow.id,
        line_no: l.lineNo,
        value_date: l.valueDate,
        post_date: l.postDate,
        transaction_type: l.transactionType,
        narration: l.narration,
        debit_amount: l.debitAmount,
        credit_amount: l.creditAmount,
        running_balance: l.runningBalance,
        reference: l.reference,
        reference_code: l.referenceCode,
      }))
    )
    if (linesErr) { setCreating(false); toast(linesErr.message, 'error'); return }

    const { error: matchErr } = await supabase.rpc('auto_match_statement_import', { p_import_id: importRow.id })
    setCreating(false)
    if (matchErr) { toast(`Import created but matching failed: ${matchErr.message}`, 'error'); return }

    toast(`Imported ${parsed.lines.length} line(s) and ran auto-match`, 'success')
    setActiveImportId(importRow.id)
    setParsed(null)
    setFileName(null)
    setAccountId(null)
    qc.invalidateQueries({ queryKey: ['bank-statement-imports'] })
  }

  async function handleCommit(importId: string) {
    const { data, error } = await supabase.rpc('commit_statement_import', { p_import_id: importId }).select().single()
    if (error) { toast(error.message, 'error'); return }
    const r = data as { transfers_created: number; expenses_matched: number; flagged_unmatched: number }
    toast(`Committed: ${r.transfers_created} transfer(s) created, ${r.expenses_matched} expense(s) matched, ${r.flagged_unmatched} flagged unmatched`, 'success')
    qc.invalidateQueries({ queryKey: ['bank-statement-imports'] })
    qc.invalidateQueries({ queryKey: ['bank-statement-lines', importId] })
  }

  const [rematching, setRematching] = useState(false)

  // Committed imports don't get automatically revisited when a backfilled
  // expense finally gets a matching bank_ref — this re-runs the same
  // reference-code match rule against every still-unmatched committed line
  // and, unlike the original auto-match, actually flips payment_state so
  // the expense surfaces as paid.
  async function handleRematch(importId?: string) {
    setRematching(true)
    const { data, error } = await supabase.rpc('rematch_committed_statement_lines', { p_import_id: importId ?? null }).select().single()
    setRematching(false)
    if (error) { toast(error.message, 'error'); return }
    const r = data as { matched_count: number; skipped_count: number }
    toast(r.matched_count > 0
      ? `Rematched ${r.matched_count} line(s) — expense(s) now show as paid`
      : 'No new matches found', r.matched_count > 0 ? 'success' : 'info')
    qc.invalidateQueries({ queryKey: ['bank-statement-lines'] })
    qc.invalidateQueries({ queryKey: ['expenses'] })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Bank Statement Import</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Upload a CSV export, match each line against expenses, transfers, and payroll, and commit real transfer records. Anything that doesn't match stays visibly flagged.
        </p>
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
          This matches <span className="font-medium">individual transactions</span>. To confirm an account's <span className="font-medium">total balance</span> against the statement's closing figure, reconcile it on the{' '}
          <Link to="/accounts" className="text-brand hover:underline">account's page</Link>.
        </p>
      </div>

      <Section title="New Import" sub="CSV only — columns: Value Date, Post Date, Transaction Type, Narration, Debit, Credit, Balance, Reference">
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Account</label>
              <SearchableSelect value={accountId} onChange={setAccountId} options={accountOptions} placeholder="Select account…" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Statement File (CSV)</label>
              <label className="flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer w-fit">
                <Upload className="h-3.5 w-3.5" /> {fileName ?? 'Choose file…'}
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
              </label>
            </div>
          </div>

          {parsed && (
            <div className="rounded-lg border dark:border-slate-600 bg-slate-50 dark:bg-slate-900/40 p-3 space-y-2 text-sm">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div><p className="text-xs text-slate-400">Rows Parsed</p><p className="font-semibold text-slate-800 dark:text-slate-100">{parsed.lines.length}</p></div>
                <div><p className="text-xs text-slate-400">Period</p><p className="font-semibold text-slate-800 dark:text-slate-100">{parsed.periodStart ?? '—'} → {parsed.periodEnd ?? '—'}</p></div>
                <div><p className="text-xs text-slate-400">Starting Balance</p><p className="font-semibold text-slate-800 dark:text-slate-100">{parsed.startingBalance != null ? formatCurrency(parsed.startingBalance) : '—'}</p></div>
                <div><p className="text-xs text-slate-400">Ending Balance</p><p className="font-semibold text-slate-800 dark:text-slate-100">{parsed.endingBalance != null ? formatCurrency(parsed.endingBalance) : '—'}</p></div>
              </div>
              {parsed.balanceWarnings.length > 0 && (
                <div className="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">{parsed.balanceWarnings.length} running-balance mismatch(es) — the file may be missing rows or a page.</p>
                    <ul className="mt-1 list-disc list-inside space-y-0.5">
                      {parsed.balanceWarnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                </div>
              )}
              <button
                onClick={handleCreateImport}
                disabled={creating || !accountId}
                className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {creating ? 'Importing…' : 'Create Import & Auto-Match'}
              </button>
            </div>
          )}
        </div>
      </Section>

      <PayrollReconcilePanel />

      {activeImportId && (
        <Section title="Review" sub="Confirm matches before committing — committing creates real transfer records">
          <div className="px-4 py-2 border-b dark:border-slate-700 flex justify-end">
            <button onClick={() => setActiveImportId(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
          </div>
          <LinesTable lines={activeLines} />
          <div className="px-4 py-3 border-t dark:border-slate-700 flex justify-end">
            <button
              onClick={() => handleCommit(activeImportId)}
              className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Commit Import
            </button>
          </div>
        </Section>
      )}

      <Section title="Import History" sub="Backfilled an expense's bank reference after committing? Rematch to pick it up — it flips the expense to paid, it doesn't just relabel the line.">
        <div className="px-4 py-2 border-b dark:border-slate-700 flex justify-end">
          <button
            onClick={() => handleRematch()}
            disabled={rematching}
            className="flex items-center gap-1.5 rounded-md border dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${rematching ? 'animate-spin' : ''}`} /> Rematch all committed lines
          </button>
        </div>
        {loadingImports ? (
          <div className="py-8 text-center text-sm text-slate-400">Loading…</div>
        ) : imports.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">No imports yet.</div>
        ) : (
          <div className="divide-y dark:divide-slate-700">
            {imports.map(imp => (
              <div key={imp.id}>
                <div className="flex items-center justify-between gap-2 px-4 py-3">
                  <button onClick={() => setExpandedImportId(expandedImportId === imp.id ? null : imp.id)} className="flex items-center gap-2 min-w-0 text-left">
                    {expandedImportId === imp.id ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
                    <div className="min-w-0">
                      <p className="font-medium text-slate-800 dark:text-slate-100 truncate">{imp.accounts?.account_name ?? '—'} — {imp.file_name ?? 'statement'}</p>
                      <p className="text-xs text-slate-400">{imp.period_start ?? '—'} → {imp.period_end ?? '—'} · uploaded {formatDate(imp.uploaded_at)}</p>
                    </div>
                  </button>
                  <div className="flex items-center gap-2 shrink-0">
                    {imp.status === 'committed' && (
                      <button
                        onClick={() => handleRematch(imp.id)}
                        disabled={rematching}
                        className="text-xs rounded-md border dark:border-slate-600 px-2 py-1 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
                        title="Rematch this import's unmatched lines against current expenses"
                      >
                        Rematch
                      </button>
                    )}
                    <StatusBadge status={imp.status} />
                  </div>
                </div>
                {expandedImportId === imp.id && <LinesTable lines={expandedLines} committed={imp.status === 'committed'} />}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

function LinesTable({ lines, committed = false }: { lines: (BankStatementLine & { expenses: { expense_code: string | null; item_service_description: string | null } | null })[]; committed?: boolean }) {
  if (lines.length === 0) return <div className="py-6 text-center text-xs text-slate-400">No lines.</div>
  const totalDebit = lines.reduce((s, l) => s + (l.debit_amount ?? 0), 0)
  const totalCredit = lines.reduce((s, l) => s + (l.credit_amount ?? 0), 0)
  const offsetLines = lines.filter(l => l.variance_amount != null && Number(l.variance_amount) !== 0)
  const offsetCount = offsetLines.length
  const totalVariance = offsetLines.reduce((s, l) => s + Number(l.variance_amount ?? 0), 0)
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-900/60 text-left text-xs text-slate-500 dark:text-slate-400">
          <tr>
            <th className="px-4 py-2">Date</th>
            <th className="px-4 py-2">Narration</th>
            <th className="px-4 py-2 text-right">Debit</th>
            <th className="px-4 py-2 text-right">Credit</th>
            <th className="px-4 py-2">Reference</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2">Matched Expense</th>
            <th className="px-4 py-2 text-right">Offset</th>
          </tr>
        </thead>
        <tbody className="divide-y dark:divide-slate-700">
          {lines.map(l => (
            <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
              <td className="px-4 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">{l.value_date ? formatDate(l.value_date) : '—'}</td>
              <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{l.narration ?? '—'}</td>
              <td className="px-4 py-2 text-right tabular-nums text-slate-800 dark:text-slate-100">{l.debit_amount != null ? formatCurrency(l.debit_amount) : '—'}</td>
              <td className="px-4 py-2 text-right tabular-nums text-slate-800 dark:text-slate-100">{l.credit_amount != null ? formatCurrency(l.credit_amount) : '—'}</td>
              <td className="px-4 py-2 text-slate-500 dark:text-slate-400 font-mono text-xs">{l.reference ?? '—'}</td>
              <td className="px-4 py-2">
                <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${MATCH_STATUS_CLS[l.match_status]}`}>
                  {MATCH_STATUS_LABEL[l.match_status]}
                </span>
              </td>
              <td className="px-4 py-2 min-w-0">
                {l.matched_expense_id && l.expenses ? (
                  <Link to={`/expenses/${l.matched_expense_id}`} className="text-brand hover:underline truncate block">
                    {l.expenses.item_service_description ?? l.expenses.expense_code}
                  </Link>
                ) : committed && l.match_status === 'unmatched' ? (
                  <MatchToExpenseCell lineId={l.id} />
                ) : '—'}
              </td>
              <td className="px-4 py-2 text-right whitespace-nowrap"><VarianceCell line={l} /></td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-2 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/60 font-semibold">
          <tr>
            <td className="px-4 py-2 text-slate-600 dark:text-slate-300" colSpan={2}>Total ({lines.length} line{lines.length === 1 ? '' : 's'})</td>
            <td className="px-4 py-2 text-right tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(totalDebit)}</td>
            <td className="px-4 py-2 text-right tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(totalCredit)}</td>
            <td className="px-4 py-2 text-slate-500 dark:text-slate-400" colSpan={3}>Net: {formatCurrency(totalCredit - totalDebit)}</td>
            <td className="px-4 py-2 text-right tabular-nums text-slate-800 dark:text-slate-100">
              {offsetCount > 0 ? formatCurrency(totalVariance) : '—'}
            </td>
          </tr>
        </tfoot>
      </table>
      {offsetCount > 0 && (
        <div className="flex items-start gap-2 border-t dark:border-slate-700 bg-amber-50 dark:bg-amber-900/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <p>
            {offsetCount} matched line{offsetCount === 1 ? '' : 's'} {offsetCount === 1 ? 'does' : 'do'} not fully offset the expense
            {offsetCount === 1 ? ' it' : ' they'} matched — net {formatCurrency(totalVariance)}. The reference still identifies the payment, so the match stands;
            the residual is shown so it can be settled or written off deliberately.
          </p>
        </div>
      )}
    </div>
  )
}

// The statement line and the expense it matched should be the same
// money. When they aren't, the amount of the difference is the thing
// finance actually needs to see — a partial settlement, a bank charge
// deducted at source, or a wrong match.
function VarianceCell({ line }: { line: BankStatementLine }) {
  if (line.match_status !== 'matched_expense' || line.variance_amount == null) {
    return <span className="text-slate-300 dark:text-slate-600">—</span>
  }
  if (Number(line.variance_amount) === 0) {
    return <span className="text-xs text-emerald-600 dark:text-emerald-400">Exact</span>
  }
  const over = Number(line.variance_amount) > 0
  return (
    <span
      className={`tabular-nums text-xs font-medium ${over ? 'text-blue-600 dark:text-blue-400' : 'text-amber-600 dark:text-amber-400'}`}
      title={
        `Statement line ${formatCurrency(Math.abs(Number(line.debit_amount) || Number(line.credit_amount) || 0))} vs expense ` +
        `${formatCurrency(Number(line.matched_expense_amount ?? 0))}`
      }
    >
      {over ? '+' : '−'}{formatCurrency(Math.abs(Number(line.variance_amount)))}
      <span className="ml-1 font-normal text-slate-400">{over ? 'over' : 'short'}</span>
    </span>
  )
}

// Inline manual pairing for a single unmatched line on a committed import —
// for cases the reference-code rematch can't catch (mistyped/missing
// bank_ref, wrong currency of reference, etc.). Candidate list is expenses
// not yet linked to any transfer; searchable by code/description.
function MatchToExpenseCell({ lineId }: { lineId: string }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [expenseId, setExpenseId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const { data: candidates = [] } = useQuery({
    queryKey: ['unmatched-expenses-for-line'],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('id, expense_code, item_service_description, amount_etb, date')
        .is('transfer_id', null)
        .order('date', { ascending: false })
        .limit(300)
      if (error) throw error
      return data as { id: string; expense_code: string | null; item_service_description: string | null; amount_etb: number | null; date: string | null }[]
    },
  })
  const options = candidates.map(c => ({
    id: c.id,
    label: `${c.expense_code ?? ''} ${c.item_service_description ?? ''}`.trim() || 'Expense',
    sub: `${c.date ?? ''} · ${c.amount_etb != null ? formatCurrency(c.amount_etb) : ''}`,
  }))

  async function confirm() {
    if (!expenseId) return
    setSaving(true)
    const { error } = await supabase.rpc('match_expense_to_statement_line', { p_line_id: lineId, p_expense_id: expenseId })
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Matched — expense now shows as paid', 'success')
    setOpen(false)
    setExpenseId(null)
    qc.invalidateQueries({ queryKey: ['bank-statement-lines'] })
    qc.invalidateQueries({ queryKey: ['expenses'] })
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-xs text-brand hover:underline">
        <Link2 className="h-3 w-3" /> Match to expense
      </button>
    )
  }
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-56">
        <SearchableSelect value={expenseId} onChange={setExpenseId} options={options} placeholder="Search expenses…" />
      </div>
      <button onClick={confirm} disabled={!expenseId || saving} className="rounded-md bg-brand px-2 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
        {saving ? '…' : 'Confirm'}
      </button>
      <button onClick={() => { setOpen(false); setExpenseId(null) }} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-3.5 w-3.5" /></button>
    </div>
  )
}

// Payments that never touch the payments page — payroll first — still leave the
// bank and need a statement line against them, or they sit forever unreconciled.
// This lists paid payroll runs with no matched line and lets finance point each
// at an unmatched debit line from a committed statement for the same account.
interface UnreconciledPayroll {
  payroll_id: string
  payroll_record: string | null
  end_date: string | null
  account_id: string | null
  account_name: string | null
  net_amount: number
}
interface UnmatchedDebitLine {
  id: string
  value_date: string | null
  debit_amount: number | null
  narration: string | null
  reference: string | null
  bank_statement_imports: { account_id: string | null } | null
}

function PayrollReconcilePanel() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const { data: payrolls = [] } = useQuery({
    queryKey: ['unreconciled-payroll'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_unreconciled_payroll').select('*').order('end_date', { ascending: false })
      if (error) throw error
      return data as UnreconciledPayroll[]
    },
  })

  const { data: unmatchedLines = [] } = useQuery({
    queryKey: ['unmatched-debit-lines'],
    enabled: !!expanded,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bank_statement_lines')
        .select('id, value_date, debit_amount, narration, reference, bank_statement_imports!inner(account_id)')
        .eq('match_status', 'unmatched')
        .not('debit_amount', 'is', null)
        .order('value_date', { ascending: false })
      if (error) throw error
      return data as unknown as UnmatchedDebitLine[]
    },
  })

  async function match(lineId: string, payrollId: string) {
    setBusy(true)
    const { error } = await supabase.rpc('match_line_to_payroll', { p_line_id: lineId, p_payroll_id: payrollId })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    setExpanded(null)
    qc.invalidateQueries({ queryKey: ['unreconciled-payroll'] })
    qc.invalidateQueries({ queryKey: ['unmatched-debit-lines'] })
    toast('Payroll matched to bank line', 'success')
  }

  if (payrolls.length === 0) return null

  return (
    <Section title="Payroll to Reconcile" sub="Paid payroll runs with no matching bank line yet — off-payments-page disbursements">
      <div className="divide-y dark:divide-slate-700">
        {payrolls.map(p => {
          const linesForAccount = unmatchedLines.filter(l => l.bank_statement_imports?.account_id === p.account_id)
          return (
            <div key={p.payroll_id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                    {p.payroll_record ?? 'Payroll run'} · {p.account_name ?? 'No account'}
                  </p>
                  <p className="text-xs text-slate-400">
                    {p.end_date ? formatDate(p.end_date) : '—'} · net {formatCurrency(p.net_amount)}
                  </p>
                </div>
                <button
                  onClick={() => setExpanded(expanded === p.payroll_id ? null : p.payroll_id)}
                  className="shrink-0 rounded-md border dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  {expanded === p.payroll_id ? 'Cancel' : 'Match to bank line'}
                </button>
              </div>

              {expanded === p.payroll_id && (
                <div className="mt-2 rounded-lg border dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 divide-y dark:divide-slate-700">
                  {linesForAccount.length === 0 ? (
                    <p className="px-3 py-3 text-xs text-slate-400">
                      No unmatched debit lines on committed statements for this account. Import the statement that contains this payroll first.
                    </p>
                  ) : linesForAccount.map(l => (
                    <button
                      key={l.id}
                      onClick={() => match(l.id, p.payroll_id)}
                      disabled={busy}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-white dark:hover:bg-slate-800 disabled:opacity-50"
                    >
                      <span className="min-w-0 truncate text-slate-600 dark:text-slate-300">
                        {l.value_date ? formatDate(l.value_date) : '—'} · {l.narration ?? l.reference ?? 'no narration'}
                      </span>
                      <span className="shrink-0 font-medium tabular-nums text-slate-800 dark:text-slate-100">
                        {l.debit_amount != null ? formatCurrency(l.debit_amount) : '—'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Section>
  )
}
