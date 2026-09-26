import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownLeft, ArrowUpRight, ChevronDown, ChevronRight, Lock, Scale, ArrowRight, Hourglass } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { KIND_LABEL, describeReconciled, type BankLine } from '@/lib/bankReconciliation'
import { SWEEP_AFTER_DAYS, type AccountControl } from '@/lib/cashControl'
import { LineHistory, UndoMatch } from '@/components/cash/LineHistory'
import { MoveMoneyModal } from '@/components/cash/MoveMoneyModal'

// What the app and the bank each say, and how far the statements run.
export function BankPosition({ c, main, canWrite }: { c: AccountControl; main?: AccountControl; canWrite: boolean }) {
  const [moving, setMoving] = useState(false)
  const gap = c.app_balance_at_statement != null && c.statement_balance != null
    ? Number(c.statement_balance) - Number(c.app_balance_at_statement) : null
  const age = c.statement_age_days ?? 0
  const ageCls = age <= 3 ? 'text-emerald-600 dark:text-emerald-400' : age <= 10 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'

  return (
    <div className="space-y-3 rounded-xl border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
          <Scale className="h-4 w-4 text-brand" /> Bank position
        </p>
        <Link to={`/bank-statement-import?account=${c.account_id}`} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90">
          {(c.open_count ?? 0) > 0 ? `Reconcile ${c.open_count} line${c.open_count === 1 ? '' : 's'}` : 'Import or reconcile'}
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <div>
          <p className="text-slate-400">Bank says</p>
          <p className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(c.statement_balance)}</p>
          <p className={`text-[10px] ${ageCls}`}>on {formatDate(c.statement_date)} · {age}d old</p>
        </div>
        <div>
          <p className="text-slate-400">App on that day</p>
          <p className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(c.app_balance_at_statement)}</p>
          {gap != null && (
            <p className={`text-[10px] ${Math.abs(gap) < 0.01 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
              {Math.abs(gap) < 0.01 ? 'agrees with the bank' : `${gap > 0 ? 'bank has' : 'app has'} ${formatCurrency(Math.abs(gap))} more`}
            </p>
          )}
        </div>
        <div>
          <p className="text-slate-400">App today</p>
          <p className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(c.app_balance)}</p>
          <p className="text-[10px] text-slate-400">statement + what's recorded since</p>
        </div>
        <div>
          <p className="text-slate-400">Closed</p>
          <p className="flex items-center gap-1 font-semibold text-slate-700 dark:text-slate-200">
            <Lock className="h-3 w-3" /> {c.closed_through ? formatDate(c.closed_through) : 'Never'}
          </p>
          {(c.open_count ?? 0) > 0 && <p className="text-[10px] text-amber-600 dark:text-amber-400">{c.open_count} line{c.open_count === 1 ? '' : 's'} open since {formatDate(c.oldest_open)}</p>}
        </div>
      </div>
      {gap != null && Math.abs(gap) >= 0.01 && (c.open_count ?? 0) > 0 && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          The gap closes as the open lines are matched: each one the app doesn't know about yet is counted twice or not at all until then.
        </p>
      )}
      {c.role === 'collection' && c.waiting_to_move > 0 && (
        <div className={`flex flex-wrap items-center gap-3 rounded-lg px-3 py-2 text-xs ${(c.waiting_days ?? 0) >= SWEEP_AFTER_DAYS ? 'bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300' : 'bg-slate-50 text-slate-600 dark:bg-slate-900/40 dark:text-slate-300'}`}>
          <Hourglass className="h-3.5 w-3.5" />
          <span className="flex-1">{formatCurrency(c.waiting_to_move)} waiting to move{c.waiting_since ? ` since ${formatDate(c.waiting_since)}` : ''}.</span>
          {canWrite && main && (
            <button onClick={() => setMoving(true)} className="inline-flex items-center gap-1 rounded-md border border-current px-2 py-1 font-medium">
              Move to {main.account_name} <ArrowRight className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
      {moving && main && (
        <MoveMoneyModal from={{ id: c.account_id, name: c.account_name }} to={{ id: main.account_id, name: main.account_name }}
          suggested={c.waiting_to_move} onClose={() => setMoving(false)} />
      )}
    </div>
  )
}

// The account's statement lines, newest first, with what each settled and
// its history; a reconciled line can be undone with a reason.
export function BankLinesTab({ accountId }: { accountId: string }) {
  const qc = useQueryClient()
  const [onlyOpen, setOnlyOpen] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [limit, setLimit] = useState(100)
  const { data: lines = [], isLoading } = useQuery({
    queryKey: ['bank-lines', 'account', accountId, onlyOpen, limit],
    queryFn: async () => {
      let q = supabase.from('v_bank_line_status').select('*').eq('account_id', accountId)
        .order('value_date', { ascending: false }).order('line_no', { ascending: false }).limit(limit)
      if (onlyOpen) q = q.is('reconciled_as', null)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as BankLine[]
    },
  })

  function refresh() {
    setOpenId(null)
    for (const k of ['bank-lines', 'bank-overview', 'bank-line-events', 'bank-alerts', 'account-control', 'ledger-tieout', 'bank-paid-without-line']) {
      qc.invalidateQueries({ queryKey: [k] })
    }
  }

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
        <input type="checkbox" checked={onlyOpen} onChange={e => setOnlyOpen(e.target.checked)} /> Only lines still to reconcile
      </label>
      <div className="overflow-hidden rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800">
        {isLoading ? <p className="py-10 text-center text-sm text-slate-400">Loading…</p>
        : lines.length === 0 ? <p className="py-10 text-center text-sm text-slate-400">{onlyOpen ? 'Every line is reconciled.' : 'No statement lines imported for this account.'}</p>
        : (
          <div className="divide-y dark:divide-slate-700">
            {lines.map(l => {
              const open = openId === l.line_id
              return (
                <div key={l.line_id}>
                  <button onClick={() => setOpenId(open ? null : l.line_id)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
                    {l.direction === 'debit' ? <ArrowUpRight className="h-4 w-4 shrink-0 text-red-500" /> : <ArrowDownLeft className="h-4 w-4 shrink-0 text-emerald-500" />}
                    <span className="w-20 shrink-0 text-xs text-slate-500">{formatDate(l.value_date)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-slate-800 dark:text-slate-100">{l.narration || l.transaction_type || '—'}</span>
                      <span className="block truncate text-[11px] text-slate-400">
                        {l.reconciled_as ? `${KIND_LABEL[l.reconciled_as]}: ${describeReconciled(l).map(d => d.text).join(', ')}` : (l.reference ?? '')}
                      </span>
                    </span>
                    {!l.reconciled_as && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">open</span>}
                    <span className={`w-32 shrink-0 text-right text-sm font-semibold tabular-nums ${l.direction === 'debit' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {l.direction === 'debit' ? '−' : '+'}{formatCurrency(Number(l.amount))}
                    </span>
                    <span className="hidden w-28 shrink-0 text-right text-[11px] tabular-nums text-slate-400 md:block">{l.running_balance != null ? formatCurrency(Number(l.running_balance)) : ''}</span>
                  </button>
                  {open && (
                    <div className="space-y-2 border-t bg-slate-50 px-4 py-3 text-xs dark:border-slate-700 dark:bg-slate-900/40">
                      {l.reference && <p className="text-slate-500">Reference <span className="font-mono">{l.reference}</span></p>}
                      {l.reconciled_as ? (
                        <p className="text-slate-600 dark:text-slate-300">
                          <span className="font-medium">{KIND_LABEL[l.reconciled_as]}:</span>{' '}
                          {describeReconciled(l).map((d, i) => (
                            <span key={i}>{i > 0 && ', '}{d.to ? <Link to={d.to} className="text-brand hover:underline">{d.text}</Link> : d.text}</span>
                          ))}
                        </p>
                      ) : (
                        <Link to={`/bank-statement-import?account=${accountId}&tab=queue&line=${l.line_id}`} className="font-medium text-brand hover:underline">
                          Reconcile this line →
                        </Link>
                      )}
                      <LineHistory lineId={l.line_id} />
                      <UndoMatch line={l} onDone={refresh} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      {lines.length === limit && (
        <button onClick={() => setLimit(n => n + 200)} className="w-full text-center text-xs font-medium text-brand hover:underline">Show older lines</button>
      )}
    </div>
  )
}

interface AwaitingRow { kind: 'expense' | 'vrf'; id: string; code: string | null; payee: string | null; amount: number; sent_on: string | null; method: string | null }

// Sent from this account, not yet seen on its statement.
export function AwaitingBankTab({ accountId, statementDate }: { accountId: string; statementDate: string | null }) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['account-awaiting-bank', accountId],
    queryFn: async () => {
      const [ex, vr] = await Promise.all([
        supabase.from('expenses')
          .select('id, expense_code, item_service_description, amount_etb, net_payable, payment_state_changed_at, date, payment_method, vendors:vendor_id(vendor_name), staff:paid_to_staff_id(employee_name)')
          .eq('account_id', accountId).eq('payment_state', 'sent').is('transfer_id', null).not('is_archived', 'is', true),
        supabase.from('vendor_receipt_facilitation')
          .select('id, record_name, facilitator_name, net_sent, amount_transferred, sent_date, trxn_date')
          .eq('initial_account_id', accountId).eq('payment_state', 'sent').is('out_transfer_id', null).eq('is_archived', false),
      ])
      if (ex.error) throw ex.error
      if (vr.error) throw vr.error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const out: AwaitingRow[] = (ex.data ?? []).map((e: any) => ({
        kind: 'expense', id: e.id, code: e.expense_code, payee: e.vendors?.vendor_name ?? e.staff?.employee_name ?? e.item_service_description,
        amount: Number(e.net_payable ?? e.amount_etb ?? 0), sent_on: (e.payment_state_changed_at ?? e.date)?.slice(0, 10) ?? null, method: e.payment_method,
      }))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const v of (vr.data ?? []) as any[]) {
        out.push({ kind: 'vrf', id: v.id, code: v.record_name, payee: v.facilitator_name, amount: Number(v.net_sent ?? v.amount_transferred ?? 0), sent_on: v.sent_date ?? v.trxn_date, method: 'transfer' })
      }
      return out.sort((a, b) => (a.sent_on ?? '').localeCompare(b.sent_on ?? ''))
    },
  })
  const total = rows.reduce((s, r) => s + r.amount, 0)
  if (isLoading) return <p className="py-10 text-center text-sm text-slate-400">Loading…</p>
  if (rows.length === 0) return <p className="py-10 text-center text-sm text-slate-400">Nothing sent from this account is waiting to show on the bank.</p>
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {rows.length} payment{rows.length === 1 ? '' : 's'} · {formatCurrency(total)} marked sent, with no bank line yet.
        {statementDate && <> Anything sent well before {formatDate(statementDate)} should already be on the statement.</>}
      </p>
      <div className="divide-y overflow-hidden rounded-xl border bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800">
        {rows.map(r => {
          const late = statementDate != null && r.sent_on != null && r.sent_on < statementDate
          return (
            <Link key={`${r.kind}-${r.id}`} to={r.kind === 'expense' ? `/expenses/${r.id}` : `/vendor-receipts/${r.id}`}
              className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/40">
              <span className="w-20 shrink-0 text-xs text-slate-500">{formatDate(r.sent_on)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-slate-800 dark:text-slate-100">{r.code ?? (r.kind === 'vrf' ? 'Vendor request' : 'Expense')}</span>
                <span className="block truncate text-[11px] text-slate-400">{r.payee ?? ''}{r.method ? ` · ${r.method}` : ''}</span>
              </span>
              {late && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">not on statement</span>}
              <span className="w-32 text-right tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(r.amount)}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
