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
import { Upload, AlertTriangle, CheckCircle2, X, ChevronDown, ChevronRight } from 'lucide-react'

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Bank Statement Import</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Upload a CSV export, match it against expenses awaiting reconciliation, and commit real transfer records. Anything that doesn't match either direction stays visibly flagged.
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

      <Section title="Import History">
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
                  <StatusBadge status={imp.status} />
                </div>
                {expandedImportId === imp.id && <LinesTable lines={expandedLines} />}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

function LinesTable({ lines }: { lines: (BankStatementLine & { expenses: { expense_code: string | null; item_service_description: string | null } | null })[] }) {
  if (lines.length === 0) return <div className="py-6 text-center text-xs text-slate-400">No lines.</div>
  const totalDebit = lines.reduce((s, l) => s + (l.debit_amount ?? 0), 0)
  const totalCredit = lines.reduce((s, l) => s + (l.credit_amount ?? 0), 0)
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
                ) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-2 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/60 font-semibold">
          <tr>
            <td className="px-4 py-2 text-slate-600 dark:text-slate-300" colSpan={2}>Total ({lines.length} line{lines.length === 1 ? '' : 's'})</td>
            <td className="px-4 py-2 text-right tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(totalDebit)}</td>
            <td className="px-4 py-2 text-right tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(totalCredit)}</td>
            <td className="px-4 py-2 text-slate-500 dark:text-slate-400" colSpan={3}>Net: {formatCurrency(totalCredit - totalDebit)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
