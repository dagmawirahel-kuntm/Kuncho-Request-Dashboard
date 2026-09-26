import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { readStatementFile, type ReadStatement } from '@/lib/bankStatements/readers'
import {
  applyMapping, detectMapping, headerSignature,
  type ColumnMapping, type DateOrder, type ParsedStatement,
} from '@/lib/bankStatements/grid'
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Info, Settings2, Upload, XCircle } from 'lucide-react'

interface AccountOpt { id: string; account_name: string; status: string | null; has_lines: boolean }

interface DryRun {
  total: number
  new: number
  already_imported: number
  first_new_date: string | null
  last_new_date: string | null
  gap_before: number | null
  gap_after: number | null
  previous_balance: number | null
  previous_date: string | null
  in_closed_period: number
  import_id: string | null
  auto_reconciled?: number
}

const selectCls = 'w-full rounded-md border px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'

function toRpcLines(p: ParsedStatement) {
  return p.lines.map(l => ({
    value_date: l.valueDate, post_date: l.postDate, transaction_type: l.transactionType, narration: l.narration,
    debit: l.debit, credit: l.credit, balance: l.balance, reference: l.reference,
  }))
}

export function ImportStatementPanel({ onImported }: { onImported: (accountId: string) => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [accountId, setAccountId] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [read, setRead] = useState<ReadStatement | null>(null)
  // Columns finance set by hand; otherwise the saved layout or the detected one.
  const [manual, setManual] = useState<ColumnMapping | null>(null)
  const [showMapping, setShowMapping] = useState(false)
  const [reading, setReading] = useState(false)
  const [importing, setImporting] = useState(false)

  // Accounts in use first; "inactive" accounts that were never opened last.
  const { data: accounts = [] } = useQuery({
    queryKey: ['bank-import-accounts'],
    queryFn: async () => {
      const [{ data: a, error }, { data: ov }] = await Promise.all([
        supabase.from('accounts').select('id, account_name, status').order('account_name'),
        supabase.from('v_bank_account_overview').select('account_id, line_count'),
      ])
      if (error) throw error
      const used = new Set(((ov ?? []) as { account_id: string; line_count: number }[]).filter(o => o.line_count > 0).map(o => o.account_id))
      return ((a ?? []) as { id: string; account_name: string; status: string | null }[])
        .map(x => ({ ...x, has_lines: used.has(x.id) }))
        .sort((x, y) => Number(y.has_lines) - Number(x.has_lines)
          || Number((x.status ?? '').toLowerCase() === 'inactive') - Number((y.status ?? '').toLowerCase() === 'inactive')
          || x.account_name.localeCompare(y.account_name)) as AccountOpt[]
    },
  })
  const accountOptions = accounts.map(a => ({
    id: a.id, label: a.account_name,
    sub: a.has_lines ? 'statements imported' : (a.status ?? '').toLowerCase() === 'inactive' ? 'not opened' : undefined,
  }))

  // Saved layouts for this account, to recognise its files.
  const { data: formats = [] } = useQuery({
    queryKey: ['bank-statement-formats', accountId],
    enabled: !!accountId,
    queryFn: async () => {
      const { data, error } = await supabase.from('bank_statement_formats').select('source_format, header_signature, mapping').eq('account_id', accountId!)
      if (error) throw error
      return (data ?? []) as { source_format: string; header_signature: string; mapping: ColumnMapping }[]
    },
  })

  const saved = useMemo(() => read
    ? formats.find(f => f.source_format === read.format && headerSignature(read.grid, f.mapping.headerRow) === f.header_signature) ?? null
    : null, [read, formats])
  const detected = useMemo(() => (read ? detectMapping(read.grid) : null), [read])
  const mapping = useMemo<ColumnMapping | null>(() => (read
    ? manual ?? saved?.mapping ?? detected ?? { headerRow: read.pdfHeaderRow ?? 0, date: 0, narration: [1], dateOrder: 'dmy' }
    : null), [read, manual, saved, detected])
  const mappingSource = manual ? 'manual' : saved ? 'saved' : detected ? 'detected' : 'none'
  const mappingOpen = showMapping || mappingSource === 'none'

  async function handleFile(file: File) {
    setFileName(file.name); setRead(null); setManual(null); setShowMapping(false); setReading(true)
    try {
      const r = await readStatementFile(file)
      if (r.grid.length === 0) throw new Error('No rows could be read from this file')
      setRead(r)
      if (r.format !== 'csv') setShowMapping(true)
    } catch (e) {
      toast((e as Error).message, 'error')
      setFileName(null)
    } finally {
      setReading(false)
    }
  }

  const parsed = useMemo(() => (read && mapping ? applyMapping(read.grid, mapping) : null), [read, mapping])
  const rpcLines = useMemo(() => (parsed ? toRpcLines(parsed) : []), [parsed])

  // What the database makes of it before anything is written.
  const { data: dry, isFetching: checking, error: dryError } = useQuery({
    queryKey: ['bank-import-dry-run', accountId, fileName, JSON.stringify(rpcLines).length, mapping],
    enabled: !!accountId && rpcLines.length > 0,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('import_bank_statement', {
        p_account_id: accountId, p_file_name: fileName, p_source_format: read!.format,
        p_starting_balance: parsed!.startingBalance, p_ending_balance: parsed!.endingBalance,
        p_lines: rpcLines, p_dry_run: true,
      })
      if (error) throw error
      return data as DryRun
    },
  })

  async function handleImport() {
    if (!accountId || !read || !parsed || !mapping) return
    setImporting(true)
    const { data, error } = await supabase.rpc('import_bank_statement', {
      p_account_id: accountId, p_file_name: fileName, p_source_format: read.format,
      p_starting_balance: parsed.startingBalance, p_ending_balance: parsed.endingBalance,
      p_lines: rpcLines, p_dry_run: false,
    })
    if (error) { setImporting(false); toast(error.message, 'error'); return }
    // Remember a layout that had to be detected or mapped, for this bank's next file.
    if (mappingSource !== 'saved') {
      await supabase.from('bank_statement_formats').upsert([{
        account_id: accountId, source_format: read.format,
        header_signature: headerSignature(read.grid, mapping.headerRow), mapping, updated_at: new Date().toISOString(),
      }], { onConflict: 'account_id,source_format,header_signature' })
    }
    setImporting(false)
    const r = data as DryRun
    toast(r.new === 0
      ? 'Nothing new — every line in this file was already imported'
      : `Imported ${r.new} line${r.new === 1 ? '' : 's'}${r.already_imported ? ` (${r.already_imported} already in)` : ''}; ${r.auto_reconciled ?? 0} matched automatically`, 'success')
    for (const k of ['bank-lines', 'bank-overview', 'bank-imports', 'bank-statement-formats', 'bank-import-accounts', 'expenses', 'sales', 'accounts']) {
      qc.invalidateQueries({ queryKey: [k] })
    }
    const acct = accountId
    setRead(null); setManual(null); setFileName(null)
    onImported(acct)
  }

  const moneyOut = parsed?.lines.reduce((s, l) => s + (l.debit ?? 0), 0) ?? 0
  const moneyIn = parsed?.lines.reduce((s, l) => s + (l.credit ?? 0), 0) ?? 0
  const columns = read ? columnChoices(read, mapping?.headerRow ?? 0) : []

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Account</label>
          <SearchableSelect value={accountId} onChange={setAccountId} options={accountOptions} placeholder="Which account is this statement for?" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Statement file</label>
          <label className="flex w-fit cursor-pointer items-center gap-1.5 rounded-md border px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
            <Upload className="h-3.5 w-3.5" /> {reading ? 'Reading…' : fileName ?? 'CSV, Excel (.xlsx) or PDF…'}
            <input type="file" accept=".csv,.xlsx,.pdf,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />
          </label>
          <p className="mt-1 text-[11px] text-slate-400">CBE's internet-banking CSV reads itself. Another bank's Excel or PDF is mapped once, then remembered for that account.</p>
        </div>
      </div>

      {read && mapping && parsed && (
        <div className="space-y-3 rounded-lg border bg-slate-50 p-3 text-sm dark:border-slate-600 dark:bg-slate-900/40">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <FileSpreadsheet className="h-3.5 w-3.5" />
              {read.format.toUpperCase()} · columns {mappingSource === 'saved' ? 'from the layout saved for this account' : mappingSource === 'detected' ? 'recognised from the header' : mappingSource === 'manual' ? 'as you set them' : 'not recognised — map them below'}
              {parsed.reversed && ' · newest-first statement put in date order'}
            </p>
            <button onClick={() => setShowMapping(v => !v)} className="flex items-center gap-1 text-xs text-brand hover:underline">
              <Settings2 className="h-3.5 w-3.5" /> {mappingOpen ? 'Hide columns' : 'Check columns'}
            </button>
          </div>

          {mappingOpen && (
            <MappingEditor mapping={mapping} columns={columns} rows={read.grid.length} onChange={setManual} />
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Lines" value={String(parsed.lines.length)} />
            <Stat label="Period" value={parsed.lines.length ? `${formatDate(parsed.lines[0].valueDate)} → ${formatDate(parsed.lines[parsed.lines.length - 1].valueDate)}` : '—'} />
            <Stat label="Opening" value={parsed.startingBalance != null ? formatCurrency(parsed.startingBalance) : '—'} />
            <Stat label="Money out / in" value={`${formatCurrency(moneyOut)} / ${formatCurrency(moneyIn)}`} />
            <Stat label="Closing" value={parsed.endingBalance != null ? formatCurrency(parsed.endingBalance) : '—'} />
          </div>

          {parsed.warnings.length > 0 && (
            <Note tone="amber" icon={<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}>
              <p className="font-medium">{parsed.warnings[0]}</p>
              {parsed.warnings.length > 1 && <ul className="mt-1 list-inside list-disc">{parsed.warnings.slice(1).map((w, i) => <li key={i}>{w}</li>)}</ul>}
            </Note>
          )}
          {parsed.skipped > 0 && (
            <Note tone="amber" icon={<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}>
              {parsed.skipped} row{parsed.skipped === 1 ? '' : 's'} with an amount couldn't be read (no date in the date column) — check the columns.
            </Note>
          )}

          {parsed.lines.length > 0 && <PreviewTable parsed={parsed} />}

          {accountId && parsed.lines.length > 0 && (
            checking ? <p className="text-xs text-slate-400">Checking against what's already imported…</p>
            : dryError ? <Note tone="red" icon={<XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}>{(dryError as Error).message}</Note>
            : dry && <DryRunSummary dry={dry} />
          )}

          <div className="flex justify-end">
            <button onClick={handleImport}
              disabled={importing || !accountId || !dry || dry.new === 0 || dry.in_closed_period > 0 || parsed.lines.length === 0}
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
              {importing ? 'Importing…' : dry ? `Import ${dry.new} new line${dry.new === 1 ? '' : 's'}` : 'Import'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function DryRunSummary({ dry }: { dry: DryRun }) {
  const joins = dry.gap_before == null
    ? (dry.previous_balance == null
        ? { tone: 'slate' as const, text: 'First statement for this account — nothing earlier to join to.' }
        : { tone: 'amber' as const, text: 'The first new line has no running balance, so the join to the last statement can\'t be checked.' })
    : Math.abs(dry.gap_before) < 0.01
      ? { tone: 'green' as const, text: `Opens exactly where the last imported line (${formatDate(dry.previous_date)}) closed: ${formatCurrency(dry.previous_balance ?? 0)}.` }
      : { tone: 'amber' as const, text: `Opens ${formatCurrency(Math.abs(dry.gap_before))} ${dry.gap_before > 0 ? 'above' : 'below'} where the last imported line (${formatDate(dry.previous_date)}) closed — a statement in between is probably missing.` }
  return (
    <div className="space-y-1.5">
      <Note tone={dry.new === 0 ? 'slate' : 'green'} icon={<CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />}>
        {dry.new === 0
          ? `All ${dry.total} lines are already imported — nothing to add.`
          : `${dry.new} new line${dry.new === 1 ? '' : 's'}${dry.first_new_date ? ` (${formatDate(dry.first_new_date)} → ${formatDate(dry.last_new_date)})` : ''}${dry.already_imported ? `; ${dry.already_imported} already imported and skipped` : ''}.`}
      </Note>
      {dry.new > 0 && <Note tone={joins.tone} icon={<Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />}>{joins.text}</Note>}
      {dry.gap_after != null && Math.abs(dry.gap_after) >= 0.01 && (
        <Note tone="amber" icon={<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}>
          The next statement already imported doesn't start where this one ends ({formatCurrency(Math.abs(dry.gap_after))} apart).
        </Note>
      )}
      {dry.in_closed_period > 0 && (
        <Note tone="red" icon={<XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}>
          {dry.in_closed_period} new line{dry.in_closed_period === 1 ? '' : 's'} fall in a period already closed for this account. An admin has to reopen it first.
        </Note>
      )}
    </div>
  )
}

function PreviewTable({ parsed }: { parsed: ParsedStatement }) {
  const shown = parsed.lines.length > 10 ? [...parsed.lines.slice(0, 7), null, ...parsed.lines.slice(-2)] : parsed.lines
  return (
    <div className="overflow-x-auto rounded-md border bg-white dark:border-slate-700 dark:bg-slate-800">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-left text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
          <tr><th className="px-3 py-1.5">Date</th><th className="px-3 py-1.5">Narration</th><th className="px-3 py-1.5">Reference</th>
            <th className="px-3 py-1.5 text-right">Out</th><th className="px-3 py-1.5 text-right">In</th><th className="px-3 py-1.5 text-right">Balance</th></tr>
        </thead>
        <tbody className="divide-y dark:divide-slate-700">
          {shown.map((l, i) => l === null ? (
            <tr key={`gap-${i}`}><td colSpan={6} className="px-3 py-1 text-center text-slate-400">… {parsed.lines.length - 9} more …</td></tr>
          ) : (
            <tr key={i}>
              <td className="whitespace-nowrap px-3 py-1.5 text-slate-600 dark:text-slate-300">{formatDate(l.valueDate)}</td>
              <td className="max-w-[260px] truncate px-3 py-1.5 text-slate-600 dark:text-slate-300">{l.narration ?? '—'}</td>
              <td className="px-3 py-1.5 font-mono text-[11px] text-slate-500">{l.reference ?? '—'}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-red-600 dark:text-red-400">{l.debit != null ? formatCurrency(l.debit) : ''}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{l.credit != null ? formatCurrency(l.credit) : ''}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-slate-700 dark:text-slate-200">{l.balance != null ? formatCurrency(l.balance) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Column mapping ──────────────────────────────────────────────────────
function columnChoices(read: ReadStatement, headerRow: number) {
  const header = read.grid[headerRow] ?? []
  const width = Math.max(...read.grid.slice(headerRow, headerRow + 30).map(r => r.length), header.length)
  return Array.from({ length: width }, (_, i) => {
    const sample = read.grid.slice(headerRow + 1, headerRow + 12).map(r => r[i]).find(v => v && v.trim())
    return { index: i, label: `${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ''}: ${header[i] || '(no header)'}${sample ? ` — e.g. ${sample.slice(0, 24)}` : ''}` }
  })
}

const FIELDS: { key: keyof ColumnMapping; label: string; hint?: string }[] = [
  { key: 'date', label: 'Date *', hint: 'The value / transaction date' },
  { key: 'narration', label: 'Narration', hint: 'Description or particulars' },
  { key: 'reference', label: 'Reference' },
  { key: 'debit', label: 'Money out (debit)' },
  { key: 'credit', label: 'Money in (credit)' },
  { key: 'amount', label: 'Or: one signed amount', hint: 'Negative = money out' },
  { key: 'drcr', label: 'DR / CR column', hint: 'With a single amount' },
  { key: 'balance', label: 'Running balance' },
  { key: 'type', label: 'Transaction type' },
  { key: 'postDate', label: 'Post date' },
]

function MappingEditor({ mapping, columns, rows, onChange }: {
  mapping: ColumnMapping
  columns: { index: number; label: string }[]
  rows: number
  onChange: (m: ColumnMapping) => void
}) {
  const val = (k: keyof ColumnMapping) => {
    const v = mapping[k]
    if (k === 'narration') return (v as number[])[0] ?? ''
    return v == null ? '' : String(v)
  }
  function set(k: keyof ColumnMapping, raw: string) {
    const n = raw === '' ? null : Number(raw)
    if (k === 'narration') onChange({ ...mapping, narration: n == null ? [] : [n, ...mapping.narration.slice(1).filter(x => x !== n)] })
    else if (k === 'date') onChange({ ...mapping, date: n ?? 0 })
    else onChange({ ...mapping, [k]: n })
  }
  return (
    <div className="space-y-2 rounded-md border bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="text-[11px] text-slate-500">Header row
          <input type="number" min={1} max={rows} value={mapping.headerRow + 1} className={selectCls}
            onChange={e => onChange({ ...mapping, headerRow: Math.max(0, Math.min(rows - 1, Number(e.target.value) - 1)) })} />
        </label>
        <label className="text-[11px] text-slate-500">Numeric dates are
          <select className={selectCls} value={mapping.dateOrder} onChange={e => onChange({ ...mapping, dateOrder: e.target.value as DateOrder })}>
            <option value="dmy">day / month / year</option>
            <option value="mdy">month / day / year</option>
            <option value="ymd">year / month / day</option>
          </select>
        </label>
        <label className="text-[11px] text-slate-500 sm:col-span-2">Second narration column
          <select className={selectCls} value={mapping.narration[1] ?? ''}
            onChange={e => onChange({ ...mapping, narration: e.target.value === '' ? mapping.narration.slice(0, 1) : [mapping.narration[0] ?? 0, Number(e.target.value)] })}>
            <option value="">—</option>
            {columns.map(c => <option key={c.index} value={c.index}>{c.label}</option>)}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {FIELDS.map(f => (
          <label key={f.key} className="text-[11px] text-slate-500" title={f.hint}>{f.label}
            <select className={selectCls} value={val(f.key)} onChange={e => set(f.key, e.target.value)}>
              {f.key !== 'date' && <option value="">—</option>}
              {columns.map(c => <option key={c.index} value={c.index}>{c.label}</option>)}
            </select>
          </label>
        ))}
      </div>
      <p className="text-[11px] text-slate-400">The layout is saved for this account when you import, so its next statement reads itself.</p>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">{value}</p>
    </div>
  )
}

const NOTE_TONES = {
  amber: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/10 dark:text-amber-300',
  red: 'border-red-200 bg-red-50 text-red-700 dark:border-red-800/40 dark:bg-red-900/10 dark:text-red-300',
  green: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-900/10 dark:text-emerald-300',
  slate: 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
}

function Note({ tone, icon, children }: { tone: keyof typeof NOTE_TONES; icon: React.ReactNode; children: React.ReactNode }) {
  return <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${NOTE_TONES[tone]}`}>{icon}<div>{children}</div></div>
}
