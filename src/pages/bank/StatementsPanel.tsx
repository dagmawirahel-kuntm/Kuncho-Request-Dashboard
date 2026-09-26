import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import {
  KIND_LABEL, classificationLabel, describeReconciled, type AccountOverview, type BankLine,
} from '@/lib/bankReconciliation'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Lock, Trash2, Unlock } from 'lucide-react'

interface ImportRow {
  id: string
  file_name: string | null
  period_start: string | null
  period_end: string | null
  source_format: string | null
  lines_in_file: number | null
  lines_skipped: number | null
  continuity_gap: number | null
  uploaded_at: string
  starting_balance: number | null
  ending_balance: number | null
}

export function StatementsPanel({ account }: { account: AccountOverview }) {
  return (
    <div className="space-y-4">
      <ClosePeriod account={account} />
      <ImportHistory accountId={account.account_id} />
      <Rules accountId={account.account_id} />
    </div>
  )
}

// ── Close ───────────────────────────────────────────────────────────────
function ClosePeriod({ account }: { account: AccountOverview }) {
  const { toast } = useToast()
  const { role } = useAuth()
  const qc = useQueryClient()
  const [through, setThrough] = useState(account.statement_date ?? '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const { data: openUpTo = 0 } = useQuery({
    queryKey: ['bank-lines', 'open-up-to', account.account_id, through],
    enabled: !!through,
    queryFn: async () => {
      const { count, error } = await supabase.from('v_bank_line_status').select('line_id', { count: 'exact', head: true })
        .eq('account_id', account.account_id).lte('value_date', through).is('reconciled_as', null)
      if (error) throw error
      return count ?? 0
    },
  })
  const { data: balanceAt } = useQuery({
    queryKey: ['bank-lines', 'balance-at', account.account_id, through],
    enabled: !!through,
    queryFn: async () => {
      const { data, error } = await supabase.from('bank_statement_lines').select('running_balance, value_date')
        .eq('account_id', account.account_id).lte('value_date', through).not('running_balance', 'is', null)
        .order('value_date', { ascending: false }).order('created_at', { ascending: false }).order('line_no', { ascending: false }).limit(1)
      if (error) throw error
      return (data?.[0] ?? null) as { running_balance: number; value_date: string } | null
    },
  })
  const { data: closes = [] } = useQuery({
    queryKey: ['bank-overview', 'closes', account.account_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('bank_period_closes').select('*').eq('account_id', account.account_id).order('closed_through', { ascending: false })
      if (error) throw error
      return (data ?? []) as { id: string; closed_through: string; statement_balance: number; system_balance: number | null; variance: number | null; closed_at: string; reopened_at: string | null; reopen_reason: string | null; note: string | null }[]
    },
  })

  async function close() {
    if (!window.confirm(`Close ${account.account_name} through ${formatDate(through)}? Its lines up to then can't be changed afterwards without an admin reopening the period.`)) return
    setBusy(true)
    const { error } = await supabase.rpc('close_bank_period', { p_account_id: account.account_id, p_through: through, p_note: note.trim() || null })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`Closed through ${formatDate(through)}`, 'success')
    for (const k of ['bank-overview', 'bank-lines', 'accounts', 'account-reconciliation']) qc.invalidateQueries({ queryKey: [k] })
  }

  async function reopen(id: string) {
    const reason = window.prompt('Why reopen this period? (kept on record)')
    if (!reason?.trim()) return
    const { error } = await supabase.rpc('reopen_bank_period', { p_close_id: id, p_reason: reason.trim() })
    if (error) { toast(error.message, 'error'); return }
    toast('Period reopened', 'success')
    for (const k of ['bank-overview', 'bank-lines']) qc.invalidateQueries({ queryKey: [k] })
  }

  const canClose = !!through && openUpTo === 0 && !!balanceAt && (!account.closed_through || through > account.closed_through)

  return (
    <div className="space-y-3 rounded-xl border bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100"><Lock className="h-4 w-4" /> Close a period</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          When every line up to a date is reconciled, close it: the account's balance is set to the bank's figure on that date,
          any difference the app had is recorded, and those lines are locked.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[11px] text-slate-500">Through
          <input type="date" value={through} max={account.last_date ?? undefined} onChange={e => setThrough(e.target.value)}
            className="block rounded-md border px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </label>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)"
          className="w-56 rounded-md border px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        <button onClick={close} disabled={busy || !canClose}
          className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
          {busy ? 'Closing…' : 'Close period'}
        </button>
      </div>
      {through && (
        <p className={`flex items-center gap-1.5 text-xs ${openUpTo > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
          {openUpTo > 0 ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          {openUpTo > 0
            ? `${openUpTo} line${openUpTo === 1 ? '' : 's'} up to ${formatDate(through)} still to reconcile.`
            : balanceAt ? `Everything up to ${formatDate(through)} is reconciled; the statement stands at ${formatCurrency(Number(balanceAt.running_balance))}.` : 'No statement line on or before this date.'}
        </p>
      )}
      {closes.length > 0 && (
        <div className="divide-y rounded-md border text-xs dark:divide-slate-700 dark:border-slate-700">
          {closes.map(c => (
            <div key={c.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <span className={`font-medium ${c.reopened_at ? 'text-slate-400 line-through' : 'text-slate-700 dark:text-slate-200'}`}>Through {formatDate(c.closed_through)}</span>
              <span className="text-slate-500">bank {formatCurrency(Number(c.statement_balance))}</span>
              {c.variance != null && Math.abs(Number(c.variance)) >= 0.01 && (
                <span className="text-amber-700 dark:text-amber-400">app was {formatCurrency(Math.abs(Number(c.variance)))} {Number(c.variance) > 0 ? 'below' : 'above'} — corrected</span>
              )}
              {c.reopened_at && <span className="text-slate-400">reopened {formatDate(c.reopened_at)}{c.reopen_reason ? `: ${c.reopen_reason}` : ''}</span>}
              {!c.reopened_at && role === 'admin' && (
                <button onClick={() => reopen(c.id)} className="ml-auto flex items-center gap-1 text-slate-500 hover:text-red-600">
                  <Unlock className="h-3.5 w-3.5" /> Reopen
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Statements imported ─────────────────────────────────────────────────
function ImportHistory({ accountId }: { accountId: string }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const { data: imports = [] } = useQuery({
    queryKey: ['bank-imports', accountId],
    queryFn: async () => {
      const { data, error } = await supabase.from('bank_statement_imports')
        .select('id, file_name, period_start, period_end, source_format, lines_in_file, lines_skipped, continuity_gap, uploaded_at, starting_balance, ending_balance')
        .eq('account_id', accountId).order('period_start', { ascending: false })
      if (error) throw error
      return (data ?? []) as ImportRow[]
    },
  })
  const { data: lines = [] } = useQuery({
    queryKey: ['bank-lines', 'import', openId],
    enabled: !!openId,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_bank_line_status').select('*').eq('import_id', openId!).order('line_no')
      if (error) throw error
      return (data ?? []) as BankLine[]
    },
  })

  return (
    <div className="overflow-hidden rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800">
      <div className="border-b px-4 py-3 dark:border-slate-700">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Statements imported</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">Each line is stored once: re-uploading a statement, or one that overlaps, only adds what's new.</p>
      </div>
      {imports.length === 0 ? <p className="py-8 text-center text-sm text-slate-400">No statements for this account yet.</p> : (
        <div className="divide-y dark:divide-slate-700">
          {imports.map(imp => (
            <div key={imp.id}>
              <button onClick={() => setOpenId(openId === imp.id ? null : imp.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/40">
                {openId === imp.id ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-slate-800 dark:text-slate-100">{formatDate(imp.period_start)} → {formatDate(imp.period_end)}</span>
                  <span className="block truncate text-[11px] text-slate-400">
                    {imp.file_name ?? 'statement'}{imp.source_format ? ` · ${imp.source_format.toUpperCase()}` : ''} · uploaded {formatDate(imp.uploaded_at)}
                    {imp.lines_skipped ? ` · ${imp.lines_skipped} already imported` : ''}
                  </span>
                </span>
                {imp.continuity_gap != null && Math.abs(Number(imp.continuity_gap)) >= 0.01 && (
                  <span className="flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="h-3 w-3" /> gap {formatCurrency(Math.abs(Number(imp.continuity_gap)))}
                  </span>
                )}
              </button>
              {openId === imp.id && <LinesTable lines={lines} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function LinesTable({ lines }: { lines: BankLine[] }) {
  if (lines.length === 0) return <p className="py-4 text-center text-xs text-slate-400">Loading…</p>
  const out = lines.filter(l => l.direction === 'debit').reduce((s, l) => s + Number(l.amount), 0)
  const inn = lines.filter(l => l.direction === 'credit').reduce((s, l) => s + Number(l.amount), 0)
  return (
    <div className="overflow-x-auto border-t dark:border-slate-700">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-left text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
          <tr><th className="px-4 py-1.5">Date</th><th className="px-4 py-1.5">Narration</th><th className="px-4 py-1.5 text-right">Out</th>
            <th className="px-4 py-1.5 text-right">In</th><th className="px-4 py-1.5 text-right">Balance</th><th className="px-4 py-1.5">Settles</th></tr>
        </thead>
        <tbody className="divide-y dark:divide-slate-700">
          {lines.map(l => (
            <tr key={l.line_id}>
              <td className="whitespace-nowrap px-4 py-1.5 text-slate-600 dark:text-slate-300">{formatDate(l.value_date)}</td>
              <td className="max-w-[240px] px-4 py-1.5 text-slate-600 dark:text-slate-300">
                <span className="block truncate">{l.narration ?? '—'}</span>
                <span className="block truncate font-mono text-[10px] text-slate-400">{l.reference}</span>
              </td>
              <td className="px-4 py-1.5 text-right tabular-nums text-red-600 dark:text-red-400">{l.debit_amount != null ? formatCurrency(Number(l.debit_amount)) : ''}</td>
              <td className="px-4 py-1.5 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{l.credit_amount != null ? formatCurrency(Number(l.credit_amount)) : ''}</td>
              <td className="px-4 py-1.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{l.running_balance != null ? formatCurrency(Number(l.running_balance)) : '—'}</td>
              <td className="max-w-[260px] px-4 py-1.5">
                {l.reconciled_as ? (
                  <span className="text-slate-600 dark:text-slate-300">
                    <span className="mr-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">{KIND_LABEL[l.reconciled_as]}</span>
                    {describeReconciled(l).map((d, i) => (
                      <span key={i}>{i > 0 && ', '}{d.to ? <Link to={d.to} className="text-brand hover:underline">{d.text}</Link> : d.text}</span>
                    ))}
                  </span>
                ) : <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">To reconcile</span>}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t bg-slate-50 font-semibold dark:border-slate-600 dark:bg-slate-900/60">
          <tr><td className="px-4 py-1.5 text-slate-600 dark:text-slate-300" colSpan={2}>{lines.length} lines</td>
            <td className="px-4 py-1.5 text-right tabular-nums">{formatCurrency(out)}</td>
            <td className="px-4 py-1.5 text-right tabular-nums">{formatCurrency(inn)}</td><td colSpan={2} /></tr>
        </tfoot>
      </table>
    </div>
  )
}

// ── Rules ───────────────────────────────────────────────────────────────
function Rules({ accountId }: { accountId: string }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: rules = [] } = useQuery({
    queryKey: ['bank-rules', accountId],
    queryFn: async () => {
      const { data, error } = await supabase.from('bank_line_rules')
        .select('*, counter:counter_account_id ( account_name )')
        .or(`account_id.eq.${accountId},account_id.is.null`).order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as { id: string; match_text: string; direction: string | null; classification: string; is_active: boolean; times_applied: number; note: string | null; counter: { account_name: string } | null }[]
    },
  })

  async function toggle(id: string, active: boolean) {
    const { error } = await supabase.from('bank_line_rules').update({ is_active: active }).eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['bank-rules'] })
  }
  async function remove(id: string) {
    if (!window.confirm('Delete this rule? Lines it already explained stay as they are.')) return
    const { error } = await supabase.from('bank_line_rules').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['bank-rules'] })
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800">
      <div className="border-b px-4 py-3 dark:border-slate-700">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Rules</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">Applied to every new line after the reference and narration matches. Add one from a line with "Always treat … this way".</p>
      </div>
      {rules.length === 0 ? <p className="py-6 text-center text-xs text-slate-400">No rules yet.</p> : (
        <div className="divide-y text-xs dark:divide-slate-700">
          {rules.map(r => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
              <span className={r.is_active ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 line-through'}>
                {r.direction === 'debit' ? 'Money out' : r.direction === 'credit' ? 'Money in' : 'Any line'} containing <span className="font-mono">"{r.match_text}"</span> →{' '}
                <span className="font-medium">{r.classification === 'internal_transfer' ? `transfer with ${r.counter?.account_name ?? 'another account'}` : classificationLabel(r.classification)}</span>
              </span>
              <span className="text-slate-400">used {r.times_applied}×</span>
              <span className="ml-auto flex items-center gap-3">
                <button onClick={() => toggle(r.id, !r.is_active)} className="text-slate-500 hover:underline">{r.is_active ? 'Pause' : 'Resume'}</button>
                <button onClick={() => remove(r.id)} className="text-slate-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
