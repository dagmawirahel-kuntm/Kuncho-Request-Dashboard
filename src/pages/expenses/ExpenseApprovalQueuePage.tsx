import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useCategories } from '@/hooks/useLookups'
import { canApproveAsFinance } from '@/lib/expenseAccess'
import { formatCurrency, formatCurrencyCompact, formatDate } from '@/lib/utils'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { Pill, type Tone } from '@/components/record/Record'
import { LoadingRows } from '@/components/shared/LoadingRows'
import { IssueChips, ProjectOrOverheadSelect } from '@/components/expenses/ExpenseFields'
import { AGE_BUCKETS, ISSUE, ageBucket, fromProjectChoice, projectChoice, useApprovalQueue, type ApprovalQueueRow } from '@/lib/expenseQuality'
import {
  GROUP_BY_LABEL, SIGNAL_META, SIGNAL_ORDER, groupKey, signalsOf, timesUsual, useApprovalContext, useCashCover,
  type ApprovalContextRow, type GroupBy, type Signal,
} from '@/lib/approvals'
import { CheckCircle2, Clock, HelpCircle, Landmark, MessageCircleQuestion, Paperclip, Search, Wallet, Wrench, X } from 'lucide-react'
import { chime, confetti, effectsAllowed } from '@/lib/celebrate'
import { useRefreshTaxImpact, useTaxImpact, type ImpactItem } from '@/lib/taxImpact'
import { TaxTag } from '@/components/tax/TaxTag'
import { TaxImpactCountdown, TaxImpactEscalations } from '@/components/tax/TaxImpactBanners'

const pause = (ms: number) => new Promise(r => window.setTimeout(r, ms))

// Approval queue (395): everything waiting for finance, oldest first, with
// what holds each one up. A missing project or ledger is fixed in the row,
// then it approves.
//
// What approving does (444): each bill says whether it is paid already (at
// the gate, or on the bank statement), the payee's track record, what is odd
// (unverified bank details, an unusual amount, a first payment, an order not
// delivered), and what it does to its project. The cash strip says what the
// bank accounts can bear. A question goes to whoever raised it instead of a
// reject, and the answer comes back here.

type Filter = 'all' | 'ready' | 'fix' | Signal
type Order = 'oldest' | 'impact'
const blocked = (r: ApprovalQueueRow) => r.issues.some(i => ISSUE[i]?.blocksApproval)

interface Group { key: string; label: string; tone: Tone; note?: string; rows: ApprovalQueueRow[] }

export default function ExpenseApprovalQueuePage() {
  const { role, user } = useAuth()
  const me = user?.id ?? null
  const canApprove = canApproveAsFinance(role)
  const [params] = useSearchParams()
  const focusId = params.get('expense')
  const { data: rows = [], isLoading } = useApprovalQueue()
  const { data: ctx } = useApprovalContext()
  // Tax impact (migration 423): the same T-tags as the PO list and the payment queue.
  const { data: impact, byId: impactById, allowed: impactAllowed } = useTaxImpact()
  const refreshImpact = useRefreshTaxImpact()
  const [filter, setFilter] = useState<Filter>('all')
  const [groupBy, setGroupBy] = useState<GroupBy>('age')
  const [order, setOrder] = useState<Order>('oldest')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  // Approved rows slide out before the list refreshes (row-out in index.css).
  const [leaving, setLeaving] = useState<Set<string>>(new Set())
  const qc = useQueryClient()
  const { toast } = useToast()

  const signals = useMemo(() => new Map(rows.map(r => [r.id, signalsOf(r, ctx?.get(r.id), me)])), [rows, ctx, me])
  const has = (r: ApprovalQueueRow, s: Signal) => signals.get(r.id)?.includes(s) ?? false
  const signalCounts = useMemo(() => {
    const m = new Map<Signal, number>()
    for (const list of signals.values()) for (const s of list) m.set(s, (m.get(s) ?? 0) + 1)
    return m
  }, [signals])

  const needle = q.trim().toLowerCase()
  const shown = useMemo(() => rows.filter(r =>
    (filter === 'all' || (filter === 'ready' ? !blocked(r) : filter === 'fix' ? blocked(r) : signals.get(r.id)?.includes(filter)))
    && (!needle || `${r.expense_code ?? ''} ${r.item_service_description ?? ''} ${r.payee_name ?? ''} ${r.project_name ?? ''} ${r.requested_by_name ?? ''}`.toLowerCase().includes(needle))),
  [rows, filter, needle, signals])
  const rankOf = (r: ApprovalQueueRow) => impactById.get(r.id)?.rank ?? Number.MAX_SAFE_INTEGER
  const sum = (list: ApprovalQueueRow[]) => list.reduce((s, r) => s + Number(r.amount_etb ?? 0), 0)

  const groups: Group[] = useMemo(() => {
    if (order === 'impact') {
      return [{ key: 'impact', label: 'Biggest tax impact first', tone: 'blue' as Tone,
        rows: [...shown].sort((a, b) => rankOf(a) - rankOf(b) || b.age_days - a.age_days) }].filter(g => g.rows.length)
    }
    if (groupBy === 'age') {
      // Answers to decide first, then what is paid already, then by age; what
      // waits on the requester goes last. Each bill shows once.
      const answered = shown.filter(r => has(r, 'answered'))
      const asked = shown.filter(r => has(r, 'asked'))
      const paid = shown.filter(r => has(r, 'paid_already') && !has(r, 'answered') && !has(r, 'asked'))
      const rest = shown.filter(r => !answered.includes(r) && !paid.includes(r) && !asked.includes(r))
      return [
        { key: 'answered', label: 'Answered — your move', tone: 'violet' as Tone, note: 'The requester answered your question', rows: answered },
        { key: 'paid', label: 'Paid already — approving books it', tone: 'green' as Tone, note: 'At the gate or on the bank statement', rows: paid },
        ...AGE_BUCKETS.map(b => ({ key: b.key, label: b.label, tone: b.tone, rows: rest.filter(r => ageBucket(r.age_days).key === b.key) })),
        { key: 'asked', label: 'Waiting on the requester', tone: 'slate' as Tone, note: 'You asked; no answer yet', rows: asked },
      ].filter(g => g.rows.length)
    }
    const m = new Map<string, Group>()
    for (const r of shown) {
      const { key, label } = groupKey(r, groupBy)
      if (!m.has(key)) m.set(key, { key, label, tone: 'slate', rows: [] })
      m.get(key)!.rows.push(r)
    }
    return [...m.values()].sort((a, b) => sum(b.rows) - sum(a.rows))
    // has() reads signals, which is a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, order, groupBy, signals, impactById])
  const byProject = order === 'oldest' && groupBy === 'project'
  const highWaiting = rows.map(r => impactById.get(r.id)).filter((i): i is ImpactItem => !!i?.high)

  const total = sum(rows)
  const old = rows.filter(r => r.age_days >= 15).length
  const toFix = rows.filter(blocked).length
  const asked = signalCounts.get('asked') ?? 0
  const pickedReady = shown.filter(r => picked.has(r.id) && !blocked(r))
  // Approved together: ready, not waiting on an answer, and not your own.
  const bulkable = (r: ApprovalQueueRow) => !blocked(r) && !has(r, 'asked') && !has(r, 'mine')

  // Opened from a notification (?expense=): bring that bill into view.
  useEffect(() => {
    if (!focusId || isLoading) return
    const t = window.setTimeout(() => document.getElementById(`approval-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)
    return () => window.clearTimeout(t)
  }, [focusId, isLoading])

  function refresh() {
    qc.invalidateQueries({ queryKey: ['expense-approval-queue'] })
    qc.invalidateQueries({ queryKey: ['approval-context'] })
    qc.invalidateQueries({ queryKey: ['approval-cash-cover'] })
    qc.invalidateQueries({ queryKey: ['expense-issues'] })
    qc.invalidateQueries({ queryKey: ['expenses'] })
    if (impactAllowed) void refreshImpact()
  }

  // Rows go out one after another; when the last one in the queue goes,
  // that's worth a moment — the queue is clear, not "N approved".
  async function afterApproved(ids: string[]) {
    const motion = effectsAllowed()
    if (motion) await pause(520)
    const cleared = ids.length > 0 && ids.length >= rows.length
    refresh()
    setLeaving(new Set())
    if (cleared) {
      confetti('big')
      chime('fanfare')
      toast('🎉 Queue cleared — nothing is waiting for finance', 'success')
    } else if (ids.length) {
      chime('success')
    }
  }

  async function approveMany(list: ApprovalQueueRow[], confirmText?: string) {
    const own = list.filter(r => has(r, 'mine')).length
    // What deserves a look before approving several at once.
    const odd = (['unverified', 'unusual', 'first_payment'] as Signal[])
      .map(s => [SIGNAL_META[s].label.toLowerCase(), list.filter(r => has(r, s)).length] as const).filter(([, n]) => n > 0)
    const ask = [
      confirmText,
      odd.length ? `Worth a look first: ${odd.map(([l, n]) => `${l} (${n})`).join(', ')}.` : '',
      own ? `${own} of ${list.length === own ? 'them' : 'these'} you raised yourself — better approved by someone else in finance.` : '',
    ].filter(Boolean).join('\n\n')
    if (ask && !window.confirm(`${ask}\n\nApprove anyway?`)) return
    setBulkBusy(true)
    const motion = effectsAllowed()
    const done: string[] = []
    for (const r of list) {
      const { error } = await supabase.from('expenses').update({ approval_status: 'finance_approved' }).eq('id', r.id)
      if (error) { toast(`${r.expense_code ?? 'Expense'}: ${error.message}`, 'error'); continue }
      done.push(r.id)
      setLeaving(prev => new Set(prev).add(r.id))
      if (motion) await pause(120)
    }
    setBulkBusy(false)
    setPicked(new Set())
    if (done.length && done.length < rows.length) toast(`${done.length} approved for payment`, 'success')
    await afterApproved(done)
  }

  function approvedOne(id: string) {
    setLeaving(prev => new Set(prev).add(id))
    void afterApproved([id])
  }

  const filterChips: [Filter, string, number][] = [
    ['all', 'All', rows.length],
    ['ready', 'Ready', rows.length - toFix],
    ['fix', 'Needs fixing', toFix],
    ...SIGNAL_ORDER.filter(s => (signalCounts.get(s) ?? 0) > 0).map(s => [s, SIGNAL_META[s].label, signalCounts.get(s) ?? 0] as [Filter, string, number]),
  ]

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Approval Queue</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Expenses waiting for finance. Each says what approving it does and what is odd about it; fix what's missing in the row,
          ask whoever raised it, or approve.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Tile label="Waiting" value={String(rows.length)} sub={formatCurrency(total)} />
        <Tile label="Over 2 weeks" value={String(old)} tone={old ? 'red' : undefined} />
        <Tile label="Need fixing first" value={String(toFix)} tone={toFix ? 'amber' : undefined} sub="No project or no ledger" />
        <Tile label="Waiting on requester" value={String(asked)} sub={asked ? 'You asked a question' : 'No open questions'} />
        <Tile label="Ready to approve" value={String(rows.length - toFix)} />
      </div>

      <CashStrip queueTotal={total} readyTotal={sum(rows.filter(r => !blocked(r)))} />

      {impact && (
        <>
          <TaxImpactEscalations data={impact} queue="approve" />
          <TaxImpactCountdown data={impact} queue="approve" />
          {highWaiting.length > 0 && (
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <span className="flex gap-1">{highWaiting.slice(0, 5).map(i => <TaxTag key={i.id} item={i} periodLabel={impact.period.label} />)}</span>
              {highWaiting.length} high-impact expense{highWaiting.length === 1 ? '' : 's'} waiting here —
              approving and paying {highWaiting.length === 1 ? 'it' : 'them'} this month closes {Math.round(highWaiting.reduce((s, i) => s + (i.share ?? 0), 0) * 100)}% of {impact.period.label}'s VAT gap.
            </p>
          )}
        </>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap gap-1">
          {filterChips.map(([k, label, n]) => (
            <button key={k} onClick={() => setFilter(k)}
              title={k in SIGNAL_META ? SIGNAL_META[k as Signal].help : undefined}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${filter === k ? 'border-brand bg-brand/10 text-brand' : 'text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>
              {label} <span className="tabular-nums opacity-60">{n}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search code, payee, project…"
              className="w-full rounded-lg border py-1.5 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            Group by
            <select value={groupBy} onChange={e => { setGroupBy(e.target.value as GroupBy); setOrder('oldest') }}
              className="rounded-md border px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
              {(Object.keys(GROUP_BY_LABEL) as GroupBy[]).map(g => <option key={g} value={g}>{GROUP_BY_LABEL[g]}</option>)}
            </select>
          </label>
          {impact && (
            <div className="flex rounded-lg border p-0.5 text-xs dark:border-slate-600">
              {([['oldest', 'Grouped'], ['impact', 'Biggest tax impact']] as const).map(([k, l]) => (
                <button key={k} onClick={() => setOrder(k)} className={`rounded-md px-2.5 py-1 font-medium ${order === k ? 'bg-brand text-white' : 'text-slate-500'}`}>{l}</button>
              ))}
            </div>
          )}
          {canApprove && pickedReady.length > 0 && (
            <button disabled={bulkBusy} onClick={() => approveMany(pickedReady)}
              className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50">
              {bulkBusy ? 'Approving…' : `Approve ${pickedReady.length} selected`}
            </button>
          )}
        </div>
      </div>

      {isLoading ? <LoadingRows rows={5} /> : groups.length === 0 ? (
        <p className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Nothing waiting here.</p>
      ) : groups.map(g => {
        const ready = g.rows.filter(bulkable)
        // Grouped by project, its contract goes on the group, not on every bill.
        const projectCtx = byProject ? ctx?.get(g.rows[0].id) : undefined
        return (
          <section key={g.key} className="space-y-2">
            <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <Pill tone={g.tone}>{g.label}</Pill>
              <span className="text-xs font-normal text-slate-400">{g.rows.length} · {formatCurrency(sum(g.rows))}{g.note ? ` · ${g.note}` : ''}</span>
              {projectCtx && <span className="text-xs font-normal text-slate-500 dark:text-slate-400"><ContractLine name={g.label} c={projectCtx} header /></span>}
              {canApprove && order === 'oldest' && groupBy !== 'age' && ready.length > 1 && (
                <button disabled={bulkBusy} onClick={() => approveMany(ready, `Approve ${ready.length} bills for ${g.label} — ${formatCurrency(sum(ready))}?`)}
                  title="Ready ones only — not your own, and not those waiting on an answer"
                  className="ml-auto rounded-md border border-green-600 px-2.5 py-1 text-[11px] font-semibold text-green-700 hover:bg-green-50 disabled:opacity-50 dark:text-green-400 dark:hover:bg-green-900/20">
                  Approve {ready.length} ready · {formatCurrencyCompact(sum(ready))}
                </button>
              )}
            </h2>
            <div className="divide-y rounded-xl border bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800">
              {g.rows.map(r => (
                <QueueRow key={r.id} row={r} ctx={ctx?.get(r.id)} signals={signals.get(r.id) ?? []} me={me}
                  impact={impactById.get(r.id)} period={impact?.period.label} canApprove={canApprove} showProject={!byProject} onDone={refresh}
                  onApproved={() => approvedOne(r.id)} leaving={leaving.has(r.id)} focused={r.id === focusId}
                  picked={picked.has(r.id)}
                  onPick={v => setPicked(p => { const n = new Set(p); if (v) n.add(r.id); else n.delete(r.id); return n })} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'red' | 'amber' }) {
  return (
    <div className="rounded-xl border bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : 'text-slate-800 dark:text-slate-100'}`}>{value}</p>
      {sub && <p className="truncate text-[11px] text-slate-400">{sub}</p>}
    </div>
  )
}

// What the bank accounts hold against what is already promised, and what
// approving everything here would leave.
function CashStrip({ queueTotal, readyTotal }: { queueTotal: number; readyTotal: number }) {
  const { data: c } = useCashCover()
  if (!c) return null
  const committed = c.sent + c.approved
  const leftNow = c.banks - committed
  const leftAll = leftNow - queueTotal
  const scale = Math.max(c.banks, committed + queueTotal, 1)
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / scale) * 100))}%`
  return (
    <section className="rounded-xl border bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-800 dark:text-slate-100"><Wallet className="h-4 w-4 text-slate-400" /> Can the cash bear it?</h2>
        <span className="text-[11px] text-slate-400">What the books show in the bank accounts against what is already promised.</span>
      </div>
      <div className="relative mt-2">
        <div className="flex h-2.5 overflow-hidden rounded-full bg-emerald-100 dark:bg-emerald-900/30" role="img"
          aria-label={`In the banks ${formatCurrency(c.banks)}; sent ${formatCurrency(c.sent)}; approved ${formatCurrency(c.approved)}; waiting here ${formatCurrency(queueTotal)}`}>
          <div className="bg-slate-500" style={{ width: pct(c.sent) }} />
          <div className="bg-sky-500" style={{ width: pct(c.approved) }} />
          <div className="bg-amber-400" style={{ width: pct(queueTotal) }} />
        </div>
        {/* Where the bank balance runs out, when the promises go past it. */}
        {committed + queueTotal > c.banks && c.banks > 0 && (
          <div className="absolute -bottom-1 -top-1 w-0.5 rounded bg-red-600" style={{ left: pct(c.banks) }} title={`The bank accounts hold ${formatCurrency(c.banks)}`} />
        )}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-5">
        <Fig label="In the bank accounts" value={c.banks} dot="bg-emerald-200 dark:bg-emerald-800" />
        <Fig label="Sent, on its way out" value={c.sent} dot="bg-slate-500" />
        <Fig label={`Approved, not yet paid (${c.approvedCount})`} value={c.approved} dot="bg-sky-500" />
        <Fig label="Waiting here" value={queueTotal} dot="bg-amber-400" sub={readyTotal < queueTotal ? `${formatCurrencyCompact(readyTotal)} ready` : undefined} />
        <div>
          <dt className="text-slate-500 dark:text-slate-400">Left if all approved</dt>
          <dd className={`text-sm font-bold tabular-nums ${leftAll < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{formatCurrency(leftAll)}</dd>
          <dd className="text-[11px] text-slate-400">{formatCurrency(leftNow)} before this queue</dd>
        </div>
      </dl>
      {leftAll < 0 && (
        <p className="mt-2 text-xs text-red-700 dark:text-red-400">
          Approving everything here promises {formatCurrency(-leftAll)} more than the bank accounts hold — approve what is due first.
          {c.wallets > 0 ? ` Wallets hold another ${formatCurrencyCompact(c.wallets)}.` : ''}
        </p>
      )}
    </section>
  )
}

function Fig({ label, value, dot, sub }: { label: string; value: number; dot: string; sub?: string }) {
  return (
    <div>
      <dt className="flex items-center gap-1 text-slate-500 dark:text-slate-400"><span className={`inline-block h-2 w-2 rounded-full ${dot}`} />{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(value)}</dd>
      {sub && <dd className="text-[11px] text-slate-400">{sub}</dd>}
    </div>
  )
}

const daysAgo = (ts: string | null) => {
  if (!ts) return ''
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86_400_000)
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`
}

// The project's contract: how much of it is spent or approved, and what this
// bill (or everything waiting) would take it to.
function ContractLine({ name, c, amount, header }: { name: string | null; c: ApprovalContextRow; amount?: number; header?: boolean }) {
  const contract = Number(c.contract_value ?? 0)
  if (contract <= 0) return null
  const committed = Number(c.project_spent) + Number(c.project_approved_unpaid)
  const waiting = Number(c.project_waiting)
  const pct = (n: number) => (n / contract) * 100
  const now = pct(committed)
  const after = pct(committed + (amount ?? waiting))
  const tone = after > 100 ? 'font-medium text-red-700 dark:text-red-400' : after >= 90 ? 'text-amber-700 dark:text-amber-400' : ''
  // A span, so it can sit in a group heading as well as in a bill.
  return (
    <span className={`${header ? '' : 'block'} ${tone}`}>
      {header ? '' : `${name ?? 'The project'}: `}{Math.round(now)}% of the {formatCurrencyCompact(contract)} contract spent or approved
      {header || amount == null
        ? ` → ${Math.round(after)}% with everything waiting here`
        : Math.round(after) > Math.round(now) ? ` → ${Math.round(after)}% with this` : ' · this bill is under 1% of it'}
      {!header && amount != null && waiting > amount && <span className="text-slate-400"> ({Math.round(pct(committed + waiting))}% with everything waiting)</span>}
    </span>
  )
}

function QueueRow({ row: r, ctx: c, signals, me, impact, period, canApprove, showProject, onDone, onApproved, leaving, focused, picked, onPick }: {
  row: ApprovalQueueRow; ctx?: ApprovalContextRow; signals: Signal[]; me: string | null; impact?: ImpactItem; period?: string
  canApprove: boolean; showProject: boolean; onDone: () => void; onApproved: () => void; leaving: boolean; focused: boolean; picked: boolean; onPick: (v: boolean) => void
}) {
  const { toast } = useToast()
  const { data: categories = [] } = useCategories()
  const categoryOptions = useMemo(() => (categories as { id: string; category_name: string }[]).map(c => ({ id: c.id, label: c.category_name })), [categories])
  const [mode, setMode] = useState<'reject' | 'ask' | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const isBlocked = blocked(r)
  const mine = signals.includes('mine')
  const times = timesUsual(r, c)

  async function update(patch: Record<string, unknown>, done: string) {
    if (patch.approval_status === 'finance_approved' && mine
      && !window.confirm('You raised this expense. Approve your own request? Better if someone else in finance approves it.')) return
    setBusy(true)
    const { error } = await supabase.from('expenses').update(patch).eq('id', r.id)
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast(done, 'success')
    setMode(null); setText('')
    if (patch.approval_status === 'finance_approved') onApproved()
    else onDone()
  }

  async function ask() {
    if (!text.trim()) return
    setBusy(true)
    const { error } = await supabase.rpc('ask_expense_question', { p_expense_id: r.id, p_question: text.trim() })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`Asked ${r.requested_by_name ?? 'the requester'} — the answer comes back here`, 'success')
    setMode(null); setText('')
    onDone()
  }

  const actions = canApprove && !mode ? (
    <>
      <button disabled={busy || isBlocked} onClick={() => update({ approval_status: 'finance_approved' }, 'Approved for payment')}
        title={isBlocked ? 'Fix what is missing first' : mine ? 'You raised this one' : undefined}
        className="rounded-md bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-40">Approve</button>
      <button disabled={busy || (!!c?.question_id && !c.answered_at) || !r.purchaser_user_id || r.purchaser_user_id === me}
        onClick={() => setMode('ask')}
        title={!r.purchaser_user_id || r.purchaser_user_id === me ? 'Nobody else to ask' : c?.question_id && !c.answered_at ? 'Waiting for the answer' : 'Ask whoever raised it'}
        className="inline-flex items-center gap-0.5 rounded-md bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-40 dark:bg-sky-900/20 dark:text-sky-300">
        <HelpCircle className="h-3 w-3" /> Ask
      </button>
      <button disabled={busy} onClick={() => setMode('reject')} className="rounded-md bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-100">Reject</button>
    </>
  ) : null

  return (
    <div id={`approval-${r.id}`} className={`space-y-2 px-3 py-3 ${leaving ? 'row-out' : ''} ${focused ? 'bg-brand/5 ring-2 ring-inset ring-brand/40' : ''}`}>
      <div className="flex items-start gap-3">
        {canApprove && (
          <input type="checkbox" className="mt-1" disabled={isBlocked} checked={picked && !isBlocked} onChange={e => onPick(e.target.checked)}
            title={isBlocked ? 'Fix what is missing first' : 'Select to approve together'} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <TaxTag item={impact} periodLabel={period} />
            <Link to={`/expenses/${r.id}`} className="font-mono text-xs font-bold text-brand hover:underline">{r.expense_code ?? 'Expense'}</Link>
            <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{r.item_service_description ?? '—'}</span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {r.payee_name ?? 'No payee'} · {r.project_name ?? (r.is_overhead ? 'Company overhead' : 'No project')} · {r.category_name ?? 'No ledger'}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{r.age_days} day{r.age_days === 1 ? '' : 's'} waiting</span>
            <span>Dated {formatDate(r.date)}</span>
            {r.requested_by_name && <span>by {r.requested_by_name}</span>}
            {r.receipt_url && <a href={r.receipt_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand hover:underline"><Paperclip className="h-3 w-3" />Receipt</a>}
          </p>
          {impact?.high && (
            <p className="mt-0.5 text-[11px] font-medium text-[#1e3a5f] dark:text-sky-300">
              {Math.round(impact.vat).toLocaleString()} VAT · {Math.round((impact.share ?? 0) * 100)}% of the VAT gap
              {impact.escalated && impact.overtook ? ` · moved ahead of ${impact.overtook.code}` : ''}
            </p>
          )}

          {/* What approving it does */}
          {c && (
            <div className="mt-1.5 space-y-0.5 text-[11px] text-slate-600 dark:text-slate-300">
              {c.spot_paid && (
                <p className="font-medium text-emerald-700 dark:text-emerald-400">
                  Paid at the gate {c.spot_paid_method === 'telebirr' ? 'by telebirr' : 'in cash'} by {c.spot_paid_by_name ?? 'the cashier'} {daysAgo(c.spot_paid_at)} — approving records it as paid
                </p>
              )}
              {c.bank_line_id && (
                <p className="flex flex-wrap items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
                  <Landmark className="h-3 w-3" /> On the bank statement: {formatCurrency(Number(c.bank_line_amount ?? 0))} out on {formatDate(c.bank_line_date)}
                  {c.bank_line_ref && <span className="font-mono font-normal">{c.bank_line_ref}</span>} — approving puts it in the books
                </p>
              )}
              {c.payee_paid_count > 0 ? (
                <p>
                  {r.payee_name ?? 'This payee'}: paid {c.payee_paid_count}× in the last year
                  {c.payee_typical_amount ? <> · usually {formatCurrency(Number(c.payee_typical_amount))}</> : null}
                  {c.payee_last_paid_on ? <> · last {formatDate(c.payee_last_paid_on)}</> : null}
                  {times != null && times >= 3 && <span className="font-semibold text-amber-700 dark:text-amber-400"> · this is {times >= 10 ? Math.round(times) : times.toFixed(1)}× the usual</span>}
                </p>
              ) : r.vendor_id ? (
                <p className="text-amber-700 dark:text-amber-400">First payment to this vendor in the last year</p>
              ) : null}
              {c.vendor_verification === 'pending_verification' && (
                <p className="font-medium text-red-700 dark:text-red-400">The vendor's bank details are not verified — have someone else check them before it is paid</p>
              )}
              {c.bundle_code && (
                <p>
                  {c.bundle_code} · {c.payment_pattern === 'pay_in_advance' ? 'paid ahead — closes when the goods arrive'
                    : c.delivered_on ? `delivered ${formatDate(c.delivered_on)}` : <span className="text-sky-700 dark:text-sky-400">paid on delivery — not delivered yet, so it can't be paid</span>}
                </p>
              )}
              {showProject && <ContractLine name={r.project_name} c={c} amount={Number(r.amount_etb ?? 0)} />}
            </div>
          )}

          {/* The question asked about it */}
          {c?.question_id && (
            <div className={`mt-1.5 rounded-md px-2.5 py-1.5 text-[11px] ${c.answered_at ? 'bg-violet-50 text-violet-900 dark:bg-violet-900/20 dark:text-violet-200' : 'bg-sky-50 text-sky-900 dark:bg-sky-900/20 dark:text-sky-200'}`}>
              <p><span className="font-semibold">{c.asked_by_name ?? 'Finance'} asked {daysAgo(c.asked_at)}:</span> {c.question}</p>
              {c.answered_at
                ? <p className="mt-0.5"><span className="font-semibold">{c.answered_by_name ?? 'The requester'} answered {daysAgo(c.answered_at)}:</span> {c.answer}</p>
                : <p className="mt-0.5 opacity-75">Waiting for {r.requested_by_name ?? 'the requester'} to answer.</p>}
            </div>
          )}

          {(r.issues.length > 0 || signals.some(s => s === 'unverified' || s === 'unusual' || s === 'first_payment' || s === 'mine' || s === 'waits_delivery')) && (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {r.issues.length > 0 && <IssueChips issues={r.issues} />}
              {signals.filter(s => s === 'unverified' || s === 'unusual' || s === 'first_payment' || s === 'waits_delivery' || s === 'mine').map(s => (
                <Pill key={s} tone={SIGNAL_META[s].tone} title={SIGNAL_META[s].help}>{SIGNAL_META[s].label}</Pill>
              ))}
            </div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(r.amount_etb)}</p>
          {actions && <div className="mt-1 hidden justify-end gap-1 sm:flex">{actions}</div>}
        </div>
      </div>
      {/* On a phone the buttons go under the bill, not beside it. */}
      {actions && <div className="flex gap-1 sm:hidden">{actions}</div>}

      {canApprove && isBlocked && (
        <div className="ml-0 grid grid-cols-1 gap-2 rounded-lg bg-amber-50 p-2 dark:bg-amber-900/10 sm:ml-7 sm:grid-cols-2">
          <p className="flex items-center gap-1 text-[11px] font-medium text-amber-800 dark:text-amber-300 sm:col-span-2"><Wrench className="h-3 w-3" />Fix it here, then approve</p>
          {r.issues.includes('no_project') && (
            <ProjectOrOverheadSelect value={projectChoice(r.project_id, r.is_overhead)}
              onChange={v => v && update(fromProjectChoice(v), 'Project set')} />
          )}
          {r.issues.includes('no_ledger') && (
            <SearchableSelect value={r.category_id} onChange={id => id && update({ category_id: id }, 'Ledger set')} options={categoryOptions} placeholder="Pick the general ledger…" />
          )}
        </div>
      )}

      {mode && (
        <div className="flex flex-wrap items-center gap-2 sm:ml-7">
          {mode === 'ask' && <MessageCircleQuestion className="h-4 w-4 shrink-0 text-sky-600" />}
          <input autoFocus value={text} onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && text.trim()) { e.preventDefault(); if (mode === 'ask') void ask(); else void update({ approval_status: 'rejected', rejection_reason: text.trim() }, 'Rejected') } }}
            placeholder={mode === 'ask' ? `What do you need to know? ${r.requested_by_name ?? 'The requester'} is notified and answers on the expense.` : 'Why is it rejected? The requester sees this.'}
            className="min-w-[200px] flex-1 rounded-md border px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
          {mode === 'ask'
            ? <button disabled={busy || !text.trim()} onClick={ask} className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">Ask</button>
            : <button disabled={busy || !text.trim()} onClick={() => update({ approval_status: 'rejected', rejection_reason: text.trim() }, 'Rejected')}
                className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">Reject</button>}
          <button onClick={() => { setMode(null); setText('') }} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
      )}
    </div>
  )
}
