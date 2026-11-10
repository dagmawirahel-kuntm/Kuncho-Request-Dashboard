import { brandFor, useAccountBrands, type BankBrand } from '@/lib/bankBrands'
import { BankChip, BankMark } from '@/components/bank/BankLook'
import { DateRangeButton } from '@/components/bank/DateRangeButton'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useFyFlag } from '@/lib/fiscalFlag'
import { DateHeading, DirectionTag, SignedAmount } from '@/components/bank/StatementBits'
import { groupByDay } from '@/lib/statementDates'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { autoMatchBankLines } from '@/lib/bankAutoMatch'
import {
  CLASSIFICATIONS, KIND_LABEL, describeReconciled, isClearingParty, lineSubtitle, lineTitle, ruleTextFrom,
  PARTY_LABEL, PARTY_PATH, ownerHowLabel,
  type BankLine, type LineCombination, type Suggestion,
} from '@/lib/bankReconciliation'
import { LinkPayee } from '@/components/bank/LinkPayee'
import { useLineParty } from '@/hooks/useLineParty'
import { LineHistory, UndoMatch } from '@/components/cash/LineHistory'
import { SeveralPayments } from './SeveralPayments'
import { PayrollLine } from './PayrollLine'
import { PayerSelect, RecordExpenseFromLine, RecordSaleFromLine } from './RecordFromLine'
import { useAccountPayer } from '@/lib/bankPayers'
import {
  ArrowLeft, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, Coins, ExternalLink, History, Link2, RefreshCw,
  Repeat, Search, SkipForward, Sparkles, AlertTriangle, Layers, FilePlus2, UserCheck, Users, Wand2,
} from 'lucide-react'

/** The queue as a list (with the open line beside it on a wide screen), or one line at a time. */
export type QueueView = 'list' | 'one'

const inputCls = 'w-full rounded-md border px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  for (const k of ['bank-lines', 'bank-overview', 'bank-suggestions', 'bank-paid-without-line', 'bank-rules', 'bank-line-events', 'bank-alerts',
    'account-control', 'expenses', 'sales', 'accounts', 'payments-dashboard',
    'bank-audit-flags', 'bank-audit-accounts', 'bank-audit-scorecard', 'v-payment-bank-check']) {
    qc.invalidateQueries({ queryKey: [k] })
  }
}

export function ReviewQueue({ accountId, accounts, focusLineId = null, from = '', to = '', onOpenChange, showDone: shownDone, onShowDoneChange, onDatesChange, view = 'list', onViewChange }: {
  accountId: string | null
  accounts: { id: string; account_name: string }[]
  focusLineId?: string | null
  /** The line opened or closed, and how to name it ("CBE · 12 Oct · 5,000.00 · TRF …"). */
  onOpenChange?: (lineId: string | null, detail: string | null) => void
  /** Show the reconciled lines instead of the open ones; the page keeps it in its address. */
  showDone?: boolean
  onShowDoneChange?: (v: boolean) => void
  /** Value dates to show, yyyy-mm-dd; blank for no limit. */
  from?: string
  to?: string
  /** Lets the toolbar set the value dates (the page keeps them in its address). */
  onDatesChange?: (from: string, to: string) => void
  view?: QueueView
  onViewChange?: (v: QueueView) => void
}) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [direction, setDirection] = useState<'all' | 'debit' | 'credit'>('all')
  const [search, setSearch] = useState('')
  const [ownShowDone, setOwnShowDone] = useState(false)
  const showDone = shownDone ?? ownShowDone
  const setShowDone = (v: boolean) => { if (onShowDoneChange) onShowDoneChange(v); else setOwnShowDone(v) }
  const [openId, setOpenId] = useState<string | null>(focusLineId)
  // Lines tried so far while automatic matching runs, round by round.
  const [running, setRunning] = useState<number | null>(null)
  const accountName = useMemo(() => new Map(accounts.map(a => [a.id, a.account_name])), [accounts])
  const { data: brandRows } = useAccountBrands()
  // Lines dated in another fiscal year are flagged, and can be set aside.
  const fyFlag = useFyFlag()
  // Lines from another fiscal year belong to that year's books: set aside
  // unless asked for, so this year's work isn't buried under them.
  const [hideOtherFy, setHideOtherFy] = useState(true)

  const { data: lines = [], isLoading } = useQuery({
    queryKey: ['bank-lines', 'queue', accountId, showDone, from, to, showDone ? focusLineId : null],
    queryFn: async () => {
      let q = supabase.from('v_bank_line_status').select('*').order('value_date', { ascending: !showDone }).order('line_no')
      if (accountId) q = q.eq('account_id', accountId)
      if (from) q = q.gte('value_date', from)
      if (to) q = q.lte('value_date', to)
      q = showDone ? q.not('reconciled_as', 'is', null).limit(200) : q.is('reconciled_as', null)
      const { data, error } = await q
      if (error) throw error
      const rows = (data ?? []) as BankLine[]
      // A link to a reconciled line (from a locked expense) older than the
      // latest 200: fetch it too, in its place by date.
      if (showDone && focusLineId && !rows.some(l => l.line_id === focusLineId)) {
        const { data: one } = await supabase.from('v_bank_line_status').select('*').eq('line_id', focusLineId).not('reconciled_as', 'is', null).maybeSingle()
        if (one) {
          const l = one as BankLine
          const at = rows.findIndex(r => r.value_date < l.value_date)
          rows.splice(at === -1 ? rows.length : at, 0, l)
        }
      }
      return rows
    },
  })

  const matching = lines.filter(l =>
    (direction === 'all' || l.direction === direction) &&
    (!search.trim() || `${l.counterparty_name ?? ''} ${l.counterparty_account ?? ''} ${l.narration ?? ''} ${l.reference ?? ''} ${l.amount}`.toLowerCase().includes(search.trim().toLowerCase())))
  const otherFy = matching.filter(l => fyFlag.outside(l.value_date))
  const shown = hideOtherFy ? matching.filter(l => !fyFlag.outside(l.value_date)) : matching

  // Opened from a link or on coming back: scroll to the line once it's
  // loaded and light it up for a moment, so it's found without searching.
  const scrolledTo = useRef<string | null>(null)
  useEffect(() => {
    if (!focusLineId || scrolledTo.current === focusLineId || !lines.some(l => l.line_id === focusLineId)) return
    scrolledTo.current = focusLineId
    const flash = ['bg-amber-50', 'ring-2', 'ring-inset', 'ring-amber-300', 'dark:bg-amber-900/20']
    requestAnimationFrame(() => {
      const el = document.getElementById(`bank-line-${focusLineId}`)
      el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      el?.classList.add(...flash)
      setTimeout(() => el?.classList.remove(...flash), 2500)
    })
  }, [focusLineId, lines])

  // The page keeps the open line in its address, and names it for the way back.
  // Told only when the line or its name changes, not on every refresh.
  const told = useRef<string | null>(null)
  useEffect(() => {
    if (!onOpenChange) return
    const l = openId ? lines.find(x => x.line_id === openId) : null
    if (openId && !l) return
    const detail = l ? [accountName.get(l.account_id), formatDate(l.value_date), formatCurrency(Number(l.amount)), lineTitle(l)]
      .filter(Boolean).join(' · ') : null
    const key = `${openId ?? ''}|${detail ?? ''}`
    if (told.current === key) return
    told.current = key
    onOpenChange(openId, detail)
  }, [openId, lines, accountName, onOpenChange])
  // Which other years, with how many lines and how much money each.
  const otherYears = [...otherFy.reduce((m, l) => {
    const y = fyFlag.fyOf(l.value_date)
    const v = m.get(y) ?? { n: 0, amount: 0 }
    m.set(y, { n: v.n + 1, amount: v.amount + Number(l.amount) })
    return m
  }, new Map<string, { n: number; amount: number }>())]

  async function runAuto() {
    setRunning(0)
    let n: number
    try {
      n = (await autoMatchBankLines({ accountId, onProgress: p => setRunning(p.tried) })).matched
    } catch (e) {
      setRunning(null); toast((e as Error).message, 'error'); invalidateAll(qc); return
    }
    setRunning(null)
    toast(n > 0 ? `Matched ${n} line${n === 1 ? '' : 's'} automatically` : 'Nothing more could be matched automatically — the rest need a look', n > 0 ? 'success' : 'info')
    invalidateAll(qc)
  }

  const totalOut = shown.filter(l => l.direction === 'debit').reduce((s, l) => s + Number(l.amount), 0)
  const totalIn = shown.filter(l => l.direction === 'credit').reduce((s, l) => s + Number(l.amount), 0)
  // Wide screens show the open line beside the list, so nothing jumps.
  const wide = useMediaQuery('(min-width: 1024px)')
  const phone = !useMediaQuery('(min-width: 640px)')
  const oneAtATime = view === 'one' && !showDone
  const split = wide && !oneAtATime
  const openLine = openId ? lines.find(l => l.line_id === openId) ?? null : null
  const brandOfLine = (l: BankLine) => brandFor(brandRows?.get(l.account_id) ?? { account_name: accountName.get(l.account_id) ?? '' })
  const otherBanks = [...new Set(otherFy.map(l => accountName.get(l.account_id) ?? ''))].filter(Boolean)
  const close = () => { setOpenId(null); invalidateAll(qc) }
  // Beside the list, a settled line makes way for the next one.
  const settleAndNext = (l: BankLine) => () => {
    const i = shown.findIndex(x => x.line_id === l.line_id)
    setOpenId((shown[i + 1] ?? shown[i - 1])?.line_id ?? null)
    invalidateAll(qc)
  }
  const detailFor = (l: BankLine, variant: 'inline' | 'panel') => showDone
    ? <ReconciledDetail key={l.line_id} line={l} onDone={close} variant={variant} brand={brandOfLine(l)} />
    : <LineWorkbench key={l.line_id} line={l} accounts={accounts} onDone={variant === 'panel' ? settleAndNext(l) : close} variant={variant} brand={brandOfLine(l)} />
  const seg = (on: boolean) => `px-3 py-1.5 ${on ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700'}`
  const plain = 'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border text-xs dark:border-slate-600">
          {(['all', 'debit', 'credit'] as const).map(d => (
            <button key={d} onClick={() => setDirection(d)} title={d === 'debit' ? 'DR · money out' : d === 'credit' ? 'CR · money in' : undefined} className={seg(direction === d)}>
              {d === 'all' ? 'All' : d === 'debit' ? 'Out' : 'In'}
            </button>
          ))}
        </div>
        <div className="relative min-w-[10rem] flex-1 sm:flex-none">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, narration, reference or amount"
            className="w-full rounded-md border py-1.5 pl-7 pr-2 text-base outline-none focus:ring-2 focus:ring-brand sm:w-56 sm:text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        {onDatesChange && <DateRangeButton from={from} to={to} onChange={onDatesChange} />}
        <button onClick={() => { setShowDone(!showDone); setOpenId(null) }} aria-pressed={showDone}
          className={`${plain} ${showDone ? 'border-brand bg-brand/5 font-medium text-slate-800 dark:text-slate-100' : 'text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700'}`}>
          <CheckCheck className="h-3.5 w-3.5" /> Reconciled
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {onViewChange && !showDone && (
            <div className="flex overflow-hidden rounded-md border text-xs dark:border-slate-600">
              <button onClick={() => onViewChange('list')} className={seg(view === 'list')}>List</button>
              <button onClick={() => onViewChange('one')} className={seg(view === 'one')}>One at a time</button>
            </div>
          )}
          <button onClick={runAuto} disabled={running !== null}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {running !== null ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
            {running !== null ? `Matching…${running ? ` ${running} checked` : ''}` : 'Match automatically'}
          </button>
        </div>
      </div>

      {otherFy.length > 0 && fyFlag.fy && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-100/70 px-3 py-2 text-xs text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
          <History className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="min-w-0 flex-1">
            {hideOtherFy
              ? <>{otherFy.length} open line{otherFy.length === 1 ? '' : 's'} from {otherYears.map(([y]) => y).join(', ')}{otherBanks.length && !accountId ? ` (${otherBanks.join(', ')})` : ''} {otherFy.length === 1 ? 'is' : 'are'} set aside: they belong to that year's books.</>
              : <>Showing {otherYears.map(([y, v]) => `${v.n} line${v.n === 1 ? '' : 's'} from ${y} (${formatCurrency(v.amount)})`).join(', ')} too. They belong to that year's books.</>}
          </span>
          <button onClick={() => setHideOtherFy(v => !v)} className="shrink-0 font-medium text-brand hover:underline">
            {hideOtherFy ? 'Show them' : 'Set them aside'}
          </button>
        </div>
      )}

      {oneAtATime ? (
        <OneAtATime lines={shown} isLoading={isLoading} startId={openId} brandOf={brandOfLine} accounts={accounts}
          onShow={setOpenId} onDone={() => invalidateAll(qc)} />
      ) : (
      <div className={split ? 'grid items-start gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]' : ''}>
        <div className="min-w-0 overflow-hidden rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800">
          {!isLoading && shown.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b px-4 py-2 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
              <span className="font-semibold text-slate-700 dark:text-slate-200">{shown.length} line{shown.length === 1 ? '' : 's'} {showDone ? 'reconciled' : 'to reconcile'}</span>
              {totalOut > 0 && <span>DR <SignedAmount direction="debit" amount={totalOut} /></span>}
              {totalIn > 0 && <span>CR <SignedAmount direction="credit" amount={totalIn} /></span>}
            </div>
          )}
          {isLoading ? <p className="py-10 text-center text-sm text-slate-400">Loading…</p>
          : shown.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">
              {showDone ? 'No reconciled lines yet.' : 'Every line is reconciled.'}{(from || to) && ' (between these dates)'}
            </p>
          ) : (
            <div className={split ? 'max-h-[calc(100vh-13rem)] overflow-y-auto' : ''}>
              {groupByDay(shown, l => l.value_date, l => ({ out: l.direction === 'debit' ? Number(l.amount) : 0, in: l.direction === 'credit' ? Number(l.amount) : 0 })).map(g => (
              <div key={g.date}>
              <DateHeading date={g.date} out={g.out} inn={g.in} count={g.lines.length} flag={fyFlag} tight={split || phone} />
              <div className="divide-y dark:divide-slate-700">
              {g.lines.map(l => {
                const isOpen = openId === l.line_id
                return (
                <div key={l.line_id} id={`bank-line-${l.line_id}`} className="scroll-mt-20 transition-colors duration-700">
                  <button onClick={() => setOpenId(isOpen && !split ? null : l.line_id)} aria-current={isOpen && split ? 'true' : undefined}
                    className={`flex w-full items-center gap-3 px-4 py-2 text-left ${isOpen && split ? 'bg-brand/5 ring-1 ring-inset ring-brand' : 'hover:bg-slate-50 dark:hover:bg-slate-700/40'}`}>
                    {!split && (isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />)}
                    <DirectionTag direction={l.direction} size="xs" />
                    {!accountId && <BankChip brand={brandOfLine(l)} />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-slate-800 dark:text-slate-100">{lineTitle(l)}</span>
                      <span className="block truncate text-[11px] text-slate-400">{lineSubtitle(l)}</span>
                    </span>
                    {showDone && !split && (
                      <span className="hidden max-w-[240px] truncate text-xs text-slate-500 sm:block dark:text-slate-400">
                        {KIND_LABEL[l.reconciled_as!]}: {describeReconciled(l).map(d => d.text).join(', ')}
                      </span>
                    )}
                    <SignedAmount direction={l.direction} amount={Number(l.amount)} className={`${split ? 'whitespace-nowrap' : 'w-32'} shrink-0 text-right text-sm font-semibold`} />
                  </button>
                  {isOpen && !split && detailFor(l, 'inline')}
                </div>
                )
              })}
              </div>
              </div>
              ))}
            </div>
          )}
        </div>
        {split && (
          <div className="min-w-0 rounded-xl border bg-white p-4 shadow-sm lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto dark:border-slate-700 dark:bg-slate-800">
            {openLine ? detailFor(openLine, 'panel') : (
              <div className="py-12 text-center text-sm text-slate-400">
                <p>Pick a line to see what it probably is.</p>
                {shown.length > 0 && (
                  <button onClick={() => setOpenId(shown[0].line_id)} className="mt-2 font-medium text-brand hover:underline">
                    Start with the {showDone ? 'latest' : 'oldest'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {!showDone && <PaidWithoutBankLine accountId={accountId} />}
    </div>
  )
}

/**
 * Who the bank says a line paid or came from: their account, and the vendor,
 * staff member or client it belongs to and how we know. Unknown, or known by
 * name only, it can be linked here; once linked, every payment to or from
 * that account points to them.
 */
function LinePartyRow({ line, full = false }: { line: BankLine; full?: boolean }) {
  const { data: party } = useLineParty(line)
  const [linking, setLinking] = useState(false)
  const named = !!line.counterparty_name && !isClearingParty(line.counterparty_name)
  if (!named && !party) return null
  const account = line.counterparty_account?.replace(/\D/g, '') ?? ''
  const canLink = named && account.length >= 8
  const sure = party && party.how !== 'name'
  return (
    <div className="space-y-1.5">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
        {full && <span className="font-medium text-slate-700 dark:text-slate-200">{line.direction === 'debit' ? 'Paid to' : 'From'} {line.counterparty_name}</span>}
        {line.counterparty_account && <span className="tabular-nums">Account {line.counterparty_account}</span>}
        {party && (
          <Link to={PARTY_PATH[party.kind] + party.id}
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium hover:underline ${sure
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
              : 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'}`}>
            <UserCheck className="h-3 w-3" />
            {PARTY_LABEL[party.kind]}: {party.name}
          </Link>
        )}
        {party && <span className="text-slate-400">{ownerHowLabel(party.how)}</span>}
        {canLink && !linking && (
          <button onClick={() => setLinking(true)} className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
            <Link2 className="h-3 w-3" />
            {!party ? 'Whose account is this?' : party.how === 'name' ? 'Yes, link the account' : 'Not them?'}
          </button>
        )}
      </p>
      {linking && (
        <LinkPayee account={account} bankName={line.counterparty_name} moneyOut={line.direction === 'debit'}
          initial={party ? { kind: party.kind, id: party.id } : null} linked={party?.how === 'linked'}
          onDone={() => setLinking(false)} />
      )}
    </div>
  )
}

/** The line being worked on, as a header: its bank, date, who it paid or came from, and amount. */
function LineHeader({ line, brand }: { line: BankLine; brand?: BankBrand }) {
  const title = lineTitle(line)
  const named = !!line.counterparty_name && !isClearingParty(line.counterparty_name)
  const via = line.counterparty_name && !named ? `via ${line.counterparty_name}` : null
  const rest = [via, line.narration, line.reference].filter((v, i, all) => v && v !== title && all.indexOf(v) === i).join(' · ')
  return (
    <div className="flex items-start gap-3">
      {brand && <BankMark brand={brand} size="md" />}
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-slate-400">{[brand?.bank, formatDate(line.value_date), line.transaction_type].filter(Boolean).join(' · ')}</p>
        <p className="break-words text-sm font-semibold text-slate-800 dark:text-slate-100">
          {named && <span className="font-normal text-slate-400">{line.direction === 'debit' ? 'Paid to ' : 'From '}</span>}
          {title}
        </p>
        <LinePartyRow line={line} />
        {rest && <p className="truncate text-[11px] text-slate-400">{rest}</p>}
      </div>
      <div className="shrink-0 text-right">
        <DirectionTag direction={line.direction} size="xs" />
        <SignedAmount direction={line.direction} amount={Number(line.amount)} className="mt-0.5 block text-lg font-bold" />
      </div>
    </div>
  )
}

/**
 * One line at a time: the line and what it probably is, Previous and Skip,
 * and the next few below. A settled line makes way for the next; the bar
 * shows how far this sitting has got.
 */
function OneAtATime({ lines, isLoading, startId, brandOf, accounts, onShow, onDone }: {
  lines: BankLine[]
  isLoading: boolean
  startId: string | null
  brandOf: (l: BankLine) => BankBrand
  accounts: { id: string; account_name: string }[]
  onShow: (lineId: string | null) => void
  onDone: () => void
}) {
  const [curId, setCurId] = useState<string | null>(startId)
  const [lastIdx, setLastIdx] = useState(0)
  const [done, setDone] = useState(0)
  const found = curId ? lines.findIndex(l => l.line_id === curId) : -1
  // A line just settled drops out of the list: the one after it takes its place.
  const idx = lines.length === 0 ? -1 : found >= 0 ? found : Math.min(lastIdx, lines.length - 1)
  const cur = idx >= 0 ? lines[idx] : null
  const curKey = cur?.line_id ?? null
  useEffect(() => { onShow(curKey) }, [curKey, onShow])
  const go = (i: number) => {
    const n = lines.length
    if (!n) return
    const j = ((i % n) + n) % n
    setLastIdx(j); setCurId(lines[j].line_id)
  }
  const btn = 'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700'
  const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

  if (isLoading) return <p className="py-10 text-center text-sm text-slate-400">Loading…</p>
  if (!cur) {
    return (
      <div className="rounded-xl border bg-white py-12 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
        {done ? `All done: ${done} line${done === 1 ? '' : 's'} reconciled in this sitting.` : 'Every line is reconciled.'}
      </div>
    )
  }
  const total = done + lines.length
  const upNext = lines.slice(idx + 1, idx + 4)
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <div>
        <div className="flex justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>Line {idx + 1} of {lines.length}{done ? ` · ${done} done in this sitting` : ''}</span>
          <span>{lines.length} to go</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </div>
      </div>
      <div className="rounded-2xl border bg-white p-4 shadow-sm sm:p-5 dark:border-slate-700 dark:bg-slate-800">
        <LineWorkbench key={cur.line_id} line={cur} accounts={accounts} variant="panel" brand={brandOf(cur)}
          onDone={() => { setLastIdx(idx); setDone(d => d + 1); onDone() }} />
        <div className="mt-4 flex items-center gap-2 border-t pt-3 dark:border-slate-700">
          <button onClick={() => go(idx - 1)} disabled={lines.length < 2} className={btn}><ChevronLeft className="h-3.5 w-3.5" /> Previous</button>
          <button onClick={() => go(idx + 1)} disabled={lines.length < 2} className={`${btn} ml-auto`}>Skip for now <SkipForward className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      {upNext.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">Up next</p>
          <ul className="divide-y overflow-hidden rounded-xl border bg-white text-sm dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800">
            {upNext.map((l, k) => (
              <li key={l.line_id}>
                <button onClick={() => go(idx + 1 + k)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-700/40">
                  <span className="w-24 shrink-0 text-[11px] text-slate-400">{day(l.value_date)}</span>
                  <BankChip brand={brandOf(l)} />
                  <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">{lineTitle(l)}</span>
                  <SignedAmount direction={l.direction} amount={Number(l.amount)} className="shrink-0 text-sm font-semibold" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ── One line, being reconciled ──────────────────────────────────────────
type Tab = 'suggest' | 'several' | 'payroll' | 'find' | 'record' | 'explain' | 'transfer'

/**
 * Settling one line: what it probably is first, each with Match; then, if
 * it's none of those, the other ways (several payments, salaries, find,
 * record, explain, between accounts) as one choice each. Inline under its
 * row on a narrow screen; beside the list, or on its own, with a header.
 */
function LineWorkbench({ line, accounts, onDone, variant = 'inline', brand }: {
  line: BankLine
  accounts: { id: string; account_name: string }[]
  onDone: () => void
  variant?: 'inline' | 'panel'
  brand?: BankBrand
}) {
  const { toast } = useToast()
  const [tab, setTab] = useState<Tab>('suggest')
  const [busy, setBusy] = useState(false)
  // The payroll run the Salaries tab opens on, when a suggestion names one.
  const [payrollRun, setPayrollRun] = useState<string | null>(null)
  // Who made the payment, for an approved expense nobody is recorded as
  // paying: the account's usual payer unless someone else is picked.
  const { data: accountPayer = null } = useAccountPayer(line.account_id)
  const [pickedPayer, setPayer] = useState<string | null>(null)
  const payer = pickedPayer ?? accountPayer ?? ''

  // Fresh each time the line opens: coming back after approving an expense
  // elsewhere, it must show as ready to match, not still "open to approve".
  const { data: suggestions = [], isLoading } = useQuery({
    queryKey: ['bank-suggestions', line.line_id],
    refetchOnMount: 'always',
    queryFn: async () => {
      const { data, error } = await supabase.rpc('suggest_bank_line_matches', { p_line_id: line.line_id })
      if (error) throw error
      return (data ?? []) as Suggestion[]
    },
  })

  // Several expenses that add up to this line (452) — the same query the
  // Several payments tab shows.
  const { data: combos = [] } = useQuery({
    queryKey: ['bank-combinations', line.line_id],
    refetchOnMount: 'always',
    enabled: line.direction === 'debit',
    queryFn: async () => {
      const { data, error } = await supabase.rpc('suggest_bank_line_combinations', { p_line_id: line.line_id })
      if (error) throw error
      return (data ?? []) as LineCombination[]
    },
  })

  async function apply(kind: string, targetId: string) {
    setBusy(true)
    const { error } = line.direction === 'debit' && payer
      ? await supabase.rpc('apply_bank_line_match_paid_by', { p_line_id: line.line_id, p_kind: kind, p_target_id: targetId, p_paid_by: payer })
      : await supabase.rpc('apply_bank_line_match', { p_line_id: line.line_id, p_kind: kind, p_target_id: targetId })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast(kind === 'bank_charge' ? 'Settled as a bank charge' : 'Reconciled', 'success')
    onDone()
  }

  const debit = line.direction === 'debit'
  const ways: { id: Exclude<Tab, 'suggest'>; label: string; icon: React.ReactNode; n?: number }[] = [
    ...(debit ? [{ id: 'several' as const, label: 'Several payments', icon: <Layers className="h-3.5 w-3.5 shrink-0" />, n: combos.length || undefined }] : []),
    ...(debit ? [{ id: 'payroll' as const, label: 'Salaries', icon: <Users className="h-3.5 w-3.5 shrink-0" /> }] : []),
    { id: 'find', label: 'Find a record', icon: <Search className="h-3.5 w-3.5 shrink-0" /> },
    { id: 'record', label: debit ? 'Record the expense' : 'Record the sale', icon: <FilePlus2 className="h-3.5 w-3.5 shrink-0" /> },
    { id: 'explain', label: 'Explain it (fee, tax, loan…)', icon: <Coins className="h-3.5 w-3.5 shrink-0" /> },
    { id: 'transfer', label: 'Between our accounts', icon: <Repeat className="h-3.5 w-3.5 shrink-0" /> },
  ]
  const way = ways.find(w => w.id === tab)
  const payerRow = debit && (
    <div title="Used when the expense is approved but nobody is recorded as paying it. It can't be whoever approved it.">
      <PayerSelect value={payer} onChange={setPayer} accountPayer={accountPayer} label="Paid by" />
    </div>
  )

  return (
    <div className={variant === 'inline' ? 'space-y-3 border-t bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/40' : 'space-y-4'}>
      {variant === 'panel' ? <LineHeader line={line} brand={brand} /> : <LinePartyRow line={line} full />}
      {tab === 'suggest' ? (
        <>
          {combos.length > 0 && (
        <button onClick={() => setTab('several')}
          className="flex w-full items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-left text-xs text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800/50 dark:bg-emerald-900/20 dark:text-emerald-200">
          <Layers className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {combos[0].n} expenses{combos[0].same_vendor && combos[0].vendor_names ? ` from ${combos[0].vendor_names}` : ''} add up to this line exactly
            {combos.length > 1 ? ` · ${combos.length - 1} other combination${combos.length > 2 ? 's' : ''}` : ''}
          </span>
          <span className="shrink-0 font-semibold">Review →</span>
        </button>
      )}
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
              <Sparkles className="h-3.5 w-3.5 text-brand" /> What it probably is
            </p>
            {isLoading ? <p className="text-xs text-slate-400">Looking…</p>
            : suggestions.length === 0 ? <p className="text-xs text-slate-500 dark:text-slate-400">Nothing on record looks like this line.</p>
            : (
          <div className="space-y-1.5">
            {suggestions.map(s => (
              <div key={`${s.kind}-${s.target_id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
                <Confidence score={s.score} />
                {/* On a phone the amount and Match drop under the name, so the name stays readable. */}
                <div className="min-w-[12rem] flex-1">
                  <p className="truncate text-xs font-medium text-slate-800 dark:text-slate-100">
                    <span className="mr-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-700 dark:text-slate-300">{KIND_LABEL[s.kind]}</span>
                    {s.label}
                  </p>
                  <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                    {s.reason}{s.detail ? ` · ${s.detail}` : ''}{s.target_date ? ` · ${formatDate(s.target_date)}` : ''}
                  </p>
                </div>
                {s.amount != null && <span className="ml-auto text-xs tabular-nums text-slate-600 dark:text-slate-300">{formatCurrency(Number(s.amount))}</span>}
                {s.kind === 'purchase_order' ? (
                  <Link to={`/sourcing/${s.target_id}`} className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300">
                    Open order <ExternalLink className="h-3 w-3" />
                  </Link>
                ) : s.kind === 'payroll' && s.score < 95 && s.detail === 'pick who this line paid' ? (
                  <button onClick={() => { setPayrollRun(s.target_id); setTab('payroll') }}
                    className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300">
                    <Users className="h-3 w-3" /> Pick people
                  </button>
                ) : s.kind === 'expense' && notApproved(s) ? (
                  <Link to={`/expenses/${s.target_id}`} className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300">
                    Open to approve <ExternalLink className="h-3 w-3" />
                  </Link>
                ) : (
                  <button onClick={() => apply(s.kind, s.target_id)} disabled={busy}
                    className="flex items-center gap-1 rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
                    {s.kind === 'bank_charge' ? <><Coins className="h-3 w-3" /> Settle as charge</> : <><Link2 className="h-3 w-3" /> Match</>}
                  </button>
                )}
                {s.kind === 'payroll' && s.detail !== 'pick who this line paid' && (
                  <button onClick={() => { setPayrollRun(s.target_id); setTab('payroll') }} title="See or change who this line paid"
                    className="rounded-md border px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300">
                    <Users className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
            )}
          </div>
          {payerRow}
          <div>
            <p className="mb-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">{suggestions.length ? 'Not one of these?' : 'What is it, then?'}</p>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {ways.map(w => (
                <button key={w.id} onClick={() => setTab(w.id)}
                  className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-left text-xs text-slate-600 hover:border-brand hover:text-brand dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  {w.icon}<span className="min-w-0 flex-1 leading-tight">{w.label}</span>
                  {w.n != null && <span className="rounded-full bg-emerald-100 px-1.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">{w.n}</span>}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button onClick={() => setTab('suggest')} className="inline-flex items-center gap-1 text-slate-500 hover:text-brand">
              <ArrowLeft className="h-3.5 w-3.5" /> What it probably is
            </button>
            <span className="text-slate-300 dark:text-slate-600">/</span>
            <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-200">{way?.icon}{way?.label}</span>
          </div>
          {tab === 'find' && payerRow}
      {tab === 'several' && <SeveralPayments line={line} onDone={onDone} />}
      {tab === 'payroll' && <PayrollLine key={payrollRun ?? 'any'} line={line} accounts={accounts} initialRunId={payrollRun} onDone={onDone} />}
      {tab === 'find' && <FindRecord line={line} busy={busy} onPick={apply} />}
      {tab === 'record' && (line.direction === 'debit'
        ? <RecordExpenseFromLine line={line} accountPayer={accountPayer} onDone={onDone} />
        : <RecordSaleFromLine line={line} onDone={onDone} />)}
      {tab === 'explain' && <ExplainLine line={line} onDone={onDone} />}
      {tab === 'transfer' && <TransferLine line={line} accounts={accounts} onDone={onDone} />}
        </>
      )}
    </div>
  )
}

/** A suggestion the narration names but that isn't approved for payment yet (498). */
function notApproved(s: Suggestion) {
  return /isn't approved/.test(s.reason)
}

/** How sure the match is, in words. */
function Confidence({ score }: { score: number }) {
  const [label, cls] = score >= 95 ? ['Almost certain', 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300']
    : score >= 60 ? ['Likely', 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300']
    : score >= 40 ? ['Possible', 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300']
    : ['Weak', 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300']
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{label}</span>
}

// Search any open record of the right direction.
function FindRecord({ line, busy, onPick }: { line: BankLine; busy: boolean; onPick: (kind: string, id: string) => void }) {
  const kinds = line.direction === 'debit'
    ? [['expense', 'Expense'], ['batch', 'Batch payment'], ['vrf', 'Vendor request'], ['vrf_part', 'Vendor request part'], ['payroll', 'Payroll run']] as const
    : [['sale', 'Sale / invoice']] as const
  const [kind, setKind] = useState<string>(kinds[0][0])
  const [q, setQ] = useState('')

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['bank-find', kind, q, line.account_id],
    queryFn: async () => {
      const term = q.trim()
      const like = `%${term}%`
      if (kind === 'expense') {
        let query = supabase.from('expenses').select('id, expense_code, item_service_description, amount_etb, net_payable, date, payment_state')
          .is('transfer_id', null).order('date', { ascending: false }).limit(25)
        if (term) query = query.or(`expense_code.ilike.${like},item_service_description.ilike.${like}`)
        const { data, error } = await query
        if (error) throw error
        return (data ?? []).map(e => ({ id: e.id, label: `${e.expense_code ?? ''} ${e.item_service_description ?? ''}`.trim(), sub: `${formatDate(e.date)} · ${String(e.payment_state).replace(/_/g, ' ')}`, amount: Number(e.net_payable ?? e.amount_etb ?? 0) }))
      }
      if (kind === 'batch') {
        let query = supabase.from('batch_payments').select('id, payment_code, created_at').is('transfer_id', null).order('created_at', { ascending: false }).limit(25)
        if (term) query = query.ilike('payment_code', like)
        const { data, error } = await query
        if (error) throw error
        return (data ?? []).map(b => ({ id: b.id, label: b.payment_code ?? 'Batch payment', sub: formatDate(b.created_at), amount: null as number | null }))
      }
      if (kind === 'vrf') {
        let query = supabase.from('vendor_receipt_facilitation').select('id, record_name, facilitator_name, net_sent, amount_transferred, trxn_date')
          .is('out_transfer_id', null).eq('is_archived', false).order('trxn_date', { ascending: false }).limit(25)
        if (term) query = query.or(`record_name.ilike.${like},facilitator_name.ilike.${like}`)
        const { data, error } = await query
        if (error) throw error
        return (data ?? []).map(v => ({ id: v.id, label: `${v.record_name ?? 'Vendor request'} ${v.facilitator_name ?? ''}`.trim(), sub: formatDate(v.trxn_date), amount: Number(v.net_sent ?? v.amount_transferred ?? 0) }))
      }
      if (kind === 'vrf_part') {
        // Parts recorded by date from this line's account, still without a line (454).
        const { data, error } = await supabase.from('vrf_payment_parts')
          .select('id, amount, sent_date, note, vrf:vendor_receipt_facilitation(record_name, facilitator_name)')
          .eq('account_id', line.account_id).is('transfer_id', null).is('reversed_at', null)
          .order('sent_date', { ascending: false }).limit(50)
        if (error) throw error
        const rows = (data ?? []) as unknown as { id: string; amount: number; sent_date: string; note: string | null; vrf: { record_name: string | null; facilitator_name: string | null } | null }[]
        const t = term.toLowerCase()
        return rows
          .filter(r => !t || `${r.vrf?.record_name ?? ''} ${r.vrf?.facilitator_name ?? ''} ${r.note ?? ''}`.toLowerCase().includes(t))
          .map(r => ({ id: r.id, label: `${r.vrf?.record_name ?? 'Vendor request'} · part ${r.vrf?.facilitator_name ?? ''}`.trim(), sub: `${formatDate(r.sent_date)}${r.note ? ` · ${r.note}` : ''}`, amount: Number(r.amount) }))
      }
      if (kind === 'payroll') {
        let query = supabase.from('payroll').select('id, payroll_record, end_date, payment_status').order('end_date', { ascending: false }).limit(25)
        if (term) query = query.ilike('payroll_record', like)
        const { data, error } = await query
        if (error) throw error
        return (data ?? []).map(p => ({ id: p.id, label: p.payroll_record ?? 'Payroll run', sub: `${formatDate(p.end_date)} · ${p.payment_status ?? ''}`, amount: null as number | null }))
      }
      let query = supabase.from('sales').select('id, invoice_number, sales_description, amount, date, sales_status')
        .is('transfer_id', null).eq('is_archived', false).order('date', { ascending: false }).limit(25)
      if (term) query = query.or(`invoice_number.ilike.${like},sales_description.ilike.${like}`)
      const { data, error } = await query
      if (error) throw error
      return (data ?? []).map(s => ({ id: s.id, label: `${s.invoice_number ?? ''} ${s.sales_description ?? ''}`.trim(), sub: `${formatDate(s.date)} · ${s.sales_status}`, amount: Number(s.amount ?? 0) }))
    },
  })

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <select value={kind} onChange={e => setKind(e.target.value)} className="rounded-md border px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
          {kinds.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Code, name or description" className={`${inputCls} max-w-xs`} />
        {isFetching && <span className="self-center text-[11px] text-slate-400">Searching…</span>}
      </div>
      <div className="max-h-64 space-y-1 overflow-y-auto">
        {results.length === 0 && !isFetching && <p className="text-xs text-slate-400">No open records found.</p>}
        {results.map(r => (
          <div key={r.id} className="flex items-center gap-3 rounded-md border bg-white px-3 py-1.5 dark:border-slate-700 dark:bg-slate-800">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-slate-800 dark:text-slate-100">{r.label}</p>
              <p className="text-[11px] text-slate-400">{r.sub}</p>
            </div>
            {r.amount != null && (
              <span className={`text-xs tabular-nums ${Math.abs(r.amount - Number(line.amount)) <= 25 ? 'font-semibold text-emerald-600' : 'text-slate-500'}`}>{formatCurrency(r.amount)}</span>
            )}
            <button onClick={() => onPick(kind, r.id)} disabled={busy}
              className="rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">Match</button>
          </div>
        ))}
      </div>
    </div>
  )
}

// Explain a line nothing on record accounts for; optionally remember it.
function ExplainLine({ line, onDone }: { line: BankLine; onDone: () => void }) {
  const { toast } = useToast()
  const options = CLASSIFICATIONS[line.direction]
  const [value, setValue] = useState(options[0].value)
  const [note, setNote] = useState('')
  const [remember, setRemember] = useState(false)
  const [ruleText, setRuleText] = useState(ruleTextFrom(line.narration) || (line.transaction_type ?? ''))
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    if (remember) {
      if (ruleText.trim().length < 3) { setBusy(false); toast('The rule needs at least 3 characters to look for', 'error'); return }
      const { error } = await supabase.from('bank_line_rules').insert([{
        match_text: ruleText.trim(), direction: line.direction, account_id: line.account_id, classification: value, note: note.trim() || null,
      }])
      if (error) { setBusy(false); toast(error.message, 'error'); return }
    }
    const { error } = await supabase.rpc('classify_bank_line', { p_line_id: line.line_id, p_classification: value, p_note: note.trim() || null })
    if (error) { setBusy(false); toast(error.message, 'error'); return }
    let extra = 0
    if (remember) {
      extra = (await autoMatchBankLines({ accountId: line.account_id }).catch(() => ({ matched: 0 }))).matched
    }
    setBusy(false)
    toast(`Explained and posted to the ledger${extra ? `; the new rule settled ${extra} more line${extra === 1 ? '' : 's'}` : ''}`, 'success')
    onDone()
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map(o => (
          <button key={o.value} type="button" onClick={() => setValue(o.value)}
            className={`rounded-md border px-3 py-2 text-left text-xs dark:border-slate-600 ${value === o.value ? 'border-brand bg-brand/5 dark:bg-brand/10' : 'bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700'}`}>
            <span className="block font-medium text-slate-700 dark:text-slate-200">{o.label}</span>
            <span className="block text-[11px] text-slate-400">{o.hint}</span>
          </button>
        ))}
      </div>
      <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" className={`${inputCls} max-w-md`} />
      <label className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
        <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
        Always treat {line.direction === 'debit' ? 'money out (DR)' : 'money in (CR)'} on this account containing
        <input value={ruleText} onChange={e => setRuleText(e.target.value)} disabled={!remember}
          className="w-48 rounded-md border px-2 py-1 text-xs disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        this way
      </label>
      <div className="flex justify-end">
        <button onClick={save} disabled={busy} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
          {busy ? 'Saving…' : 'Explain & post'}
        </button>
      </div>
      <p className="text-[11px] text-slate-400">Posts a ledger entry between the bank and the account for this kind of item. It can be undone from "Show reconciled".</p>
    </div>
  )
}

// Money that moved between Kuncho's own accounts.
function TransferLine({ line, accounts, onDone }: { line: BankLine; accounts: { id: string; account_name: string }[]; onDone: () => void }) {
  const { toast } = useToast()
  const [otherId, setOtherId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [remember, setRemember] = useState(false)
  const [ruleText, setRuleText] = useState(ruleTextFrom(line.narration))
  const [busy, setBusy] = useState(false)
  const options = accounts.filter(a => a.id !== line.account_id).map(a => ({ id: a.id, label: a.account_name }))

  async function save() {
    if (!otherId) { toast('Pick the other account', 'error'); return }
    setBusy(true)
    if (remember && ruleText.trim().length >= 3) {
      const { error } = await supabase.from('bank_line_rules').insert([{
        match_text: ruleText.trim(), direction: line.direction, account_id: line.account_id,
        classification: 'internal_transfer', counter_account_id: otherId, note: note.trim() || null,
      }])
      if (error) { setBusy(false); toast(error.message, 'error'); return }
    }
    const { error } = await supabase.rpc('pair_internal_transfer', {
      p_line_id: line.line_id, p_other_line_id: null, p_other_account_id: otherId, p_note: note.trim() || null,
    })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Recorded as a transfer between your accounts', 'success')
    onDone()
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {line.direction === 'credit'
          ? 'Money moved in from another of Kuncho\'s accounts (a client paid there and it was brought to this account).'
          : 'Money moved out to another of Kuncho\'s accounts.'}
        {' '}If that bank's statement is already imported, its line shows under Suggestions — match that instead.
        Otherwise the other side is recorded now and taken over by its line when that statement is imported.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <SearchableSelect value={otherId} onChange={setOtherId} options={options} placeholder={line.direction === 'credit' ? 'Came from…' : 'Went to…'} />
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" className={inputCls} />
      </div>
      <label className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
        <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
        Always treat {line.direction === 'debit' ? 'money out (DR)' : 'money in (CR)'} containing
        <input value={ruleText} onChange={e => setRuleText(e.target.value)} disabled={!remember}
          className="w-48 rounded-md border px-2 py-1 text-xs disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        as a transfer with this account
      </label>
      <div className="flex justify-end">
        <button onClick={save} disabled={busy || !otherId} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
          {busy ? 'Saving…' : 'Record transfer'}
        </button>
      </div>
    </div>
  )
}

function ReconciledDetail({ line, onDone, variant = 'inline', brand }: { line: BankLine; onDone: () => void; variant?: 'inline' | 'panel'; brand?: BankBrand }) {
  const diff = line.linked_amount != null ? Number(line.amount) - Number(line.linked_amount) : null

  return (
    <div className={variant === 'inline' ? 'space-y-2 border-t bg-slate-50 px-4 py-3 text-xs dark:border-slate-700 dark:bg-slate-900/40' : 'space-y-3 text-xs'}>
      {variant === 'panel' && <LineHeader line={line} brand={brand} />}
      <p className="text-slate-600 dark:text-slate-300">
        <span className="font-medium">{KIND_LABEL[line.reconciled_as!]}:</span>{' '}
        {describeReconciled(line).map((d, i) => (
          <span key={i}>{i > 0 && ', '}{d.to ? <Link to={d.to} className="text-brand hover:underline">{d.text}</Link> : d.text}</span>
        ))}
      </p>
      {diff != null && Math.abs(diff) > 0.01 && (
        <p className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5" />
          The line is {formatCurrency(Math.abs(diff))} {diff > 0 ? 'more' : 'less'} than what it settles
          {line.direction === 'debit' && diff > 0 && diff <= 25 ? ' — the bank\'s transfer fee' : ''}.
        </p>
      )}
      <LineHistory lineId={line.line_id} />
      <UndoMatch line={line} onDone={onDone} />
    </div>
  )
}

// Payments the app says went out (or came in) by bank, on an account whose
// statements cover the date, with no bank line behind them.
function PaidWithoutBankLine({ accountId }: { accountId: string | null }) {
  const [open, setOpen] = useState(false)
  const { data: rows = [] } = useQuery({
    queryKey: ['bank-paid-without-line', accountId],
    queryFn: async () => {
      let q = supabase.from('v_paid_without_bank_line').select('*').order('paid_on', { ascending: false })
      if (accountId) q = q.eq('account_id', accountId)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as { kind: 'expense' | 'sale'; id: string; code: string | null; description: string | null; amount: number; account_name: string; paid_on: string; method: string | null }[]
    },
  })
  if (rows.length === 0) return null
  const total = rows.reduce((s, r) => s + Number(r.amount), 0)
  return (
    <div className={`overflow-hidden rounded-xl border bg-white dark:bg-slate-800 ${open ? 'dark:border-slate-700' : 'border-dashed dark:border-slate-600'}`}>
      <button onClick={() => setOpen(v => !v)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs">
        {open ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
        <span className="min-w-0 flex-1 text-slate-600 dark:text-slate-300">
          <b className="font-semibold text-slate-800 dark:text-slate-100">{rows.length} payment{rows.length === 1 ? '' : 's'}</b> marked paid by bank {rows.length === 1 ? "isn't" : "aren't"} on any statement yet
          <span className="text-slate-400"> · {formatCurrency(total)}</span>
        </span>
        <span className="shrink-0 font-medium text-brand">{open ? 'Hide' : 'Review'}</span>
      </button>
      {open && (
        <div className="divide-y border-t dark:divide-slate-700 dark:border-slate-700">
          <p className="px-4 py-2 text-[11px] text-slate-500 dark:text-slate-400">
            Marked paid by bank on a date the imported statements cover, but no statement line settles them. Each is either paid from another account,
            paid on a line still in the queue, or not actually paid.
          </p>
          {rows.map(r => (
            <Link key={`${r.kind}-${r.id}`} to={r.kind === 'expense' ? `/expenses/${r.id}` : `/sales/${r.id}`}
              className="flex items-center gap-3 px-4 py-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-700/40">
              <span className="w-20 shrink-0 text-slate-500">{formatDate(r.paid_on)}</span>
              <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">{r.code ?? ''} {r.description ?? ''}</span>
              <span className="text-slate-400">{r.account_name}</span>
              <DirectionTag direction={r.kind === 'sale' ? 'credit' : 'debit'} size="xs" />
              <SignedAmount direction={r.kind === 'sale' ? 'credit' : 'debit'} amount={Number(r.amount)} className="w-28 text-right" />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
