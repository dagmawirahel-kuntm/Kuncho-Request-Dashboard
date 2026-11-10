import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { autoMatchBankLines, type MatchRound } from '@/lib/bankAutoMatch'
import { readStatementFile, type ReadStatement } from '@/lib/bankStatements/readers'
import { BANK_PROFILES, sameAccountNumber, statementChecks } from '@/lib/bankStatements/profiles'
import { brandFor, brandForProfile, brandVars, useAccountBrands } from '@/lib/bankBrands'
import { BankMark } from '@/components/bank/BankLook'
import { useFyFlag, type FyFlag } from '@/lib/fiscalFlag'
import { DateHeading, DirectionTag, SignedAmount } from '@/components/bank/StatementBits'
import {
  applyMapping, detectMapping, headerSignature,
  type ColumnMapping, type DateOrder, type ParsedStatement,
} from '@/lib/bankStatements/grid'
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Info, Settings2, Upload, XCircle } from 'lucide-react'

interface AccountOpt { id: string; account_name: string; account_number: string | null; status: string | null; has_lines: boolean }

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
  matching?: MatchRound | null
}

const selectCls = 'w-full rounded-md border px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'

function toRpcLines(p: ParsedStatement) {
  return p.lines.map(l => ({
    value_date: l.valueDate, post_date: l.postDate, transaction_type: l.transactionType, narration: l.narration,
    debit: l.debit, credit: l.credit, balance: l.balance, reference: l.reference,
    counterparty_name: l.counterpartyName ?? null, counterparty_account: l.counterpartyAccount ?? null,
  }))
}

export function ImportStatementPanel({ onImported }: { onImported: (accountId: string) => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: brandRows } = useAccountBrands()
  const fyFlag = useFyFlag()
  const [accountId, setAccountId] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [read, setRead] = useState<ReadStatement | null>(null)
  // Columns finance set by hand; otherwise the saved layout or the detected one.
  const [manual, setManual] = useState<ColumnMapping | null>(null)
  const [showMapping, setShowMapping] = useState(false)
  const [reading, setReading] = useState(false)
  const [importing, setImporting] = useState(false)
  // Lines tried so far while matching after the import, out of the new ones.
  const [matching, setMatching] = useState<{ tried: number; of: number } | null>(null)

  // Accounts in use first; "inactive" accounts that were never opened last.
  const { data: accounts = [] } = useQuery({
    queryKey: ['bank-import-accounts'],
    queryFn: async () => {
      const [{ data: a, error }, { data: ov }] = await Promise.all([
        supabase.from('accounts').select('id, account_name, account_number, status').order('account_name'),
        supabase.from('v_bank_account_overview').select('account_id, line_count'),
      ])
      if (error) throw error
      const used = new Set(((ov ?? []) as { account_id: string; line_count: number }[]).filter(o => o.line_count > 0).map(o => o.account_id))
      return ((a ?? []) as { id: string; account_name: string; account_number: string | null; status: string | null }[])
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
  // A bank with a profile brings its own columns; otherwise the saved layout or the detected one.
  const mapping = useMemo<ColumnMapping | null>(() => (read
    ? manual ?? read.bank?.mapping ?? saved?.mapping ?? detected ?? { headerRow: read.pdfHeaderRow ?? 0, date: 0, narration: [1], dateOrder: 'dmy' }
    : null), [read, manual, saved, detected])
  const mappingSource = manual ? 'manual' : read?.bank ? 'bank' : saved ? 'saved' : detected ? 'detected' : 'none'
  const mappingOpen = showMapping || mappingSource === 'none'

  async function handleFile(file: File) {
    setFileName(file.name); setRead(null); setManual(null); setShowMapping(false); setReading(true)
    try {
      const r = await readStatementFile(file)
      if (r.grid.length === 0) throw new Error('No rows could be read from this file')
      setRead(r)
      if (r.format !== 'csv' && !r.bank) setShowMapping(true)
      // The statement names its account: pick it.
      const mine = r.bank?.accountNumber ? accounts.filter(a => sameAccountNumber(a.account_number, r.bank!.accountNumber)) : []
      if (mine.length === 1) setAccountId(mine[0].id)
    } catch (e) {
      toast((e as Error).message, 'error')
      setFileName(null)
    } finally {
      setReading(false)
    }
  }

  const parsed = useMemo(() => (read && mapping ? applyMapping(read.grid, mapping) : null), [read, mapping])
  const rpcLines = useMemo(() => (parsed ? toRpcLines(parsed) : []), [parsed])
  // The file names who each line paid or came from (CBE's BeneficiaryName/SenderName).
  const withNames = useMemo(() => !!parsed?.lines.some(l => l.counterpartyName || l.counterpartyAccount), [parsed])

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
    // A file with nothing new can still name who each line paid (506).
    const { data, error } = dry?.new === 0 ? { data: dry, error: null } : await supabase.rpc('import_bank_statement', {
      p_account_id: accountId, p_file_name: fileName, p_source_format: read.format,
      p_starting_balance: parsed.startingBalance, p_ending_balance: parsed.endingBalance,
      p_lines: rpcLines, p_dry_run: false,
    })
    if (error) { setImporting(false); toast(error.message, 'error'); return }
    // Remember a layout that had to be detected or mapped, for this bank's next file.
    if (mappingSource !== 'saved' && mappingSource !== 'bank') {
      await supabase.from('bank_statement_formats').upsert([{
        account_id: accountId, source_format: read.format,
        header_signature: headerSignature(read.grid, mapping.headerRow), mapping, updated_at: new Date().toISOString(),
      }], { onConflict: 'account_id,source_format,header_signature' })
    }
    const r = data as DryRun
    // The lines are saved. Matching them carries on in rounds where the
    // import's own round stopped, each short enough for the request limit.
    let auto = r.auto_reconciled ?? 0
    let matchError: string | null = null
    if (r.import_id && r.matching?.more) {
      const paired = auto - r.matching.matched
      setMatching({ tried: r.matching.tried, of: r.new - paired })
      try {
        const m = await autoMatchBankLines({ importId: r.import_id, from: r.matching, onProgress: p => setMatching(s => s && { ...s, tried: p.tried }) })
        auto = paired + m.matched
      } catch (e) {
        matchError = (e as Error).message
      }
      setMatching(null)
    }
    // Who each line paid or came from, on the new lines and those already in.
    // With names, more lines match: the account gets another pass.
    let named = 0
    if (withNames) {
      const { data: n, error: nameError } = await supabase.rpc('bank_lines_add_names', { p_account_id: accountId, p_lines: rpcLines })
      if (nameError) matchError = matchError ?? nameError.message
      named = Number(n ?? 0)
      if (named > 0 && !matchError) {
        setMatching({ tried: 0, of: 0 })
        try {
          const m = await autoMatchBankLines({ accountId, onProgress: p => setMatching(s => s && { ...s, tried: p.tried }) })
          auto += m.matched
        } catch (e) {
          matchError = (e as Error).message
        }
        setMatching(null)
      }
    }
    setImporting(false)
    const imported = `Imported ${r.new} line${r.new === 1 ? '' : 's'}${r.already_imported ? ` (${r.already_imported} already in)` : ''}`
    const names = named ? `; who was paid added to ${named} line${named === 1 ? '' : 's'}` : ''
    if (matchError) toast(`${r.new ? imported : 'Nothing new'}${names}. Automatic matching stopped part-way (${matchError}) — press Match automatically on the queue to finish it.`, 'info')
    else if (r.new === 0) toast(named ? `Nothing new${names}; ${auto} matched automatically` : 'Nothing new — every line in this file was already imported', 'success')
    else toast(`${imported}${names}; ${auto} matched automatically`, 'success')
    for (const k of ['bank-lines', 'bank-overview', 'bank-imports', 'bank-statement-formats', 'bank-import-accounts', 'expenses', 'sales', 'accounts']) {
      qc.invalidateQueries({ queryKey: [k] })
    }
    const acct = accountId
    setRead(null); setManual(null); setFileName(null)
    onImported(acct)
  }

  const checks = parsed && read?.bank && mappingSource === 'bank' ? statementChecks(parsed, read.bank) : null
  const chosen = accounts.find(a => a.id === accountId)
  const wrongAccount = !!(read?.bank?.accountNumber && chosen?.account_number && !sameAccountNumber(chosen.account_number, read.bank.accountNumber))
  // The statement in its bank's look: the account's own (if it's this account), else the bank's.
  const chosenBrand = chosen ? brandRows?.get(chosen.id) : undefined
  const look = read?.bank && mappingSource === 'bank'
    ? (chosenBrand && !wrongAccount ? brandFor(chosenBrand) : brandForProfile(read.bank.profileId, read.bank.bank))
    : chosenBrand ? brandFor(chosenBrand) : null
  // Lines dated in another fiscal year: imported all the same, but said plainly.
  const otherFy = parsed?.lines.filter(l => fyFlag.outside(l.valueDate)) ?? []
  const otherYears = [...new Set(otherFy.map(l => fyFlag.fyOf(l.valueDate)))].sort()
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
          <p className="mt-1 text-[11px] text-slate-400">
            CBE's internet-banking CSV reads itself, and so do PDF statements from {BANK_PROFILES.map(b => b.short).join(', ')}.
            Another bank's file is mapped once, then remembered for that account.
          </p>
        </div>
      </div>

      {read && mapping && parsed && (
        <div className={`space-y-3 overflow-hidden rounded-lg border bg-slate-50 p-3 text-sm dark:border-slate-600 dark:bg-slate-900/40 ${look ? 'bank-theme' : ''}`}
          style={look ? brandVars(look) : undefined}>
          {look && (
            <div className="-mx-3 -mt-3">
              <div className="bank-banner flex flex-wrap items-center gap-2.5 px-3 py-2.5">
                <BankMark brand={look} size="sm" />
                <span className="font-bold">{look.bank}</span>
                <span className="text-xs opacity-80">
                  statement{read.bank?.accountNumber ? ` · account ${read.bank.accountNumber}` : ''}
                  {read.bank?.periodFrom && read.bank.periodTo ? ` · ${formatDate(read.bank.periodFrom)} → ${formatDate(read.bank.periodTo)}` : ''}
                </span>
              </div>
              <div className="bank-banner-stripe h-1" />
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <FileSpreadsheet className="h-3.5 w-3.5" />
              {read.format.toUpperCase()} · {mappingSource === 'bank' ? `read as a ${read.bank!.bank} statement${read.bank!.accountNumber ? ` for account ${read.bank!.accountNumber}` : ''}`
                : `columns ${mappingSource === 'saved' ? 'from the layout saved for this account' : mappingSource === 'detected' ? 'recognised from the header' : mappingSource === 'manual' ? 'as you set them' : 'not recognised — map them below'}`}
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
            <div>
              <p className="text-[11px] text-slate-400">DR (out) / CR (in)</p>
              <p className="text-xs font-semibold"><SignedAmount direction="debit" amount={moneyOut} /> / <SignedAmount direction="credit" amount={moneyIn} /></p>
            </div>
            <Stat label="Closing" value={parsed.endingBalance != null ? formatCurrency(parsed.endingBalance) : '—'} />
          </div>

          {wrongAccount && (
            <Note tone="red" icon={<XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}>
              This statement is for account {read.bank!.accountNumber}, but {chosen!.account_name} is {chosen!.account_number}. Check the account before importing.
            </Note>
          )}
          {checks && checks.problems.length > 0 && (
            <Note tone="red" icon={<XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}>
              <p className="font-medium">The lines read don't match the bank's own figures — a line was missed or misread. Don't import this file; send it to whoever maintains the app.</p>
              <ul className="mt-1 list-inside list-disc">{checks.problems.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </Note>
          )}
          {checks && checks.problems.length === 0 && checks.agreed.length > 0 && (
            <Note tone="green" icon={<CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />}>
              Matches the bank's own figures: {checks.agreed.join(', ')}.
            </Note>
          )}
          {otherFy.length > 0 && fyFlag.fy && (
            <Note tone="amber" icon={<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}>
              <p className="font-medium">
                {otherFy.length === parsed.lines.length ? 'Every line is' : `${otherFy.length} of the ${parsed.lines.length} lines ${otherFy.length === 1 ? 'is' : 'are'}`} dated in {otherYears.join(' and ')}, not {fyFlag.fy.label}
                {' '}({formatDate(otherFy[0].valueDate)} → {formatDate(otherFy[otherFy.length - 1].valueDate)}).
              </p>
              <p className="mt-0.5">They import all the same, but they belong to {otherYears.length === 1 ? "that year's" : "those years'"} books: reconcile and close them there, not in {fyFlag.fy.label}.</p>
            </Note>
          )}
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

          {parsed.lines.length > 0 && <PreviewTable parsed={parsed} flag={fyFlag} />}

          {accountId && parsed.lines.length > 0 && (
            checking ? <p className="text-xs text-slate-400">Checking against what's already imported…</p>
            : dryError ? <Note tone="red" icon={<XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}>{(dryError as Error).message}</Note>
            : dry && <DryRunSummary dry={dry} withNames={withNames} />
          )}

          <div className="flex justify-end">
            <button onClick={handleImport}
              disabled={importing || !accountId || !dry || (dry.new === 0 && !withNames) || dry.in_closed_period > 0 || parsed.lines.length === 0 || wrongAccount || (checks?.problems.length ?? 0) > 0}
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
              {matching ? (matching.of ? `Matching… ${Math.min(matching.tried, matching.of)} of ${matching.of}` : `Matching… ${matching.tried} checked`)
                : importing ? 'Importing…'
                : !dry ? 'Import'
                : dry.new === 0 ? 'Add who was paid to the lines already in'
                : `Import ${dry.new} new line${dry.new === 1 ? '' : 's'}${withNames ? ' with who was paid' : ''}`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function DryRunSummary({ dry, withNames }: { dry: DryRun; withNames: boolean }) {
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
          ? (withNames
            ? `All ${dry.total} lines are already imported. This file names who each one paid or came from: that can be added to them.`
            : `All ${dry.total} lines are already imported — nothing to add.`)
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

function PreviewTable({ parsed, flag }: { parsed: ParsedStatement; flag: FyFlag }) {
  const shown = parsed.lines.length > 10 ? [...parsed.lines.slice(0, 7), null, ...parsed.lines.slice(-2)] : parsed.lines
  // Each day's totals over the whole statement, for its heading.
  const days = new Map<string, { out: number; inn: number; n: number }>()
  for (const l of parsed.lines) {
    const d = days.get(l.valueDate) ?? { out: 0, inn: 0, n: 0 }
    days.set(l.valueDate, { out: d.out + (l.debit ?? 0), inn: d.inn + (l.credit ?? 0), n: d.n + 1 })
  }
  const rows: React.ReactNode[] = []
  let lastDate: string | null = null
  shown.forEach((l, i) => {
    if (l === null) {
      rows.push(<tr key={`gap-${i}`}><td colSpan={6} className="px-3 py-1 text-center text-slate-400">… {parsed.lines.length - 9} more …</td></tr>)
      lastDate = null
      return
    }
    if (l.valueDate !== lastDate) {
      const d = days.get(l.valueDate)!
      rows.push(<tr key={`d-${i}`}><td colSpan={6} className="p-0"><DateHeading date={l.valueDate} out={d.out} inn={d.inn} count={d.n} flag={flag} compact /></td></tr>)
      lastDate = l.valueDate
    }
    rows.push(
      <tr key={i}>
        <td className="px-3 py-1.5">{(l.debit ?? 0) > 0 ? <DirectionTag direction="debit" size="xs" /> : <DirectionTag direction="credit" size="xs" />}</td>
        <td className="max-w-[260px] truncate px-3 py-1.5 text-slate-600 dark:text-slate-300">
          {l.counterpartyName ? <><span className="font-medium text-slate-800 dark:text-slate-100">{l.counterpartyName}</span>{l.narration ? ` · ${l.narration}` : ''}</> : l.narration ?? '—'}
        </td>
        <td className="px-3 py-1.5 font-mono text-[11px] text-slate-500">{l.reference ?? '—'}</td>
        <td className="px-3 py-1.5 text-right">{l.debit != null ? <SignedAmount direction="debit" amount={l.debit} /> : ''}</td>
        <td className="px-3 py-1.5 text-right">{l.credit != null ? <SignedAmount direction="credit" amount={l.credit} /> : ''}</td>
        <td className="px-3 py-1.5 text-right tabular-nums text-slate-700 dark:text-slate-200">{l.balance != null ? formatCurrency(l.balance) : '—'}</td>
      </tr>,
    )
  })
  return (
    <div className="overflow-x-auto rounded-md border bg-white dark:border-slate-700 dark:bg-slate-800">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-left text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
          <tr><th className="px-3 py-1.5"><span className="sr-only">DR or CR</span></th><th className="px-3 py-1.5">Narration</th><th className="px-3 py-1.5">Reference</th>
            <th className="px-3 py-1.5 text-right">DR · Money out</th><th className="px-3 py-1.5 text-right">CR · Money in</th><th className="px-3 py-1.5 text-right">Balance</th></tr>
        </thead>
        <tbody className="divide-y dark:divide-slate-700">{rows}</tbody>
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
  { key: 'debit', label: 'DR · Money out (debit)' },
  { key: 'credit', label: 'CR · Money in (credit)' },
  { key: 'amount', label: 'Or: one signed amount', hint: 'Negative = money out' },
  { key: 'drcr', label: 'DR / CR column', hint: 'With a single amount' },
  { key: 'balance', label: 'Running balance' },
  { key: 'type', label: 'Transaction type' },
  { key: 'postDate', label: 'Post date' },
  { key: 'payee', label: 'Paid to (name)', hint: 'Who money out went to: beneficiary' },
  { key: 'payeeAccount', label: 'Paid to (account)', hint: "The beneficiary's account number" },
  { key: 'payer', label: 'Paid by (name)', hint: 'Who money in came from: sender' },
  { key: 'payerAccount', label: 'Paid by (account)', hint: "The sender's account number" },
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
