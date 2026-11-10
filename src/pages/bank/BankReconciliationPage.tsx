import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import type { AccountOverview } from '@/lib/bankReconciliation'
import { PayeesPanel } from './PayeesPanel'
import { ImportStatementPanel } from './ImportStatementPanel'
import { ReviewQueue, type QueueView } from './ReviewQueue'
import { StatementsPanel } from './StatementsPanel'
import { AuditPanel } from './AuditPanel'
import { useBankAuditFlags } from '@/lib/bankAudit'
import { inRange } from '@/lib/bankReconciliation'
import { bankShortName, brandFor, brandVars, useAccountBrands } from '@/lib/bankBrands'
import { BankLookEditor, BankMark, BankStrip } from '@/components/bank/BankLook'
import { DateRangeButton } from '@/components/bank/DateRangeButton'
import { useFyFlag } from '@/lib/fiscalFlag'
import { noteWorkPlace } from '@/lib/returnTrail'
import { ArrowLeft, Upload } from 'lucide-react'

type Tab = 'queue' | 'audit' | 'payees' | 'import' | 'statements'
const TABS: Tab[] = ['queue', 'audit', 'payees', 'import', 'statements']

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
  const [params, setParams] = useSearchParams()
  const { role } = useAuth()
  const canAct = role === 'admin' || role === 'finance'
  const [tab, setTab] = useState<Tab | null>(() => {
    const t = params.get('tab') as Tab | null
    return t && TABS.includes(t) ? t : null
  })
  const [accountId, setAccountId] = useState<string | null>(() => params.get('account'))
  // The line the queue opens on: from a link (?line=), or a flag on the audit.
  const [focusLineId, setFocusLineId] = useState<string | null>(() => params.get('line'))
  // The line open in the queue now. Kept in the address with the account and
  // tab, so a link away and the way back (ReturnTrailBar) land on it again.
  const [openLine, setOpenLine] = useState<string | null>(() => params.get('line'))
  // The queue shows the reconciled lines (?done=1): where "Open on the
  // statement" from a locked expense lands, next to its "Undo match".
  const [showDone, setShowDone] = useState(() => params.get('done') === '1')
  // The lines (by value date) and the flags (by their date) between two days.
  const [from, setFrom] = useState(() => params.get('from') ?? '')
  const [to, setTo] = useState(() => params.get('to') ?? '')
  // The queue as a list, or one line at a time (?view=one).
  const [view, setView] = useState<QueueView>(() => (params.get('view') === 'one' ? 'one' : 'list'))
  const [editingLook, setEditingLook] = useState(false)
  const onOpenChange = useCallback((lineId: string | null, detail: string | null) => {
    setOpenLine(lineId)
    noteWorkPlace('/bank-statement-import', detail)
  }, [])
  // The address and the page follow each other. A link to this page while
  // it's open (a to-do, an alert, the browser's back) changes the address:
  // the page follows it. Opening a line or changing a filter changes the
  // page: the address follows it, in place. `written` is the address as last
  // agreed, so neither side undoes the other; the address is written only
  // when the page itself changes.
  const written = useRef<string | null>(null)
  const setParamsRef = useRef(setParams)
  useEffect(() => { setParamsRef.current = setParams }, [setParams])
  useEffect(() => {
    const cur = params.toString()
    if (cur === written.current) return
    const first = written.current === null
    written.current = cur
    if (first) return
    const t = params.get('tab') as Tab | null
    setTab(t && TABS.includes(t) ? t : null)
    setAccountId(params.get('account'))
    setFocusLineId(params.get('line'))
    setOpenLine(params.get('line'))
    setShowDone(params.get('done') === '1')
    setFrom(params.get('from') ?? '')
    setTo(params.get('to') ?? '')
    setView(params.get('view') === 'one' ? 'one' : 'list')
  }, [params])
  useEffect(() => {
    const next = new URLSearchParams()
    const t = tab ?? (openLine ? 'queue' : null)
    if (t) next.set('tab', t)
    if (accountId) next.set('account', accountId)
    if (openLine && (t ?? 'queue') === 'queue') next.set('line', openLine)
    if (showDone && (t ?? 'queue') === 'queue') next.set('done', '1')
    if (from) next.set('from', from)
    if (to) next.set('to', to)
    if (view === 'one' && (t ?? 'queue') === 'queue') next.set('view', 'one')
    const s = next.toString()
    if (s === written.current) return
    written.current = s
    setParamsRef.current(next, { replace: true })
  }, [tab, accountId, openLine, showDone, from, to, view])
  const { data: flags = [] } = useBankAuditFlags()
  // Each bank's look: its colours and logo (bankBrands.ts).
  const { data: brandRows } = useAccountBrands()
  const brandOf = (id: string, name: string) => brandFor(brandRows?.get(id) ?? { account_name: name })
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

  // Lines dated outside the fiscal year being worked in, per account: a
  // statement reaching back into last year is flagged, not silently counted.
  const fyFlag = useFyFlag()
  const { data: otherFy = new Map<string, { n: number; open: number; years: Set<string> }>() } = useQuery({
    queryKey: ['bank-lines', 'other-fy', fyFlag.fy?.start_date, fyFlag.fy?.end_date],
    enabled: !!fyFlag.fy,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_bank_line_status').select('account_id, value_date, reconciled_as')
        .or(`value_date.lt.${fyFlag.fy!.start_date},value_date.gt.${fyFlag.fy!.end_date}`)
      if (error) throw error
      const m = new Map<string, { n: number; open: number; years: Set<string> }>()
      for (const l of (data ?? []) as { account_id: string; value_date: string; reconciled_as: string | null }[]) {
        const v = m.get(l.account_id) ?? { n: 0, open: 0, years: new Set<string>() }
        v.n++; if (!l.reconciled_as) v.open++
        v.years.add(fyFlag.fyOf(l.value_date))
        m.set(l.account_id, v)
      }
      return m
    },
  })
  const otherFyNote = (a: AccountOverview) => {
    const o = otherFy.get(a.account_id)
    if (!o || !fyFlag.fy) return null
    const years = [...o.years].sort().join(', ')
    return o.n >= a.line_count
      ? `Every line is from ${years}, not ${fyFlag.fy.label}${o.open ? ` · ${o.open} still open` : ''}`
      : `${o.n} of ${a.line_count} lines are from ${years}${o.open ? ` · ${o.open} still open` : ''}`
  }
  // Open lines in the fiscal year being worked in, and those from other
  // years: those are set aside in the queue, so the counts here match it.
  const otherOpen = (id: string) => otherFy.get(id)?.open ?? 0
  const thisYearOpen = (a: AccountOverview) => Math.max(0, a.open_count - otherOpen(a.account_id))
  const inScope = withLines.filter(a => !accountId || a.account_id === accountId)
  const openNow = inScope.reduce((s, a) => s + thisYearOpen(a), 0)
  const openOther = inScope.reduce((s, a) => s + Math.min(a.open_count, otherOpen(a.account_id)), 0)
  // The year just before, said as "last year"; any other as its label.
  const lastFy = fyFlag.fy ? fyFlag.fyOf(new Date(new Date(`${fyFlag.fy.start_date}T00:00:00`).getTime() - 864e5).toISOString().slice(0, 10)) : null
  const otherYearsOf = (id: string) => [...(otherFy.get(id)?.years ?? [])]
  const otherWord = (id: string) => { const ys = otherYearsOf(id); return ys.length === 1 && ys[0] === lastFy ? 'last year' : ys.length === 1 ? ys[0] : 'other years' }
  // Kept the same between renders: the queue names lines from it.
  const accounts = useMemo(() => overview.map(a => ({ id: a.account_id, account_name: a.account_name })), [overview])
  // Statements & close work on one account: the chosen one, or the busiest.
  const statementAccount = withLines.find(a => a.account_id === accountId) ?? withLines[0] ?? null
  const activeTab: Tab = tab ?? (!isLoading && withLines.length === 0 ? 'import' : 'queue')
  const selected = overview.find(a => a.account_id === accountId) ?? null
  const selectedBrand = selected ? brandOf(selected.account_id, selected.account_name) : null
  const latest = withLines.reduce<string | null>((m, a) => (a.last_date && (!m || a.last_date > m) ? a.last_date : m), null)
  const closedCount = withLines.filter(a => a.closed_through).length
  const shortDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  // Banks by what's left this year, then by what's left at all.
  const pills = [...withLines].sort((a, b) => thisYearOpen(b) - thisYearOpen(a) || b.open_count - a.open_count)

  const tabs: { id: Tab; label: string; n?: number }[] = [
    { id: 'queue', label: 'To reconcile', n: openNow || undefined },
    { id: 'audit', label: 'Audit', n: flagCount || undefined },
    { id: 'payees', label: 'Payees' },
    { id: 'statements', label: 'Statements & closing' },
  ]
  const pill = (on: boolean) => `inline-flex shrink-0 snap-start items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${on
    ? 'border-brand bg-brand/5 text-slate-800 ring-1 ring-brand dark:text-slate-100'
    : 'bg-white text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-500'}`

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Bank Reconciliation</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Match each statement line to what it paid or brought in, then close the period at the bank's balance.</p>
        </div>
        {activeTab !== 'import' && (
          <button onClick={() => setTab('import')}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">
            <Upload className="h-3.5 w-3.5" /> Import a statement
          </button>
        )}
      </div>

      {withLines.length > 0 && activeTab !== 'import' && (
        <>
          {/* One row of banks, to swipe through on a phone; the count is what's
              left this fiscal year, with older lines said apart. */}
          <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0 sm:pb-0">
            <button onClick={() => setAccountId(null)} className={pill(!accountId)}>
              All banks
              {withLines.some(a => thisYearOpen(a) > 0)
                ? <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">{withLines.reduce((s, a) => s + thisYearOpen(a), 0)}</span>
                : <span className="rounded-full bg-emerald-100 px-1.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">✓</span>}
            </button>
            {pills.map(a => {
              const on = accountId === a.account_id
              const brand = brandOf(a.account_id, a.account_name)
              const n = thisYearOpen(a)
              const older = Math.min(a.open_count, otherOpen(a.account_id))
              return (
                <button key={a.account_id} onClick={() => setAccountId(on ? null : a.account_id)} style={brandVars(brand)} title={brand.bank}
                  className={`bank-theme ${pill(on)}`}>
                  <BankMark brand={brand} size="xs" />
                  {bankShortName(brand, a.account_name)}
                  {n > 0
                    ? <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">{n}</span>
                    : older > 0
                      ? <span className="text-[10px] font-normal text-slate-400">{older} {otherWord(a.account_id)}</span>
                      : <span className="rounded-full bg-emerald-100 px-1.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">✓</span>}
                </button>
              )
            })}
          </div>

          {selected && selectedBrand ? (
            <BankStrip brand={selectedBrand} account={brandRows?.get(selected.account_id)} overview={selected}
              canEdit={canAct && !!brandRows?.get(selected.account_id)} onEdit={() => setEditingLook(true)} fyNote={otherFyNote(selected)} />
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              <b className="font-semibold text-slate-700 dark:text-slate-200">{openNow ? `${openNow} line${openNow === 1 ? '' : 's'} to reconcile` : 'Nothing to reconcile'}</b>
              {fyFlag.fy ? ` in ${fyFlag.fy.label}` : ''}
              {openOther > 0 && ` · ${openOther} more from ${lastFy && withLines.every(a => otherYearsOf(a.account_id).every(y => y === lastFy)) ? lastFy : 'other years'}, set aside`}
              {latest && ` · statements up to ${shortDay(latest)}`}
              {` · ${closedCount ? `${closedCount} of ${withLines.length} closed` : 'none closed yet'}`}
            </p>
          )}
        </>
      )}

      <div className={`space-y-4 ${selectedBrand ? 'bank-theme' : ''}`} style={selectedBrand ? brandVars(selectedBrand) : undefined}>
      {activeTab === 'import' ? (
        <button onClick={() => setTab('queue')} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand">
          <ArrowLeft className="h-4 w-4" /> Back to reconciling
        </button>
      ) : (
        <div className="flex gap-1 overflow-x-auto border-b dark:border-slate-700">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${activeTab === t.id ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
              {t.label}
              {t.n != null && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">{t.n}</span>}
            </button>
          ))}
        </div>
      )}

      {activeTab === 'queue' && <ReviewQueue key={focusLineId ?? 'queue'} accountId={accountId} accounts={accounts} focusLineId={focusLineId} from={from} to={to}
        onDatesChange={(f, t) => { setFrom(f); setTo(t) }} view={view} onViewChange={setView}
        showDone={showDone} onShowDoneChange={setShowDone}
        onOpenChange={onOpenChange} />}
      {activeTab === 'audit' && (
        <>
          <DateRangeButton from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t) }} />
          <AuditPanel accountId={accountId} accounts={accounts} canAct={canAct} isAdmin={role === 'admin'} from={from} to={to}
            onOpenLine={lineId => { setFocusLineId(lineId); setTab('queue') }}
            onImport={acct => { setAccountId(acct); setTab('import') }} />
        </>
      )}
      {activeTab === 'payees' && <PayeesPanel accountId={accountId} />}
      {activeTab === 'import' && (
        <ImportStatementPanel onImported={acct => { setAccountId(acct); setTab('queue') }} />
      )}
      {activeTab === 'statements' && (
        statementAccount
          ? <StatementsPanel key={statementAccount.account_id} account={statementAccount} />
          : <p className="py-10 text-center text-sm text-slate-400">No statements imported yet.</p>
      )}
      </div>
      {editingLook && selected && brandRows?.get(selected.account_id) && (
        <BankLookEditor account={brandRows.get(selected.account_id)!} onClose={() => setEditingLook(false)} />
      )}
    </div>
  )
}
