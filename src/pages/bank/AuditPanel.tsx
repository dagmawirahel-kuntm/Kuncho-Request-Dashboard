import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { btn } from '@/lib/ui/button'
import { Pill } from '@/components/record/Record'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { UndoMatch } from '@/components/cash/LineHistory'
import { autoMatchBankLines } from '@/lib/bankAutoMatch'
import { inRange, type ReconciledAs } from '@/lib/bankReconciliation'
import {
  FLAG_META, MATCH_KIND, SEVERITY_META, useBankAuditAccounts, useBankAuditFlags, useBankAuditScorecard,
  useBankAuditSettings, useBankChargeRules, useRefreshBankAudit,
} from '@/lib/bankAudit'
import type { BankAuditFlagKind, BankAuditFlagRow, BankAuditScoreRow, BankAuditSettings, BankFlagSeverity } from '@/types/database'
import {
  AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, FilePlus2, Landmark, Link2, Search, Settings2, Upload,
} from 'lucide-react'

// The bank audit (migrations 440–442). Payments are marked paid in the
// payment workflow, with the FT reference from the slip; the statement is the
// last proof. This tab shows, per account, how far the bank and the system
// agree; what doesn't (the flags, oldest and biggest first), each with the
// one action that clears it; and, per person who paid, how much of what they
// paid the statement confirms.

const inputCls = 'w-full rounded-md border px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'

export function AuditPanel({ accountId, accounts, canAct, isAdmin, from = '', to = '', onOpenLine, onImport }: {
  accountId: string | null
  accounts: { id: string; account_name: string }[]
  canAct: boolean
  isAdmin: boolean
  /** Flags dated between these, yyyy-mm-dd; blank for no limit. */
  from?: string
  to?: string
  /** Opens a statement line in the queue, to match or explain it. */
  onOpenLine: (lineId: string) => void
  onImport: (accountId: string) => void
}) {
  return (
    <div className="space-y-5">
      <AccountStrip accountId={accountId} onImport={onImport} />
      <FlagList accountId={accountId} from={from} to={to} canAct={canAct} onOpenLine={onOpenLine} />
      <Scorecard />
      <Rules accounts={accounts} canAct={canAct} isAdmin={isAdmin} />
    </div>
  )
}

// ── Per account: how far the bank and the system agree ─────────────────────
function AccountStrip({ accountId, onImport }: { accountId: string | null; onImport: (accountId: string) => void }) {
  const { data: rows = [], isLoading } = useBankAuditAccounts()
  const shown = rows.filter(r => !accountId || r.account_id === accountId)
  if (isLoading) return <p className="py-6 text-center text-sm text-slate-400">Reading the statements…</p>
  if (!shown.length) return <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-slate-400 dark:border-slate-700">No bank account has statements or bank payments yet.</p>
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {shown.map(a => {
        const checkedAll = a.statement_through && a.checked_through === a.statement_through
        return (
          <div key={a.account_id} className="rounded-xl border bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <div className="flex flex-wrap items-center gap-2">
              <Landmark className="h-4 w-4 text-slate-400" />
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{a.account_name}</h3>
              {a.flags > 0
                ? <Pill tone={a.red > 0 ? 'red' : a.amber > 0 ? 'amber' : 'slate'}>{a.flags} to look at</Pill>
                : a.statement_through ? <Pill tone="green">Agrees</Pill> : null}
              {a.statement_due && (
                <button onClick={() => onImport(a.account_id)} className={btn('warning', 'sm', 'ml-auto')}>
                  <Upload className="h-3 w-3" /> Import statement
                </button>
              )}
            </div>
            <dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
              <div>
                <dt className="text-slate-400">Statement runs to</dt>
                <dd className={`font-semibold ${a.statement_due ? 'text-amber-700 dark:text-amber-400' : 'text-slate-700 dark:text-slate-200'}`}>
                  {a.statement_through ? formatDate(a.statement_through) : 'None imported'}
                </dd>
                {a.statement_due && <dd className="text-[11px] text-amber-600 dark:text-amber-400">Due — one every {a.statement_every_days} days</dd>}
              </div>
              <div>
                <dt className="text-slate-400">Bank-checked through</dt>
                <dd className="font-semibold text-slate-700 dark:text-slate-200">
                  {a.checked_through ? formatDate(a.checked_through) : a.statement_through ? 'Not yet' : '—'}
                  {checkedAll && <CheckCircle2 className="ml-1 inline h-3.5 w-3.5 text-emerald-500" />}
                </dd>
                {a.oldest_flag && <dd className="text-[11px] text-slate-400">oldest flag {formatDate(a.oldest_flag)}</dd>}
              </div>
              <div>
                <dt className="text-slate-400">Closed through</dt>
                <dd className="font-semibold text-slate-700 dark:text-slate-200">{a.closed_through ? formatDate(a.closed_through) : 'Never'}</dd>
                <dd className="text-[11px] text-slate-400">a month closes once its flags are cleared</dd>
              </div>
            </dl>
            <AmountBar confirmed={Number(a.confirmed_amount)} unchecked={Number(a.unchecked_amount)} problem={Number(a.problem_amount)} />
          </div>
        )
      })}
    </div>
  )
}

/** Bank payments by what the statement says: confirmed, not checked yet, problems. */
function AmountBar({ confirmed, unchecked, problem }: { confirmed: number; unchecked: number; problem: number }) {
  const total = confirmed + unchecked + problem
  if (total <= 0) return null
  const pct = (n: number) => `${(n / total) * 100}%`
  return (
    <div className="mt-3 space-y-1">
      <div className="flex h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700" role="img"
        aria-label={`On the statement ${formatCurrency(confirmed)}, not checked yet ${formatCurrency(unchecked)}, problems ${formatCurrency(problem)}`}>
        <div className="bg-emerald-500" style={{ width: pct(confirmed) }} />
        <div className="bg-red-500" style={{ width: pct(problem) }} />
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500" />On the statement <b className="tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(confirmed)}</b></span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-slate-300 dark:bg-slate-500" />Not checked yet <b className="tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(unchecked)}</b></span>
        {problem > 0 && <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-red-500" />Problems <b className="tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(problem)}</b></span>}
      </div>
    </div>
  )
}

// ── What doesn't agree ──────────────────────────────────────────────────────
type KindFilter = 'all' | BankAuditFlagKind
type AgeFilter = 'all' | BankFlagSeverity

function FlagList({ accountId, from, to, canAct, onOpenLine }: {
  accountId: string | null; from: string; to: string; canAct: boolean; onOpenLine: (lineId: string) => void
}) {
  const { data: flags = [], isLoading } = useBankAuditFlags()
  const [kind, setKind] = useState<KindFilter>('all')
  const [age, setAge] = useState<AgeFilter>('all')
  const [bigOnly, setBigOnly] = useState(false)
  const [q, setQ] = useState('')

  const inAccount = useMemo(() => flags.filter(f => (!accountId || f.account_id === accountId) && inRange(f.ref_date, from, to)),
    [flags, accountId, from, to])
  const counts = useMemo(() => {
    const m = new Map<BankAuditFlagKind, number>()
    for (const f of inAccount) m.set(f.kind, (m.get(f.kind) ?? 0) + 1)
    return m
  }, [inAccount])
  const needle = q.trim().toLowerCase()
  const shown = useMemo(() => inAccount
    .filter(f => (kind === 'all' || f.kind === kind) && (age === 'all' || f.severity === age) && (!bigOnly || f.big)
      && (!needle || `${f.title} ${f.reference ?? ''} ${f.detail ?? ''} ${f.amount ?? ''}`.toLowerCase().includes(needle)))
    .sort((a, b) => SEVERITY_META[a.severity].rank - SEVERITY_META[b.severity].rank
      || Number(b.big) - Number(a.big) || Number(b.amount ?? 0) - Number(a.amount ?? 0)),
  [inAccount, kind, age, bigOnly, needle])
  const total = shown.reduce((s, f) => s + Number(f.amount ?? 0), 0)

  return (
    <section className="overflow-hidden rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800">
      <div className="space-y-2 border-b px-4 py-3 dark:border-slate-700">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">What doesn’t agree</h2>
          <span className="text-xs text-slate-500">{shown.length} · {formatCurrency(total)}</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {(['all', 'bank_not_recorded', 'money_in_no_sale', 'paid_not_in_bank', 'amount_mismatch', 'duplicate_ref'] as KindFilter[]).map(k => {
            const n = k === 'all' ? inAccount.length : counts.get(k) ?? 0
            if (k !== 'all' && n === 0) return null
            return (
              <button key={k} onClick={() => setKind(k)} title={k === 'all' ? undefined : FLAG_META[k].help}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${kind === k ? 'border-brand bg-brand/10 text-brand' : 'text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:text-slate-300'}`}>
                {k === 'all' ? 'All' : FLAG_META[k].label} <span className="tabular-nums opacity-70">{n}</span>
              </button>
            )
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={age} onChange={e => setAge(e.target.value as AgeFilter)}
            className="rounded-md border px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
            <option value="all">Any age</option>
            {(['red', 'amber', 'open', 'new'] as BankFlagSeverity[]).map(s => <option key={s} value={s}>{SEVERITY_META[s].label}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={bigOnly} onChange={e => setBigOnly(e.target.checked)} /> Big amounts only
          </label>
          <div className="relative ml-auto w-full sm:w-56">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Reference, narration or amount" className={`${inputCls} pl-7`} />
          </div>
        </div>
      </div>
      {isLoading ? <p className="py-10 text-center text-sm text-slate-400">Checking the statements against the payments…</p>
        : shown.length === 0 ? (
          <p className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" /> {inAccount.length ? 'Nothing matches these filters.' : 'The bank and the system agree.'}
          </p>
        ) : (
          <ul className="divide-y dark:divide-slate-700">
            {shown.map(f => <FlagRow key={f.flag_id} f={f} canAct={canAct} onOpenLine={onOpenLine} />)}
          </ul>
        )}
    </section>
  )
}

type Rel = Record<string, unknown>
const str = (v: unknown) => (v == null ? null : String(v))
const num = (v: unknown) => (v == null || v === '' ? null : Number(v))
// What the statement says about each payment sharing a reference.
const CHECK_WORDS: Record<string, string> = {
  confirmed: 'on the statement', problem: 'doesn’t agree', not_checked: 'statement not in yet', before_statements: 'before the statements',
}

function FlagRow({ f, canAct, onOpenLine }: { f: BankAuditFlagRow; canAct: boolean; onOpenLine: (lineId: string) => void }) {
  const { toast } = useToast()
  const refresh = useRefreshBankAudit()
  const [busy, setBusy] = useState<string | null>(null)
  const meta = FLAG_META[f.kind]
  const sev = SEVERITY_META[f.severity]
  const related = (f.related ?? []) as Rel[]

  async function match(lineId: string) {
    if (!f.record_kind || !f.record_id) return
    setBusy(lineId)
    const { error } = await supabase.rpc('apply_bank_line_match', { p_line_id: lineId, p_kind: MATCH_KIND[f.record_kind] ?? f.record_kind, p_target_id: f.record_id })
    setBusy(null)
    if (error) { toast(error.message, 'error'); return }
    toast('Matched — the statement confirms it', 'success')
    refresh()
  }

  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill tone={f.kind === 'bank_not_recorded' || f.kind === 'paid_not_in_bank' ? 'red' : f.kind === 'money_in_no_sale' ? 'blue' : 'amber'} title={meta.help}>{meta.short}</Pill>
            <Pill tone={sev.tone} title={sev.label}>{f.age_days == null ? '—' : `${f.age_days}d`}</Pill>
            {f.big && <Pill tone="violet" title="At or above the big amount — it goes to management too">Big</Pill>}
            {f.reference && <span className="font-mono text-[11px] text-slate-500">{f.reference}</span>}
          </div>
          <p className="mt-1 truncate text-sm font-medium text-slate-800 dark:text-slate-100" title={f.title}>{f.title}</p>
          {f.detail && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{f.detail}</p>}
          <p className="mt-0.5 text-[11px] text-slate-400">
            {[f.ref_date ? formatDate(f.ref_date) : null, f.account_name, f.payer_name ? `paid by ${f.payer_name}` : null].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-bold tabular-nums text-slate-800 dark:text-slate-100">{f.amount != null ? formatCurrency(Number(f.amount)) : '—'}</p>
          {f.kind === 'amount_mismatch' && f.expected != null && (
            <p className="text-[11px] tabular-nums text-slate-400">system {formatCurrency(Number(f.expected))}</p>
          )}
        </div>
      </div>

      {/* What it is about, by kind. */}
      {(f.kind === 'bank_not_recorded' || f.kind === 'money_in_no_sale') && related.length > 0 && (
        <div className="mt-2 rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:bg-sky-900/20 dark:text-sky-200">
          Already recorded with this reference, not paid yet:{' '}
          {related.map((r, i) => (
            <span key={i}>{i > 0 && ', '}
              <Link to={r.kind === 'sale' ? `/sales/${str(r.id)}` : `/expenses/${str(r.expense_id) ?? str(r.id)}`} className="font-medium underline-offset-2 hover:underline">
                {str(r.code) ?? 'record'}</Link> ({str(r.state)})
            </span>
          ))}. It links to this line once it is paid.
        </div>
      )}
      {f.kind === 'paid_not_in_bank' && (
        related.length > 0 ? (
          <div className="mt-2 space-y-1">
            <p className="text-[11px] font-medium text-slate-500">Open lines that look like it:</p>
            {related.map(r => {
              const lineId = str(r.line_id)!
              return (
                <div key={lineId} className="flex flex-wrap items-center gap-2 rounded-md border bg-slate-50 px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900/40">
                  <span className="w-28 shrink-0 text-slate-500">{formatDate(str(r.value_date))}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">{str(r.narration) ?? '—'} <span className="font-mono text-slate-400">{str(r.reference) ?? ''}</span></span>
                  <span className="tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(num(r.amount) ?? 0)}</span>
                  {canAct && (
                    <button onClick={() => match(lineId)} disabled={busy != null} className={btn('primary', 'sm')}>
                      <Link2 className="h-3 w-3" /> {busy === lineId ? 'Matching…' : 'Match'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-slate-500">No open line looks like it — check the account it was paid from, its reference, or whether it went at all.</p>
        )
      )}
      {f.kind === 'amount_mismatch' && related.length > 0 && (
        <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
          The line pays:{' '}
          {related.map((r, i) => {
            const kind = str(r.kind)
            const to = kind === 'batch' ? `/batch-payments/${str(r.id)}` : kind === 'vrf' ? `/vendor-receipts/${str(r.id)}` : `/expenses/${str(r.id)}`
            return <span key={i}>{i > 0 && ', '}<Link to={to} className="text-brand hover:underline">{str(r.label) ?? 'payment'}</Link> {formatCurrency(num(r.amount) ?? 0)}</span>
          })}
        </p>
      )}
      {f.kind === 'duplicate_ref' && related.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs">
          {related.map((r, i) => (
            <li key={i} className="flex items-center gap-2">
              <Link to={str(r.link) ?? '#'} className="text-brand hover:underline">{str(r.code) ?? str(r.kind)}</Link>
              <span className="tabular-nums text-slate-600 dark:text-slate-300">{formatCurrency(num(r.amount) ?? 0)}</span>
              <span className="text-slate-400">{CHECK_WORDS[str(r.state) ?? ''] ?? str(r.state)?.replace(/_/g, ' ')}</span>
            </li>
          ))}
        </ul>
      )}

      {/* The one action that clears it. */}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {/* Already recorded with its reference: paying it links the line, so no second record. */}
        {canAct && f.kind === 'bank_not_recorded' && f.line_id && related.length === 0 && (
          <Link to={`/expenses/new?bank_line=${f.line_id}`} className={btn('primary', 'sm')}><FilePlus2 className="h-3 w-3" /> Record the expense</Link>
        )}
        {canAct && f.kind === 'money_in_no_sale' && f.line_id && related.length === 0 && (
          <Link to={`/sales/new?bank_line=${f.line_id}`} className={btn('primary', 'sm')}><FilePlus2 className="h-3 w-3" /> Record the sale</Link>
        )}
        {(f.kind === 'bank_not_recorded' || f.kind === 'money_in_no_sale') && f.line_id && (
          <button onClick={() => onOpenLine(f.line_id!)} className={btn('secondary', 'sm')}>
            Match or explain <ArrowRight className="h-3 w-3" />
          </button>
        )}
        {f.kind !== 'bank_not_recorded' && f.kind !== 'money_in_no_sale' && f.link && (
          <Link to={f.link} className={btn('secondary', 'sm')}>Open <ExternalLink className="h-3 w-3" /></Link>
        )}
        {canAct && f.kind === 'amount_mismatch' && f.line_id && f.record_kind && (
          <span className="ml-auto">
            <UndoMatch line={{ line_id: f.line_id, reconciled_as: f.record_kind as ReconciledAs }} onDone={refresh} />
          </span>
        )}
      </div>
    </li>
  )
}

// ── Who pays, and how much of it the bank confirms ───────────────────────────
const WINDOWS = [30, 90, 180] as const
const isoDaysAgo = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function Scorecard() {
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(90)
  const from = isoDaysAgo(days)
  const to = isoDaysAgo(0)
  const { data: rows = [], isLoading } = useBankAuditScorecard(from, to)
  const all = rows.find(r => r.scope === 'all')
  const payers = rows.filter(r => r.scope === 'payer')
  const accounts = rows.filter(r => r.scope === 'account')
  // Paid before the first statement can't be checked; it doesn't count against anyone.
  const checkable = all ? Number(all.amount) - Number(all.before_amount) : 0
  const share = all && checkable > 0 ? Number(all.confirmed_amount) / checkable : null

  return (
    <section className="overflow-hidden rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3 dark:border-slate-700">
        <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Bank payments the statement confirms</h2>
        <div className="ml-auto flex rounded-md border p-0.5 text-xs dark:border-slate-600">
          {WINDOWS.map(w => (
            <button key={w} onClick={() => setDays(w)} className={`rounded px-2.5 py-1 font-medium ${days === w ? 'bg-brand text-white' : 'text-slate-500'}`}>Last {w} days</button>
          ))}
        </div>
      </div>
      {isLoading ? <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
        : !all ? <p className="py-8 text-center text-sm text-slate-400">No payments by bank in this window.</p>
        : (
          <div className="space-y-4 px-4 py-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Confirmed by value" value={share == null ? '—' : `${Math.round(share * 100)}%`} note={`${all.confirmed_count} of ${all.payments - all.before_count} payments`} tone={share != null && share < 0.8 ? 'amber' : 'green'} />
              <Stat label="Not checked yet" value={formatCurrency(Number(all.unchecked_amount))} note={`${all.unchecked_count} — no statement covers them yet`} />
              <Stat label="Problems" value={formatCurrency(Number(all.problem_amount))} note={`${all.problem_count} flagged above`} tone={all.problem_count > 0 ? 'red' : undefined} />
              <Stat label="Before the statements" value={formatCurrency(Number(all.before_amount))} note={`${all.before_count} paid before the first one`} />
            </div>
            <ScoreTable title="By who paid" rows={payers} />
            {accounts.length > 1 && <ScoreTable title="By account" rows={accounts} />}
          </div>
        )}
    </section>
  )
}

function Stat({ label, value, note, tone }: { label: string; value: string; note: string; tone?: 'green' | 'amber' | 'red' }) {
  const cls = tone === 'red' ? 'text-red-600 dark:text-red-400' : tone === 'amber' ? 'text-amber-600 dark:text-amber-400' : tone === 'green' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-800 dark:text-slate-100'
  return (
    <div className="rounded-lg border bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/40">
      <p className="text-[11px] text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${cls}`}>{value}</p>
      <p className="truncate text-[11px] text-slate-400" title={note}>{note}</p>
    </div>
  )
}

function ScoreTable({ title, rows }: { title: string; rows: BankAuditScoreRow[] }) {
  if (!rows.length) return null
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-xs">
          <thead>
            <tr className="text-left text-slate-400">
              <th className="py-1.5 pr-2 font-medium">Name</th>
              <th className="py-1.5 pr-2 text-right font-medium">Payments</th>
              <th className="py-1.5 pr-2 text-right font-medium">Confirmed</th>
              <th className="py-1.5 pr-2 text-right font-medium">Not checked yet</th>
              <th className="py-1.5 text-right font-medium" title="Payments the statement disagrees with — each is a flag above">Problems</th>
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-slate-700">
            {rows.map(r => {
              const checkable = Number(r.amount) - Number(r.before_amount)
              const share = checkable > 0 ? Math.round(Number(r.confirmed_amount) / checkable * 100) : null
              return (
                <tr key={`${r.scope}-${r.key ?? 'none'}`}>
                  <td className="py-1.5 pr-2 text-slate-700 dark:text-slate-200">{r.label}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{r.payments} · {formatCurrency(Number(r.amount))}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{share == null ? '—' : `${share}%`}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{r.unchecked_count ? formatCurrency(Number(r.unchecked_amount)) : '—'}</td>
                  <td className={`py-1.5 text-right tabular-nums ${r.problem_count ? 'font-semibold text-red-600 dark:text-red-400' : 'text-slate-400'}`}>
                    {r.problem_count ? `${r.problem_count} · ${formatCurrency(Number(r.problem_amount))}` : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── The bank's own charges, and how the audit reads ages and amounts ───────────
function Rules({ accounts, canAct, isAdmin }: { accounts: { id: string; account_name: string }[]; canAct: boolean; isAdmin: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="overflow-hidden rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800">
      <button onClick={() => setOpen(v => !v)} className="flex w-full items-center gap-2 px-4 py-3 text-left">
        {open ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
        <Settings2 className="h-4 w-4 text-slate-400" />
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Bank charges and audit settings</span>
      </button>
      {open && (
        <div className="grid gap-4 border-t px-4 py-3 lg:grid-cols-2 dark:border-slate-700">
          <ChargeRules accounts={accounts} canAct={canAct} />
          <SettingsForm isAdmin={isAdmin} />
        </div>
      )}
    </section>
  )
}

function ChargeRules({ accounts, canAct }: { accounts: { id: string; account_name: string }[]; canAct: boolean }) {
  const { toast } = useToast()
  const refresh = useRefreshBankAudit()
  const { data: rules = [] } = useBankChargeRules()
  const [amount, setAmount] = useState('')
  const [label, setLabel] = useState('')
  const [accountId, setAccountId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const accountName = new Map(accounts.map(a => [a.id, a.account_name]))

  async function add() {
    const amt = Number(amount)
    if (!(amt > 0) || !label.trim()) { toast('Give the charge an amount and a name', 'error'); return }
    setBusy(true)
    const { error } = await supabase.from('bank_charge_rules').insert([{ amount: amt, label: label.trim(), account_id: accountId }])
    if (error) { setBusy(false); toast(error.message, 'error'); return }
    // Lines this charge now explains have it booked on the next automatic pass; run it now.
    const n = (await autoMatchBankLines({ accountId }).catch(() => ({ matched: 0 }))).matched
    setBusy(false)
    setAmount(''); setLabel(''); setAccountId(null)
    toast(`Charge added${n ? ` — and ${n} more line${n === 1 ? '' : 's'} matched` : ''}`, 'success')
    refresh()
  }

  async function toggle(id: string, active: boolean) {
    const { error } = await supabase.from('bank_charge_rules').update({ is_active: active }).eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    refresh()
  }

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200">The bank’s charges inside a transfer</h3>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        A line that is more than what it pays by exactly one of these is explained: the charge is booked to bank charges and the line ties.
      </p>
      <ul className="divide-y rounded-md border text-xs dark:divide-slate-700 dark:border-slate-700">
        {rules.map(r => (
          <li key={r.id} className={`flex items-center gap-2 px-3 py-1.5 ${r.is_active ? '' : 'opacity-50'}`}>
            <span className="w-20 shrink-0 font-semibold tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(Number(r.amount))}</span>
            <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">{r.label}</span>
            <span className="text-[11px] text-slate-400">{r.account_id ? accountName.get(r.account_id) ?? 'One account' : 'Any account'}</span>
            {canAct && (
              <button onClick={() => toggle(r.id, !r.is_active)} className="text-[11px] font-medium text-brand hover:underline">
                {r.is_active ? 'Turn off' : 'Turn on'}
              </button>
            )}
          </li>
        ))}
        {rules.length === 0 && <li className="px-3 py-2 text-slate-400">No charges set.</li>}
      </ul>
      {canAct && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[6rem_1fr]">
          <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="Amount" className={inputCls} />
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Local transfer charge" className={inputCls} />
          <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
            <div className="min-w-[12rem] flex-1">
              <SearchableSelect value={accountId} onChange={setAccountId} options={accounts.map(a => ({ id: a.id, label: a.account_name }))} placeholder="Any account" />
            </div>
            <button onClick={add} disabled={busy} className={btn('primary', 'sm')}>{busy ? 'Adding…' : 'Add charge'}</button>
          </div>
        </div>
      )}
    </div>
  )
}

const SETTING_FIELDS: { key: keyof BankAuditSettings; label: string; unit: string }[] = [
  { key: 'new_within_days', label: 'A flag is new for', unit: 'days' },
  { key: 'amber_after_days', label: 'Amber after', unit: 'days' },
  { key: 'red_after_days', label: 'Red after', unit: 'days' },
  { key: 'big_amount', label: 'Big amount (goes to management)', unit: 'ETB' },
  { key: 'grace_days', label: 'Days a payment has to reach the bank', unit: 'days' },
  { key: 'tie_tolerance', label: 'Rounding allowed when amounts tie', unit: 'ETB' },
  { key: 'statement_every_days', label: 'Import a statement every', unit: 'days' },
]

function SettingsForm({ isAdmin }: { isAdmin: boolean }) {
  const { toast } = useToast()
  const refresh = useRefreshBankAudit()
  const { data: settings } = useBankAuditSettings()
  const [draft, setDraft] = useState<Partial<Record<keyof BankAuditSettings, string>>>({})
  const [busy, setBusy] = useState(false)
  if (!settings) return null
  const value = (k: keyof BankAuditSettings) => draft[k] ?? String(settings[k] ?? '')
  const dirty = Object.keys(draft).length > 0

  async function save() {
    const patch: Record<string, number> = {}
    for (const [k, v] of Object.entries(draft)) {
      const n = Number(v)
      if (!Number.isFinite(n) || n < 0) { toast('Every setting is a number, 0 or more', 'error'); return }
      patch[k] = n
    }
    setBusy(true)
    const { error } = await supabase.from('bank_audit_settings').update(patch).eq('id', true)
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    setDraft({}); toast('Audit settings saved', 'success'); refresh()
  }

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200">How the audit reads ages and amounts</h3>
      <div className="space-y-1.5">
        {SETTING_FIELDS.map(f => (
          <label key={f.key} className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <span className="min-w-0 flex-1">{f.label}</span>
            <input value={value(f.key)} disabled={!isAdmin} inputMode="decimal"
              onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
              className="w-24 rounded-md border px-2 py-1 text-right text-xs tabular-nums disabled:bg-slate-50 disabled:text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-900" />
            <span className="w-8 text-[11px] text-slate-400">{f.unit}</span>
          </label>
        ))}
      </div>
      {isAdmin ? (
        <div className="flex justify-end gap-2">
          {dirty && <button onClick={() => setDraft({})} className={btn('ghost', 'sm')}>Reset</button>}
          <button onClick={save} disabled={!dirty || busy} className={btn('primary', 'sm')}>{busy ? 'Saving…' : 'Save settings'}</button>
        </div>
      ) : (
        <p className="flex items-center gap-1 text-[11px] text-slate-400"><AlertTriangle className="h-3 w-3" /> An admin changes these.</p>
      )}
    </div>
  )
}
